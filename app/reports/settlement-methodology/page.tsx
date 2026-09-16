"use client"

import { Printer, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ANNEX_BASE_TERM_KEYS, ANNEX_REPORT_TERM_KEYS, REPORT_TERMS } from "@/lib/report-definitions"

/**
 * Settlement Methodology — printable contract annex.
 *
 * Formalizes HOW the dispatch algorithm's margin/contribution is calculated
 * (post-pilot, for the Amperio agreement). Methodology only — commercial
 * terms (fees, shares, percentages) are deliberately out of scope and live
 * in the main agreement. Every formula on this page mirrors the production
 * implementation in the Financial Breakdown report (tariff-comparison-report,
 * backtest engine) so the contract text and the software can never diverge.
 *
 * Print via the toolbar button — print CSS strips the app chrome.
 */

import { METHODOLOGY_VERSION } from "@/lib/methodology-version"

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-md border bg-muted/30 px-4 py-3 font-mono text-[13px] leading-relaxed print:border-neutral-300 print:bg-neutral-50">
      {children}
    </div>
  )
}

function Clause({
  no,
  title,
  children,
}: {
  no: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mt-8 mb-2 text-base font-semibold">
        {no}. {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  )
}

function Term({
  id,
  term,
  unit,
  def,
  formula,
  annex,
}: {
  /** Anchor target — report tooltips deep-link here (#term-<key>). */
  id?: string
  term: string
  unit?: string
  def: string
  formula?: string
  annex?: string
}) {
  return (
    <tr id={id} className="scroll-mt-20 border-b align-top target:bg-muted/40 print:border-neutral-300">
      <td className="w-56 py-1.5 pr-4 font-medium">
        {term}
        {unit ? <span className="ml-1 font-normal text-muted-foreground">({unit})</span> : null}
        {annex ? (
          <span className="block text-[11px] font-normal text-muted-foreground">Clause {annex.replace(/^A/, "")}</span>
        ) : null}
      </td>
      <td className="py-1.5">
        {def}
        {formula ? (
          <code className="mt-1 block font-mono text-[12px] leading-relaxed text-foreground/80">{formula}</code>
        ) : null}
      </td>
    </tr>
  )
}

export default function SettlementMethodologyPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      {/* Toolbar — hidden in print */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reports/financial-breakdown">
            <ArrowLeft className="mr-1.5 size-4" />
            Financial Breakdown
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 size-4" />
          Print / Save as PDF
        </Button>
      </div>

      {/* Document header */}
      <header className="border-b-2 border-foreground pb-4 print:border-black">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Annex — Technical Methodology
        </p>
        <h1 className="mt-1 text-2xl font-bold text-balance">
          Calculation of Dispatch Optimization Margin and Load Shifting Contribution
        </h1>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-xs text-muted-foreground">
          <span>
            Methodology version: <strong className="text-foreground">v{METHODOLOGY_VERSION}</strong>
          </span>
          <span>
            System: <strong className="text-foreground">Enexa dispatch optimizer — Amperio ChargePost (Gronau)</strong>
          </span>
          <span>
            Status: <strong className="text-foreground">Post-pilot formalization</strong>
          </span>
        </div>
      </header>

      <p className="mt-5 text-sm leading-relaxed text-foreground/90">
        This Annex defines the measurement basis, calculation formulas, and attribution rules used to
        quantify (a) the total financial margin produced by operating the charging site on a dynamic,
        intraday-indexed electricity tariff with battery-supported dispatch, and (b) the specific
        contribution of the dispatch optimization software (&quot;the Algorithm&quot;) within that
        margin. This Annex specifies methodology only; commercial terms are governed by the main
        agreement. All figures produced under this Annex are computed by the production reporting
        system from metered telemetry, and every reported figure carries the data window, the
        data-through timestamp, and the methodology version so that any two reports are reproducible
        and comparable.
      </p>

      <Clause no="1" title="Definitions">
        {/* Rendered from lib/report-definitions — the same rows every report
            tooltip and every Excel "Definitions" sheet carries. */}
        <table className="w-full border-t text-sm print:border-neutral-300">
          <tbody>
            {ANNEX_BASE_TERM_KEYS.map((k) => {
              const t = REPORT_TERMS[k]
              return <Term key={k} id={`term-${k}`} term={t.label} def={t.definition} />
            })}
          </tbody>
        </table>
      </Clause>

      <Clause no="2" title="Metering and Data Basis">
        <p>
          2.1 All settlement quantities derive exclusively from metered telemetry recorded by the
          Site&apos;s middleware (grid meter, BMS registers, per-connector counters). No modeled or
          forecast quantity is used for settlement; forecasts are used only for dispatch decisions.
        </p>
        <p>
          2.2 Grid Import is integrated at full metering resolution (all Frames in the window). Where
          a visualization uses a downsampled series, monetary figures are rescaled to the
          full-resolution meter total, so charted and billed energy always reconcile.
        </p>
        <p>
          2.3 Battery Throughput is measured from BMS inverter power registers (primary measurement).
          The SOC-implied path length is computed alongside as a plausibility check; it is never used
          for pricing.
        </p>
      </Clause>

      <Clause no="3" title="Price Basis">
        <p>
          3.1 Each Slot&apos;s price is resolved in the following order: (a) the live IDM intraday
          price for that Slot; (b) the day-ahead (DAM) price for the hour containing the Slot, where
          the IDM price is unavailable; (c) carry-forward of the last resolved price, for residual
          gaps only. Every report states the achieved price-source mix (share of kWh priced on IDM
          vs. DAM), computed on the same energy basis as the meter total.
        </p>
        <p>
          3.2 Dynamic procurement cost is a true per-slot summation — never an average-price
          shortcut:
        </p>
        <Formula>
          Cost_dynamic = Σ over all Slots ( kWh_slot × price_slot ) &nbsp;+&nbsp; adder × kWh_total
        </Formula>
        <p>
          The energy-weighted average (Cost_dynamic ÷ kWh_total, in ct/kWh) is reported for context
          only; it is an output of the summation, never an input.
        </p>
        <p>3.3 Flat procurement cost is:</p>
        <Formula>Cost_flat = kWh_total × FlatRate</Formula>
      </Clause>

      <Clause no="4" title="Battery Wear">
        <p>
          4.1 Battery wear is priced at the agreed cycling cost of{" "}
          <strong>3.5 ct per kWh of Battery Throughput</strong> (equivalently 35 €/MWh per direction
          of flow). This same rate is used by the Algorithm&apos;s internal optimization, so planning
          and settlement use one consistent wear price.
        </p>
        <Formula>Wear = Σ |P_battery| · Δt × 3.5 ct/kWh</Formula>
        <p>
          4.2 Each tariff scenario carries the wear its own strategy would actually incur: under the
          Flat Rate there is no price spread to exploit, so only unavoidable peak-shaving cycling is
          counted; under the Dynamic Tariff the battery additionally cycles for load shifting, so the
          full as-run throughput is priced. The wear difference between the two is the &quot;extra
          wear&quot; attributable to load shifting.
        </p>
      </Clause>

      <Clause no="5" title="Net Total Saving (Total Margin)">
        <p>
          5.1 The total margin of operating on the Dynamic Tariff with battery-supported dispatch,
          relative to the Flat Rate baseline, is:
        </p>
        <Formula>
          EnergySaving = Cost_flat − Cost_dynamic
          <br />
          ExtraWear = Wear_dynamic − Wear_flat
          <br />
          <strong>NetTotalSaving = EnergySaving − ExtraWear</strong>
        </Formula>
        <p>
          5.2 NetTotalSaving is the headline settlement figure. It is reported per Settlement Window
          together with total kWh, the price-source mix, the data-through timestamp, and the
          methodology version.
        </p>
      </Clause>

      <Clause no="6" title="Load Shifting Contribution of the Algorithm">
        <p>
          6.1 NetTotalSaving contains two economically distinct components: (a) the market price
          level of the Dynamic Tariff versus the Flat Rate (which exists even with naive dispatch),
          and (b) the timing value created by the Algorithm deciding <em>when</em> energy is bought.
          Component (b) is the Algorithm&apos;s attributable contribution.
        </p>
        <p>
          6.2 To isolate it, a <strong>grid-first counterfactual anchored to measured SOC at both
          window edges</strong> is simulated over the identical Frames: the battery packs enter the
          window at the <em>measured</em> start SOC and hold that level (every charging session is
          served from the grid up to the Site&apos;s deliverable ceiling; the battery discharges
          only for demand above that ceiling — unavoidable peak shaving — and immediately re-buys
          exactly that energy from spare headroom, with no regard to price). At window close the
          counterfactual is trued up to the <em>measured</em> end SOC: any shortfall is purchased,
          and any surplus is discharged into sessions displacing import, both at the window&apos;s
          blended market rate, with the associated cell throughput charged as counterfactual wear.
          Both worlds therefore start and end with identical stored energy, and no separate
          stored-energy settlement exists. The counterfactual import curve is priced at the{" "}
          <em>same</em> per-slot prices under Clause 3.
        </p>
        <Formula>
          TimingValue = Cost_counterfactual − Cost_dynamic
          <br />
          <strong>LoadShiftingContribution = TimingValue − ExtraWear</strong>
        </Formula>
        <p>
          6.3 Validity check: the counterfactual import volume must approximately equal the actual
          import volume (energy conservation — the same sessions are served either way). Both volumes
          are stated in every report. Only the timing differs; that difference is the value created
          purely by the Algorithm.
        </p>
        <p>
          6.4 The contribution may legitimately be near zero or negative on days with a flat price
          profile (no spread to shift into). Such honest negative results are reported as computed
          and are not adjusted.
        </p>
      </Clause>

      <Clause no="7" title="Site Constraints Recognized in All Calculations">
        <p>
          7.1 The grid-import ceiling used for planning and for the counterfactual is a uniform{" "}
          <strong>90 kW</strong> across every location. The same ceiling is applied on both sides of
          every comparison, so no scenario is credited with energy beyond that modelled limit.
        </p>
        <p>
          7.2 Auxiliary (hotel) load is non-dispatchable grid draw and is included in Grid Import on
          both sides of every comparison.
        </p>
        <p>
          7.3 Under the EV-First Policy (Clause 1), vehicle charging speed is never reduced by the
          Algorithm. Vehicle-side charging taper (the car&apos;s own charging curve) is not counted
          as missed delivery in any metric.
        </p>
      </Clause>

      <Clause no="8" title="Audit, Reproducibility and Versioning">
        <p>
          8.1 Every settlement report states: the Settlement Window, the data-through timestamp (last
          Frame included), total metered kWh, the price-source mix, the wear rate applied, and the
          methodology version.
        </p>
        <p>
          8.2 Two reports over the same Settlement Window, the same data-through timestamp, and the
          same methodology version produce identical figures. A window that includes the current day
          continues to fill until the day completes; final settlement uses completed days only.
        </p>
        <p>
          8.3 Changes to this methodology (constants, counterfactual rules, price resolution order)
          increment the methodology version. Reports computed under different versions are not
          directly comparable and are flagged as such by the version stamp.
        </p>
        <p>
          8.4 The full per-slot decomposition (slot kWh, slot price, source) and the counterfactual
          series underlying any report are retained and can be exported for audit on request.
        </p>
        <p>
          8.5 <strong>One Settlement Window rule.</strong> A report day is a Europe/Berlin calendar day
          from 00:00:00.000 to 23:59:59.999, regardless of the viewer&apos;s or the server&apos;s
          timezone. A calendar month is its first through its last such day; a running month is
          settled through the last completed day only. Every report — the Site Financial Report, the
          Fleet Monthly Report and the Fleet Yearly Report — builds its window by this one rule.
        </p>
        <p>
          8.6 <strong>One computation per Station-Window.</strong> All reports price a Station over a
          Settlement Window through a single settlement function (same metered replay, same price
          curve, same counterfactual, same wear model, same parameters). The Fleet Monthly Report is
          that function applied to each Station&apos;s calendar month; the Fleet Yearly Report is the
          sum of Fleet Monthly rows and never re-prices. Hence the Site Financial Report run for a
          Station&apos;s full calendar month prints figures identical to that Station&apos;s Fleet
          Monthly row and to its contribution to the Fleet Yearly Report, to the cent; the Site
          Financial Report displays this reconciliation against the frozen Fleet Monthly row.
        </p>
        <p>
          8.7 <strong>Fixed settlement parameters.</strong> The flat rate (A5.1), the fixed adder on the
          IDM index, the battery cycling cost per kWh of throughput (A6.3) and the grid-import cap of
          the no-load-shifting counterfactual (A6.2) are constants of this Annex. They are displayed
          on every report for transparency and cannot be adjusted by any user on any report; a change
          to any of them is a change to this Annex and bumps the methodology version.
        </p>
      </Clause>

      <section id="glossary" className="scroll-mt-20 break-before-page">
        <h2 className="mt-8 mb-2 text-base font-semibold">Appendix A. Report Term Glossary</h2>
        <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
          <p>
            The quantities printed by the reporting system (Financial Breakdown, Dispatching History,
            Fleet Monthly, Fleet Yearly, Price Analysis) use exactly the labels below. Each label carries
            this definition as an on-screen tooltip, and every Excel export includes a
            &quot;Definitions&quot; sheet listing these same rows, so a figure in a workbook and a figure
            on screen can always be traced to the same clause of this Annex.
          </p>
          <table className="w-full border-t text-sm print:border-neutral-300">
            <tbody>
              {ANNEX_REPORT_TERM_KEYS.map((k) => {
                const t = REPORT_TERMS[k]
                return (
                  <Term
                    key={k}
                    id={`term-${k}`}
                    term={t.label}
                    unit={t.unit}
                    annex={t.annex}
                    def={t.definition}
                    formula={t.formula}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-10 border-t pt-4 text-xs text-muted-foreground print:border-neutral-300">
        <p>
          Methodology v{METHODOLOGY_VERSION} · Generated by the Enexa dispatch reporting system. This
          Annex describes calculation methodology only and contains no commercial terms.
        </p>
      </footer>
    </main>
  )
}
