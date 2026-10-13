import type { OpportunityStage, Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { longDate, parseDateOnly } from "../../../utils/dates"
import { officeDateOf } from "../../attendance/attendance.time"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { formatBdt } from "../../accounting/accounting.utils"
import { dec, toMoneyString } from "../../payroll/payroll.money"
import type { QuoteBody } from "./quote.validators"

/**
 * The one writer for quotes (owner, 2026-10-13), shared by Add quote and by
 * the stage change. It lives apart from `quote.service.ts` so the
 * Opportunity service can use it without a circular import.
 *
 * The rule it keeps: once an Opportunity has a quote, its `amount` is the
 * latest quote's amount. Every write here ends with `syncAmount`, inside the
 * caller's transaction.
 */

/** Newest first: the highest quote date, then the one entered last. */
export const LATEST_FIRST = [{ quotedOn: "desc" as const }, { createdAt: "desc" as const }]

export const FUTURE_DATE = "A quote date cannot be in the future."
const NOT_A_DATE = "Pick a real date for the quote."

/** "৳12,00,000.00 on 3 October 2026 (BS-Q-0012)", for History. */
export function quoteText(q: { amount: Prisma.Decimal | string; quotedOn: Date; reference: string | null }): string {
  const ref = q.reference ? ` (${q.reference})` : ""
  return `৳${formatBdt(dec(q.amount))} on ${longDate(q.quotedOn)}${ref}`
}

/** A checked quote date: real, and not after the office's today. */
export function quoteDate(value: string): Date {
  let date: Date
  try {
    date = parseDateOnly(value)
  } catch {
    throw new AppError(400, NOT_A_DATE)
  }
  if (date > officeDateOf(new Date())) throw new AppError(400, FUTURE_DATE)
  return date
}

const amountText = (v: unknown) => (v == null ? null : toMoneyString(dec(v as string)))

/**
 * Sets the Opportunity's amount to its latest quote, and writes the change to
 * History. With no quote left, the amount stays as it was: the last known
 * figure is more honest than none.
 */
export async function syncAmount(
  tx: Prisma.TransactionClient,
  opp: { id: string; amount: unknown },
  actor: AccessTokenPayload,
): Promise<void> {
  const latest = await tx.opportunityQuote.findFirst({ where: { opportunityId: opp.id }, orderBy: LATEST_FIRST })
  if (!latest || amountText(latest.amount) === amountText(opp.amount)) return
  await tx.opportunity.update({ where: { id: opp.id }, data: { amount: latest.amount, lastActivityAt: new Date() } })
  await writeAudit(tx, {
    entity: "OPPORTUNITY", entityId: opp.id, action: "UPDATE", changedBy: actor.sub,
    before: { amount: amountText(opp.amount) }, after: { amount: amountText(latest.amount) },
  })
}

/**
 * Saves a new quote at `opp.stage`. The first quote also sets the Funnel date
 * (`offeredOn`) when there is none yet.
 */
export async function createQuoteIn(
  tx: Prisma.TransactionClient,
  opp: { id: string; stage: OpportunityStage; offeredOn: Date | null; amount: unknown },
  body: QuoteBody,
  actor: AccessTokenPayload,
): Promise<void> {
  const quotedOn = quoteDate(body.quotedOn)
  const created = await tx.opportunityQuote.create({
    data: {
      opportunityId: opp.id, amount: dec(body.amount), quotedOn, reference: body.reference, note: body.note,
      stage: opp.stage, createdBy: actor.sub, updatedBy: actor.sub,
    },
  })
  if (!opp.offeredOn) await tx.opportunity.update({ where: { id: opp.id }, data: { offeredOn: quotedOn } })
  await writeAudit(tx, {
    entity: "OPPORTUNITY", entityId: opp.id, action: "UPDATE", changedBy: actor.sub,
    before: { quote: null }, after: { quote: quoteText(created) },
  })
  await syncAmount(tx, opp, actor)
}
