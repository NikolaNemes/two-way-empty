"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface NumericFieldProps {
  label: string
  value: number
  unit?: string
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  hint?: string
  className?: string
}

export function NumericField({
  label,
  value,
  unit,
  onChange,
  step = 1,
  min,
  max,
  hint,
  className,
}: NumericFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          step={step}
          min={min}
          max={max}
          className="h-9 font-mono text-sm tabular-nums"
        />
        {unit && (
          <span className="shrink-0 text-xs font-medium text-muted-foreground min-w-[3rem]">
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-xs text-muted-foreground/70">{hint}</p>
      )}
    </div>
  )
}

interface TextFieldProps {
  label: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  className?: string
}

export function TextField({
  label,
  value,
  onChange,
  readOnly,
  className,
}: TextFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={readOnly}
        className={cn("h-9 text-sm", readOnly && "bg-muted text-muted-foreground")}
      />
    </div>
  )
}
