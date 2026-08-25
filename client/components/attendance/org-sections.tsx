"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine, RiHistoryLine, RiPencilLine } from "@remixicon/react"

import {
  correctAttendance,
  createHoliday,
  createManualAttendance,
  deleteHoliday,
  updateHoliday,
  getAuditTrail,
  getDailySummary,
  getEmployeeAttendance,
} from "@/lib/api/attendance"
import type {
  AttendanceEmployeeRef,
  AttendanceStatus,
  HolidayItem,
  HolidayType,
  ImpactBlock,
  MonthlyAttendanceSummary,
} from "@/lib/api/types"
import { ALL, FilterBar, FilterSelect } from "@/components/dashboard/filter-bar"
import { MiniStat } from "@/components/dashboard/page-header"
import {
  ConfirmDeleteDialog,
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  PanelNotice,
  PanelTable,
  RowActions,
  toMessage,
} from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import type { TableCell } from "@/components/dashboard/types"
import { TimeAmendmentDialog } from "@/components/attendance/time-amendment-dialog"
import { SectionHeading } from "@/components/attendance/attendance-ui"
import { AttendanceReports } from "@/components/attendance/report-panel"
import {
  APPROVAL_LABEL,
  HOLIDAY_TYPE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  formatClock,
  formatDayLabel,
  formatHours,
  formatMonthLabel,
} from "@/components/attendance/attendance-shared"

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as AttendanceStatus[])
  // NOT_TRACKED is a projection artefact rather than something a day can be
  // to a reader, and it never reaches these boards.
  .filter((s) => s !== "NOT_TRACKED")
  .map((value) => ({ value, label: STATUS_LABEL[value] }))

/** Matches whichever of the four identifiers the reader happens to know. */
function matches(employee: AttendanceEmployeeRef, needle: string): boolean {
  if (!needle) return true
  return [employee.fullName, employee.employeeCode, employee.designation].some((field) =>
    field.toLowerCase().includes(needle)
  )
}

