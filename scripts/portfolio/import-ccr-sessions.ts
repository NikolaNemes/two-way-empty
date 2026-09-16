/**
 * Import charging SESSIONS from the operator's CCR archive exports into
 * portfolio_session (History Analysis dataset — never the live/telemetry path).
 *
 * WHY: the one-time fleet import (aggregate_portfolio.py) materialised only
 * daily aggregates and summed LP1+LP2 before discarding the minute data, so the
 * per-connector information needed for sessions is not in the database. This
 * script re-reads the raw export and persists a proper session table, so no
 * further re-upload is needed for session questions.
 *
 * Usage (from the project root, env from /vercel/share/.env.project):
 *   pnpm exec tsx scripts/portfolio/import-ccr-sessions.ts [options] <input ...>
 *
 * <input> may be, in any mix:
 *   path/to/file.csv                one CCR export
 *   path/to/file.zip                zip containing one or more CCR CSVs
 *   path/to/file.7z                 7z (AES password via env CCR_ARCHIVE_PASSWORD;
 *                                   needs py7zr — see un7z) — nested zips/7z inside
 *                                   are expanded too
 *   path/to/dir                     every .csv / .zip / .7z inside (recursive)
 *   https://…/file.csv|.zip|.7z     downloaded to a temp dir first (must be a
 *                                   direct, unauthenticated URL — SharePoint
 *                                   "people in the organisation" links 403)
 *   --manifest list.txt             one path/URL per line (# comments allowed)
 *
 * Options:
 *   --dry-run     derive + print per-station summary, write nothing
 *   --refill      after writing, rebuild the hist_ fleet_month_report rows for
 *                 every month the imported sessions touch (fillFleetMonth —
 *                 pure archive simulation, no euro changes: sessions is a
 *                 display column). Without it, run
 *                 scripts/refill-live-fleet-months.ts --hist afterwards.
 *   --allow-unknown  import a station that is not in portfolio_station
 *                 (default: skip with a warning — keeps the two client-excluded
 *                 sites out).
 *
 * Idempotent: a station's sessions inside the file's [first, last] timestamp
 * span are replaced atomically; sessions outside the span are untouched.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { execFileSync } from "node:child_process"
import { Pool } from "pg"
import {
  CCR_SESSION_METHOD,
  CCR_SESSION_PARAMS,
  ccrColumnMap,
  ccrConnectorEnergyKwh,
  deriveCcrSessions,
  parseCcrLine,
  stationIdFromCcrFileName,
  type CcrFrame,
  type CcrSession,
} from "../../lib/ccr-sessions"

// ── DDL (idempotent). Raw SQL like the other portfolio_* tables, which were
//    created by the Python loader and live outside the Drizzle schema. ──────
const DDL = `
CREATE TABLE IF NOT EXISTS portfolio_session (
  station_id   text NOT NULL,
  connector    smallint NOT NULL,
  start_ts     timestamptz NOT NULL,
  end_ts       timestamptz NOT NULL,
  energy_kwh   double precision NOT NULL,
  peak_kw      double precision,
  avg_kw       double precision,
  frames       integer NOT NULL,
  method       text NOT NULL,
  source_file  text,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (station_id, connector, start_ts)
);
CREATE INDEX IF NOT EXISTS portfolio_session_station_start_idx ON portfolio_session (station_id, start_ts);
CREATE TABLE IF NOT EXISTS portfolio_session_import (
  station_id   text PRIMARY KEY,
  source_file  text NOT NULL,
  method       text NOT NULL,
  first_ts     timestamptz NOT NULL,
  last_ts      timestamptz NOT NULL,
  frames       integer NOT NULL,
  sessions     integer NOT NULL,
  energy_kwh   double precision NOT NULL,
  connector_kwh double precision NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now()
);
`

type Args = { inputs: string[]; dryRun: boolean; refill: boolean; allowUnknown: boolean }

function parseArgs(argv: string[]): Args {
  const a: Args = { inputs: [], dryRun: false, refill: false, allowUnknown: false }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === "--dry-run") a.dryRun = true
    else if (v === "--refill") a.refill = true
    else if (v === "--allow-unknown") a.allowUnknown = true
    else if (v === "--manifest") {
      const file = argv[++i]
      if (!file) throw new Error("--manifest needs a file")
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const t = line.trim()
        if (t && !t.startsWith("#")) a.inputs.push(t)
      }
    } else a.inputs.push(v)
  }
  return a
}

// ── Input expansion: URL → download, zip → extract, dir → walk ─────────────
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ccr-import-"))

async function download(url: string): Promise<string> {
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download")
  const dest = path.join(tmpRoot, name)
  console.log(`[v0] downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

function unzip(zipPath: string): string[] {
  const dir = path.join(tmpRoot, path.basename(zipPath, ".zip"))
  fs.mkdirSync(dir, { recursive: true })
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir])
  return walk(dir)
}

/**
 * 7z (optionally AES-encrypted) via py7zr — the sandbox has no 7z binary.
 * The password is read from CCR_ARCHIVE_PASSWORD and handed to Python through
 * the environment, never on a command line, so it cannot leak into shell
 * history or process listings. Install once: `python3 -m pip install --user
 * --break-system-packages py7zr`.
 */
