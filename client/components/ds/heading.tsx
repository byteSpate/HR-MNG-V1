import type { ElementType, ReactNode } from "react"

import { cx, headingClass, type HeadingLevel } from "./classes"

const DEFAULT_TAG: Record<HeadingLevel, "h1" | "h2" | "h3"> = {
  display: "h1",
  page: "h1",
  section: "h2",
  card: "h3",
}

/**
 * A heading. The level sets the size, font and color.
 * `className` is for layout only (margins), never for size or color.
 */
export function Heading({
  level,
  as,
  className,
  children,
}: {
  level: HeadingLevel
  as?: "h1" | "h2" | "h3" | "h4"
  className?: string
  children: ReactNode
}) {
  const Tag: ElementType = as ?? DEFAULT_TAG[level]
  return <Tag className={cx(headingClass(level), className)}>{children}</Tag>
}
