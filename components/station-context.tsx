"use client"

/**
 * STATION CONTEXT — which location the UI is looking at (multi-location).
 *
 * Client-side selection state shared by every page: the selected stationId is
 * resolved as URL `?stationId=` → localStorage → first enabled station →
 * DEFAULT_STATION_ID. The station LIST is fetched once via the listStationsAction
 * server action with SWR (30s refresh, stations rarely change).
 *
 * Consumers read { stationId, station, stations } from useStation() and pass
 * stationId to server actions / API calls. The switcher writes the selection
 * to localStorage so it follows the operator across pages and sessions.
 */

import React from "react"
import useSWR from "swr"
import { listStationsAction } from "@/app/actions/stations"
import type { StationConfig } from "@/lib/stations"

const LS_KEY = "enexa.station.selected.v1"
const DEFAULT_STATION_ID = "chargepost_gronau_001"

interface StationContextValue {
  /** The selected station id (always defined; defaults to Gronau). */
  stationId: string
  /** The selected station's full config, when the list has loaded. */
  station: StationConfig | null
  /** All registry stations (enabled and disabled; switcher shows enabled). */
  stations: StationConfig[]
  /** Whether the registry list has loaded at least once. */
  loaded: boolean
  setStationId: (id: string) => void
}

const StationContext = React.createContext<StationContextValue>({
  stationId: DEFAULT_STATION_ID,
  station: null,
  stations: [],
  loaded: false,
  setStationId: () => {},
})

export function StationProvider({ children }: { children: React.ReactNode }) {
  const [stationId, setStationIdState] = React.useState<string>(DEFAULT_STATION_ID)

  // Resolve initial selection: URL param wins (deep links), then localStorage.
  React.useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("stationId")
      if (fromUrl) {
        setStationIdState(fromUrl)
        window.localStorage.setItem(LS_KEY, fromUrl)
        return
      }
      const stored = window.localStorage.getItem(LS_KEY)
      if (stored) setStationIdState(stored)
    } catch {
      // Storage unavailable (private mode etc.) — session-only selection.
    }
  }, [])

  const { data } = useSWR("stations:list", () => listStationsAction(), {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  })
  const stations = React.useMemo(() => data ?? [], [data])

  // If the stored selection vanished from the registry (deleted/renamed),
  // fall back to the first enabled station rather than showing a ghost.
  React.useEffect(() => {
    if (!stations.length) return
    if (!stations.some((s) => s.stationId === stationId)) {
      const first = stations.find((s) => s.enabled) ?? stations[0]
      if (first) setStationIdState(first.stationId)
    }
  }, [stations, stationId])

  const setStationId = React.useCallback((id: string) => {
    setStationIdState(id)
    try {
      window.localStorage.setItem(LS_KEY, id)
    } catch {
      // Best-effort persistence only.
    }
  }, [])

  const station = stations.find((s) => s.stationId === stationId) ?? null

  return (
    <StationContext.Provider
      value={{ stationId, station, stations, loaded: data != null, setStationId }}
    >
      {children}
    </StationContext.Provider>
  )
}

export function useStation(): StationContextValue {
  return React.useContext(StationContext)
}
