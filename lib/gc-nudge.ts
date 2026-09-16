/**
 * Best-effort manual garbage-collection nudge for long-running, mostly-synchronous
 * server loops (e.g. multi-week backtests).
 *
 * WHY THIS EXISTS
 * The GLPK linear-program solver (`glpk.js`'s native/wasm addon) allocates working
 * memory OFF the V8 JS heap and only releases it when the small JS wrapper object
 * for each solve is garbage-collected. During a long backtest the JS heap stays
 * tiny (~80 MB), so V8 feels no pressure and never runs a major GC — meanwhile the
 * untracked native memory from tens of thousands of solves piles up until the OS
 * OOM-kills the process (SIGKILL / exit 137), even though `heapUsed` looks fine.
 *
 * Forcing a periodic major GC lets those wrapper objects be collected, which in
 * turn frees the native memory and keeps RSS flat. We obtain a `gc()` handle at
 * runtime via the V8 flag trick so callers don't need to launch node with
 * `--expose-gc`. If that's unavailable for any reason, this degrades to a no-op.
 */

let cachedGc: (() => void) | null | undefined

/** Resolve a callable `gc()` once, without requiring the `--expose-gc` launch flag. */
function resolveGc(): (() => void) | null {
  if (cachedGc !== undefined) return cachedGc
  // 1) Already exposed (process launched with --expose-gc).
  const g = (globalThis as { gc?: () => void }).gc
  if (typeof g === "function") {
    cachedGc = g
    return cachedGc
  }
  // 2) Enable it at runtime via V8 flags + a fresh VM context (Node only).
  try {
    // Avoid bundlers statically resolving these in edge/browser builds.
    const req = eval("require") as NodeRequire
    const v8 = req("v8") as typeof import("v8")
    const vm = req("vm") as typeof import("vm")
    v8.setFlagsFromString("--expose-gc")
    const fn = vm.runInNewContext("gc") as (() => void) | undefined
    // Turn GC back off globally so we don't change default runtime behaviour.
    v8.setFlagsFromString("--no-expose-gc")
    cachedGc = typeof fn === "function" ? fn : null
  } catch {
    cachedGc = null
  }
  return cachedGc
}

/**
 * Run a GC pass if one is available. Returns true if GC actually ran.
 * Safe to call frequently; resolution of the `gc` handle is cached.
 */
export function maybeGc(): boolean {
  const gc = resolveGc()
  if (!gc) return false
  try {
    gc()
    return true
  } catch {
    return false
  }
}
