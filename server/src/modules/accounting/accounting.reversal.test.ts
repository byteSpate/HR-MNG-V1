import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    journal: { findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    idCounter: { upsert: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { draftReversal } from "./accounting.reversal"

const d = (v: string) => new Prisma.Decimal(v)

beforeEach(() => vi.clearAllMocks())

describe("draftReversal", () => {
  it("inverts every line and copies every dimension, the deal's included", async () => {
    vi.mocked(prisma.journal.findUniqueOrThrow).mockResolvedValue({
      id: "j1", journalNo: "BS-JV-00010", status: "POSTED", date: new Date("2026-09-30"), periodId: "p9", narration: "Monthly earnings",
      lines: [{
        accountId: "a1221", debit: d("31000"), credit: d("0"), narration: null, departmentId: null, employeeId: null,
        opportunityId: "opp-1", customerId: "c1", supplierId: null, sourceCurrency: null, sourceAmount: null, fxRateToBdt: null, sortOrder: 0,
      }],
    } as any)
    vi.mocked(prisma.idCounter.upsert).mockResolvedValue({ id: "JV", value: 11 } as any)
    vi.mocked(prisma.journal.create).mockResolvedValue({ id: "j-rev", journalNo: "BS-JV-00011" } as any)

    await draftReversal(prisma as any, "j1", "Wrong contract dates", "admin-1")

    expect(prisma.journal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "REVERSAL", status: "DRAFT", reversesId: "j1", reversalReason: "Wrong contract dates",
        lines: {
          createMany: {
            data: [expect.objectContaining({ debit: d("0"), credit: d("31000"), opportunityId: "opp-1", customerId: "c1", supplierId: null })],
          },
        },
      }),
    }))
    expect(prisma.journal.update).toHaveBeenCalledWith({ where: { id: "j1" }, data: { status: "REVERSED" } })
  })

  it("refuses a journal that is not posted", async () => {
    vi.mocked(prisma.journal.findUniqueOrThrow).mockResolvedValue({ id: "j1", journalNo: "BS-JV-00010", status: "DRAFT", lines: [] } as any)
    await expect(draftReversal(prisma as any, "j1", "x", "admin-1")).rejects.toThrow("BS-JV-00010 is not posted, so it cannot be reversed.")
  })
})
