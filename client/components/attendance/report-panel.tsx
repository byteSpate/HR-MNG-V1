"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiDownloadLine, RiFileTextLine, RiFilterOffLine } from "@remixicon/react"

import {
  downloadAttendanceReport,
  getAttendanceReport,
  type AttendanceReportQuery,
  type ReportFormat,
} from "@/lib/api/attendance"
import type {
  AttendanceEmployeeRef,
  AttendanceReport,
  ReportGranularity,
} from "@/lib/api/types"
import { toDateString, cn } from "@/lib/utils"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { FilterBar } from "@/components/dashboard/filter-bar"
import { MiniStat } from "@/components/dashboard/page-header"
import { PanelAlert, PanelTable, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { SectionHeading } from "@/components/attendance/attendance-ui"
import {
  STATUS_LABEL,
  STATUS_TONE,
  formatClock,
  formatDayLabel,
  formatHours,
} from "@/components/attendance/attendance-shared"

/**
 * Attendance reporting: daily, weekly, monthly and custom ranges, exportable.
 *
 * The four "report types" HR asked for are one range query with different
 * bounds, so the presets set the dates and nothing else changes. That is why
 * there is one panel here rather than four tabs — four tabs would have been
 * four places for the same numbers to disagree.
 *
 * Every figure on screen comes from the server's `totals`, never re-added in
 * the browser. Half-days are fractional, and a client that sums them itself
 * gets 1.5000000000000002 into a printed report.
 */

type Preset = "today" | "week" | "month" | "custom"

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom range" },
]

const GRANULARITIES: { value: ReportGranularity; label: string; hint: string }[] = [
  { value: "summary", label: "Per employee", hint: "One row per person, totalled over the range" },
  { value: "daily", label: "Day by day", hint: "One row per person per day" },
]

/**
 * The week runs Saturday to Friday, matching the default shift's weekly off
 * (`weeklyOffDays: [5]`) and the working week in Bangladesh. Starting it on
 * Monday would split every weekend across two reports.
 */
function weekRange(today: Date): { from: string; to: string } {
  const start = new Date(today)
  // getDay(): 0=Sun … 6=Sat. Saturday is the first working day.
  start.setDate(start.getDate() - ((today.getDay() + 1) % 7))
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { from: toDateString(start), to: toDateString(end) }
}

function monthRange(today: Date): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  return { from: toDateString(start), to: toDateString(end) }
}

function rangeFor(preset: Preset, today: Date): { from: string; to: string } | null {
  if (preset === "today") {
    const iso = toDateString(today)
    return { from: iso, to: iso }
  }
  if (preset === "week") return weekRange(today)
  if (preset === "month") return monthRange(today)
  // Custom keeps whatever the user already picked.
  return null
}

/**
 * Matches whichever identifier the reader happens to know — including the
 * department, now that it is a column. A visible column the search box ignores
 * is a control that cannot do anything.
 */
function matches(employee: AttendanceEmployeeRef, department: string, needle: string): boolean {
  if (!needle) return true
  return [employee.fullName, employee.employeeCode, employee.designation, department].some(
    (field) => field.toLowerCase().includes(needle)
  )
}

