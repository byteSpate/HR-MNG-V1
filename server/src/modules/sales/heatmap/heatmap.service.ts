import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { formatDateOnly, parseDateOnly } from "../../../utils/dates"
import { officeToday } from "../../attendance/attendance.time"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { ACCOUNT_NOT_VISIBLE, canManageAccount, employeeIdFor, requireAccountVisible } from "../sales.access"
import type { AccountHeatmap, HeatmapCardView, HeatmapColourValue, HeatmapItemView } from "../sales.types"
import { CARD_BY_KEY, checkDetails, HEATMAP_CARDS, HEATMAP_GROUPS, itemText, type HeatmapCardSpec } from "./heatmap.cards"
import { cardColour, colourDateOf, type HeatmapNeed } from "./heatmap.colour"
import { NO_SUCH_ITEM, type HeatmapItemBody, type SetNeedBody } from "./heatmap.validators"

const CANNOT_CHANGE =
  "You can view this Sales Account, but only its owner, collaborators, or a Sales Admin can change its heatmap."
const NO_SUCH_CARD = "That card is not on the heatmap. Reload the page and try again."

type Client = Pick<typeof prisma, "salesAccount" | "salesAccountHeatmapNeed" | "salesAccountHeatmapItem">

type ItemRow = {
  id: string
  card: string
  brand: string
  model: string | null
  quantity: number
  site: string | null
  boughtFrom: string | null
  boughtOn: Date | null
  supportEndsOn: Date | null
  endOfLifeOn: Date | null
  supportBy: string | null
  notes: string | null
  details: unknown
  updatedBy: string
  updatedAt: Date
}

const day = (d: Date | null) => (d ? formatDateOnly(d) : null)
const toDate = (s: string | null) => (s ? parseDateOnly(s) : null)
const detailsOf = (raw: unknown): Record<string, string> =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string>) : {}

/** The History label: "Heatmap, Switch: item". */
const label = (card: HeatmapCardSpec, what: "need" | "item") => `Heatmap, ${card.title}: ${what}`

const needText = (need: HeatmapNeed | null, reason: string | null) =>
  need === "NEED" ? "Need it" : need === "NO_NEED" ? `No need: ${reason ?? ""}`.trim() : "Not asked yet"

const rowText = (card: HeatmapCardSpec, row: ItemRow) =>
  itemText(card, { brand: row.brand, model: row.model, quantity: row.quantity, supportEndsOn: day(row.supportEndsOn) })

function cardFor(key: string): HeatmapCardSpec {
  const card = CARD_BY_KEY.get(key)
  if (!card) throw new AppError(404, NO_SUCH_CARD)
  return card
}

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

function itemView(row: ItemRow, names: Map<string, string>): HeatmapItemView {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    quantity: row.quantity,
    site: row.site,
    boughtFrom: row.boughtFrom,
    boughtOn: day(row.boughtOn),
    supportEndsOn: day(row.supportEndsOn),
    endOfLifeOn: day(row.endOfLifeOn),
    supportBy: row.supportBy,
    notes: row.notes,
    details: detailsOf(row.details),
    recordedByName: names.get(row.updatedBy) ?? null,
    recordedAt: row.updatedAt.toISOString(),
  }
}

/**
 * The Heatmap tab: every card with its need, its items and its colour, and
 * how many cards have each colour. Anyone who may see the account may read
 * it. Rows for a card no longer on the list are left out, not shown as
 * something nobody can name.
 */
export async function getHeatmap(accountId: string, actor: AccessTokenPayload): Promise<AccountHeatmap> {
  const [, employeeId] = await Promise.all([requireAccountVisible(accountId, actor), employeeIdFor(actor)])
  const account = await accountFor(prisma, accountId)
  const [needs, items] = await Promise.all([
    prisma.salesAccountHeatmapNeed.findMany({ where: { salesAccountId: accountId } }),
    prisma.salesAccountHeatmapItem.findMany({
      where: { salesAccountId: accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }) as Promise<ItemRow[]>,
  ])
  const names = await namesFor([...needs.map((n) => n.updatedBy), ...items.map((i) => i.updatedBy)])
  const today = formatDateOnly(officeToday())
  const needByCard = new Map(needs.map((n) => [n.card, n]))
  const counts: Record<HeatmapColourValue, number> = { GREEN: 0, YELLOW: 0, RED: 0, GREY: 0 }

  const cards = HEATMAP_CARDS.map((card): HeatmapCardView => {
    const need = needByCard.get(card.key)
    const rows = items.filter((i) => i.card === card.key)
    const shown = rows.map((r) => itemView(r, names))
    const result = cardColour(
      {
        need: (need?.need as HeatmapNeed | undefined) ?? null,
        needReason: need?.reason ?? null,
        dates: shown.map((i) => colourDateOf(card, i)),
      },
      today,
    )
    counts[result.colour] += 1
    return {
      key: card.key,
      group: card.group,
      title: card.title,
      quantityLabel: card.quantityLabel,
      endsLabel: card.endsLabel,
      extras: card.extras.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options ? [...f.options] : null })),
      need: (need?.need as HeatmapNeed | undefined) ?? "NOT_ASKED",
      needReason: need?.reason ?? null,
      needByName: need ? (names.get(need.updatedBy) ?? null) : null,
      needAt: need ? need.updatedAt.toISOString() : null,
      ...result,
      items: shown,
    }
  })

  return {
    groups: HEATMAP_GROUPS.map((g) => ({ key: g.key, title: g.title })),
    cards,
    counts,
    canManage: canManageAccount(actor, employeeId, account.ownerEmployeeId, account.assignments.map((a) => a.employeeId)),
  }
}

