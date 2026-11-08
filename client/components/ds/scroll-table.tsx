import type { ReactNode } from "react"

import { cx } from "./classes"

/**
 * Wraps a wide table so it scrolls inside its own box, not the page.
 * A soft fade on the right edge shows on a phone that there is more to see.
 */
export function ScrollTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("relative", className)}>
      <div className="overflow-x-auto overscroll-x-contain" tabIndex={0} role="region" aria-label="Table, scrolls sideways">
        {children}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-linear-to-l from-surface to-transparent md:hidden"
      />
    </div>
  )
}
