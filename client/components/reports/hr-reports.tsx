"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { listDepartments } from "@/lib/api/departments"
import { listLeaveTypes } from "@/lib/api/leave"
import { monthOptions } from "@/lib/api/reports"
import { toDateString } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { ReportPanel, ReportSelect } from "./report-panel"

/** The Employee report: everybody, or one status, or one department. */
export function EmployeeReports({ accessToken }: { accessToken: string }) {
  const [status, setStatus] = useState("ALL")
  const [departmentId, setDepartmentId] = useState("ALL")

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => listDepartments(accessToken),
  })

  return (
    <ReportPanel
      accessToken={accessToken}
      path="/api/employees/report"
      name="employee-report"
      params={{
        status: status === "ALL" ? "" : status,
        departmentId: departmentId === "ALL" ? "" : departmentId,
      }}
      filters={
        <>
          <ReportSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL", label: "Any status" },
              { value: "ACTIVE", label: "Active" },
              { value: "ON_LEAVE", label: "On leave" },
              { value: "RESIGNED", label: "Resigned" },
              { value: "TERMINATED", label: "Terminated" },
            ]}
          />
          <ReportSelect
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            width="w-52"
            options={[
              { value: "ALL", label: "All departments" },
              ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </>
      }
      emptyTitle="No employees match"
      emptyBody="Nobody has this status in this department. Pick another status or department."
    />
  )
}

type Preset = "month" | "quarter" | "year" | "custom"

function rangeFor(preset: Preset, today: Date): { from: string; to: string } | null {
  const year = today.getFullYear()
  const month = today.getMonth()
  if (preset === "month") {
    return { from: toDateString(new Date(year, month, 1)), to: toDateString(new Date(year, month + 1, 0)) }
  }
  if (preset === "quarter") {
    return { from: toDateString(new Date(year, month - 2, 1)), to: toDateString(new Date(year, month + 1, 0)) }
  }
  if (preset === "year") return { from: toDateString(new Date(year, 0, 1)), to: toDateString(new Date(year, 11, 31)) }
  return null
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "Last 3 months" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom range" },
]

/** The Leave report: leave that touches a date range. */
export function LeaveReports({ accessToken }: { accessToken: string }) {
  const today = useMemo(() => new Date(), [])
  const initial = useMemo(() => rangeFor("month", today)!, [today])
  const [preset, setPreset] = useState<Preset>("month")
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [status, setStatus] = useState("ALL")
  const [leaveTypeId, setLeaveTypeId] = useState("ALL")

  const types = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => listLeaveTypes(accessToken),
  })

  function applyPreset(next: Preset) {
    setPreset(next)
    const range = rangeFor(next, today)
    if (range) {
      setFrom(range.from)
      setTo(range.to)
    }
  }

  return (
    <ReportPanel
      accessToken={accessToken}
      path="/api/leave/report"
      name="leave-report"
      params={{
        from,
        to,
        status: status === "ALL" ? "" : status,
        leaveTypeId: leaveTypeId === "ALL" ? "" : leaveTypeId,
      }}
      ready={from <= to}
      notReadyMessage="The To date is before the From date. Pick a later To date."
      filters={
        <>
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
            <DatePicker
              value={from}
              onChange={(v) => {
                setFrom(v)
                setPreset("custom")
              }}
            />
          </div>
          <div className="w-40">
            <Label className="mb-1.5 block text-xs font-bold">To</Label>
            <DatePicker
              value={to}
              min={from || undefined}
              onChange={(v) => {
                setTo(v)
                setPreset("custom")
              }}
            />
          </div>
          <ReportSelect
            label="Status"
            value={status}
            onChange={setStatus}
            width="w-40"
            options={[
              { value: "ALL", label: "Any status" },
              { value: "PENDING", label: "Waiting" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
              { value: "CANCELLED", label: "Cancelled" },
            ]}
          />
          <ReportSelect
            label="Leave type"
            value={leaveTypeId}
            onChange={setLeaveTypeId}
            width="w-52"
            options={[
              { value: "ALL", label: "All leave types" },
              ...(types.data ?? []).map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        </>
      }
      emptyTitle="No leave in this range"
      emptyBody="No leave request touches these dates. Pick a wider range, or clear the status and leave type."
    />
  )
}

/** The Payroll report: one row per payslip, for a range of months. */
export function PayrollReports({ accessToken }: { accessToken: string }) {
  const months = useMemo(() => monthOptions(new Date(), 36), [])
  const [from, setFrom] = useState(months[0].value)
  const [to, setTo] = useState(months[0].value)
  const [status, setStatus] = useState("ALL")

  return (
    <ReportPanel
      accessToken={accessToken}
      path="/api/payroll/report"
      name="payroll-report"
      params={{ from, to, status: status === "ALL" ? "" : status }}
      ready={from <= to}
      notReadyMessage="The To month is before the From month. Pick a later To month."
      filters={
        <>
          <ReportSelect label="From month" value={from} onChange={setFrom} options={months} />
          <ReportSelect label="To month" value={to} onChange={setTo} options={months} />
          <ReportSelect
            label="Run status"
            value={status}
            onChange={setStatus}
            width="w-52"
            options={[
              { value: "ALL", label: "Any status" },
              { value: "DRAFT", label: "Draft" },
              { value: "SUBMITTED", label: "Sent for approval" },
              { value: "APPROVED", label: "Approved, not paid yet" },
              { value: "DISBURSED", label: "Paid" },
            ]}
          />
        </>
      }
      emptyTitle="No payslips in these months"
      emptyBody="No payroll run in these months has payslips. Pick other months, or clear the run status."
    />
  )
}
