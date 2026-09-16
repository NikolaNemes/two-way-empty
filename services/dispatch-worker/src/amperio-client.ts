/**
 * Minimal server-side Amperio API client for the dispatch worker.
 *
 * Unlike lib/amperio-api.ts (which talks to the Next.js proxy at /api/amperio
 * to dodge browser CORS), this client runs in Node and hits the upstream
 * Amperio API directly, attaching a Bearer token when one is configured.
 *
 * Endpoints used (see https://amperio.enexa.me/swagger):
 *   GET  /telemetry/latest?station_id=...        → live frame
 *   GET  /prices?source&from&to&resolution=PT15M  → DAM/IDM price curve
 *   POST /commands/dispatch                       → issue a setpoint command
 */

import type { WorkerConfig } from "./config.ts"
import type { DispatchPayload } from "../../../lib/dispatch-kernel.ts"

// ── Upstream response shapes (only the fields we read) ────────────────────

export interface LatestFrame {
  station_id: string
  ts: string
  grid: { p_grid_w: number }
  /**
   * Per-pack telemetry. `max_charge_w` / `max_discharge_w` are the device's
   * live power limits; `energy_full_kwh` / `energy_empty_kwh` are the usable
   * charge / discharge energy headroom registers (E_full / E_empty). All
   * optional — older frames may omit them and the kernel falls back to its
   * static spec constants.
   */
  batteries: Array<{
    unit_id: number
    soc_pct: number
    power_w: number
    max_charge_w?: number
    max_discharge_w?: number
    energy_full_kwh?: number
    energy_empty_kwh?: number
  }>
  chargers: Array<{
    unit_id: number
    p_ev_w: number
    plug_state: string
    /** `boost_contactor === "closed"` → the two units are coupled onto one connector. */
    boost_contactor?: string
    /** Live connector power ceiling (W) — `p_cp_max_w`, the safety-clamp source for P_cp_lim. */
    p_cp_max_w?: number
  }>
  /** Station-level dynamic limits; `p_grid_consumption_limit_w` is the live grid import ceiling. */
  station?: { p_grid_consumption_limit_w?: number; p_grid_generation_limit_w?: number }
  prices?: { bucket_ts: string; dam: number; idm: number } | null
}

export interface PricePoint {
  ts: string
  price_eur_mwh: number
}

export interface PricesResponse {
  source: "DAM" | "IDM"
  prices: PricePoint[]
}

export class AmperioClient {
  constructor(private readonly cfg: WorkerConfig) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json",
      ...extra,
    }
    // Per the Amperio spec, Bearer auth is omitted in local dev and only
    // required when the server has AUTH_TOKEN configured.
    if (this.cfg.authToken) h.Authorization = `Bearer ${this.cfg.authToken}`
    return h
  }

  private url(path: string, params?: Record<string, string>): string {
    const u = new URL(this.cfg.baseUrl + path)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) u.searchParams.set(k, v)
      }
    }
    return u.toString()
  }

  async getLatestFrame(): Promise<LatestFrame> {
    const res = await fetch(this.url("/telemetry/latest", { station_id: this.cfg.stationId }), {
      headers: this.headers(),
    })
    if (!res.ok) {
      throw new Error(`GET /telemetry/latest → ${res.status} ${await res.text()}`)
    }
    return (await res.json()) as LatestFrame
  }

  async getPrices(fromIso: string, toIso: string): Promise<PricesResponse> {
    const res = await fetch(
      this.url("/prices", {
        source: this.cfg.priceSource,
        from: fromIso,
        to: toIso,
        resolution: "PT15M",
      }),
      { headers: this.headers() },
    )
    if (!res.ok) {
      throw new Error(`GET /prices → ${res.status} ${await res.text()}`)
    }
    return (await res.json()) as PricesResponse
  }

  /** POST a dispatch command. Returns the HTTP status for logging. */
  async postDispatch(payload: DispatchPayload): Promise<number> {
    const res = await fetch(this.url("/commands/dispatch"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new Error(`POST /commands/dispatch → ${res.status} ${await res.text()}`)
    }
    return res.status
  }
}
