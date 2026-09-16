# Incident Report — Gronau Defect Review

**Date:** 2026-09-03
**Scope:** Data-consistency and usability defects raised on the Gronau portfolio review (PDF "Gronau defects", reported by Timon + NITES review).
**Methodology version at close:** `2026-09-03.3`
**Reporting window covered:** commits from 2026-09-02 13:58 through 2026-09-03 (D5 closed in the evening follow-up).

This report maps each reported defect to its root cause, the change that fixed it (with the actual commit and methodology-version entry), and the verification evidence pulled from the live database on 2026-09-03.

---

## Status summary

| # | Defect | Priority | Status | Fixed in |
|---|--------|----------|--------|----------|
| D1 | `hist_AX10095481` shows 15 months, synthetic sessions labelled "measured", low LS gain | PRIO 1 | **Resolved** (+ sessions re-derived 09-04) | `2026-09-02.2` + `320a997`, `345b9c2`; `import-ccr-sessions.ts` |
| D2 | Live Dispatching: EV demand > 0 with no charging sessions | — | **Resolved** | `2026-09-02.1` (ONE EV definition) |
| D3 | Dispatching History vs Fleet Monthly: grid import / EV delivered mismatch (July) | — | **Resolved** | `2026-09-02.1` (`ev_delivered_kwh`/`aux_kwh` split) |
| D5 | Import − EV delivered gap: AUX mislabelled as "hotel load"; Norderstedt `EV + AUX > import` by 374 kWh | follow-up | **Resolved** — AUX is the energy-balance residual, Battery net is a column, every row closes; coverage badges added | `2026-09-03.3` |
| U1 | Long report execution (site financial + dispatching history) | before prod | **Resolved** | `6a23013`, `db05034`, `345b9c2` |
| U2 | Terminology not unified across site / fleet monthly / fleet yearly (Annex is the basis) | before prod | **Resolved** | `3c9a5f5`, `f36b41f`, `report-definitions.ts` |
| U3 | Export CTA not identical across pages | before prod | **Resolved** | `b2f7112` (`ExportExcelButton`) |
| U4 | Report-period selection not identical across pages | before prod | **Resolved** | `c8b09d8`, `6693102`, `ReportPeriodHeader` |

All **data** defects, including the D5 balance violation, are fixed and verified against live data. The remaining items are **caveats**, not open bugs — see "Known limitations".

---

## D1 — PRIO 1: `hist_AX10095481` (Gronau archive) 15 months / mislabelled sessions

**Reported:** "Why is there a time span of 15 months in Gronau, when the station was only set up in December 2025? ... Load-shift gain is very low compared to the shifted kWh, and it says the contains are measured, but charging sessions and kWh numbers aren't real numbers."

**Root cause.** The History Analysis (`hist_*`) dataset is a one-time pre-system CSV export (CCR files, power + SoC columns only — **no charge-event records**). Three separate problems compounded:

1. **Synthetic months were persisted and summed** as if they were history. Where the archive had no real figure for a month, a seasonal/recent proxy was filled in, so Gronau showed 15 months instead of its true operating span.
2. **Pre-optimiser months were included.** Gronau's archive reaches back before the optimiser went live (Dec 2025); those months describe a plant running *without* Amperio, so they do not belong in a savings comparison.
3. **Sessions and a "contains measured" flag were shown** even though the export has no session records and the archive is not telemetry. Sessions had been estimated with a 5 kW rising-edge heuristic that was −12% … +70% off where it could be checked.

**Fix.** `lib/hist-provenance.ts` is now the single decision point for archive provenance (methodology `2026-09-02.2`):

- Only `volumeSource ∈ {month, measured}` with `importKwh > 0` produces a report row — synthesized (`seasonal`/`recent`) and zero months are dropped at the builder (`isReportableArchiveMonth`).
- `OPTIMISER_LIVE_FROM["hist_AX10095481"] = "2025-12"` gates out pre-optimiser months (`isBeforeOptimiserGoLive`).
- Archive `sessions` are persisted as `NULL` and reported as **n/a** until re-derived from the source export's per-connector counters (`reportableSessions`, `hasRealSessions`).
- The "contains measured" flag and the Gronau measured-anchor + 0.968 capture-rate scaling were removed (`345b9c2`, `320a997`) — History Analysis now contains **no** telemetry.

