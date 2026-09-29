import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { emitEvent } from "../../event/event.emit"
import { employmentAllowsSales } from "../sales.eligibility"
import { nextOpportunitySerial } from "../sales.serial"
import { INCLUDE, loadForWrite } from "./opportunity.service"
import { presentOpportunity } from "./opportunity.present"
import type { HandOverBody } from "./opportunity.validators"

/** Found by name: the app has no other record of who is on the Software team (seed.ts:156). */
export const SOFTWARE_DEPARTMENT = "Software Development"

const ALREADY = "This Opportunity was already handed to the Software team."

type Client = typeof prisma
const asClient = (tx: Prisma.TransactionClient) => tx as unknown as Client

async function softwareDeptId(client: Client): Promise<string | null> {
  const dept = await client.department.findUnique({ where: { name: SOFTWARE_DEPARTMENT }, select: { id: true } })
  return dept?.id ?? null
}

/** Everyone already on the account: its Owner and its collaborators. */
function accountPeopleIds(account: { ownerEmployeeId: string; assignments: { employeeId: string }[] }): string[] {
  return [account.ownerEmployeeId, ...account.assignments.map((a) => a.employeeId)]
}

type Candidate = {
  employmentStatus: Parameters<typeof employmentAllowsSales>[0]
  lastWorkingDay: Date | null
  user: { salesRole: string | null; isActive: boolean } | null
}
/** A person may own an Opportunity only if they can actually work in the Sales Hub. */
const eligible = (e: Candidate) =>
  !!e.user?.salesRole && e.user.isActive && employmentAllowsSales(e.employmentStatus, e.lastWorkingDay)

const CANDIDATE_SELECT = {
  id: true, fullName: true, departmentId: true, employmentStatus: true, lastWorkingDay: true,
  user: { select: { salesRole: true, isActive: true } },
} as const

/** Who may own the Software Opportunity: Software people already on the account. */
export async function listHandOverOwners(opportunityId: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const current = await loadForWrite(tx, opportunityId, actor)
    const deptId = await softwareDeptId(asClient(tx))
    // HR has no department by that name: the picker is empty and the dialog says so.
    if (!deptId) return []
    const people = await tx.employee.findMany({
      where: { id: { in: accountPeopleIds(current.salesAccount) }, departmentId: deptId },
      select: CANDIDATE_SELECT,
      orderBy: { fullName: "asc" },
    })
    return people.filter(eligible).map((p) => ({ id: p.id, fullName: p.fullName }))
  })
}

/**
 * The Networking team passes the software part to the Software team as a
 * second, linked Opportunity (CONTEXT.md, Hand-over; spec §2.5). Once only,
 * and never undone.
 */
export async function handOverToSoftware(opportunityId: string, body: HandOverBody, actor: AccessTokenPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const source = await loadForWrite(tx, opportunityId, actor)
      if (source.track !== "NETWORKING") {
        throw new AppError(400, "Only a Networking Opportunity can be handed to the Software team.")
      }
      if (source.softwareNeeded !== true) {
        throw new AppError(400, "Set Software needed to Yes before handing this Opportunity to the Software team.")
      }
      const existing = await tx.opportunity.findFirst({ where: { handedOverFromId: opportunityId }, select: { id: true } })
      if (existing) throw new AppError(409, ALREADY)

      const deptId = await softwareDeptId(asClient(tx))
      const owner = await tx.employee.findUnique({ where: { id: body.ownerEmployeeId }, select: CANDIDATE_SELECT })
      if (!owner) throw new AppError(400, "That person is not an employee.")
      const onAccount = accountPeopleIds(source.salesAccount).includes(owner.id)
      if (!deptId || owner.departmentId !== deptId || !onAccount) {
        throw new AppError(400, `${owner.fullName} is not in the Software Development department and on this account. Pick someone from the list.`)
      }
      if (!eligible(owner)) {
        throw new AppError(400, `${owner.fullName} cannot use the Sales Hub right now, so they cannot own an Opportunity.`)
      }

      const serial = await nextOpportunitySerial(tx)
      const now = new Date()
      const name = body.name?.trim() || `${source.name} (Software)`
      const created = await tx.opportunity.create({
        data: {
          serial, salesAccountId: source.salesAccountId, name, track: "SOFTWARE_DEVELOPMENT",
          stage: "REQUIREMENT_RECEIVED", status: "ONGOING", stageChangedAt: now, lastActivityAt: now,
          ownerEmployeeId: owner.id, handedOverFromId: source.id, createdBy: actor.sub,
        },
        include: INCLUDE,
      })
      await writeAudit(tx, {
        entity: "OPPORTUNITY", entityId: created.id, action: "CREATE", changedBy: actor.sub,
        after: { serial, name, track: "SOFTWARE_DEVELOPMENT", handedOverFromId: source.id, ownerEmployeeId: owner.id },
      })
      await writeAudit(tx, {
        entity: "OPPORTUNITY", entityId: source.id, action: "UPDATE", changedBy: actor.sub,
        after: { handedOverTo: created.id }, note: `Handed to the Software team as ${serial}`,
      })
      await emitEvent(tx, {
        type: "sales.opportunity.handed_over", entity: "OPPORTUNITY", entityId: source.id,
        actorUserId: actor.sub, subjectEmployeeId: source.ownerEmployeeId, managerEmployeeId: null,
        title: `${source.serial} handed to the Software team as ${serial}`, meta: `Owner: ${owner.fullName}`,
        href: `/opportunities/${created.id}`,
      })
      await emitEvent(tx, {
        type: "sales.opportunity.created", entity: "OPPORTUNITY", entityId: created.id,
        actorUserId: actor.sub, subjectEmployeeId: owner.id, managerEmployeeId: null,
        title: `${serial} · ${name} created`, meta: `Handed over from ${source.serial}`,
        href: `/opportunities/${created.id}`,
      })
      return presentOpportunity(created)
    })
  } catch (err) {
    // The unique index is the real guard against a second Hand-over: two
    // people pressing the button at once both pass the check above, and only
    // the database can settle it. Its complaint is the same 409, not a 500.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new AppError(409, ALREADY)
    }
    throw err
  }
}
