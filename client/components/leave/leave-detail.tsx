"use client"

import {
  RiArrowGoBackLine,
  RiCalendarEventLine,
  RiCheckLine,
  RiChatQuoteLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiTimeLine,
  RiUser3Line,
  type RemixiconComponentType,
} from "@remixicon/react"

import type { LeaveRequestItem } from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import { TONE } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import {
  decidedByLabel,
  formatLeaveDays,
  formatSessionLabel,
  isFutureDated,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/components/leave/leave-shared"

/**
 * One leave request, in full, with the decision attached to it.
 *
 * The approve and reject buttons used to sit in the last column of the table,
 * two cramped controls beside six columns of summary. The field that decides
 * the answer — `reason` — was fetched from the server on every row and
 * rendered nowhere at all, so approvals were being made from dates and a name.
 *
 * Unlike `asset/request-detail.tsx`, which is read-only, the actions live here
 * rather than on the row: there is nowhere else to read the reason, so there is
 * nowhere else the decision should be made. The mutations themselves still
 * belong to the page, which owns the query invalidation they need.
 */

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function formatMoment(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

function Detail({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string
  value: string
  icon?: RemixiconComponentType
  sub?: string | null
}) {
  return (
    <div className="min-w-0">
      <div className={cn("text-caption font-bold uppercase", TONE.muted)}>{label}</div>
      <div className="mt-1 flex items-start gap-1.5 text-body-sm">
        {Icon ? <Icon className="mt-px size-4 shrink-0 text-ink-muted" aria-hidden /> : null}
        <span className="min-w-0">
          {value}
          {sub ? <span className={cn("block text-caption", TONE.muted)}>{sub}</span> : null}
        </span>
      </div>
    </div>
  )
}

export function LeaveDetail({
  request,
  open,
  onOpenChange,
  canDecide,
  pending,
  error,
  onApprove,
  onReject,
  onRevert,
}: {
  request: LeaveRequestItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** False for Finance, who sees every request and decides none. */
  canDecide: boolean
  pending: boolean
  /** The server's own refusal, verbatim — "balance is no longer sufficient". */
  error: string | null
  onApprove: (request: LeaveRequestItem) => void
  onReject: (request: LeaveRequestItem) => void
  onRevert: (request: LeaveRequestItem) => void
}) {
  const sessionLabel = request ? formatSessionLabel(request) : null

  // Approved leave that has not started yet can still be taken back. Once it
  // has begun there is attendance behind it, so the sheet offers nothing.
  const revertable =
    !!request && request.status === "APPROVED" && isFutureDated(request.startDate)
  const decidable = !!request && request.status === "PENDING"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        {!request ? null : (
          <>
            <SheetHeader>
              <SheetTitle>{request.employee.fullName}</SheetTitle>
              <SheetDescription>
                {request.employee.employeeCode} · {request.leaveType.name}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <Tag label={STATUS_LABEL[request.status]} tone={STATUS_TONE[request.status]} />
                <Tag
                  label={request.leaveType.isPaid ? "Paid" : "Unpaid"}
                  tone={request.leaveType.isPaid ? "neutral" : "yellow"}
                />
              </div>

              {/* The whole reason this sheet exists. Quoted rather than set as
                  plain text so it reads as the employee's words. */}
              <div>
                <div className={cn("text-caption font-bold uppercase", TONE.muted)}>Reason given</div>
                {request.reason ? (
                  <blockquote className="mt-1.5 flex gap-2 border-l-2 border-line pl-3 text-body-sm leading-relaxed text-ink-soft">
                    <RiChatQuoteLine className="mt-0.5 size-4 shrink-0 text-line-strong" aria-hidden />
                    <span>{request.reason}</span>
                  </blockquote>
                ) : (
                  // Optional on the form, so its absence is a fact about the
                  // request rather than a gap in this screen.
                  <p className={cn("mt-1.5 text-body-sm italic", TONE.muted)}>
                    No reason was given.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-surface-sunken pt-4">
                <Detail
                  label="From"
                  value={formatFullDate(request.startDate)}
                  icon={RiCalendarEventLine}
                />
                <Detail
                  label="To"
                  value={formatFullDate(request.endDate)}
                  icon={RiCalendarEventLine}
                />
                <Detail
                  label="Days"
                  value={formatLeaveDays(request.days)}
                  icon={RiTimeLine}
                  sub={sessionLabel}
                />
                <Detail
                  label="Requested"
                  value={formatMoment(request.createdAt)}
                  icon={RiUser3Line}
                />
              </div>

              {/* Only once somebody has decided. A pending request showing an
                  empty "Decision" block reads as a failure to load one. */}
              {request.status !== "PENDING" ? (
                <div className="border-t border-surface-sunken pt-4">
                  <div className={cn("text-caption font-bold uppercase", TONE.muted)}>Decision</div>
                  <div className="mt-1 text-body-sm">
                    {STATUS_LABEL[request.status]} by {decidedByLabel(request.decidedBy)}
                    {request.decidedAt ? ` · ${formatMoment(request.decidedAt)}` : ""}
                  </div>
                  {request.decisionNote ? (
                    <p className="mt-2 border-l-2 border-line pl-3 text-caption leading-relaxed text-ink-soft">
                      {request.decisionNote}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-tint px-3.5 py-3 text-caption leading-relaxed font-semibold text-danger"
                >
                  <RiErrorWarningLine className="mt-px size-4 shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              ) : null}

              {canDecide && (decidable || revertable) ? (
                // Pinned to the bottom of the sheet, so a long reason does not
                // push the decision below the fold.
                <div className="mt-auto flex flex-wrap gap-2 border-t border-surface-sunken pt-4">
                  {decidable ? (
                    <>
                      <Button
                        type="button"
                        disabled={pending}
                        onClick={() => onApprove(request)}
                        className="h-auto rounded-md bg-ink px-3.5 py-2 text-caption font-bold text-white hover:bg-ink-strong"
                      >
                        <RiCheckLine className="size-4" aria-hidden />
                        Approve
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => onReject(request)}
                        className="h-auto rounded-md px-3.5 py-2 text-caption font-bold text-danger hover:bg-danger-tint"
                      >
                        <RiCloseLine className="size-4" aria-hidden />
                        Reject
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => onRevert(request)}
                        className="h-auto rounded-md px-3.5 py-2 text-caption font-bold"
                      >
                        <RiArrowGoBackLine className="size-4" aria-hidden />
                        Revert approval
                      </Button>
                      <p className={cn("w-full text-caption leading-relaxed", TONE.muted)}>
                        This leave has not started yet, so the approval can still be taken back.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
