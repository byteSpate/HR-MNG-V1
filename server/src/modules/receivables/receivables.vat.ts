import { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"

/** amount × ratePercent / 100, rounded to the paisa — the same rule Phase 2
 *  uses for a supplier bill line. */
export function vatFor(amount: Prisma.Decimal, ratePercent: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(amount.times(ratePercent).dividedBy(100).toFixed(2))
}

export type VatMethodInput = "CODE" | "MANUAL"

export interface LineVatInput {
  vatCodeId: string
  vatMethod: VatMethodInput
  vatRatePercent?: string | null
}

export interface LineVat {
  vatCodeId: string
  vatMethod: VatMethodInput
  /** The rate used, 2 decimals. Saved on the line. */
  vatRatePercent: string
  vatAmount: string
}

/**
 * The one place a line's VAT is decided (spec 2026-09-28 §1.6). The code must
 * be in `rates` (loaded by `loadActiveVatRates`) even for a typed rate: the
 * line keeps its code, so the VAT summary and posting rules see no change.
 * The validator has already refused MANUAL without a rate.
 */
export function resolveLineVat(input: LineVatInput, rates: Map<string, Prisma.Decimal>, amount: Prisma.Decimal): LineVat {
  const codeRate = rates.get(input.vatCodeId)
  if (!codeRate) throw new AppError(400, "This VAT code does not exist, or has been turned off.")
  const rate = input.vatMethod === "MANUAL" ? new Prisma.Decimal(input.vatRatePercent!) : codeRate
  return {
    vatCodeId: input.vatCodeId,
    vatMethod: input.vatMethod,
    vatRatePercent: rate.toFixed(2),
    vatAmount: vatFor(amount, rate).toFixed(2),
  }
}

interface VatCodeClient {
  vatCode: {
    findMany: (args: { where: { id: { in: string[] }; isActive: boolean } }) => Promise<Array<{ id: string; ratePercent: Prisma.Decimal }>>
  }
}

/** One rate lookup per write, so a rate that was deactivated between two
 *  lines on the same document is still refused rather than half-applied. */
export async function loadActiveVatRates(client: VatCodeClient, ids: string[]): Promise<Map<string, Prisma.Decimal>> {
  const uniqueIds = [...new Set(ids)]
  const codes = await client.vatCode.findMany({ where: { id: { in: uniqueIds }, isActive: true } })
  const rates = new Map<string, Prisma.Decimal>(codes.map((c) => [c.id, new Prisma.Decimal(c.ratePercent)]))
  for (const id of uniqueIds) {
    if (!rates.has(id)) throw new AppError(400, "This VAT code does not exist, or has been turned off.")
  }
  return rates
}
