/**
 * Per-currency bank file export.
 *
 * A BEFTN file is submitted as a batch, so a file with three malformed
 * beneficiaries is rejected *as a file*. Emitting one is worse than useless,
 * because it looks like success — hence validate-then-emit, never partially.
 *
 * The dangerous failure here is silence. A single file filtered to BDT
 * produces a complete-looking export that omits every USD-paid employee, and
 * nothing downstream notices until somebody is not paid. So every response
 * carries a manifest naming what was excluded, and the summary asserts that
 * row counts across all currencies equal the run's payslip count.
 */

import prisma from "../../config/prisma"
import type { Currency } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { csvCell } from "../../utils/csv"
import { dec, type Money, REPORTING_CURRENCY, sum, toMoneyString } from "./payroll.money"

export interface BankFileRow {
  employeeCode: string
  beneficiaryName: string
  bankName: string
  bankAccountNumber: string
  bankRoutingNumber: string
  amount: string
  currency: Currency
  amountBdt: string
  payslipNo: string
}

export interface BankFileManifest {
  runId: string
  month: number
  year: number
  currency: Currency
  rows: number
  totalNative: string
  totalBdt: string
  /** Every other currency in the run, so nobody is silently dropped. */
  excluded: Array<{ currency: Currency; rows: number }>
}

export interface BankFileResult {
  manifest: BankFileManifest
  rows: BankFileRow[]
  csv: string
}

export interface BankFileSummary {
  runId: string
  month: number
  year: number
  payslipCount: number
  /** Must equal payslipCount, or somebody would not be paid. */
  totalRows: number
  complete: boolean
  currencies: Array<{ currency: Currency; rows: number; totalNative: string; totalBdt: string }>
}

/**
 * Re-exported rather than defined here: the implementation moved to
 * `utils/csv.ts` when the attendance reports needed the same quoting. This
 * module's tests address it here, and a bank file is the last place to want a
 * second opinion on how a comma is escaped.
 */
export { csvCell }

const CSV_HEADERS = [
  "EmployeeCode",
  "BeneficiaryName",
  "BankName",
  "AccountNumber",
  "RoutingNumber",
  "Amount",
  "Currency",
  "AmountBDT",
  "PayslipNo",
]

export function toCsv(rows: BankFileRow[]): string {
  const lines = [CSV_HEADERS.join(",")]
  for (const row of rows) {
    lines.push(
      [
        row.employeeCode,
        row.beneficiaryName,
        row.bankName,
        row.bankAccountNumber,
        row.bankRoutingNumber,
        row.amount,
        row.currency,
        row.amountBdt,
        row.payslipNo,
      ]
        .map(csvCell)
        .join(",")
    )
  }
  return lines.join("\r\n")
}

async function loadRunForExport(runId: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      payslips: {
        include: {
          employee: {
            select: {
              fullName: true,
              employeeCode: true,
              bankName: true,
              bankAccountNumber: true,
              bankRoutingNumber: true,
            },
          },
        },
        orderBy: { employee: { fullName: "asc" } },
      },
    },
  })
  if (!run) throw new AppError(404, "Payroll run not found")

  // A draft run's bank file is a file somebody will pay from by accident.
  if (run.status !== "APPROVED" && run.status !== "DISBURSED") {
    throw new AppError(
      409,
      `This run is ${run.status.toLowerCase()}. A bank file can only be exported once the run is approved.`
    )
  }
  return run
}

export async function buildBankFile(runId: string, currency: Currency): Promise<BankFileResult> {
  const run = await loadRunForExport(runId)

  const forCurrency = run.payslips.filter((p) => p.currency === currency)

  // Validate the whole batch before emitting any of it.
  const incomplete = forCurrency.filter(
    (p) =>
      !p.employee.bankAccountNumber?.trim() ||
      !p.employee.bankName?.trim() ||
      !p.employee.bankRoutingNumber?.trim()
  )
  if (incomplete.length > 0) {
    throw new AppError(
      409,
      `${incomplete.length} employee(s) are missing bank details, so no file was produced — the bank rejects a batch as a whole.`,
      {
        missingBankDetails: incomplete.map((p) => ({
          employeeCode: p.employee.employeeCode,
          fullName: p.employee.fullName,
          missing: [
            !p.employee.bankName?.trim() && "bankName",
            !p.employee.bankAccountNumber?.trim() && "bankAccountNumber",
            !p.employee.bankRoutingNumber?.trim() && "bankRoutingNumber",
          ].filter(Boolean),
        })),
      }
    )
  }

  const rows: BankFileRow[] = forCurrency.map((p) => ({
    employeeCode: p.employee.employeeCode,
    beneficiaryName: p.employee.fullName,
    bankName: p.employee.bankName!,
    bankAccountNumber: p.employee.bankAccountNumber!,
    bankRoutingNumber: p.employee.bankRoutingNumber!,
    amount: toMoneyString(p.netPayable),
    currency: p.currency,
    amountBdt: toMoneyString(p.netPayableBdt),
    payslipNo: p.payslipNo,
  }))

  const totalNative: Money = sum(forCurrency.map((p) => dec(p.netPayable)))
  const totalBdt: Money = sum(forCurrency.map((p) => dec(p.netPayableBdt)))

  const excludedCounts = new Map<Currency, number>()
  for (const p of run.payslips) {
    if (p.currency === currency) continue
    excludedCounts.set(p.currency, (excludedCounts.get(p.currency) ?? 0) + 1)
  }

  return {
    manifest: {
      runId: run.id,
      month: run.month,
      year: run.year,
      currency,
      rows: rows.length,
      totalNative: toMoneyString(totalNative),
      totalBdt: toMoneyString(totalBdt),
      excluded: [...excludedCounts.entries()].map(([c, n]) => ({ currency: c, rows: n })),
    },
    rows,
    csv: toCsv(rows),
  }
}

/**
 * The row-count identity across currencies — the assertion this whole design
 * exists for. If `complete` is false, some payslip belongs to no file and
 * that person does not get paid.
 */
export async function bankFileSummary(runId: string): Promise<BankFileSummary> {
  const run = await loadRunForExport(runId)

  const byCurrency = new Map<Currency, { rows: number; native: Money[]; bdt: Money[] }>()
  for (const p of run.payslips) {
    const entry = byCurrency.get(p.currency) ?? { rows: 0, native: [], bdt: [] }
    entry.rows += 1
    entry.native.push(dec(p.netPayable))
    entry.bdt.push(dec(p.netPayableBdt))
    byCurrency.set(p.currency, entry)
  }

  const currencies = [...byCurrency.entries()].map(([currency, entry]) => ({
    currency,
    rows: entry.rows,
    totalNative: toMoneyString(sum(entry.native)),
    totalBdt: toMoneyString(sum(entry.bdt)),
  }))
  const totalRows = currencies.reduce((n, c) => n + c.rows, 0)

  return {
    runId: run.id,
    month: run.month,
    year: run.year,
    payslipCount: run.payslips.length,
    totalRows,
    complete: totalRows === run.payslips.length,
    currencies,
  }
}

/** BEFTN is domestic and BDT-only; a USD payout cannot travel in it. */
export const isDomesticBeftn = (currency: Currency) => currency === REPORTING_CURRENCY
