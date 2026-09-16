"""
Portfolio history aggregation — 56 Chargepost location CSVs (1-min cadence)
→ compact per-station daily metrics + hour-of-day profiles, joined with
historical DE-LU day-ahead prices (Energy-Charts, EUR/MWh, UTC).

Run:  uv run --with pandas python scripts/portfolio/aggregate_portfolio.py
Expects the extracted CSVs in /tmp/portfolio_data and price JSONs
(/tmp/prices_2023.json … 2026) fetched from Energy-Charts.

Sign conventions (verified on Gronau sample):
  grid_power_w   < 0  → import from grid;  > 0 → export
  battery_power_w > 0 → discharging (boosting EV); < 0 → charging
  loading_point_*_power_w ≥ 0 → EV charging power

Outputs (CSV, small enough for Neon):
  /tmp/out/stations.csv         — one row per location (identity + lifetime totals)
  /tmp/out/daily.csv            — per station per UTC day
  /tmp/out/hourly_profile.csv   — per station per hour-of-day (lifetime avg)
"""

import json
import os
import re

import pandas as pd

SRC = "/tmp/portfolio_data"
OUT = "/tmp/out"
os.makedirs(OUT, exist_ok=True)

# ── Historical hourly prices (UTC) ──────────────────────────────────────────
frames = []
for y in (2023, 2024, 2025, 2026):
    d = json.load(open(f"/tmp/prices_{y}.json"))
    frames.append(
        pd.DataFrame(
            {
                "ts": pd.to_datetime(d["unix_seconds"], unit="s", utc=True),
                "price": d["price"],
            }
        )
    )
prices = pd.concat(frames).drop_duplicates("ts").sort_values("ts").set_index("ts")
# Energy-Charts switches to 15-min slots in 2025 — resample everything to hourly
prices_h = prices.resample("1h").mean().dropna()
print(f"prices: {len(prices_h)} hourly rows {prices_h.index.min()} → {prices_h.index.max()}")


# ── Filename → identity ─────────────────────────────────────────────────────
def parse_name(fn: str):
    m = re.match(r"Amperio_(.+)_Germany_(\d{5})_(.+)_CCR_(AX\d+)\.csv$", fn)
    brand, zipc, rest, asset = m.group(1), m.group(2), m.group(3), m.group(4)
    parts = rest.split("_")
    city = parts[0]
    address = " ".join(parts[1:]) if len(parts) > 1 else ""
    return brand.replace("_", " "), zipc, city.replace("_", " "), address, asset


station_rows, daily_rows, profile_rows = [], [], []

# Stations that must NEVER enter the portfolio (client feedback 20 aug 2026):
# included in the archive dump by mistake, not under the client's control.
#   hist_AX10091539 — Kia Academy Kronberg
#   hist_AX10092909 — Scheibling Immobilien Ratingen
EXCLUDED_STATION_IDS = {"hist_AX10091539", "hist_AX10092909"}

