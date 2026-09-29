import type { RemixiconComponentType } from "@remixicon/react"

import { MiniStat } from "@/components/dashboard/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export interface SalesStat {
  label: string
  value: string
  sub: string
  icon: RemixiconComponentType
}

const GRID = "mb-5 grid grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-4"

/**
 * The row of small tiles under a Sales page's header.
 *
 * While the list loads it draws as many tiles as the page will have, of the same size, so the table does not
 * jump down when the numbers arrive, and a count beside a skeleton is never
 * shown (UI rule 4). If the list failed there are no numbers to show, so the
 * row is left out and the table's own error says what happened.
 */
export function SalesStatRow({
  stats,
  isLoading,
  isError = false,
}: {
  stats: SalesStat[]
  isLoading: boolean
  isError?: boolean
}) {
  if (isError) return null
  if (isLoading) {
    return (
      <div className={GRID} aria-hidden>
        {Array.from({ length: stats.length }, (_, i) => (
          <div key={i} className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2.5 h-6 w-14" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={GRID}>
      {stats.map((stat, i) => (
        <MiniStat key={stat.label} label={stat.label} value={stat.value} sub={stat.sub} icon={stat.icon} index={i} />
      ))}
    </div>
  )
}
