import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    salesAccount: { findUnique: vi.fn() },
    heatmapGroup: { findMany: vi.fn() },
    heatmapProduct: { findFirst: vi.fn() },
    heatmapPart: { findFirst: vi.fn() },
    salesAccountHeatmapMark: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    salesAccountHeatmapNote: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../sales.access", async () => ({
  ...(await vi.importActual<object>("../sales.access")),
  requireAccountVisible: vi.fn(),
}))

import prisma from "../../../config/prisma"
import { getHeatmap, setPartMark, setProductMarks, setProductNote } from "./heatmap.service"

const ID = "11111111-1111-4111-8111-111111111111"
const OWNER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OTHER = { sub: "user-3", role: "EMPLOYEE", salesRole: "SALES_USER" } as any

// The service asks Prisma for visible rows only (`where: { hidden: false }`),
// so the mock returns what Prisma would: no hidden rows.
const ROUTER = {
  id: "prod-router", title: "Router",
  parts: [{ id: "p-small", title: "Small range router", note: "Up to 1 Gbps." }, { id: "p-mid", title: "Mid range router", note: null }],
}
const LIST = [{ id: "g-net", title: "Network", products: [ROUTER] }]
const auditData = () => vi.mocked(prisma.auditLog.create).mock.calls[0][0].data as any
const mark = (partId: string, state: "GREEN" | "RED", at = "2026-10-18T05:00:00Z") =>
  ({ partId, state, updatedBy: "user-1", updatedAt: new Date(at) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockImplementation((async (args: any) =>
    ({ employee: { id: args.where.id === "user-1" ? "emp-1" : "emp-9" } })) as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-1", displayName: null, email: "a@b.c", employee: { fullName: "Rahim" } }] as any)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue({ ownerEmployeeId: "emp-1", assignments: [] } as any)
  vi.mocked(prisma.heatmapGroup.findMany).mockResolvedValue(LIST as any)
  vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccountHeatmapNote.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccountHeatmapNote.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.heatmapProduct.findFirst).mockResolvedValue({ id: "prod-router", title: "Router", parts: [{ id: "p-small" }, { id: "p-mid" }] } as any)
  vi.mocked(prisma.heatmapPart.findFirst).mockResolvedValue({
    id: "p-mid", title: "Mid range router",
    product: { id: "prod-router", title: "Router", parts: [{ id: "p-small" }, { id: "p-mid" }] },
  } as any)
})

describe("reading the heatmap", () => {
  it("asks for visible rows only and shows Grey when nothing is checked", async () => {
    const view = await getHeatmap(ID, OWNER)
    expect(vi.mocked(prisma.heatmapGroup.findMany).mock.calls[0][0]).toMatchObject({
      where: { hidden: false },
      select: { products: { where: { hidden: false }, select: { parts: { where: { hidden: false } } } } },
    })
    expect(view.groups[0].products[0]).toMatchObject({ colour: "GREY", note: null, tickedCount: 0, checkedCount: 0, markedByName: null })
    expect(view.groups[0].products[0].parts.map((p) => p.id)).toEqual(["p-small", "p-mid"])
    expect(view.counts).toEqual({ GREEN: 0, RED: 0, GREY: 1 })
    expect(view.canManage).toBe(true)
  })

  it("is Green with one tick, and names who marked it last", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-mid", "GREEN")] as any)
    const product = (await getHeatmap(ID, OWNER)).groups[0].products[0]
    expect(product).toMatchObject({ colour: "GREEN", tickedCount: 1, checkedCount: 1, markedByName: "Rahim", markedAt: "2026-10-18T05:00:00.000Z" })
    expect(product.parts.find((p) => p.id === "p-mid")!.mark).toBe("GREEN")
    expect(product.parts.find((p) => p.id === "p-small")!.mark).toBeNull()
  })

  it("ignores a mark on a hidden part", async () => {
    // p-old is a hidden part: its mark stays saved but never decides a colour.
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-old", "GREEN")] as any)
    const view = await getHeatmap(ID, OWNER)
    expect(view.groups[0].products[0]).toMatchObject({ colour: "GREY", checkedCount: 0 })
    expect(view.counts.GREEN).toBe(0)
  })

  it("is Red only when every part is crossed, and then carries the note", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "RED"), mark("p-mid", "RED")] as any)
    vi.mocked(prisma.salesAccountHeatmapNote.findMany).mockResolvedValue([{ productId: "prod-router", note: "Uses another vendor" }] as any)
    const view = await getHeatmap(ID, OWNER)
    expect(view.groups[0].products[0]).toMatchObject({ colour: "RED", note: "Uses another vendor", checkedCount: 2, tickedCount: 0 })
    expect(view.counts).toEqual({ GREEN: 0, RED: 1, GREY: 0 })
  })

  it("keeps a half-crossed product Grey and shows no note or maker", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "RED")] as any)
    vi.mocked(prisma.salesAccountHeatmapNote.findMany).mockResolvedValue([{ productId: "prod-router", note: "left over" }] as any)
    const product = (await getHeatmap(ID, OWNER)).groups[0].products[0]
    expect(product).toMatchObject({ colour: "GREY", note: null, markedByName: null, markedAt: null, checkedCount: 1 })
  })

  it("lets a viewer with no part in the account read but not change", async () => {
    expect((await getHeatmap(ID, OTHER)).canManage).toBe(false)
  })
})

