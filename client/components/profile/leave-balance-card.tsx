"use client"

import { useQuery } from "@tanstack/react-query"

import { getLeaveBalancesFor } from "@/lib/api/leave"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Fetched in its own query: it comes from the leave module, not the employee
 * payload, and a slow leave query should not delay the field cards.
 *
 * No role check here either — `getBalancesFor` on the server 403s for every
 * tier but FULL and MANAGER, and that renders as nothing: a tier without
 * this simply has none, the same treatment `ProfileInsights` gives a tier
 * without charts.
 */
export function LeaveBalanceCard({ employeeId }: { employeeId: string }) {
  const { accessToken, status: sessionStatus } = useSession()

  const balancesQuery = useQuery({
    queryKey: ["leave-balances", employeeId],
    queryFn: () => getLeaveBalancesFor(accessToken!, employeeId),
    enabled: sessionStatus === "authenticated" && !!accessToken,
    // A 403 means this tier does not get leave balances. Retrying it three
    // times is three guaranteed failures and a slower page.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 403) && failureCount < 2,
  })

  if (balancesQuery.isPending) {
    return <Skeleton className="h-48 w-full" />
  }

  // Not an error state: a tier without leave-balance access simply has none.
  if (balancesQuery.isError || !balancesQuery.data) return null

  return (
    <div className="flex flex-col rounded-md border border-line bg-white px-5.5 py-5">
      <div className="mb-4 text-lead font-bold">Leave balance</div>
      {balancesQuery.data.length === 0 ? (
        <p className="text-body-sm text-ink-muted">No leave balance to show.</p>
      ) : (
        <ul className="space-y-2.5">
          {balancesQuery.data.map((item) => (
            <li key={item.leaveTypeId} className="text-body-sm">
              {item.name} · {item.balance} of {item.entitlement}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
