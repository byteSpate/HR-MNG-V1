import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { emitEvent } from "../../event/event.emit"
import { dealCostLineWhere } from "../../dealMoney/dealMoney.cost"
import { isFinance } from "../../receivables/receivables.access"
import { dec, ZERO } from "../../payroll/payroll.money"
import { accountScopeFor, employeeIdFor, isSalesAdmin, OPPORTUNITY_NOT_VISIBLE } from "../sales.access"
import { nextProjectSerial } from "../sales.serial"
import type { ProjectListRow, ProjectSummary } from "../sales.types"
import { loadProjectRow, peopleOf, PROJECT_INCLUDE, requireManage, type ProjectRow } from "./project.access"
import { presentProject } from "./project.present"
import type {
  ChangeProjectStatusBody, ListProjectQuery, SetProjectTeamBody, UpdateProjectBody,
} from "./project.validators"

type Client = typeof prisma
const ALREADY_HAS_PROJECT = "This Opportunity already has a Project."
export const asClient = (tx: Prisma.TransactionClient) => tx as unknown as Client

async function namesForUsers(client: Client, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const users = await client.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
  })
  return new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))
}

/** The ProjectSummary for a row, with the spend only for Finance and Super Admin. */
export async function summarise(client: Client, row: ProjectRow, actor: AccessTokenPayload, employeeId: string | null): Promise<ProjectSummary> {
  const canSeeCost = isFinance(actor)
  let spentSoFar: string | null = null
  if (canSeeCost) {
    const agg = await client.journalLine.aggregate({
      where: { ...(await dealCostLineWhere()), opportunityId: row.opportunityId },
      _sum: { debit: true, credit: true },
    })
    spentSoFar = (agg._sum.debit ?? ZERO).minus(agg._sum.credit ?? ZERO).toFixed(2)
  }
  const tickUserIds = row.opportunity.lines.flatMap((l) => l.projectTicks.filter((t) => t.projectId === row.id).map((t) => t.doneBy))
  const tickNames = await namesForUsers(client, tickUserIds)
  return presentProject(row, { actor, employeeId, spentSoFar, canSeeCost, tickNames })
}

/**
 * Starts the Project for a Won Opportunity (spec §1.7, ADR 0005). Never
 * automatic. The Opportunity Owner or a Sales Admin presses Start project.
 */
export async function startProject(opportunityId: string, actor: AccessTokenPayload): Promise<ProjectSummary> {
  try {
    return await startProjectOnce(opportunityId, actor)
  } catch (err) {
    // Two people pressing Start project together: the unique index on
    // Project.opportunityId lets one through. Say what happened, not "500".
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new AppError(409, ALREADY_HAS_PROJECT)
    }
    throw err
  }
}

async function startProjectOnce(opportunityId: string, actor: AccessTokenPayload): Promise<ProjectSummary> {
  return prisma.$transaction(async (tx) => {
    const employeeId = await employeeIdFor(actor, asClient(tx))
    const opp = await tx.opportunity.findFirst({
      where: { AND: [{ id: opportunityId }, { salesAccount: accountScopeFor(actor, employeeId) }] },
      select: { id: true, serial: true, name: true, status: true, salesAccountId: true, ownerEmployeeId: true, project: { select: { id: true } } },
    })
    if (!opp) throw new AppError(404, OPPORTUNITY_NOT_VISIBLE)
    if (!isSalesAdmin(actor) && employeeId !== opp.ownerEmployeeId) {
      throw new AppError(403, "Only the Opportunity Owner or a Sales Admin can start its Project.")
    }
    if (opp.status !== "WON") throw new AppError(409, "Only a Won Opportunity can have a Project.")
    if (opp.project) throw new AppError(409, ALREADY_HAS_PROJECT)
    const serial = await nextProjectSerial(tx)
    const row = await tx.project.create({
      data: {
        serial, name: opp.name, opportunityId: opp.id, salesAccountId: opp.salesAccountId,
        managerEmployeeId: opp.ownerEmployeeId, status: "NOT_STARTED", createdBy: actor.sub,
      },
      include: PROJECT_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "PROJECT", entityId: row.id, action: "CREATE", changedBy: actor.sub,
      after: { serial, opportunityId: opp.id, managerEmployeeId: opp.ownerEmployeeId },
    })
    await emitEvent(tx, {
      type: "sales.project.started", entity: "OPPORTUNITY", entityId: opp.id,
      actorUserId: actor.sub, subjectEmployeeId: opp.ownerEmployeeId, managerEmployeeId: null,
      title: `${serial} started for ${opp.serial}`, meta: opp.name, href: `/projects/${row.id}`,
    })
    return summarise(asClient(tx), row, actor, employeeId)
  })
}

