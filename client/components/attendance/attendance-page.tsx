"use client"

import { useCallback, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiAlertLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCalendarLine,
  RiListUnordered,
  RiPencilLine,
} from "@remixicon/react"

import {
  checkIn as checkInApi,
  checkOut as checkOutApi,
  getMonthlySummary,
  getMyAttendance,
  getToday,
  listHolidays,
  regulariseAttendance,
} from "@/lib/api/attendance"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { AttendanceDay } from "@/lib/api/types"
import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import { PanelTable, RowActions } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { TableCell } from "@/components/dashboard/types"
import { AttendanceCalendar } from "@/components/attendance/attendance-calendar"
import { PunchCard } from "@/components/attendance/punch-card"
import { TimeAmendmentDialog } from "@/components/attendance/time-amendment-dialog"
import { ApprovalsSection } from "@/components/attendance/approvals-section"
import { OrgSections } from "@/components/attendance/org-sections"
import {
  APPROVAL_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  currentMonth,
  formatClock,
  formatDayLabel,
  formatHours,
  formatMonthLabel,
  toTimeInput,
} from "@/components/attendance/attendance-shared"

/** Roles with an Employee profile — the only ones who punch. */
const STAFF_ROLES = ["EMPLOYEE", "REPORTING_MANAGER"]
const APPROVER_ROLES = ["REPORTING_MANAGER", "HR_ADMIN", "SUPER_ADMIN"]
const ORG_ROLES = ["HR_ADMIN", "SUPER_ADMIN", "FINANCE_OFFICER"]
const HR_ROLES = ["HR_ADMIN", "SUPER_ADMIN"]

/** Days an employee may still fix themselves, mirroring MAX_REGULARISE_DAYS. */
const REGULARISE_WINDOW_DAYS = 14

const VIEW_MODES = [
  { mode: "list" as const, label: "List", Icon: RiListUnordered },
  { mode: "calendar" as const, label: "Calendar", Icon: RiCalendarLine },
]

/**
 * A month-shaped placeholder, so switching to the calendar while the month
 * loads does not swap the page's shape twice.
 */
function CalendarLoading() {
  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <div className="rounded-md border border-[#E4E9EF] bg-white p-4">
        <Skeleton className="mx-auto h-6 w-36" />
        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {/* Six rows of seven: the largest a month grid ever gets, so the
              block never grows as the real calendar lands. */}
          {Array.from({ length: 42 }, (_, i) => (
            <Skeleton key={i} className="size-8 rounded" />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 border-t border-[#EEF1F5] pt-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-3 w-16" />
          ))}
        </div>
      </div>
      <div className="rounded-md border border-[#E4E9EF] bg-white p-5.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="mt-3 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-2/3" />
      </div>
    </div>
  )
}

