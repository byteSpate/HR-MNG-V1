/**
 * "This month's payroll", shared by the Super Admin and Finance cards.
 *
 * One implementation rather than two, because the interesting rule here is
 * the same for both and is easy to get wrong: **a month with no run reads
 * "Not started", never "৳0"**. Zero is a claim that payroll ran and came to
 * nothing, which is a different — and much worse — fact than nobody having
 * opened it yet.
 */

import prisma from "../../config/prisma"
import { officeToday } from "../attendance/attendance.time"
import { monthName } from "../payroll/payroll.events"
import { bdt } from "./dashboard.format"
import type { DashboardStat, Tone } from "./dashboard.types"

const STATUS_WORDS: Record<string, { sub: string; tag: string; tone: Tone }> = {
  DRAFT: { sub: "Draft, not yet submitted", tag: "Draft", tone: "neutral" },
  SUBMITTED: { sub: "Submitted, awaiting approval", tag: "Submitted", tone: "yellow" },
  APPROVED: { sub: "Approved, not yet disbursed", tag: "Approved", tone: "yellow" },
  DISBURSED: { sub: "Disbursed", tag: "Disbursed", tone: "green" },
}

export async function currentPayrollCard(href: string): Promise<DashboardStat> {
  const today = officeToday()
  const month = today.getUTCMonth() + 1
  const year = today.getUTCFullYear()

  const run = await prisma.payrollRun.findUnique({
    where: { activeKey: `${year}-${String(month).padStart(2, "0")}` },
    select: { status: true, payslips: { select: { netPayableBdt: true } } },
  })

  const label = "This month's payroll"
  if (!run) {
    return {
      label,
      value: "Not started",
      sub: `No run opened for ${monthName(month, year)}`,
      tag: "Not started",
      tone: "neutral",
      href,
    }
  }

  const total = run.payslips.reduce((sum, p) => sum + p.netPayableBdt.toNumber(), 0)
  const words = STATUS_WORDS[run.status]
  return {
    label,
    // A processed run with no payslips is still a real ৳0 — the run exists
    // and produced nothing, which is worth seeing.
    value: bdt(total),
    // The status in words, not a second number. What matters about this
    // month's payroll is where it is in the workflow.
    sub: words.sub,
    tag: words.tag,
    tone: words.tone,
    href,
  }
}
