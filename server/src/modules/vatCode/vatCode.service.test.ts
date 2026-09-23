import { describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: { vatCode: { findMany: vi.fn() } },
}))

import prisma from "../../config/prisma"
import { listVatCodes } from "./vatCode.service"

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
})
