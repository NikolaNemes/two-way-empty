"use server"

import { db } from "@/lib/db"
import { modelVersion, type ModelVersionRow } from "@/lib/db/schema"
import {
  getV5Params,
  resolveParams,
  type KernelParams,
} from "@/lib/model-registry"
import { desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

/**
 * Ensure the single production engine row exists and stays in sync:
 *   • "v5" (historical DB label) — the SOLE engine: the LP dispatcher
 *     (lib/optimizer/solver) with the adaptive, uncertainty-sized reserve.
 *     This is the only model used everywhere (live worker, backtests, replay).
 *
 * SINGLE ENGINE: the legacy v1–v3 heuristic versions AND the v4 flat-floor
 * parameterisation have all been retired. Any leftover v1/v2/v3/v4 rows from
 * earlier seeds are deleted here so the registry shows only the one engine.
 *
 * Idempotent and safe to call on every page load. Params are re-synced from the
 * registry each call so the row can never drift. The default flag is only forced
 * on the FIRST creation of v5 (which clears it from all others), so a later
 * manual default selection in the lab is respected on subsequent loads.
 */
export async function ensureVersionsSeeded(): Promise<void> {
  // ── Retire all superseded versions (single-engine cleanup) ───────────────
  // v1/v2/v3 were the removed decideTick/merit-order heuristic; v4 was the
  // flat-reserve-floor parameterisation now subsumed by v5 (same LP engine, the
  // adaptive reserve simply collapses to a flat floor when uncertainty is low).
  // Drop any rows left behind by older seeds so they never reappear.
  await db.delete(modelVersion).where(inArray(modelVersion.label, ["v1", "v2", "v3", "v4"]))

  // ── v5: THE engine — adaptive (uncertainty-sized) reserve ────────────────
  // The sole production dispatcher. An EVENT-DRIVEN LP with a time-varying
  // planning floor sized by demand-forecast uncertainty (the predecessor's flat
  // floor is just the special case where the adaptive cushion is zero).
  const v5 = await db
    .select({ id: modelVersion.id })
    .from(modelVersion)
    .where(eq(modelVersion.label, "v5"))
    .limit(1)
  const v5Name = "Dispatch optimizer (adaptive uncertainty-sized reserve)"
  const v5Description =
    "The production dispatch engine. An EVENT-DRIVEN receding-horizon optimizer that solves a " +
    "linear program over the price horizon: minimize energy cost subject to HARD constraints — " +
    "EV demand protection (energy balance + reserve floor), no grid export (g ≥ 0), and a daily " +
    "self-consumption throughput cap (buffer discharge ≤ forecast car demand, since under " +
    "no-export every discharged kWh must serve a car). Its reserve floor is ADAPTIVE: rather " +
    "than always holding a fixed fraction of the pack, the planning floor is time-varying — a " +
    "low base floor plus a cushion sized from the per-hour demand-forecast UNCERTAINTY (the " +
    "P90 − mean gap from the session log) over a short protective lookahead — so the battery is " +
    "kept fuller exactly when EV-arrival uncertainty is high and runs leaner when demand is " +
    "predictable. It HOLDS the plan and replans only on a relevant event (a car " +
    "connecting/disconnecting or the live intraday price diverging from day-ahead) plus a " +
    "safety interval; the committed step settles at the live IDM price. Uses the metered " +
    "ChargePost model (190 kWh usable, 87 kW grid cap, η=0.94) and a session-derived forecast."
  const v5KernelNotes =
    "LP engine (lib/optimizer/solver.ts, GLPK) with the adaptive reserve. Decision = grid import " +
    "ceiling g[t]; the station handles the real-time EV/buffer split underneath. Per-step " +
    "buffer-energy lower bound = base floor (socFloorFrac) + coverage · Σ max(0, P90−mean " +
    "demand)·dt over reserveLookaheadH, clamped to reserveMaxFrac·E_max. Demand spread from " +
    "lib/demand-forecast (hourlyKwHi). Event-driven replanning (connect/disconnect + IDM↔DAM " +
    "divergence + safety interval). A microscopic charge front-load tie-break makes " +
    "equal-price slots bank cheap energy NOW vs deferring. NO GRID EXPORT (g ≥ 0)."
  if (v5.length === 0) {
    // v5 is the production default — clear any other default first.
    await db.update(modelVersion).set({ isDefault: false })
    await db.insert(modelVersion).values({
      label: "v5",
      name: v5Name,
      description: v5Description,
      status: "active",
      isDefault: true,
      params: getV5Params(),
      kernelNotes: v5KernelNotes,
    })
  } else {
    await db
      .update(modelVersion)
      .set({
        name: v5Name,
        description: v5Description,
        kernelNotes: v5KernelNotes,
        params: getV5Params(),
        status: "active",
      })
      .where(eq(modelVersion.id, v5[0].id))
  }
}

export async function listModelVersions(): Promise<ModelVersionRow[]> {
  await ensureVersionsSeeded()
  return db.select().from(modelVersion).orderBy(desc(modelVersion.isDefault), modelVersion.id)
}

export async function getModelVersion(id: number): Promise<ModelVersionRow | null> {
  const rows = await db.select().from(modelVersion).where(eq(modelVersion.id, id)).limit(1)
  return rows[0] ?? null
}

/** Make exactly one version the default (clears the flag on all others). */
export async function setDefaultVersion(id: number): Promise<void> {
  await db.update(modelVersion).set({ isDefault: false })
  await db.update(modelVersion).set({ isDefault: true }).where(eq(modelVersion.id, id))
  revalidatePath("/lab/models")
}

/**
 * Create a draft version by cloning the production default params with an
 * override (see resolveParams). Draft versions
 * are data-only: the backtest engine applies the params it can (see
 * model-registry APPLIED_PARAM_KEYS); the rest are recorded for comparison.
 */
export async function createDraftVersion(input: {
  label: string
  name: string
  description?: string
  paramOverride?: Partial<KernelParams>
}): Promise<ModelVersionRow> {
  const params = resolveParams(input.paramOverride)
  const rows = await db
    .insert(modelVersion)
    .values({
      label: input.label,
      name: input.name,
      description: input.description ?? null,
      status: "draft",
      isDefault: false,
      params,
      kernelNotes: "Draft parameterization. Applied params limited to kernel inputs.",
    })
    .returning()
  revalidatePath("/lab/models")
  return rows[0]
}
