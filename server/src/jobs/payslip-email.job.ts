/**
 * Bulk payslip email — a job, not a request.
 *
 * `POST /runs/:id/email` queues this and returns immediately. Rendering 500
 * PDFs inside an HTTP request is a multi-minute call any proxy will time
 * out; worse, a failure halfway leaves no record of who did receive theirs.
 *
 * So it runs sequentially through the shared browser, setting `emailedAt` per
 * payslip on success and `emailError` per payslip on failure. A partial send
 * is then reportable and re-runnable rather than all-or-nothing.
 */

import prisma from "../config/prisma"
import { sendPayslipEmail } from "../modules/payroll/payroll.mailer"
import { getOrRenderPayslipPdf } from "../modules/payroll/payroll.pdf"
import { toMoneyString } from "../modules/payroll/payroll.money"

/**
 * A run is in flight if its claim is set and recent. A bare boolean would
 * wedge the run forever if the dyno died mid-send; the window lets a stale
 * claim be reclaimed without a manual database edit.
 *
 * The claim lives on the row rather than in memory, because an in-memory Set
 * does not survive a restart and does not span dynos.
 */
export const IN_FLIGHT_WINDOW_MS = 30 * 60 * 1000

export async function isEmailRunInFlight(runId: string): Promise<boolean> {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { emailStartedAt: true },
  })
  if (!run?.emailStartedAt) return false
  return Date.now() - run.emailStartedAt.getTime() < IN_FLIGHT_WINDOW_MS
}

export interface EmailRunResult {
  total: number
  sent: number
  failed: number
}

export interface EmailRunOptions {
  /**
   * Re-send payslips that already went out. Off by default, which is what
   * makes a duplicate run harmless: the second one finds nothing to do.
   */
  resend?: boolean
}

export async function emailPayslipsForRun(
  runId: string,
  opts: EmailRunOptions = {}
): Promise<EmailRunResult> {
  if (await isEmailRunInFlight(runId)) return { total: 0, sent: 0, failed: 0 }
  await prisma.payrollRun.update({ where: { id: runId }, data: { emailStartedAt: new Date() } })

  try {
    const payslips = await prisma.payslip.findMany({
      where: opts.resend ? { payrollRunId: runId } : { payrollRunId: runId, emailedAt: null },
      include: {
        employee: { select: { fullName: true, user: { select: { email: true } } } },
        payrollRun: { select: { month: true, year: true } },
      },
    })

    let sent = 0
    let failed = 0

    for (const payslip of payslips) {
      const to = payslip.employee.user?.email
      try {
        if (!to) throw new Error("Employee has no email address")
        // A deliberate resend does not re-render a cached PDF.
        const pdf = await getOrRenderPayslipPdf(payslip.id)
        await sendPayslipEmail({
          to,
          fullName: payslip.employee.fullName,
          payslipNo: payslip.payslipNo,
          month: payslip.payrollRun.month,
          year: payslip.payrollRun.year,
          currency: payslip.currency,
          netPayable: toMoneyString(payslip.netPayable),
          pdf,
          payslipId: payslip.id,
        })
        await prisma.payslip.update({
          where: { id: payslip.id },
          data: { emailedAt: new Date(), emailError: null },
        })
        sent += 1
      } catch (err) {
        failed += 1
        await prisma.payslip.update({
          where: { id: payslip.id },
          data: { emailError: err instanceof Error ? err.message : String(err) },
        })
      }
    }

    return { total: payslips.length, sent, failed }
  } finally {
    await prisma.payrollRun.update({ where: { id: runId }, data: { emailStartedAt: null } })
  }
}

export interface EmailStatus {
  total: number
  sent: number
  failed: number
  inProgress: boolean
}

export async function getEmailStatus(runId: string): Promise<EmailStatus> {
  const [total, sent, failed, inProgress] = await Promise.all([
    prisma.payslip.count({ where: { payrollRunId: runId } }),
    prisma.payslip.count({ where: { payrollRunId: runId, emailedAt: { not: null } } }),
    // Errored AND never sent. Counting `emailError: { not: null }` alone
    // double-counts a payslip that succeeded and later failed, which made
    // sent + failed exceed total.
    prisma.payslip.count({
      where: { payrollRunId: runId, emailError: { not: null }, emailedAt: null },
    }),
    isEmailRunInFlight(runId),
  ])
  return { total, sent, failed, inProgress }
}
