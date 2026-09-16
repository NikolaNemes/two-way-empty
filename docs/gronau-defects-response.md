# Gronau defect report — response

Status of every item in "Reported defects" (Timon / NITES, 2 Sep 2026) after the fixes of
2 Sep 2026. Every number below was re-measured against the Neon database, the Amperio
middleware and the running app on that day; nothing is quoted from memory.

Legend: **FIXED** = defect no longer reproducible · **FIXED (definition)** = the numbers were
technically right but meant something else than the label said; label and definition are now
the Annex ones · **OPEN (decision)** = needs a modelling decision from the client, not code.

---

## Defect 1 (PRIO 1) — hist_AX10095481 Gronau: "15 months", low load-shift gain, "Contains measured = yes"

**Real.** All three sub-complaints were justified.

| Claim | What we found | Status |
|---|---|---|
| 15 months for a station live since Dec 2025 | The row is the **archive twin** of Gronau (`hist_AX10095481`), not the live pilot. The yearly builder padded it from the fleet report's first month: of the 15 (later 17) months, **6 were synthesized** (`seasonal`/`recent` volume basis), **2 were zero months**, 9 were real archive volume. | **FIXED** — synthesized and zero months are no longer written. The station now has **9 months** (Nov 2025 – Jul 2026), all real volume. |
| "Contains measured: yes" although sessions/kWh are not real | `bool_or(measured)` was true because of **one** measured month. | **FIXED** — the yes/no column is removed. Every sheet now shows **Measured station-months / Archive station-months** (Gronau today: **3 measured (May–Jul 2026) / 6 archive**). |
| Sessions are not real numbers | Archive months have no charge events; sessions were a **5 kW rising-edge heuristic** in the archive import. | **FIXED (labelling)** — archive-month sessions are marked **≈ estimated** with the basis stated on the Report-info sheet; measured months use real plug-in sessions. |
| Load-shift gain very low vs shifted kWh | `Load-shift gain = timing value × capture − wear`, computed on mostly simulated months on volume that was never under the optimiser. Apples to oranges, exactly as reported. | **OPEN (decision)** — the honest numbers are now shown with provenance; whether the portfolio comparison should use *measured months only* per station is the topic of the reporting deep-dive call. |

What the client sees now: Fleet Yearly (hist dataset) → Stations sheet: "Months reported 9 ·
Measured 3 · Archive 6 · Sessions estimated ≈ n"; Report-info sheet states the station-month
provenance and the sessions basis; the Definitions sheet carries the Annex definitions.

### Cross-check of the internal Defect-1 analysis (2 Sep 2026)

An internal write-up attributed the 15 months to `getGronauBaseline()` (app/actions/portfolio.ts)
counting archive months with `import_kwh > 500`. Verified against the code and data:

| Statement in the analysis | Verified | Note |
|---|---|---|
| `hist_AX10095481` is a separate archive row from a one-time CSV import, joined to Gronau via `linked_station_id` | **correct** | `scripts/portfolio/aggregate_portfolio.py`, `portfolio_station.linked_station_id` |
| Sessions in the archive are a 5 kW rising-edge heuristic, not charge events | **correct** | `aggregate_portfolio.py` line 120; already labelled "≈ estimated (5 kW rising edges)" on screen and in the xlsx |
| The 15-month span comes from `getGronauBaseline()` | **incorrect** | that function has **no call sites** (dead code). The yearly report is built by `lib/fleet-report-builder.ts` from `fleet_month_report`; the 15 months were the builder's **synthesized/zero months** — now removed (9 real months) |
| The archive predates the optimiser (live since Dec 2025) | **partly** | archive volume starts **Nov 2025**; that month has *negative* price savings (−39 €) — consistent with "not yet optimised". Dec 2025 → Jul 2026 savings are positive and rising (19 € → 288 €). The live telemetry (`station_day_report`) starts **May 2026** |
| "Compare only the live-optimised period per station" is a modelling decision, not a code fix | **agreed** | this is the single item still **OPEN (decision)** — see row 4 above. Concretely: keep or drop **Nov 2025** for Gronau, and whether cross-station comparisons use *measured months only* |

---

## Defect 2 — Live dispatching, Gronau 2026-09-02 09:54: EV demand > 0 with 0 sessions

**Real — a definition bug, not a data bug.** The series labelled "EV demand / EV delivered" on
the live and history charts was the **power-balance reconstruction** `max(0, battery − grid)`
because the charger's `p_ev_w` register is known-broken. That reconstruction cannot separate EV
from the ChargePost's own AUX/hotel draw, so with no car plugged in it showed the **0.9 kW
standby load** as "EV demand". Sessions (plug state + energy-counter delta) and the KPI
"EV delivered (C1+C2)" (metered counters) were both correctly **0**.

**FIXED.** The chart series now comes from the **metered connector counters** (`mEv1 + mEv2`);
AUX is shown as its own series (derived site load − metered EV); the tooltip reads
"Site load (EV + AUX) / EV charging (metered) / AUX".

Verified 2 Sep 2026 (live day, all three stations): metered EV total == Σ sessions exactly
(Gronau 51.7 kWh / 1 session; Gifhorn 53.2 kWh / 3 sessions) and **0 points with EV > 0.5 kW
outside a session**. With 0 sessions the EV series is now 0 all day.

