/**
 * The preview, and downloading minutes for sending (revision §25.22 to §25.25).
 *
 * Record-only: the app never emails the customer; people send the PDF from
 * their own mailbox. "Download for sending" makes the PDF once, keeps those
 * bytes in the file store, records the send, and hands the same bytes back to
 * download, so the kept copy is exactly what went out.
 *
 * Nothing is marked sent without a kept copy. The file store is checked
 * before anything is made; a refused upload records nothing; and if the
 * minutes were saved while the PDF was being made, the send is refused and the
 * upload removed, so "sent" never describes a newer document than the copy.
 */

import { randomUUID } from "node:crypto"

import { env } from "../../../config/env"
import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { emitEvent } from "../../event/event.emit"
import { assertMediaConfigured } from "../../media/media.provider"
import { destroyAsset, signedDocumentUrl, uploadBuffer } from "../../media/media.service"
import { dayLabel, minutesFileName, renderMinutesPdf } from "./minutes.pdf"
import { documentOf, loadMinutes, namesFor, type MinutesRow } from "./minutes.service"
import { accountScopeFor, employeeIdFor } from "../sales.access"

export const SENT_COPY_NOT_VISIBLE = "That copy does not exist, or is not yours"

/** 15s: a kept copy is fetched on the download path, well under Heroku's 30s limit. */
const FETCH_TIMEOUT_MS = 15_000

export interface MinutesFile {
  pdf: Buffer
  fileName: string
}

/** Random, because every send keeps its own copy (§25.25). */
function sendPublicId(minutesId: string): string {
  return `sales/minutes/${minutesId}/${randomUUID()}`
}

async function render(row: MinutesRow, draft: boolean): Promise<MinutesFile> {
  const names = await namesFor(row)
  const arrangedBy = row.meeting.createdBy ? (names.get(row.meeting.createdBy) ?? null) : null
  const doc = documentOf(row, arrangedBy)
  return {
    pdf: await renderMinutesPdf(doc, draft),
    fileName: minutesFileName(doc.accountName, doc.scheduledAt, env.APP_TIMEZONE),
  }
}

/** DRAFT across every page, and nothing kept (§25.23). */
export async function previewMinutes(id: string, actor: AccessTokenPayload): Promise<MinutesFile> {
  const employeeId = await employeeIdFor(actor)
  return render(await loadMinutes(prisma, id, actor, employeeId), true)
}

export async function sendMinutes(
  id: string,
  body: { sentTo?: string | null },
  actor: AccessTokenPayload
): Promise<MinutesFile> {
  const employeeId = await employeeIdFor(actor)
  const row = await loadMinutes(prisma, id, actor, employeeId)
  if (row.meeting.opportunityId === null && row.requirementFound === null) {
    throw new AppError(400, "Say whether a requirement was found before sending the minutes")
  }
  if (row.preparers.length === 0) {
    throw new AppError(400, "Add who prepared the minutes, under Prepared by, before sending them")
  }
  // Before anything is made: a copy that cannot be kept must not be sent.
  assertMediaConfigured()

  const file = await render(row, false)
  const asset = await uploadBuffer(file.pdf, sendPublicId(id))
  const sentTo = body.sentTo?.trim() || null
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.salesMeetingMinutes.findUnique({ where: { id }, select: { updatedAt: true } })
      if (!current || current.updatedAt.getTime() !== row.updatedAt.getTime()) {
        throw new AppError(
          409,
          "The minutes were changed while the PDF was being made. Press Download for sending again to send the latest version."
        )
      }
      const sentAt = new Date()
      await tx.salesMinutesSend.create({
        data: { minutesId: id, sentAt, sentBy: actor.sub, sentTo, fileId: asset.publicId, fileName: file.fileName },
      })
      await tx.salesMeetingMinutes.update({ where: { id }, data: { status: "SENT", lastSentAt: sentAt } })
      await writeAudit(tx, {
        entity: "SALES_MINUTES",
        entityId: id,
        action: "SEND",
        changedBy: actor.sub,
        after: { fileName: file.fileName, sentTo },
        note: sentTo ? `Sent to ${sentTo}` : "Sent",
      })
      // The account's Timeline, and a linked deal's through the payload. No
      // email and no bell: the attendees were at the meeting (§25.34).
      await emitEvent(tx, {
        type: "sales.minutes.sent",
        entity: "SALES_ACCOUNT",
        entityId: row.meeting.salesAccountId,
        actorUserId: actor.sub,
        subjectEmployeeId: row.meeting.salesAccount.ownerEmployeeId,
        managerEmployeeId: null,
        title: `Minutes sent: ${row.meeting.title}`,
        meta: `Meeting on ${dayLabel(row.meeting.scheduledAt, env.APP_TIMEZONE)}`,
        href: `/accounts/${row.meeting.salesAccountId}`,
        payload: { meetingId: row.meetingId, opportunityId: row.meeting.opportunityId, minutesId: id },
      })
    })
  } catch (err) {
    // Nothing was recorded, so nothing may be kept either.
    await destroyAsset(asset.publicId)
    throw err
  }
  return file
}

/** A copy exactly as it was sent, for the people who may read the minutes. */
export async function getSentCopy(sendId: string, actor: AccessTokenPayload): Promise<MinutesFile> {
  const employeeId = await employeeIdFor(actor)
  const send = await prisma.salesMinutesSend.findFirst({
    where: { id: sendId, minutes: { meeting: { salesAccount: accountScopeFor(actor, employeeId) } } },
    select: { id: true, fileId: true, fileName: true },
  })
  if (!send) throw new AppError(404, SENT_COPY_NOT_VISIBLE)

  const { url } = signedDocumentUrl(send.fileId, "pdf")
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null)
  if (!res?.ok) {
    throw new AppError(502, "The kept copy could not be fetched from the file store. Try again in a moment.")
  }
  return { pdf: Buffer.from(await res.arrayBuffer()), fileName: send.fileName }
}
