// Shares the one transport, including its dev-mode fallback: with no
// SMTP_HOST configured these log to the console instead of sending, which is
// what makes the jobs runnable locally without an SMTP account.
//
// Both use `notify` rather than `sendMail`: these run from cron, and a mail
// server refusing a digest must not throw out of a scheduled job. The failure
// is still visible — it leaves an EmailDispatch row with `error` set.
import { notify } from "../../utils/mailer"
import { renderEmail, serialFor } from "../../templates/email"
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
