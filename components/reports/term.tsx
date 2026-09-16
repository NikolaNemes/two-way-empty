"use client"

import type { ComponentProps, ReactNode } from "react"
import Link from "next/link"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TableHead } from "@/components/ui/table"
import { REPORT_TERMS, type ReportTermKey } from "@/lib/report-definitions"
import { cn } from "@/lib/utils"

/**
 * Annex-backed labels. Every KPI card, table header and legend that names a
 * settlement quantity renders through one of these so the wording AND the
 * tooltip (definition · Annex clause · formula) are identical on every report.
 *
 *   <TermLabel term="netTotalSaving" />                 → "Net total saving" + tooltip
 *   <TermLabel term="procurementSaving" short />        → "Saving €"          + tooltip
 *   <TermHead term="gridImport" short className="text-right" />  → <TableHead> variant
 *
 * The tooltip is keyboard-reachable (trigger is focusable) and the label
 * gets a dotted underline so users can discover it.
 */

export function TermTooltipBody({ term }: { term: ReportTermKey }) {
  const t = REPORT_TERMS[term]
  return (
    <div className="flex max-w-[22rem] flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-foreground">
          {t.label}
          {t.unit ? <span className="ml-1 font-normal text-muted-foreground">({t.unit})</span> : null}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">Annex {t.annex}</span>
      </div>
      <p className="text-pretty leading-snug text-muted-foreground">{t.definition}</p>
      {t.formula ? (
        <code className="rounded bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-snug text-foreground">
          {t.formula}
        </code>
      ) : null}
      <Link
        href={`/reports/settlement-methodology#term-${term}`}
        className="self-start text-[10px] text-muted-foreground underline-offset-2 hover:underline"
      >
        Settlement Methodology →
      </Link>
    </div>
  )
}

export function TermLabel({
  term,
  short = false,
  unit,
  children,
  className,
}: {
  term: ReportTermKey
  /** Use the compact label (e.g. "Saving €") — tooltip stays identical. */
  short?: boolean
  /** Override / suppress the unit suffix (default: none — units live in the tooltip). */
  unit?: string | false
  /** Custom visible text (rare — e.g. "EV delivered (C1+C2)"); tooltip still applies. */
  children?: ReactNode
  className?: string
}) {
  const t = REPORT_TERMS[term]
  const raw = children ?? (short && t.short ? t.short : t.label)
  // Table headers may wrap (SETTLEMENT_TABLE_CLASS). Keep the compound tokens
  // whole so "Wear no-LS €" breaks as "Wear / no-LS €", never "Wear no- / LS €"
  // or "LS gain / €": non-breaking hyphen inside "no-LS"/"as-run", non-breaking
  // space before a trailing unit sign. Display-only — the Excel headers built
  // from termHeader() stay plain ASCII.
  const text = typeof raw === "string" ? raw.replace(/(\w)-(\w)/g, "$1\u2011$2").replace(/ ([€%])$/, "\u00A0$1") : raw
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            className,
          )}
        >
          {text}
          {unit ? <span className="ml-1 font-normal text-muted-foreground">({unit})</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-none p-3">
        <TermTooltipBody term={term} />
      </TooltipContent>
    </Tooltip>
  )
}

export function TermHead({
  term,
  short = false,
  unit,
  children,
  className,
  ...rest
}: ComponentProps<typeof TableHead> & {
  term: ReportTermKey
  short?: boolean
  unit?: string | false
}) {
  return (
    <TableHead className={className} {...rest}>
      <TermLabel term={term} short={short} unit={unit}>
        {children}
      </TermLabel>
    </TableHead>
  )
}
