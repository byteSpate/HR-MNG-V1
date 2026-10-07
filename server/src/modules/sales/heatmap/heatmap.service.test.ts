import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    salesAccount: { findUnique: vi.fn() },
    salesAccountHeatmapNeed: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    salesAccountHeatmapItem: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../sales.access", async () => ({
  ...(await vi.importActual<object>("../sales.access")),
  requireAccountVisible: vi.fn(),
}))
vi.mock("../../attendance/attendance.time", () => ({ officeToday: () => new Date("2026-10-07T00:00:00.000Z") }))

import prisma from "../../../config/prisma"
import { requireAccountVisible } from "../sales.access"
import {
  addHeatmapItem, getHeatmap, removeHeatmapItem, setCardNeed, updateHeatmapItem,
} from "./heatmap.service"

const ID = "11111111-1111-4111-8111-111111111111"
const ITEM_ID = "22222222-2222-4222-8222-222222222222"
const OWNER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OTHER = { sub: "user-3", role: "EMPLOYEE", salesRole: "SALES_USER" } as any

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const itemRow = (o: Record<string, unknown> = {}) => ({
  id: ITEM_ID, salesAccountId: ID, card: "switch", brand: "Cisco", model: "C9200-24P", quantity: 24,
  site: "Head office", boughtFrom: "Smart Technologies", boughtOn: d("2022-01-10"), supportEndsOn: d("2027-03-03"),
  endOfLifeOn: null, supportBy: null, notes: null, details: { ports: "24", poe: "YES" },
  createdBy: "user-1", updatedBy: "user-1",
  createdAt: new Date("2026-09-20T00:00:00.000Z"), updatedAt: new Date("2026-09-21T00:00:00.000Z"), ...o,
})
const ITEM_BODY = {
  brand: "HP", model: null, quantity: 6, site: null, boughtFrom: null, boughtOn: null,
  supportEndsOn: "2029-01-01", endOfLifeOn: null, supportBy: null, notes: null, details: { managed: "YES" },
}
const auditData = () => vi.mocked(prisma.auditLog.create).mock.calls[0][0].data as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "user-1", displayName: null, email: "a@b.c", employee: { fullName: "Rahim" } },
  ] as any)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue({ ownerEmployeeId: "emp-1", assignments: [] } as any)
  vi.mocked(prisma.salesAccountHeatmapNeed.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccountHeatmapNeed.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.salesAccountHeatmapItem.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccountHeatmapItem.findFirst).mockResolvedValue(itemRow() as any)
})

