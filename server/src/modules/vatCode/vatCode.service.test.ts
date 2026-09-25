import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    vatCode: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { createVatCode, listVatCodes, updateVatCode } from "./vatCode.service"

const d = (v: string) => new Prisma.Decimal(v)
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any

function arrangeVatCode(over: { id: string; code: string; ratePercent: Prisma.Decimal }) {
  vi.mocked(prisma.vatCode.findUnique).mockResolvedValue({
    id: over.id, code: over.code, name: "Standard 15%", ratePercent: over.ratePercent, isActive: true,
  } as any)
  vi.mocked(prisma.vatCode.update).mockResolvedValue({
    id: over.id, code: over.code, name: "Standard 15%", ratePercent: over.ratePercent, isActive: true,
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("listVatCodes", () => {
  it("returns active codes ordered by rate", async () => {
    vi.mocked(prisma.vatCode.findMany).mockResolvedValue([
      { id: "v1", code: "STD15", name: "Standard 15%", ratePercent: "15.00", isActive: true },
    ] as any)

    const result = await listVatCodes()

    expect(prisma.vatCode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: { ratePercent: "desc" } })
    )
    expect(result).toEqual([
      { id: "v1", code: "STD15", name: "Standard 15%", ratePercent: "15.00", isActive: true },
    ])
  })

  it("lists only active codes unless all=true", async () => {
    vi.mocked(prisma.vatCode.findMany).mockResolvedValue([])

    await listVatCodes({ all: true })

    expect(vi.mocked(prisma.vatCode.findMany).mock.calls[0][0]).not.toHaveProperty("where.isActive")
  })
})

describe("createVatCode", () => {
  it("refuses a code that already exists", async () => {
    vi.mocked(prisma.vatCode.create).mockRejectedValue({ code: "P2002" })

    await expect(createVatCode({ code: "STD15", name: "Standard", ratePercent: "15" }, FINANCE)).rejects.toThrow(
      "A VAT code STD15 already exists."
    )
  })

  it("creates and audits", async () => {
    vi.mocked(prisma.vatCode.create).mockResolvedValue({ id: "v1", code: "ZERO0", name: "Zero rated", ratePercent: "0" } as any)

    await createVatCode({ code: "ZERO0", name: "Zero rated", ratePercent: "0" }, FINANCE)

    expect(prisma.vatCode.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { code: "ZERO0", name: "Zero rated", ratePercent: "0" },
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "VAT_CODE", action: "CREATE" }),
    }))
  })
})

describe("updateVatCode", () => {
  it("lets the rate change", async () => {
    arrangeVatCode({ id: "v1", code: "STD15", ratePercent: d("15") })

    await updateVatCode("v1", { ratePercent: "7.5" }, FINANCE)

    expect(prisma.vatCode.update).toHaveBeenCalledWith(expect.objectContaining({ data: { ratePercent: "7.5" } }))
  })

  it("refuses a VAT code that does not exist", async () => {
    vi.mocked(prisma.vatCode.findUnique).mockResolvedValue(null)
    await expect(updateVatCode("missing", { ratePercent: "7.5" }, FINANCE)).rejects.toThrow("VAT code not found")
  })
})
