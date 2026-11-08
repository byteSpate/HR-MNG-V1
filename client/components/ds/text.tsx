import type { ElementType, ReactNode } from "react"

import { cx, textClass, type TextVariant } from "./classes"

/** A run of text. The variant sets size and color. `className` is for layout only. */
export function Text({
  variant = "body",
  as,
  className,
  children,
}: {
  variant?: TextVariant
  as?: "p" | "span" | "div"
  className?: string
  children: ReactNode
}) {
  const Tag: ElementType = as ?? "p"
  return <Tag className={cx(textClass(variant), className)}>{children}</Tag>
}
