/**
 * The seven notification emails.
 *
 * All use `notify`, never `sendMail`: an approved leave request must not roll
 * back because SMTP is down. A failure leaves an EmailDispatch row with
 * `error` set, which is how it stays visible.
 *
 * Bodies are plain sentences with the figures in them. There is no settlement
 * PDF renderer and building a third one was deliberately left out of scope —
 * the statement goes in the email body instead.
 *
 * Two of the seven carry an action box, and only two: their reader has to go
 * and do something. The other five are told an outcome they cannot action,
 * and a link there is only a reason to log in and find nothing.
 */

import { env } from "../../config/env"
import { notify } from "../../utils/mailer"
import { renderEmail, serialFor } from "../../templates/email"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const sign = (lines: string[]): string => [...lines, ``, env.COMPANY_NAME].join("\n")

const appLink = (path: string): string => `${env.CLIENT_ORIGIN}${path}`

const noActionFooter =
  "This is a record of a decision — no action is needed on your part."

export interface LeaveRequestedInput {
  to: string
  requestId: string
  employeeName: string
  leaveType: string
  startDate: string
  endDate: string
  days: string
}

export async function sendLeaveRequestedEmail(i: LeaveRequestedInput): Promise<void> {
  const kind = "LEAVE_REQUESTED" as const
  const link = appLink("/manager/leave")
  const body = [
    `${i.employeeName} has requested ${i.days} day${i.days === "1" ? "" : "s"} of ${i.leaveType}, from ${i.startDate} to ${i.endDate}.`,
    ``,
    `Review it: ${link}`,
  ]
  await notify({
    to: i.to,
    kind,
    subject: `${i.employeeName} requested ${i.leaveType}`,
    text: sign(body),
    html: renderEmail({
      serial: serialFor(kind, i.requestId),
      subject: `${i.employeeName} requested ${i.leaveType}`,
      stamp: { label: "Action required", tone: "action" },
      intro: `${i.employeeName} has requested ${i.days} day${i.days === "1" ? "" : "s"} of ${i.leaveType}.`,
      facts: [
        { label: "Leave type", value: i.leaveType },
        { label: "From", value: i.startDate },
        { label: "To", value: i.endDate },
        { label: "Days", value: i.days },
      ],
      action: { label: "Review request", href: link },
      footer: `You are receiving this because you are the reporting manager for this request at ${env.COMPANY_NAME}.`,
    }),
    entity: "LEAVE_REQUEST",
    entityId: i.requestId,
  })
}

export interface LeaveDecidedInput {
  to: string
  requestId: string
  leaveType: string
  startDate: string
  endDate: string
  approved: boolean
  reason: string | null
}

export async function sendLeaveDecidedEmail(i: LeaveDecidedInput): Promise<void> {
  const kind = "LEAVE_DECIDED" as const
  const verb = i.approved ? "approved" : "declined"
  const subject = `Your leave request was ${verb}`
  const body = [
    `Your ${i.leaveType} request for ${i.startDate} to ${i.endDate} was ${verb}.`,
    ...(i.reason ? [``, `Reason: ${i.reason}`] : []),
  ]
  await notify({
    to: i.to,
    kind,
    subject,
    text: sign(body),
    html: renderEmail({
      serial: serialFor(kind, i.requestId),
      subject,
      stamp: { label: i.approved ? "Approved" : "Declined", tone: i.approved ? "approved" : "declined" },
      intro: `Your ${i.leaveType} request for ${i.startDate} to ${i.endDate} was ${verb}.`,
      prose: i.reason ? [`Reason: ${i.reason}`] : [],
      footer: noActionFooter,
    }),
    entity: "LEAVE_REQUEST",
    entityId: i.requestId,
  })
}

/** One approved claim, as it appears in the list. */
export interface ApprovedClaimLine {
  claimId: string
  /**
   * How the claim is identified to the person who filed it. `ExpenseClaim`
   * has no claim number, and the expenses table identifies a row by its
   * category and spend date — so that is what goes here rather than a
   * reference nobody can look up.
   */
  claimRef: string
  amount: string
  currency: string
}

export interface ExpensesApprovedInput {
  to: string
  /** Never empty. One entry is an ordinary single approval. */
  claims: ApprovedClaimLine[]
  /**
   * One total per currency, already summed by the caller.
   *
   * Never one blended figure: a sweep can approve BDT and USD claims
   * together, and adding those is the error `fxRateToBdt` exists to prevent.
   */
  totals: Array<{ currency: string; amount: string }>
}

/**
 * Approvals, always as a list.
 *
 * One function for one claim and for twelve, because a single approval is a
 * batch of one — two shapes would be two code paths that drift apart. An
 * administrator clearing a backlog of twelve claims from one person sends
 * that person one email, not twelve.
 *
 * The money table is deliberately unused. `MoneyTable` carries exactly one
 * `netValue`, and a mixed-currency sweep has two totals that must not be
 * added, so the totals go in `facts` rows where there can be as many as the
 * data requires.
 */
