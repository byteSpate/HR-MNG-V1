// Shares the one transport, including its dev-mode fallback: with no
// SMTP_HOST configured these log to the console instead of sending, which is
// what makes the jobs runnable locally without an SMTP account.
//
// Both use `notify` rather than `sendMail`: these run from cron, and a mail
// server refusing a digest must not throw out of a scheduled job. The failure
// is still visible — it leaves an EmailDispatch row with `error` set.
import { notify, type MailAttachment } from "../../utils/mailer"
import { renderEmail, serialFor } from "../../templates/email"
import type { AttendanceReport } from "./attendance.report"
import type { ExceptionCode } from "./attendance.types"

const EXCEPTION_LABELS: Record<ExceptionCode, string> = {
  LATE: "Late arrival",
  EARLY_OUT: "Left early",
  MISSING_CHECKOUT: "No check-out",
  SHORTFALL: "Short hours",
  LEAVE_CONFLICT: "Clashes with approved leave",
  WORKED_OFF_DAY: "Worked a holiday or weekly off",
  REGULARISED: "Employee amended the record",
  MANUAL_ENTRY: "Entered by HR",
  AUTO_CHECK_OUT: "Closed automatically at shift end",
}

export interface DigestInput {
  to: string
  pending: number
  oldestAgingDays: number
  /** Exception code to how many records carry it. */
  byException: Partial<Record<ExceptionCode, number>>
  link: string
}

export async function sendApprovalsDigest(input: DigestInput): Promise<void> {
  const breakdown = Object.entries(input.byException)
    .map(([code, count]) => `  ${EXCEPTION_LABELS[code as ExceptionCode]}: ${count}`)
    .join("\n")

  const stale =
    input.oldestAgingDays > 0
      ? ` The oldest has been waiting ${input.oldestAgingDays} day${input.oldestAgingDays === 1 ? "" : "s"}.`
      : ""

  const one = input.pending === 1
  const subject = `${input.pending} attendance record${one ? " needs" : "s need"} your review`

  const facts = [
    { label: "Awaiting decision", value: String(input.pending) },
    ...(input.oldestAgingDays > 0
      ? [{ label: "Oldest waiting", value: `${input.oldestAgingDays} day${input.oldestAgingDays === 1 ? "" : "s"}` }]
      : []),
    ...Object.entries(input.byException).map(([code, count]) => ({
      label: EXCEPTION_LABELS[code as ExceptionCode],
      value: String(count),
    })),
  ]

  await notify({
    to: input.to,
    kind: "ATTENDANCE_DIGEST",
    subject,
    text: `You have ${input.pending} attendance record${one ? "" : "s"} awaiting a decision.${stale}\n\n${breakdown}\n\nReview them: ${input.link}`,
    html: renderEmail({
      serial: serialFor("ATTENDANCE_DIGEST"),
      subject,
      stamp: { label: "Action required", tone: "action" },
      intro: `You have ${input.pending} attendance record${one ? "" : "s"} awaiting a decision.${stale}`,
      facts,
      action: { label: "Review records", href: input.link },
      footer: "You are receiving this because you have attendance records waiting on your decision. This digest runs once a day.",
    }),
  })
}

export async function sendMissingCheckOutNudge(
  to: string,
  date: string,
  link: string
): Promise<void> {
  await notify({
    to,
    kind: "MISSING_CHECKOUT",
    subject: "You didn't check out yesterday",
    text: `Your attendance record for ${date} has a check-in but no check-out, so the day counts no hours.\n\nFix it while you still remember what time you left: ${link}`,
    html: renderEmail({
      serial: serialFor("MISSING_CHECKOUT"),
      subject: "You didn't check out yesterday",
      stamp: { label: "Action required", tone: "action" },
      intro: "Your attendance record has a check-in but no check-out, so the day counts no hours.",
      facts: [{ label: "Date", value: date }],
      action: {
        label: "Fix it now",
        href: link,
        note: "Do it while you still remember what time you left.",
      },
      footer: "You are receiving this because your attendance record for yesterday is incomplete.",
    }),
  })
}

export interface ReportEmailInput {
  to: string
  frequency: "daily" | "monthly"
  /** `2026-10-03` or `2026-09`. The dispatch row's `entityId`, which is how
   *  the job knows this person already has the email. */
  periodKey: string
  report: AttendanceReport
  link: string
  attachments: MailAttachment[]
}

/** `3 October 2026`, or `September 2026` for a month. */
function periodLabel(iso: string, frequency: "daily" | "monthly"): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    ...(frequency === "daily" ? { day: "numeric" } : {}),
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/**
 * The daily and monthly attendance report, to a Super Admin.
 *
 * The body holds the totals so the email is useful without opening anything.
 * The PDF and the CSV hold the people. The numbers all come off the same
 * report the Reports page shows.
 */
export async function sendAttendanceReportEmail(input: ReportEmailInput): Promise<void> {
  const { report, frequency } = input
  const daily = frequency === "daily"
  const label = periodLabel(report.from, frequency)
  const subject = `Attendance report for ${label}`

  const hasPdf = input.attachments.some((a) => a.filename.endsWith(".pdf"))
  const files = hasPdf ? "a PDF and a CSV file" : "a CSV file"
  const intro = `Here is the attendance report for ${label}. The full list is attached as ${files}.`

  const t = report.totals
  const facts = [
    { label: "People counted", value: String(report.headcount) },
    { label: daily ? "Present" : "Days present", value: String(t.present) },
    { label: daily ? "Absent" : "Days absent", value: String(t.absent) },
    { label: daily ? "On leave" : "Days on leave", value: String(t.onLeave) },
    { label: "Late arrivals", value: String(t.late) },
    { label: "No check-out", value: String(t.missingCheckOut) },
    { label: "Waiting for approval", value: String(t.pendingApproval) },
  ]

  const when = daily ? "every day at 12:10 am" : "on the 1st of each month at 8:00 am"
  const footer = `You got this email because you are a Super Admin. It is sent ${when}.`
  const kind = daily ? "ATTENDANCE_REPORT_DAILY" : "ATTENDANCE_REPORT_MONTHLY"

  await notify({
    to: input.to,
    kind,
    subject,
    entity: "ATTENDANCE_REPORT",
    entityId: input.periodKey,
    attachments: input.attachments,
    text: `${intro}\n\n${facts.map((f) => `${f.label}: ${f.value}`).join("\n")}\n\nOpen attendance: ${input.link}\n\n${footer}`,
    html: renderEmail({
      serial: serialFor(kind, input.periodKey),
      subject,
      preheader: `${t.present} present, ${t.absent} absent, ${t.late} late.`,
      stamp: { label: daily ? "Daily report" : "Monthly report", tone: "issued" },
      intro,
      facts,
      action: {
        label: "Open attendance",
        href: input.link,
        note: "See each person, day by day.",
      },
      footer,
    }),
  })
}
