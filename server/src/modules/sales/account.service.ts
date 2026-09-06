import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { emitEvent } from "../event/event.emit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateSalesAccountBody } from "./sales.validators"
import type { SalesAccountSummary } from "./sales.types"

export async function createSalesAccount(
  body: CreateSalesAccountBody,
  actor: AccessTokenPayload
): Promise<SalesAccountSummary> {
  return prisma.$transaction(async (tx) => {
    // `name @unique` is exact-match only, so the refusal is here rather than
    // in the database. Naming the existing owner is the difference between a
    // dead end and a phone call.
    const clash = await tx.salesAccount.findFirst({
      where: { name: { equals: body.name, mode: "insensitive" } },
      include: { owner: { select: { fullName: true } } },
    })
    if (clash) {
      throw new AppError(
        409,
        `"${clash.name}" already exists and is owned by ${clash.owner.fullName}. Talk to them before creating a second one.`
      )
    }

    const owner = await tx.employee.findUnique({
      where: { id: body.ownerEmployeeId },
      select: { id: true, fullName: true },
    })
    if (!owner) {
      throw new AppError(400, "That owner is not an employee")
    }

    const account = await tx.salesAccount.create({
      data: {
        name: body.name,
        industry: body.industry ?? null,
        website: body.website ?? null,
        address: body.address ?? null,
        ownerEmployeeId: owner.id,
        createdBy: actor.sub,
      },
    })

    // The owner is already on the account. Storing them again as an
    // assignment is the same fact twice, and the two copies drift.
    const extras = (body.assigneeIds ?? []).filter((id) => id !== owner.id)
    if (extras.length > 0) {
      await tx.salesAccountAssignment.createMany({
        data: extras.map((employeeId) => ({
          salesAccountId: account.id,
          employeeId,
          assignedBy: actor.sub,
        })),
      })
    }

    await writeAudit(tx, {
      entity: "SALES_ACCOUNT",
      entityId: account.id,
      action: "CREATE",
      changedBy: actor.sub,
      after: { name: account.name, ownerEmployeeId: owner.id, status: account.status },
    })

    await emitEvent(tx, {
      type: "sales.account.created",
      entity: "SALES_ACCOUNT",
      entityId: account.id,
      actorUserId: actor.sub,
      subjectEmployeeId: owner.id,
      // Explicit null suppresses the reporting-line lookup. A sales account
      // is not a fact about somebody's manager.
      managerEmployeeId: null,
      title: `${account.name} added to the Sales Hub`,
      meta: `Owner: ${owner.fullName}`,
      href: `/accounts/${account.id}`,
    })

    return {
      id: account.id,
      name: account.name,
      status: account.status,
      ownerEmployeeId: owner.id,
      ownerName: owner.fullName,
      assigneeCount: extras.length,
      createdAt: account.createdAt.toISOString(),
    }
  })
}