export async function sendExpensesApprovedEmail(i: ExpensesApprovedInput): Promise<void> {
  const kind = "EXPENSE_APPROVED" as const
  const many = i.claims.length > 1
  const subject = many
    ? `${i.claims.length} expense claims were approved`
    : `Expense claim for ${i.claims[0].claimRef} was approved`

  const lines = i.claims.map((c) => `- ${c.claimRef}: ${c.currency} ${c.amount}`)
  const totalLines = i.totals.map((t) => `Total ${t.currency}: ${t.amount}`)

  await notify({
    to: i.to,
    kind,
    subject,
    text: sign([
      many
        ? `${i.claims.length} of your expense claims were approved.`
        : `Your expense claim was approved.`,
      ``,
      ...lines,
      ``,
      ...totalLines,
    ]),
    html: renderEmail({
      // The first claim's id. A batch has no id of its own, and inventing one
      // would put a reference in the email that nothing can be looked up by.
      serial: serialFor(kind, i.claims[0].claimId),
      subject,
      stamp: { label: "Approved", tone: "approved" },
      intro: many
        ? `${i.claims.length} of your expense claims were approved.`
        : `Your expense claim was approved.`,
      facts: [
        ...i.claims.map((c) => ({ label: c.claimRef, value: `${c.currency} ${c.amount}` })),
        // Suppressed for a single claim: "Total BDT 1,200" under a lone
        // "BDT 1,200" is the same number said twice.
        ...(many
          ? i.totals.map((t) => ({ label: `Total ${t.currency}`, value: t.amount }))
          : []),
      ],
      footer: noActionFooter,
    }),
    entity: "EXPENSE_CLAIM",
    entityId: i.claims[0].claimId,
  })
}

export interface ExpenseRejectedInput {
  to: string
  claimId: string
  /** As above — category and spend date, the way the table names a row. */
  claimRef: string
  amount: string
  currency: string
  reason: string
}

/**
 * Rejections, always one claim at a time.
 *
 * Deliberately not batched the way approvals are. The reason is written for
 * one specific claim, and rolling several into a list makes each one harder
 * to act on — see `docs/adr/0004`.
 */
export async function sendExpenseRejectedEmail(i: ExpenseRejectedInput): Promise<void> {
  const kind = "EXPENSE_REJECTED" as const
  const subject = `Expense claim for ${i.claimRef} was declined`
  await notify({
    to: i.to,
    kind,
    subject,
    text: sign([
      `Your expense claim for ${i.claimRef}, ${i.currency} ${i.amount}, was declined.`,
      ``,
      `Reason: ${i.reason}`,
    ]),
    html: renderEmail({
      serial: serialFor(kind, i.claimId),
      subject,
      stamp: { label: "Declined", tone: "declined" },
      intro: `Your expense claim was declined.`,
      facts: [
        { label: "Claim", value: i.claimRef },
        { label: "Amount", value: `${i.currency} ${i.amount}` },
      ],
      prose: [`Reason: ${i.reason}`],
      footer: noActionFooter,
    }),
    entity: "EXPENSE_CLAIM",
    entityId: i.claimId,
  })
}

export interface PayrollSubmittedInput {
  to: string
  runId: string
  month: number
  year: number
  employeeCount: number
  totalNet: string
  currency: string
}

export async function sendPayrollSubmittedEmail(i: PayrollSubmittedInput): Promise<void> {
  const kind = "PAYROLL_SUBMITTED" as const
  const period = `${MONTHS[i.month - 1]} ${i.year}`
  const link = appLink("/admin/payroll")
  const subject = `Payroll for ${period} is waiting for approval`
  const body = [
    `The payroll run for ${period} has been submitted and is waiting for approval.`,
    ``,
    `Employees: ${i.employeeCount}`,
    `Total net: ${i.currency} ${i.totalNet}`,
    ``,
    `Review it: ${link}`,
  ]
  await notify({
    to: i.to,
    kind,
    subject,
    text: sign(body),
    html: renderEmail({
      serial: serialFor(kind, i.runId),
      subject,
      stamp: { label: "Action required", tone: "action" },
      intro: `The payroll run for ${period} has been submitted and is waiting for approval.`,
      facts: [
        { label: "Employees", value: String(i.employeeCount) },
        { label: "Total net", value: `${i.currency} ${i.totalNet}` },
      ],
      action: { label: "Review run", href: link },
      footer: `You are receiving this because approving a payroll run is a Super Admin action at ${env.COMPANY_NAME}.`,
    }),
    entity: "PAYROLL_RUN",
    entityId: i.runId,
  })
}

export interface AssetRequestDecidedInput {
  to: string
  requestId: string
  itemName: string
  approved: boolean
  reason: string | null
}