**Verification (live DB, 2026-09-03).**
```
hist_AX10095481 months in fleet_month_report: 8  ->  2025-12 … 2026-07
any measured=true: false     sessions non-null: 0
```
The 15-month span is gone (now Dec 2025 → Jul 2026 = 8 months, the true operating window), no row claims "measured", and no archive row reports a session count.

**Follow-up (2026-09-04) — archive sessions re-derived, "n/a" lifted per station.**

The "no charge-event records" statement above was correct but incomplete: the CCR export *does* carry a real per-connector power meter (`loading_point_1_power_w`, `loading_point_2_power_w`; 17 000 distinct non-zero values on Gronau, i.e. a measurement, not a state flag). The one-time fleet import (`scripts/portfolio/aggregate_portfolio.py`) summed the two connectors, resampled to hourly and discarded the minute data — that is why sessions could not be recovered from the database and the client's per-station CSVs have to be re-read.

*Method.* `lib/ccr-sessions.ts` derives sessions as **per-connector power islands** with exactly the live path's filters (`deriveSessionsFromRows`): connector > 500 W is "charging", idle gaps ≤ 8 min are bridged, a session needs ≥ 2 frames and > 0.1 kWh. Energy is ∫ power dt (frame dt capped at 5 min). Stamped `sessions_basis = lp-power-islands-v1`; live rows are stamped `counters`. `lib/hist-provenance.sessionsBasisOf` is the single gate — a row without a basis is still n/a, and the 5 kW estimate is still never shown.

*Pipeline.* `scripts/portfolio/import-ccr-sessions.ts <csv|zip|dir|url|manifest>` → `portfolio_session` (one row per session) + `portfolio_session_import` (per-station span) → `refill-live-fleet-months.ts --hist` → `fleet_month_report.sessions`. Idempotent per station (replaces the imported span). No euro or volume column changes, so **no methodology bump**.

*Verification on the Gronau export (377 644 frames, 5 Nov 2025 → 31 Jul 2026).*

| | Import estimate (5 kW combined edge) | Re-derived (per-connector islands) | Live Aug 2026 (counters) |
|---|---|---|---|
| Sessions | 974 | **1 035** (Jul: 146) | Aug: 155 |
| kWh / session | — | 31.6 (Jul) | 33.3 |
| Median duration | — | 26 min | 25 min |
| Connector energy captured | — | 100.0 % | — |
| Sensitivity | — | 300 / 500 / 1 000 W → 1 035 / 1 035 / 1 035 | — |

The estimate's error was mixed-sign (Jan +6, Apr −14), the overlap/taper signature — not a fixable offset. Yearly report after refill: Gronau Dec 2025 → Jul 2026 = 126 / 121 / 91 / 100 / 131 / 134 / 108 / 146.

*Fleet import (2026-09-04, `historical_data_chargepost.7z`, 56 CCR files, 2.7 GB).* All 54 stations in `portfolio_station` imported — **92 874 sessions**, 7 Dec 2022 → 31 Jul 2026, connector-energy capture 99.8–100 % on every station (37 × 100.0 %, 18 × 99.9 %, 1 × 99.8 %). After the hist refill all **709 archive station-months carry a session count** (`sessions_basis = lp-power-islands-v1`, 0 × n/a); monthly fleet totals 2 921 (Jun 2025) → 6 075 (Jan 2026). Two files in the archive (`AX10091539`, `AX10092909`) belong to stations that were not part of the original fleet import and were skipped — they have no month rows to attach to. `verify-fleet-vs-financial` still PASS (Δ 0.0000 €), single methodology stamp `2026-09-03.3` on all 721 rows.

---

## D2 — Live Dispatching: EV demand > 0 with no charging sessions

**Reported:** Gronau, Live Dispatching, 2026-09-02 09:54 — "No charging sessions on the charging-sessions chart, EV demand > 0 shown in multiple data points from the beginning of the day."

**Root cause.** The chart's EV series used `p.evKw`, the kernel's power-balance demand signal `max(0, battery − grid)`. That signal is the **whole AC-bus load**, so it includes the ChargePost's own consumption (standby, cooling, conversion losses — see D5 below). With no car plugged in it still reads a few hundred watts to a few kW — producing "EV demand > 0, 0 sessions".

