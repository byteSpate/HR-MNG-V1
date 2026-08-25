/**
 * Asset requests, decided by Super Admin alone (ADR-0002).
 *
 * Approval can now mean "go and buy a laptop", and that purchase reaches the
 * ledger through capitalisation — authority to commit money sits at the top.
 * There is no resolved approver to notify any more, and no self-approval
 * guard: `POST /requests` is STAFF_ROLES only, so a Super Admin has no
 * request of their own to approve.
 *
 * Finance sees every request without deciding any: a pending purchase is a
 * pending payable.
 */

import prisma from "../../config/prisma"
import type { AssetRequest, Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { assignAsset } from "./asset.assignments"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { sendAssetRequestDecidedEmail } from "../notification/notification.mailer"
import { assetRequestEvent } from "./asset.events"
import type { SubmitRequestInput } from "./asset.validators"
import { computeRequestStage } from "./asset.stage"
import type { RequestStage } from "./asset.stage"

/**
 * ADR-0002: Super Admin alone decides, of every kind.
 *
 * This replaces the `reportingManagerId ?? HR` routing inherited from
 * attendance. Approval used to move no money — "hand them one from the
 * cupboard". It can now mean "go and buy a laptop", and that purchase reaches
 * the ledger through capitalisation. Authority to commit money sits at the top.
 *
 * The self-approval guard is gone with it: `POST /requests` is STAFF_ROLES
 * only, so a Super Admin has no request of their own to approve.
 */
function assertCanDecide(actor: AccessTokenPayload): void {
  if (actor.role !== "SUPER_ADMIN") {
    throw new AppError(403, "Only a Super Admin can decide an asset request")
  }
}

export async function submitRequest(
  input: SubmitRequestInput,
  actor: AccessTokenPayload
): Promise<AssetRequest> {
  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { userId: actor.sub } })
    if (!employee) throw new AppError(404, "Employee profile not found")

    let data: Prisma.AssetRequestUncheckedCreateInput
    let subject: string

    if (input.kind === "NEW_ITEM") {
      const category = await tx.assetCategory.findUnique({ where: { id: input.categoryId } })
      if (!category) throw new AppError(400, "Asset category not found")

      // Quantity belongs to supplies alone, in both directions.
      if (!category.tracksIndividually && input.quantity === undefined) {
        throw new AppError(400, `${category.name} is issued by quantity, so a quantity is required.`)
      }
      if (category.tracksIndividually && input.quantity !== undefined) {
        throw new AppError(400, `${category.name} is issued one at a time — submit one request per item.`)
      }

      data = {
        employeeId: employee.id,
        kind: "NEW_ITEM",
        categoryId: input.categoryId,
        assetId: null,
        quantity: input.quantity ?? null,
        reason: input.reason,
        status: "PENDING",
      }
      subject = category.name
    } else {
      // Decision 7: you may only ask about a thing you are holding. 404 rather
      // than 403 so an id outside your custody teaches nothing about what
      // exists (V-35).
      const held = await tx.assetAssignment.findFirst({
        where: { assetId: input.assetId, employeeId: employee.id, returnedAt: null },
        include: { asset: { select: { assetTag: true, name: true } } },
      })
      if (!held) throw new AppError(404, "Asset not found")

      // The unique partial index is the last line of defence; the service
      // surfaces the conflict as a 409 rather than letting P2002 render a 500.
      const openRequest = await tx.assetRequest.findFirst({
        where: {
          assetId: input.assetId,
          kind: input.kind,
          status: { in: ["PENDING", "APPROVED", "ORDERED"] },
        },
        select: { id: true },
      })
      if (openRequest) throw new AppError(409, "This asset already has an open request")

      data = {
        employeeId: employee.id,
        kind: input.kind,
        categoryId: null,
        assetId: input.assetId,
        quantity: null,
        reason: input.reason,
        status: "PENDING",
      }
      subject = `${held.asset.assetTag} · ${held.asset.name}`
    }

    const request = await tx.assetRequest.create({ data })

    await writeAudit(tx, {
      entity: "ASSET_REQUEST",
      entityId: request.id,
      action: "SUBMIT",
      changedBy: actor.sub,
      after: { kind: input.kind, reason: input.reason },
    })

    await emitEvent(
      tx,
      assetRequestEvent({
        stage: "submitted",
        requestId: request.id,
        employeeId: employee.id,
        subject,
        actorUserId: actor.sub,
        note: null,
      })
    )

    return request
  })
}

