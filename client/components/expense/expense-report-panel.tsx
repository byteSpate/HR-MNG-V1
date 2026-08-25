"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiDownloadLine, RiFileTextLine, RiFilterOffLine } from "@remixicon/react"

import {
  downloadExpenseReport,
  getExpenseReport,
  type ExpenseReportQuery,
} from "@/lib/api/expenses"
import type { ExpenseClaim, ExpenseReport, ExpenseStatus } from "@/lib/api/types"
import { toDateString } from "@/lib/utils"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { MiniStat } from "@/components/dashboard/page-header"
import { PanelAlert, PanelTable, TONE, toMessage } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EXPENSE_STATUS_LABEL, EXPENSE_STATUS_TONE } from "@/components/payroll/payroll-shared"

/**
 * Expense claims over a date range, on screen and as a document.
 *
 * One panel for both audiences. An employee sees their own claims and no
 * person filter, because there is nobody else to pick; Finance and HR get the
 * filter and a whole-company default. The *server* decides which of those
 * applies — this component only decides whether to render the control, and a
 * staff member who forged an `employeeId` would still get a 403.
 *
 * Every figure comes from the server's `totals`. Money is never re-added here:
 * the totals arrive split by currency because a BDT sum containing a USD claim
 * is a number nobody can spot.
 */

const STATUSES: { value: ExpenseStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Any status" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "REIMBURSED", label: "Reimbursed" },
]

type Preset = "month" | "quarter" | "year" | "custom"

const PRESETS: { value: Preset; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "Last 3 months" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
]

function rangeFor(preset: Preset, today: Date): { from: string; to: string } | null {
  const year = today.getFullYear()
  if (preset === "month") {
    return {
      from: toDateString(new Date(year, today.getMonth(), 1)),
      to: toDateString(new Date(year, today.getMonth() + 1, 0)),
    }
  }
  if (preset === "quarter") {
    return {
      from: toDateString(new Date(year, today.getMonth() - 2, 1)),
      to: toDateString(new Date(year, today.getMonth() + 1, 0)),
    }
  }
  if (preset === "year") {
    return { from: toDateString(new Date(year, 0, 1)), to: toDateString(new Date(year, 11, 31)) }
  }
  // Custom keeps whatever the user already picked.
  return null
}

/** "Gulshan 1 → Motijheel", or nothing for a claim that is not a journey. */
function route(row: ExpenseReport["rows"][number]): string | undefined {
  if (!row.travelFrom && !row.travelTo) return undefined
  return `${row.travelFrom ?? "?"} → ${row.travelTo ?? "?"}`
}

