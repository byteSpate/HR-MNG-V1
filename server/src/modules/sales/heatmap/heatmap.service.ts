import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { ACCOUNT_NOT_VISIBLE, canManageAccount, employeeIdFor, requireAccountVisible } from "../sales.access"
import type { AccountHeatmap, HeatmapColour, HeatmapProductView } from "../sales.types"
import { markText, productColour, productText, type PartMark } from "./heatmap.colour"
import { NOT_ON_HEATMAP, type SetMarkBody, type SetNoteBody } from "./heatmap.validators"

/**
 * The Heatmap tab (owner, 2026-10-18). Each part of a product has a tick (we
 * can offer it), a cross (they have it, or we cannot go) or nothing. The
 * product colour is worked out from its parts (`heatmap.colour.ts`) and is
 * never stored. A Red product can carry one optional short note. The list
 * itself lives in the database and is edited in Sales Settings
 * (`heatmap.list.service.ts`). Hidden things are left out here; their marks
 * stay saved and come back if an admin shows them again.
 */

const CANNOT_CHANGE =
  "You can view this Sales Account, but only its owner, collaborators, or a Sales Admin can change its heatmap."
const NO_PARTS = "This product has no parts yet. Ask a Sales Admin to add one in Sales Settings."
const NOTE_ONLY_RED = "Only a Red product can have a note. Put a cross on every part first."

type Client = Pick<
  typeof prisma,
  "salesAccount" | "heatmapProduct" | "heatmapPart" | "salesAccountHeatmapMark" | "salesAccountHeatmapNote"
>

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

const ORDER = [{ position: "asc" as const }, { id: "asc" as const }]

const VISIBLE_LIST = {
  where: { hidden: false },
  orderBy: ORDER,
  select: {
    id: true,
    title: true,
    products: {
      where: { hidden: false },
      orderBy: ORDER,
      select: {
        id: true,
        title: true,
        parts: { where: { hidden: false }, orderBy: ORDER, select: { id: true, title: true, note: true } },
      },
    },
  },
}