const listInclude = {
  category: true,
  asset: { select: { id: true, assetTag: true, name: true } },
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  repair: { select: { returnedAt: true } },
} satisfies Prisma.AssetRequestInclude

/** What `listRequests` returns: the stored row plus the nested rows it reads to derive the stage. */
export type ListedAssetRequest = Prisma.AssetRequestGetPayload<{
  include: typeof listInclude
}> & {
  stage: RequestStage
}

/**
 * Scoped the way attendance's approvals queue is: an employee sees their own
 * requests, a manager sees their own plus their reports', HR / Super Admin /
 * Finance see all.
 */
export async function listRequests(viewer: AccessTokenPayload): Promise<ListedAssetRequest[]> {
  // Finance sees everything because a pending purchase is a pending payable.
  // Before this they fell into the employee branch, had no Employee row, and
  // received an empty list.
  const unscoped =
    viewer.role === "HR_ADMIN" ||
    viewer.role === "SUPER_ADMIN" ||
    viewer.role === "FINANCE_OFFICER"

  let where: Prisma.AssetRequestWhereInput = {}
  if (!unscoped) {
    const self = await prisma.employee.findUnique({
      where: { userId: viewer.sub },
      select: { id: true },
    })
    if (!self) return []

    where =
      viewer.role === "REPORTING_MANAGER"
        ? { OR: [{ employeeId: self.id }, { employee: { reportingManagerId: self.id } }] }
        : { employeeId: self.id }
  }

  const rows = await prisma.assetRequest.findMany({
    where,
    include: listInclude,
    orderBy: { createdAt: "desc" },
  })

  return rows.map((r) => ({
    ...r,
    stage: computeRequestStage({
      kind: r.kind,
      status: r.status,
      repairReturnedAt: r.repair?.returnedAt ?? null,
    }),
  }))
}

/**
 * The requester's login, for the decision notification. Selected alongside
 * the decision read rather than in a second query, and optional-chained
 * throughout: an employee with no account has nobody to tell, which is not an
 * error.
 */
const DECISION_INCLUDE = {
  category: true,
  asset: { select: { assetTag: true, name: true } },
  employee: { select: { user: { select: { email: true } } } },
} as const

/** What the requester asked for, named the way the request page names it. */
function requestSubject(request: {
  category?: { name: string } | null
  asset?: { assetTag: string; name: string } | null
}): string {
  return request.category?.name ?? `${request.asset!.assetTag} · ${request.asset!.name}`
}

/**
 * Tell the requester. After the transaction, never inside it: an SMTP round
 * trip must not hold a database transaction open, and a decision that already
 * committed must not be undone by a mail server.
 */
async function notifyAssetDecision(
  requestId: string,
  request: {
    category?: { name: string } | null
    asset?: { assetTag: string; name: string } | null
    employee?: { user: { email: string } | null } | null
  },
  approved: boolean,
  reason: string | null
): Promise<void> {
  const to = request.employee?.user?.email
  if (!to) return
  await sendAssetRequestDecidedEmail({
    to,
    requestId,
    itemName: requestSubject(request),
    approved,
    reason,
  })
}

export async function approveRequest(
  requestId: string,
  body: { note?: string },
  actor: AccessTokenPayload
): Promise<AssetRequest> {
  const decided = await prisma.$transaction(async (tx) => {
    const request = await tx.assetRequest.findUnique({
      where: { id: requestId },
      include: DECISION_INCLUDE,
    })
    if (!request) throw new AppError(404, "Asset request not found")

    assertCanDecide(actor)

    if (request.status !== "PENDING") {
      throw new AppError(409, "This request has already been decided")
    }

    // Decision 5: approving a REPAIR is the act of sending it. The fault the
    // employee typed becomes the repair's fault, so the story is not retold.
    let repairId: string | null = null
    if (request.kind === "REPAIR") {
      const open = await tx.assetRepair.findFirst({
        where: { assetId: request.assetId!, returnedAt: null },
        select: { id: true },
      })
      if (open) throw new AppError(409, "This asset already has an open repair")

      const repair = await tx.assetRepair.create({
        data: {
          assetId: request.assetId!,
          sentAt: new Date(),
          sentBy: actor.sub,
          fault: request.reason,
        },
      })
      repairId = repair.id
    }

    const updated = await tx.assetRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        decidedBy: actor.sub,
        decidedAt: new Date(),
        decisionNote: body.note ?? null,
        ...(repairId ? { repairId } : {}),
      },
    })

    await writeAudit(tx, {
      entity: "ASSET_REQUEST",
      entityId: requestId,
      action: "APPROVE",
      changedBy: actor.sub,
      after: { status: "APPROVED" },
      note: body.note ?? null,
    })

    await emitEvent(
      tx,
      assetRequestEvent({
        stage: "approved",
        requestId,
        employeeId: request.employeeId,
        subject: requestSubject(request),
        actorUserId: actor.sub,
        note: body.note ?? null,
      })
    )

    return { updated, request }
  })

  await notifyAssetDecision(requestId, decided.request, true, body.note ?? null)
  return decided.updated
}

