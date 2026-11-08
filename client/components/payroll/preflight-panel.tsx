"use client"

import type { PreflightReport } from "@/lib/api/types"
import { BLOCKER_FIX } from "@/components/payroll/payroll-shared"

/**
 * The five blockers as a checklist with names, each saying where it gets
 * fixed. This is the feature, not a warning strip: a gate that says "cannot
 * process" gets worked around, one that names who is blocking gets cleared.
 */
export function PreflightPanel({ report }: { report: PreflightReport }) {
  if (report.ok) {
    return (
      <div className="rounded-md border border-success-line bg-surface-hover px-5 py-4">
        <div className="text-body-sm font-semibold text-success">Ready to process</div>
        <div className="mt-0.5 text-caption text-ink-muted">
          Every precondition is clear for this month.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-line bg-white px-5.5 py-5">
      <div className="text-lead font-bold">
        {report.blockers.length} thing{report.blockers.length === 1 ? "" : "s"} to clear before
        processing
      </div>
      <div className="mt-0.5 text-caption text-ink-muted">
        Processing stays disabled until each of these is resolved.
      </div>

      <ul className="mt-4 space-y-3.5">
        {report.blockers.map((blocker) => {
          const meta = BLOCKER_FIX[blocker.code]
          return (
            <li key={blocker.code} className="rounded-md border border-danger-line bg-danger-tint p-4">
              <div className="text-body-sm font-semibold text-danger">{meta.title}</div>
              <div className="mt-1 text-caption text-ink-body">{blocker.message}</div>
              <div className="mt-1.5 text-caption text-ink-muted">{meta.fix}</div>

              {blocker.employees.length > 0 ? (
                <ul className="mt-2.5 space-y-1">
                  {blocker.employees.map((employee) => (
                    <li
                      key={employee.employeeId}
                      className="flex flex-wrap items-baseline gap-x-2 text-caption"
                    >
                      <span className="font-semibold">{employee.fullName}</span>
                      <span className="text-ink-muted">{employee.employeeCode}</span>
                      <span className="text-ink-muted">— {employee.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
