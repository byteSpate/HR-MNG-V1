/**
 * Receipts on an expense claim.
 *
 * Follows `cost.media.ts` — same single owner, same `publicId`-not-URL rule,
 * same "upload after the parent is validated, destroy before the transaction
 * opens" ordering, and the same compensating delete when the row write fails
 * after the blob already exists.
 *
 * **What is different, and why this is not just cost.media.ts with a renamed
 * column.** Company bills are handled only by Finance, so that module needs no
 * ownership check at all. A claim belongs to a person:
 *
 * - an employee may attach to, read and remove receipts on **their own**
 *   claims; anybody else's is a 403, not a 404, because the claim plainly
 *   exists and pretending otherwise helps nobody
 * - attaching and removing stop once a claim leaves `PENDING`. Evidence behind
 *   a decision somebody already made must not change underneath it — that is
 *   the difference between a receipt and a note
 * - Finance and HR may read any claim's receipts, since approving one without
 *   seeing what it is for is the thing receipts exist to prevent
 */

import prisma from "../../config/prisma"
import type { ExpenseAttachment } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { requireEmployeeForUser } from "../attendance/attendance.service"
import type { AccessTokenPayload } from "../auth/auth.types"
import { PAYROLL_ADMIN_ROLES } from "./expense.service"
import {
  destroyAsset,
  expensePublicId,
  signedDocumentUrl,
  uploadBuffer,
} from "../media/media.service"

/** The slice of Express.Multer.File this module needs. */
export interface UploadedFile {
  buffer: Buffer
  originalname: string
}

export interface ReceiptItem {
  id: string
  fileName: string
  bytes: number
  format: string
  uploadedAt: string
}

function toItem(row: {
  id: string
  fileName: string
  bytes: number
  format: string
  uploadedAt: Date
}): ReceiptItem {
  return {
    id: row.id,
    fileName: row.fileName,
    bytes: row.bytes,
    format: row.format,
    uploadedAt: row.uploadedAt.toISOString(),
  }
}

/**
 * Resolves the claim and decides whether this caller may touch it.
 *
 * `write` distinguishes the two questions. Finance reading a receipt to judge
 * a claim is the normal case; nobody — Finance included — edits the evidence
 * behind a decision that has already been made, so a decided claim refuses
 * writes from everyone.
 */
async function claimFor(
  actor: AccessTokenPayload,
  claimId: string,
  intent: "read" | "write"
): Promise<{ id: string; employeeId: string; status: string }> {
  const claim = await prisma.expenseClaim.findUnique({
    where: { id: claimId },
    select: { id: true, employeeId: true, status: true },
  })
  if (!claim) throw new AppError(404, "Expense claim not found")

  const isAdmin = PAYROLL_ADMIN_ROLES.includes(actor.role)
  if (!isAdmin) {
    const self = await requireEmployeeForUser(actor.sub)
    if (claim.employeeId !== self.id) {
      throw new AppError(403, "You may only work on your own expense claims")
    }
  }

  if (intent === "write" && claim.status !== "PENDING") {
    throw new AppError(
      409,
      `This claim is already ${claim.status.toLowerCase()}, so its receipts can no longer be changed.`
    )
  }

  return claim
}

export async function uploadReceipt(
  claimId: string,
  file: UploadedFile,
  actor: AccessTokenPayload
): Promise<ExpenseAttachment> {
  // Validated before `uploadBuffer` is ever called: uploading first would
  // leave an orphan blob in Cloudinary that nothing points at, and would let
  // somebody push files against a claim they cannot see.
  await claimFor(actor, claimId, "write")

  const uploaded = await uploadBuffer(file.buffer, expensePublicId(claimId))

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.expenseAttachment.create({
        data: {
          claimId,
          publicId: uploaded.publicId,
          fileName: file.originalname,
          bytes: uploaded.bytes,
          format: uploaded.format,
          uploadedBy: actor.sub,
        },
      })
      await writeAudit(tx, {
        entity: "EXPENSE_CLAIM",
        entityId: claimId,
        action: "CREATE",
        changedBy: actor.sub,
        after: { fileName: file.originalname },
      })
      return created
    })
  } catch (err) {
    // The blob already exists in Cloudinary at this point; a persist failure
    // here must not leave it dangling with no row pointing at it.
    await destroyAsset(uploaded.publicId)
    throw err
  }
}

export async function listReceipts(
  claimId: string,
  actor: AccessTokenPayload
): Promise<ReceiptItem[]> {
  await claimFor(actor, claimId, "read")
  const rows = await prisma.expenseAttachment.findMany({
    where: { claimId },
    orderBy: { uploadedAt: "desc" },
  })
  return rows.map(toItem)
}

export async function getReceiptUrl(
  receiptId: string,
  actor: AccessTokenPayload
): Promise<{ url: string; expiresAt: string }> {
  const receipt = await prisma.expenseAttachment.findUnique({ where: { id: receiptId } })
  if (!receipt) throw new AppError(404, "Receipt not found")
  // Checked through the claim, not the receipt: a signed URL is the file
  // itself, so the permission question is the same one as reading the claim.
  await claimFor(actor, receipt.claimId, "read")
  return signedDocumentUrl(receipt.publicId, receipt.format)
}

export async function deleteReceipt(receiptId: string, actor: AccessTokenPayload): Promise<void> {
  const receipt = await prisma.expenseAttachment.findUnique({ where: { id: receiptId } })
  if (!receipt) throw new AppError(404, "Receipt not found")
  await claimFor(actor, receipt.claimId, "write")

  // Destroy the Cloudinary blob before the row is deleted, and before the
  // transaction opens: the reverse order can orphan a blob nothing points at,
  // while this order can at worst leave a row pointing at an already-destroyed
  // asset, which the URL endpoint surfaces as a clean 404 rather than an
  // invisible leak. It also keeps the transaction to DB-only work — a slow
  // Cloudinary call must not pin a connection-pool slot.
  await destroyAsset(receipt.publicId)

  await prisma.$transaction(async (tx) => {
    await tx.expenseAttachment.delete({ where: { id: receiptId } })
    await writeAudit(tx, {
      entity: "EXPENSE_CLAIM",
      entityId: receipt.claimId,
      action: "DELETE",
      changedBy: actor.sub,
      before: { fileName: receipt.fileName },
    })
  })
}
