import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"

/**
 * Shared header strip for all Model Lab pages. Matches the prototype
 * screens' header convention (uppercase badges + balanced title + muted
 * description) so the new section feels native to the existing app.
 */
export function LabPageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string
  description: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] tracking-wider uppercase gap-1">
          Model Lab
        </Badge>
        <Badge variant="outline" className="text-[10px] tracking-wider uppercase gap-1 border-teal-500/40 text-teal-600">
          Neon-backed
        </Badge>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-balance">
        {icon}
        {title}
      </h1>
      <p className="text-muted-foreground max-w-2xl leading-relaxed text-pretty text-sm">{description}</p>
    </div>
  )
}

/** Standard page shell padding used by every Model Lab screen. */
export function LabPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip py-6 sm:py-8 px-3 sm:px-6 space-y-6 sm:space-y-8">
      {children}
    </div>
  )
}
