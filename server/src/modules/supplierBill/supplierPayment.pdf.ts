import { Prisma } from "../../generated/prisma/client"
import type { Currency, SupplierDocStatus, SupplierPaymentMethod } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { env } from "../../config/env"
import { AppError } from "../../middleware/errorHandler"
import { resolveActors } from "../../utils/actors"
import { brandAsset, escapeHtml, renderPdf } from "../../utils/pdf"
import { BRAND_DOC_CSS, brandDocHeaderHtml } from "../../utils/pdf.brand"
import { formatBdt } from "../accounting/accounting.utils"

const ZERO = new Prisma.Decimal(0)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const longDate = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

const METHOD_LABEL: Record<SupplierPaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  MOBILE_BANKING: "Mobile banking",
}

type Money = Prisma.Decimal

/** What the page needs, as loaded from the database. Kept plain so it can be
 *  tested without a database. */
export interface PaymentVoucherSource {
  id: string
  number: string
  date: Date
  /** Taka that left the bank. */
  amount: Money
  /** The dollar figure, only for a payment in US dollars. */
  sourceAmount: Money | null
  currency: Currency
  fxRateToBdt: Money | null
  reference: string | null
  paymentMethod: SupplierPaymentMethod | null
  bankName: string | null
  status: SupplierDocStatus
  reversedAt: Date | null
  reversalReason: string | null
  supplier: { name: string }
  opportunity: { serial: string; name: string }
  /** The name of the person who recorded it, when that account still exists. */
  recordedBy: string | null
  allocations: Array<{
    /** Taka cleared against the bill, at the bill's own rate. */
    amount: Money
    amountUsd: Money | null
    /** Saved with the payment. They never change, so this page always matches. */
    billTotal: Money
    balanceAfter: Money
    billTotalUsd: Money | null
    balanceAfterUsd: Money | null
    bill: { billNumber: string; currency: Currency }
  }>
}

export interface PaymentVoucherData {
  number: string
  date: Date
  supplierName: string
  opportunityLabel: string
  /** The currency of the figures in the bills table. */
  currency: Currency
  /** Taka that left the bank. */
  paidFromBank: string
  /** Set only for a payment in US dollars. */
  usd: { paid: string; rate: string } | null
  methodLabel: string
  bankName: string | null
  reference: string | null
  recordedBy: string | null
  reversed: { on: string; reason: string } | null
  bills: Array<{ billNumber: string; billTotal: string; thisPayment: string; balanceAfter: string }>
}

export function buildPaymentVoucherData(src: PaymentVoucherSource): PaymentVoucherData {
  const dollars = src.currency === "USD"
  const bills = src.allocations.map((a) => ({
    billNumber: a.bill.billNumber,
    billTotal: (dollars ? (a.billTotalUsd ?? ZERO) : a.billTotal).toFixed(2),
    thisPayment: (dollars ? (a.amountUsd ?? ZERO) : a.amount).toFixed(2),
    balanceAfter: (dollars ? (a.balanceAfterUsd ?? ZERO) : a.balanceAfter).toFixed(2),
  }))

  return {
    number: src.number,
    date: src.date,
    supplierName: src.supplier.name,
    opportunityLabel: `${src.opportunity.serial} ${src.opportunity.name}`,
    currency: src.currency,
    paidFromBank: src.amount.toFixed(2),
    usd: dollars && src.sourceAmount && src.fxRateToBdt ? { paid: src.sourceAmount.toFixed(2), rate: src.fxRateToBdt.toFixed(6) } : null,
    methodLabel: src.paymentMethod ? METHOD_LABEL[src.paymentMethod] : "Not recorded",
    bankName: src.bankName,
    reference: src.reference,
    recordedBy: src.recordedBy,
    reversed:
      src.status === "REVERSED"
        ? { on: src.reversedAt ? longDate(src.reversedAt) : "", reason: src.reversalReason ?? "" }
        : null,
    bills,
  }
}

const money = (value: string) => formatBdt(new Prisma.Decimal(value))
const esc = escapeHtml

