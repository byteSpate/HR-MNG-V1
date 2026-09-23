import { Prisma } from "../../generated/prisma/client"
import type { SaleLineKind } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { SystemJournalInput } from "../accounting/accounting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { toLedgerDate } from "../accounting/accounting.utils"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import type { ResolvedRules } from "../posting/posting.types"
import { assertWithinOutstanding, CREDIT_NOTE_INCLUDE } from "./customerCreditNote.service"
import { lockDeal } from "./receivables.position"

type Line = SystemJournalInput["lines"][number]

export interface CreditNoteForPosting {
  id: string
  customerId: string
  opportunityId: string
  lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal; kind: SaleLineKind }>
}

/** design §3.3: "2170 first, then Revenue; 2150 for the VAT / Cr 1220".
 *  With delivery not tracked in 3a, 2170 is always nil, so this debits
 *  revenue directly, mirroring buildInvoiceLines the same way its credit
 *  mirrors that debit. */
export function buildCustomerCreditNoteLines(note: CreditNoteForPosting, rules: ResolvedRules): Line[] {
  const debits: Line[] = []
  let gross = new Prisma.Decimal(0)

  for (const line of note.lines) {
    debits.push({
      accountCode: resolveAccountCode(rules, line.kind),
      debit: line.amount.toFixed(2),
      opportunityId: note.opportunityId,
    })
    if (!line.vatAmount.isZero()) {
      debits.push({
        accountCode: resolveAccountCode(rules, "VAT"),
        debit: line.vatAmount.toFixed(2),
        opportunityId: note.opportunityId,
      })
    }
    gross = gross.plus(line.amount).plus(line.vatAmount)
  }

  return [
    ...debits,
    {
      accountCode: resolveAccountCode(rules, "RECEIVABLE"),
      credit: gross.toFixed(2),
      customerId: note.customerId,
      opportunityId: note.opportunityId,
    },
  ]
}

export async function approveCustomerCreditNote(id: string, actor: AccessTokenPayload) {
  return prisma.$transaction(async (tx) => {
    const head = await tx.customerCreditNote.findUnique({
      where: { id },
      select: { invoice: { select: { po: { select: { opportunityId: true } } } } },
    })
    if (!head) throw new AppError(404, "Customer credit note not found")

    // Spec §3.5: events on one deal are serialised, and a credit note moves
    // the same Unbilled/Unearned position an invoice does.
    await lockDeal(tx, head.invoice.po.opportunityId)

    const note = await tx.customerCreditNote.findUnique({
      where: { id },
      include: {
        customer: { select: { legalName: true } },
        invoice: {
          select: {
            id: true, invoiceNumber: true, customerId: true, status: true,
            po: { select: { opportunityId: true } },
            lines: { select: { amount: true, vatAmount: true } },
            allocations: { where: { receipt: { status: "APPROVED" } }, select: { amount: true } },
            creditNotes: { where: { status: "APPROVED" }, select: { lines: { select: { amount: true, vatAmount: true } } } },
          },
        },
        lines: { include: { invoiceLine: { select: { poLine: { select: { kind: true } } } } } },
      },
    })
    if (!note) throw new AppError(404, "Customer credit note not found")
    if (note.status !== "DRAFT") throw new AppError(409, `This credit note is already ${note.status.toLowerCase()}`)
    if (note.createdBy === actor.sub) throw new AppError(403, "You prepared this credit note and cannot also approve it")

    const gross = note.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), new Prisma.Decimal(0))
    assertWithinOutstanding(note.invoice, gross)

    const updated = await tx.customerCreditNote.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: actor.sub, approvedAt: new Date() },
      include: CREDIT_NOTE_INCLUDE,
    })

    const rules = await loadRules(tx, "CUSTOMER_CREDIT")
    await postSystemJournal(tx, {
      date: toLedgerDate(note.date),
      narration: `${note.customer.legalName}, credit note on invoice ${note.invoice.invoiceNumber}`,
      source: { module: "CUSTOMER", refId: id, event: "CREDIT_NOTE" },
      lines: buildCustomerCreditNoteLines(
        {
          id, customerId: note.customerId, opportunityId: note.invoice.po.opportunityId,
          lines: note.lines.map((l) => ({ amount: l.amount, vatAmount: l.vatAmount, kind: l.invoiceLine.poLine.kind })),
        },
        rules
      ),
      createdBy: actor.sub,
    })
    await writeAudit(tx, { entity: "CUSTOMER_CREDIT_NOTE", entityId: id, action: "APPROVE", changedBy: actor.sub })
    return updated
  })
}
