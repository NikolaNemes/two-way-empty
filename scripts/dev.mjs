// Dev launcher: loads the sandbox's shared env file (if present) so `pnpm dev`
// sees DATABASE_URL and other vars the Next dev server needs, then execs
// `next dev`. On Vercel/production the shared file doesn't exist, so this is a
// no-op and the platform-injected env vars are used as-is. dotenv.config() does
// NOT override already-set process.env vars, so real env always wins.
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import dotenv from "dotenv"

const SHARED_ENV = "/vercel/share/.env.project"

if (existsSync(SHARED_ENV)) {
  const { parsed, error } = dotenv.config({ path: SHARED_ENV })
  if (error) {
    console.warn(`[dev] failed to load ${SHARED_ENV}: ${error.message}`)
  } else {
    console.log(`[dev] loaded ${Object.keys(parsed ?? {}).length} vars from ${SHARED_ENV}`)
  }
}

// Resolve the Next.js CLI entry so we don't depend on node_modules/.bin being on PATH.
const require = createRequire(import.meta.url)
const nextBin = require.resolve("next/dist/bin/next")

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
