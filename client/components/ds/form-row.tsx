import type { ReactNode } from "react"

import { cx } from "./classes"

/** Label and field side by side from md up, stacked on a phone. */
export function FormRow({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cx("grid gap-1.5 md:grid-cols-[12rem_1fr] md:items-start md:gap-4", className)}>
      <label htmlFor={htmlFor} className="text-body-sm font-bold text-ink-body md:pt-2">
        {label}
      </label>
      <div className="min-w-0">
        {children}
        {hint ? <p className="mt-1 text-caption text-ink-muted">{hint}</p> : null}
      </div>
    </div>
  )
}
