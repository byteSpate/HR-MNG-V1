import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { emitEvent } from "../../event/event.emit"
import { dealCostLineWhere } from "../../dealMoney/dealMoney.cost"
import { isFinance } from "../../receivables/receivables.access"
import { ZERO } from "../../payroll/payroll.money"
import { accountScopeFor, employeeIdFor, isSalesAdmin, OPPORTUNITY_NOT_VISIBLE } from "../sales.access"
import { nextProjectSerial } from "../sales.serial"
import type { ProjectListRow, ProjectSummary } from "../sales.types"
import { loadProjectRow, PROJECT_INCLUDE, type ProjectRow } from "./project.access"
import { presentProject } from "./project.present"
import type { ListProjectQuery } from "./project.validators"

type Client = typeof prisma
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
    if (opp.project) throw new AppError(409, "This Opportunity already has a Project.")
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
    },
    select: {
      id: true, serial: true, name: true, status: true, dueOn: true,
      salesAccount: { select: { name: true } },
      opportunity: { select: { serial: true } },
      manager: { select: { fullName: true } },
      milestones: { select: { doneAt: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  })
  return rows.map((r) => ({
    id: r.id, serial: r.serial, name: r.name, salesAccountName: r.salesAccount.name,
    opportunitySerial: r.opportunity.serial, managerName: r.manager.fullName, status: r.status,
    dueOn: r.dueOn ? r.dueOn.toISOString().slice(0, 10) : null,
    milestonesDone: r.milestones.filter((m) => m.doneAt !== null).length,
    milestonesTotal: r.milestones.length,
  }))
}
