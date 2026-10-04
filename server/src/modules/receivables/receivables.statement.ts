import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { env } from "../../config/env"
import { escapeHtml, brandAsset, renderPdf } from "../../utils/pdf"
import { BRAND_DOC_CSS, brandDocHeaderHtml } from "../../utils/pdf.brand"
import { formatBdt } from "../accounting/accounting.utils"

const ZERO = new Prisma.Decimal(0)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const longDate = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

export interface StatementEntry {
  date: Date
  kind: "Invoice" | "Receipt" | "Credit note"
  reference: string
  debit: string | null
  credit: string | null
  balance: string
}

export interface CustomerStatement {
  customer: { legalName: string; billingAddress: string | null; bin: string | null }
  from: Date
  to: Date
  openingBalance: string
  entries: StatementEntry[]
  closingBalance: string
}

interface RawMovement {
  date: Date
  kind: StatementEntry["kind"]
  reference: string
  amount: Prisma.Decimal
  sign: 1 | -1
}

const KIND_ORDER: Record<StatementEntry["kind"], number> = { Invoice: 1, Receipt: 2, "Credit note": 3 }

/** A plain account statement for one customer: what they owed at the start
 *  of the period, every approved invoice, receipt and credit note in it,
 *  and what they owe at the end. Not a tax document — see spec §4. */
export async function getCustomerStatement(customerId: string, range: { from: Date; to: Date }): Promise<CustomerStatement> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { legalName: true, billingAddress: true, bin: true },
  })
  if (!customer) throw new AppError(404, "Customer not found")

  const [invoices, receipts, creditNotes] = await Promise.all([
    prisma.invoice.findMany({
      where: { customerId, status: "APPROVED", date: { lte: range.to } },
      select: { invoiceNumber: true, date: true, lines: { select: { amount: true, vatAmount: true } } },
    }),
    prisma.receipt.findMany({
      where: { customerId, status: "APPROVED", date: { lte: range.to } },
      select: { reference: true, date: true, amount: true, vdsAmount: true, aitAmount: true },
    }),
    prisma.customerCreditNote.findMany({
      where: { customerId, status: "APPROVED", date: { lte: range.to } },
      select: { date: true, invoice: { select: { invoiceNumber: true } }, lines: { select: { amount: true, vatAmount: true } } },
    }),
  ])

  const movements: RawMovement[] = []
  for (const inv of invoices) {
    const gross = inv.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)
    movements.push({ date: inv.date, kind: "Invoice", reference: inv.invoiceNumber, amount: gross, sign: 1 })
  }
  for (const r of receipts) {
    const settled = new Prisma.Decimal(r.amount).plus(r.vdsAmount).plus(r.aitAmount)
    movements.push({ date: r.date, kind: "Receipt", reference: `Receipt ${r.reference ?? formatShortIso(r.date)}`, amount: settled, sign: -1 })
  }
  for (const cn of creditNotes) {
    const gross = cn.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)
    movements.push({ date: cn.date, kind: "Credit note", reference: `Credit note on ${cn.invoice.invoiceNumber}`, amount: gross, sign: -1 })
  }

  // Sorted once, so a single pass can tell "before the range" from "in it"
  // without ever re-summing what came before.
  movements.sort((a, b) => a.date.getTime() - b.date.getTime() || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  let balance = ZERO
  let openingBalance = ZERO
  const entries: StatementEntry[] = []
  for (const m of movements) {
    balance = balance.plus(m.amount.times(m.sign))
    if (m.date.getTime() < range.from.getTime()) {
      openingBalance = balance
      continue
    }
    entries.push({
      date: m.date, kind: m.kind, reference: m.reference,
      debit: m.sign === 1 ? m.amount.toFixed(2) : null,
      credit: m.sign === -1 ? m.amount.toFixed(2) : null,
      balance: balance.toFixed(2),
    })
  }

  return {
    customer: { legalName: customer.legalName, billingAddress: customer.billingAddress, bin: customer.bin },
    from: range.from, to: range.to,
    openingBalance: openingBalance.toFixed(2),
    entries,
    closingBalance: entries.length > 0 ? entries[entries.length - 1].balance : openingBalance.toFixed(2),
  }
}

function formatShortIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function buildCustomerStatementHtml(s: CustomerStatement, company: { name: string; address: string; logo: string | null }): string {
  const rows = s.entries.length
    ? s.entries.map((e) => `
        <tr>
          <td>${escapeHtml(longDate(e.date))}</td>
          <td>${escapeHtml(e.kind)}</td>
          <td>${escapeHtml(e.reference)}</td>
          <td class="num">${e.debit ? formatBdt(new Prisma.Decimal(e.debit)) : "—"}</td>
          <td class="num">${e.credit ? formatBdt(new Prisma.Decimal(e.credit)) : "—"}</td>
          <td class="num">${formatBdt(new Prisma.Decimal(e.balance))}</td>
        </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No invoices, receipts or credit notes in this period.</td></tr>`

  return `
    <title>Statement</title>
    <style>
      body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 10px; color: #17191C; margin: 0; padding: 16px; }
      ${BRAND_DOC_CSS}
      .muted { color: #17191C; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; background: #17191C; color: #FFFFFF; padding: 6px 4px; }
      td { padding: 6px 4px; border-bottom: 1px solid #f4f4f5; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      td.empty { text-align: center; color: #17191C; padding: 20px 0; }
      tfoot td { font-weight: 600; border-top: 2px solid #17191C; border-bottom: none; }
    </style>
    ${brandDocHeaderHtml({
      logo: company.logo,
      company: company.name,
      title: "Customer statement",
      lines: [`${longDate(s.from)} to ${longDate(s.to)}`, [company.name, company.address].filter(Boolean).join(", ")],
    })}
    <h2>${escapeHtml(s.customer.legalName)}</h2>
    ${s.customer.billingAddress ? `<div class="muted">${escapeHtml(s.customer.billingAddress)}</div>` : ""}
    ${s.customer.bin ? `<div class="muted">BIN: ${escapeHtml(s.customer.bin)}</div>` : ""}
    <div style="height: 12px"></div>
    <table>
      <thead>
        <tr><th>Date</th><th>Type</th><th>Reference</th><th class="num">Owed</th><th class="num">Paid</th><th class="num">Balance</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="5">Opening balance</td><td class="num">${formatBdt(new Prisma.Decimal(s.openingBalance))}</td></tr>
        ${rows}
      </tbody>
      <tfoot>
        <tr><td colspan="5">Closing balance</td><td class="num">${formatBdt(new Prisma.Decimal(s.closingBalance))}</td></tr>
      </tfoot>
    </table>
  `
}

export async function renderCustomerStatementPdf(customerId: string, range: { from: Date; to: Date }): Promise<Buffer> {
  const statement = await getCustomerStatement(customerId, range)
  const html = buildCustomerStatementHtml(statement, {
    name: env.COMPANY_NAME,
    address: env.COMPANY_ADDRESS,
    logo: await brandAsset("logo"),
  })
  return renderPdf(html, { format: "A4", printBackground: true })
}
