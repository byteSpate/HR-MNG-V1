import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({ env: { SALES_GO_LIVE: "2026-10-01" } }))

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    customer: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    customerOpeningBalance: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import {
  commitCustomerOpeningBalanceImport,
  previewCustomerOpeningBalanceImport,
} from "./customer.opening-balance.import"

const ACTOR = {
  sub: "user-1", role: "SUPER_ADMIN", email: "admin@byte.spate", mustChangePassword: false, salesRole: null,
} as any

function runTransaction() {
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
}

beforeEach(() => {
  vi.clearAllMocks()
  runTransaction()
  vi.mocked(prisma.customer.findMany).mockResolvedValue([])
})

describe("previewCustomerOpeningBalanceImport", () => {
  it("flags a negative amount", async () => {
    const buffer = Buffer.from("legalName,amount\nAcme Corp,-500\n")
    const preview = await previewCustomerOpeningBalanceImport(buffer, "test.csv")
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ column: "amount", rowNumber: 2 })
    )
  })

  it("accepts a valid row for a customer that does not exist yet", async () => {
    const buffer = Buffer.from("legalName,amount\nAcme Corp,150000\n")
    const preview = await previewCustomerOpeningBalanceImport(buffer, "test.csv")
    expect(preview.issues).toHaveLength(0)
    expect(preview.rows).toEqual([
      expect.objectContaining({ legalName: "Acme Corp", amount: 150000 }),
    ])
  })

  it("refuses a customer that already has an opening balance", async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { legalName: "Acme Corp", openingBalance: { id: "ob-1" } },
    ] as any)
    const buffer = Buffer.from("legalName,amount\nAcme Corp,150000\n")
    const preview = await previewCustomerOpeningBalanceImport(buffer, "test.csv")
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ column: "legalName", rowNumber: 2 })
    )
  })
})

describe("commitCustomerOpeningBalanceImport", () => {
  it("creates a new Customer and its opening balance, dated SALES_GO_LIVE", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.customer.create).mockResolvedValue({ id: "c1", legalName: "Acme Corp" } as any)

    const buffer = Buffer.from("legalName,amount\nAcme Corp,150000\n")
    const result = await commitCustomerOpeningBalanceImport(buffer, "test.csv", ACTOR)

    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ legalName: "Acme Corp" }) })
    )
    expect(prisma.customerOpeningBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "c1",
          amount: 150000,
          asOf: new Date("2026-10-01T00:00:00.000Z"),
          importedBy: "user-1",
        }),
      })
    )
    expect(result).toEqual({ customerCount: 1, totalAmount: 150000 })
  })

  it("reuses an existing customer by legalName rather than creating a duplicate", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ id: "existing-1", legalName: "Acme Corp" } as any)

    const buffer = Buffer.from("legalName,amount\nAcme Corp,150000\n")
    await commitCustomerOpeningBalanceImport(buffer, "test.csv", ACTOR)

    expect(prisma.customer.create).not.toHaveBeenCalled()
    expect(prisma.customerOpeningBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: "existing-1" }) })
    )
  })
})
