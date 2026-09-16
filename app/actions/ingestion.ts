"use server"

import { db } from "@/lib/db"
import { ingestionJob, type IngestionJobRow } from "@/lib/db/schema"
import { backfillRange, getCoverage } from "@/lib/ingestion"
import { DEFAULT_STATION_ID } from "@/lib/amperio-api"
import { desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export interface StartBackfillInput {
  stationId?: string
  fromIso: string
  toIso: string
  stepSeconds?: number
}

/**
 * Run a backfill synchronously within the action and track it in
 * `ingestion_job`. Returns the finished job row. The job row is created up
 * front (status=running) and updated as days complete, so the UI can poll it.
 */
export async function startBackfill(input: StartBackfillInput): Promise<IngestionJobRow> {
  const stationId = input.stationId?.trim() || DEFAULT_STATION_ID
  const stepSeconds = input.stepSeconds ?? 15

  const [job] = await db
    .insert(ingestionJob)
    .values({
      stationId,
      fromTs: new Date(input.fromIso),
      toTs: new Date(input.toIso),
      stepSeconds,
      status: "running",
      framesIngested: 0,
    })
    .returning()

  try {
    const total = await backfillRange({
      stationId,
      fromIso: input.fromIso,
      toIso: input.toIso,
      stepSeconds,
      onProgress: async (p) => {
        await db
          .update(ingestionJob)
          .set({ framesIngested: p.framesIngested })
          .where(eq(ingestionJob.id, job.id))
      },
    })

    const [done] = await db
      .update(ingestionJob)
      .set({ status: "done", framesIngested: total, finishedAt: new Date() })
      .where(eq(ingestionJob.id, job.id))
      .returning()
    revalidatePath("/lab/ingestion")
    revalidatePath("/lab/dataset")
    return done
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown ingestion error"
    const [failed] = await db
      .update(ingestionJob)
      .set({ status: "error", error: message, finishedAt: new Date() })
      .where(eq(ingestionJob.id, job.id))
      .returning()
    revalidatePath("/lab/ingestion")
    return failed
  }
}

export async function listIngestionJobs(): Promise<IngestionJobRow[]> {
  return db.select().from(ingestionJob).orderBy(desc(ingestionJob.startedAt)).limit(50)
}

export async function getJob(id: number): Promise<IngestionJobRow | null> {
  const rows = await db.select().from(ingestionJob).where(eq(ingestionJob.id, id)).limit(1)
  return rows[0] ?? null
}

export async function getDatasetCoverage(stationId?: string) {
  return getCoverage(stationId?.trim() || DEFAULT_STATION_ID)
}
