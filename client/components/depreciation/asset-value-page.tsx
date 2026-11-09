"use client"

import { useQuery } from "@tanstack/react-query"

import { getAssetValueReport } from "@/lib/api/assets"
import type { AssetValueRowStatus } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney } from "@/lib/money"
import { DataTable } from "@/components/dashboard/data-table"
import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import type { TableCell } from "@/components/dashboard/types"
import { Skeleton } from "@/components/ui/skeleton"

const STATUS_LABEL: Record<AssetValueRowStatus, string> = {
  VALUED: "Valued",
  UNKNOWN: "Unknown",
  NOT_CAPITALISED: "Not capitalised",
}

export function AssetValuePage() {
  const { accessToken, status } = useSession()
  const isAuthed = status === "authenticated" && !!accessToken

  const reportQuery = useQuery({
    queryKey: ["asset-value"],
    queryFn: () => getAssetValueReport(accessToken!),
    enabled: isAuthed,
  })

  if (!isAuthed) return <Skeleton className="h-64 w-full" />

  const report = reportQuery.data

  const rows: TableCell[][] = (report?.rows ?? []).map((row) => [
    { text: row.assetTag, weight: 600 },
    { text: row.name },
    { text: row.categoryName },
    { text: row.currency },
    // Unknown renders as "unknown", never as 0.00 — the phase-1 rule.
    { text: row.purchaseCost !== null ? formatMoney(row.purchaseCost, row.currency) : "unknown" },
    { text: row.accumulated !== null ? formatMoney(row.accumulated, "BDT") : "unknown" },
    { text: row.bookValue !== null ? formatMoney(row.bookValue, row.currency) : "unknown", weight: 600 },
    { text: STATUS_LABEL[row.status] },
  ])

  return (
    <>
      <PageHeader
        kicker="Workspace"
        title="Asset value"
        sub="Book value per asset — cost minus the depreciation actually charged, per currency"
      />

      {reportQuery.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : reportQuery.isError ? (
        <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-danger">
          Failed to load the value report.
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {(report?.totals ?? []).map((total) => (
              <MiniStat
                key={total.currency}
                label={`Total book value (${total.currency})`}
                value={formatMoney(total.bookValue, total.currency)}
                sub={`${formatMoney(total.purchaseCost, total.currency)} cost less ${formatMoney(total.accumulated, "BDT")} depreciation`}
              />
            ))}
          </div>

          <DataTable
            title="Register"
            cols="1fr 1.3fr 1fr 0.7fr 1fr 1fr 1fr 1fr"
            headers={["Tag", "Name", "Class", "Currency", "Cost", "Depreciation", "Book value", "Status"]}
            rows={rows}
            action={`${report?.rows.length ?? 0} asset${report?.rows.length === 1 ? "" : "s"} · as of ${report?.asOf ?? ""}`}
          />
        </>
      )}
    </>
  )
}
