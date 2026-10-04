/**
 * The attendance report, emailed to every Super Admin.
 *
 * Daily at 00:10 for yesterday, and monthly at 08:00 on the 1st for the month
 * that just ended. The daily one runs at 00:10 and not at 00:00 on purpose: the
 * 00:05 auto check-out closes yesterday's open days, and a report that ran
 * before it would count those people as missing a check-out.
 *
 * The report is built once and sent to everybody, through the same
 * `getAttendanceReport` the Reports page uses, so the email cannot disagree
 * with the screen. Both bodies are exported apart from their schedules, like
 * the other jobs, so they can be run by hand or in a test.
 *
 * Safe to run twice. Anybody who already has the email for that day (or month)
 * is skipped, so a restart at 00:11 sends nothing new. A send that failed left
 * a row with `error` set, and that person is tried again.
 */

import { env } from "../config/env"
import prisma from "../config/prisma"
import { sendAttendanceReportEmail } from "../modules/attendance/attendance.mailer"
import {
  getAttendanceReport,
  reportFilename,
  reportToCsv,
  type ReportGranularity,
} from "../modules/attendance/attendance.report"
import { renderAttendanceReportPdf } from "../modules/attendance/attendance.report.pdf"
import { officeDateOf } from "../modules/attendance/attendance.time"
import type { AccessTokenPayload } from "../modules/auth/auth.types"
import { addDays, formatDateOnly } from "../utils/dates"
import type { DispatchKind, MailAttachment } from "../utils/mailer"

/**
 * Who the report is built as. Super Admin sees everybody still on the books,
 * which is the whole point of this email, and `rosterFor` does not read `sub`
 * for that role, so no real user is needed.
 */
const SYSTEM_ACTOR = {
  sub: "system",
  role: "SUPER_ADMIN",
  email: "",
  mustChangePassword: false,
  salesRole: null,
} as AccessTokenPayload

interface Period {
  frequency: "daily" | "monthly"
  kind: DispatchKind
  /** `2026-10-03` or `2026-09`. Stored as the dispatch row's `entityId`. */
  key: string
  from: string
  to: string
  granularity: ReportGranularity
}

async function sendReport(period: Period): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true },
    select: { id: true, email: true },
  })
  if (admins.length === 0) return 0

  // `error: null` keeps a failed send out of this list, so it is tried again.
  const already = await prisma.emailDispatch.findMany({
    where: { kind: period.kind, entityId: period.key, error: null },
    select: { to: true },
  })
  const done = new Set(already.map((row) => row.to))
  const todo = admins.filter((admin) => !done.has(admin.email))
  if (todo.length === 0) return 0

  const report = await getAttendanceReport(SYSTEM_ACTOR, {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
  })
  // No working day in the range: a holiday, a weekly off, or a month from
  // before go-live. A report full of zeros would read as a bad day, not as no
  // day, so nothing is sent. The grid already applies each person's own shift
  // and the holiday calendar, so this needs no second rule.
  if (report.totals.workingDays === 0) return 0

  const attachments: MailAttachment[] = []
  try {
    attachments.push({
      filename: reportFilename(report, "pdf"),
      content: await renderAttendanceReportPdf(report),
    })
  } catch (err) {
    // The CSV still carries every number. A broken PDF renderer is logged, not
    // allowed to stop the report from arriving.
    console.error("[jobs] attendance report PDF failed, sending the CSV only", err)
  }
  attachments.push({
    filename: reportFilename(report, "csv"),
    content: Buffer.from(reportToCsv(report), "utf8"),
  })

  for (const admin of todo) {
    await sendAttendanceReportEmail({
      to: admin.email,
      frequency: period.frequency,
      periodKey: period.key,
      report,
      link: `${env.CLIENT_ORIGIN}/admin/attendance`,
      attachments,
    })
  }
  return todo.length
}

/** Yesterday, in office time. */
export async function runDailyAttendanceReportEmail(now: Date = new Date()): Promise<number> {
  const day = formatDateOnly(addDays(officeDateOf(now), -1))
  return sendReport({
    frequency: "daily",
    kind: "ATTENDANCE_REPORT_DAILY",
    key: day,
    from: day,
    to: day,
    // Day by day, so the one-day PDF and CSV list who did what.
    granularity: "daily",
  })
}

/** The calendar month before the one `now` is in, in office time. */
export async function runMonthlyAttendanceReportEmail(now: Date = new Date()): Promise<number> {
  const today = officeDateOf(now)
  const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const lastOfLastMonth = addDays(firstOfThisMonth, -1)
  const firstOfLastMonth = new Date(
    Date.UTC(lastOfLastMonth.getUTCFullYear(), lastOfLastMonth.getUTCMonth(), 1)
  )
  const from = formatDateOnly(firstOfLastMonth)
  return sendReport({
    frequency: "monthly",
    kind: "ATTENDANCE_REPORT_MONTHLY",
    key: from.slice(0, 7),
    from,
    to: formatDateOnly(lastOfLastMonth),
    // One row per person with their totals.
    granularity: "summary",
  })
}
