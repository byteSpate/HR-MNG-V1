import { cn } from "@/lib/utils"
import { formatMoney, isNegativeMoney } from "@/lib/money"
import type { DealMoneyNumbers } from "@/lib/api/types"
import { TONE } from "@/components/dashboard/record-kit"

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-white px-5 py-4">
      <div className="text-caption font-bold tracking-wide text-ink-muted uppercase">{label}</div>
      <div
        className={cn(
          "font-heading mt-1.5 text-title font-bold tracking-tight tabular-nums sm:text-heading",
          danger ? "text-danger" : "text-ink"
        )}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * The Money section's headline tiles: Sold, Cost, Profit, Still owed.
 *
 * Cost and Profit render only when `canSeeCost` — the server omits them as
 * `null` for a sales user rather than sending a real figure and hiding it
 * (Review Focus 5 of the deal-money design: no cost amount should ever reach
 * a client that cannot see it). This checks the value too, not only the
 * flag, so a `null` is never coerced into a shown "৳0.00" — that would be a
 * fake number (CLAUDE.md rule 1), and here it would also be the wrong kind
 * of wrong: it would read as "this deal cost nothing" to someone who is
 * allowed to see Cost, rather than "you cannot see this" to someone who
 * isn't.
 */
export function MoneyNumbers({
  numbers,
  canSeeCost,
  hasDrafts,
}: {
  numbers: DealMoneyNumbers
  canSeeCost: boolean
  /**
   * Any draft invoice, bill or credit note on this deal, from anywhere in
   * the Money section's data. A draft never moves these four numbers, so a
   * viewer looking at a deal with drafts waiting needs to know why the
   * totals do not yet include them.
   */
  hasDrafts: boolean
}) {
  const showCost = canSeeCost && numbers.cost !== null
  const showProfit = canSeeCost && numbers.profit !== null

  return (
    <section className="space-y-2">
      <div className={cn("grid grid-cols-2 gap-3", (showCost || showProfit) && "sm:grid-cols-4")}>
        <Tile label="Sold" value={formatMoney(numbers.sold, "BDT")} />
        {showCost ? <Tile label="Cost" value={formatMoney(numbers.cost!, "BDT")} /> : null}
        {showProfit ? (
          <Tile label="Profit" value={formatMoney(numbers.profit!, "BDT")} danger={isNegativeMoney(numbers.profit!)} />
        ) : null}
        <Tile label="Still owed" value={formatMoney(numbers.stillOwed, "BDT")} />
      </div>
      {hasDrafts ? (
        <p className={cn("text-caption", TONE.muted)}>Drafts are not counted until they are approved.</p>
      ) : null}
    </section>
  )
}