describe("reading the heatmap", () => {
  it("checks the person may see the account first", async () => {
    await getHeatmap(ID, OWNER)
    expect(requireAccountVisible).toHaveBeenCalledWith(ID, OWNER)
  })

  it("shows all 14 cards, grey when nothing is known, with the counts", async () => {
    const view = await getHeatmap(ID, OWNER)
    expect(view.cards).toHaveLength(14)
    expect(view.cards[0]).toMatchObject({ key: "router", title: "Router", need: "NOT_ASKED", colour: "GREY", items: [] })
    expect(view.counts).toEqual({ GREEN: 0, YELLOW: 0, RED: 0, GREY: 14 })
    expect(view.groups.map((g) => g.title)).toEqual(["Network", "Servers and data", "Phones and security", "Software and safety"])
    expect(view.canManage).toBe(true)
  })

  it("colours each card from its need and its items, and names who recorded them", async () => {
    vi.mocked(prisma.salesAccountHeatmapNeed.findMany).mockResolvedValue([
      { card: "server", need: "NO_NEED", reason: "All in the cloud", updatedBy: "user-1", updatedAt: new Date("2026-09-22T00:00:00.000Z") },
      { card: "cctv", need: "NEED", reason: null, updatedBy: "user-1", updatedAt: new Date("2026-09-22T00:00:00.000Z") },
    ] as any)
    vi.mocked(prisma.salesAccountHeatmapItem.findMany).mockResolvedValue([itemRow()] as any)

    const view = await getHeatmap(ID, OWNER)
    const byKey = new Map(view.cards.map((c) => [c.key, c]))
    expect(byKey.get("switch")).toMatchObject({ colour: "GREEN", reason: "Ends on 3 March 2027.", chanceFrom: "2026-03-03" })
    expect(byKey.get("switch")!.items[0]).toEqual({
      id: ITEM_ID, brand: "Cisco", model: "C9200-24P", quantity: 24, site: "Head office", boughtFrom: "Smart Technologies",
      boughtOn: "2022-01-10", supportEndsOn: "2027-03-03", endOfLifeOn: null, supportBy: null, notes: null,
      details: { ports: "24", poe: "YES" }, recordedByName: "Rahim", recordedAt: "2026-09-21T00:00:00.000Z",
    })
    expect(byKey.get("server")).toMatchObject({ need: "NO_NEED", needReason: "All in the cloud", needByName: "Rahim", colour: "RED" })
    expect(byKey.get("cctv")).toMatchObject({ need: "NEED", colour: "GREEN" })
    expect(view.counts).toEqual({ GREEN: 2, YELLOW: 0, RED: 1, GREY: 11 })
  })

  it("ignores rows for a card that is no longer on the list", async () => {
    vi.mocked(prisma.salesAccountHeatmapItem.findMany).mockResolvedValue([itemRow({ card: "fax" })] as any)
    const view = await getHeatmap(ID, OWNER)
    expect(view.cards.every((c) => c.items.length === 0)).toBe(true)
  })

  it("tells a viewer who cannot change the account", async () => {
    expect((await getHeatmap(ID, OTHER)).canManage).toBe(false)
  })
})

describe("setting the need", () => {
  it("refuses someone who cannot change the account, and writes nothing", async () => {
    await expect(setCardNeed(ID, "server", { need: "NEED", reason: null }, OTHER)).rejects.toMatchObject({
      statusCode: 403,
      message: "You can view this Sales Account, but only its owner, collaborators, or a Sales Admin can change its heatmap.",
    })
    expect(prisma.salesAccountHeatmapNeed.upsert).not.toHaveBeenCalled()
  })

  it("refuses a card that is not on the heatmap", async () => {
    await expect(setCardNeed(ID, "fax", { need: "NEED", reason: null }, OWNER)).rejects.toMatchObject({
      statusCode: 404, message: "That card is not on the heatmap. Reload the page and try again.",
    })
  })

  it("saves No need with its reason and writes it to History", async () => {
    await setCardNeed(ID, "server", { need: "NO_NEED", reason: "All in the cloud" }, OWNER)
    expect(vi.mocked(prisma.salesAccountHeatmapNeed.upsert).mock.calls[0][0]).toMatchObject({
      where: { salesAccountId_card: { salesAccountId: ID, card: "server" } },
      create: { salesAccountId: ID, card: "server", need: "NO_NEED", reason: "All in the cloud", updatedBy: "user-1" },
      update: { need: "NO_NEED", reason: "All in the cloud", updatedBy: "user-1" },
    })
    expect(auditData()).toMatchObject({
      entity: "SALES_ACCOUNT", entityId: ID, action: "UPDATE",
      before: { "Heatmap, Server: need": "Not asked yet" },
      after: { "Heatmap, Server: need": "No need: All in the cloud" },
    })
  })

  it("clears the need when set back to Not asked yet", async () => {
    vi.mocked(prisma.salesAccountHeatmapNeed.findUnique).mockResolvedValue({ id: "n-1", need: "NEED", reason: null } as any)
    await setCardNeed(ID, "server", { need: "NOT_ASKED", reason: null }, OWNER)
    expect(prisma.salesAccountHeatmapNeed.delete).toHaveBeenCalledWith({ where: { id: "n-1" } })
    expect(auditData().after).toEqual({ "Heatmap, Server: need": "Not asked yet" })
  })

  it("writes nothing when nothing changed", async () => {
    vi.mocked(prisma.salesAccountHeatmapNeed.findUnique).mockResolvedValue({ id: "n-1", need: "NEED", reason: null } as any)
    await setCardNeed(ID, "server", { need: "NEED", reason: null }, OWNER)
    vi.mocked(prisma.salesAccountHeatmapNeed.findUnique).mockResolvedValue(null)
    await setCardNeed(ID, "router", { need: "NOT_ASKED", reason: null }, OWNER)
    expect(prisma.salesAccountHeatmapNeed.upsert).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })
})

