import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import type { HeatmapList, HeatmapListLevel } from "../sales.types"
import { NOT_ON_HEATMAP, type ListEditBody, type ListRowBody } from "./heatmap.validators"

/**
 * The Heatmap list in Sales Settings (owner, 2026-10-13). Sales Admins add,
 * rename, move, hide and delete groups, products and parts. Something any
 * account has answered is hidden, never deleted, so no answer is lost; the
 * database backs this with `onDelete: Restrict`. Account History keeps the
 * names as they were, because it stores text, not ids.
 */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
type Db = typeof prisma | Tx

const WORD = { groups: "group", products: "product", parts: "part" } as const
const PARENT_FIELD = { groups: null, products: "groupId", parts: "productId" } as const
const usesText = (n: number) => (n === 1 ? "1 account uses" : `${n} accounts use`)
/** The part every new product starts with. The migration gave the same name to products that had none. */
const WHOLE_PRODUCT = "Whole product"

/** One shape for the three Prisma delegates, so each action is written once. */
type Delegate = {
  findMany: (a: object) => Promise<{ id: string; title: string }[]>
  findUnique: (a: object) => Promise<Record<string, unknown> | null>
  findFirst: (a: object) => Promise<{ id: string; position: number } | null>
  aggregate: (a: object) => Promise<{ _max: { position: number | null } }>
  create: (a: object) => Promise<{ id: string }>
  update: (a: object) => Promise<unknown>
  delete: (a: object) => Promise<unknown>
}
const delegate = (db: Db, level: HeatmapListLevel) =>
  (level === "groups" ? db.heatmapGroup : level === "products" ? db.heatmapProduct : db.heatmapPart) as unknown as Delegate

const siblingsOf = (level: HeatmapListLevel, parentId: string | null) =>
  PARENT_FIELD[level] ? { [PARENT_FIELD[level]!]: parentId } : {}

async function buildList(db: Db): Promise<HeatmapList> {
  const [groups, marks] = await Promise.all([
    db.heatmapGroup.findMany({
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: {
        id: true, title: true, hidden: true,
        products: {
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: {
            id: true, title: true, hidden: true,
            parts: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, title: true, note: true, hidden: true } },
          },
        },
      },
    }),
    db.salesAccountHeatmapMark.findMany({ select: { salesAccountId: true, partId: true } }),
  ])
  // A product is used when any of its parts has a tick or a cross. Its note
  // only ever sits on a product whose parts are all crossed.
  const byPart = new Map<string, Set<string>>()
  for (const m of marks) byPart.set(m.partId, (byPart.get(m.partId) ?? new Set()).add(m.salesAccountId))

  return {
    groups: groups.map((g) => {
      const groupAccounts = new Set<string>()
      const products = g.products.map((pr) => {
        const productAccounts = new Set<string>()
        const parts = pr.parts.map((pa) => {
          const used = byPart.get(pa.id) ?? new Set<string>()
          used.forEach((a) => productAccounts.add(a))
          return { ...pa, usedBy: used.size }
        })
        productAccounts.forEach((a) => groupAccounts.add(a))
        return { id: pr.id, title: pr.title, hidden: pr.hidden, usedBy: productAccounts.size, parts }
      })
      return { id: g.id, title: g.title, hidden: g.hidden, usedBy: groupAccounts.size, products }
    }),
  }
}

export function getHeatmapList(): Promise<HeatmapList> {
  return buildList(prisma)
}

/** The row with its parent id, or the reload sentence. */
async function rowOf(tx: Tx, level: HeatmapListLevel, id: string) {
  const row = (await delegate(tx, level).findUnique({ where: { id } })) as
    | { id: string; title: string; hidden: boolean; position: number; note?: string | null; groupId?: string; productId?: string }
    | null
  if (!row) throw new AppError(404, NOT_ON_HEATMAP)
  const parentId = level === "products" ? row.groupId! : level === "parts" ? row.productId! : null
  return { ...row, parentId }
}

/** The parent's title, for messages and the audit log. Null for a group. */
async function parentTitle(tx: Tx, level: HeatmapListLevel, parentId: string | null): Promise<string | null> {
  if (level === "groups") return null
  const parent = await delegate(tx, level === "products" ? "groups" : "products").findUnique({
    where: { id: parentId! },
    select: { id: true, title: true },
  })
  if (!parent) throw new AppError(404, NOT_ON_HEATMAP)
  return parent.title as string
}

async function refuseSameName(tx: Tx, level: HeatmapListLevel, parentId: string | null, title: string, selfId: string | null, inTitle: string | null) {
  const siblings = await delegate(tx, level).findMany({ where: siblingsOf(level, parentId), select: { id: true, title: true } })
  const clash = siblings.find((s) => s.id !== selfId && s.title.trim().toLowerCase() === title.trim().toLowerCase())
  if (!clash) return
  throw new AppError(
    409,
    inTitle
      ? `${inTitle} already has a ${WORD[level]} called ${clash.title.trim()}. Use a different name.`
      : `There is already a group called ${clash.title.trim()}. Use a different name.`,
  )
}

