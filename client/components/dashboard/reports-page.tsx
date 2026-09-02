"use client"

import { useMemo, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"

import { listExpenseClaims } from "@/lib/api/expenses"
import type { ExpenseClaim } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { PageHeader } from "@/components/dashboard/page-header"
import { TONE } from "@/components/dashboard/record-kit"
import { AttendanceReports } from "@/components/attendance/report-panel"
import { ExpenseReports } from "@/components/expense/expense-report-panel"

/**
 * One place for every report.
 *
 * Replaces the old `/reports` route, which rendered the activity feed under
 * a "Reports" label — that content now has its own "Activity" tab, and this
 * is what the label always should have pointed at.
 *
 * Five modules, in the order the user asked for them: Employee, Attendance,
 * Leave, Payroll, Expense. Attendance and Expense already have real, working
 * report panels, built in the last two rounds, and are embedded here
 * unchanged, under the exact role gate each already carries where it lives
 * today. The other three say plainly that they are not built yet — the route
 * this page replaces once showed five invented reports under a fake "Synced
 * 4 min ago", and nothing here repeats that.
 *
 * Accounting has no section here at all, rather than a sixth "not built"
 * row: it is seven financial statements that must balance and agree with
 * each other, deliberately tracked as its own piece of work rather than a
 * gap in this one — see the 2026-09-02 decision in the open-work spec.
 */

const ORG_ROLES = ["HR_ADMIN", "SUPER_ADMIN", "FINANCE_OFFICER"]
const PAYROLL_ADMIN_ROLES = ["HR_ADMIN", "FINANCE_OFFICER", "SUPER_ADMIN"]

function Muted({ children }: { children: string }) {
  return <p className={`max-w-[64ch] text-[12.5px] leading-relaxed ${TONE.muted}`}>{children}</p>
}

function Section({
  title,
  sub,
  children,
}: {
  title: string
  sub: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 border-t border-[#EEF1F5] pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="font-heading text-[16px] font-bold tracking-tight">{title}</h2>
        <Muted>{sub}</Muted>
      </div>
      {children}
    </section>
  )
}

export function ReportsPage() {
  const { accessToken, user, status } = useSession()
  const isAuthed = status === "authenticated" && !!accessToken
  const role = user?.role
  const canSeeAttendance = !!role && ORG_ROLES.includes(role)
  const canSeeExpense = !!role && PAYROLL_ADMIN_ROLES.includes(role)

  // Same query key the Expenses page itself uses for its admin claims list,
  // so a person who has visited both pages this session pays for one claim
  // fetch, not two.
  const claimsQuery = useQuery({
    queryKey: ["expenses", "all"],
    queryFn: () => listExpenseClaims(accessToken!),
    enabled: isAuthed && canSeeExpense,
  })

  const reviewPeople = useMemo(() => {
    const seen = new Map<string, NonNullable<ExpenseClaim["employee"]>>()
    for (const claim of claimsQuery.data ?? []) {
      if (claim.employee) seen.set(claim.employee.id, claim.employee)
    }
    return [...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [claimsQuery.data])

  return (
    <div>
      <PageHeader
        kicker="Analysis"
        title="Reports"
        sub="Pick a report, set its range, and export it as a PDF or a spreadsheet."
      />

      <div className="space-y-8 pb-10">
        <Section
          title="Employee"
          sub="Roster, employment status and personal details, filtered and exported."
        >
          <Muted>Not built yet.</Muted>
        </Section>

        <Section
          title="Attendance"
          sub="Daily, weekly, monthly or a custom range — one row per employee, or one per employee per day."
        >
          {canSeeAttendance ? (
            <AttendanceReports accessToken={accessToken!} />
          ) : (
            <Muted>Not available for your role.</Muted>
          )}
        </Section>

        <Section
          title="Leave"
          sub="Leave taken, current balances, and the full request history, filtered and exported."
        >
          <Muted>Not built yet.</Muted>
        </Section>

        <Section
          title="Payroll"
          sub="Run totals, the payslip register, and salary paid by component, filtered and exported."
        >
          <Muted>Not built yet.</Muted>
        </Section>

        <Section
          title="Expense"
          sub="Claims for any date range, by person or across everybody, as a PDF or a spreadsheet."
        >
          {canSeeExpense ? (
            <ExpenseReports accessToken={accessToken!} people={reviewPeople} />
          ) : (
            <Muted>Not available for your role.</Muted>
          )}
        </Section>
      </div>
    </div>
  )
}