/** Reject requires a non-empty `note`, matching leave and attendance. */
export async function rejectRequest(
  requestId: string,
  body: { note: string },
  actor: AccessTokenPayload
): Promise<AssetRequest> {
  if (!body.note || !body.note.trim()) {
    throw new AppError(400, "A reason is required to reject a request")
  }

  const decided = await prisma.$transaction(async (tx) => {
    const request = await tx.assetRequest.findUnique({
      where: { id: requestId },
      include: DECISION_INCLUDE,
    })
    if (!request) throw new AppError(404, "Asset request not found")

    assertCanDecide(actor)

    if (request.status !== "PENDING") {
      throw new AppError(409, "This request has already been decided")
    }

    const updated = await tx.assetRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        decidedBy: actor.sub,
        decidedAt: new Date(),
        decisionNote: body.note,
      },
    })

    await writeAudit(tx, {
      entity: "ASSET_REQUEST",
      entityId: requestId,
      action: "REJECT",
      changedBy: actor.sub,
      after: { status: "REJECTED" },
      note: body.note,
    })

    await emitEvent(
      tx,
      assetRequestEvent({
        stage: "rejected",
        requestId,
        employeeId: request.employeeId,
        subject: requestSubject(request),
        actorUserId: actor.sub,
        note: body.note,
      })
    )

    return { updated, request }
  })

  await notifyAssetDecision(requestId, decided.request, false, body.note)
  return decided.updated
}

/** The requester's own while PENDING; HR / Super Admin may close a live request they cannot source. No event: there is no "cancelled" stage in the feed. */
export async function cancelRequest(
  requestId: string,
  input: { note?: string },
  actor: AccessTokenPayload
): Promise<AssetRequest> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.assetRequest.findUnique({ where: { id: requestId } })
    if (!request) throw new AppError(404, "Asset request not found")

    const isHr = actor.role === "HR_ADMIN" || actor.role === "SUPER_ADMIN"
    const LIVE = ["PENDING", "APPROVED", "ORDERED"]

    if (isHr) {
      // Decision 9: HR's dead end. "Discontinued, couldn't source it" is a
      // different fact from "she changed her mind", and the note is what
      // carries the difference.
      if (!input.note || !input.note.trim()) {
        throw new AppError(400, "A reason is required to cancel someone else's request")
      }
      if (!LIVE.includes(request.status)) {
        throw new AppError(409, "This request has already been closed")
      }
    } else {
      const self = await prisma.employee.findUnique({
        where: { userId: actor.sub },
        select: { id: true },
      })
      if (!self || self.id !== request.employeeId) {
        throw new AppError(403, "You can only cancel your own request")
      }
      if (request.status !== "PENDING") {
        throw new AppError(409, "Only a pending request can be cancelled")
      }
    }

    const updated = await tx.assetRequest.update({
      where: { id: requestId },
      data: {
        status: "CANCELLED",
        decidedBy: actor.sub,
        decidedAt: new Date(),
        decisionNote: input.note?.trim() || null,
      },
    })

    await writeAudit(tx, {
      entity: "ASSET_REQUEST",
      entityId: requestId,
      action: "CANCEL",
      changedBy: actor.sub,
      after: { status: "CANCELLED" },
      note: input.note?.trim() ?? null,
    })

    return updated
  })
}

/**
 * Someone went shopping. Deliberately carries no estimated cost: the real
 * figure lands on the Asset at creation, and two cost fields invite a
 * reconciliation nobody performs.
 */
