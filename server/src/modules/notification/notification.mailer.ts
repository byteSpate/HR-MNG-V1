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
 * Two of the seven carry a link, and only two: their reader has to go and do
 * something. The other five are told an outcome they cannot action, and a
 * link there is only a reason to log in and find nothing.
 */

import { env } from "../../config/env"
import { notify } from "../../utils/mailer"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const sign = (lines: string[]): string => [...lines, ``, env.COMPANY_NAME].join("\n")

const asHtml = (lines: string[]): string =>
  `<p>${lines.filter(Boolean).join("</p><p>")}</p><p>${env.COMPANY_NAME}</p>`

const appLink = (path: string): string => `${env.CLIENT_ORIGIN}${path}`

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
  const link = appLink("/manager/leave")
  const body = [
    `${i.employeeName} has requested ${i.days} day${i.days === "1" ? "" : "s"} of ${i.leaveType}, from ${i.startDate} to ${i.endDate}.`,
    ``,
    `Review it: ${link}`,
  ]
  await notify({
    to: i.to,
    kind: "LEAVE_REQUESTED",
    subject: `${i.employeeName} requested ${i.leaveType}`,
    text: sign(body),
    html:
      `<p>${i.employeeName} has requested ${i.days} day${i.days === "1" ? "" : "s"} of ${i.leaveType}, from <strong>${i.startDate}</strong> to <strong>${i.endDate}</strong>.</p>` +
      `<p><a href="${link}">Review it</a></p>` +
      `<p>${env.COMPANY_NAME}</p>`,
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
  const verb = i.approved ? "approved" : "declined"
  const subject = `Your leave request was ${verb}`
  const body = [
    `Your ${i.leaveType} request for ${i.startDate} to ${i.endDate} was ${verb}.`,
    ...(i.reason ? [``, `Reason: ${i.reason}`] : []),
  ]
  await notify({
    to: i.to,
    kind: "LEAVE_DECIDED",
    subject,
    text: sign(body),
    html: asHtml(body),
    entity: "LEAVE_REQUEST",
    entityId: i.requestId,
  })
}

export interface ExpenseDecidedInput {
  to: string
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
  approved: boolean
  reason: string | null
}

export async function sendExpenseDecidedEmail(i: ExpenseDecidedInput): Promise<void> {
  const verb = i.approved ? "approved" : "declined"
  const body = [
    `Your expense claim for ${i.claimRef}, ${i.currency} ${i.amount}, was ${verb}.`,
    ...(i.reason ? [``, `Reason: ${i.reason}`] : []),
  ]
  await notify({
    to: i.to,
    kind: "EXPENSE_DECIDED",
    subject: `Expense claim for ${i.claimRef} was ${verb}`,
    text: sign(body),
    html: asHtml(body),
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
  const period = `${MONTHS[i.month - 1]} ${i.year}`
  const link = appLink("/admin/payroll")
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
    kind: "PAYROLL_SUBMITTED",
    subject: `Payroll for ${period} is waiting for approval`,
    text: sign(body),
    html:
      `<p>The payroll run for <strong>${period}</strong> has been submitted and is waiting for approval.</p>` +
      `<p>Employees: <strong>${i.employeeCount}</strong><br />` +
      `Total net: <strong>${i.currency} ${i.totalNet}</strong></p>` +
      `<p><a href="${link}">Review it</a></p>` +
      `<p>${env.COMPANY_NAME}</p>`,
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
  const verb = i.approved ? "approved" : "declined"
  const body = [
    `Your request for ${i.itemName} was ${verb}.`,
    ...(i.reason ? [``, `Reason: ${i.reason}`] : []),
  ]
  await notify({
    to: i.to,
    kind: "ASSET_REQUEST_DECIDED",
    subject: `Your request for ${i.itemName} was ${verb}`,
    text: sign(body),
    html: asHtml(body),
    entity: "ASSET_REQUEST",
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
    kind: "SETTLEMENT_STATEMENT",
    subject: `Your final settlement — ${env.COMPANY_NAME}`,
    text: sign(body),
    html:
      `<p>Dear ${i.fullName},</p>` +
      `<p>Your final settlement has been paid. Here is how it was worked out:</p>` +
      `<ul>${i.lines.map((l) => `<li>${l.label}: ${i.currency} ${l.amount}</li>`).join("")}</ul>` +
      `<p><strong>Net payable: ${i.currency} ${i.netPayable}</strong></p>` +
      `<p>If anything looks wrong, reply to this email and we will check it.</p>` +
      `<p>${env.COMPANY_NAME}</p>`,
    entity: "SETTLEMENT",
    entityId: i.settlementId,
  })
}

export async function sendPasswordChangedEmail(i: { to: string; userId: string }): Promise<void> {
  const body = [
    `Your ${env.COMPANY_NAME} password was just changed.`,
    ``,
    `If this wasn't you, reset your password immediately at ${env.CLIENT_ORIGIN}/forgot-password and tell your administrator.`,
  ]
  await notify({
    to: i.to,
    kind: "PASSWORD_CHANGED",
    subject: `Your ${env.COMPANY_NAME} password was changed`,
    text: sign(body),
    html: asHtml(body),
    entity: "USER_ACCOUNT",
    entityId: i.userId,
  })
}