describe("adding an item", () => {
  it("checks the extra fields against the card", async () => {
    await expect(addHeatmapItem(ID, "switch", { ...ITEM_BODY, details: { cameras: "4" } }, OWNER)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(prisma.salesAccountHeatmapItem.create).not.toHaveBeenCalled()
  })

  it("saves the item with real dates and writes it to History", async () => {
    await addHeatmapItem(ID, "switch", ITEM_BODY, OWNER)
    expect(vi.mocked(prisma.salesAccountHeatmapItem.create).mock.calls[0][0].data).toEqual({
      salesAccountId: ID, card: "switch", brand: "HP", model: null, quantity: 6, site: null, boughtFrom: null,
      boughtOn: null, supportEndsOn: d("2029-01-01"), endOfLifeOn: null, supportBy: null, notes: null,
      details: { managed: "YES" }, createdBy: "user-1", updatedBy: "user-1",
    })
    expect(auditData().after).toEqual({ "Heatmap, Switch: item": "HP, 6, Warranty or support ends 1 January 2029" })
    expect(auditData().before).toBeUndefined()
  })

  it("refuses someone who cannot change the account", async () => {
    await expect(addHeatmapItem(ID, "switch", ITEM_BODY, OTHER)).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.salesAccountHeatmapItem.create).not.toHaveBeenCalled()
  })
})

describe("changing and removing an item", () => {
  it("refuses an item that is not on this account", async () => {
    vi.mocked(prisma.salesAccountHeatmapItem.findFirst).mockResolvedValue(null)
    await expect(updateHeatmapItem(ID, ITEM_ID, ITEM_BODY, OWNER)).rejects.toMatchObject({
      statusCode: 404, message: "That item is not on this account. Reload the page and try again.",
    })
    await expect(removeHeatmapItem(ID, ITEM_ID, OWNER)).rejects.toMatchObject({ statusCode: 404 })
    expect(vi.mocked(prisma.salesAccountHeatmapItem.findFirst).mock.calls[0][0]).toMatchObject({
      where: { id: ITEM_ID, salesAccountId: ID },
    })
  })

  it("saves a change and writes before and after to History", async () => {
    await updateHeatmapItem(ID, ITEM_ID, ITEM_BODY, OWNER)
    expect(vi.mocked(prisma.salesAccountHeatmapItem.update).mock.calls[0][0]).toMatchObject({
      where: { id: ITEM_ID }, data: { brand: "HP", quantity: 6, updatedBy: "user-1" },
    })
    expect(auditData().before).toEqual({ "Heatmap, Switch: item": "Cisco C9200-24P, 24, Warranty or support ends 3 March 2027" })
    expect(auditData().after).toEqual({ "Heatmap, Switch: item": "HP, 6, Warranty or support ends 1 January 2029" })
  })

  it("removes an item and writes it to History", async () => {
    await removeHeatmapItem(ID, ITEM_ID, OWNER)
    expect(prisma.salesAccountHeatmapItem.delete).toHaveBeenCalledWith({ where: { id: ITEM_ID } })
    expect(auditData().after).toEqual({ "Heatmap, Switch: item": null })
  })

  it("refuses someone who cannot change the account", async () => {
    await expect(removeHeatmapItem(ID, ITEM_ID, OTHER)).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.salesAccountHeatmapItem.delete).not.toHaveBeenCalled()
  })
})
