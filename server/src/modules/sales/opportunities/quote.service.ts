import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { dec } from "../../payroll/payroll.money"
import { employeeIdFor, isSalesAdmin } from "../sales.access"
import { QUOTED_STAGES } from "../sales.stages"
import { INCLUDE, loadForWrite } from "./opportunity.service"
import { presentOpportunity } from "./opportunity.present"
import { createQuoteIn, LATEST_FIRST, lockOpportunity, quoteDate, quoteText, syncAmount } from "./quote.write"
import type { QuoteBody } from "./quote.validators"

export { quoteText }

/**
 * Add quote, and Edit or Delete the latest quote (owner, 2026-10-13). The
 * Opportunity's amount follows the latest quote; `quote.write.ts` keeps the
 * two in step.
 */

const CLOSED = "This Opportunity is closed, so its quotes cannot change."
const NOT_YET = "Add a quote when the Opportunity reaches a quote stage."
const NOT_YOURS = "Only the Opportunity owner or a Sales Admin can change a quote."
const NOT_LATEST = "Only the latest quote can be changed. Older quotes are kept as history."
export const NO_SUCH_QUOTE = "That quote is not on this Opportunity. Reload the page and try again."

type Row = Awaited<ReturnType<typeof loadForWrite>>

async function reread(tx: Prisma.TransactionClient, id: string) {
  return presentOpportunity(await tx.opportunity.findFirst({ where: { id }, include: INCLUDE }))
}

export async function addQuote(opportunityId: string, body: QuoteBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const current = await loadForWrite(tx, opportunityId, actor)
    if (current.status !== "ONGOING") throw new AppError(409, CLOSED)
    if (!QUOTED_STAGES.has(current.stage) && !current.offeredOn) throw new AppError(409, NOT_YET)
    await createQuoteIn(tx, current, body, actor)
    return reread(tx, opportunityId)
  })
}

/** The checks Edit and Delete share. Returns the Opportunity and its latest quote. */
async function latestFor(tx: Prisma.TransactionClient, opportunityId: string, quoteId: string, actor: AccessTokenPayload) {
  const current: Row = await loadForWrite(tx, opportunityId, actor)
  if (current.status !== "ONGOING") throw new AppError(409, CLOSED)
  const employeeId = await employeeIdFor(actor)
  if (!isSalesAdmin(actor) && employeeId !== current.ownerEmployeeId) throw new AppError(403, NOT_YOURS)
  // Before the latest quote is read, so a save at the same moment cannot slip in between.
  await lockOpportunity(tx, opportunityId)
  const latest = await tx.opportunityQuote.findFirst({ where: { opportunityId }, orderBy: LATEST_FIRST })
  if (!latest) throw new AppError(404, NO_SUCH_QUOTE)
  if (latest.id !== quoteId) throw new AppError(409, NOT_LATEST)
  return { current, latest }
}

export async function editLatestQuote(opportunityId: string, quoteId: string, body: QuoteBody, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const { current, latest } = await latestFor(tx, opportunityId, quoteId, actor)
    const quotedOn = quoteDate(body.quotedOn)
    const updated = await tx.opportunityQuote.update({
      where: { id: quoteId },
      data: { amount: dec(body.amount), quotedOn, reference: body.reference, note: body.note, updatedBy: actor.sub },
    })
    // Quote 1 set the Funnel date. If its date is corrected, the Funnel date follows.
    if (current.offeredOn && current.offeredOn.getTime() === latest.quotedOn.getTime() && quotedOn.getTime() !== latest.quotedOn.getTime()) {
      await tx.opportunity.update({ where: { id: opportunityId }, data: { offeredOn: quotedOn } })
    }
    await writeAudit(tx, {
      entity: "OPPORTUNITY", entityId: opportunityId, action: "UPDATE", changedBy: actor.sub,
      before: { quote: quoteText(latest) }, after: { quote: quoteText(updated) },
    })
    await syncAmount(tx, current, actor)
    return reread(tx, opportunityId)
  })
}

export async function deleteLatestQuote(opportunityId: string, quoteId: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const { current, latest } = await latestFor(tx, opportunityId, quoteId, actor)
    await tx.opportunityQuote.delete({ where: { id: quoteId } })
    await writeAudit(tx, {
      entity: "OPPORTUNITY", entityId: opportunityId, action: "UPDATE", changedBy: actor.sub,
      before: { quote: quoteText(latest) }, after: { quote: null },
    })
    await syncAmount(tx, current, actor)
    return reread(tx, opportunityId)
  })
}