export function AttendancePage() {
  const { accessToken, user, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()

  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const role = user?.role
  const isStaff = !!role && STAFF_ROLES.includes(role)
  const isApprover = !!role && APPROVER_ROLES.includes(role)
  const isOrg = !!role && ORG_ROLES.includes(role)
  const isHr = !!role && HR_ROLES.includes(role)

  const [{ month, year }, setPeriod] = useState(currentMonth)
  const [view, setView] = useState<"list" | "calendar">("list")
  const [punchError, setPunchError] = useState<string | null>(null)
  const [amending, setAmending] = useState<AttendanceDay | null>(null)
  const [amendError, setAmendError] = useState<string | null>(null)

  const todayQuery = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: () => getToday(accessToken!),
    enabled: isAuthed && isStaff,
    refetchOnWindowFocus: true,
  })

  const from = `${year}-${String(month).padStart(2, "0")}-01`
  const to = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`

  const daysQuery = useQuery({
    queryKey: ["attendance", "me", year, month],
    queryFn: () => getMyAttendance(accessToken!, from, to),
    enabled: isAuthed && isStaff,
  })

  const summaryQuery = useQuery({
    queryKey: ["attendance", "monthly", year, month],
    queryFn: () => getMonthlySummary(accessToken!, month, year),
    enabled: isAuthed,
  })

  const holidaysQuery = useQuery({
    queryKey: ["holidays", year],
    queryFn: () => listHolidays(accessToken!, year),
    enabled: isAuthed,
  })

  const invalidateAll = useCallback(() => {
    // A holiday or a decision changes every derived day, so the whole
    // prefix goes rather than one key.
    queryClient.invalidateQueries({ queryKey: ["attendance"] })
  }, [queryClient])

  const punchMutation = useMutation({
    mutationFn: (kind: "in" | "out") =>
      kind === "in" ? checkInApi(accessToken!) : checkOutApi(accessToken!),
    onSuccess: () => {
      setPunchError(null)
      invalidateAll()
    },
    onError: (err) => {
      // A duplicate check-in means you are already checked in, which is the
      // outcome the user wanted — treat it as success and refetch rather
      // than showing an error for a button that did its job.
      if (err instanceof ApiError && err.message.includes("already checked in")) {
        setPunchError(null)
        invalidateAll()
        return
      }
      // Says what is true now rather than shouting. The old copy was
      // "Check-in failed - you are NOT checked in", which is both a dash and
      // a capitalised word doing the work a plain sentence does better, and
      // it named check-in on a button that also checks out.
      setPunchError(
        err instanceof ApiError
          ? err.message
          : "That did not go through. Nothing was recorded. Please try again."
      )
    },
  })

  const regulariseMutation = useMutation({
    mutationFn: (vars: { id: string; body: { checkIn?: string; checkOut?: string; note: string } }) =>
      regulariseAttendance(accessToken!, vars.id, vars.body),
    onSuccess: () => {
      setAmending(null)
      setAmendError(null)
      invalidateAll()
    },
    onError: (err) => {
      setAmendError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const days = useMemo(() => daysQuery.data ?? [], [daysQuery.data])
  const ownSummary = summaryQuery.data?.[0]

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1)
    setPeriod({ month: next.getMonth() + 1, year: next.getFullYear() })
  }

  /**
   * Any tracked day that has not been approved, inside the amendment window.
   *
   * This used to require a *missing* check-out — `|| day.checkOut` returned
   * false the moment one existed. So somebody who tapped Check out by mistake
   * at 11:00 lost the only control that could fix it, and a day rejected by
   * their approver offered them nothing at all. The clock cannot help there
   * either: a punch records `now`, so re-opening it at 15:00 would write 15:00
   * over a 09:00 start. Typing the real time is the only honest remedy, and
   * this is the button that does it.
   *
   * The conditions below are the server's own, no stricter:
   * `regulariseAttendance` refuses an APPROVED record and anything older than
   * MAX_REGULARISE_DAYS, and accepts everything else — REJECTED included.
   */
  const canAmend = useCallback((day: AttendanceDay) => {
    // No row means there is nothing to amend: an untouched day is HR's to
    // enter, through `createManualAttendance`.
    if (!day.attendanceId) return false
    if (day.approval === "APPROVED") return false
    const age = (Date.now() - new Date(`${day.date}T00:00:00`).getTime()) / 86_400_000
    return age <= REGULARISE_WINDOW_DAYS
  }, [])

  const rows: TableCell[][] = days
    .filter((day) => day.status !== "NOT_TRACKED")
    .map((day) => [
      { text: formatDayLabel(day.date), weight: 600 },
      { text: formatClock(day.checkIn) },
      { text: formatClock(day.checkOut) },
      { text: formatHours(day.workedHours) },
      {
        tag: STATUS_LABEL[day.status],
        tone: STATUS_TONE[day.status],
        sub: day.isLate ? "Late" : day.isEarlyOut ? "Left early" : (day.detail ?? undefined),
      },
      {
        // "Not raised" rather than a dash: most days never need a review, so
        // this cell is blank on the majority of rows and a glyph there reads
        // as a missing value rather than a normal one.
        text: day.approval ? APPROVAL_LABEL[day.approval] : "Not raised",
        sub: day.corrected
          ? "Edited by HR"
          : day.regularised
            ? "You amended this"
            : day.autoCheckOut
              ? "Closed at shift end"
              : undefined,
      },
      canAmend(day)
        ? {
            node: (
              <RowActions
                actions={[
                  {
                    kind: "custom",
                    // A rejected day has already been round the loop once, so
                    // "Fix this day" undersells what the button is for.
                    label: day.approval === "REJECTED" ? "Fix and resend" : "Fix this day",
                    icon: <RiPencilLine className="size-3.5" aria-hidden />,
                    onClick: () => {
                      setAmendError(null)
                      setAmending(day)
                    },
                  },
                ]}
              />
            ),
          }
        : { text: "" },
    ])

  if (sessionStatus === "loading") {
    return (
      <div className="space-y-3 pt-7">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        kicker="Workspace"
        title="Attendance"
        sub="Daily check-ins, hours, and exceptions"
        aside={
          // A group, not two loose buttons: the label between them is the
          // control's value, so it is announced with them rather than read as
          // stray text sitting between two arrows.
          <div
            role="group"
            aria-label="Month shown"
            className="flex items-center gap-0.5 rounded-md border border-[#E4E9EF] bg-white p-0.5"
          >
            <Button
              type="button"
              variant="ghost"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
              className="size-8 rounded p-0 text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
            >
              <RiArrowLeftSLine className="size-4" aria-hidden />
            </Button>
            <span aria-live="polite" className="min-w-[130px] text-center text-[13px] font-bold">
              {formatMonthLabel(month, year)}
            </span>
            <Button
              type="button"
              variant="ghost"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
              className="size-8 rounded p-0 text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
            >
              <RiArrowRightSLine className="size-4" aria-hidden />
            </Button>
          </div>
        }
      />

      {isStaff ? (
        <>
          <PunchCard
            today={todayQuery.data}
            isLoading={todayQuery.isPending}
            isPunching={punchMutation.isPending}
            error={punchError}
            onCheckIn={() => punchMutation.mutate("in")}
            onCheckOut={() => punchMutation.mutate("out")}
            onDayRollover={() => todayQuery.refetch()}
          />

          <UnresolvedDays days={days} onFix={(day) => { setAmendError(null); setAmending(day) }} />

          {/* Skeletons rather than dashes while the month loads. A card
              reading "—" over "No data yet" is a value the reader has to
              decide about; a skeleton is not. */}
          <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {summaryQuery.isPending ? (
              [0, 1, 2].map((i) => (
                <div key={i} className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-2.5 h-6 w-12" />
                  <Skeleton className="mt-2 h-3 w-28" />
                </div>
              ))
            ) : (
              <>
                <MiniStat
                  label="This month"
                  value={
                    ownSummary && ownSummary.workingDays > 0
                      ? `${Math.round((ownSummary.present / ownSummary.workingDays) * 100)}%`
                      : "0%"
                  }
                  sub={
                    ownSummary
                      ? `${ownSummary.present} of ${ownSummary.workingDays} working days`
                      : "Nothing recorded this month"
                  }
                />
                <MiniStat
                  label="Late check-ins"
                  value={String(ownSummary?.late ?? 0)}
                  sub={`Grace ${todayQuery.data?.shift.graceMinutes ?? 15} minutes`}
                />
                <MiniStat
                  label="Avg hours / day"
                  value={
                    ownSummary && ownSummary.present > 0
                      ? formatHours(ownSummary.workedHours / ownSummary.present)
                      : "None yet"
                  }
                  sub={
                    todayQuery.data
                      ? `Expected ${formatHours(todayQuery.data.shift.expectedHours)}`
                      : "Against your shift"
                  }
                />
                {/* Only rendered when there is something to act on. A silent
                    exception is what surprises somebody on payday. */}
                {ownSummary &&
                (ownSummary.missingCheckOut > 0 || ownSummary.pendingApproval > 0) ? (
                  <MiniStat
                    label="Needs attention"
                    value={String(ownSummary.missingCheckOut + ownSummary.pendingApproval)}
                    sub={`${ownSummary.missingCheckOut} missing check-out, ${ownSummary.pendingApproval} awaiting review`}
                  />
                ) : null}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-7 pb-3.5">
            <h2 className="font-heading text-[16px] font-bold tracking-tight">
              Attendance log, {formatMonthLabel(month, year)}
            </h2>
            {/* aria-pressed, because these are two toggles over one view and
                not two links. Without it a screen reader announces "list" and
                "calendar" with no indication which one is showing. */}
            <div
              role="group"
              aria-label="Log view"
              className="flex rounded-md border border-[#E4E9EF] bg-white p-0.5"
            >
              {VIEW_MODES.map(({ mode, label, Icon }) => (
                <Button
                  key={mode}
                  type="button"
                  // `ghost` rather than the default variant: without it the
                  // button's own background and shadow sit under these
                  // classes and the unselected half reads as a raised
                  // control rather than as the other half of a toggle.
                  variant="ghost"
                  size="sm"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={cn(
                    "gap-1.5 rounded px-3 text-[12px] transition-colors",
                    view === mode
                      ? "bg-[#17191C] font-bold text-white hover:bg-[#17191C] hover:text-white"
                      : "font-semibold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* The view you chose is the view you keep, loading or not. This
              used to fall through to the table whenever the month was still
              loading, so picking Calendar showed a table skeleton and then
              swapped shape underneath you. */}
          {view === "calendar" && daysQuery.isPending ? (
            <CalendarLoading />
          ) : view === "calendar" && !daysQuery.isError ? (
            <AttendanceCalendar
              days={days}
              holidays={holidaysQuery.data ?? []}
              month={month}
              year={year}
            />
          ) : (
            <PanelTable
              cols="1.1fr 0.8fr 0.8fr 0.7fr 1fr 1.1fr 0.9fr"
              headers={["Date", "Check in", "Check out", "Hours", "Status", "Approval", ""]}
              rows={rows}
              isLoading={daysQuery.isPending}
              isError={daysQuery.isError}
              onRetry={() => daysQuery.refetch()}
              emptyTitle="Nothing recorded this month"
              emptyBody={`You have no tracked days in ${formatMonthLabel(month, year)}. If that looks wrong, check the month above.`}
              emptyAction="Reload"
              onEmptyAction={() => daysQuery.refetch()}
            />
          )}
        </>
      ) : null}

      {isApprover ? <ApprovalsSection accessToken={accessToken!} isHr={isHr} /> : null}

      {isOrg ? (
        <OrgSections
          accessToken={accessToken!}
          role={role!}
          month={month}
          year={year}
          holidays={holidaysQuery.data ?? []}
          summaries={summaryQuery.data ?? []}
          summaryPending={summaryQuery.isPending}
          summaryError={summaryQuery.isError}
          onRetrySummary={() => summaryQuery.refetch()}
          onChanged={invalidateAll}
        />
      ) : null}

      {amending ? (
        <TimeAmendmentDialog
          key={amending.attendanceId ?? amending.date}
          open
          onOpenChange={(open) => {
            if (!open) setAmending(null)
          }}
          title={`Fix ${formatDayLabel(amending.date)}`}
          description={
            amending.approval === "REJECTED"
              ? "Your last submission for this day was rejected. Correct the times and send it again — it goes back to your manager for review."
              : "This goes to your manager for review. It cannot approve itself, because you are supplying a time nobody else recorded."
          }
          confirmLabel="Send to my manager"
          // Prefilled, so fixing a mistaken check-out means editing the wrong
          // time rather than recalling it into an empty box. A field left
          // untouched is sent unchanged and lands on the same value.
          defaultCheckIn={toTimeInput(amending.checkIn)}
          defaultCheckOut={toTimeInput(amending.checkOut)}
          pending={regulariseMutation.isPending}
          error={amendError}
          onConfirm={(body) =>
            regulariseMutation.mutate({ id: amending.attendanceId!, body })
          }
        />
      ) : null}
    </>
  )
}

/**
 * The days that need this person's attention, said before they scroll to the
 * table and notice an odd cell.
 *
 * Two kinds, and they read differently on purpose. A day the nightly job
 * closed carries a time the employee never punched — they are the only person
 * who knows whether 18:00 is right, and if they say nothing it is what their
 * approver sees. A day still open is one the job could not guess at, which
 * blocks payroll until somebody resolves it.
 *
 * Bounded to the month on screen, because that is the data the page has. The
 * bell notification is what reaches somebody who is not looking at this page
 * at all.
 */
function UnresolvedDays({
  days,
  onFix,
}: {
  days: AttendanceDay[]
  onFix: (day: AttendanceDay) => void
}) {
  const unresolved = days.filter(
    (day) =>
      day.attendanceId &&
      day.approval !== "APPROVED" &&
      (day.autoCheckOut || (day.checkIn && !day.checkOut))
  )
  if (unresolved.length === 0) return null

  return (
    <div className="mt-4 space-y-2">
      {unresolved.map((day) => {
        const guessed = day.autoCheckOut
        return (
          <div
            key={day.date}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-4 py-3"
          >
            <RiAlertLine className="size-4 shrink-0 text-[#8A5E0C]" aria-hidden />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-[#8A5E0C]">
              {guessed ? (
                <>
                  You didn&apos;t check out on <strong>{formatDayLabel(day.date)}</strong>, so it was
                  closed at {formatClock(day.checkOut)} — the end of your shift.{" "}
                  <span className="font-semibold">Fix it if you left at a different time.</span>
                </>
              ) : (
                <>
                  <strong>{formatDayLabel(day.date)}</strong> has no check-out, and it can&apos;t be
                  approved until it does.
                </>
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 border-[#E4CFA6] bg-white text-[#8A5E0C] hover:bg-[#FBF3E4]"
              onClick={() => onFix(day)}
            >
              <RiPencilLine className="size-3.5" aria-hidden />
              Fix this day
            </Button>
          </div>
        )
      })}
    </div>
  )
}
