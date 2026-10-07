import { describe, expect, it, vi } from "vitest"
import { nextPaymentVoucherNumber } from "./supplierPayment.number"

function arrange(value: number) {
  const upsert = vi.fn().mockResolvedValue({ id: "PV", value })
  return { tx: { idCounter: { upsert } } as any, upsert }
}

describe("nextPaymentVoucherNumber", () => {
  it("counts up the PV counter row inside the transaction it is given", async () => {
    const { tx, upsert } = arrange(1)

    await nextPaymentVoucherNumber(tx)

    expect(upsert).toHaveBeenCalledWith({
      where: { id: "PV" },
      update: { value: { increment: 1 } },
      create: { id: "PV", value: 1 },
    })
  })

  it("pads to four digits", async () => {
    expect(await nextPaymentVoucherNumber(arrange(1).tx)).toBe("PV-0001")
    expect(await nextPaymentVoucherNumber(arrange(10).tx)).toBe("PV-0010")
    expect(await nextPaymentVoucherNumber(arrange(9999).tx)).toBe("PV-9999")
  })

  it("keeps going past four digits instead of cutting the number", async () => {
    expect(await nextPaymentVoucherNumber(arrange(10000).tx)).toBe("PV-10000")
  })
})
