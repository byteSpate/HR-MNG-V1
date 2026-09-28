import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { canManageProject, loadProjectRow, requireManage } from "./project.access"
import { asClient, rereadProject } from "./project.service"
import type { AddMilestoneBody, UpdateMilestoneBody } from "./project.validators"

const toDay = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null)
const MILESTONE_NOT_FOUND = "That milestone does not exist, or is not yours"

async function managed(tx: Prisma.TransactionClient, projectId: string, actor: AccessTokenPayload) {
  const { row, employeeId } = await loadProjectRow(asClient(tx), projectId, actor)
  requireManage(actor, employeeId, row.managerEmployeeId)
  return row
}

export async function addMilestone(projectId: string, body: AddMilestoneBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    await managed(tx, projectId, actor)
    // New milestones go on the end, so the order somebody built the list in
    // is the order it is read in.
    const order = await tx.projectMilestone.count({ where: { projectId } })
    const created = await tx.projectMilestone.create({
      data: { projectId, title: body.title, dueOn: toDay(body.dueOn), order },
    })
    await writeAudit(tx, { entity: "PROJECT", entityId: projectId, action: "UPDATE", changedBy: actor.sub, after: { milestone: created.title }, note: "Milestone added" })
    return rereadProject(tx, projectId, actor)
  })
}

export async function updateMilestone(milestoneId: string, body: UpdateMilestoneBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const m = await tx.projectMilestone.findUnique({ where: { id: milestoneId } })
    if (!m) throw new AppError(404, MILESTONE_NOT_FOUND)
    await managed(tx, m.projectId, actor)
    await tx.projectMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.dueOn !== undefined ? { dueOn: toDay(body.dueOn) } : {}),
        // Reaching a milestone is credited to whoever first ticked it, so a
        // later re-tick never moves the credit.
        ...(body.done === true ? { doneAt: m.doneAt ?? new Date(), doneBy: m.doneBy ?? actor.sub } : {}),
        ...(body.done === false ? { doneAt: null, doneBy: null } : {}),
      },
    })
    await writeAudit(tx, {
      entity: "PROJECT", entityId: m.projectId, action: "UPDATE", changedBy: actor.sub,
      before: { milestone: m.title, done: m.doneAt !== null }, after: { ...body } as Prisma.InputJsonObject,
      note: body.done === true ? "Milestone reached" : "Milestone changed",
    })
    return rereadProject(tx, m.projectId, actor)
  })
}

export async function removeMilestone(milestoneId: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const m = await tx.projectMilestone.findUnique({ where: { id: milestoneId } })
    if (!m) throw new AppError(404, MILESTONE_NOT_FOUND)
    await managed(tx, m.projectId, actor)
    await tx.projectMilestone.delete({ where: { id: milestoneId } })
    await writeAudit(tx, { entity: "PROJECT", entityId: m.projectId, action: "UPDATE", changedBy: actor.sub, before: { milestone: m.title }, note: "Milestone removed" })
    return rereadProject(tx, m.projectId, actor)
  })
}

/** The Project Team, the Project Manager or a Sales Admin may tick a line Done (spec §1.7). */
async function tickable(tx: Prisma.TransactionClient, projectId: string, lineId: string, actor: AccessTokenPayload) {
  const { row, employeeId } = await loadProjectRow(asClient(tx), projectId, actor)
  const onTeam = employeeId !== null && row.team.some((m) => m.employeeId === employeeId)
  if (!onTeam && !canManageProject(actor, employeeId, row.managerEmployeeId)) {
    throw new AppError(403, "Only the Project Team, the Project Manager or a Sales Admin can tick a line.")
  }
  const line = await tx.opportunityLine.findFirst({ where: { id: lineId, opportunityId: row.opportunityId }, select: { id: true } })
  if (!line) throw new AppError(400, "That line is not on this Project's Opportunity.")
}

export async function tickLine(projectId: string, lineId: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    await tickable(tx, projectId, lineId, actor)
    await tx.projectLineDone.upsert({
      where: { projectId_opportunityLineId: { projectId, opportunityLineId: lineId } },
      create: { projectId, opportunityLineId: lineId, doneBy: actor.sub },
      update: {},
    })
    await writeAudit(tx, { entity: "PROJECT", entityId: projectId, action: "UPDATE", changedBy: actor.sub, after: { lineId, done: true }, note: "Line marked done" })
    return rereadProject(tx, projectId, actor)
  })
}

export async function untickLine(projectId: string, lineId: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    await tickable(tx, projectId, lineId, actor)
    await tx.projectLineDone.deleteMany({ where: { projectId, opportunityLineId: lineId } })
    await writeAudit(tx, { entity: "PROJECT", entityId: projectId, action: "UPDATE", changedBy: actor.sub, after: { lineId, done: false }, note: "Line marked not done" })
    return rereadProject(tx, projectId, actor)
  })
}
