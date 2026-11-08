"use client"

import { useQuery } from "@tanstack/react-query"

import { listRecoveries } from "@/lib/api/assets"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney } from "@/lib/money"
import { DataTable } from "@/components/dashboard/data-table"
import type { TableCell } from "@/components/dashboard/types"
import { Skeleton } from "@/components/ui/skeleton"
import {
  RECOVERY_KIND_LABEL,
  RECOVERY_STATUS_LABEL,
  RECOVERY_STATUS_TONE,
} from "@/components/asset/asset-shared"
import { Badge } from "@/components/ui/badge"

/** Read-only. A deduction someone can see coming is a deduction disputed
 *  before it is paid, not after — the employee's view of what they owe. */
export function MyRecoveries() {
  const { accessToken, status } = useSession()
  const isAuthed = status === "authenticated" && !!accessToken

  const recoveriesQuery = useQuery({
    queryKey: ["asset-recoveries", "me"],
    queryFn: () => listRecoveries(accessToken!),
    enabled: isAuthed,
  })

  if (recoveriesQuery.isPending) return <Skeleton className="h-32 w-full" />
  if (recoveriesQuery.isError) {
    return (
      <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-ink-muted">
        Could not load your recoveries.
      </div>
    )
  }

  const recoveries = recoveriesQuery.data ?? []
  if (recoveries.length === 0) {
    return (
      <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-ink-muted">
        You have no outstanding asset recoveries.
      </div>
    )
  }

  const rows: TableCell[][] = recoveries.map((r) => [
    { text: r.asset?.assetTag ?? r.assetId, weight: 600 },
    { text: r.asset?.name ?? "" },
    { text: RECOVERY_KIND_LABEL[r.kind] },
    {
      node: (
        <Badge className={RECOVERY_STATUS_TONE[r.status]}>{RECOVERY_STATUS_LABEL[r.status]}</Badge>
      ),
    },
    { text: formatMoney(r.amount, r.currency), weight: 600 },
    { text: r.reason },
  ])

  return (
    <DataTable
      title="Asset recoveries"
      cols="1fr 1.3fr 0.9fr 0.9fr 1fr 1.6fr"
      headers={["Asset", "Name", "Kind", "Status", "Amount", "Reason"]}
      rows={rows}
      action={`${recoveries.length} recovery${recoveries.length === 1 ? "" : "ies"}`}
    />
  )
}