const audit = (
  tx: Tx, id: string, action: "CREATE" | "UPDATE" | "DELETE", actor: AccessTokenPayload,
  before?: Record<string, unknown>, after?: Record<string, unknown>,
) => writeAudit(tx as never, { entity: "HEATMAP_LIST", entityId: id, action, changedBy: actor.sub,
    before: before as Prisma.InputJsonObject | undefined, after: after as Prisma.InputJsonObject | undefined })

export async function addListRow(level: HeatmapListLevel, parentId: string | null, body: ListRowBody, actor: AccessTokenPayload): Promise<HeatmapList> {
  await prisma.$transaction(async (tx) => {
    const inTitle = await parentTitle(tx, level, parentId)
    await refuseSameName(tx, level, parentId, body.title, null, inTitle)
    const d = delegate(tx, level)
    const max = await d.aggregate({ where: siblingsOf(level, parentId), _max: { position: true } })
    const data: Record<string, unknown> = { ...siblingsOf(level, parentId), title: body.title }
    if (level === "parts") data.note = body.note
    data.position = (max._max.position ?? 0) + 1
    const created = await d.create({ data, select: { id: true } })
    await audit(tx, created.id, "CREATE", actor, undefined, { [WORD[level]]: body.title, ...(inTitle ? { in: inTitle } : {}) })
    // A product with no parts cannot be ticked or crossed, so it starts with
    // one. An admin can rename it, or delete it once real parts are added.
    if (level === "products") {
      await tx.heatmapPart.create({ data: { productId: created.id, title: WHOLE_PRODUCT, position: 1 } })
    }
  })
  return getHeatmapList()
}

export async function editListRow(level: HeatmapListLevel, id: string, body: ListEditBody, actor: AccessTokenPayload): Promise<HeatmapList> {
  await prisma.$transaction(async (tx) => {
    const row = await rowOf(tx, level, id)
    if (body.title !== undefined) {
      await refuseSameName(tx, level, row.parentId, body.title, id, await parentTitle(tx, level, row.parentId))
    }
    const data: Record<string, unknown> = {}
    if (body.title !== undefined && body.title !== row.title) data.title = body.title
    if (body.hidden !== undefined && body.hidden !== row.hidden) data.hidden = body.hidden
    if (body.note !== undefined && level === "parts" && body.note !== (row.note ?? null)) data.note = body.note
    if (Object.keys(data).length === 0) return
    await delegate(tx, level).update({ where: { id }, data })
    const before: Record<string, unknown> = { [WORD[level]]: row.title }
    const after: Record<string, unknown> = { [WORD[level]]: (data.title as string | undefined) ?? row.title }
    for (const k of ["hidden", "note"] as const) {
      if (k in data) {
        before[k] = row[k] ?? null
        after[k] = data[k]
      }
    }
    await audit(tx, id, "UPDATE", actor, before, after)
  })
  return getHeatmapList()
}

export async function moveListRow(level: HeatmapListLevel, id: string, direction: "UP" | "DOWN", actor: AccessTokenPayload): Promise<HeatmapList> {
  await prisma.$transaction(async (tx) => {
    const row = await rowOf(tx, level, id)
    const d = delegate(tx, level)
    const neighbour = await d.findFirst({
      where: { ...siblingsOf(level, row.parentId), position: direction === "UP" ? { lt: row.position } : { gt: row.position } },
      orderBy: { position: direction === "UP" ? "desc" : "asc" },
      select: { id: true, position: true },
    })
    if (!neighbour) return
    await d.update({ where: { id }, data: { position: neighbour.position } })
    await d.update({ where: { id: neighbour.id }, data: { position: row.position } })
    await audit(tx, id, "UPDATE", actor, { [WORD[level]]: row.title, position: row.position }, { [WORD[level]]: row.title, position: neighbour.position })
  })
  return getHeatmapList()
}

export async function deleteListRow(level: HeatmapListLevel, id: string, actor: AccessTokenPayload): Promise<HeatmapList> {
  await prisma.$transaction(async (tx) => {
    const row = await rowOf(tx, level, id)
    const list = await buildList(tx)
    const products = list.groups.flatMap((g) => g.products)
    const used =
      level === "groups"
        ? list.groups.find((g) => g.id === id)?.usedBy
        : level === "products"
          ? products.find((p) => p.id === id)?.usedBy
          : products.flatMap((p) => p.parts).find((p) => p.id === id)?.usedBy
    if (used) throw new AppError(409, `${usesText(used)} ${row.title}. Hide it instead.`)
    await delegate(tx, level).delete({ where: { id } })
    await audit(tx, id, "DELETE", actor, { [WORD[level]]: row.title })
  })
  return getHeatmapList()
}
