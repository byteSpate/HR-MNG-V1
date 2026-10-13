import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { ACCOUNT_NOT_VISIBLE, canManageAccount, employeeIdFor, requireAccountVisible } from "../sales.access"
import type { AccountHeatmap, HeatmapColour, HeatmapProductView } from "../sales.types"
import { NOT_ON_HEATMAP, type SetColourBody, type SetScopeBody } from "./heatmap.validators"

/**
 * The Heatmap tab (owner, 2026-10-13). Each product row has a colour a
 * person picks (Green: we can sell here; Red: no chance, with a reason; no
 * pick: Grey) and parts a person ticks as "in our working scope". The list
 * itself lives in the database and is edited in Sales Settings
 * (`heatmap.list.service.ts`). Hidden things are left out here; their
 * answers stay saved and come back if an admin shows them again.
 */

const CANNOT_CHANGE =
  "You can view this Sales Account, but only its owner, collaborators, or a Sales Admin can change its heatmap."
const RED_NO_TICKS = "This product is marked Red. Mark it Green or clear it before you tick its parts."

type Client = Pick<
  typeof prisma,
  "salesAccount" | "heatmapProduct" | "heatmapPart" | "salesAccountHeatmapPick" | "salesAccountHeatmapScope"
>

const colourText = (colour: "GREEN" | "RED" | null, reason: string | null) =>
  colour === "GREEN" ? "Green" : colour === "RED" ? `Red: ${reason ?? ""}`.trim() : "Not picked"

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
  })
  return new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))
}

async function accountFor(client: Pick<typeof prisma, "salesAccount">, accountId: string) {
  const account = await client.salesAccount.findUnique({
    where: { id: accountId },
    select: { ownerEmployeeId: true, assignments: { select: { employeeId: true } } },
  })
  if (!account) throw new AppError(404, ACCOUNT_NOT_VISIBLE)
  return account
}

const VISIBLE_LIST = {
  where: { hidden: false },
  orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
  select: {
    id: true,
    title: true,
    products: {
      where: { hidden: false },
      orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
      select: {
        id: true,
        title: true,
        parts: { where: { hidden: false }, orderBy: [{ position: "asc" as const }, { id: "asc" as const }], select: { id: true, title: true, note: true } },
      },
    },
  },
}

export async function getHeatmap(accountId: string, actor: AccessTokenPayload): Promise<AccountHeatmap> {
  const [, employeeId] = await Promise.all([requireAccountVisible(accountId, actor), employeeIdFor(actor)])
  const account = await accountFor(prisma, accountId)
  const [groups, picks, scopes] = await Promise.all([
    prisma.heatmapGroup.findMany(VISIBLE_LIST),
    prisma.salesAccountHeatmapPick.findMany({ where: { salesAccountId: accountId } }),
    prisma.salesAccountHeatmapScope.findMany({ where: { salesAccountId: accountId }, select: { partId: true } }),
  ])
  const names = await namesFor(picks.map((p) => p.updatedBy))
  const pickBy = new Map(picks.map((p) => [p.productId, p]))
  const ticked = new Set(scopes.map((s) => s.partId))
  const counts: Record<HeatmapColour, number> = { GREEN: 0, RED: 0, GREY: 0 }

  const view = groups.map((g) => ({
    id: g.id,
    title: g.title,
    products: g.products.map((p): HeatmapProductView => {
      const pick = pickBy.get(p.id)
      const colour: HeatmapColour = pick ? pick.colour : "GREY"
      counts[colour] += 1
      const parts = p.parts.map((part) => ({ ...part, inScope: ticked.has(part.id) }))
      return {
        id: p.id,
        title: p.title,
        colour,
        reason: pick?.colour === "RED" ? pick.reason : null,
        pickedByName: pick ? (names.get(pick.updatedBy) ?? null) : null,
        pickedAt: pick ? pick.updatedAt.toISOString() : null,
        parts,
        inScopeCount: parts.filter((x) => x.inScope).length,
      }
    }),
  }))

  return {
    groups: view,
    counts,
    canManage: canManageAccount(actor, employeeId, account.ownerEmployeeId, account.assignments.map((a) => a.employeeId)),
  }
}

