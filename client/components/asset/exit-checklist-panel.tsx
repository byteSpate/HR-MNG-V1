"use client"

import { useQuery } from "@tanstack/react-query"

import { getExitChecklist } from "@/lib/api/assets"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney } from "@/lib/money"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Decision 6: the exit checklist is a warning and never a blocker. Lists
 * unreturned assets and pending recoveries, but never disables the action
 * next to it. An unreturned laptop does not block a settlement — the salary
 * figure is right and the asset is a separate debt. Name the debt, price it,
 * deduct it, pay them.
 */
export function ExitChecklistPanel({ employeeId }: { employeeId: string }) {
  const { accessToken } = useSession()

  const checklistQuery = useQuery({
    queryKey: ["exit-checklist", employeeId],
    queryFn: () => getExitChecklist(accessToken!, employeeId),
    enabled: !!accessToken && !!employeeId,
  })

  if (checklistQuery.isPending) return <Skeleton className="h-16 w-full" />
  if (checklistQuery.isError || !checklistQuery.data) return null

  const checklist = checklistQuery.data
  if (!checklist.hasOutstanding) return null

  return (
    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-caption">
      <p className="font-medium">
        This leaver still has {checklist.openAssignments.length} unreturned asset
        {checklist.openAssignments.length === 1 ? "" : "s"}
        {checklist.pendingRecoveries.length > 0
          ? ` and ${checklist.pendingRecoveries.length} pending recovery`
              + `${checklist.pendingRecoveries.length === 1 ? "" : "ies"}`
          : ""}.
      </p>
      <ul className="mt-1.5 space-y-1 text-muted-foreground">
        {checklist.openAssignments.map((a) => (
          <li key={a.assignmentId}>• {a.assetTag} · {a.assetName} — not returned</li>
        ))}
        {checklist.pendingRecoveries.map((r) => (
          <li key={r.id}>
            • {r.asset?.assetTag ?? r.assetId} · {formatMoney(r.amount, r.currency)} recovery pending
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-muted-foreground">
        This is a warning, not a gate — the settlement can still be calculated and paid.
      </p>
    </div>
  )
}
