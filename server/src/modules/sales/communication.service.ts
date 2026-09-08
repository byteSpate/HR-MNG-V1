import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { SalesChannel } from "../../generated/prisma/client"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { SalesCommunicationSummary, TimelineItem } from "./sales.types"
import type { LogCommunicationBody } from "./sales.validators"
import { requireAccountAccess, requireAccountVisible } from "./sales.access"

/**
 * How many rows of each source the Timeline reads.
 *
 * Taken per source and then trimmed after the merge, so the answer is the
 * genuinely newest hundred and not the newest hundred of whichever table
 * happened to be busier. An account with more history than this needs paging,
 * which is a Phase 2 conversation and not a silent truncation today.
 */
const TIMELINE_LIMIT = 100

const CHANNEL_LABEL: Record<SalesChannel, string> = {
  CALL: "Call",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  OTHER: "Other",
}

type CommunicationRow = {
  id: string
  salesAccountId: string
  contactId: string | null
  channel: SalesChannel
  occurredAt: Date
  summary: string
  detail: string | null
  employeeId: string
  createdAt: Date
}

function toSummary(row: CommunicationRow): SalesCommunicationSummary {
  return {
    id: row.id,
    salesAccountId: row.salesAccountId,
    contactId: row.contactId,
    channel: row.channel,
    occurredAt: row.occurredAt.toISOString(),
    summary: row.summary,
    detail: row.detail,
    employeeId: row.employeeId,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function logCommunication(
  accountId: string,
  body: LogCommunicationBody,
  actor: AccessTokenPayload
): Promise<SalesCommunicationSummary> {
  const { employeeId } = await requireAccountAccess(accountId, actor)

  // Super Admin and HR Admin are seeded with no Employee row, and authorship
  // is a required column. Refused here as a 400 rather than left to fail as a
  // Prisma error the middleware renders as a 500.
  if (!employeeId) {
    throw new AppError(
      400,
      "Only an employee can log a communication, and your account has no employee record"
    )
  }

  const occurredAt = new Date(body.occurredAt)
  // A call logged for next Tuesday is a typo, and it would sit at the top of
  // the Timeline until next Tuesday arrived.
  if (occurredAt.getTime() > Date.now()) {
    throw new AppError(400, "A communication cannot have happened in the future")
  }

  // Scoped to this account, not just looked up by id: without the account in
  // the `where`, a caller could hang a call off a contact belonging to an
  // account they have never seen.
  if (body.contactId) {
    const contact = await prisma.salesContact.findFirst({
      where: { id: body.contactId, salesAccountId: accountId },
      select: { id: true },
    })
    if (!contact) {
      throw new AppError(400, "That contact is not on this account")
    }
  }

  return prisma.$transaction(async (tx) => {
    const communication = await tx.salesCommunication.create({
      data: {
        salesAccountId: accountId,
        contactId: body.contactId ?? null,
        channel: body.channel,
        occurredAt,
        summary: body.summary,
        detail: body.detail ?? null,
        employeeId,
      },
    })

    await writeAudit(tx, {
      entity: "SALES_COMMUNICATION",
      entityId: communication.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: {
        salesAccountId: accountId,
        channel: communication.channel,
        occurredAt: communication.occurredAt.toISOString(),
        summary: communication.summary,
      },
    })

    // No event. A communication is already a Timeline row in its own right,
    // and emitting one would put the same line in the feed twice.
    return toSummary(communication)
  })
}

/**
 * The story of an account, from the two tables that hold it: the calls and
 * emails people logged, and the events the system recorded about the account.
 *
 * Merged in the service rather than in SQL. A UNION across two
 * differently-shaped tables needs every column cast to match, and at this size
 * it would not be any faster — both reads are already indexed, on
 * `[salesAccountId, occurredAt]` and on `[entity, entityId, createdAt]`.
 */
export async function getAccountTimeline(
  accountId: string,
  actor: AccessTokenPayload
): Promise<{ items: TimelineItem[] }> {
  // A read: any Sales Hub member may see an account's story. Logging a new
  // entry stays owner/assignee/admin only, via logCommunication above.
  await requireAccountVisible(accountId, actor)

  const [communications, events] = await Promise.all([
    prisma.salesCommunication.findMany({
      where: { salesAccountId: accountId },
      orderBy: { occurredAt: "desc" },
      take: TIMELINE_LIMIT,
      include: {
        employee: { select: { fullName: true } },
        contact: { select: { name: true } },
      },
    }),
    prisma.event.findMany({
      where: { entity: "SALES_ACCOUNT", entityId: accountId },
      orderBy: { createdAt: "desc" },
      take: TIMELINE_LIMIT,
    }),
  ])

  const items: TimelineItem[] = [
    ...communications.map((row) => ({
      id: `communication:${row.id}`,
      kind: "communication" as const,
      at: row.occurredAt.toISOString(),
      title: row.summary,
      meta: row.contact
        ? `${CHANNEL_LABEL[row.channel]} · ${row.contact.name}`
        : CHANNEL_LABEL[row.channel],
      by: row.employee.fullName,
      // The bug this fixes: `detail` was saved and never read back, so what
      // a caller typed into the long-form note vanished from their own eyes
      // the moment they logged it, even though it was sitting in the row
      // the whole time.
      detail: row.detail,
    })),
    ...events.map((row) => ({
      id: `event:${row.id}`,
      kind: "event" as const,
      at: row.createdAt.toISOString(),
      title: row.title,
      meta: row.meta,
      // `actorUserId` is a user id and there is nothing here to turn one into
      // a name. Event titles are written to carry the actor already — "Rising
      // Group added to the Sales Hub" — so an opaque uuid would add nothing.
      by: null,
      // No free-text body of its own — the title already is the sentence.
      detail: null,
    })),
  ]

  // `occurredAt` for a communication and `createdAt` for an event: when it
  // happened, not when it was typed. A call logged three days late belongs
  // where it happened, or the Timeline stops being a sequence of events.
  items.sort((a, b) => b.at.localeCompare(a.at))

  return { items: items.slice(0, TIMELINE_LIMIT) }
}
