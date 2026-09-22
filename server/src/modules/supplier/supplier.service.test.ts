import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplier: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    journalLine: { count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import {
  createSupplier,
  deactivateSupplier,
  getSupplier,
  listSuppliers,
  reactivateSupplier,
  updateSupplier,
} from "./supplier.service"

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
  vi.mocked(prisma.journalLine.count).mockResolvedValue(0)
})

describe("listSuppliers", () => {
  it("returns every supplier ordered by name", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([{ id: "s1", name: "Star Tech" }] as any)

    const result = await listSuppliers()

    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: "asc" } })
    )
    expect(result).toEqual([{ id: "s1", name: "Star Tech" }])
  })
})

describe("getSupplier", () => {
  it("throws a 404 AppError when the supplier does not exist", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null)
    await expect(getSupplier("missing")).rejects.toThrow(AppError)
    await expect(getSupplier("missing")).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("createSupplier", () => {
  it("creates the row and writes an audit entry", async () => {
    vi.mocked(prisma.supplier.create).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)

    const result = await createSupplier({ name: "Star Tech" }, ACTOR)

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: "SUPPLIER", entityId: "s1", action: "CREATE" }),
      })
    )
    expect(result).toEqual({ id: "s1", name: "Star Tech" })
  })

  it("refuses a duplicate name with a clear message, not a raw Prisma error", async () => {
    vi.mocked(prisma.supplier.create).mockRejectedValue({ code: "P2002" })

    await expect(createSupplier({ name: "Star Tech" }, ACTOR)).rejects.toThrow(
      "A supplier with this name already exists"
    )
  })
})

describe("updateSupplier", () => {
  it("refuses when the supplier does not exist", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null)
    await expect(updateSupplier("missing", { name: "Star Tech" }, ACTOR)).rejects.toThrow(AppError)
  })
})

describe("deactivateSupplier", () => {
  it("refuses when the supplier does not exist", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null)
    await expect(deactivateSupplier("missing", ACTOR)).rejects.toThrow(AppError)
  })

  it("sets isActive to false and writes an audit entry", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)
    vi.mocked(prisma.supplier.update).mockResolvedValue({ id: "s1", isActive: false } as any)

    const result = await deactivateSupplier("s1", ACTOR)

    expect(prisma.supplier.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { isActive: false },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SUPPLIER",
          action: "UPDATE",
          before: expect.objectContaining({ isActive: true }),
          after: expect.objectContaining({ isActive: false }),
        }),
      })
    )
    expect(result).toEqual({ id: "s1", isActive: false })
  })
})

describe("reactivateSupplier", () => {
  it("refuses when the supplier does not exist", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null)
    await expect(reactivateSupplier("missing", ACTOR)).rejects.toThrow(AppError)
  })

  it("sets isActive to true and writes an audit entry", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue({ id: "s1", name: "Star Tech" } as any)
    vi.mocked(prisma.supplier.update).mockResolvedValue({ id: "s1", isActive: true } as any)

    const result = await reactivateSupplier("s1", ACTOR)

    expect(prisma.supplier.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { isActive: true },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SUPPLIER",
          action: "UPDATE",
          before: expect.objectContaining({ isActive: false }),
          after: expect.objectContaining({ isActive: true }),
        }),
      })
    )
    expect(result).toEqual({ id: "s1", isActive: true })
  })
})
