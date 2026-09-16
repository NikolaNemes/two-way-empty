# Telemetry data-quality issues — ChargePost pilot sites (Gronau, Norderstedt, Gifhorn)

**To:** Amperio (middleware / `/telemetry/frames` API) · ADS-TEC (ChargePost firmware & meter registers)
**From:** Dispatch-optimizer operator
**Date:** 2026-09-03
**Evidence window:** 1–31 Aug 2026 (Berlin days), raw frames as delivered by the middleware and stored by us unchanged.
**Status:** draft for sending — every number below was re-measured today from the raw frames; nothing is estimated.

All settlement figures we publish are computed from the frames you deliver. The seven issues below either
(a) hide charged energy from every report, (b) force us to reconstruct quantities that a register should
provide, or (c) make one site's meters disagree with physics. Items are ordered by financial impact.
For each one: what we see, the exact evidence, what we do about it today, and what we need from you.

---

## T1 — Telemetry outages: frames stop, but the chargers keep charging (Amperio, priority 1)

**What we see.** Frames stop arriving for hours to days. When they resume, the per-connector energy
counters (`e_ev_chg_kwh`) have advanced — the ChargePost was charging cars the whole time — but no frame
carries that energy, so it appears in **no** report (neither as grid import nor as EV delivered).

| Site | Gap (Berlin) | Duration | Counter advance while blind |
|---|---|---|---|
| Norderstedt | 24.08 15:24 → 31.08 12:10 | **164.8 h** | connector 1: 1 425.0 → 1 717.2 kWh (+292.2); connector 2: 2 132.9 → 2 716.5 kWh (+583.6) → **875.8 kWh** |
| Gifhorn | 21.08 09:55 → 22.08 02:00 | 16.1 h | connector 2: 0.0 → 56.8 kWh (+56.8) |
| Gronau | 11.08 17:46 → 11.08 19:05 | 1.3 h | connector 1: 869.8 → 918.1 kWh (+48.3) |
| Norderstedt | 11.08 17:46 → 11.08 19:02 | 1.3 h | — |

The 11.08 17:46 gap hits **Gronau and Norderstedt at the same minute**, so that one is on the middleware
or its upstream, not at a site. Earlier instance: Gronau history in the API begins 2026-05-15 and has a
hole 3–7 Jun 2026.

