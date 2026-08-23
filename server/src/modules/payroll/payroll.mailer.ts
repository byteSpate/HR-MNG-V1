/**
 * Payslip email, with the same dev fallback the rest of the system uses:
 * with `SMTP_HOST` unset, `sendMail` logs to the console instead of sending,
 * so this is developable without an SMTP account.
 */

import { env } from "../../config/env"
import { sendMail } from "../../utils/mailer"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export interface PayslipEmailInput {
  to: string
  fullName: string
  payslipNo: string
  month: number
  year: number
  currency: string
  netPayable: string
  pdf: Buffer
  /** For the EmailDispatch entity pair, so the log points at the payslip. */
  payslipId: string
}

export async function sendPayslipEmail(input: PayslipEmailInput): Promise<void> {
  const period = `${MONTHS[input.month - 1]} ${input.year}`
  const subject = `Payslip for ${period} — ${input.payslipNo}`
  const text = [
    `Dear ${input.fullName},`,
    ``,
    `Your payslip for ${period} is attached.`,
    ``,
    `Payslip number: ${input.payslipNo}`,
    `Net payable: ${input.currency} ${input.netPayable}`,
    ``,
    `If anything looks wrong, reply to this email and we will check it.`,
    ``,
    env.COMPANY_NAME,
  ].join("\n")
  const html = `<p>Dear ${input.fullName},</p>
    <p>Your payslip for <strong>${period}</strong> is attached.</p>
    <p>Payslip number: <strong>${input.payslipNo}</strong><br />
       Net payable: <strong>${input.currency} ${input.netPayable}</strong></p>
    <p>If anything looks wrong, reply to this email and we will check it.</p>
    <p>${env.COMPANY_NAME}</p>`

  await sendMail({
    to: input.to,
    kind: "PAYSLIP",
    subject,
    text,
    html,
    entity: "PAYSLIP",
    entityId: input.payslipId,
    attachments: [{ filename: `${input.payslipNo}.pdf`, content: input.pdf }],
  })
}
