import { Prisma } from "../../generated/prisma/client"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Cumulative amount a MONTHLY line should have earned by `monthEnd` (the
 * month's last day, UTC): decision B3, amount × days elapsed / contract
 * days, both ends inclusive, rounded to the paisa; the full amount on or
 * after contractEnd (never a rounded approximation of it); nothing before
 * contractStart.
 */
export function monthlyTarget(
  line: { amount: Prisma.Decimal; contractStart: Date; contractEnd: Date },
  monthEnd: Date
): Prisma.Decimal {
  if (monthEnd.getTime() < line.contractStart.getTime()) return new Prisma.Decimal(0)
  if (monthEnd.getTime() >= line.contractEnd.getTime()) return line.amount

  const totalDays = Math.round((line.contractEnd.getTime() - line.contractStart.getTime()) / DAY_MS) + 1
  const elapsedDays = Math.round((monthEnd.getTime() - line.contractStart.getTime()) / DAY_MS) + 1
  return new Prisma.Decimal(line.amount.times(elapsedDays).dividedBy(totalDays).toFixed(2))
}

/**
 * This month's charge per line: this month's target less what POSTED runs
 * already earned, leaving out lines where that is zero or less — a line
 * whose target has not moved since the last run, or a month re-drafted
 * after it was already caught up.
 */
export function computeRunCharges(
  lines: Array<{ id: string; amount: Prisma.Decimal; contractStart: Date; contractEnd: Date; earnedSoFar: Prisma.Decimal }>,
  monthEnd: Date
): Array<{ poLineId: string; amount: Prisma.Decimal }> {
  const charges: Array<{ poLineId: string; amount: Prisma.Decimal }> = []
  for (const line of lines) {
    const charge = monthlyTarget(line, monthEnd).minus(line.earnedSoFar)
    if (charge.greaterThan(0)) charges.push({ poLineId: line.id, amount: charge })
  }
  return charges
}
