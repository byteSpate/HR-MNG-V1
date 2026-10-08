"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiCalendarCheckLine,
  RiCalendarEventLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiRefreshLine,
  RiTeamLine,
  RiTimeLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import {
  approveLeaveRequest,
  cancelLeaveRequest,
  getMyLeaveBalances,
  getTeamStatus,
  listLeaveRequests,
  listLeaveTypes,
  rejectLeaveRequest,
  revertLeaveRequest,
} from "@/lib/api/leave"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { REFERENCE_STALE_MS } from "@/lib/query/default-options"
import type { LeaveRequestItem } from "@/lib/api/types"
import { DataTable } from "@/components/dashboard/data-table"
import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { TableCell } from "@/components/dashboard/types"
import { ApplyLeaveDialog } from "@/components/leave/apply-leave-dialog"
import { DecisionDialog } from "@/components/leave/decision-dialog"
import { LeaveDetail } from "@/components/leave/leave-detail"
import {
  coversToday,
  decidedByLabel,
  formatLeaveDays,
  formatRange,
  formatSessionLabel,
  isFutureDated,
  STATUS_LABEL,
  STATUS_TONE,
  TEAM_STATUS_LABEL,
  TEAM_STATUS_TONE,
} from "@/components/leave/leave-shared"

/** Roles that hold leave of their own — the only ones with an Employee profile. */
const STAFF_ROLES = ["EMPLOYEE", "REPORTING_MANAGER"]

/** Roles that see every request. Only the first two may act on one. */
const DECIDER_ROLES = ["HR_ADMIN", "SUPER_ADMIN"]
const REVIEWER_ROLES = [...DECIDER_ROLES, "FINANCE_OFFICER"]

type DecisionKind = "reject" | "revert"

/** Shaped like the table it stands in for, so nothing shifts when data lands. */
function TableSkeleton() {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
      <div className="space-y-3">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-4 border-b border-[#EEF1F5] pb-3 last:border-0">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function LoadError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-8 text-center">
      <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
        <RiErrorWarningLine className="size-5" aria-hidden />
      </span>
      <div className="text-[13.5px] font-bold">Could not load {label}</div>
      <p className="mt-1 text-[12.5px] text-[#5F6B7C]">
        Nothing has changed. Check the connection and try again.
      </p>
      <Button
        className="mt-3 h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
        onClick={onRetry}
      >
        <RiRefreshLine className="size-4" aria-hidden />
        Retry
      </Button>
    </div>
  )
}

/** Nothing to show, said in the words of whichever list is empty. */
function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: RemixiconComponentType
  title: string
  body: string
}) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-10 text-center">
      <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-[#F1F4F8] text-[#5F6B7C]">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="text-[13.5px] font-bold">{title}</div>
      <p className="mx-auto mt-1 max-w-[46ch] text-[12.5px] leading-relaxed text-[#5F6B7C]">{body}</p>
    </div>
  )
}

