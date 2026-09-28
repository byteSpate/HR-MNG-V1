import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    customer: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customer.service"

const ACTOR = {
  sub: "user-1",
  role: "FINANCE_OFFICER",
  email: "f@byte.spate",
  mustChangePassword: false,
  salesRole: null,
} as any

function runTransaction() {
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
}

beforeEach(() => {
  vi.clearAllMocks()
  runTransaction()
})

describe("listCustomers", () => {
  it("returns every customer ordered by legal name", async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([{ id: "c1", legalName: "Acme" }] as any)

    const result = await listCustomers()

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { legalName: "asc" } })
    )
    expect(result).toEqual([{ id: "c1", legalName: "Acme" }])
  })
})

describe("getCustomer", () => {
  it("throws a 404 AppError when the customer does not exist", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)

    await expect(getCustomer("missing")).rejects.toThrow(AppError)
    await expect(getCustomer("missing")).rejects.toMatchObject({ statusCode: 404 })
  })

  it("returns the customer when it exists", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ id: "c1", legalName: "Acme" } as any)

    const result = await getCustomer("c1")

    expect(result).toEqual({ id: "c1", legalName: "Acme" })
  })
})

describe("createCustomer", () => {
  it("creates the row and writes an audit entry inside the same transaction", async () => {
    vi.mocked(prisma.customer.create).mockResolvedValue({ id: "c1", legalName: "Acme" } as any)

    const result = await createCustomer({ legalName: "Acme" }, ACTOR)

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ legalName: "Acme", paymentDays: 30, salesAccountId: null }),
      })
    )
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: "CUSTOMER", entityId: "c1", action: "CREATE" }),
      })
    )
    expect(result).toEqual({ id: "c1", legalName: "Acme" })
  })

  it("defaults paymentDays to 30 when omitted", async () => {
    vi.mocked(prisma.customer.create).mockResolvedValue({ id: "c1" } as any)

    await createCustomer({ legalName: "Acme" }, ACTOR)

    expect(prisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentDays: 30 }) })
    )
  })

  it("refuses a duplicate legal name with a clear message", async () => {
    vi.mocked(prisma.customer.create).mockRejectedValue({ code: "P2002" })

    await expect(createCustomer({ legalName: "Acme" }, ACTOR)).rejects.toThrow(
      "A customer with this legal name already exists"
    )
  })
})

describe("updateCustomer", () => {
  it("refuses when the customer does not exist", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)

    await expect(updateCustomer("missing", { legalName: "Acme" }, ACTOR)).rejects.toThrow(AppError)
  })

  it("updates the row and writes an audit entry with before/after", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: "c1", legalName: "Old Name", bin: null, paymentDays: 30,
    } as any)
    vi.mocked(prisma.customer.update).mockResolvedValue({
      id: "c1", legalName: "New Name", bin: null, paymentDays: 30,
    } as any)

    await updateCustomer("c1", { legalName: "New Name" }, ACTOR)

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "CUSTOMER",
          action: "UPDATE",
          before: expect.objectContaining({ legalName: "Old Name" }),
          after: expect.objectContaining({ legalName: "New Name" }),
        }),
      })
    )
  })
})
