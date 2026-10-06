import { describe, expect, it, vi } from "vitest"
import { nextReceiptNumber } from "./receipt.number"

function arrange(value: number) {
  const upsert = vi.fn().mockResolvedValue({ id: "MR", value })
  return { tx: { idCounter: { upsert } } as any, upsert }
}

describe("nextReceiptNumber", () => {
  it("counts up the MR counter row inside the transaction it is given", async () => {
    const { tx, upsert } = arrange(1)

    await nextReceiptNumber(tx)

    expect(upsert).toHaveBeenCalledWith({
      where: { id: "MR" },
      update: { value: { increment: 1 } },
      create: { id: "MR", value: 1 },
    })
  })

  it("pads to four digits", async () => {
    expect(await nextReceiptNumber(arrange(1).tx)).toBe("MR-0001")
    expect(await nextReceiptNumber(arrange(10).tx)).toBe("MR-0010")
    expect(await nextReceiptNumber(arrange(9999).tx)).toBe("MR-9999")
  })

  it("keeps going past four digits instead of cutting the number", async () => {
    expect(await nextReceiptNumber(arrange(10000).tx)).toBe("MR-10000")
  })
})
