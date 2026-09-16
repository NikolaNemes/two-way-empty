"use server"

import { getDatasetSeries, type DatasetResult } from "@/lib/dataset"
import { DEFAULT_STATION_ID } from "@/lib/amperio-api"

export async function fetchDatasetSeries(input: {
  stationId?: string
  fromIso: string
  toIso: string
  stepSeconds?: number
}): Promise<DatasetResult> {
  return getDatasetSeries({
    stationId: input.stationId?.trim() || DEFAULT_STATION_ID,
    fromIso: input.fromIso,
    toIso: input.toIso,
    stepSeconds: input.stepSeconds,
  })
}
