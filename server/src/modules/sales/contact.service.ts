import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { emitEvent } from "../event/event.emit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { SalesContactSummary } from "./sales.types"
import type { CreateSalesContactBody, SetContactStatusBody } from "./sales.validators"
import { requireAccountAccess } from "./sales.access"

type ContactRow = {
  id: string
  salesAccountId: string
  name: string
  designation: string | null
  phone: string | null
  email: string | null
  isPrimary: boolean
  status: SalesContactSummary["status"]
  verifiedAt: Date | null
  note: string | null
  createdAt: Date
}

/**
 * `verifiedBy` is deliberately not here. It is a user id, and the panel that
 * shows contacts has no way to turn one into a name — publishing it would be
 * an opaque uuid on the screen. It stays in the row for the audit trail.
 */
function toSummary(contact: ContactRow): SalesContactSummary {
  return {
    id: contact.id,
    salesAccountId: contact.salesAccountId,
    name: contact.name,
    designation: contact.designation,
    phone: contact.phone,
    email: contact.email,
    isPrimary: contact.isPrimary,
    status: contact.status,
    verifiedAt: contact.verifiedAt?.toISOString() ?? null,
    note: contact.note,
    createdAt: contact.createdAt.toISOString(),
  }
}

/**
 * Contacts are addressed by their own id, but permission lives on the
 * account, so every write here is a two-step: find the contact, then ask
 * whether the caller may see the account it belongs to.
 *
 * The contact is fetched before the account check rather than after, because
 * the account id is only knowable from the contact.
 */
async function requireContactAccess(contactId: string, actor: AccessTokenPayload) {
  const contact = await prisma.salesContact.findUnique({ where: { id: contactId } })
  if (!contact) {
    throw new AppError(404, "That contact does not exist")
  }
  const { ownerEmployeeId } = await requireAccountAccess(contact.salesAccountId, actor)
  return { contact, ownerEmployeeId }
}

export async function listContacts(
  accountId: string,
  actor: AccessTokenPayload
): Promise<SalesContactSummary[]> {
  await requireAccountAccess(accountId, actor)
  const contacts = await prisma.salesContact.findMany({
    where: { salesAccountId: accountId },
    // The primary is who you ring first, so it is who you read first.
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
  })
  return contacts.map(toSummary)
}

export async function addContact(
  accountId: string,
  body: CreateSalesContactBody,
  actor: AccessTokenPayload
): Promise<SalesContactSummary> {
  await requireAccountAccess(accountId, actor)

  return prisma.$transaction(async (tx) => {
    // No `isPrimary` and no `status`: both fall to their schema defaults.
    // Promoting a contact and saying somebody reached them are separate acts
    // with their own audit rows, and doing either silently on create would
    // put a fact on the screen that nobody asserted.
    const contact = await tx.salesContact.create({
      data: {
        salesAccountId: accountId,
        name: body.name,
        designation: body.designation ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        note: body.note ?? null,
        createdBy: actor.sub,
      },
    })

    await writeAudit(tx, {
      entity: "SALES_CONTACT",
      entityId: contact.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: {
        salesAccountId: accountId,
        name: contact.name,
        designation: contact.designation,
        phone: contact.phone,
        email: contact.email,
      },
    })

    return toSummary(contact)
  })
}

export async function setPrimaryContact(
  contactId: string,
  actor: AccessTokenPayload
): Promise<SalesContactSummary> {
  const { contact } = await requireContactAccess(contactId, actor)

  // Nothing to do, and nothing to audit. An audit row saying a contact was
  // promoted to a position it already held is noise in the one place that
  // has to stay readable.
  if (contact.isPrimary) {
    return toSummary(contact)
  }

  return prisma.$transaction(async (tx) => {
    // Demote first. Between these two statements the account momentarily has
    // no primary, which is a state the UI already handles; the other order
    // gives it two, which is a state nothing can resolve.
    await tx.salesContact.updateMany({
      where: { salesAccountId: contact.salesAccountId, isPrimary: true },
      data: { isPrimary: false },
    })

    const promoted = await tx.salesContact.update({
      where: { id: contact.id },
      data: { isPrimary: true },
    })

    await writeAudit(tx, {
      entity: "SALES_CONTACT",
      entityId: contact.id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { isPrimary: false },
      after: { isPrimary: true },
    })

    return toSummary(promoted)
  })
}

export async function setContactStatus(
  contactId: string,
  body: SetContactStatusBody,
  actor: AccessTokenPayload
): Promise<SalesContactSummary> {
  const { contact, ownerEmployeeId } = await requireContactAccess(contactId, actor)

  if (contact.status === body.status) {
    return toSummary(contact)
  }

  const verified = body.status === "VERIFIED"

  return prisma.$transaction(async (tx) => {
    const updated = await tx.salesContact.update({
      where: { id: contact.id },
      data: {
        status: body.status,
        // Cleared on every status that is not VERIFIED. A stale stamp says
        // somebody reached this person, when the last attempt proved the
        // opposite.
        verifiedAt: verified ? new Date() : null,
        verifiedBy: verified ? actor.sub : null,
      },
    })

    await writeAudit(tx, {
      entity: "SALES_CONTACT",
      entityId: contact.id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { status: contact.status },
      after: { status: body.status },
      note: body.note ?? null,
    })

    // Only verification goes on the Timeline. "We have a working number for
    // Mr Rahman" is the milestone; the three ways of not having one are
    // states of the contact, visible in the panel that lists them.
    if (verified) {
      await emitEvent(tx, {
        type: "sales.contact.verified",
        entity: "SALES_ACCOUNT",
        entityId: contact.salesAccountId,
        actorUserId: actor.sub,
        // The owner is answerable for the account, so a working number for it
        // is their news.
        subjectEmployeeId: ownerEmployeeId,
        // A verified phone number is not a fact about anybody's manager.
        managerEmployeeId: null,
        title: `${updated.name} verified`,
        meta: updated.designation ?? updated.phone ?? null,
        href: `/accounts/${contact.salesAccountId}`,
      })
    }

    return toSummary(updated)
  })
}
