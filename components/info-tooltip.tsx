"use client"

import { useState, useRef, useEffect } from "react"
import { Info } from "lucide-react"

interface InfoTooltipProps {
  content: string
  className?: string
}

export function InfoTooltip({ content, className = "" }: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label="More information"
      >
        <Info className="size-3.5" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover px-3 py-2.5 text-xs leading-relaxed text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        >
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="size-2 rotate-45 border-b border-r bg-popover" />
          </div>
        </div>
      )}
    </div>
  )
}