**Impact.** Norderstedt August is settled on **25 of 31 days**; 876 kWh of charging (≈ 22 % of the
month's EV volume) is missing from import, EV delivered, and every € column. Frame cadence at
Norderstedt averages 39 s vs 30 s at Gronau for the same reason (2 231 vs 2 865 frames/day).

**What we do today.** Reports show a coverage badge ("25/31 days") and never scale partial months up.
Gaps are rendered as gaps in every chart.

**What we need.**
1. Root cause of the 24.08–31.08 Norderstedt loss and of the 11.08 17:46 fleet-wide loss.
2. **Store-and-forward**: buffer frames at the ChargePost/edge during connectivity loss and replay them
   with original timestamps when the link returns.
3. If (2) is not possible, a backfill endpoint that returns at least the per-connector energy counters
   and the grid-meter energy registers at 15-min resolution for a requested past window, so the missing
   days can be settled.

---

## T2 — `p_ev_w` (connector power) is 0 in 100 % of frames (ADS-TEC, priority 2)

**What we see.** The per-connector instantaneous power register is zero in every frame at every site,
including while the energy counter is visibly advancing.

| Site | Frames (Aug) | Frames with counter advancing | …of which `p_ev_w` = 0 | max `p_ev_w` ever seen |
|---|---|---|---|---|
| Gronau | 177 658 | 8 399 | 8 399 (**100 %**) | 0 |
| Norderstedt | 138 348 | 5 999 | 5 999 (**100 %**) | 0 |
| Gifhorn | 61 324 | 4 043 | 4 043 (**100 %**) | 0 |

**Impact.** We cannot read EV power. We reconstruct it two ways — from the site power balance
(`battery − grid`) for the dispatcher's live demand signal, and from `Δ e_ev_chg_kwh / Δt` for the
metered series — and the two disagree at every session ramp. The residual between them is what we have to
label "AUX (ChargePost self-consumption)" and it can only be closed at whole-day energy level, never per
frame.

**What we need.** Populate `p_ev_w` per connector (AC-side kW actually delivered), or tell us the register
is unsupported so we can stop parsing it.

---

## T3 — `e_ev_chg_kwh` has different semantics at different sites (ADS-TEC, priority 2)

**What we see.** The same field is a **lifetime-monotonic** register at one site and a **resetting**
(session or rolling) register at the other two.

| Site | Connector | Resets in Aug (drop > 1 kWh) | Counter range seen |
|---|---|---|---|
| Norderstedt | 1 / 2 | 0 / 0 | 224.3 → 1 717.2 / 255.0 → 2 770.7 (monotonic) |
| Gronau | 1 / 2 | 1 / 1 | 0.0 → 3 254.0 / 0.0 → 1 399.9 |
| Gifhorn | 1 / 2 | 4 / 3 | 0.0 → 766.7 / 0.0 → 582.2 |

**Impact.** A reset that happens *inside* a telemetry gap is indistinguishable from "no charging", and a
reset that lands between two frames loses the last partial increment. We handle both registers with
`max(0, Δ)`, which is correct only while frames are continuous.

**What we need.** One documented semantics for the field, ideally lifetime-monotonic on every unit
(a separate session register is welcome in addition). Please state which firmware versions differ.

---

## T4 — Norderstedt battery meter disagrees with the grid meter (ADS-TEC, priority 2)

**What we see.** At Norderstedt the battery reports **charging harder than the site is importing** — with
no PV on site this is impossible — in 927 frames (1.34 % of the month), up to 50 kW of excess, 120 kWh
in total. Over the month the same meter reports **152 kWh more discharge than charge** while the pack's
SOC only moved 94 % → 86 % (≈ −15 kWh at 190 kWh). A real battery with conversion losses must show
*net charge*, as the other two sites do.

| Site | Σ charge | Σ discharge | Net (charge − discharge) | Net as % of charge | ΔSOC | Frames batt-charge > import |
|---|---|---|---|---|---|---|
| Gronau | 2 598 | 2 466 | **+132 kWh** | +5.1 % (plausible losses) | +4.0 pp | 120 (0.14 %), 5 kWh |
| Gifhorn | 1 232 | 1 209 | **+23 kWh** | +1.9 % (plausible losses) | −4.5 pp | 13 (0.04 %), 1 kWh |
| Norderstedt | 1 598 | 1 750 | **−152 kWh** | **−9.5 % (impossible)** | −8.0 pp | **927 (1.34 %), 120 kWh** |

**Impact.** This is the single reason Norderstedt's "AUX" share is ~52 % of EV delivered vs 25 % at
Gronau and 20 % at Gifhorn: mis-metered battery energy lands in the residual. It does not move any €
today (the counterfactual ignores those frames), but it makes the site's energy split untrustworthy.

**What we need.** Check the Norderstedt battery meter for a sign/scaling error on the charge direction,
a calibration offset (≈ −9.5 % on charge energy fits), or a sampling misalignment between the battery
and grid meters. A comparison against the DSO meter for August would settle it.

---

## T5 — `p_ev_max_w` / `p_cp_max_w` are static handshake values, not live acceptance (ADS-TEC, priority 3)

**What we see** (audit of Jul 2026 sessions). The register stays flat at 250 kW for a whole session while
the delivered power tapers 169 → 106 kW as the car's SOC climbs 18 % → 54 % — a normal CC/CV curve.

**Impact.** We had to stop using it as "what the car would accept now"; a "served vs acceptance" KPI built
on it billed the car's own taper as missed delivery.

**What we need.** Confirm the semantics (contract maximum vs. live EVCC target), and if a live target /
requested-current value exists in the EVCC, expose it.

---

## T6 — Frame timestamp quality (Amperio, priority 3)

Not a defect today, but a request: frames carry no sequence number and no "sampled-at" vs "sent-at"
distinction, so during T1 replays (once implemented) and for T4 alignment checks we cannot tell a late
frame from a re-sent one. Please add a monotonically increasing sequence per unit and keep `ts` as the
sampling instant.

---

## T7 — ChargePost self-consumption is not metered (ADS-TEC, priority 3)

**What we see.** No register reports the unit's own consumption (power electronics, cooling, connector
standby, battery balancing). We can only derive it as whatever the grid meter imported that neither the
connector counters nor the battery meter explain. For August that residual is **1 314 kWh at Gronau
(25 % of EV delivered), 1 637 kWh at Norderstedt (52 %, inflated by T4) and 548 kWh at Gifhorn (20 %)**;
frame-level analysis puts true standby at 0.23–0.52 kW and the rest scaling with throughput (≈ 20–25 %
of EV energy), i.e. conversion loss and cooling.

**Impact.** This energy is real grid import the operator pays for, but on our reports it can only appear
as a residual that also absorbs every other meter error (T2–T4). We label it honestly as
"AUX (ChargePost self-consumption)" and close it at whole-day energy level; we cannot split it into
standby / conversion loss / cooling, and cannot verify the 20–25 % loss figure against a specification.

**What we need.** Either an auxiliary-consumption energy register (or separate DC-side battery and AC-side
EV meters, which lets us compute conversion losses directly), or the datasheet loss curve for the
ChargePost power stage and thermal system so the residual can be checked against an expected value.

---

## What we compensate for on our side (so you know what is *not* being asked)

- EV power is reconstructed from the power balance and from counter deltas (`max(0, Δ)` handles both
  register semantics of T3) — the raw `p_ev_w` is ignored.
- AUX is reported as the **whole-day energy balance** `import − export − EV delivered − battery net`, so
  every report row closes exactly; the per-frame residual is no longer shown.
- Telemetry gaps are rendered as gaps; months carry a coverage badge; partial months are never scaled.
- Frames where battery charge exceeds import are excluded from the settlement counterfactual by the
  power-balance clamp, so T4 affects displayed energy split only, not €.

## Contacts and follow-up

We can provide, per site and per day, the raw frame extracts behind every table above (timestamps in
UTC, unmodified JSON as received). Please reference the item number (T1–T7) in replies so we can track
closure; T1 and T4 need a target date, for the rest a semantics statement is enough to start.