---

## Defect 3 — Dispatching history vs Fleet Monthly, July 2026: grid import / EV delivered mismatch

**Partly real.** Two effects were stacked:

1. The two screenshots compared **different months** — the Fleet Monthly screenshot has
   *August 2026* selected (Gronau 6.484 / 6.622 / 155), the history report is *July*. For July,
   fleet **grid import 6.161** vs site **6.160,8** — they matched to 0,2 kWh.
2. The real mismatch: fleet "EV kWh" was the kernel's **demand signal (EV + AUX)** = 6.104,
   while the site KPI "EV delivered (C1+C2)" was the **metered** 4.830,1. Same column name,
   two definitions.

**FIXED (definition).** One volume column set everywhere — **Grid import / EV delivered (C1+C2)
/ AUX (ChargePost)**; "EV kWh" is retired. The fleet table carries the metered values
(`ev_delivered_kwh`, `aux_kwh`).

Verified for July 2026 Gronau: fleet row **4.830,2 EV / 6.160,7 import / 1.333,8 AUX / 151
sessions**; UTC-day rollups **4.830,2 / 6.161,5 / 1.334,7**; Berlin-local site replay **4.830,2 /
6.160,7 / 1.333,8 / 151**. The remaining 0,8 kWh on import between UTC-day and Berlin-local
windows is the calendar-day boundary, not computation drift.

---

## Usability 1 — long execution of Financial and Dispatching History reports

**Real; three root causes.** (a) Gronau had **no local telemetry frames** — every report replayed
the whole range through the middleware API. (b) Reports consumed per-day rollups only past the
retention boundary. (c) Dispatching History shipped the full 30 s series to the browser.

**FIXED.**
- Gronau frames backfilled (2026-05-15 → today) and rolled up nightly like the other stations.
- Both reports are **rollup-first**: closed UTC days come from `station_day_report` (made
  lossless and proven equal to raw within < 0,5 % — see below), only the open head/tail is
  replayed raw; closed raw chunks are memoised.
- Dispatching History is downsampled server-side to ≤ 2.000 points for ranges > 3 days; KPIs
  and totals are computed on the full data before downsampling and the caption says so.
- The nightly rollup cron now **pre-warms yesterday's report** for all stations, so the first
  load of the morning is already fast.

Measured 2 Sep 2026 (server action, Gronau): August **194 ms cold / 105 ms warm**; last 30 days
**128 ms**; Berlin-local yesterday **275 ms cold / 74 ms warm** (Gifhorn 5,1 s cold → 109 ms warm —
the case the pre-warm covers). In the browser the 30-day Dispatching History renders in ~2 s
including the chart.

Side finding fixed on the way: the rollup stitch was **lossy** (no counterfactual, no wear, no
session count → "Dynamic no-dispatch" = 0 on rolled days) and **not raw-equivalent** (3 % energy
drift, wrong coverage). Rollups now store the full per-day result and a verification script
gates rollup-vs-raw at < 0,5 % per station-month.

---

## Usability 2 — one terminology across site, fleet monthly, fleet yearly (Annex is the basis)

**FIXED.** `lib/report-definitions.ts` is the single source of every term (label, Annex section,
definition, formula). It drives the KPI/column tooltips on Financial, Dispatching History, Fleet
Monthly, Fleet Yearly and Price Analysis, the **Definitions sheet in every Excel export**, and
the Settlement Methodology (Annex) page itself, so a term cannot drift between surfaces. Every
tooltip deep-links to its Annex section (33 anchors).

Two SOC figures remain on purpose because they answer different questions and both are defined:
**pack SOC** (mean of B1 + B2, what the optimiser steers) and **measured battery SOC** (extreme of
either battery). On 8 Aug 2026 B2 sat at 3 % while B1 was at 95 %.

---

## Usability 3 — identical export CTA on every page

**FIXED.** One shared `ExportExcelButton` ("Export Excel", same icon, size and top-right
placement) on Financial, Dispatching History (export added — it had none), Fleet Monthly (live
and hist), Fleet Yearly, Price Analysis and Fleet Projection.

---

## Usability 4 — identical period selection on every page

**FIXED.** Day-grain reports (Financial, Dispatching History) share `ReportRangePicker` with the
same presets (Yesterday / 7 / 14 / 30 days / This month / Last month) and the same **Run**
behaviour; month-grain reports (Fleet Monthly live/hist, Price Analysis, Fleet Projection) share
`ReportMonthPicker`; Fleet Yearly uses its from–to variant. Default is the last closed period
everywhere and the selected period is always printed in the header.

Fixed while verifying: a range ending exactly at UTC midnight produced an empty raw tail whose
API error was merged **over** a full day of valid rollups ("No telemetry · Invalid live-frame
range"). Zero-length chunks are now skipped.

---

## Open for the reporting deep-dive call

1. **Portfolio comparison window** — compare each station over its *measured* months only, or
   keep archive months with provenance flags (current)?
2. **Archive sessions** — keep the ≈ estimate (5 kW rising edges) or drop the sessions column
   for archive months entirely?
3. **Calendar convention** — fleet tables are UTC-day based, site reports Berlin-local; the
   difference is ≤ 1 kWh/month on Gronau but the Annex should name one.