function un7z(archivePath: string): string[] {
  const dir = path.join(tmpRoot, path.basename(archivePath, ".7z"))
  fs.mkdirSync(dir, { recursive: true })
  const py = [
    "import os, sys, py7zr",
    "pw = os.environ.get('CCR_ARCHIVE_PASSWORD') or None",
    "with py7zr.SevenZipFile(sys.argv[1], 'r', password=pw) as z:",
    "    z.extractall(sys.argv[2])",
  ].join("\n")
  try {
    execFileSync("python3", ["-c", py, archivePath, dir], { stdio: ["ignore", "inherit", "pipe"] })
  } catch (e) {
    const msg = String((e as { stderr?: Buffer }).stderr ?? e)
    if (/No module named 'py7zr'/.test(msg)) {
      throw new Error("py7zr missing — run: python3 -m pip install --user --break-system-packages py7zr")
    }
    if (/LZMAError|Bad7zFile|PasswordRequired|password/i.test(msg)) {
      throw new Error(`${path.basename(archivePath)}: cannot decrypt — set CCR_ARCHIVE_PASSWORD (wrong or missing password)`)
    }
    throw e
  }
  return walk(dir)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name.startsWith("__MACOSX")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.csv$/i.test(e.name)) out.push(p)
    else if (/\.zip$/i.test(e.name)) out.push(...unzip(p))
    else if (/\.7z$/i.test(e.name)) out.push(...un7z(p))
  }
  return out
}