export async function sendAssetRequestDecidedEmail(i: AssetRequestDecidedInput): Promise<void> {
  const kind = "ASSET_REQUEST_DECIDED" as const
  const verb = i.approved ? "approved" : "declined"
  const subject = `Your request for ${i.itemName} was ${verb}`
  const body = [
    `Your request for ${i.itemName} was ${verb}.`,
    ...(i.reason ? [``, `Reason: ${i.reason}`] : []),
  ]
  await notify({
    to: i.to,
    kind,
    subject,
    text: sign(body),
    html: renderEmail({
      serial: serialFor(kind, i.requestId),
      subject,
      stamp: { label: i.approved ? "Approved" : "Declined", tone: i.approved ? "approved" : "declined" },
      intro: `Your request for ${i.itemName} was ${verb}.`,
      prose: i.reason ? [`Reason: ${i.reason}`] : [],
      footer: noActionFooter,
    }),
    entity: "ASSET_REQUEST",
    entityId: i.requestId,
  })
}

export interface NationalIdChangeDecidedInput {
  to: string
  requestId: string
  approved: boolean
  reason: string | null
}

export async function sendNationalIdChangeDecidedEmail(
  i: NationalIdChangeDecidedInput
): Promise<void> {
  const kind = "NATIONAL_ID_CHANGE_DECIDED" as const
  const verb = i.approved ? "approved" : "declined"
  const subject = `Your national ID change was ${verb}`
  const body = [
    `Your requested change to your national ID was ${verb}.`,
    ...(i.reason ? [``, `Reason: ${i.reason}`] : []),
  ]
  await notify({
    to: i.to,
    kind,
    subject,
    text: sign(body),
    html: renderEmail({
      serial: serialFor(kind, i.requestId),
      subject,
      stamp: { label: i.approved ? "Approved" : "Declined", tone: i.approved ? "approved" : "declined" },
      intro: `Your requested change to your national ID was ${verb}.`,
      prose: i.reason ? [`Reason: ${i.reason}`] : [],
      footer: noActionFooter,
    }),
    entity: "EMPLOYEE_PROFILE",
    entityId: i.requestId,
  })
}

export interface SettlementStatementInput {
  to: string
  settlementId: string
  fullName: string
  currency: string
  lines: Array<{ label: string; amount: string }>
  netPayable: string
}

export async function sendSettlementStatementEmail(i: SettlementStatementInput): Promise<void> {
  const kind = "SETTLEMENT_STATEMENT" as const
  const rows = i.lines.map((l) => `${l.label}: ${i.currency} ${l.amount}`)
  const body = [
    `Dear ${i.fullName},`,
    ``,
    `Your final settlement has been paid. Here is how it was worked out:`,
    ``,
    ...rows,
    ``,
    `Net payable: ${i.currency} ${i.netPayable}`,
    ``,
    `If anything looks wrong, reply to this email and we will check it.`,
  ]
  await notify({
    to: i.to,
    kind,
    subject: `Your final settlement — ${env.COMPANY_NAME}`,
    text: sign(body),
    html: renderEmail({
      serial: serialFor(kind, i.settlementId),
      subject: "Your final settlement",
      stamp: { label: "Paid", tone: "approved" },
      intro: `Dear ${i.fullName}, your final settlement has been paid. Here is how it was worked out:`,
      money: {
        rows: i.lines.map((l) => ({ label: l.label, value: `${i.currency} ${l.amount}` })),
        netLabel: "Net payable",
        netValue: `${i.currency} ${i.netPayable}`,
      },
      notice: "If anything looks wrong, reply to this email and we will check it.",
      footer: noActionFooter,
    }),
    entity: "SETTLEMENT",
    entityId: i.settlementId,
  })
}

export async function sendPasswordChangedEmail(i: { to: string; userId: string }): Promise<void> {
  const kind = "PASSWORD_CHANGED" as const
  const resetUrl = `${env.CLIENT_ORIGIN}/forgot-password`
  const body = [
    `Your ${env.COMPANY_NAME} password was just changed.`,
    ``,
    `If this wasn't you, reset your password immediately at ${resetUrl} and tell your administrator.`,
  ]
  await notify({
    to: i.to,
    kind,
    subject: `Your ${env.COMPANY_NAME} password was changed`,
    text: sign(body),
    html: renderEmail({
      serial: serialFor(kind, i.userId),
      subject: `Your ${env.COMPANY_NAME} password was changed`,
      stamp: { label: "Security notice", tone: "notice" },
      intro: `Your ${env.COMPANY_NAME} password was just changed.`,
      action: {
        label: "Reset your password",
        href: resetUrl,
        note: "If this wasn't you, reset your password immediately and tell your administrator.",
      },
      footer: `You are receiving this because a password change affects this account at ${env.COMPANY_NAME}.`,
    }),
    entity: "USER_ACCOUNT",
    entityId: i.userId,
  })
}
