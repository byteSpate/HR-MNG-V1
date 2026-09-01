import prisma from "../../config/prisma"
import { Prisma } from "../../generated/prisma/client"
import { MS_PER_DAY } from "../../utils/dates"

export interface OutstandingExpenseReimbursementRow {
  id: string
  employee: { id: string; fullName: string; employeeCode: string }
  name: string | null
  category: { code: string; name: string }
  approvedAt: string | null
  ageDays: number | null
  amount: string
  currency: string
}

export interface OutstandingExpenseReimbursements {
  rows: OutstandingExpenseReimbursementRow[]
  totals: {
    claims: number
    byCurrency: { currency: string; claims: number; amount: string }[]
  }
}

/**
 * Claims Finance approved but which neither payroll nor a settlement has
 * picked up yet. These are obligations, not a date-range report: every open
 * item belongs here until one of the two reimbursement paths links it.
 */
export async function getOutstandingExpenseReimbursements(
  now = new Date()
): Promise<OutstandingExpenseReimbursements> {
  const claims = await prisma.expenseClaim.findMany({
    where: { status: "APPROVED", payslipId: null, settlementId: null },
    select: {
      id: true,
      name: true,
      reviewedAt: true,
      amount: true,
      currency: true,
      employee: { select: { id: true, fullName: true, employeeCode: true } },
      category: { select: { code: true, name: true } },
    },
    orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
  })

  const byCurrency = new Map<string, { claims: number; amount: Prisma.Decimal }>()
  const rows = claims.map((claim) => {
    const currency = String(claim.currency)
    const current = byCurrency.get(currency)
    byCurrency.set(currency, {
      claims: (current?.claims ?? 0) + 1,
      amount: current ? current.amount.plus(claim.amount) : new Prisma.Decimal(claim.amount),
    })

    return {
      id: claim.id,
      employee: claim.employee,
      name: claim.name,
      category: claim.category,
      approvedAt: claim.reviewedAt?.toISOString() ?? null,
      ageDays: claim.reviewedAt
        ? Math.max(0, Math.floor((now.getTime() - claim.reviewedAt.getTime()) / MS_PER_DAY))
        : null,
      amount: claim.amount.toFixed(2),
      currency,
    }
  })

  return {
    rows,
    totals: {
      claims: rows.length,
      byCurrency: [...byCurrency.entries()]
        .map(([currency, total]) => ({
          currency,
          claims: total.claims,
          amount: total.amount.toFixed(2),
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    },
  }
}
