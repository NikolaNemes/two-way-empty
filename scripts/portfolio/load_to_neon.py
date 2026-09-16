"""
Load aggregated portfolio history CSVs (/tmp/out) into Neon.

Run:
  set -a && source /vercel/share/.env.project && set +a && \
  uv run --with psycopg[binary] python scripts/portfolio/load_to_neon.py

Idempotent: truncates + reloads the three portfolio_* tables.
"""

import csv
import os

import psycopg

DDL = """
CREATE TABLE IF NOT EXISTS portfolio_station (
  station_id text PRIMARY KEY,
  asset_id text NOT NULL,
  brand text NOT NULL,
  city text NOT NULL,
  zip text NOT NULL,
  address text NOT NULL DEFAULT '',
  first_ts timestamptz NOT NULL,
  last_ts timestamptz NOT NULL,
  days_of_data integer NOT NULL,
  span_days integer NOT NULL,
  total_import_kwh double precision NOT NULL,
  total_ev_kwh double precision NOT NULL,
  total_charge_kwh double precision NOT NULL,
  total_discharge_kwh double precision NOT NULL,
  total_cost_eur double precision NOT NULL,
  total_price_savings_eur double precision NOT NULL,
  total_sessions integer NOT NULL,
  avg_daily_ev_kwh double precision NOT NULL,
  utilization_pct double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portfolio_daily (
  station_id text NOT NULL,
  day date NOT NULL,
  import_kwh double precision NOT NULL DEFAULT 0,
  export_kwh double precision NOT NULL DEFAULT 0,
  ev_kwh double precision NOT NULL DEFAULT 0,
  batt_charge_kwh double precision NOT NULL DEFAULT 0,
  batt_discharge_kwh double precision NOT NULL DEFAULT 0,
  soc_min double precision,
  soc_avg double precision,
  avg_price double precision,
  import_wavg_price double precision,
  cost_eur double precision,
  price_savings_eur double precision,
  sessions integer NOT NULL DEFAULT 0,
  peak_ev_kw double precision,
  peak_import_kw double precision,
  coverage_pct double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id, day)
);
CREATE INDEX IF NOT EXISTS portfolio_daily_day_idx ON portfolio_daily (day);
CREATE TABLE IF NOT EXISTS portfolio_hourly_profile (
  station_id text NOT NULL,
  hour integer NOT NULL,
  import_kw double precision NOT NULL DEFAULT 0,
  ev_kw double precision NOT NULL DEFAULT 0,
  charge_kw double precision NOT NULL DEFAULT 0,
  discharge_kw double precision NOT NULL DEFAULT 0,
  avg_price double precision,
  PRIMARY KEY (station_id, hour)
);
"""


def copy_csv(cur, table: str, path: str):
    with open(path) as f:
        reader = csv.reader(f)
        header = next(reader)
        cols = ", ".join(header)
        with cur.copy(f"COPY {table} ({cols}) FROM STDIN") as cp:
            for row in reader:
                cp.write_row([None if v == "" else v for v in row])


url = os.environ["DATABASE_URL_UNPOOLED"]
with psycopg.connect(url) as conn:
    with conn.cursor() as cur:
        cur.execute(DDL)
        cur.execute(
            "TRUNCATE portfolio_station, portfolio_daily, portfolio_hourly_profile"
        )
        copy_csv(cur, "portfolio_station", "/tmp/out/stations.csv")
        copy_csv(cur, "portfolio_daily", "/tmp/out/daily.csv")
        copy_csv(cur, "portfolio_hourly_profile", "/tmp/out/hourly_profile.csv")
    conn.commit()
    with conn.cursor() as cur:
        for t in ("portfolio_station", "portfolio_daily", "portfolio_hourly_profile"):
            cur.execute(f"SELECT count(*) FROM {t}")
            print(t, cur.fetchone()[0])
