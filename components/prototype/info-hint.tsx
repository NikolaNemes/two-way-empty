"use client"

import * as React from "react"
import { Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Small (?) info icon that opens a tooltip on hover/focus. Used at the right
 * end of widget titles to expose a richer explanation without taking layout
 * space.
 */
export function InfoHint({
  children,
  className,
  side = "top",
  align = "center",
  iconClassName,
}: {
  children: React.ReactNode
  className?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  iconClassName?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            className,
          )}
        >
          <Info className={cn("size-3.5", iconClassName)} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={6}
        className="max-w-xs whitespace-normal text-left leading-snug"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Wraps a piece of inline label text so that hovering it shows an explanation.
 * The trigger is rendered with a dotted underline + help cursor so users
 * discover the affordance.
 */
export function LabelHint({
  label,
  hint,
  className,
}: {
  label: React.ReactNode
  hint: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "decoration-dotted decoration-muted-foreground/50 underline-offset-[3px] cursor-help underline",
            className,
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="max-w-xs whitespace-normal text-left leading-snug"
      >
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}