for fn in sorted(os.listdir(SRC)):
    if not fn.endswith(".csv"):
        continue
    brand, zipc, city, address, asset = parse_name(fn)
    sid = f"hist_{asset}"
    if sid in EXCLUDED_STATION_IDS:
        print(f"SKIP (excluded by client): {sid} ({fn})")
        continue

    df = pd.read_csv(os.path.join(SRC, fn), parse_dates=["timestamp"])
    df["ts"] = df["timestamp"].dt.tz_localize("UTC")
    df = df.set_index("ts").sort_index()

    grid = df["string_1_grid_power_w"].fillna(0) + df["string_2_grid_power_w"].fillna(0)
    batt = df["string_1_battery_power_w"].fillna(0) + df["string_2_battery_power_w"].fillna(0)
    ev = df["loading_point_1_power_w"].clip(lower=0).fillna(0) + df[
        "loading_point_2_power_w"
    ].clip(lower=0).fillna(0)
    soc1 = df["battery_string_1_soc_percent"]
    soc2 = df["battery_string_2_soc_percent"]

    # 1-min samples → kWh per hour: mean power (W) × 1h / 1000, weighted by coverage
    h = pd.DataFrame(
        {
            "import_w": (-grid).clip(lower=0),
            "export_w": grid.clip(lower=0),
            "ev_w": ev,
            "chg_w": (-batt).clip(lower=0),
            "dis_w": batt.clip(lower=0),
            "soc_min": pd.concat([soc1, soc2], axis=1).min(axis=1),
            "soc_avg": (soc1 + soc2) / 2,
            "n": 1,
        }
    ).resample("1h").agg(
        {
            "import_w": "mean",
            "export_w": "mean",
            "ev_w": "mean",
            "chg_w": "mean",
            "dis_w": "mean",
            "soc_min": "min",
            "soc_avg": "mean",
            "n": "sum",
        }
    )
    h = h[h["n"] > 0]
    h["coverage"] = (h["n"] / 60).clip(upper=1)
    for c in ("import_w", "export_w", "ev_w", "chg_w", "dis_w"):
        h[c.replace("_w", "_kwh")] = h[c] / 1000 * h["coverage"]

    h = h.join(prices_h, how="left")
    h["cost_eur"] = h["import_kwh"] * h["price"] / 1000

    # EV session count: rising edges of combined EV power above 5 kW (per-day)
    ev_on = (ev > 5000).astype(int)
    sessions_per_day = (
        (ev_on.diff() == 1).groupby(ev_on.index.floor("D")).sum().rename("sessions")
    )

    d = h.groupby(h.index.floor("D")).agg(
        import_kwh=("import_kwh", "sum"),
        export_kwh=("export_kwh", "sum"),
        ev_kwh=("ev_kwh", "sum"),
        batt_charge_kwh=("chg_kwh", "sum"),
        batt_discharge_kwh=("dis_kwh", "sum"),
        soc_min=("soc_min", "min"),
        soc_avg=("soc_avg", "mean"),
        cost_eur=("cost_eur", "sum"),
        avg_price=("price", "mean"),
        hours=("n", "count"),
        coverage=("coverage", "mean"),
    )
    # import-weighted price + counterfactual cost at flat daily average price
    wp = h.groupby(h.index.floor("D")).apply(
        lambda g: (g["price"] * g["import_kwh"]).sum() / g["import_kwh"].sum()
        if g["import_kwh"].sum() > 0
        else float("nan"),
        include_groups=False,
    )
    d["import_wavg_price"] = wp
    d["cost_at_avg_eur"] = d["import_kwh"] * d["avg_price"] / 1000
    d["price_savings_eur"] = d["cost_at_avg_eur"] - d["cost_eur"]
    d = d.join(sessions_per_day, how="left")
    d["sessions"] = d["sessions"].fillna(0).astype(int)
    d["peak_ev_kw"] = (ev.resample("1D").max() / 1000).round(1)
    d["peak_import_kw"] = ((-grid).clip(lower=0).resample("1D").max() / 1000).round(1)
    d = d[d["hours"] > 0]

    for day, r in d.iterrows():
        daily_rows.append(
            {
                "station_id": sid,
                "day": day.date().isoformat(),
                "import_kwh": round(r.import_kwh, 2),
                "export_kwh": round(r.export_kwh, 2),
                "ev_kwh": round(r.ev_kwh, 2),
                "batt_charge_kwh": round(r.batt_charge_kwh, 2),
                "batt_discharge_kwh": round(r.batt_discharge_kwh, 2),
                "soc_min": None if pd.isna(r.soc_min) else round(r.soc_min, 1),
                "soc_avg": None if pd.isna(r.soc_avg) else round(r.soc_avg, 1),
                "avg_price": None if pd.isna(r.avg_price) else round(r.avg_price, 2),
                "import_wavg_price": None
                if pd.isna(r.import_wavg_price)
                else round(r.import_wavg_price, 2),
                "cost_eur": None if pd.isna(r.cost_eur) else round(r.cost_eur, 2),
                "price_savings_eur": None
                if pd.isna(r.price_savings_eur)
                else round(r.price_savings_eur, 2),
                "sessions": int(r.sessions),
                "peak_ev_kw": None if pd.isna(r.peak_ev_kw) else r.peak_ev_kw,
                "peak_import_kw": None if pd.isna(r.peak_import_kw) else r.peak_import_kw,
                "coverage_pct": round(100 * r.coverage, 1),
            }
        )

    # Hour-of-day lifetime profile
    hod = h.groupby(h.index.hour).agg(
        import_kw=("import_w", lambda s: s.mean() / 1000),
        ev_kw=("ev_w", lambda s: s.mean() / 1000),
        charge_kw=("chg_w", lambda s: s.mean() / 1000),
        discharge_kw=("dis_w", lambda s: s.mean() / 1000),
        price=("price", "mean"),
    )
    for hr, r in hod.iterrows():
        profile_rows.append(
            {
                "station_id": sid,
                "hour": int(hr),
                "import_kw": round(r.import_kw, 3),
                "ev_kw": round(r.ev_kw, 3),
                "charge_kw": round(r.charge_kw, 3),
                "discharge_kw": round(r.discharge_kw, 3),
                "avg_price": None if pd.isna(r.price) else round(r.price, 2),
            }
        )

    total_ev = d["ev_kwh"].sum()
    span_days = (df.index.max() - df.index.min()).days or 1
    station_rows.append(
        {
            "station_id": sid,
            "asset_id": asset,
            "brand": brand,
            "city": city,
            "zip": zipc,
            "address": address,
            "first_ts": df.index.min().isoformat(),
            "last_ts": df.index.max().isoformat(),
            "days_of_data": int(d.shape[0]),
            "span_days": int(span_days),
            "total_import_kwh": round(d["import_kwh"].sum(), 1),
            "total_ev_kwh": round(total_ev, 1),
            "total_charge_kwh": round(d["batt_charge_kwh"].sum(), 1),
            "total_discharge_kwh": round(d["batt_discharge_kwh"].sum(), 1),
            "total_cost_eur": round(d["cost_eur"].sum(), 2),
            "total_price_savings_eur": round(d["price_savings_eur"].sum(), 2),
            "total_sessions": int(d["sessions"].sum()),
            "avg_daily_ev_kwh": round(total_ev / max(d.shape[0], 1), 2),
            "utilization_pct": round(100 * d.shape[0] / span_days, 1),
        }
    )
    print(
        f"{sid} {brand[:18]:18s} {city[:16]:16s} days={d.shape[0]:5d} "
        f"ev={total_ev/1000:8.1f} MWh sessions={int(d['sessions'].sum()):6d}"
    )

pd.DataFrame(station_rows).to_csv(f"{OUT}/stations.csv", index=False)
pd.DataFrame(daily_rows).to_csv(f"{OUT}/daily.csv", index=False)
pd.DataFrame(profile_rows).to_csv(f"{OUT}/hourly_profile.csv", index=False)
print("\nstations:", len(station_rows), "| daily:", len(daily_rows), "| profile:", len(profile_rows))
