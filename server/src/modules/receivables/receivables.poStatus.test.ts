import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    customerPo: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { refreshPoStatus } from "./receivables.poStatus"

const d = (v: string) => new Prisma.Decimal(v)

function line(over: Record<string, unknown> = {}) {
  return {
    amount: d("800000"), quantity: d("10"),
    invoiceLines: [], earningLines: [], monthlyEarnings: [],
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe("refreshPoStatus", () => {
  it("completes an untracked PO once it is fully invoiced, with no earning check at all", async () => {
    vi.mocked(prisma.customerPo.findUniqueOrThrow).mockResolvedValue({
      status: "OPEN", trackDelivery: false,
      lines: [line({ invoiceLines: [{ amount: d("800000") }] })],
    } as any)

    await expect(refreshPoStatus(prisma as any, "po1")).resolves.toBe("COMPLETE")
    expect(prisma.customerPo.update).toHaveBeenCalledWith({ where: { id: "po1" }, data: { status: "COMPLETE" } })
  })

  it("leaves a tracked PO open when fully invoiced but not fully earned", async () => {
    vi.mocked(prisma.customerPo.findUniqueOrThrow).mockResolvedValue({
      status: "OPEN", trackDelivery: true,
      lines: [line({ invoiceLines: [{ amount: d("800000") }], earningLines: [] })],
    } as any)

    await expect(refreshPoStatus(prisma as any, "po1")).resolves.toBe("OPEN")
    expect(prisma.customerPo.update).not.toHaveBeenCalled()
  })

  it("completes a tracked PO once it is both fully invoiced and fully earned", async () => {
    vi.mocked(prisma.customerPo.findUniqueOrThrow).mockResolvedValue({
      status: "OPEN", trackDelivery: true,
      lines: [line({
        invoiceLines: [{ amount: d("800000") }],
        earningLines: [{ amount: d("800000"), quantity: d("10") }],
      })],
    } as any)

    await expect(refreshPoStatus(prisma as any, "po1")).resolves.toBe("COMPLETE")
  })

  it("returns a cancelled PO unchanged, without re-checking anything", async () => {
    vi.mocked(prisma.customerPo.findUniqueOrThrow).mockResolvedValue({ status: "CANCELLED", trackDelivery: false, lines: [] } as any)

    await expect(refreshPoStatus(prisma as any, "po1")).resolves.toBe("CANCELLED")
    expect(prisma.customerPo.update).not.toHaveBeenCalled()
  })
})