export async function getProject(id: string, actor: AccessTokenPayload): Promise<ProjectSummary> {
  const { row, employeeId } = await loadProjectRow(prisma, id, actor)
  return summarise(prisma, row, actor, employeeId)
}

export async function listProjects(query: ListProjectQuery, actor: AccessTokenPayload): Promise<ProjectListRow[]> {
  const employeeId = await employeeIdFor(actor)
  const rows = await prisma.project.findMany({
    where: {
      salesAccount: accountScopeFor(actor, employeeId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.managerEmployeeId ? { managerEmployeeId: query.managerEmployeeId } : {}),
      ...(query.salesAccountId ? { salesAccountId: query.salesAccountId } : {}),
      // The track lives on the Opportunity; a Project always has exactly one.
      ...(query.track ? { opportunity: { track: query.track } } : {}),
    },
    select: {
      id: true, serial: true, name: true, status: true, dueOn: true,
      salesAccount: { select: { name: true } },
      opportunity: { select: { serial: true, track: true } },
      manager: { select: { fullName: true } },
      milestones: { select: { doneAt: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  })
  return rows.map((r) => ({
    id: r.id, serial: r.serial, name: r.name, salesAccountName: r.salesAccount.name,
    opportunitySerial: r.opportunity.serial, track: r.opportunity.track, managerName: r.manager.fullName, status: r.status,
    dueOn: r.dueOn ? r.dueOn.toISOString().slice(0, 10) : null,
    milestonesDone: r.milestones.filter((m) => m.doneAt !== null).length,
    milestonesTotal: r.milestones.length,
  }))
}

const toDay = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null)

const REASON_NEEDED: Partial<Record<string, string>> = {
  BLOCKED: "Say why the Project is blocked.",
  ON_HOLD: "Say why the Project is on hold.",
  CANCELLED: "Say why the Project is cancelled.",
}

async function namesOf(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
  return new Map(rows.map((r) => [r.id, r.fullName]))
}

/** Loads for a write, checks the manager rule, and hands back what the write needs. */
async function forWrite(tx: Prisma.TransactionClient, id: string, actor: AccessTokenPayload) {
  const { row, employeeId } = await loadProjectRow(asClient(tx), id, actor)
  requireManage(actor, employeeId, row.managerEmployeeId)
  return { row, employeeId, people: peopleOf(row.salesAccount) }
}

export async function rereadProject(tx: Prisma.TransactionClient, id: string, actor: AccessTokenPayload): Promise<ProjectSummary> {
  const { row, employeeId } = await loadProjectRow(asClient(tx), id, actor)
  return summarise(asClient(tx), row, actor, employeeId)
}

/**
 * Details only. Every field is optional, so a field nobody touched is never
 * written and never audited (spec §1.7): sending a whole form as a patch
 * would put the Project's history full of no-op changes.
 */
export async function updateProject(id: string, body: UpdateProjectBody, actor: AccessTokenPayload): Promise<ProjectSummary> {
  return prisma.$transaction(async (tx) => {
    const { row, people } = await forWrite(tx, id, actor)
    if (body.managerEmployeeId && !people.has(body.managerEmployeeId)) {
      throw new AppError(400, `The Project Manager must be the Owner or a collaborator on ${row.salesAccount.name}.`)
    }
    const data: Record<string, unknown> = {}
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const set = (field: string, next: unknown, prev: unknown) => {
      if (next !== undefined && String(next) !== String(prev)) {
        data[field] = next
        before[field] = prev
        after[field] = next
      }
    }
    set("name", body.name, row.name)
    set("managerEmployeeId", body.managerEmployeeId, row.managerEmployeeId)
    if (body.startOn !== undefined) set("startOn", toDay(body.startOn), row.startOn)
    if (body.dueOn !== undefined) set("dueOn", toDay(body.dueOn), row.dueOn)
    set("priority", body.priority, row.priority)
    if (body.budget !== undefined) set("budget", body.budget === null ? null : dec(body.budget), row.budget)
    const start = ("startOn" in data ? data.startOn : row.startOn) as Date | null
    const due = ("dueOn" in data ? data.dueOn : row.dueOn) as Date | null
    if (start && due && due.getTime() < start.getTime()) {
      throw new AppError(400, "The finish date cannot be before the start date.")
    }
    if (Object.keys(data).length > 0) {
      await tx.project.update({ where: { id }, data: data as Prisma.ProjectUncheckedUpdateInput })
      await writeAudit(tx, {
        entity: "PROJECT", entityId: id, action: "UPDATE", changedBy: actor.sub,
        before: before as Prisma.InputJsonObject, after: after as Prisma.InputJsonObject,
      })
    }
    return rereadProject(tx, id, actor)
  })
}

/**
 * The Project Team, replaced wholesale rather than added to: a person taken
 * off the team must actually come off it, and a diff would need every
 * intermediate state to be a legal one.
 */
export async function setProjectTeam(id: string, body: SetProjectTeamBody, actor: AccessTokenPayload): Promise<ProjectSummary> {
  return prisma.$transaction(async (tx) => {
    const { row, people } = await forWrite(tx, id, actor)
    const outsiders = body.members.map((m) => m.employeeId).filter((e) => !people.has(e))
    if (outsiders.length > 0) {
      const names = await namesOf(tx, outsiders)
      const who = outsiders.map((e) => names.get(e) ?? "Someone").join(", ")
      throw new AppError(400, `${who} is not the Owner or a collaborator on ${row.salesAccount.name}. A Sales Admin can add them to the account first.`)
    }
    await tx.projectTeamMember.deleteMany({ where: { projectId: id } })
    if (body.members.length > 0) {
      await tx.projectTeamMember.createMany({
        data: body.members.map((m) => ({ projectId: id, employeeId: m.employeeId, responsibility: m.responsibility?.trim() || null })),
      })
    }
    await writeAudit(tx, {
      entity: "PROJECT", entityId: id, action: "UPDATE", changedBy: actor.sub,
      before: { team: row.team.map((m) => m.employeeId) }, after: { team: body.members.map((m) => m.employeeId) },
      note: "Project Team changed",
    })
    return rereadProject(tx, id, actor)
  })
}

export async function changeProjectStatus(id: string, body: ChangeProjectStatusBody, actor: AccessTokenPayload): Promise<ProjectSummary> {
  return prisma.$transaction(async (tx) => {
    const { row } = await forWrite(tx, id, actor)
    const reason = body.reason?.trim() || null
    const needs = REASON_NEEDED[body.status]
    if (needs && !reason) throw new AppError(400, needs)
    const nextReason = needs ? reason : null
    if (row.status !== body.status || (row.statusReason ?? null) !== nextReason) {
      await tx.project.update({
        where: { id },
        data: {
          status: body.status,
          statusReason: nextReason,
          completedAt: body.status === "COMPLETED" ? (row.completedAt ?? new Date()) : null,
        },
      })
      await writeAudit(tx, {
        entity: "PROJECT", entityId: id, action: "UPDATE", changedBy: actor.sub,
        before: { status: row.status }, after: { status: body.status }, note: reason,
      })
    }
    return rereadProject(tx, id, actor)
  })
}
