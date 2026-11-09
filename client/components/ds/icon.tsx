import type { RemixiconComponentType } from "@remixicon/react"

import { cx } from "./classes"
import { iconClass, type IconSize } from "./icon-sizes"

/**
 * A remixicon at a named size. Hidden from screen readers unless `label` is given.
 * `className` is for color and layout only.
 */
export function Icon({
  as: Glyph,
  size = "sm",
  label,
  className,
}: {
  as: RemixiconComponentType
  size?: IconSize
  label?: string
  className?: string
}) {
  return (
    <Glyph
      className={cx(iconClass(size), className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  )
}
