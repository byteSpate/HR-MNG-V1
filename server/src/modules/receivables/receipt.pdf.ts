import { Prisma } from "../../generated/prisma/client"
import type { ReceiptPaymentMethod, ReceivableDocStatus } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { env } from "../../config/env"
import { AppError } from "../../middleware/errorHandler"
import type { AccessTokenPayload } from "../auth/auth.types"
import { resolveActors } from "../../utils/actors"
import { brandAsset, escapeHtml, renderPdf } from "../../utils/pdf"
import { BRAND_DOC_CSS, brandDocHeaderHtml } from "../../utils/pdf.brand"
import { formatBdt } from "../accounting/accounting.utils"
import { assertDealAccess } from "./receivables.access"

const ZERO = new Prisma.Decimal(0)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const longDate = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

const METHOD_LABEL: Record<ReceiptPaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  MOBILE_BANKING: "Mobile banking",
}

type Money = Prisma.Decimal
type Lines = Array<{ amount: Money; vatAmount: Money }>

/** What the page needs, as loaded from the database. Kept plain so the
 *  balance rule can be tested without a database. */
export interface ReceiptPdfSource {
  id: string
  number: string
  date: Date
  /** When the receipt was saved. The order of payments follows this, not `date`. */
  createdAt: Date
  amount: Money
  vdsAmount: Money
  aitAmount: Money
  reference: string | null
  paymentMethod: ReceiptPaymentMethod | null
  bankName: string | null
  status: ReceivableDocStatus
  reversedAt: Date | null
  reversalReason: string | null
  customer: { legalName: string }
  opportunity: { serial: string; name: string }
  /** The name of the person who recorded it, when that account still exists. */
  recordedBy: string | null
  allocations: Array<{
    /** Gross: cash plus the share of tax the customer kept back. */
    amount: Money
    invoice: {
      invoiceNumber: string
      lines: Lines
      /** Approved credit notes only. */
      creditNotes: Array<{ approvedAt: Date | null; lines: Lines }>
      /** Every payment on this invoice, from every receipt. */
      allocations: Array<{ amount: Money; receipt: { id: string; createdAt: Date; status: ReceivableDocStatus } }>
    }
  }>
}

export interface ReceiptPdfData {
  number: string
  date: Date
  customerName: string
  opportunityLabel: string
  cash: string
  vds: string
  ait: string
  methodLabel: string
  bankName: string | null
  reference: string | null
  recordedBy: string | null
  /** Set only for a reversed receipt. The number and the amounts stay. */
  reversed: { on: string; reason: string } | null
  invoices: Array<{
    invoiceNumber: string
    invoiceTotal: string
    thisPayment: string
    /** Null on a reversed receipt, because that payment did not count. */
    balanceAfter: string | null
  }>
}

const grossOf = (lines: Lines): Money => lines.reduce((sum, l) => sum.plus(l.amount).plus(l.vatAmount), ZERO)

/** A payment counts toward this receipt's balance when it was saved before it,
 *  or at the same moment with an id that sorts first. Same order every time. */
function savedAtOrBefore(other: { createdAt: Date; id: string }, me: { createdAt: Date; id: string }): boolean {
  const a = other.createdAt.getTime()
  const b = me.createdAt.getTime()
  return a < b || (a === b && other.id <= me.id)
}

export function buildReceiptPdfData(src: ReceiptPdfSource): ReceiptPdfData {
  const reversed = src.status === "REVERSED"

  const invoices = src.allocations.map(({ amount, invoice }) => {
    const credited = invoice.creditNotes
      .filter((note) => note.approvedAt !== null && note.approvedAt.getTime() <= src.createdAt.getTime())
      .reduce((sum, note) => sum.plus(grossOf(note.lines)), ZERO)
    const total = grossOf(invoice.lines).minus(credited)
    const paidUpToHere = invoice.allocations
      .filter((a) => a.receipt.status === "APPROVED" && savedAtOrBefore(a.receipt, src))
      .reduce((sum, a) => sum.plus(a.amount), ZERO)

    return {
      invoiceNumber: invoice.invoiceNumber,
      invoiceTotal: total.toFixed(2),
      thisPayment: amount.toFixed(2),
      balanceAfter: reversed ? null : total.minus(paidUpToHere).toFixed(2),
    }
  })

  return {
    number: src.number,
    date: src.date,
    customerName: src.customer.legalName,
    opportunityLabel: `${src.opportunity.serial} ${src.opportunity.name}`,
    cash: src.amount.toFixed(2),
    vds: src.vdsAmount.toFixed(2),
    ait: src.aitAmount.toFixed(2),
    methodLabel: src.paymentMethod ? METHOD_LABEL[src.paymentMethod] : "Not recorded",
    bankName: src.bankName,
    reference: src.reference,
    recordedBy: src.recordedBy,
    reversed: reversed ? { on: src.reversedAt ? longDate(src.reversedAt) : "", reason: src.reversalReason ?? "" } : null,
    invoices,
  }
}

const bdt = (value: string) => formatBdt(new Prisma.Decimal(value))
const esc = escapeHtml

