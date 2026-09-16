"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

const SWAGGER_VERSION = "5.17.14"
const CSS_URL = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`
const JS_URL = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`

declare global {
  interface Window {
    SwaggerUIBundle?: (config: Record<string, unknown>) => unknown
  }
}

function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null
    if (existing) {
      if (window.SwaggerUIBundle) resolve()
      else existing.addEventListener("load", () => resolve())
      return
    }
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load Swagger UI bundle"))
    document.body.appendChild(script)
  })
}

/**
 * Renders Swagger UI for an OpenAPI document. The Swagger assets are loaded from
 * a CDN at runtime (no build dependency) and mounted into a container div.
 */
export function SwaggerDocs({ specUrl }: { specUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadCss(CSS_URL)
    loadScript(JS_URL)
      .then(() => {
        if (cancelled || !containerRef.current || !window.SwaggerUIBundle) return
        window.SwaggerUIBundle({
          url: specUrl,
          domNode: containerRef.current,
          deepLinking: true,
          docExpansion: "list",
          defaultModelsExpandDepth: 0,
          tryItOutEnabled: true,
        })
        setReady(true)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [specUrl])

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Dispatcher Pinger API</h1>
            <p className="text-sm text-muted-foreground">
              Interactive reference for the dispatch tick (Pinger) endpoint.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dispatcher-status">
              <ArrowLeft className="size-4" />
              Back to status
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-2 py-4 sm:px-6">
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-600">
            Could not load the API explorer: {error}. The raw spec is available at{" "}
            <a href={specUrl} className="font-mono underline">
              {specUrl}
            </a>
            .
          </div>
        )}
        {!ready && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-sm">Loading API explorer…</span>
          </div>
        )}
        {/* Swagger UI mounts here. */}
        <div ref={containerRef} />
      </main>
    </div>
  )
}
