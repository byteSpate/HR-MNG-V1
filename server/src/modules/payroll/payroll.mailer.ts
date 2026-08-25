/**
 * Payslip email, with the same dev fallback the rest of the system uses:
 * with `SMTP_HOST` unset, `sendMail` logs to the console instead of sending,
 * so this is developable without an SMTP account.
 */

import { env } from "../../config/env"
import { renderEmail } from "../../templates/email"
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

  const html = renderEmail({
    serial: input.payslipNo,
    subject: `Payslip for ${period}`,
    stamp: { label: "Issued", tone: "issued" },
    intro: `Dear ${input.fullName}, your payslip for ${period} is attached.`,
    facts: [
      { label: "Net payable", value: `${input.currency} ${input.netPayable}` },
    ],
    notice: `Attached: ${input.payslipNo}.pdf — if anything looks wrong, reply to this email and we will check it.`,
    footer: `You are receiving this because payroll for ${period} was approved at ${env.COMPANY_NAME}.`,
  })

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