export function buildPaymentVoucherHtml(data: PaymentVoucherData, company: { name: string; address: string; logo: string | null }): string {
  const rows = data.bills
    .map(
      (b) => `
        <tr>
          <td>${esc(b.billNumber)}</td>
          <td class="num">${money(b.billTotal)}</td>
          <td class="num">${money(b.thisPayment)}</td>
          <td class="num">${money(b.balanceAfter)}</td>
        </tr>`
    )
    .join("")
  const totalPaid = data.bills.reduce((sum, b) => sum.plus(b.thisPayment), ZERO).toFixed(2)

  const detail = (label: string, value: string) => `<tr><td class="k">${esc(label)}</td><td>${esc(value)}</td></tr>`
  const details = [
    data.usd ? detail("Paid", `USD ${money(data.usd.paid)}`) : "",
    data.usd ? detail("Rate on the payment date", Number(data.usd.rate).toFixed(2)) : "",
    detail("Paid from the bank (BDT)", money(data.paidFromBank)),
    detail("Paid by", data.methodLabel),
    data.bankName ? detail("Bank name", data.bankName) : "",
    data.reference ? detail("Reference", data.reference) : "",
    data.recordedBy ? detail("Recorded by", data.recordedBy) : "",
  ].join("")

  return `
    <title>Payment Voucher ${esc(data.number)}</title>
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
      title: "Payment Voucher",
      lines: [`Voucher ${data.number}`, [company.name, company.address].filter(Boolean).join(", ")],
      stamp: longDate(data.date),
    })}
    ${data.reversed ? `<div class="reversed">REVERSED on ${esc(data.reversed.on)}<span>Reason: ${esc(data.reversed.reason)}</span></div>` : ""}
    <h2>Paid to</h2>
    <div>${esc(data.supplierName)}</div>
    <div class="muted">Opportunity: ${esc(data.opportunityLabel)}</div>
    <div style="height: 12px"></div>
    <table>${details}</table>
    <div style="height: 14px"></div>
    <h2>Paid against</h2>
    <table>
      <thead>
        <tr><th>Supplier's bill number</th><th class="num">Bill total</th><th class="num">This payment</th><th class="num">Balance after this payment</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="2">Total paid against bills</td><td class="num">${money(totalPaid)}</td><td></td></tr>
      </tfoot>
    </table>
    <div class="note muted">All amounts are in ${esc(data.currency)}.${data.currency === "USD" ? " The amount from the bank is in BDT." : ""}</div>
  `
}

/**
 * The PDF for one supplier payment. The route lets only Finance and Super
 * Admin in, because supplier money is cost, which Sales never sees.
 */
export async function renderSupplierPaymentPdf(id: string): Promise<{ pdf: Buffer; number: string }> {
  const payment = await prisma.supplierPayment.findUnique({
    where: { id },
    select: {
      id: true, number: true, date: true, amount: true, sourceAmount: true, currency: true, fxRateToBdt: true,
      reference: true, paymentMethod: true, bankName: true, status: true, reversedAt: true, reversalReason: true,
      createdBy: true,
      supplier: { select: { name: true } },
      opportunity: { select: { serial: true, name: true } },
      allocations: {
        orderBy: { id: "asc" },
        select: {
          amount: true, amountUsd: true, billTotal: true, balanceAfter: true, billTotalUsd: true, balanceAfterUsd: true,
          bill: { select: { billNumber: true, currency: true } },
        },
      },
    },
  })
  if (!payment) throw new AppError(404, "Supplier payment not found")

  const actors = await resolveActors([payment.createdBy])
  const who = actors[payment.createdBy]
  const data = buildPaymentVoucherData({ ...payment, recordedBy: who ? who.fullName ?? who.email : null })

  const html = buildPaymentVoucherHtml(data, {
    name: env.COMPANY_NAME,
    address: env.COMPANY_ADDRESS,
    logo: await brandAsset("logo"),
  })
  return { pdf: await renderPdf(html, { format: "A4", printBackground: true }), number: payment.number }
}
