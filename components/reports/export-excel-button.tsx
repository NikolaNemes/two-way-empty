"use client"

import { useState } from "react"
import { FileSpreadsheet, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The one Excel export CTA for every report page.
 *
 * Same label ("Export Excel"), icon, size and outline style everywhere, placed
 * top-right of the page header. Two modes:
 *   • `href`     — a server route that streams the workbook (fleet-yearly,
 *                  price-analysis, live monthly). Renders an <a download>.
 *   • `onExport` — an async client-side builder (Financial Breakdown,
 *                  Dispatching History). Shows a spinner while it runs and
 *                  never fires twice.
 *
 * Every workbook produced through either path must include the "Definitions"
 * sheet (lib/report-definitions → definitionsSheetRows).
 */
type Props = {
  href?: string
  onExport?: () => Promise<void> | void
  disabled?: boolean
  /** Optional suffix, e.g. "(real fleet)". Keep short; the label stays "Export Excel". */
  hint?: string
  className?: string
  size?: "sm" | "default"
}

export function ExportExcelButton({ href, onExport, disabled, hint, className, size = "sm" }: Props) {
  const [busy, setBusy] = useState(false)

  const label = (
    <>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
      <span>
        {busy ? "Exporting…" : "Export Excel"}
        {hint && !busy ? <span className="ml-1 text-muted-foreground">{hint}</span> : null}
      </span>
    </>
  )

  if (href && !onExport) {
    // A disabled <a> still navigates — render a real disabled button instead.
    if (disabled) {
      return (
        <Button variant="outline" size={size} disabled className={cn("gap-1.5 bg-transparent", className)}>
          {label}
        </Button>
      )
    }
    return (
      <Button asChild variant="outline" size={size} className={cn("gap-1.5 bg-transparent", className)}>
        <a href={href} download>
          {label}
        </a>
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size={size}
      className={cn("gap-1.5 bg-transparent", className)}
      disabled={disabled || busy}
      onClick={async () => {
        if (busy || !onExport) return
        setBusy(true)
        try {
          await onExport()
        } finally {
          setBusy(false)
        }
      }}
    >
      {label}
    </Button>
  )
}
