import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    supplier: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { findSimilarSuppliers, listSupplierOptions, quickAddSupplier, supplierNameKey } from "./supplier.quick"

const SALES = { sub: "u-s", role: "EMPLOYEE", salesRole: "SALES_USER", email: "s@b.co", mustChangePassword: false } as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe("supplierNameKey", () => {
  it("treats spacing, case and punctuation as the same name", () => {
    expect(supplierNameKey("Star Tech")).toBe(supplierNameKey("startech"))
    expect(supplierNameKey("Star-Tech")).toBe("startech")
  })
})

describe("quickAddSupplier", () => {
  it("refuses a supplier that already exists", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)
    await expect(quickAddSupplier({ name: "startech" }, SALES)).rejects.toThrow(
      "Star Tech is already a supplier. Pick it from the list."
    )
  })

  it("adds a supplier by name only", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.supplier.create).mockResolvedValue({ id: "s2", name: "Smart Technologies" } as any)
    expect(await quickAddSupplier({ name: "Smart Technologies" }, SALES)).toEqual({ id: "s2", name: "Smart Technologies" })
  })
})

describe("findSimilarSuppliers", () => {
  it("finds similar names while typing", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([])
    await findSimilarSuppliers("star t")
    expect(vi.mocked(prisma.supplier.findMany).mock.calls[0][0]).toMatchObject({ where: { nameKey: { contains: "start" } }, take: 5 })
  })
})

describe("listSupplierOptions", () => {
  it("lists only active suppliers", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([])
    await listSupplierOptions()
    expect(vi.mocked(prisma.supplier.findMany).mock.calls[0][0]).toMatchObject({ where: { isActive: true } })
  })
})
