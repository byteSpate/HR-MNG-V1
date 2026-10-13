import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => {
  const model = () => ({ findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), aggregate: vi.fn() })
  return {
    default: {
      $transaction: vi.fn(),
      heatmapGroup: model(),
      heatmapProduct: model(),
      heatmapPart: model(),
      salesAccountHeatmapPick: { findMany: vi.fn() },
      salesAccountHeatmapScope: { findMany: vi.fn() },
      auditLog: { create: vi.fn() },
    },
  }
})

import prisma from "../../../config/prisma"
import { addListRow, deleteListRow, editListRow, getHeatmapList, moveListRow } from "./heatmap.list.service"

const ADMIN = { sub: "admin-1", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const auditData = () => vi.mocked(prisma.auditLog.create).mock.calls[0][0].data as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.heatmapGroup.findMany).mockResolvedValue([
    { id: "g1", title: "Network", hidden: false, products: [
      { id: "pr1", title: "Router", hidden: false, parts: [
        { id: "pa1", title: "Small range router", note: null, hidden: false },
        { id: "pa2", title: "Mid range router", note: null, hidden: false },
      ] },
    ] },
  ] as any)
  vi.mocked(prisma.salesAccountHeatmapPick.findMany).mockResolvedValue([{ salesAccountId: "acc-1", productId: "pr1" }] as any)
  vi.mocked(prisma.salesAccountHeatmapScope.findMany).mockResolvedValue([
    { salesAccountId: "acc-1", partId: "pa1" }, { salesAccountId: "acc-2", partId: "pa1" },
  ] as any)
})

describe("reading the list", () => {
  it("counts distinct accounts at each level", async () => {
    const list = await getHeatmapList()
    const router = list.groups[0].products[0]
    expect(router.parts.map((p) => p.usedBy)).toEqual([2, 0])
    expect(router.usedBy).toBe(2) // acc-1 (a pick and a tick, counted once) and acc-2
    expect(list.groups[0].usedBy).toBe(2)
  })
})

describe("adding", () => {
  it("adds a part at the end of its product and writes the audit log", async () => {
    vi.mocked(prisma.heatmapProduct.findUnique).mockResolvedValue({ id: "pr1", title: "Router" } as any)
    vi.mocked(prisma.heatmapPart.findMany).mockResolvedValue([{ id: "pa1", title: "Small range router" }] as any)
    vi.mocked(prisma.heatmapPart.aggregate).mockResolvedValue({ _max: { position: 3 } } as any)
    vi.mocked(prisma.heatmapPart.create).mockResolvedValue({ id: "pa9" } as any)
    await addListRow("parts", "pr1", { title: "SD-WAN", note: "Joins many offices." }, ADMIN)
    expect(prisma.heatmapPart.create).toHaveBeenCalledWith({
      data: { productId: "pr1", title: "SD-WAN", note: "Joins many offices.", position: 4 },
      select: { id: true },
    })
    expect(auditData()).toMatchObject({ entity: "HEATMAP_LIST", entityId: "pa9", action: "CREATE", after: { part: "SD-WAN", in: "Router" } })
  })

  it("refuses a name already used next to it, ignoring case and spaces", async () => {
    vi.mocked(prisma.heatmapProduct.findUnique).mockResolvedValue({ id: "pr1", title: "Router" } as any)
    vi.mocked(prisma.heatmapPart.findMany).mockResolvedValue([{ id: "pa4", title: "SD-WAN " }] as any)
    await expect(addListRow("parts", "pr1", { title: "sd-wan", note: null }, ADMIN)).rejects.toMatchObject({
      statusCode: 409, message: "Router already has a part called SD-WAN. Use a different name.",
    })
  })

  it("refuses a parent that is gone", async () => {
    vi.mocked(prisma.heatmapProduct.findUnique).mockResolvedValue(null)
    await expect(addListRow("parts", "nope", { title: "X", note: null }, ADMIN)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("editing", () => {
  it("hides a product and logs before and after", async () => {
    vi.mocked(prisma.heatmapProduct.findUnique).mockResolvedValue({ id: "pr1", groupId: "g1", title: "Router", hidden: false, position: 1 } as any)
    await editListRow("products", "pr1", { hidden: true }, ADMIN)
    expect(prisma.heatmapProduct.update).toHaveBeenCalledWith({ where: { id: "pr1" }, data: { hidden: true } })
    expect(auditData()).toMatchObject({ action: "UPDATE", before: { product: "Router", hidden: false }, after: { product: "Router", hidden: true } })
  })
})

describe("moving", () => {
  it("swaps with the neighbour above", async () => {
    vi.mocked(prisma.heatmapPart.findUnique).mockResolvedValue({ id: "pa2", productId: "pr1", title: "Mid range router", position: 2 } as any)
    vi.mocked(prisma.heatmapPart.findFirst).mockResolvedValue({ id: "pa1", position: 1 } as any)
    await moveListRow("parts", "pa2", "UP", ADMIN)
    expect(prisma.heatmapPart.findFirst).toHaveBeenCalledWith({
      where: { productId: "pr1", position: { lt: 2 } }, orderBy: { position: "desc" }, select: { id: true, position: true },
    })
    expect(prisma.heatmapPart.update).toHaveBeenCalledWith({ where: { id: "pa2" }, data: { position: 1 } })
    expect(prisma.heatmapPart.update).toHaveBeenCalledWith({ where: { id: "pa1" }, data: { position: 2 } })
  })

  it("does nothing at the top", async () => {
    vi.mocked(prisma.heatmapPart.findUnique).mockResolvedValue({ id: "pa1", productId: "pr1", title: "Small", position: 1 } as any)
    vi.mocked(prisma.heatmapPart.findFirst).mockResolvedValue(null)
    await moveListRow("parts", "pa1", "UP", ADMIN)
    expect(prisma.heatmapPart.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })
})

describe("deleting", () => {
  it("deletes a part nobody ticked", async () => {
    vi.mocked(prisma.heatmapPart.findUnique).mockResolvedValue({ id: "pa2", productId: "pr1", title: "Mid range router", position: 2 } as any)
    await deleteListRow("parts", "pa2", ADMIN)
    expect(prisma.heatmapPart.delete).toHaveBeenCalledWith({ where: { id: "pa2" } })
    expect(auditData()).toMatchObject({ action: "DELETE", before: { part: "Mid range router" } })
  })

  it("refuses a part in use, with the count read inside the transaction", async () => {
    vi.mocked(prisma.heatmapPart.findUnique).mockResolvedValue({ id: "pa1", productId: "pr1", title: "Small range router", position: 1 } as any)
    await expect(deleteListRow("parts", "pa1", ADMIN)).rejects.toMatchObject({
      statusCode: 409, message: "2 accounts use Small range router. Hide it instead.",
    })
    expect(prisma.heatmapPart.delete).not.toHaveBeenCalled()
  })

  it("says 1 account, not 1 accounts", async () => {
    vi.mocked(prisma.salesAccountHeatmapScope.findMany).mockResolvedValue([{ salesAccountId: "acc-1", partId: "pa1" }] as any)
    vi.mocked(prisma.salesAccountHeatmapPick.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.heatmapPart.findUnique).mockResolvedValue({ id: "pa1", productId: "pr1", title: "Small range router", position: 1 } as any)
    await expect(deleteListRow("parts", "pa1", ADMIN)).rejects.toMatchObject({ message: "1 account uses Small range router. Hide it instead." })
  })
})
