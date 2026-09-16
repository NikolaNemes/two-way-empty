"use client"

import { ExternalLink, BookOpen } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useState } from "react"

export interface SourceRef {
  /** Short label e.g. "ADS-TEC CP320 Datasheet" */
  label: string
  /** Full URL to the source */
  url: string
  /** What this source supports, e.g. "Battery capacity 143 kWh, max output 320 kW" */
  detail: string
  /** Date accessed or published (optional) */
  date?: string
}

interface SourcesCitationProps {
  /** Section title shown next to the icon */
  title?: string
  sources: SourceRef[]
}

export function SourcesCitation({
  title = "Sources & References",
  sources,
}: SourcesCitationProps) {
  const [open, setOpen] = useState(false)

  if (sources.length === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:border-muted-foreground/50"
        >
          <BookOpen className="size-3.5 shrink-0" />
          <span className="font-medium">{title}</span>
          <span className="ml-auto font-mono text-[10px]">
            {sources.length} {sources.length === 1 ? "source" : "sources"} {open ? "[-]" : "[+]"}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border bg-background p-3 space-y-2">
          {sources.map((src, i) => (
            <div key={i} className="flex items-start gap-2.5 text-xs">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-muted font-mono text-[9px] font-bold text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground transition-colors"
                  >
                    {src.label}
                  </a>
                  <ExternalLink className="size-2.5 text-muted-foreground shrink-0" />
                  {src.date && (
                    <span className="text-[10px] text-muted-foreground/60 font-mono">
                      ({src.date})
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-muted-foreground leading-relaxed">
                  {src.detail}
                </p>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground/50 border-t border-border pt-2 mt-3">
            Links verified at time of model creation. Market data, tariffs, and regulatory values may have changed since publication.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