export async function getHeatmap(accountId: string, actor: AccessTokenPayload): Promise<AccountHeatmap> {
  const [, employeeId] = await Promise.all([requireAccountVisible(accountId, actor), employeeIdFor(actor)])
  const account = await accountFor(prisma, accountId)
  const [groups, marks, notes] = await Promise.all([
    prisma.heatmapGroup.findMany(VISIBLE_LIST),
    prisma.salesAccountHeatmapMark.findMany({
      where: { salesAccountId: accountId },
      select: { partId: true, state: true, updatedBy: true, updatedAt: true },
    }),
    prisma.salesAccountHeatmapNote.findMany({
      where: { salesAccountId: accountId },
      select: { productId: true, note: true },
    }),
  ])
  const markBy = new Map(marks.map((m) => [m.partId, m]))
  const noteBy = new Map(notes.map((n) => [n.productId, n.note]))

  // Marks on hidden parts stay saved but are not looked up here, so they never
  // count towards a colour.
  const built = groups.map((g) => ({
    id: g.id,
    title: g.title,
    products: g.products.map((p) => {
      const parts = p.parts.map((part) => ({
        id: part.id,
        title: part.title,
        note: part.note,
        mark: (markBy.get(part.id)?.state ?? null) as PartMark,
      }))
      const own = p.parts.flatMap((part) => markBy.get(part.id) ?? [])
      const latest = own.reduce<(typeof own)[number] | null>((a, m) => (!a || m.updatedAt > a.updatedAt ? m : a), null)
      return { id: p.id, title: p.title, parts, colour: productColour(parts.map((x) => x.mark)), latest }
    }),
  }))
  const names = await namesFor(
    built.flatMap((g) => g.products).flatMap((p) => (p.latest && p.colour !== "GREY" ? [p.latest.updatedBy] : [])),
  )
  const counts: Record<HeatmapColour, number> = { GREEN: 0, RED: 0, GREY: 0 }

  const view = built.map((g) => ({
    id: g.id,
    title: g.title,
    products: g.products.map((p): HeatmapProductView => {
      counts[p.colour] += 1
      const marked = p.latest && p.colour !== "GREY" ? p.latest : null
      return {
        id: p.id,
        title: p.title,
        colour: p.colour,
        note: p.colour === "RED" ? (noteBy.get(p.id) ?? null) : null,
        markedByName: marked ? (names.get(marked.updatedBy) ?? null) : null,
        markedAt: marked ? marked.updatedAt.toISOString() : null,
        parts: p.parts,
        tickedCount: p.parts.filter((x) => x.mark === "GREEN").length,
        checkedCount: p.parts.filter((x) => x.mark !== null).length,
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

/** A product the tab shows, with the parts it shows. Null when hidden, deleted or never there. */
function visibleProduct(tx: Client, productId: string) {
  return tx.heatmapProduct.findFirst({
    where: { id: productId, hidden: false, group: { hidden: false } },
    select: { id: true, title: true, parts: { where: { hidden: false }, orderBy: ORDER, select: { id: true } } },
  })
}

/** This account's mark on each of these parts. A part with no entry is not checked. */
async function marksOf(tx: Client, accountId: string, partIds: string[]): Promise<Map<string, "GREEN" | "RED">> {
  const rows = await tx.salesAccountHeatmapMark.findMany({
    where: { salesAccountId: accountId, partId: { in: partIds } },
    select: { partId: true, state: true },
  })
  return new Map(rows.map((r) => [r.partId, r.state]))
}

async function setMark(tx: Client, accountId: string, partId: string, mark: "GREEN" | "RED", by: string) {
  await tx.salesAccountHeatmapMark.upsert({
    where: { salesAccountId_partId: { salesAccountId: accountId, partId } },
    create: { salesAccountId: accountId, partId, state: mark, updatedBy: by },
    update: { state: mark, updatedBy: by },
  })
}

/** A note belongs to a Red product. When it stops being Red, the note goes. */
async function dropNoteUnlessRed(tx: Client, accountId: string, productId: string, marks: PartMark[]) {
  if (productColour(marks) !== "RED") {
    await tx.salesAccountHeatmapNote.deleteMany({ where: { salesAccountId: accountId, productId } })
  }
}

/** One tick or cross, or clearing it. */
export async function setPartMark(
  accountId: string,
  partId: string,
  body: SetMarkBody,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  await withWriteGate(accountId, actor, async (tx) => {
    const part = await tx.heatmapPart.findFirst({
      where: { id: partId, hidden: false, product: { hidden: false, group: { hidden: false } } },
      select: {
        id: true,
        title: true,
        product: { select: { id: true, title: true, parts: { where: { hidden: false }, select: { id: true } } } },
      },
    })
    if (!part) throw new AppError(404, NOT_ON_HEATMAP)
    const partIds = part.product.parts.map((p) => p.id)
    const before = await marksOf(tx, accountId, partIds)
    const was: PartMark = before.get(partId) ?? null
    const now: PartMark = body.mark === "NONE" ? null : body.mark
    if (was === now) return

    if (now === null) {
      await tx.salesAccountHeatmapMark.deleteMany({ where: { salesAccountId: accountId, partId } })
    } else {
      await setMark(tx, accountId, partId, now, actor.sub)
    }
    const after = new Map(before)
    if (now === null) after.delete(partId)
    else after.set(partId, now)
    await dropNoteUnlessRed(tx, accountId, part.product.id, partIds.map((id) => after.get(id) ?? null))

    const label = `Heatmap, ${part.product.title}: ${part.title}`
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { [label]: markText(was) },
      after: { [label]: markText(now) },
    })
  })
  return getHeatmap(accountId, actor)
}

/** "All ticks", "All crosses", or clear all, on every shown part of a product. */
export async function setProductMarks(
  accountId: string,
  productId: string,
  body: SetMarkBody,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  await withWriteGate(accountId, actor, async (tx) => {
    const product = await visibleProduct(tx, productId)
    if (!product) throw new AppError(404, NOT_ON_HEATMAP)
    if (product.parts.length === 0) throw new AppError(409, NO_PARTS)
    const partIds = product.parts.map((p) => p.id)
    const before = await marksOf(tx, accountId, partIds)
    const beforeList: PartMark[] = partIds.map((id) => before.get(id) ?? null)
    const target: PartMark = body.mark === "NONE" ? null : body.mark
    if (beforeList.every((m) => m === target)) return

    if (target === null) {
      await tx.salesAccountHeatmapMark.deleteMany({ where: { salesAccountId: accountId, partId: { in: partIds } } })
    } else {
      for (const id of partIds) {
        if (before.get(id) !== target) await setMark(tx, accountId, id, target, actor.sub)
      }
    }
    const afterList: PartMark[] = partIds.map(() => target)
    await dropNoteUnlessRed(tx, accountId, product.id, afterList)

    const label = `Heatmap, ${product.title}`
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { [label]: productText(beforeList) },
      after: { [label]: productText(afterList) },
    })
  })
  return getHeatmap(accountId, actor)
}

/** The optional note on a Red product. An empty note removes it. */
export async function setProductNote(
  accountId: string,
  productId: string,
  body: SetNoteBody,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  await withWriteGate(accountId, actor, async (tx) => {
    const product = await visibleProduct(tx, productId)
    if (!product) throw new AppError(404, NOT_ON_HEATMAP)
    const partIds = product.parts.map((p) => p.id)
    const marks = await marksOf(tx, accountId, partIds)
    if (productColour(partIds.map((id) => marks.get(id) ?? null)) !== "RED") throw new AppError(409, NOTE_ONLY_RED)

    const key = { salesAccountId_productId: { salesAccountId: accountId, productId } }
    const existing = await tx.salesAccountHeatmapNote.findUnique({ where: key })
    if ((existing?.note ?? null) === body.note) return

    if (body.note === null) {
      await tx.salesAccountHeatmapNote.delete({ where: { id: existing!.id } })
    } else {
      await tx.salesAccountHeatmapNote.upsert({
        where: key,
        create: { salesAccountId: accountId, productId, note: body.note, updatedBy: actor.sub },
        update: { note: body.note, updatedBy: actor.sub },
      })
    }
    const label = `Heatmap, ${product.title}: note`
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { [label]: existing?.note ?? "No note" },
      after: { [label]: body.note ?? "No note" },
    })
  })
  return getHeatmap(accountId, actor)
}
