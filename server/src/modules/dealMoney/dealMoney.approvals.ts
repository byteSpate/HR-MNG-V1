import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import type { ApprovalKind } from "./dealMoney.sendBack"

const ZERO = new Prisma.Decimal(0)

export interface WaitingForApprovalRow {
  kind: ApprovalKind
  id: string
  number: string
  dealId: string
  dealSerial: string
  party: string
  amount: string
  preparedBy: string
  preparedAt: string
  /**
   * The VAT rates a person typed by hand on this draft's lines, 2 decimals,
   * lowest first, no repeats. Empty when every line used a VAT code
   * (spec 2026-09-28 §1.6). The approver needs to see these: they are the
   * only VAT on the document that no Settings value explains.
   */
  typedVatRates: string[]
}

function grossOf(lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal }>): string {
  return lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO).toFixed(2)
}

/** The distinct typed rates on a set of lines, so the approver can see them. */
function typedRatesOf(lines: Array<{ vatMethod?: string; vatRatePercent?: Prisma.Decimal | null }>): string[] {
  const rates = lines
    .filter((l) => l.vatMethod === "MANUAL" && l.vatRatePercent != null)
    .map((l) => new Prisma.Decimal(l.vatRatePercent!).toFixed(2))
  return [...new Set(rates)].sort((a, b) => Number(a) - Number(b))
}

interface Draft {
  kind: ApprovalKind
  id: string
  number: string
  dealId: string
  dealSerial: string
  party: string
  amount: string
  createdBy: string
  createdAt: Date
  typedVatRates: string[]
}

/**
 * Every DRAFT invoice, supplier bill and credit note with no rejection
 * note (Task 8: a sent-back draft is off this list until the person who
 * prepared it saves it again), oldest first — that is the order the
 * person clearing the queue should work through them in.
 */
export async function listWaitingForApproval(): Promise<WaitingForApprovalRow[]> {
  const [invoices, bills, customerCreditNotes, supplierCreditNotes] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: "DRAFT", rejectionNote: null },
      select: {
        id: true, invoiceNumber: true, createdBy: true, createdAt: true,
        customer: { select: { legalName: true } },
        lines: { select: { amount: true, vatAmount: true, vatMethod: true, vatRatePercent: true } },
        po: { select: { opportunity: { select: { id: true, serial: true } } } },
      },
    }),
    prisma.supplierBill.findMany({
      where: { status: "DRAFT", rejectionNote: null },
      select: {
        id: true, billNumber: true, createdBy: true, createdAt: true,
        supplier: { select: { name: true } },
        lines: { select: { amount: true, vatAmount: true, vatMethod: true, vatRatePercent: true } },
        opportunity: { select: { id: true, serial: true } },
      },
    }),
    prisma.customerCreditNote.findMany({
      where: { status: "DRAFT", rejectionNote: null },
      select: {
        id: true, createdBy: true, createdAt: true,
        customer: { select: { legalName: true } },
        lines: { select: { amount: true, vatAmount: true } },
        invoice: { select: { invoiceNumber: true, po: { select: { opportunity: { select: { id: true, serial: true } } } } } },
      },
    }),
    prisma.supplierCreditNote.findMany({
      where: { status: "DRAFT", rejectionNote: null },
      select: {
        id: true, createdBy: true, createdAt: true,
        supplier: { select: { name: true } },
        lines: { select: { amount: true, vatAmount: true } },
        bill: { select: { billNumber: true, opportunity: { select: { id: true, serial: true } } } },
      },
    }),
  ])

  const drafts: Draft[] = [
    ...invoices.map((i): Draft => ({
      kind: "INVOICE", id: i.id, number: i.invoiceNumber,
      dealId: i.po.opportunity.id, dealSerial: i.po.opportunity.serial,
      party: i.customer.legalName, amount: grossOf(i.lines),
      createdBy: i.createdBy, createdAt: i.createdAt, typedVatRates: typedRatesOf(i.lines),
    })),
    ...bills.map((b): Draft => ({
      kind: "SUPPLIER_BILL", id: b.id, number: b.billNumber,
      dealId: b.opportunity.id, dealSerial: b.opportunity.serial,
      party: b.supplier.name, amount: grossOf(b.lines),
      createdBy: b.createdBy, createdAt: b.createdAt, typedVatRates: typedRatesOf(b.lines),
    })),
    ...customerCreditNotes.map((cn): Draft => ({
      kind: "CUSTOMER_CREDIT_NOTE", id: cn.id, number: `Credit note on ${cn.invoice.invoiceNumber}`,
      dealId: cn.invoice.po.opportunity.id, dealSerial: cn.invoice.po.opportunity.serial,
      party: cn.customer.legalName, amount: grossOf(cn.lines),
      createdBy: cn.createdBy, createdAt: cn.createdAt, typedVatRates: [],
    })),
    ...supplierCreditNotes.map((cn): Draft => ({
      kind: "SUPPLIER_CREDIT_NOTE", id: cn.id, number: `Credit note on ${cn.bill.billNumber}`,
      dealId: cn.bill.opportunity.id, dealSerial: cn.bill.opportunity.serial,
      party: cn.supplier.name, amount: grossOf(cn.lines),
      createdBy: cn.createdBy, createdAt: cn.createdAt, typedVatRates: [],
    })),
  ]

  const userIds = [...new Set(drafts.map((d) => d.createdBy))]
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
      })
    : []
  const nameById = new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))

  return drafts
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((d) => ({
      kind: d.kind, id: d.id, number: d.number, dealId: d.dealId, dealSerial: d.dealSerial,
      party: d.party, amount: d.amount,
      preparedBy: nameById.get(d.createdBy) ?? "Unknown",
      preparedAt: d.createdAt.toISOString(),
      typedVatRates: d.typedVatRates,
    }))
}

/**
 * The same count as `listWaitingForApproval().length`, without loading
 * lines, party names or preparer names — a dashboard card and nav badge
 * only need the number. Four `count` calls instead of four `findMany`
 * calls plus a user lookup.
 */
export async function countWaitingForApproval(): Promise<number> {
  const [invoices, bills, customerCreditNotes, supplierCreditNotes] = await Promise.all([
    prisma.invoice.count({ where: { status: "DRAFT", rejectionNote: null } }),
    prisma.supplierBill.count({ where: { status: "DRAFT", rejectionNote: null } }),
    prisma.customerCreditNote.count({ where: { status: "DRAFT", rejectionNote: null } }),
    prisma.supplierCreditNote.count({ where: { status: "DRAFT", rejectionNote: null } }),
  ])
  return invoices + bills + customerCreditNotes + supplierCreditNotes
}
