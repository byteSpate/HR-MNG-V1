import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    salesAccount: { findUnique: vi.fn() },
    heatmapGroup: { findMany: vi.fn() },
    heatmapProduct: { findFirst: vi.fn() },
    heatmapPart: { findFirst: vi.fn() },
    salesAccountHeatmapPick: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    salesAccountHeatmapScope: { findMany: vi.fn(), findUnique: vi.fn(), createMany: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../sales.access", async () => ({
  ...(await vi.importActual<object>("../sales.access")),
  requireAccountVisible: vi.fn(),
}))

import prisma from "../../../config/prisma"
import { getHeatmap, setPartScope, setProductColour } from "./heatmap.service"

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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockImplementation((async (args: any) =>
    ({ employee: { id: args.where.id === "user-1" ? "emp-1" : "emp-9" } })) as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-1", displayName: null, email: "a@b.c", employee: { fullName: "Rahim" } }] as any)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue({ ownerEmployeeId: "emp-1", assignments: [] } as any)
  vi.mocked(prisma.heatmapGroup.findMany).mockResolvedValue(LIST as any)
  vi.mocked(prisma.salesAccountHeatmapPick.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccountHeatmapPick.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.salesAccountHeatmapScope.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccountHeatmapScope.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.salesAccountHeatmapScope.createMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.heatmapProduct.findFirst).mockResolvedValue({ id: "prod-router", title: "Router" } as any)
  vi.mocked(prisma.heatmapPart.findFirst).mockResolvedValue({ id: "p-mid", title: "Mid range router", product: { id: "prod-router", title: "Router" } } as any)
})

describe("reading the heatmap", () => {
  it("asks for visible rows only and shows Grey when nothing is picked", async () => {
    const view = await getHeatmap(ID, OWNER)
    expect(vi.mocked(prisma.heatmapGroup.findMany).mock.calls[0][0]).toMatchObject({
      where: { hidden: false },
      select: { products: { where: { hidden: false }, select: { parts: { where: { hidden: false } } } } },
    })
    expect(view.groups[0].products[0]).toMatchObject({ colour: "GREY", reason: null, inScopeCount: 0 })
    expect(view.groups[0].products[0].parts.map((p) => p.id)).toEqual(["p-small", "p-mid"])
    expect(view.counts).toEqual({ GREEN: 0, RED: 0, GREY: 1 })
    expect(view.canManage).toBe(true)
  })

  it("shows a pick and its maker, and counts only ticks on shown parts", async () => {
    vi.mocked(prisma.salesAccountHeatmapPick.findMany).mockResolvedValue([
      { productId: "prod-router", colour: "GREEN", reason: null, updatedBy: "user-1", updatedAt: new Date("2026-10-13T05:00:00Z") },
    ] as any)
    // p-old is a hidden part: its tick stays saved but is not counted.
    vi.mocked(prisma.salesAccountHeatmapScope.findMany).mockResolvedValue([{ partId: "p-mid" }, { partId: "p-old" }] as any)
    const product = (await getHeatmap(ID, OWNER)).groups[0].products[0]
    expect(product).toMatchObject({ colour: "GREEN", pickedByName: "Rahim", inScopeCount: 1 })
    expect(product.parts.find((p) => p.id === "p-mid")!.inScope).toBe(true)
  })

  it("lets a viewer with no part in the account read but not change", async () => {
    expect((await getHeatmap(ID, OTHER)).canManage).toBe(false)
  })
})

describe("setting a colour", () => {
  it("saves Red with its reason and writes History", async () => {
    await setProductColour(ID, "prod-router", { colour: "RED", reason: "Uses another vendor" }, OWNER)
    expect(prisma.salesAccountHeatmapPick.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ colour: "RED", reason: "Uses another vendor", productId: "prod-router" }),
    }))
    expect(auditData()).toMatchObject({
      entity: "SALES_ACCOUNT", entityId: ID,
      before: { "Heatmap, Router": "Not picked" },
      after: { "Heatmap, Router": "Red: Uses another vendor" },
    })
  })

  it("writes nothing when nothing changes, and clears with NONE", async () => {
    vi.mocked(prisma.salesAccountHeatmapPick.findUnique).mockResolvedValue({ id: "pick-1", colour: "GREEN", reason: null } as any)
    await setProductColour(ID, "prod-router", { colour: "GREEN", reason: null }, OWNER)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    await setProductColour(ID, "prod-router", { colour: "NONE", reason: null }, OWNER)
    expect(prisma.salesAccountHeatmapPick.delete).toHaveBeenCalledWith({ where: { id: "pick-1" } })
  })

  it("refuses a hidden or missing product with a reload sentence", async () => {
    vi.mocked(prisma.heatmapProduct.findFirst).mockResolvedValue(null)
    await expect(setProductColour(ID, "prod-x", { colour: "GREEN", reason: null }, OWNER)).rejects.toMatchObject({
      statusCode: 404, message: "That is no longer on the heatmap. Reload the page and try again.",
    })
  })

  it("refuses someone who may only view", async () => {
    await expect(setProductColour(ID, "prod-router", { colour: "GREEN", reason: null }, OTHER)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("ticking a part", () => {
  it("ticks and writes History with the part name", async () => {
    await setPartScope(ID, "p-mid", { inScope: true }, OWNER)
    expect(prisma.salesAccountHeatmapScope.createMany).toHaveBeenCalledWith({
      data: [{ salesAccountId: ID, partId: "p-mid", createdBy: "user-1" }],
      skipDuplicates: true,
    })
    expect(auditData()).toMatchObject({
      before: { "Heatmap, Router: Mid range router": "Not in scope" },
      after: { "Heatmap, Router: Mid range router": "In scope" },
    })
  })

  it("does nothing when already ticked, and unticks", async () => {
    vi.mocked(prisma.salesAccountHeatmapScope.findUnique).mockResolvedValue({ id: "s-1" } as any)
    await setPartScope(ID, "p-mid", { inScope: true }, OWNER)
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    await setPartScope(ID, "p-mid", { inScope: false }, OWNER)
    expect(prisma.salesAccountHeatmapScope.delete).toHaveBeenCalledWith({ where: { id: "s-1" } })
  })

  it("treats a tick saved by someone else at the same moment as done", async () => {
    vi.mocked(prisma.salesAccountHeatmapScope.createMany).mockResolvedValue({ count: 0 } as any)
    await expect(setPartScope(ID, "p-mid", { inScope: true }, OWNER)).resolves.toBeDefined()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("refuses a tick on a Red product", async () => {
    vi.mocked(prisma.salesAccountHeatmapPick.findUnique).mockResolvedValue({ id: "pick-1", colour: "RED", reason: "x" } as any)
    await expect(setPartScope(ID, "p-mid", { inScope: true }, OWNER)).rejects.toMatchObject({
      statusCode: 409,
      message: "This product is marked Red. Mark it Green or clear it before you tick its parts.",
    })
  })

  it("refuses a hidden or deleted part", async () => {
    vi.mocked(prisma.heatmapPart.findFirst).mockResolvedValue(null)
    await expect(setPartScope(ID, "p-gone", { inScope: true }, OWNER)).rejects.toMatchObject({ statusCode: 404 })
  })
})
