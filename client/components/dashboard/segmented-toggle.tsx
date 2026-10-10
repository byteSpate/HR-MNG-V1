"use client"

import type { RemixiconComponentType } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Option<T extends string> = {
  value: T
  label: string
  /** Optional glyph shown before the label. */
  Icon?: RemixiconComponentType
}

/**
 * One choice out of a few, shown side by side: the queue a manager is looking
 * at, the log as a list or a calendar. For a filter over a list with counts,
 * use `FilterChip` instead.
 *
 * `aria-pressed` and not a radio group, for the same reason as `FilterChip`:
 * these switch a view, they are not a form field and nothing is submitted.
 *
 * Every button is `variant="ghost"` on purpose. The default variant paints
 * `bg-primary` under whatever classes are passed, so a class string that only
 * sets a text colour leaves the unselected half dark with grey text. That
 * defect shipped twice before this component existed.
 */
export function SegmentedToggle<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** Names the group for a screen reader, for example "Queue shown". */
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (next: T) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex rounded-md border border-[#E4E9EF] bg-white p-0.5", className)}
    >
      {options.map(({ value: optionValue, label: optionLabel, Icon }) => {
        const active = optionValue === value
        return (
          <Button
            key={optionValue}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={active}
            onClick={() => onChange(optionValue)}
            className={cn(
              "gap-1.5 rounded px-3 text-[12px] transition-colors",
              active
                ? "bg-[#17191C] font-bold text-white hover:bg-[#17191C] hover:text-white"
                : "font-semibold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
            )}
          >
            {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
            {optionLabel}
          </Button>
        )
      })}
    </div>
  )
}
