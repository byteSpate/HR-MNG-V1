"use client"

import { useQuery } from "@tanstack/react-query"

import { getAnnexureA } from "@/lib/api/statements"
import { useSession } from "@/lib/auth/session-context"
import { currentMonthRange, formatTotal } from "@/components/accounting/accounting-shared"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, toMessage } from "@/components/dashboard/record-kit"
import { Skeleton } from "@/components/ui/skeleton"

const COLUMNS = [
  "Particulars",
  "Rate",
  "Cost opening",
  "Additions",
  "Cost closing",
  "Dep. opening",
  "Charged",
  "Dep. closing",
  "WDV",
]

export function AnnexurePage() {
  const { accessToken } = useSession()
  const range = currentMonthRange()

  const q = useQuery({
    queryKey: ["statements", "annexure", range],
    queryFn: () => getAnnexureA(accessToken!, range),
    enabled: Boolean(accessToken),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Statements"
        title="Annexure-A"
        sub="Lists each kind of fixed asset: what it cost, how much value it has lost (depreciation), and what is left (WDV, the written-down value)."
      />

      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <PanelAlert>{toMessage(q.error)}</PanelAlert>
      ) : q.data.rows.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">
          There are no fixed assets to show yet. Add an asset first, then come back here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-250 text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {COLUMNS.map((h) => (
                  <th key={h} className="px-3 py-2 text-right first:text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.accountId} className="border-b">
                  <td className="px-3 py-2">{r.particulars}</td>
                  {[
                    r.rate ?? "-",
                    r.costOpening,
                    r.costAddition,
                    r.costClosing,
                    r.depOpening,
                    r.depCharged,
                    r.depClosing,
                    r.writtenDownValue,
                  ].map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right tabular-nums">
                      {i === 0 ? v : formatTotal(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