**Fix (methodology `2026-09-02.1`, "ONE EV definition").** In `components/lab/dispatching-overview.tsx` the EV series is now the **metered per-connector power** (`mEv1Kw + mEv2Kw`, cumulative-counter deltas that are exactly 0 outside a session). The residual `site load − metered EV` is drawn separately as **AUX**. Only for foreign hardware that carries no connector counters does the view fall back to the reconstruction, and then it is labelled "Site load", never "EV". This is the same definition now used everywhere (see D3).

**Verification.** EV delivered is derived from connector counters that only tick during a plug-in session, so EV > 0 and "0 sessions" can no longer co-occur; AUX baseload renders on its own series.

---

## D3 — Dispatching History vs Fleet Monthly: energy mismatch (July 2026)

**Reported:** "Energy values do not match (grid import, EV delivered) in reports for July 2026."

**Root cause.** The two reports used **different definitions of "EV"**. Dispatching History showed metered EV delivered (C1 + C2 counter energy), while Fleet Monthly showed `ev_kwh` — the legacy site-load figure (the same AUX-absorbing power-balance reconstruction as D2). Because AUX is a large share of Gronau's load, the two "EV" numbers differed by exactly the AUX energy.

**Fix (methodology `2026-09-02.1`).** `fleet_month_report` gained two columns (`lib/db/schema.ts`, comment cites "Gronau defect 3"):

- `ev_delivered_kwh` — metered C1 + C2, the **same** definition as the site Financial KPI, the Annex, and Dispatching History (`bt.totals.mEv1Kwh + mEv2Kwh`, builder line ~360).
- `aux_kwh` — site load − metered EV (the non-dispatchable ChargePost draw).
- `ev_kwh` is retained only as the legacy site-load figure for archive rows that have no counters, and is **never labelled "EV"** in a report.

Both the Fleet Monthly and Fleet Yearly screens now display `evDeliveredKwh` / `auxKwh`, so every surface agrees.

**Verification (live DB, 2026-09-03) — Gronau, all live months:**
```
chargepost_gronau_001  2026-07  import 6161  evDelivered 4830  aux 1334  sessions 151
chargepost_gronau_001  2026-08  import 6631  evDelivered 5163  aux 1405  sessions 155
```
EV delivered (4830 kWh for July) is now the identical metered quantity Dispatching History reports for the same window; grid import (6161 kWh) comes from the one lossless frozen daily rollup both paths read. `evDelivered + aux ≈ ev_kwh` (legacy), confirming the split is a clean decomposition, not a new number.

> Reconciliation guarantee: Fleet Yearly = Σ Fleet Monthly = Site Financial Report, proven cent-identical by `scripts/verify-fleet-vs-financial.ts` (all station-months Δ 0.0000 €).

---

## D5 — Follow-up finding (2026-09-03): what "AUX" actually contains, and a balance violation

**Trigger.** Client review of D3: "grid import 6 161 vs EV delivered 4 830 — the difference still looks strange." Correct instinct. The earlier explanation ("about 0.9 kW of background consumption around the clock") was **wrong**: 0.9 kW × 744 h ≈ 670 kWh, yet AUX was 1 334 kWh.

**Method.** `scripts/diagnose-aux-residual.ts` decomposes the AUX bucket from raw `telemetry_frame` rows, independently of `lib/backtest.ts` (August 2026 — the month with full raw-frame retention).

**Finding 1 — AUX is a residual, not a meter, and it is mostly conversion loss.** In the engine, `AUX = Σ max(0, siteLoad − meteredEV)` per frame. Measured composition, Gronau Aug 2026 (1 405 kWh frozen):

| Component | kWh | How measured |
|---|---|---|
| True standby (both connectors idle, battery resting, **median**) | ~171 | **0.23 kW** — matches the engine's own comment "~0.2 kW" |
| Residual while the battery cycles with no car | ~462 | 3.17 kW avg over 146 h — rectifier + DC/DC loss while charging the pack |
| Residual during EV charging | ~730 | ~11 kW avg — charger-stage conversion loss + thermal management under load |
| Per-frame clamp rectification bias | +38 | `max(0,·)` keeps positive meter/proxy misalignment, drops negative |