export function OrgSections({
  accessToken,
  role,
  month,
  year,
  holidays,
  summaries,
  summaryPending,
  summaryError,
  onRetrySummary,
  onChanged,
}: {
  accessToken: string
  role: string
  month: number
  year: number
  holidays: HolidayItem[]
  summaries: MonthlyAttendanceSummary[]
  summaryPending: boolean
  summaryError: boolean
  onRetrySummary: () => void
  onChanged: () => void
}) {
  const isFinance = role === "FINANCE_OFFICER"
  const isHr = role === "HR_ADMIN" || role === "SUPER_ADMIN"

  const pendingTotal = summaries.reduce((sum, s) => sum + s.pendingApproval, 0)

  return (
    <>
      {/* Finance sees the payroll input and nothing else — no punch card, no
          queue, no corrections. A non-zero pending count is the condition
          that will stop a payroll run, so it reads as a block, not a note. */}
      {isFinance && pendingTotal > 0 ? (
        <div className="mt-6">
          <PanelAlert>
            {pendingTotal} attendance record{pendingTotal === 1 ? "" : "s"} across the org are
            still awaiting review. Payroll cannot run for {formatMonthLabel(month, year)} until
            they are decided.
          </PanelAlert>
        </div>
      ) : null}

      {!isFinance ? <DailyBoard accessToken={accessToken} /> : null}

      <MonthlyTable
        accessToken={accessToken}
        month={month}
        year={year}
        summaries={summaries}
        pending={summaryPending}
        isError={summaryError}
        onRetry={onRetrySummary}
        isHr={isHr}
        onChanged={onChanged}
      />

      {/* Every administrative role, Finance included: "what did attendance
          cost us last quarter" is a finance question, and the report is
          already scoped to the caller's roster on the server. */}
      <AttendanceReports accessToken={accessToken} />

      {isHr ? (
        <HolidayPanel
          accessToken={accessToken}
          year={year}
          holidays={holidays}
          onChanged={onChanged}
        />
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Today                                                                       */
/* -------------------------------------------------------------------------- */

function DailyBoard({ accessToken }: { accessToken: string }) {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string>(ALL)

  const dailyQuery = useQuery({
    queryKey: ["attendance", "daily", "today"],
    queryFn: () => getDailySummary(accessToken),
    // "Who is in right now" is the question this board exists to answer.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const summary = dailyQuery.data
  const all = useMemo(() => summary?.rows ?? [], [summary])

  const active = search.trim() !== "" || status !== ALL

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return all.filter((row) => {
      if (status !== ALL && row.status !== status) return false
      return matches(row.employee, needle)
    })
  }, [all, search, status])

  const rows: TableCell[][] = filtered.map((row) => [
    { text: row.employee.fullName, sub: row.employee.designation, weight: 600 },
    { tag: STATUS_LABEL[row.status], tone: STATUS_TONE[row.status], sub: row.detail ?? undefined },
    { text: formatClock(row.checkIn) },
    { text: formatClock(row.checkOut) },
    { text: formatHours(row.workedHours) },
  ])

  function clear() {
    setSearch("")
    setStatus(ALL)
  }

  return (
    <>
      <SectionHeading title="Today" sub="Live board, refreshed every minute." />

      {dailyQuery.isPending ? (
        <div className="mb-3.5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2.5 h-6 w-10" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : summary ? (
        <div className="mb-3.5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat
            label="Present"
            value={String(summary.totals.present)}
            sub={summary.totals.late === 0 ? "None late" : `${summary.totals.late} late`}
          />
          <MiniStat label="Absent" value={String(summary.totals.absent)} sub="No record today" />
          <MiniStat label="On leave" value={String(summary.totals.onLeave)} sub="Approved leave" />
          <MiniStat
            label="Not in yet"
            value={String(summary.totals.notCheckedIn)}
            sub="Working day, no check-in"
          />
        </div>
      ) : null}

      {summary && summary.conflicts.length > 0 ? (
        <div className="mb-3.5">
          {/* No dismiss: this is recomputed from the board on every poll, so
              hiding it would either be undone a minute later or hide a
              conflict that is still live. */}
          <PanelNotice>
            <strong>
              {summary.conflicts.length} person
              {summary.conflicts.length === 1 ? "" : "s"} checked in while on approved leave:
            </strong>{" "}
            {summary.conflicts.map((c) => c.fullName).join(", ")}. The check-in was recorded
            rather than blocked. Decide whether the leave should be cancelled.
          </PanelNotice>
        </div>
      ) : null}

      {!dailyQuery.isPending && !dailyQuery.isError ? (
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search name, code or role"
          shown={filtered.length}
          total={all.length}
          noun={all.length === 1 ? "person" : "people"}
          active={active}
          onClear={clear}
        >
          <FilterSelect
            label="Filter by status"
            value={status}
            onChange={setStatus}
            allLabel="All statuses"
            options={STATUS_OPTIONS}
          />
        </FilterBar>
      ) : null}

      <PanelTable
        cols="1.4fr 1fr 0.8fr 0.8fr 0.7fr"
        headers={["Employee", "Status", "Check in", "Check out", "Hours"]}
        rows={rows}
        isLoading={dailyQuery.isPending}
        isError={dailyQuery.isError}
        onRetry={() => dailyQuery.refetch()}
        emptyTitle={active ? "Nobody matches" : "Nobody on the board"}
        emptyBody={
          active
            ? "No one on today's board matches this search and this status together."
            : "Today is not a working day for anyone, or no employees have been added yet."
        }
        emptyAction={active ? "Clear filters" : "Refresh"}
        onEmptyAction={active ? clear : () => dailyQuery.refetch()}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Monthly summary                                                             */
/* -------------------------------------------------------------------------- */

function MonthlyTable({
  accessToken,
  month,
  year,
  summaries,
  pending,
  isError,
  onRetry,
  isHr,
  onChanged,
}: {
  accessToken: string
  month: number
  year: number
  summaries: MonthlyAttendanceSummary[]
  pending: boolean
  isError: boolean
  onRetry: () => void
  isHr: boolean
  onChanged: () => void
}) {
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState<AttendanceEmployeeRef | null>(null)

  const active = search.trim() !== ""

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return summaries.filter((s) => matches(s.employee, needle))
  }, [summaries, search])

  const rows: TableCell[][] = filtered.map((s) => [
    { text: s.employee.fullName, sub: s.employee.employeeCode, weight: 600 },
    { text: `${s.present} / ${s.workingDays}` },
    { text: String(s.absent) },
    { text: String(s.onLeave) },
    { text: String(s.late) },
    { text: formatHours(s.workedHours), sub: `of ${formatHours(s.expectedHours)}` },
    // A zero shortfall is a good outcome, not a missing value, so it says so
    // rather than leaving the cell to be read as "not calculated".
    s.shortfallHours > 0
      ? { text: formatHours(s.shortfallHours), tone: "yellow" }
      : { text: "None" },
    s.pendingApproval > 0
      ? { tag: `${s.pendingApproval} pending`, tone: "yellow" }
      : { text: s.approved > 0 ? `${s.approved} approved` : "Nothing to review" },
    isHr
      ? {
          node: (
            <RowActions
              actions={[
                {
                  kind: "custom",
                  label: "Open days",
                  icon: <RiPencilLine className="size-3.5" aria-hidden />,
                  onClick: () => setOpen(s.employee),
                },
              ]}
            />
          ),
        }
      : { text: "" },
  ])

  return (
    <>
      <SectionHeading
        title={`Monthly summary, ${formatMonthLabel(month, year)}`}
        sub={
          isHr
            ? "The figures payroll will consume. Shortfall is time owed against the shift, not absence. Open a row to correct a day."
            : "The figures payroll will consume."
        }
      />

      {!pending && !isError ? (
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search name, code or role"
          shown={filtered.length}
          total={summaries.length}
          noun={summaries.length === 1 ? "employee" : "employees"}
          active={active}
          onClear={() => setSearch("")}
        />
      ) : null}

      <PanelTable
        cols="1.4fr 0.8fr 0.6fr 0.7fr 0.6fr 1fr 0.8fr 0.9fr 0.8fr"
        headers={[
          "Employee",
          "Present",
          "Absent",
          "Leave",
          "Late",
          "Hours",
          "Shortfall",
          "Approval",
          "",
        ]}
        rows={rows}
        isLoading={pending}
        isError={isError}
        onRetry={onRetry}
        emptyTitle={active ? "Nobody matches" : "Nothing recorded this month"}
        emptyBody={
          active
            ? "No employee in this month's summary matches that search."
            : `No attendance has been recorded for ${formatMonthLabel(month, year)}. Check the month above, or whether the go-live date is later than this.`
        }
        emptyAction={active ? "Clear filters" : "Reload"}
        onEmptyAction={active ? () => setSearch("") : onRetry}
      />

      {open ? (
        <EmployeeDaysDialog
          key={open.id}
          accessToken={accessToken}
          employee={open}
          month={month}
          year={year}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
        />
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* HR's per-day tools                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One employee's days for the month, so a correction starts from the record
 * rather than from its id.
 *
 * This replaces a box that asked HR to paste an "attendance record id" copied
 * "from the employee's log". No screen in the app displayed one: the daily
 * board carries no id at all, and the monthly summary is per-employee-per-
 * month while a correction is per-day. The endpoint behind this dialog
 * already existed and returns days with their ids on them; nothing called it.
 */
function EmployeeDaysDialog({
  accessToken,
  employee,
  month,
  year,
  onClose,
  onChanged,
}: {
  accessToken: string
  employee: AttendanceEmployeeRef
  month: number
  year: number
  onClose: () => void
  onChanged: () => void
}) {
  const [correcting, setCorrecting] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [auditFor, setAuditFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const from = `${year}-${String(month).padStart(2, "0")}-01`
  const to = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`

  const daysQuery = useQuery({
    queryKey: ["attendance", "history", employee.id, year, month],
    queryFn: () => getEmployeeAttendance(accessToken, employee.id, from, to),
  })

  const correctMutation = useMutation({
    mutationFn: (body: { checkIn?: string; checkOut?: string; note: string }) =>
      correctAttendance(accessToken, correcting!, body),
    onSuccess: () => {
      setCorrecting(null)
      setError(null)
      daysQuery.refetch()
      onChanged()
    },
    onError: (err) => setError(toMessage(err)),
  })

  /**
   * A day with no stored record at all.
   *
   * `correctAttendance` amends an existing row, so it cannot reach a day that
   * was never punched: the device was down, someone was in the field, the
   * record was simply never created. Those days derive as ABSENT and feed
   * payroll that way, and the only route to fixing one was to have the
   * employee raise a regularisation. `createManualAttendance` is the HR side
   * of that, and it had no caller.
   */
  const manualMutation = useMutation({
    mutationFn: (body: { checkIn?: string; checkOut?: string; note: string }) =>
      createManualAttendance(accessToken, { employeeId: employee.id, date: adding!, ...body }),
    onSuccess: () => {
      setAdding(null)
      setError(null)
      daysQuery.refetch()
      onChanged()
    },
    onError: (err) => setError(toMessage(err)),
  })

  // A day that has not happened cannot have been worked. The server has its
  // own view on this; the point here is not to offer the action at all.
  const todayIso = new Date().toLocaleDateString("en-CA")

  const rows: TableCell[][] = (daysQuery.data ?? [])
    .filter((day) => day.status !== "NOT_TRACKED")
    .map((day) => [
      { text: formatDayLabel(day.date), weight: 600 },
      { text: formatClock(day.checkIn) },
      { text: formatClock(day.checkOut) },
      { tag: STATUS_LABEL[day.status], tone: STATUS_TONE[day.status] },
      {
        text: day.approval ? APPROVAL_LABEL[day.approval] : "Not raised",
        sub: day.corrected ? "Corrected by HR" : day.regularised ? "Employee amended" : undefined,
      },
      // Only a day with a stored record can be corrected. A derived absence
      // has nothing to edit, which is why the action is absent rather than
      // present and failing.
      day.attendanceId
        ? {
            node: (
              <RowActions
                actions={[
                  {
                    kind: "custom",
                    label: "Correct",
                    icon: <RiPencilLine className="size-3.5" aria-hidden />,
                    onClick: () => {
                      setError(null)
                      setCorrecting(day.attendanceId)
                    },
                  },
                  {
                    kind: "custom",
                    label: "History",
                    icon: <RiHistoryLine className="size-3.5" aria-hidden />,
                    onClick: () => setAuditFor(day.attendanceId),
                  },
                ]}
              />
            ),
          }
        : day.date <= todayIso
          ? {
              node: (
                <RowActions
                  actions={[
                    {
                      kind: "custom",
                      label: "Add a record",
                      icon: <RiAddLine className="size-3.5" aria-hidden />,
                      onClick: () => {
                        setError(null)
                        setAdding(day.date)
                      },
                    },
                  ]}
                />
              ),
            }
          : { text: "" },
    ])

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="sm:max-w-3xl!">
          <DialogHeader>
            <DialogTitle>
              {employee.fullName}, {formatMonthLabel(month, year)}
            </DialogTitle>
            <DialogDescription>
              A correction settles the record immediately. HR outranks the manager in this chain,
              and every change is kept in the record&apos;s history.
            </DialogDescription>
          </DialogHeader>

          {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

          <PanelTable
            cols="1fr 0.7fr 0.7fr 0.8fr 1fr 1fr"
            headers={["Date", "Check in", "Check out", "Status", "Approval", ""]}
            rows={rows}
            isLoading={daysQuery.isPending}
            isError={daysQuery.isError}
            onRetry={() => daysQuery.refetch()}
            emptyTitle="No days recorded"
            emptyBody={`${employee.fullName} has no attendance rows for ${formatMonthLabel(month, year)}.`}
            emptyAction="Reload"
            onEmptyAction={() => daysQuery.refetch()}
          />
        </DialogContent>
      </Dialog>

      {correcting ? (
        <TimeAmendmentDialog
          key={correcting}
          open
          onOpenChange={(next) => !next && setCorrecting(null)}
          title="Log a correction"
          description="This settles the record as approved and is written to its history with your name against it."
          confirmLabel="Save correction"
          pending={correctMutation.isPending}
          error={error}
          onConfirm={(body) => correctMutation.mutate(body)}
        />
      ) : null}

      {adding ? (
        <TimeAmendmentDialog
          key={adding}
          open
          onOpenChange={(next) => !next && setAdding(null)}
          title={`Add a record for ${formatDayLabel(adding)}`}
          description="There is no record for this day, so it currently derives as absent. Creating one settles it as approved and is written to its history with your name against it."
          confirmLabel="Create record"
          pending={manualMutation.isPending}
          error={error}
          onConfirm={(body) => manualMutation.mutate(body)}
        />
      ) : null}

      {auditFor ? (
        <AuditDialog accessToken={accessToken} id={auditFor} onClose={() => setAuditFor(null)} />
      ) : null}
    </>
  )
}

function AuditDialog({
  accessToken,
  id,
  onClose,
}: {
  accessToken: string
  id: string
  onClose: () => void
}) {
  const auditQuery = useQuery({
    queryKey: ["attendance", "audit", id],
    queryFn: () => getAuditTrail(accessToken, id),
  })

  const entries = auditQuery.data ?? []

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record history</DialogTitle>
          <DialogDescription>
            Every change, oldest first. This is what settles a dispute.
          </DialogDescription>
        </DialogHeader>

        {auditQuery.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border-l-2 border-[#E4E9EF] pl-3">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="mt-1.5 h-3 w-40" />
              </div>
            ))}
          </div>
        ) : auditQuery.isError ? (
          <PanelAlert>That history could not be loaded. Nothing has changed.</PanelAlert>
        ) : entries.length === 0 ? (
          <p className="text-[12.5px] text-[#5F6B7C]">
            Nothing has been changed on this record since it was created.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {entries.map((entry) => (
              <li key={entry.id} className="border-l-2 border-[#E4E9EF] pl-3">
                <div className="text-[12.5px] font-bold">{entry.action}</div>
                <div className="text-[11.5px] text-[#5F6B7C]">
                  {new Date(entry.changedAt).toLocaleString()}
                  {entry.changedBy ? ` by ${entry.changedBy}` : ""}
                </div>
                {entry.note ? (
                  <div className="mt-0.5 text-[12px] text-[#3D4756]">{entry.note}</div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/* Holidays                                                                    */
/* -------------------------------------------------------------------------- */

const HOLIDAY_TYPES: HolidayType[] = ["GENERAL", "EXECUTIVE_ORDER", "OPTIONAL", "WORKING_DAY"]

function HolidayPanel({
  accessToken,
  year,
  holidays,
  onChanged,
}: {
  accessToken: string
  year: number
  holidays: HolidayItem[]
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<HolidayItem | null>(null)
  const [deleting, setDeleting] = useState<HolidayItem | null>(null)
  const [impact, setImpact] = useState<ImpactBlock | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["holidays"] })
    // A holiday is an input to every derived day, so one edit changes every
    // employee's summary for that month.
    onChanged()
  }

  const createMutation = useMutation({
    mutationFn: (body: { name: string; date: string; type: HolidayType }) =>
      createHoliday(accessToken, body),
    onSuccess: (result) => {
      setAdding(false)
      setError(null)
      setImpact(result.impact ?? null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  /**
   * Correcting a holiday in place.
   *
   * `updateHoliday` existed on both sides with no caller, so the calendar was
   * add-and-delete only. A misspelt name or a gazette amendment meant deleting
   * the row and recreating it, and each of those re-derives attendance for
   * every employee on that date. Two full re-derivations to fix one letter.
   */
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
      derivationChanged,
    }: {
      id: string
      body: { name?: string; date?: string; type?: HolidayType }
      /** Whether the edit touched anything a derived day is computed from. */
      derivationChanged: boolean
    }) =>
      updateHoliday(accessToken, id, body).then((result) => ({ result, derivationChanged })),
    onSuccess: ({ result, derivationChanged }) => {
      setEditing(null)
      setError(null)
      // The server returns an impact block for every update, a rename
      // included. Renaming a holiday changes a label and nothing else, so
      // announcing that somebody's attendance totals moved would be false.
      setImpact(derivationChanged ? (result.impact ?? null) : null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHoliday(accessToken, id),
    onSuccess: (result) => {
      setDeleting(null)
      setImpact(result.impact ?? null)
      refresh()
    },
    onError: (err) => {
      setDeleting(null)
      setError(toMessage(err))
    },
  })

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title={`Holiday calendar, ${year}`}
          sub="Lunar dates move and the gazette gets amended, so this is yours to keep current."
        />
        <Button
          onClick={() => {
            setError(null)
            setAdding(true)
          }}
          className="mb-3.5 h-auto shrink-0 rounded-md bg-[#17191C] px-4 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
        >
          Add holiday
        </Button>
      </div>

      {/* The consequence of a backdated edit is invisible on this screen and
          lands in a different module, so it is stated rather than implied. */}
      {impact ? (
        <div className="mb-3.5">
          <PanelNotice onDismiss={() => setImpact(null)}>
            This affected <strong>{impact.affectedEmployees}</strong> employees across{" "}
            {impact.monthsTouched.join(", ")}. Their attendance totals have changed.
          </PanelNotice>
        </div>
      ) : null}

      {error ? (
        <div className="mb-3.5">
          <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert>
        </div>
      ) : null}

      <PanelTable
        cols="1.6fr 0.9fr 0.9fr 0.6fr"
        headers={["Holiday", "Date", "Type", ""]}
        rows={holidays.map((holiday) => [
          { text: holiday.name, weight: 600 },
          { text: formatDayLabel(holiday.date) },
          {
            text: HOLIDAY_TYPE_LABEL[holiday.type],
            sub: holiday.type === "WORKING_DAY" ? "Cancels the weekly off" : undefined,
          },
          {
            node: (
              <RowActions
                actions={[
                  {
                    kind: "edit",
                    label: "Edit",
                    onClick: () => {
                      setError(null)
                      setEditing(holiday)
                    },
                  },
                  {
                    kind: "delete",
                    label: "Delete",
                    onClick: () => {
                      setError(null)
                      setDeleting(holiday)
                    },
                  },
                ]}
              />
            ),
          },
        ])}
        // The list arrives with the page, so by the time this renders it has
        // either loaded or the page itself failed.
        isLoading={false}
        isError={false}
        onRetry={onChanged}
        emptyTitle={`No holidays set for ${year}`}
        emptyBody="Until one is added, every weekday counts as a working day and absences derive against it."
        emptyAction="Add holiday"
        onEmptyAction={() => {
          setError(null)
          setAdding(true)
        }}
      />

      {/* Deleting a holiday is not a list edit. It re-derives attendance for
          every employee on that date, which is why the confirm names the
          consequence rather than asking "are you sure". */}
      <ConfirmDeleteDialog
        open={!!deleting}
        what={deleting ? `${deleting.name} on ${formatDayLabel(deleting.date)}` : "this holiday"}
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />

      {adding ? (
        <HolidayDialog
          holiday={null}
          onClose={() => setAdding(false)}
          pending={createMutation.isPending}
          error={error}
          onConfirm={(body) => createMutation.mutate(body)}
        />
      ) : null}

      {editing ? (
        <HolidayDialog
          // Keyed so opening a different row remounts and re-seeds the fields
          // from that holiday rather than keeping the previous one's.
          key={editing.id}
          holiday={editing}
          onClose={() => setEditing(null)}
          pending={updateMutation.isPending}
          error={error}
          onConfirm={(body) =>
            updateMutation.mutate({
              id: editing.id,
              body,
              // A rename alone changes no derived day. Only a date or type
              // edit does, and that decides whether the impact notice is
              // shown at all.
              derivationChanged: body.date !== editing.date || body.type !== editing.type,
            })
          }
        />
      ) : null}
    </>
  )
}

/**
 * One dialog, both modes. `holiday` is null to add and a row to correct.
 *
 * Kept as one component because the field set is identical and the rules
 * attached to those fields (a date re-derives, a working day cancels the
 * weekly off) would otherwise have to be written twice and kept in step.
 */
function HolidayDialog({
  holiday,
  onClose,
  pending,
  error,
  onConfirm,
}: {
  holiday: HolidayItem | null
  onClose: () => void
  pending: boolean
  error: string | null
  onConfirm: (body: { name: string; date: string; type: HolidayType }) => void
}) {
  // `HolidayItem.date` is a date-only string already, so no slicing.
  const [name, setName] = useState(holiday?.name ?? "")
  const [date, setDate] = useState(holiday?.date ?? "")
  const [type, setType] = useState<HolidayType>(holiday?.type ?? "GENERAL")

  const editing = !!holiday
  const moved = editing && date !== holiday.date
  const unchanged =
    editing && name.trim() === holiday.name && date === holiday.date && type === holiday.type

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit this holiday" : "Add a holiday"}</DialogTitle>
          <DialogDescription>
            Two different holidays may share a date. A working day cancels the weekly off instead
            of taking a day away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" htmlFor="holiday-name">
            <Input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label="Date" htmlFor="holiday-date">
            <Input
              id="holiday-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>

          <Field
            label="Type"
            hint={
              // Moving a holiday is a two-date event: the old date stops being
              // one and the new date starts, so both re-derive. The server
              // reports both in its impact, and the form says so beforehand.
              moved
                ? `Moving this re-derives attendance on both ${formatDayLabel(holiday.date)} and ${formatDayLabel(date)}.`
                : "A backdated date re-derives attendance for everyone on that day."
            }
          >
            <Select value={type} onValueChange={(v) => setType(v as HolidayType)}>
              <SelectTrigger id="holiday-type" className="w-full">
                <SelectValue>{(v: string | null) => HOLIDAY_TYPE_LABEL[v as HolidayType]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HOLIDAY_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {HOLIDAY_TYPE_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {error ? <FormError>{error}</FormError> : null}

          <DialogFooter>
            <DialogActions
              pending={pending}
              submitLabel={editing ? "Save changes" : "Add holiday"}
              // Nothing edited means nothing to send. Submitting an unchanged
              // form would still return an impact block and announce that
              // everyone's totals moved.
              disabled={!name.trim() || !date || unchanged}
              onCancel={onClose}
              onSubmit={() => onConfirm({ name: name.trim(), date, type })}
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