export async function markOrdered(
  requestId: string,
  input: { expectedBy?: string; note?: string },
  actor: AccessTokenPayload
): Promise<AssetRequest> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.assetRequest.findUnique({ where: { id: requestId } })
    if (!request) throw new AppError(404, "Asset request not found")
    if (request.kind !== "NEW_ITEM") {
      throw new AppError(409, "Only a request for a new item can be ordered")
    }
    if (request.status !== "APPROVED") {
      throw new AppError(409, "Only an approved request can be marked as ordered")
    }

    const updated = await tx.assetRequest.update({
      where: { id: requestId },
      data: {
        status: "ORDERED",
        orderedAt: new Date(),
        orderedBy: actor.sub,
        expectedBy: input.expectedBy ? new Date(`${input.expectedBy}T00:00:00.000Z`) : null,
        orderNote: input.note ?? null,
      },
    })

    await writeAudit(tx, {
      entity: "ASSET_REQUEST",
      entityId: requestId,
      action: "ORDER",
      changedBy: actor.sub,
      after: { status: "ORDERED", expectedBy: input.expectedBy ?? null },
      note: input.note ?? null,
    })

    return updated
  })
}

export async function fulfilRequest(
  requestId: string,
  input: { assetId?: string; note?: string },
  actor: AccessTokenPayload
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.assetRequest.findUnique({
      where: { id: requestId },
      include: { category: { select: { name: true, tracksIndividually: true } } },
    })
    if (!request) throw new AppError(404, "Asset request not found")
    // Fulfilment is an action, not a second approval. HR either has a spare
    // monitor or does not; if they do not, the request stays APPROVED and
    // visibly unfulfilled, which is the honest state and a useful
    // procurement signal.
    // Decision 8: a spare turning up mid-order should not require cancelling
    // and resubmitting. ORDERED records that someone went shopping, not a
    // promise about which unit arrives.
    if (request.status !== "APPROVED" && request.status !== "ORDERED") {
      throw new AppError(409, "Only an approved or ordered request can be fulfilled")
    }
    // A REPAIR or RETURN request is completed by physically receiving the
    // asset back — the receiving flows already do that. Fulfilment hands out
    // another asset, which only a new-item request ever asks for.
    if (request.kind !== "NEW_ITEM") {
      throw new AppError(409, "Only a request for a new item can be fulfilled")
    }

    const isSupply = request.kind === "NEW_ITEM" && request.category?.tracksIndividually === false

    if (!isSupply) {
      if (!input.assetId) throw new AppError(400, "Choose which asset to hand over.")
      // Same transaction: a fulfilled request with no assignment behind it
      // would be a register that says somebody has a monitor nobody issued.
      await assignAsset(
        input.assetId,
        { employeeId: request.employeeId, conditionOut: "GOOD", requestId },
        actor,
        tx
      )
    }

    const updated = await tx.assetRequest.update({
      where: { id: requestId },
      data: {
        status: "FULFILLED",
        fulfilledAt: new Date(),
        fulfilledBy: actor.sub,
        fulfilledAssetId: isSupply ? null : input.assetId!,
        fulfilledNote: input.note ?? null,
      },
    })

    await writeAudit(tx, {
      entity: "ASSET_REQUEST",
      entityId: requestId,
      action: "FULFIL",
      changedBy: actor.sub,
      after: isSupply ? { status: "FULFILLED", fulfilledAssetId: null } : { assetId: input.assetId },
    })

    // No event here. assignAsset already emitted asset.assigned carrying the
    // request id; a second event would put one fact in the feed twice.
    return updated
  })
}

export interface TimelineEntry {
  action: string
  at: Date
  byUserId: string | null
  note: string | null
}

/**
 * The story of one request, read back from the audit rows every transition
 * already wrote inside its own transaction. Deliberately not a second table:
 * a status-history table would record the same facts twice and drift from the
 * first copy the moment one write path forgets it.
 */
export async function getRequestTimeline(
  requestId: string,
  viewer: AccessTokenPayload
): Promise<TimelineEntry[]> {
  // Scoped through listRequests' own rules so an out-of-scope id 404s rather
  // than leaking a history (V-35).
  const visible = await listRequests(viewer)
  if (!visible.some((r) => r.id === requestId)) {
    throw new AppError(404, "Asset request not found")
  }

  const rows = await prisma.auditLog.findMany({
    where: { entity: "ASSET_REQUEST", entityId: requestId },
    orderBy: { changedAt: "asc" },
    select: { action: true, changedAt: true, changedBy: true, note: true },
  })

  return rows.map((r) => ({
    action: r.action,
    at: r.changedAt,
    byUserId: r.changedBy,
    note: r.note,
  }))
}