Gifhorn (0.27 kW standby, 558 kWh AUX) and Norderstedt (0.52 kW standby, 1 860 kWh AUX) show the same shape. **AUX scales with throughput (≈20–25% of EV delivered); it is not a flat background load.** The glossary label was changed from "AUX (hotel load)" to "AUX (ChargePost self-consumption)" and the definition rewritten (`lib/report-definitions.ts`). No euro depends on `aux_kwh` (it is a display volume; `tariff-compute`/`settlement` do not read it).

**Finding 2 — RESOLVED in `2026-09-03.3` (see "Fix applied" below): Norderstedt frozen `EV + AUX` exceeded `Grid import` by 374.5 kWh (Aug 2026), which is physically impossible.** Decomposition of the excess: battery net discharge 151.8 (meter reads more discharge than charge while SOC fell only 8 pp) + 119.7 kWh of frames where the grid and battery meters were sampled out of step so `battery − grid < 0` was clamped to 0 + 102.7 kWh rectification bias ≈ 374. Gronau shows the same artefacts at smaller magnitude (−63 kWh, hidden because its battery net is positive). The engine's per-frame clamped AUX therefore **does not satisfy the glossary formula** `AUX = GridImport − EVdelivered − BatteryCharge + BatteryDischarge`.

**Fix applied (methodology `2026-09-03.3`, 2026-09-03 evening).** `aux_kwh` is now the *energy-level* balance residual per settled day — `AUX = GridImport − Export − EVdelivered − BatteryNet` (glossary A7.2, no per-frame clamp) — and `battery net (charge − discharge)` is persisted as its own column (`station_day_report.batt_net_kwh`, `fleet_month_report.batt_net_kwh`) and shown on Fleet Monthly, Fleet Yearly and the Excel export. Every closed day Jul 30 → Sep 2 was re-frozen from raw frames (`backfill-rollups.ts --force`), the month rows refilled, and the Fleet-vs-Financial reconciliation re-run (**PASS**, 7 station-months, worst Δ 0.0000 €).

**Verification (live DB, after re-freeze).** `Grid import − EV delivered − AUX − Battery net` per month row:

| Station | Month | Import | EV delivered | AUX (old clamp → balance) | Battery net | Gap |
|---|---|---|---|---|---|---|
| Gronau | Aug 2026 | 6 631 | 5 163 | 1 405 → **1 314** | +155 | −0.4 kWh |
| Norderstedt | Aug 2026 | 4 618 | 3 133 | 1 860 → **1 637** | −152 | −0.3 kWh |
| Gifhorn | Aug 2026 | 3 320 | 2 749 | 558 → **548** | +24 | −0.3 kWh |
| all three | Sep 1–3 2026 | — | — | — | — | ≤ 0.1 kWh |

The 374 kWh Norderstedt violation is gone; every row closes to rounding. **No euro moved** (net €, LS €, no-LS € identical to `2026-09-03.2` on every row) — the change is to a displayed volume only, as predicted. June/July rows keep the old clamped AUX and show Battery net as "—" (no raw frames to re-freeze; a partial sum is never shown).

Two things surfaced by the fix: (a) a residual-vs-metered-import **physics gate** was added to the counterfactual and measured **inert** (0.0 kWh gated on every site — the phantom frames are already zeroed by the power-balance `max(0,·)`), so the hypothesised "~€40/month Norderstedt LS overstatement" is **disproven**; (b) the replay memo key (`lib/replay-memo.ts`) did not include the methodology version, so the Berlin head/tail hours of each month were served from week-old cached chunks — now keyed by `METHODOLOGY_VERSION`.

**Coverage is now visible.** Each measured row carries `covered_days` / `data_from` / `data_through`; Fleet Monthly and Fleet Yearly show an amber "n/m days" badge next to any partial window (Gifhorn Aug **12/31**, commissioned 20 Aug; Norderstedt Aug **25/31**, 165 h outage 24–31 Aug). Volumes and euros cover measured days only and are never scaled up. The denominator is the *settled* window (a running month is clipped at yesterday), so a fully covered current month stays quiet.

---

## Usability defects

**U1 — Long report execution (financial + dispatching history).**
Server-side chart downsampling (`6a23013`), backtest result caching (`db05034`), and a report pre-warm step (`345b9c2`) were added; the UTC/Berlin day is now an atomic, lossless frozen rollup so closed days are read as scalars instead of replayed frame-by-frame.

