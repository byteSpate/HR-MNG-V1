import nodemailer, { type Transporter } from "nodemailer"

import { env } from "../config/env"
import prisma from "../config/prisma"

/**
 * The one place mail leaves this server.
 *
 * Recording is inside this function rather than beside it: there is one way
 * to send mail and it always produces an `EmailDispatch` row, so no caller
 * can send something the log does not know about. Same reasoning as the
 * single PrismaClient.
 *
 * With no `SMTP_HOST` configured, mail is logged to the console instead of
 * sent — a deliberate dev-mode fallback, not a bug. The dispatch row is still
 * written, so the log is exercisable without an SMTP account.
 */

/** Every kind of email this system sends. The schema comment points here. */
export type DispatchKind =
  | "PASSWORD_RESET"
  | "PASSWORD_CHANGED"
  | "CREDENTIALS"
  | "EMAIL_CHANGE_CODE"
  | "EMAIL_CHANGE_WARNING"
  | "ATTENDANCE_DIGEST"
  | "MISSING_CHECKOUT"
  | "PAYSLIP"
  | "LEAVE_REQUESTED"
  | "LEAVE_DECIDED"
  | "EXPENSE_DECIDED"
  | "PAYROLL_SUBMITTED"
  | "ASSET_REQUEST_DECIDED"
  | "SETTLEMENT_STATEMENT"

export interface MailAttachment {
  filename: string
  content: Buffer
}

export interface Dispatch {
  to: string
  kind: DispatchKind
  subject: string
  text: string
  html: string
  /** What the email is about, for the log. Same pair as AuditLog. */
  entity?: string
  entityId?: string
  attachments?: MailAttachment[]
}

/**
 * Built once and reused. Creating a transport per send meant a payroll run of
 * 500 payslips opened 500 TCP connections and 500 SMTP handshakes, which is
 * both slow and what providers rate-limit on.
 */
let transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      pool: true,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  }
  return transporter
}

/**
 * Send, and throw if it fails.
 *
 * For the two emails a person is actively waiting on — a password reset link
 * and an email-change code. Swallowing those leaves someone staring at a
 * screen forever. Everything else should use `notify`.
 */
export async function sendMail(d: Dispatch): Promise<void> {
  const row = await prisma.emailDispatch.create({
    data: {
      to: d.to,
      kind: d.kind,
      subject: d.subject,
      entity: d.entity ?? null,
      entityId: d.entityId ?? null,
    },
  })

  try {
    if (!env.SMTP_HOST) {
      const note = d.attachments?.length ? ` (+${d.attachments.length} attachment)` : ""
      console.log(`[dev email fallback] To: ${d.to} | Subject: ${d.subject}${note}\n${d.text}`)
    } else {
      await getTransporter().sendMail({
        from: env.EMAIL_FROM ?? "no-reply@peoplecore.io",
        to: d.to,
        subject: d.subject,
        text: d.text,
        html: d.html,
        attachments: d.attachments,
      })
    }
    await prisma.emailDispatch.update({ where: { id: row.id }, data: { sentAt: new Date() } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.emailDispatch.update({ where: { id: row.id }, data: { error: message } })
    throw err
  }
}

/**
 * Send, and swallow a failure into the log.
 *
 * For every notification: an approved leave request must not roll back
 * because SMTP is down. The failure is not silent — it leaves a dispatch row
 * with `error` set, which is the point of the log.
 */
export async function notify(d: Dispatch): Promise<void> {
  await sendMail(d).catch((err) => {
    console.error(`[email] ${d.kind} to ${d.to} failed`, err)
  })
}
