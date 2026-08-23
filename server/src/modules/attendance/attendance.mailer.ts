// Shares the one transport, including its dev-mode fallback: with no
// SMTP_HOST configured these log to the console instead of sending, which is
// what makes the jobs runnable locally without an SMTP account.
//
// Both use `notify` rather than `sendMail`: these run from cron, and a mail
// server refusing a digest must not throw out of a scheduled job. The failure
// is still visible — it leaves an EmailDispatch row with `error` set.
import { notify } from "../../utils/mailer"
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

  await notify({
    to: input.to,
    kind: "ATTENDANCE_DIGEST",
    subject: `${input.pending} attendance record${one ? " needs" : "s need"} your review`,
    text: `You have ${input.pending} attendance record${one ? "" : "s"} awaiting a decision.${stale}\n\n${breakdown}\n\nReview them: ${input.link}`,
    html: `<p>You have <strong>${input.pending}</strong> attendance record${one ? "" : "s"} awaiting a decision.${stale}</p>
     <ul>${Object.entries(input.byException)
       .map(
         ([code, count]) =>
           `<li>${EXCEPTION_LABELS[code as ExceptionCode]}: <strong>${count}</strong></li>`
       )
       .join("")}</ul>
     <p><a href="${input.link}">Review them</a></p>`,
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
    html: `<p>Your attendance record for <strong>${date}</strong> has a check-in but no check-out, so the day counts no hours.</p>
     <p><a href="${link}">Fix it</a> while you still remember what time you left.</p>`,
  })
}
