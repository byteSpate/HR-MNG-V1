import type prismaClient from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { accountScopeFor, employeeIdFor, isSalesAdmin } from "../sales.access"

type Client = typeof prismaClient

export const PROJECT_NOT_VISIBLE = "That Project does not exist, or is not yours"

export const PROJECT_INCLUDE = {
  manager: { select: { id: true, fullName: true } },
  salesAccount: { select: { id: true, name: true, ownerEmployeeId: true, assignments: { select: { employeeId: true } } } },
  opportunity: {
    select: {
      id: true, serial: true, name: true, track: true, amount: true,
      lines: {
        orderBy: { order: "asc" as const },
        select: {
          id: true, product: true, oemBrand: true, model: true, quantity: true, lineValue: true, marginPercent: true, order: true,
          supplier: { select: { name: true } },
          projectTicks: { select: { projectId: true, doneAt: true, doneBy: true } },
        },
      },
    },
  },
  team: { include: { employee: { select: { id: true, fullName: true } } }, orderBy: { employee: { fullName: "asc" as const } } },
  milestones: { orderBy: [{ order: "asc" as const }, { dueOn: "asc" as const }] },
} satisfies Prisma.ProjectInclude

export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>

/** The account's Owner and collaborators: the only people a Project may use. */
export function peopleOf(account: { ownerEmployeeId: string; assignments: { employeeId: string }[] }): Set<string> {
  return new Set([account.ownerEmployeeId, ...account.assignments.map((a) => a.employeeId)])
}

export async function accountPeople(client: Client, salesAccountId: string): Promise<Set<string>> {
  const account = await client.salesAccount.findUnique({
    where: { id: salesAccountId },
    select: { ownerEmployeeId: true, assignments: { select: { employeeId: true } } },
  })
  if (!account) throw new AppError(404, PROJECT_NOT_VISIBLE)
  return peopleOf(account)
}

/** A Project the caller may see: the same account scope as its Opportunity. */
export async function loadProjectRow(client: Client, id: string, actor: AccessTokenPayload) {
  const employeeId = await employeeIdFor(actor, client)
  const row = await client.project.findFirst({
    where: { AND: [{ id }, { salesAccount: accountScopeFor(actor, employeeId) }] },
    include: PROJECT_INCLUDE,
  })
  if (!row) throw new AppError(404, PROJECT_NOT_VISIBLE)
  return { row, employeeId }
}

export function canManageProject(actor: AccessTokenPayload, employeeId: string | null, managerEmployeeId: string): boolean {
  return isSalesAdmin(actor) || (employeeId !== null && employeeId === managerEmployeeId)
}

export function requireManage(actor: AccessTokenPayload, employeeId: string | null, managerEmployeeId: string): void {
  if (!canManageProject(actor, employeeId, managerEmployeeId)) {
    throw new AppError(403, "Only the Project Manager or a Sales Admin can change this Project.")
  }
}
