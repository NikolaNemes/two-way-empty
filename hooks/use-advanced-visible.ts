"use client"

import { useEffect, useState } from "react"

/**
 * Easter-egg "advanced mode" flag, toggled by double-clicking the Enexa logo
 * in the sidebar (see AppSidebar.handleLogoClick). Persisted in localStorage.
 *
 * Consumers outside the sidebar (e.g. the Financial Report's arbitrage
 * participation strip) use this hook to show/hide advanced-only UI. It stays
 * in sync live via the custom event the sidebar dispatches on toggle, and via
 * the native "storage" event for cross-tab changes.
 */
export const ADVANCED_VISIBLE_STORAGE_KEY = "enexa.nav.advancedVisible.v2"
export const ADVANCED_VISIBLE_EVENT = "enexa:advanced-visibility"

export function useAdvancedVisible(): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const read = () => {
      try {
        setVisible(window.localStorage.getItem(ADVANCED_VISIBLE_STORAGE_KEY) === "true")
      } catch {
        setVisible(false)
      }
    }
    read()
    window.addEventListener(ADVANCED_VISIBLE_EVENT, read)
    window.addEventListener("storage", read)
    return () => {
      window.removeEventListener(ADVANCED_VISIBLE_EVENT, read)
      window.removeEventListener("storage", read)
    }
  }, [])

  return visible
}