/**
 * Runs one heatmap write in a transaction, after the write gate. The gate is
 * read fresh inside the transaction, so a stale page cannot get past it.
 */
async function withWriteGate(
  accountId: string,
  actor: AccessTokenPayload,
  write: (tx: Client) => Promise<void>,
): Promise<void> {
  const employeeId = await employeeIdFor(actor)
  await prisma.$transaction(async (tx) => {
    const account = await accountFor(tx, accountId)
    if (!canManageAccount(actor, employeeId, account.ownerEmployeeId, account.assignments.map((a) => a.employeeId))) {
      throw new AppError(403, CANNOT_CHANGE)
    }
    await write(tx)
  })
}

/** Sets "Do they need it?" on one card. A change that is no change writes nothing. */
export async function setCardNeed(
  accountId: string,
  cardKey: string,
  body: SetNeedBody,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  const card = cardFor(cardKey)
  await withWriteGate(accountId, actor, async (tx) => {
    const existing = await tx.salesAccountHeatmapNeed.findUnique({
      where: { salesAccountId_card: { salesAccountId: accountId, card: card.key } },
    })
    const beforeNeed = (existing?.need as HeatmapNeed | undefined) ?? null
    const afterNeed = body.need === "NOT_ASKED" ? null : body.need
    if (beforeNeed === afterNeed && (existing?.reason ?? null) === body.reason) return

    if (afterNeed === null) {
      await tx.salesAccountHeatmapNeed.delete({ where: { id: existing!.id } })
    } else {
      await tx.salesAccountHeatmapNeed.upsert({
        where: { salesAccountId_card: { salesAccountId: accountId, card: card.key } },
        create: { salesAccountId: accountId, card: card.key, need: afterNeed, reason: body.reason, updatedBy: actor.sub },
        update: { need: afterNeed, reason: body.reason, updatedBy: actor.sub },
      })
    }
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { [label(card, "need")]: needText(beforeNeed, existing?.reason ?? null) },
      after: { [label(card, "need")]: needText(afterNeed, body.reason) },
    })
  })
  return getHeatmap(accountId, actor)
}

function itemData(card: HeatmapCardSpec, body: HeatmapItemBody) {
  return {
    brand: body.brand,
    model: body.model,
    quantity: body.quantity,
    site: body.site,
    boughtFrom: body.boughtFrom,
    boughtOn: toDate(body.boughtOn),
    supportEndsOn: toDate(body.supportEndsOn),
    endOfLifeOn: toDate(body.endOfLifeOn),
    supportBy: body.supportBy,
    notes: body.notes,
    details: checkDetails(card, body.details),
  }
}

export async function addHeatmapItem(
  accountId: string,
  cardKey: string,
  body: HeatmapItemBody,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  const card = cardFor(cardKey)
  const data = itemData(card, body)
  await withWriteGate(accountId, actor, async (tx) => {
    await tx.salesAccountHeatmapItem.create({
      data: { salesAccountId: accountId, card: card.key, ...data, createdBy: actor.sub, updatedBy: actor.sub },
    })
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      after: { [label(card, "item")]: itemText(card, body) },
    })
  })
  return getHeatmap(accountId, actor)
}

/** The item, only if it is on this account. Its card comes from the row, not from the page. */
async function itemOn(tx: Client, accountId: string, itemId: string): Promise<{ row: ItemRow; card: HeatmapCardSpec }> {
  const row = (await tx.salesAccountHeatmapItem.findFirst({ where: { id: itemId, salesAccountId: accountId } })) as ItemRow | null
  const card = row ? CARD_BY_KEY.get(row.card) : undefined
  if (!row || !card) throw new AppError(404, NO_SUCH_ITEM)
  return { row, card }
}

export async function updateHeatmapItem(
  accountId: string,
  itemId: string,
  body: HeatmapItemBody,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  await withWriteGate(accountId, actor, async (tx) => {
    const { row, card } = await itemOn(tx, accountId, itemId)
    await tx.salesAccountHeatmapItem.update({
      where: { id: itemId },
      data: { ...itemData(card, body), updatedBy: actor.sub },
    })
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { [label(card, "item")]: rowText(card, row) },
      after: { [label(card, "item")]: itemText(card, body) },
    })
  })
  return getHeatmap(accountId, actor)
}

export async function removeHeatmapItem(
  accountId: string,
  itemId: string,
  actor: AccessTokenPayload,
): Promise<AccountHeatmap> {
  await withWriteGate(accountId, actor, async (tx) => {
    const { row, card } = await itemOn(tx, accountId, itemId)
    await tx.salesAccountHeatmapItem.delete({ where: { id: itemId } })
    await writeAudit(tx as never, {
      entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
      before: { [label(card, "item")]: rowText(card, row) },
      after: { [label(card, "item")]: null },
    })
  })
  return getHeatmap(accountId, actor)
}