**U2 — Unified terminology (Annex is the basis).**
`lib/report-definitions.ts` is the single glossary; report tables and Excel headers use Annex term labels (`3c9a5f5`), and every workbook ships a shared Definitions sheet (`f36b41f`). The same term key (e.g. `gridImport`, `evDelivered`, `aux`, `siteLoad`) drives site, fleet-monthly and fleet-yearly.

**U3 — Identical export CTA.**
All ad-hoc download buttons were replaced by the shared `ExportExcelButton` (`b2f7112`), so the export affordance is identical on every report page.

**U4 — Identical report-period selection.**
The shared `ReportPeriodHeader` / `ReportRangePicker` (fleet yearly bounds `c8b09d8`, dispatching history `6693102`) gives every page the same picker, presets, and bounds — capped at the last closed day and floored at the first reportable month.

---

## Methodology version history (settlement math)

| Version | Change |
|---------|--------|
| `2026-08-31.1` | NITES audit — measured rows use one volume basis (Flat € ÷ Import kWh = exact flat rate); anchor gate rejects collapsed counterfactuals; audit fields persisted. |
| `2026-09-02.1` | Gronau defects — UTC day as atomic lossless replay unit; MPC sees published D+1 curve past window end; **ONE EV definition** (`ev_delivered_kwh` + `aux_kwh`; `ev_kwh` legacy, never labelled EV). Fixes **D2, D3**. |
| `2026-09-02.2` | History Analysis is archive-only — measured anchor + 0.968 capture scaling removed; archive sessions = NULL (n/a). Fixes **D1**. |
| `2026-09-03.1` | Grid-first counterfactual can no longer import above the physical grid cap (recharge cell energy capped at headroom × dt × EFF). |
| `2026-09-03.2` | Baseline peak-shaves against each site's real measured grid-import wall (p99.9), not the flat operator override — corrects previously overstated "extra wear from load shifting" (Norderstedt). |
| `2026-09-03.3` | AUX = energy-balance residual per settled day (A7.2); `batt_net_kwh` persisted so Import = EV + AUX + Battery net closes on every row; coverage columns (`covered_days`, `data_from`, `data_through`); physics gate on the counterfactual residual (measured inert); replay memo keyed by methodology. Displayed volumes only — no euro moved. Fixes **D5**. Current. |

---

## Known limitations (caveats, not open defects)

1. **May 2026 excluded fleet-wide.** May has no retained raw frames, so its daily rollups carry a stale counterfactual; reports now start **June 2026** (`LIVE_FLEET_FIRST_MONTH = 2026-06`). Reversible if frames are restored.
2. **Raw-frame retention is ~Jul 30 → Sep 2.** A settlement-math change only re-applies to days whose raw frames still exist (re-frozen via `scripts/backfill-rollups.ts --force`). Earlier daily rollups keep the math they were frozen with.
3. **Archive (`hist_*`) session counts are derived, not recorded.** The CCR export has no session records; counts are per-connector power islands (D1 follow-up) and are threshold-insensitive on every station checked. A station whose export has not been imported shows n/a rather than an estimate — as of 2026-09-04 that applies to none of the 54 reporting stations.
4. **Today is never priced.** Running months/reports clip at the last closed day (yesterday), so a partial current day never appears in settlement figures.
5. **Upstream telemetry quality is outside our control.** Seven source-data issues found during this incident — `p_ev_w` stuck at 0 at all sites, the 165 h Norderstedt outage (≈ 876 kWh unsettleable), the Norderstedt battery-meter inconsistency (927 impossible frames, −152 kWh net vs −8 pp SOC), per-site `e_ev_chg_kwh` semantics, sub-frame timestamp skew, unmetered ChargePost self-consumption (20–52 % of EV energy), and the Gronau June history gap — are documented with evidence and concrete asks in [`vendor-issue-report-2026-09-03-amperio-adstec.md`](./vendor-issue-report-2026-09-03-amperio-adstec.md). Until they are resolved, self-consumption remains a residual (it absorbs every other meter error) and Norderstedt August stays 25/31 days.

---

## How to re-verify

```bash
# Fleet vs Financial cent-reconciliation (all station-months)
pnpm exec tsx scripts/verify-fleet-vs-financial.ts

# Frozen volumes vs raw-frame recomputation (where frames exist)
pnpm exec tsx scripts/verify-volumes-from-frames.ts

# Yearly = Σ monthly, verified months only
pnpm exec tsx scripts/verify-fleet-yearly.ts
```
