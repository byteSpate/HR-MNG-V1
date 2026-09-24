import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"

const DAY_MS = 24 * 60 * 60 * 1000
const ZERO = new Prisma.Decimal(0)

export type AgeingBucket = "Not due" | "1-30" | "31-60" | "61-90" | "Over 90"

interface BillForOutstanding {
  lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal }>
  allocations: Array<{ amount: Prisma.Decimal }>
  creditNotes: Array<{ lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal }> }>
}

/** Gross of the bill, less what posted payments cleared, less what posted
 *  credit notes reduced. The caller must pass only approved payments'
 *  allocations and approved credit notes: a draft has not touched 2111, so
 *  counting it would make this disagree with the ledger. */
export function getBillOutstanding(bill: BillForOutstanding): Prisma.Decimal {
  const gross = bill.lines.reduce((sum, l) => sum.plus(l.amount).plus(l.vatAmount), ZERO)
  const paid = bill.allocations.reduce((sum, a) => sum.plus(a.amount), ZERO)
  const credited = bill.creditNotes.reduce(
    (sum, note) => sum.plus(note.lines.reduce((s, l) => s.plus(l.amount).plus(l.vatAmount), ZERO)),
    ZERO
  )
  return gross.minus(paid).minus(credited)
}

function bucketFor(daysPastDue: number): AgeingBucket {
  if (daysPastDue <= 0) return "Not due"
  if (daysPastDue <= 30) return "1-30"
  if (daysPastDue <= 60) return "31-60"
  if (daysPastDue <= 90) return "61-90"
  return "Over 90"
}

export interface AgeingRow {
  billId: string
  label: string
  supplierId: string
  supplierName: string
  dueDate: Date
  outstanding: string
  bucket: AgeingBucket
}

export async function getSupplierAgeing(asOf: Date = new Date()): Promise<AgeingRow[]> {
  const bills = await prisma.supplierBill.findMany({
    where: { status: "APPROVED" },
    select: {
      id: true, supplierId: true, dueDate: true, billNumber: true,
      supplier: { select: { name: true } },
      lines: { select: { amount: true, vatAmount: true } },
      allocations: { where: { payment: { status: "APPROVED" } }, select: { amount: true } },
      creditNotes: {
        where: { status: "APPROVED" },
        select: { lines: { select: { amount: true, vatAmount: true } } },
      },
    },
    orderBy: { dueDate: "asc" },
  })

  const rows: AgeingRow[] = []
  for (const bill of bills) {
    const outstanding = getBillOutstanding(bill)
    if (outstanding.lessThanOrEqualTo(0)) continue

    const daysPastDue = Math.floor((asOf.getTime() - bill.dueDate.getTime()) / DAY_MS)
    rows.push({
      billId: bill.id,
      label: `Bill ${bill.billNumber}`,
      supplierId: bill.supplierId,
      supplierName: bill.supplier.name,
      dueDate: bill.dueDate,
      outstanding: outstanding.toFixed(2),
      bucket: bucketFor(daysPastDue),
    })
  }

  rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
  return rows
}

export interface ControlTieOut {
  subledgerTotal: string
  glBalance: string
  ties: boolean
}

/** design §4: sum of supplier balances must equal account 2111. A mismatch
 *  is a bug, and the client shows it loudly rather than softening it. */
export async function getSupplierControlTieOut(): Promise<ControlTieOut> {
  const ageing = await getSupplierAgeing()
  const subledgerTotal = ageing.reduce((sum, row) => sum.plus(row.outstanding), ZERO)

  const account = await prisma.account.findUniqueOrThrow({ where: { code: "2111" }, select: { id: true } })
  const agg = await prisma.journalLine.aggregate({
    where: { accountId: account.id, journal: { status: { in: ["POSTED", "REVERSED"] } } },
    _sum: { debit: true, credit: true },
  })
  // A liability's normal balance is a credit, so the GL figure is credit
  // minus debit.
  const glBalance = (agg._sum.credit ?? ZERO).minus(agg._sum.debit ?? ZERO)

  return {
    subledgerTotal: subledgerTotal.toFixed(2),
    glBalance: glBalance.toFixed(2),
    ties: subledgerTotal.equals(glBalance),
  }
}