async function expandInputs(inputs: string[]): Promise<string[]> {
  const csvs: string[] = []
  for (const raw of inputs) {
    let p = raw
    if (/^https?:\/\//i.test(raw)) p = await download(raw)
    if (!fs.existsSync(p)) throw new Error(`input not found: ${raw}`)
    const st = fs.statSync(p)
    if (st.isDirectory()) csvs.push(...walk(p))
    else if (/\.zip$/i.test(p)) csvs.push(...unzip(p))
    else if (/\.7z$/i.test(p)) csvs.push(...un7z(p))
    else if (/\.csv$/i.test(p)) csvs.push(p)
    else console.log(`[v0] skip (not csv/zip/7z): ${raw}`)
  }
  return [...new Set(csvs)]
}

// ── CSV → frames (streamed; a 377k-row export parses in ~2 s) ──────────────
async function readFrames(file: string): Promise<CcrFrame[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  let cols: ReturnType<typeof ccrColumnMap> | null = null
  const frames: CcrFrame[] = []
  for await (const line of rl) {
    if (!cols) {
      cols = ccrColumnMap(line.replace(/^\uFEFF/, "").split(","))
      continue
    }
    const f = parseCcrLine(line, cols)
    if (f) frames.push(f)
  }
  frames.sort((a, b) => a.tsMs - b.tsMs)
  return frames
}

type StationResult = {
  stationId: string
  file: string
  frames: number
  firstMs: number
  lastMs: number
  sessions: CcrSession[]
  connectorKwh: number
  months: string[]
}

const utcMonth = (ms: number) => new Date(ms).toISOString().slice(0, 7)

async function deriveFile(file: string): Promise<StationResult | null> {
  const stationId = stationIdFromCcrFileName(path.basename(file))
  if (!stationId) {
    console.log(`[v0] skip — no CCR_AX… asset in file name: ${path.basename(file)}`)
    return null
  }
  const t0 = Date.now()
  const frames = await readFrames(file)
  if (frames.length === 0) {
    console.log(`[v0] ${stationId}: empty file, skipped`)
    return null
  }
  const sessions = deriveCcrSessions(frames)
  const connectorKwh = ccrConnectorEnergyKwh(frames)
  const months = [...new Set(sessions.map((s) => utcMonth(s.startMs)))].sort()
  const sessKwh = sessions.reduce((a, s) => a + s.energyKwh, 0)
  console.log(
    `[v0] ${stationId}: ${frames.length} frames ${new Date(frames[0].tsMs).toISOString().slice(0, 10)} → ` +
      `${new Date(frames[frames.length - 1].tsMs).toISOString().slice(0, 10)}, ` +
      `${sessions.length} sessions, ${sessKwh.toFixed(0)} kWh (${connectorKwh > 0 ? ((100 * sessKwh) / connectorKwh).toFixed(1) : "—"}% of connector energy) ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  )
  return {
    stationId,
    file: path.basename(file),
    frames: frames.length,
    firstMs: frames[0].tsMs,
    lastMs: frames[frames.length - 1].tsMs,
    sessions,
    connectorKwh,
    months,
  }
}

// ── Persist ─────────────────────────────────────────────────────────────────
async function persist(pool: Pool, r: StationResult) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `DELETE FROM portfolio_session WHERE station_id = $1 AND start_ts >= $2 AND start_ts <= $3`,
      [r.stationId, new Date(r.firstMs), new Date(r.lastMs)],
    )
    // Multi-row insert in chunks (≈1 000 sessions per station-year).
    const CHUNK = 500
    for (let i = 0; i < r.sessions.length; i += CHUNK) {
      const chunk = r.sessions.slice(i, i + CHUNK)
      const values: unknown[] = []
      const tuples = chunk.map((s, k) => {
        const b = k * 10
        values.push(
          r.stationId,
          s.connector,
          new Date(s.startMs),
          new Date(s.endMs),
          s.energyKwh,
          s.peakKw,
          s.avgKw,
          s.frames,
          CCR_SESSION_METHOD,
          r.file,
        )
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`
      })
      await client.query(
        `INSERT INTO portfolio_session
           (station_id, connector, start_ts, end_ts, energy_kwh, peak_kw, avg_kw, frames, method, source_file)
         VALUES ${tuples.join(",")}
         ON CONFLICT (station_id, connector, start_ts) DO UPDATE SET
           end_ts = EXCLUDED.end_ts, energy_kwh = EXCLUDED.energy_kwh, peak_kw = EXCLUDED.peak_kw,
           avg_kw = EXCLUDED.avg_kw, frames = EXCLUDED.frames, method = EXCLUDED.method,
           source_file = EXCLUDED.source_file, imported_at = now()`,
        values,
      )
    }
    await client.query(
      `INSERT INTO portfolio_session_import
         (station_id, source_file, method, first_ts, last_ts, frames, sessions, energy_kwh, connector_kwh)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (station_id) DO UPDATE SET
         source_file = EXCLUDED.source_file, method = EXCLUDED.method,
         first_ts = LEAST(portfolio_session_import.first_ts, EXCLUDED.first_ts),
         last_ts = GREATEST(portfolio_session_import.last_ts, EXCLUDED.last_ts),
         frames = EXCLUDED.frames, sessions = EXCLUDED.sessions, energy_kwh = EXCLUDED.energy_kwh,
         connector_kwh = EXCLUDED.connector_kwh, imported_at = now()`,
      [
        r.stationId,
        r.file,
        CCR_SESSION_METHOD,
        new Date(r.firstMs),
        new Date(r.lastMs),
        r.frames,
        r.sessions.length,
        r.sessions.reduce((a, s) => a + s.energyKwh, 0),
        r.connectorKwh,
      ],
    )
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.inputs.length === 0) {
    console.log("usage: import-ccr-sessions.ts [--dry-run] [--refill] [--allow-unknown] [--manifest f] <csv|zip|dir|url ...>")
    process.exit(1)
  }
  console.log(
    `[v0] method ${CCR_SESSION_METHOD}: >${CCR_SESSION_PARAMS.thresholdW} W, bridge ≤${CCR_SESSION_PARAMS.gapMs / 60000} min, ` +
      `≥${CCR_SESSION_PARAMS.minFrames} frames, >${CCR_SESSION_PARAMS.minKwh} kWh${args.dryRun ? "  (DRY RUN)" : ""}`,
  )
  const files = await expandInputs(args.inputs)
  console.log(`[v0] ${files.length} CCR file(s)`)

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  if (!args.dryRun) await pool.query(DDL)
  const known = new Set<string>(
    (await pool.query(`SELECT station_id FROM portfolio_station`)).rows.map((r: { station_id: string }) => r.station_id),
  )

  // One file per station: a shared folder often holds both `x.zip` and the
  // already-extracted `x.csv`. Derive once, warn on the duplicate, and if two
  // DIFFERENT files claim the same station keep the one with the longer span.
  const seen = new Map<string, string>()
  const results: StationResult[] = []
  for (const f of files) {
    const sid = stationIdFromCcrFileName(path.basename(f))
    if (sid && seen.has(sid)) {
      console.log(`[v0] ${sid}: duplicate input ${path.basename(f)} (already read ${seen.get(sid)}) — skipped`)
      continue
    }
    const r = await deriveFile(f)
    if (!r) continue
    seen.set(r.stationId, r.file)
    if (!known.has(r.stationId) && !args.allowUnknown) {
      console.log(`[v0] ${r.stationId}: NOT in portfolio_station (excluded or unknown) — skipped (use --allow-unknown to force)`)
      continue
    }
    if (!args.dryRun) await persist(pool, r)
    results.push(r)
  }

  const totalSessions = results.reduce((a, r) => a + r.sessions.length, 0)
  console.log(`[v0] ${args.dryRun ? "derived" : "imported"} ${totalSessions} sessions for ${results.length} station(s)`)

  if (!args.dryRun && args.refill && results.length > 0) {
    const months = [...new Set(results.flatMap((r) => r.months))].sort()
    // Loaded lazily: the builder is "server-only" and pulls the app's DB
    // client — only needed when refilling.
    const { fillFleetMonth, FLEET_REPORT_FIRST_MONTH } = await import("../../lib/fleet-report-builder")
    const inRange = months.filter((m) => m >= FLEET_REPORT_FIRST_MONTH)
    console.log(`[v0] refilling ${inRange.length} hist month(s): ${inRange.join(", ")}`)
    for (const m of inRange) {
      const t0 = Date.now()
      const res = await fillFleetMonth(m)
      console.log(`[v0]   ${m}: ok=${res.ok} rows=${res.rows} ${res.error ?? ""} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    }
  } else if (!args.dryRun && results.length > 0) {
    console.log(`[v0] NOTE: run  NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/refill-live-fleet-months.ts --hist  to surface sessions on the yearly report`)
  }

  await pool.end()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
