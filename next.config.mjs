/** @type {import('next').NextConfig} */
// NOTE: config edits force a full Turbopack cache invalidation — used aug 25
// 2026 to recover from a corrupted dev route manifest (PageRoutes = never)
// after a git pull landed under a running dev server.
const nextConfig = {
  // glpk.js (wasm) loads its .wasm via `new URL("glpk.wasm", import.meta.url)`.
  // Bundling it rewrites that URL to a non-existent /_next/static/media path,
  // so keep it external and let Node require it from node_modules at runtime.
  serverExternalPackages: ["glpk.js"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Canonical-domain redirect (client request aug 25 2026): production lives
  // on amperio.enexa.app — anyone hitting the old *.vercel.app production
  // aliases (e.g. the link shared in WhatsApp) is permanently redirected.
  // Host-scoped to the two prod aliases ONLY so git-branch preview deploys
  // (…-git-….vercel.app) keep working.
  async redirects() {
    return ["v0-enexa-amperio-specs.vercel.app", "v0-amperio-pilot.vercel.app"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: "https://amperio.enexa.app/:path*",
      permanent: true,
    }))
  },
}

export default nextConfig
