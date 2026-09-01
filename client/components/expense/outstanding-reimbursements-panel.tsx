"use client"

import { useQuery } from "@tanstack/react-query"
import { RiRefreshLine, RiTimeLine, RiWalletLine } from "@remixicon/react"

import { MiniStat } from "@/components/dashboard/page-header"
import { PanelTable } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { getOutstandingExpenseReimbursements } from "@/lib/api/expenses"
import type { OutstandingExpenseReimbursementRow } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"

function approvedDate(iso: string | null): string {
  if (!iso) return "Approval date unavailable"
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

function age(row: OutstandingExpenseReimbursementRow): TableCell {
  if (row.ageDays === null) return { text: "Unknown", sub: approvedDate(row.approvedAt) }
  return {
    text: `${row.ageDays} day${row.ageDays === 1 ? "" : "s"}`,
    sub: `Approved ${approvedDate(row.approvedAt)}`,
    weight: 600,
  }
}

export function OutstandingReimbursementsPanel({ accessToken }: { accessToken: string }) {
  const query = useQuery({
    queryKey: ["expenses", "outstanding"],
    queryFn: () => getOutstandingExpenseReimbursements(accessToken),
  })
  const report = query.data
  const rows: TableCell[][] = (report?.rows ?? []).map((row) => [
    { text: row.employee.fullName, sub: row.employee.employeeCode, weight: 600 },
    { text: row.name ?? row.category.name, sub: row.category.name },
    age(row),
    { text: formatMoney(row.amount, row.currency), weight: 600 },
  ])

  return (
    <section className="space-y-4">
      <div>
        <div className="text-[15px] font-bold">Outstanding reimbursements</div>
        <p className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-[#5F6B7C]">
          Approved claims that have not yet been attached to payroll or a final settlement,
          ordered from the longest waiting.
        </p>
      </div>

      {report ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MiniStat
            label="Waiting claims"
            value={String(report.totals.claims)}
            sub="Approved, not yet reimbursed"
            icon={RiTimeLine}
          />
          {report.totals.byCurrency.map((total) => (
            <MiniStat
              key={total.currency}
              label={`${total.currency} outstanding`}
              value={formatMoney(total.amount, total.currency)}
              sub={`${total.claims} claim${total.claims === 1 ? "" : "s"}`}
              icon={RiWalletLine}
            />
          ))}
        </div>
      ) : null}

      <PanelTable
        cols="1.1fr 1.2fr 0.8fr 0.9fr"
        headers={["Employee", "Expense", "Waiting", "Amount"]}
        rows={rows}
        isLoading={query.isPending}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        emptyTitle="Nothing is waiting for reimbursement"
        emptyBody="Every approved expense claim is already attached to payroll or a final settlement."
        emptyAction="Refresh"
        emptyActionIcon={<RiRefreshLine className="size-4" aria-hidden />}
        onEmptyAction={() => void query.refetch()}
      />
    </section>
  )
}
