import { describe, expect, it, vi } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { loadActiveVatRates, vatFor } from "./receivables.vat"

const d = (v: string) => new Prisma.Decimal(v)

describe("vatFor", () => {
  it("rounds VAT to the paisa, per line", () => {
    expect(vatFor(d("333.33"), d("15")).toFixed(2)).toBe("50.00")
    expect(vatFor(d("100"), d("0")).toFixed(2)).toBe("0.00")
  })
})

describe("loadActiveVatRates", () => {
  it("refuses an unknown or inactive VAT code", async () => {
    const client = { vatCode: { findMany: vi.fn().mockResolvedValue([]) } }
    await expect(loadActiveVatRates(client as any, ["vat-x"])).rejects.toThrow("Unknown or inactive VAT code on a line")
  })

  it("returns a rate per active code, de-duplicating ids", async () => {
    const client = { vatCode: { findMany: vi.fn().mockResolvedValue([{ id: "vat-15", ratePercent: d("15") }]) } }
    const rates = await loadActiveVatRates(client as any, ["vat-15", "vat-15"])
    expect(rates.get("vat-15")?.toFixed(2)).toBe("15.00")
    expect(client.vatCode.findMany).toHaveBeenCalledWith({ where: { id: { in: ["vat-15"] }, isActive: true } })
  })
})
