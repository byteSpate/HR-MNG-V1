"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getCashFlow } from "@/lib/api/statements"
import { useSession } from "@/lib/auth/session-context"
import { currentMonthRange, formatSigned } from "@/components/accounting/accounting-shared"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, toMessage } from "@/components/dashboard/record-kit"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

export function CashFlowPage() {
  const { accessToken } = useSession()
  const [range, setRange] = useState(currentMonthRange())

  const q = useQuery({
    queryKey: ["statements", "cash-flow", range],
    queryFn: () => getCashFlow(accessToken!, range),
    enabled: Boolean(accessToken),
  })

  // Loading, broken and empty are three different screens. A refusal from the
  // server is shown in its own words: it carries facts the client does not have.
  const rows = q.data ? [...q.data.operating, ...q.data.investing, ...q.data.financing, ...q.data.summary] : []

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Statements"
        title="Statement of Cash Flows"
        sub="Shows where cash came from and where it went. It is split into day-to-day work, buying assets, and money from owners and loans."
      />

      <div className="flex gap-3 rounded-lg border p-3">
        <Input
          type="date"
          aria-label="From"
          value={range.from}
          onChange={(e) => setRange({ ...range, from: e.target.value })}
        />
        <Input
          type="date"
          aria-label="To"
          value={range.to}
          onChange={(e) => setRange({ ...range, to: e.target.value })}
        />
      </div>

      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <PanelAlert>{toMessage(q.error)}</PanelAlert>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">
          No cash moved in these dates. Pick other dates to see more.
        </div>
      ) : (
        <div className="rounded-lg border p-4">
          {rows.map((r) => (
            <div
              key={r.key}
              className={`grid grid-cols-[1fr_140px_140px] gap-4 border-b px-2 py-2 text-sm ${r.isSubtotal ? "font-semibold" : ""}`}
            >
              <span>{r.label}</span>
              <span className="text-right tabular-nums">{formatSigned(r.current)}</span>
              <span className="text-right tabular-nums text-muted-foreground">{formatSigned(r.comparative)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