export function LeavePage() {
  const { accessToken, user, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()

  const [applyOpen, setApplyOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const isStaff = !!user && STAFF_ROLES.includes(user.role)
  const isReviewer = !!user && REVIEWER_ROLES.includes(user.role)
  const canDecide = !!user && DECIDER_ROLES.includes(user.role)

  const [decision, setDecision] = useState<{ kind: DecisionKind; id: string } | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  /** The request open in the sheet. Held by id so it re-reads after a decision. */
  const [viewingId, setViewingId] = useState<string | null>(null)

  const requestsQuery = useQuery({
    queryKey: ["leave-requests"],
    queryFn: () => listLeaveRequests(accessToken!),
    enabled: isAuthed,
  })

  const typesQuery = useQuery({
    queryKey: ["leave-types"],
    staleTime: REFERENCE_STALE_MS,
    queryFn: () => listLeaveTypes(accessToken!),
    enabled: isAuthed && isStaff,
  })

  const balancesQuery = useQuery({
    queryKey: ["leave-balances", "me"],
    queryFn: () => getMyLeaveBalances(accessToken!),
    enabled: isAuthed && isStaff,
  })

  const isManager = user?.role === "REPORTING_MANAGER"

  const teamStatusQuery = useQuery({
    queryKey: ["leave-team-status"],
    queryFn: () => getTeamStatus(accessToken!),
    enabled: isAuthed && isManager,
  })

  function invalidateMine() {
    queryClient.invalidateQueries({ queryKey: ["leave-requests"] })
    queryClient.invalidateQueries({ queryKey: ["leave-balances", "me"] })
  }

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelLeaveRequest(accessToken!, id),
    onSuccess: () => {
      setActionError(null)
      invalidateMine()
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  function invalidateReviewed() {
    queryClient.invalidateQueries({ queryKey: ["leave-requests"] })
    queryClient.invalidateQueries({ queryKey: ["leave-team-status"] })
  }

  /**
   * Surface the server's own message. The approval-time re-checks return 409s
   * HR will hit legitimately ("balance is no longer sufficient"), and a generic
   * fallback would hide why the decision was refused.
   */
  function decisionErrorMessage(err: unknown): string {
    return err instanceof ApiError ? err.message : "Something went wrong. Please try again."
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveLeaveRequest(accessToken!, id),
    onSuccess: () => {
      setActionError(null)
      invalidateReviewed()
    },
    onError: (err) => setActionError(decisionErrorMessage(err)),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      rejectLeaveRequest(accessToken!, id, note),
    onSuccess: () => {
      setDecision(null)
      setDecisionError(null)
      invalidateReviewed()
    },
    onError: (err) => setDecisionError(decisionErrorMessage(err)),
  })

  const revertMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      revertLeaveRequest(accessToken!, id, note),
    onSuccess: () => {
      setDecision(null)
      setDecisionError(null)
      invalidateReviewed()
    },
    onError: (err) => setDecisionError(decisionErrorMessage(err)),
  })

  const requests = useMemo(() => requestsQuery.data ?? [], [requestsQuery.data])
  const balances = useMemo(() => balancesQuery.data ?? [], [balancesQuery.data])

  // Every request the endpoint returned for a staff member that is their own.
  // For an employee that is all of them; for a manager it separates their own
  // leave from their reports'.
  const ownEmployeeCode = user?.employeeCode
  const ownEmployeeId = useMemo(() => {
    if (!isStaff || !ownEmployeeCode) return null
    return requests.find((r) => r.employee.employeeCode === ownEmployeeCode)?.employee.id ?? null
  }, [isStaff, ownEmployeeCode, requests])

  const myRequests = useMemo(() => {
    if (!isStaff) return []
    if (!ownEmployeeId) return requests
    return requests.filter((r) => r.employee.id === ownEmployeeId)
  }, [isStaff, ownEmployeeId, requests])

  // The endpoint already scopes a manager to themselves plus their reports, so
  // with no own-request to identify, showing every returned row is still safe.
  const teamRequests = useMemo(() => {
    if (!isManager) return []
    if (!ownEmployeeId) return requests
    return requests.filter((r) => r.employee.id !== ownEmployeeId)
  }, [isManager, ownEmployeeId, requests])

  const stats = useMemo(() => {
    const pending = myRequests.filter((r) => r.status === "PENDING").length
    const takenYtd = myRequests
      .filter((r) => r.status === "APPROVED")
      .reduce((total, r) => total + r.days, 0)

    const balanceTiles = balances.map((b) => {
      // Earned leave has no quota to quote — it is bought with days actually
      // worked, so the tile shows the working rather than a bare number the
      // employee has no way to check.
      if (b.accrual) {
        if (!b.accrual.eligible) {
          return {
            label: b.name,
            value: "—",
            sub: `Accrues after ${b.accrual.minServiceMonths} months of service`,
          }
        }
        const worked = `from ${b.accrual.daysWorked} days worked since ${b.accrual.windowStart}`
        return {
          label: b.name,
          value: `${b.balance}`,
          sub:
            b.accrual.untrackedDays > 0
              ? `of ${b.entitlement}, ${worked} (${b.accrual.untrackedDays} days predate attendance)`
              : `of ${b.entitlement}, ${worked}`,
        }
      }

      return {
        label: b.name,
        value: b.annualQuota === 0 ? "—" : `${b.balance}`,
        sub:
          b.annualQuota === 0
            ? "Unpaid — no annual quota"
            : b.entitlement < b.annualQuota
              ? `of ${b.entitlement} (pro-rated from your joining date)`
              : `of ${b.entitlement} days`,
      }
    })

    return [
      ...balanceTiles,
      { label: "Pending", value: String(pending), sub: "Awaiting a decision" },
      { label: "Days taken", value: formatLeaveDays(takenYtd), sub: "Approved so far this year" },
    ]
  }, [myRequests, balances])

  function canCancel(r: LeaveRequestItem): boolean {
    return r.status === "PENDING" || (r.status === "APPROVED" && isFutureDated(r.startDate))
  }

  // Re-read from the live list rather than held in state, so the sheet shows
  // the decided status the moment the refetch lands instead of the stale copy
  // that was captured when the row was clicked.
  const viewing = useMemo(
    () => (viewingId ? (requests.find((r) => r.id === viewingId) ?? null) : null),
    [viewingId, requests]
  )

  function openRequest(r: LeaveRequestItem) {
    setActionError(null)
    setViewingId(r.id)
  }

  const reviewerStats = useMemo(() => {
    if (!isReviewer) return []
    const now = new Date()
    const pending = requests.filter((r) => r.status === "PENDING").length
    const approvedThisMonth = requests.filter((r) => {
      if (r.status !== "APPROVED" || !r.decidedAt) return false
      const decided = new Date(r.decidedAt)
      return decided.getFullYear() === now.getFullYear() && decided.getMonth() === now.getMonth()
    }).length
    const onLeaveToday = requests.filter(
      (r) => r.status === "APPROVED" && coversToday(r.startDate, r.endDate)
    ).length

    return [
      { label: "Pending", value: String(pending), sub: "Awaiting a decision", icon: RiTimeLine },
      {
        label: "Approved this month",
        value: String(approvedThisMonth),
        sub: "Decided this month",
        icon: RiCalendarCheckLine,
      },
      {
        label: "On leave today",
        value: String(onLeaveToday),
        sub: "Approved leave covering today",
        icon: RiTeamLine,
      },
    ]
  }, [isReviewer, requests])

  /**
   * One control per row, opening the sheet.
   *
   * Approve and Reject used to render inline here — two buttons crammed into a
   * seventh column, deciding a request from six columns of summary while the
   * `reason` the employee wrote was fetched on every row and shown nowhere.
   * The decision moved to `LeaveDetail`, which has the room to show it.
   *
   * The row still says whether anything is waiting: "Decide" reads as work,
   * "View" does not, and both open the same sheet.
   */
  const reviewerRows: TableCell[][] = (isReviewer ? requests : []).map((r) => {
    const actionable =
      canDecide && (r.status === "PENDING" || (r.status === "APPROVED" && isFutureDated(r.startDate)))

    return [
      { text: r.employee.fullName, sub: r.employee.employeeCode, weight: 600 },
      { text: r.leaveType.name, sub: r.leaveType.isPaid ? "Paid" : "Unpaid" },
      { text: formatRange(r.startDate, r.endDate) },
      { text: formatLeaveDays(r.days), ...(formatSessionLabel(r) ? { sub: formatSessionLabel(r)! } : {}) },
      {
        tag: STATUS_LABEL[r.status],
        tone: STATUS_TONE[r.status],
        ...(r.status === "REJECTED" && r.decisionNote ? { sub: r.decisionNote } : {}),
      },
      { text: decidedByLabel(r.decidedBy) },
      {
        node: (
          <div className="flex justify-end">
            {/* Solid rather than quiet-until-hover. This is the only way into
                the request, so it is the row's purpose rather than a secondary
                action sitting beside a primary one. */}
            <Button
              type="button"
              onClick={() => openRequest(r)}
              className="h-auto gap-1.5 rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white transition-[background-color,transform] hover:bg-[#0E1012] active:translate-y-px motion-reduce:transition-none"
            >
              {actionable ? (
                <RiCheckboxCircleLine className="size-3.5 text-white" aria-hidden />
              ) : (
                <RiEyeLine className="size-3.5 text-white" aria-hidden />
              )}
              {actionable ? "Decide" : "View"}
            </Button>
          </div>
        ),
      } satisfies TableCell,
    ]
  })

  const teamStatusRows: TableCell[][] = (teamStatusQuery.data ?? []).map((m) => [
    { text: m.fullName, sub: m.employeeCode, weight: 600 },
    { text: m.designation },
    { tag: TEAM_STATUS_LABEL[m.status], tone: TEAM_STATUS_TONE[m.status] },
    {
      text: m.currentLeave ? m.currentLeave.leaveTypeName : "—",
      ...(m.currentLeave
        ? { sub: formatRange(m.currentLeave.startDate, m.currentLeave.endDate) }
        : {}),
    },
  ])

  const teamRequestRows: TableCell[][] = teamRequests.map((r) => [
    { text: r.employee.fullName, sub: r.employee.employeeCode, weight: 600 },
    { text: r.leaveType.name },
    { text: formatRange(r.startDate, r.endDate) },
    { text: formatLeaveDays(r.days), ...(formatSessionLabel(r) ? { sub: formatSessionLabel(r)! } : {}) },
    { tag: STATUS_LABEL[r.status], tone: STATUS_TONE[r.status] },
  ])

  const myRows: TableCell[][] = myRequests.map((r) => [
    { text: r.leaveType.name, sub: r.leaveType.isPaid ? "Paid" : "Unpaid", weight: 600 },
    { text: formatRange(r.startDate, r.endDate) },
    { text: formatLeaveDays(r.days), ...(formatSessionLabel(r) ? { sub: formatSessionLabel(r)! } : {}) },
    {
      tag: STATUS_LABEL[r.status],
      tone: STATUS_TONE[r.status],
      ...(r.status === "REJECTED" && r.decisionNote ? { sub: r.decisionNote } : {}),
    },
    { text: decidedByLabel(r.decidedBy) },
    {
      node: canCancel(r) ? (
        <Button
          type="button"
          variant="outline"
          className="h-auto px-2.5 py-1 text-[12px] font-semibold"
          disabled={cancelMutation.isPending}
          onClick={() => cancelMutation.mutate(r.id)}
        >
          Cancel
        </Button>
      ) : (
        <span className="text-[13px] text-[#6B7789]">—</span>
      ),
    },
  ])

  if (sessionStatus === "loading") {
    return (
      <div className="pt-7">
        <TableSkeleton />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        kicker="Time off"
        title="Leave"
        sub={
          isStaff
            ? "Your balances, requests, and time off history"
            : "Leave requests across the organisation"
        }
        cta={isStaff ? "Request leave" : undefined}
        onCta={isStaff ? () => setApplyOpen(true) : undefined}
      />

      {/* Suppressed while the sheet is open, which renders the same message
          beside the buttons that produced it. */}
      {actionError && !viewing ? (
        <div className="mb-4">
          <PanelAlert onDismiss={() => setActionError(null)}>{actionError}</PanelAlert>
        </div>
      ) : null}

      {isReviewer ? (
        <>
          <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-4">
            {reviewerStats.map((stat) => (
              <MiniStat
                key={stat.label}
                label={stat.label}
                value={stat.value}
                sub={stat.sub}
                icon={stat.icon}
              />
            ))}
          </div>
          {requestsQuery.isPending ? (
            <TableSkeleton />
          ) : requestsQuery.isError ? (
            <LoadError label="leave requests" onRetry={() => requestsQuery.refetch()} />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={RiCalendarEventLine}
              title="No leave requests yet"
              body="Requests appear here as soon as anyone files one, and stay after they are decided."
            />
          ) : (
            <DataTable
              title="All leave requests"
              action=""
              cols="1.3fr 0.9fr 1fr 0.4fr 1fr 0.8fr 0.7fr"
              headers={["Employee", "Type", "Dates", "Days", "Status", "Approver", ""]}
              rows={reviewerRows}
            />
          )}
        </>
      ) : null}

      {isManager ? (
        <div className="mb-5 space-y-5">
          {teamStatusQuery.isPending ? (
            <TableSkeleton />
          ) : teamStatusQuery.isError ? (
            <LoadError label="your team" onRetry={() => teamStatusQuery.refetch()} />
          ) : (
            <DataTable
              title="My team"
              action=""
              cols="1.4fr 1fr 0.9fr 1.2fr"
              headers={["Employee", "Designation", "Status", "Currently on"]}
              rows={teamStatusRows}
            />
          )}
          {requestsQuery.isPending ? null : (
            <DataTable
              title="Team requests"
              action=""
              cols="1.4fr 1fr 1fr 0.5fr 0.9fr"
              headers={["Employee", "Type", "Dates", "Days", "Status"]}
              rows={teamRequestRows}
            />
          )}
        </div>
      ) : null}

      {isStaff ? (
        <>
          <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-4">
            {balancesQuery.isPending
              ? null
              : stats.map((stat) => (
                  <MiniStat key={stat.label} label={stat.label} value={stat.value} sub={stat.sub} />
                ))}
          </div>

          {requestsQuery.isPending ? (
            <TableSkeleton />
          ) : requestsQuery.isError ? (
            <LoadError label="leave requests" onRetry={() => requestsQuery.refetch()} />
          ) : (
            <DataTable
              title="My requests"
              action=""
              cols="1fr 1fr 0.5fr 1fr 0.9fr 0.7fr"
              headers={["Type", "Dates", "Days", "Status", "Approver", ""]}
              rows={myRows}
            />
          )}
        </>
      ) : null}

      {isReviewer ? (
        <LeaveDetail
          request={viewing}
          open={!!viewing}
          onOpenChange={(next) => !next && setViewingId(null)}
          canDecide={canDecide}
          pending={approveMutation.isPending || rejectMutation.isPending || revertMutation.isPending}
          error={actionError}
          onApprove={(r) => approveMutation.mutate(r.id)}
          onReject={(r) => {
            setDecisionError(null)
            setDecision({ kind: "reject", id: r.id })
          }}
          onRevert={(r) => {
            setDecisionError(null)
            setDecision({ kind: "revert", id: r.id })
          }}
        />
      ) : null}

      {canDecide ? (
        <DecisionDialog
          key={decision ? `${decision.kind}-${decision.id}` : "none"}
          open={!!decision}
          onOpenChange={(next) => !next && setDecision(null)}
          title={decision?.kind === "revert" ? "Revert this approval" : "Reject this request"}
          confirmLabel={decision?.kind === "revert" ? "Revert approval" : "Reject request"}
          pending={rejectMutation.isPending || revertMutation.isPending}
          error={decisionError}
          onConfirm={(note) => {
            if (!decision) return
            if (decision.kind === "revert") {
              revertMutation.mutate({ id: decision.id, note })
            } else {
              rejectMutation.mutate({ id: decision.id, note })
            }
          }}
        />
      ) : null}

      {isStaff && accessToken ? (
        <ApplyLeaveDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          leaveTypes={typesQuery.data ?? []}
          balances={balances}
          accessToken={accessToken}
          onApplied={invalidateMine}
        />
      ) : null}
    </>
  )
}
