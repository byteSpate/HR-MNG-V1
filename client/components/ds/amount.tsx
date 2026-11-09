import { cx } from "./classes"
import { amountClass, formatMoney, type AmountMode, type AmountTone } from "./layout-helpers"

/** A money figure. Formats only. It never adds, rounds or converts. */
export function Amount({
  value,
  mode = "amount",
  tone = "neutral",
  className,
}: {
  value: string
  mode?: AmountMode
  tone?: AmountTone
  className?: string
}) {
  return <span className={cx(amountClass(tone), className)}>{formatMoney(value, mode)}</span>
}
