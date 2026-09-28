import type { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"

/**
 * Which journal lines count as a deal's Cost: every posted EXPENSE line
 * tagged with the deal, except the exchange gain and loss accounts.
 *
 * Cost is "what this deal's supplier bills cost us" (spec, "The four
 * numbers"). A US-dollar supplier payment books the rate change between
 * the bill and the payment to an exchange loss (an expense) or an exchange
 * gain (income), tagged with the deal. That is not a bill cost, and
 * counting only the loss side would let currency movement push Profit down
 * but never up (final review Fix 4).
 *
 * The two accounts come from the FX posting rules, not written-in codes, so
 * re-pointing a rule moves this exclusion with it. Shared by the deal Money
 * section (dealMoney.service.ts) and the Deals list (dealMoney.list.ts), so
 * the two can never count Cost differently.
 */
export async function dealCostLineWhere(): Promise<Prisma.JournalLineWhereInput> {
  const fxRules = await loadRules(prisma, "FX")
  const fxCodes = [resolveAccountCode(fxRules, "LOSS"), resolveAccountCode(fxRules, "GAIN")]
  return {
    account: { type: "EXPENSE", code: { notIn: fxCodes } },
    journal: { status: { in: ["POSTED", "REVERSED"] } },
  }
}
