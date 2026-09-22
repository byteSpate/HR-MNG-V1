import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplier: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    supplierOpeningBalance: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import {
  commitSupplierOpeningBalanceImport,
  previewSupplierOpeningBalanceImport,
} from "./supplier.opening-balance.import"

const ACTOR = {
  sub: "user-1", role: "SUPER_ADMIN", email: "admin@byte.spate", mustChangePassword: false, salesRole: null,
} as any

function runTransaction() {
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
}

beforeEach(() => {
  vi.clearAllMocks()
  runTransaction()
  vi.mocked(prisma.supplier.findMany).mockResolvedValue([])
})

describe("previewSupplierOpeningBalanceImport", () => {
  it("flags a negative amount", async () => {
    const buffer = Buffer.from("name,amount\nStar Tech,-500\n")
    const preview = await previewSupplierOpeningBalanceImport(buffer, "test.csv")
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ column: "amount", rowNumber: 2 })
    )
  })

  it("accepts a valid row for a supplier that does not exist yet", async () => {
    const buffer = Buffer.from("name,amount\nStar Tech,80000\n")
    const preview = await previewSupplierOpeningBalanceImport(buffer, "test.csv")
    expect(preview.issues).toHaveLength(0)
    expect(preview.rows).toEqual([
      expect.objectContaining({ name: "Star Tech", amount: 80000 }),
    ])
  })

  it("refuses a supplier that already has an opening balance", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([
      { name: "Star Tech", openingBalance: { id: "ob-1" } },
    ] as any)
    const buffer = Buffer.from("name,amount\nStar Tech,80000\n")
    const preview = await previewSupplierOpeningBalanceImport(buffer, "test.csv")
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ column: "name", rowNumber: 2 })
    )
  })
})

describe("commitSupplierOpeningBalanceImport", () => {
  it("creates a new Supplier and its opening balance, dated SALES_GO_LIVE", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.supplier.create).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)

    const buffer = Buffer.from("name,amount\nStar Tech,80000\n")
    const result = await commitSupplierOpeningBalanceImport(buffer, "test.csv", ACTOR)

    expect(prisma.supplier.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Star Tech" }) })
    )
    expect(prisma.supplierOpeningBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: "s1",
          amount: 80000,
          asOf: new Date("2026-10-01T00:00:00.000Z"),
          importedBy: "user-1",
        }),
      })
    )
    expect(result).toEqual({ supplierCount: 1, totalAmount: 80000 })
  })

  it("reuses an existing supplier by name rather than creating a duplicate", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue({ id: "existing-1", name: "Star Tech" } as any)

    const buffer = Buffer.from("name,amount\nStar Tech,80000\n")
    await commitSupplierOpeningBalanceImport(buffer, "test.csv", ACTOR)

    expect(prisma.supplier.create).not.toHaveBeenCalled()
    expect(prisma.supplierOpeningBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ supplierId: "existing-1" }) })
    )
  })
})