export function buildReceiptHtml(data: ReceiptPdfData, company: { name: string; address: string; logo: string | null }): string {
  const showBalance = data.reversed === null
  const rows = data.invoices
    .map(
      (i) => `
        <tr>
          <td>${esc(i.invoiceNumber)}</td>
          <td class="num">${bdt(i.invoiceTotal)}</td>
          <td class="num">${bdt(i.thisPayment)}</td>
          ${showBalance ? `<td class="num">${bdt(i.balanceAfter ?? "0")}</td>` : ""}
        </tr>`
    )
    .join("")
  const totalPaid = data.invoices.reduce((sum, i) => sum.plus(i.thisPayment), ZERO).toFixed(2)

  const detail = (label: string, value: string) => `<tr><td class="k">${esc(label)}</td><td>${esc(value)}</td></tr>`
  const details = [
    detail("Cash received", bdt(data.cash)),
    Number(data.vds) > 0 ? detail("VAT kept back", bdt(data.vds)) : "",
    Number(data.ait) > 0 ? detail("Income tax kept back", bdt(data.ait)) : "",
    detail("Paid by", data.methodLabel),
    data.bankName ? detail("Bank name", data.bankName) : "",
    data.reference ? detail("Reference", data.reference) : "",
    data.recordedBy ? detail("Recorded by", data.recordedBy) : "",
  ].join("")

  return `
    <title>Money Receipt ${esc(data.number)}</title>
    <style>
      body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 10px; color: #17191C; margin: 0; padding: 16px; }
      ${BRAND_DOC_CSS}
      h2 { font-size: 13px; margin: 0 0 2px; }
      .muted { color: #17191C; }
      .reversed { margin: 0 0 12px; padding: 10px 12px; border: 2px solid #B42318; color: #B42318; font-size: 12px; font-weight: 700; }
      .reversed span { display: block; margin-top: 3px; font-size: 10px; font-weight: 400; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; background: #17191C; color: #FFFFFF; padding: 6px 4px; }
      td { padding: 6px 4px; border-bottom: 1px solid #f4f4f5; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.k { width: 35%; font-weight: 600; }
      tfoot td { font-weight: 600; border-top: 2px solid #17191C; border-bottom: none; }
      .note { margin-top: 10px; font-size: 9px; }
    </style>
    ${brandDocHeaderHtml({
      logo: company.logo,
      company: company.name,
      title: "Money Receipt",
      lines: [`Receipt ${data.number}`, [company.name, company.address].filter(Boolean).join(", ")],
      stamp: longDate(data.date),
    })}
    ${data.reversed ? `<div class="reversed">REVERSED on ${esc(data.reversed.on)}<span>Reason: ${esc(data.reversed.reason)}</span></div>` : ""}
    <h2>Received from</h2>
    <div>${esc(data.customerName)}</div>
    <div class="muted">Opportunity: ${esc(data.opportunityLabel)}</div>
    <div style="height: 12px"></div>
    <table>${details}</table>
    <div style="height: 14px"></div>
    <h2>Paid against</h2>
    <table>
      <thead>
        <tr>
          <th>Invoice</th><th class="num">Invoice total</th><th class="num">This payment</th>
          ${showBalance ? `<th class="num">Balance after this payment</th>` : ""}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="2">Total paid against invoices</td><td class="num">${bdt(totalPaid)}</td>${showBalance ? "<td></td>" : ""}</tr>
      </tfoot>
    </table>
    <div class="note muted">All amounts are in BDT.</div>
  `
}

/**
 * The PDF for one receipt. Finance and Super Admin reach any receipt. A Sales
 * user reaches it only through the Opportunity it belongs to, the same rule
 * the Money section uses, so the PDF can never show more than the screen.
 */
export async function renderReceiptPdf(id: string, actor: AccessTokenPayload): Promise<{ pdf: Buffer; number: string }> {
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    select: {
      id: true, number: true, date: true, createdAt: true, amount: true, vdsAmount: true, aitAmount: true,
      reference: true, paymentMethod: true, bankName: true, status: true, reversedAt: true, reversalReason: true,
      createdBy: true, opportunityId: true,
      customer: { select: { legalName: true } },
      opportunity: { select: { serial: true, name: true } },
      allocations: {
        orderBy: { createdAt: "asc" },
        select: {
          amount: true,
          invoice: {
            select: {
              invoiceNumber: true,
              lines: { select: { amount: true, vatAmount: true } },
              creditNotes: {
                where: { status: "APPROVED" },
                select: { approvedAt: true, lines: { select: { amount: true, vatAmount: true } } },
              },
              allocations: { select: { amount: true, receipt: { select: { id: true, createdAt: true, status: true } } } },
            },
          },
        },
      },
    },
  })
  if (!receipt) throw new AppError(404, "Receipt not found")

  await assertDealAccess(prisma, actor, receipt.opportunityId)

  const actors = await resolveActors([receipt.createdBy])
  const who = actors[receipt.createdBy]
  const data = buildReceiptPdfData({ ...receipt, recordedBy: who ? who.fullName ?? who.email : null })

  const html = buildReceiptHtml(data, {
    name: env.COMPANY_NAME,
    address: env.COMPANY_ADDRESS,
    logo: await brandAsset("logo"),
  })
  return { pdf: await renderPdf(html, { format: "A4", printBackground: true }), number: receipt.number }
}