export function AttendanceReports({ accessToken }: { accessToken: string }) {
  const today = useMemo(() => new Date(), [])
  const initial = useMemo(() => monthRange(today), [today])

  const [preset, setPreset] = useState<Preset>("month")
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [granularity, setGranularity] = useState<ReportGranularity>("summary")
  const [search, setSearch] = useState("")
  /** Which export is in flight, so only that button says "Preparing…". */
  const [downloading, setDownloading] = useState<ReportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const query: AttendanceReportQuery = { from, to, granularity }

  const reportQuery = useQuery({
    queryKey: ["attendance", "report", from, to, granularity],
    queryFn: () => getAttendanceReport(accessToken, query),
    // A range that runs backwards is a 400, and asking for it on every
    // keystroke of a date edit would flash an error the user has not finished
    // causing yet.
    enabled: !!accessToken && from <= to,
  })

  function applyPreset(next: Preset) {
    setPreset(next)
    const range = rangeFor(next, today)
    if (range) {
      setFrom(range.from)
      setTo(range.to)
    }
  }

  /** Editing a date by hand means the preset no longer describes the range. */
  function editFrom(value: string) {
    setFrom(value)
    setPreset("custom")
  }

  function editTo(value: string) {
    setTo(value)
    setPreset("custom")
  }

  /**
   * PDF is the document you hand to somebody; CSV is the same report for a
   * spreadsheet. Both are built server-side from the report already on screen,
   * so neither can print a figure this table does not show.
   */
  async function exportReport(format: ReportFormat) {
    setDownloading(format)
    setError(null)
    try {
      const blob = await downloadAttendanceReport(accessToken, query, format)
      downloadBlob(blob, `attendance-${granularity}-${from}-to-${to}.${format}`)
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setDownloading(null)
    }
  }

  const report = reportQuery.data
  const invalidRange = from > to
  const exportBlocked = downloading !== null || invalidRange || !report || reportQuery.isPending

  const { headers, cols, rows, total, shown } = useMemo(
    () => buildTable(report, search, granularity),
    [report, search, granularity]
  )

  const active = search.trim() !== ""

  return (
    <>
      <SectionHeading
        title="Reports"
        sub="Attendance for any range: on screen, as a PDF to print or send, or as a spreadsheet. Figures match the monthly summary above — all of them read the same records."
      />

      <div className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4.5">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          <div>
            <Label className="mb-1.5 block text-xs font-bold">Period</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={preset === option.value ? "default" : "outline"}
                  onClick={() => applyPreset(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="w-40">
            <Label className="mb-1.5 block text-xs font-bold">From</Label>
            <DatePicker value={from} onChange={editFrom} />
          </div>

          <div className="w-40">
            <Label className="mb-1.5 block text-xs font-bold">To</Label>
            {/* Nothing before the start of the range is a valid end for it. */}
            <DatePicker value={to} onChange={editTo} min={from || undefined} />
          </div>

          <div>
            <Label className="mb-1.5 block text-xs font-bold">Detail</Label>
            <div className="flex flex-wrap gap-1.5">
              {GRANULARITIES.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  title={option.hint}
                  variant={granularity === option.value ? "default" : "outline"}
                  onClick={() => setGranularity(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Exporting a report that failed to load would download an error,
              so both buttons wait for one that did. */}
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={exportBlocked}
              onClick={() => exportReport("pdf")}
            >
              <RiFileTextLine className="size-3.5" aria-hidden />
              {downloading === "pdf" ? "Preparing…" : "Download PDF"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exportBlocked}
              onClick={() => exportReport("csv")}
            >
              <RiDownloadLine className="size-3.5" aria-hidden />
              {downloading === "csv" ? "Preparing…" : "CSV"}
            </Button>
          </div>
        </div>
      </div>

      {invalidRange ? (
        <div className="mt-3.5">
          <PanelAlert>
            The end of the range is before its start. Pick a later end date.
          </PanelAlert>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3.5">
          {/* Verbatim: the server's refusal carries the range and the cap. */}
          <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert>
        </div>
      ) : null}

      {report && !reportQuery.isPending ? (
        <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat
            label="Present"
            value={String(report.totals.present)}
            sub={
              report.totals.workingDays === 0
                ? "No working days in this range"
                : `of ${report.totals.workingDays} working days`
            }
          />
          <MiniStat
            label="Absent"
            value={String(report.totals.absent)}
            sub={`${report.totals.onLeave} on approved leave`}
          />
          <MiniStat
            label="Late"
            value={String(report.totals.late)}
            sub={`${report.totals.earlyOut} left early`}
          />
          <MiniStat
            label="Hours worked"
            value={formatHours(report.totals.workedHours)}
            sub={
              report.totals.shortfallHours > 0
                ? `${formatHours(report.totals.shortfallHours)} short of expected`
                : "No shortfall"
            }
          />
        </div>
      ) : null}

      {report && report.totals.pendingApproval > 0 ? (
        <div className="mt-3.5">
          <PanelAlert>
            {report.totals.pendingApproval} record
            {report.totals.pendingApproval === 1 ? " in" : "s in"} this range
            {report.totals.pendingApproval === 1 ? " is" : " are"} still awaiting approval, so
            these figures can still change.
          </PanelAlert>
        </div>
      ) : null}

      {/* Hidden while the first page loads: a count beside a skeleton reads as
          an answer. */}
      {!reportQuery.isPending && !reportQuery.isError && report ? (
        <div className="mt-3.5">
          <FilterBar
            search={search}
            onSearch={setSearch}
            placeholder="Search name, code or role"
            shown={shown}
            total={total}
            noun={granularity === "daily" ? (total === 1 ? "row" : "rows") : total === 1 ? "person" : "people"}
            active={active}
            onClear={() => setSearch("")}
          />
        </div>
      ) : null}

      <PanelTable
        cols={cols}
        headers={headers}
        rows={rows}
        isLoading={reportQuery.isPending && !invalidRange}
        isError={reportQuery.isError}
        onRetry={() => reportQuery.refetch()}
        emptyTitle={active ? "Nobody matches" : "Nothing in this range"}
        emptyBody={
          active
            ? "No row in this report matches that search."
            : report && report.headcount === 0
              ? "There is nobody on your roster to report on."
              : "No attendance was recorded between these dates. Check the range, or whether the go-live date is later than it."
        }
        emptyAction={active ? "Clear search" : "This month"}
        emptyActionIcon={active ? <RiFilterOffLine className="size-3.5" aria-hidden /> : undefined}
        onEmptyAction={active ? () => setSearch("") : () => applyPreset("month")}
      />
    </>
  )
}

/**
 * The two granularities are genuinely different documents, so they get
 * different columns rather than one table with blanks in half of it.
 */
function buildTable(
  report: AttendanceReport | undefined,
  search: string,
  granularity: ReportGranularity
): { headers: string[]; cols: string; rows: TableCell[][]; total: number; shown: number } {
  const needle = search.trim().toLowerCase()

  if (granularity === "daily") {
    const all = report?.days ?? []
    const filtered = all.filter((d) => matches(d.employee, d.department, needle))
    return {
      headers: ["Date", "Employee", "Department", "Status", "Check in", "Check out", "Hours"],
      cols: "0.9fr 1.4fr 1fr 1fr 0.7fr 0.7fr 0.6fr",
      total: all.length,
      shown: filtered.length,
      rows: filtered.map((d) => [
        { text: formatDayLabel(d.date) },
        { text: d.employee.fullName, sub: d.employee.employeeCode, weight: 600 },
        { text: d.department },
        {
          tag: STATUS_LABEL[d.status],
          tone: STATUS_TONE[d.status],
          sub: d.detail ?? undefined,
        },
        { text: formatClock(d.checkIn) },
        {
          node: (
            <span className="flex items-center gap-1.5">
              {formatClock(d.checkOut)}
              {/* A guessed check-out must never read as a punched one. */}
              {d.autoCheckOut ? <Tag label="Auto" tone="yellow" /> : null}
            </span>
          ),
        },
        { text: formatHours(d.workedHours) },
      ]),
    }
  }

  const all = report?.rows ?? []
  const filtered = all.filter((r) => matches(r.employee, r.department, needle))
  return {
    // Holidays and Early out are here and not on the day-by-day table for the
    // same reason the PDF does it: both are counts, and a count over one day
    // is a checkbox. The screen and the document carry the same columns so a
    // printout cannot surprise the person who ordered it.
    headers: [
      "Employee",
      "Department",
      "Working days",
      "Present",
      "Absent",
      "On leave",
      "Holidays",
      "Late",
      "Early out",
      "Hours",
      "Shortfall",
    ],
    cols: "1.5fr 1fr 0.8fr 0.6fr 0.6fr 0.7fr 0.7fr 0.5fr 0.7fr 0.7fr 0.8fr",
    total: all.length,
    shown: filtered.length,
    rows: filtered.map((r) => [
      { text: r.employee.fullName, sub: r.employee.designation, weight: 600 },
      { text: r.department },
      { text: String(r.workingDays) },
      { text: String(r.present) },
      { text: String(r.absent), tone: r.absent > 0 ? ("red" as const) : undefined },
      {
        text: String(r.onLeave),
        sub: r.onUnpaidLeave > 0 ? `${r.onUnpaidLeave} unpaid` : undefined,
      },
      { text: String(r.holidays) },
      { text: String(r.late) },
      { text: String(r.earlyOut) },
      { text: formatHours(r.workedHours) },
      {
        node: (
          <span className={cn(r.shortfallHours > 0 ? "text-[#B03A3A]" : TONE.muted)}>
            {r.shortfallHours > 0 ? formatHours(r.shortfallHours) : "—"}
          </span>
        ),
      },
    ]),
  }
}