/** One write, inside a transaction, after a fresh write gate. */
async function withWriteGate(accountId: string, actor: AccessTokenPayload, write: (tx: Client) => Promise<void>) {
  const employeeId = await employeeIdFor(actor)
  await prisma.$transaction(async (tx) => {
    const account = await accountFor(tx, accountId)
    if (!canManageAccount(actor, employeeId, account.ownerEmployeeId, account.assignments.map((a) => a.employeeId))) {
      throw new AppError(403, CANNOT_CHANGE)
    }
    await write(tx)
  })
}

export async function setProductColour(
  accountId: string,
  productId: string,
  body: SetColourBody,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  await withWriteGate(accountId, actor, async (tx) => {
    const product = await tx.heatmapProduct.findFirst({
      where: { id: productId, hidden: false, group: { hidden: false } },
      select: { id: true, title: true },
    })
    if (!product) throw new AppError(404, NOT_ON_HEATMAP)
    const key = { salesAccountId_productId: { salesAccountId: accountId, productId } }
    const existing = await tx.salesAccountHeatmapPick.findUnique({ where: key })
    const before = existing?.colour ?? null
    const after = body.colour === "NONE" ? null : body.colour
    if (before === after && (existing?.reason ?? null) === body.reason) return

    if (after === null) {
      await tx.salesAccountHeatmapPick.delete({ where: { id: existing!.id } })
    } else {
      await tx.salesAccountHeatmapPick.upsert({
        where: key,
        create: { salesAccountId: accountId, productId, colour: after, reason: body.reason, updatedBy: actor.sub },
        update: { colour: after, reason: body.reason, updatedBy: actor.sub },
      })
    }
    const label = `Heatmap, ${product.title}`
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { [label]: colourText(before, existing?.reason ?? null) },
      after: { [label]: colourText(after, body.reason) },
    })
  })
  return getHeatmap(accountId, actor)
}

export async function setPartScope(
  accountId: string,
  partId: string,
  body: SetScopeBody,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  await withWriteGate(accountId, actor, async (tx) => {
    const part = await tx.heatmapPart.findFirst({
      where: { id: partId, hidden: false, product: { hidden: false, group: { hidden: false } } },
      select: { id: true, title: true, product: { select: { id: true, title: true } } },
    })
    if (!part) throw new AppError(404, NOT_ON_HEATMAP)
    if (body.inScope) {
      const pick = await tx.salesAccountHeatmapPick.findUnique({
        where: { salesAccountId_productId: { salesAccountId: accountId, productId: part.product.id } },
      })
      if (pick?.colour === "RED") throw new AppError(409, RED_NO_TICKS)
    }
    const existing = await tx.salesAccountHeatmapScope.findUnique({
      where: { salesAccountId_partId: { salesAccountId: accountId, partId } },
    })
    if (!!existing === body.inScope) return
    if (body.inScope) {
      // Two people can tick the same part at once. ON CONFLICT DO NOTHING lets
      // the second one find it done, with no error and no second History line.
      const { count } = await tx.salesAccountHeatmapScope.createMany({
        data: [{ salesAccountId: accountId, partId, createdBy: actor.sub }],
        skipDuplicates: true,
      })
      if (count === 0) return
    } else {
      await tx.salesAccountHeatmapScope.delete({ where: { id: existing!.id } })
    }
    const label = `Heatmap, ${part.product.title}: ${part.title}`
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { [label]: body.inScope ? "Not in scope" : "In scope" },
      after: { [label]: body.inScope ? "In scope" : "Not in scope" },
    })
  })
  return getHeatmap(accountId, actor)
}
