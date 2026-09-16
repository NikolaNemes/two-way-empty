import type { ReactNode } from "react"

interface PageHeaderProps {
  title: ReactNode
  description: string
  /** Optional leading icon rendered in a subtle tinted tile. */
  icon?: ReactNode
  /** Optional trailing controls (buttons, badges) pinned to the right. */
  actions?: ReactNode
}

export function PageHeader({ title, description, icon, actions }: PageHeaderProps) {
  return (
    <header className="sticky top-14 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3.5 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-6 sm:py-4">
      {icon ? (
        <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground sm:flex">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
          {title}
        </h1>
        <p className="text-xs text-muted-foreground text-pretty sm:text-sm">{description}</p>
      </div>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
