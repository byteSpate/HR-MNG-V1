import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { packAvatar, unpackAvatar } from "../../employee/employee.media"
import { isMediaConfigured, assertMediaConfigured } from "../../media/media.provider"
import { destroyAsset, signedAvatarUrl, uploadBuffer, visitingCardPublicId } from "../../media/media.service"
import { ACCOUNT_NOT_VISIBLE, canManageAccount, employeeIdFor } from "../sales.access"

/** The slice of Express.Multer.File this needs. */
export interface UploadedCard {
  buffer: Buffer
  originalname: string
}

const CANNOT_CHANGE =
  "You can view this Sales Account, but only its owner, collaborators, or a Sales Admin can change its visiting card"

/**
 * The link the page shows, or null.
 *
 * Null is also the answer when file storage is not set up: an account page
 * must still open on a machine with no Cloudinary keys, and a card that cannot
 * be shown is better left out than turned into an error for the whole page.
 * The signed link never expires, like an avatar, so the picture can be cached
 * and shown on every visit. `version` is in it, so a replaced card is not
 * served from an old cache.
 */
export function visitingCardUrlOf(stored: string | null | undefined): string | null {
  if (!stored || !isMediaConfigured()) return null
  const { publicId, version } = unpackAvatar(stored)
  return signedAvatarUrl(publicId, version)
}

/** The same write gate as editing the account, read fresh so a stale page cannot bypass it. */
async function loadForWrite(accountId: string, actor: AccessTokenPayload) {
  const account = await prisma.salesAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true, ownerEmployeeId: true, visitingCard: true,
      assignments: { select: { employeeId: true } },
    },
  })
  if (!account) throw new AppError(404, ACCOUNT_NOT_VISIBLE)
  const employeeId = await employeeIdFor(actor)
  if (!canManageAccount(actor, employeeId, account.ownerEmployeeId, account.assignments.map((a) => a.employeeId))) {
    throw new AppError(403, CANNOT_CHANGE)
  }
  return account
}

/**
 * Sets, or replaces, an account's visiting card.
 *
 * Checked before anything is uploaded (account, permission, file), so a
 * refusal costs no upload. The history row says a card was added or replaced
 * and never carries the picture: it holds a stranger's contact details and the
 * log is read by more people than the card should be.
 */
export async function setVisitingCard(
  accountId: string,
  file: UploadedCard | undefined,
  actor: AccessTokenPayload,
): Promise<{ visitingCardUrl: string | null }> {
  assertMediaConfigured()
  const account = await loadForWrite(accountId, actor)
  if (!file) throw new AppError(400, "Choose an image of the visiting card")

  const asset = await uploadBuffer(file.buffer, visitingCardPublicId(accountId))
  const had = account.visitingCard !== null
  try {
    await prisma.$transaction(async (tx) => {
      await tx.salesAccount.update({
        where: { id: accountId },
        data: { visitingCard: packAvatar(asset.publicId, asset.version) },
      })
      await writeAudit(tx, {
        entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
        ...(had ? { before: { visitingCard: "present" } } : {}),
        after: { visitingCard: had ? "replaced" : "added" },
      })
    })
  } catch (err) {
    // The picture is already in the file store. A failed save must not leave it
    // there with no record that it exists.
    if (!had) await destroyAsset(asset.publicId)
    throw err
  }
  return { visitingCardUrl: visitingCardUrlOf(packAvatar(asset.publicId, asset.version)) }
}

/** Removes the card: the picture first, then the field, so the worst case is a field pointing at nothing. */
export async function removeVisitingCard(
  accountId: string,
  actor: AccessTokenPayload,
): Promise<{ visitingCardUrl: null }> {
  assertMediaConfigured()
  const account = await loadForWrite(accountId, actor)
  if (!account.visitingCard) throw new AppError(404, "This Sales Account has no visiting card")

  await destroyAsset(unpackAvatar(account.visitingCard).publicId)
  await prisma.$transaction(async (tx) => {
    await tx.salesAccount.update({ where: { id: accountId }, data: { visitingCard: null } })
    await writeAudit(tx, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { visitingCard: "present" }, after: { visitingCard: "removed" },
    })
  })
  return { visitingCardUrl: null }
}