export function ExpenseReports({
  accessToken,
  /** Absent for staff — there is nobody else for them to pick. */
  people,
}: {
  accessToken: string
  people?: ExpenseClaim["employee"][]
}) {
  const today = useMemo(() => new Date(), [])
  const initial = useMemo(() => rangeFor("month", today)!, [today])

  const [preset, setPreset] = useState<Preset>("month")
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [employeeId, setEmployeeId] = useState<string>("ALL")
  const [status, setStatus] = useState<ExpenseStatus | "ALL">("ALL")
  const [downloading, setDownloading] = useState<"pdf" | "csv" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const query: ExpenseReportQuery = {
    from,
    to,
    ...(employeeId !== "ALL" ? { employeeId } : {}),
    ...(status !== "ALL" ? { status } : {}),
  }

  const reportQuery = useQuery({
    queryKey: ["expenses", "report", from, to, employeeId, status],
    queryFn: () => getExpenseReport(accessToken, query),
    // A backwards range is a 400, and asking for it on every keystroke of a
    // date edit would flash an error the user has not finished causing yet.
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

  async function exportReport(format: "pdf" | "csv") {
    setDownloading(format)
    setError(null)
    try {
      const blob = await downloadExpenseReport(accessToken, query, format)
      const who = employeeId !== "ALL" ? `-${employeeId.slice(0, 8)}` : ""
      downloadBlob(blob, `expenses${who}-${from}-to-${to}.${format}`)
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setDownloading(null)
    }
  }

  const report = reportQuery.data
  const invalidRange = from > to
  const exportBlocked = downloading !== null || invalidRange || !report || reportQuery.isPending

  const showPeople = !!people && people.length > 0
  const peopleItems = useMemo(
    () =>
      Object.fromEntries([
        ["ALL", "Everyone"],
        ...(people ?? []).map((p) => [p!.id, p!.fullName] as [string, string]),
      ]),
    [people]
  )
  const statusItems = useMemo(
    () => Object.fromEntries(STATUSES.map((s) => [s.value, s.label])),
    []
  )

  const headers = showPeople
    ? ["Date", "Employee", "Category", "Amount", "Status", "Receipt"]
    : ["Date", "Category", "Amount", "Status", "Receipt"]
  const cols = showPeople
    ? "0.8fr 1.2fr 1.4fr 0.9fr 0.8fr 0.7fr"
    : "0.8fr 1.6fr 0.9fr 0.8fr 0.7fr"

  const rows: TableCell[][] = (report?.rows ?? []).map((r) => {
    const who: TableCell[] = showPeople
      ? [{ text: r.employee.fullName, sub: r.employee.employeeCode }]
      : []
    return [
      { text: r.expenseDate },
      ...who,
      { text: r.category.name, sub: route(r) ?? r.description ?? undefined, weight: 600 },
      { text: `${r.amount} ${r.currency}` },
      { tag: EXPENSE_STATUS_LABEL[r.status], tone: EXPENSE_STATUS_TONE[r.status] },
      // A claim with no receipt is the thing a reviewer is looking for, so it
      // says so in words rather than showing a nought to scan past.
      r.receipts === 0
        ? { node: <span className={TONE.muted}>None</span> }
        : { text: String(r.receipts) },
    ]
  })

  return (
    <>
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

          {showPeople ? (
            <div className="w-52">
              <Label className="mb-1.5 block text-xs font-bold">Person</Label>
              <Select
                items={peopleItems}
                value={employeeId}
                onValueChange={(v) => v && setEmployeeId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Everyone</SelectItem>
                  {(people ?? []).map((p) => (
                    <SelectItem key={p!.id} value={p!.id}>
                      {p!.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="w-40">
            <Label className="mb-1.5 block text-xs font-bold">Status</Label>
            <Select
              items={statusItems}
              value={status}
              onValueChange={(v) => v && setStatus(v as ExpenseStatus | "ALL")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Exporting a report that failed to load would download an error. */}
          <div className="flex gap-1.5">
            <Button type="button" size="sm" disabled={exportBlocked} onClick={() => exportReport("pdf")}>
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
          <PanelAlert>The end of the range is before its start. Pick a later end date.</PanelAlert>
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
            label="Claims"
            value={String(report.totals.claims)}
            sub={report.totals.claims === 0 ? "Nothing in this range" : "in this range"}
          />
          {/* One tile per currency. Adding them together would be a figure
              nobody could use and nobody could spot as wrong. */}
          {report.totals.byCurrency.map((c) => (
            <MiniStat
              key={c.currency}
              label={`Total ${c.currency}`}
              value={c.amount}
              sub={`${c.claims} claim${c.claims === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-3.5">
        <PanelTable
          cols={cols}
          headers={headers}
          rows={rows}
          isLoading={reportQuery.isPending && !invalidRange}
          isError={reportQuery.isError}
          onRetry={() => reportQuery.refetch()}
          emptyTitle="No claims in this range"
          emptyBody={
            status !== "ALL" || employeeId !== "ALL"
              ? "No claim matches these filters. Widen the range, or clear the person and status."
              : "Nothing was spent — or nothing was claimed — between these dates."
          }
          emptyAction="Refresh"
          onEmptyAction={() => reportQuery.refetch()}
          emptyActionIcon={<RiFilterOffLine className="size-4" aria-hidden />}
        />
      </div>
    </>
  )
}
