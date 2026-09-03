/**
 * National ID changes an employee asks for and HR decides.
 *
 * The AssetRequest shape, not EmailChangeRequest's: a human makes the call
 * here, so this needs PENDING/APPROVED/REJECTED/CANCELLED and a decider,
 * not a pair of mailed tokens with nobody in the loop.
 *
 * nationalId itself stays in HR_ONLY_EDITABLE_FIELDS — see the doc comment
 * on SELF_EDITABLE_FIELDS in employee.access.ts. HR's direct-edit path is
 * untouched; this is a second, additive path for the employee.
 *
 * Known gap, not fixed here: if HR edits nationalId directly while a
 * request from that employee is still PENDING, the request is not
 * auto-resolved. It sits pending until an HR person separately decides it.
 * Low-probability — two people touching the same field around the same
 * time — and not worth the extra machinery today.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { sendNationalIdChangeDecidedEmail } from "../notification/notification.mailer"
import { employeeNationalIdChangeRequestedEvent } from "./employee.events"
import type { EmployeeChangeRequest } from "../../generated/prisma/client"

const HR_ROLES = ["HR_ADMIN", "SUPER_ADMIN"]

function assertIsHr(actor: AccessTokenPayload): void {
  if (!HR_ROLES.includes(actor.role)) {
    throw new AppError(403, "Only HR may decide a national ID change")
  }
}

export async function requestNationalIdChange(
  actor: AccessTokenPayload,
  newValue: string
): Promise<EmployeeChangeRequest> {
  const trimmed = newValue.trim()
  if (!trimmed) throw new AppError(400, "A national ID is required")
  if (trimmed.length > 50) throw new AppError(400, "National ID must be 50 characters or fewer")

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { userId: actor.sub } })
    if (!employee) throw new AppError(403, "You do not have an employee profile")

    // A second submission replaces the first rather than queueing.
    await tx.employeeChangeRequest.updateMany({
      where: { employeeId: employee.id, field: "NATIONAL_ID", status: "PENDING" },
      data: { status: "CANCELLED", decidedAt: new Date() },
    })

    const request = await tx.employeeChangeRequest.create({
      data: {
        employeeId: employee.id,
        field: "NATIONAL_ID",
        oldValue: employee.nationalId,
        newValue: trimmed,
        status: "PENDING",
      },
    })

    await writeAudit(tx, {
      entity: "EMPLOYEE_PROFILE",
      entityId: employee.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { newValue: trimmed },
    })

    await emitEvent(
      tx,
      employeeNationalIdChangeRequestedEvent({
        employeeId: employee.id,
        fullName: employee.fullName,
        requestId: request.id,
        actorUserId: actor.sub,
      })
    )

    return request
  })
}

export async function cancelNationalIdChangeRequest(
  actor: AccessTokenPayload,
  requestId: string
): Promise<EmployeeChangeRequest> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.employeeChangeRequest.findUnique({ where: { id: requestId } })
    if (!request) throw new AppError(404, "Request not found")

    const self = await tx.employee.findUnique({ where: { userId: actor.sub } })
    if (!self || self.id !== request.employeeId) {
      throw new AppError(403, "You can only cancel your own request")
    }
    if (request.status !== "PENDING") {
      throw new AppError(409, "Only a pending request can be cancelled")
    }

    const updated = await tx.employeeChangeRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED", decidedBy: actor.sub, decidedAt: new Date() },
    })

    await writeAudit(tx, {
      entity: "EMPLOYEE_PROFILE",
      entityId: request.employeeId,
      action: "CANCEL",
      changedBy: actor.sub,
      after: { status: "CANCELLED" },
    })

    return updated
  })
}

export async function decideNationalIdChangeRequest(
  actor: AccessTokenPayload,
  requestId: string,
  decision: "APPROVE" | "REJECT",
  note?: string
): Promise<EmployeeChangeRequest> {
  assertIsHr(actor)

  const trimmedNote = note?.trim() || null
  if (decision === "REJECT" && !trimmedNote) {
    throw new AppError(400, "A reason is required to reject a national ID change")
  }

  const decided = await prisma.$transaction(async (tx) => {
    const request = await tx.employeeChangeRequest.findUnique({
      where: { id: requestId },
      include: { employee: { include: { user: { select: { email: true } } } } },
    })
    if (!request) throw new AppError(404, "Request not found")
    if (request.status !== "PENDING") {
      throw new AppError(409, "This request has already been decided")
    }

    if (decision === "APPROVE") {
      await tx.employee.update({
        where: { id: request.employeeId },
        data: { nationalId: request.newValue },
      })
    }

    const updated = await tx.employeeChangeRequest.update({
      where: { id: requestId },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedBy: actor.sub,
        decidedAt: new Date(),
        decisionNote: trimmedNote,
      },
    })

    await writeAudit(tx, {
      entity: "EMPLOYEE_PROFILE",
      entityId: request.employeeId,
      action: decision === "APPROVE" ? "APPROVE" : "REJECT",
      changedBy: actor.sub,
      after: { status: updated.status },
      note: trimmedNote,
    })

    return { updated, email: request.employee.user.email }
  })

  await sendNationalIdChangeDecidedEmail({
    to: decided.email,
    requestId,
    approved: decision === "APPROVE",
    reason: trimmedNote,
  })

  return decided.updated
}