describe("a tick or cross on one part", () => {
  it("saves a tick and writes History with the part name", async () => {
    await setPartMark(ID, "p-mid", { mark: "GREEN" }, OWNER)
    expect(prisma.salesAccountHeatmapMark.upsert).toHaveBeenCalledWith({
      where: { salesAccountId_partId: { salesAccountId: ID, partId: "p-mid" } },
      create: { salesAccountId: ID, partId: "p-mid", state: "GREEN", updatedBy: "user-1" },
      update: { state: "GREEN", updatedBy: "user-1" },
    })
    expect(auditData()).toMatchObject({
      entity: "SALES_ACCOUNT", entityId: ID,
      before: { "Heatmap, Router: Mid range router": "Not checked" },
      after: { "Heatmap, Router: Mid range router": "Tick" },
    })
  })

  it("writes nothing when the part already has that mark", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-mid", "GREEN")] as any)
    await setPartMark(ID, "p-mid", { mark: "GREEN" }, OWNER)
    expect(prisma.salesAccountHeatmapMark.upsert).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("clears a mark with NONE", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-mid", "RED")] as any)
    await setPartMark(ID, "p-mid", { mark: "NONE" }, OWNER)
    expect(prisma.salesAccountHeatmapMark.deleteMany).toHaveBeenCalledWith({ where: { salesAccountId: ID, partId: "p-mid" } })
    expect(auditData()).toMatchObject({
      before: { "Heatmap, Router: Mid range router": "Cross" },
      after: { "Heatmap, Router: Mid range router": "Not checked" },
    })
  })

  it("removes the note when the product stops being Red", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "RED"), mark("p-mid", "RED")] as any)
    await setPartMark(ID, "p-mid", { mark: "GREEN" }, OWNER)
    expect(prisma.salesAccountHeatmapNote.deleteMany).toHaveBeenCalledWith({ where: { salesAccountId: ID, productId: "prod-router" } })
  })

  it("keeps the note when the last cross keeps the product Red", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "RED")] as any)
    await setPartMark(ID, "p-mid", { mark: "RED" }, OWNER)
    expect(prisma.salesAccountHeatmapNote.deleteMany).not.toHaveBeenCalled()
  })

  it("refuses a hidden or deleted part with a reload sentence", async () => {
    vi.mocked(prisma.heatmapPart.findFirst).mockResolvedValue(null)
    await expect(setPartMark(ID, "p-gone", { mark: "GREEN" }, OWNER)).rejects.toMatchObject({
      statusCode: 404, message: "That is no longer on the heatmap. Reload the page and try again.",
    })
  })

  it("refuses someone who may only view", async () => {
    await expect(setPartMark(ID, "p-mid", { mark: "GREEN" }, OTHER)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("all ticks or all crosses on a product", () => {
  it("marks every shown part and writes one History line", async () => {
    await setProductMarks(ID, "prod-router", { mark: "GREEN" }, OWNER)
    expect(prisma.salesAccountHeatmapMark.upsert).toHaveBeenCalledTimes(2)
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(auditData()).toMatchObject({
      before: { "Heatmap, Router": "0 ticked, 0 crossed, 2 not checked" },
      after: { "Heatmap, Router": "2 ticked, 0 crossed, 0 not checked" },
    })
  })

  it("only writes the parts that differ", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "GREEN")] as any)
    await setProductMarks(ID, "prod-router", { mark: "GREEN" }, OWNER)
    expect(prisma.salesAccountHeatmapMark.upsert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.salesAccountHeatmapMark.upsert).mock.calls[0][0].create).toMatchObject({ partId: "p-mid" })
  })

  it("does nothing when every part already has that mark", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "RED"), mark("p-mid", "RED")] as any)
    await setProductMarks(ID, "prod-router", { mark: "RED" }, OWNER)
    expect(prisma.salesAccountHeatmapMark.upsert).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("clears every part with NONE, and drops the note", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "RED"), mark("p-mid", "RED")] as any)
    await setProductMarks(ID, "prod-router", { mark: "NONE" }, OWNER)
    expect(prisma.salesAccountHeatmapMark.deleteMany).toHaveBeenCalledWith({
      where: { salesAccountId: ID, partId: { in: ["p-small", "p-mid"] } },
    })
    expect(prisma.salesAccountHeatmapNote.deleteMany).toHaveBeenCalled()
  })

  it("keeps the note when it makes the product Red", async () => {
    await setProductMarks(ID, "prod-router", { mark: "RED" }, OWNER)
    expect(prisma.salesAccountHeatmapNote.deleteMany).not.toHaveBeenCalled()
  })

  it("refuses a product with no parts, and a hidden product", async () => {
    vi.mocked(prisma.heatmapProduct.findFirst).mockResolvedValue({ id: "prod-router", title: "Router", parts: [] } as any)
    await expect(setProductMarks(ID, "prod-router", { mark: "GREEN" }, OWNER)).rejects.toMatchObject({
      statusCode: 409, message: "This product has no parts yet. Ask a Sales Admin to add one in Sales Settings.",
    })
    vi.mocked(prisma.heatmapProduct.findFirst).mockResolvedValue(null)
    await expect(setProductMarks(ID, "prod-x", { mark: "GREEN" }, OWNER)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("refuses someone who may only view", async () => {
    await expect(setProductMarks(ID, "prod-router", { mark: "GREEN" }, OTHER)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("the note on a Red product", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "RED"), mark("p-mid", "RED")] as any)
  })

  it("saves a trimmed note and writes History", async () => {
    await setProductNote(ID, "prod-router", { note: "Uses another vendor" }, OWNER)
    expect(prisma.salesAccountHeatmapNote.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { salesAccountId: ID, productId: "prod-router", note: "Uses another vendor", updatedBy: "user-1" },
    }))
    expect(auditData()).toMatchObject({
      before: { "Heatmap, Router: note": "No note" },
      after: { "Heatmap, Router: note": "Uses another vendor" },
    })
  })

  it("removes the note when it is emptied", async () => {
    vi.mocked(prisma.salesAccountHeatmapNote.findUnique).mockResolvedValue({ id: "n-1", note: "old" } as any)
    await setProductNote(ID, "prod-router", { note: null }, OWNER)
    expect(prisma.salesAccountHeatmapNote.delete).toHaveBeenCalledWith({ where: { id: "n-1" } })
  })

  it("writes nothing when the note is unchanged", async () => {
    vi.mocked(prisma.salesAccountHeatmapNote.findUnique).mockResolvedValue({ id: "n-1", note: "same" } as any)
    await setProductNote(ID, "prod-router", { note: "same" }, OWNER)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("refuses a note on a product that is not Red", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("p-small", "RED")] as any)
    await expect(setProductNote(ID, "prod-router", { note: "x" }, OWNER)).rejects.toMatchObject({
      statusCode: 409, message: "Only a Red product can have a note. Put a cross on every part first.",
    })
  })
})
