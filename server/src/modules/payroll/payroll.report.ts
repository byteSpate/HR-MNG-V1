/**
 * The Payroll report on the Reports page: one row per payslip, for every
 * run in a range of months. Deleted runs are left out.
 *
 * Money stays in each payslip's own currency, and the totals are kept apart
 * by currency. "All in BDT" adds the BDT amounts frozen on each payslip at
 * the run's own rate, so it never changes when today's rate changes.
 */

import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import {
  parseReportFormat, resolveMonthRange, sendReport, type ReportSummaryItem, type YearMonth,
} from "../../utils/export/export.report"
import type { ExportSpec } from "../../utils/export/export.types"
import { monthName } from "./payroll.events"

const STATUS_LABEL = {
  DRAFT: "Draft",
  SUBMITTED: "Sent for approval",
  APPROVED: "Approved, not paid yet",
  DISBURSED: "Paid",
} as const

type Status = keyof typeof STATUS_LABEL

const query = z.object({
  from: z.string({ message: "Pick a From month." }),
  to: z.string({ message: "Pick a To month." }),
  status: z.enum(Object.keys(STATUS_LABEL) as [Status, ...Status[]], { message: "Pick a status from the list." }).optional(),
  format: z.string().optional(),
})

/** Runs whose month is inside [from, to]. A run stores month and year apart. */
export function runPeriodWhere(from: YearMonth, to: YearMonth): Prisma.PayrollRunWhereInput {
  if (from.year === to.year) return { year: from.year, month: { gte: from.month, lte: to.month } }
  return {
    OR: [
      { year: from.year, month: { gte: from.month } },
      { year: { gt: from.year, lt: to.year } },
      { year: to.year, month: { lte: to.month } },
    ],
  }
}

/** Adds in whole poisha, so a long list of decimals does not drift. */
const cents = (value: unknown) => Math.round(Number(value) * 100)
const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function payrollReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = query.parse(req.query)
    const format = parseReportFormat(q.format)
    const range = resolveMonthRange(q.from, q.to)

    const slips = await prisma.payslip.findMany({
      where: {
        payrollRun: {
          deletedAt: null,
          ...runPeriodWhere(range.from, range.to),
          ...(q.status ? { status: q.status } : {}),
        },
      },
      select: {
        payslipNo: true, currency: true, payableDays: true, lopDays: true,
        grossPay: true, totalDeductions: true, netPay: true, reimbursements: true,
        netPayable: true, netPayableBdt: true,
        payrollRun: { select: { month: true, year: true, status: true } },
        employee: { select: { employeeCode: true, fullName: true, department: { select: { name: true } } } },
      },
      orderBy: [{ payrollRun: { year: "asc" } }, { payrollRun: { month: "asc" } }, { employee: { fullName: "asc" } }],
    })

    const byCurrency = new Map<string, number>()
    let allBdt = 0
    const rows = slips.map((s) => {
      const currency = String(s.currency)
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + cents(s.netPayable))
      allBdt += cents(s.netPayableBdt)
      return [
        monthName(s.payrollRun.month, s.payrollRun.year),
        s.payslipNo,
        s.employee.employeeCode,
        s.employee.fullName,
        s.employee.department.name,
        currency,
        Number(s.payableDays),
        Number(s.lopDays),
        Number(s.grossPay),
        Number(s.totalDeductions),
        Number(s.netPay),
        Number(s.reimbursements),
        Number(s.netPayable),
        Number(s.netPayableBdt),
        STATUS_LABEL[s.payrollRun.status as Status],
      ]
    })

    const fromLabel = monthName(range.from.month, range.from.year)
    const toLabel = monthName(range.to.month, range.to.year)
    const notes = [fromLabel === toLabel ? fromLabel : `${fromLabel} to ${toLabel}`]
    if (q.status) notes.push(STATUS_LABEL[q.status])

    const spec: ExportSpec = {
      title: "Payroll report",
      filterNote: notes.join(" · "),
      columns: [
        { header: "month", pdfHeader: "Month", type: "text", inPdf: true },
        { header: "payslipNo", pdfHeader: "Payslip", type: "text" },
        { header: "employeeCode", pdfHeader: "Code", type: "text", inPdf: true },
        { header: "employee", pdfHeader: "Name", type: "text", inPdf: true },
        { header: "department", pdfHeader: "Department", type: "text" },
        { header: "currency", pdfHeader: "Currency", type: "text", inPdf: true },
        { header: "payableDays", pdfHeader: "Paid days", type: "decimal", decimals: 1 },
        { header: "unpaidDays", pdfHeader: "Unpaid days", type: "decimal", decimals: 1 },
        { header: "grossPay", pdfHeader: "Gross pay", type: "decimal", inPdf: true },
        { header: "deductions", pdfHeader: "Deductions", type: "decimal", inPdf: true },
        { header: "netPay", pdfHeader: "Net pay", type: "decimal" },
        { header: "reimbursements", pdfHeader: "Claims paid back", type: "decimal" },
        { header: "netPayable", pdfHeader: "Net payable", type: "decimal", inPdf: true },
        { header: "netPayableBdt", pdfHeader: "Net payable in BDT", type: "decimal" },
        { header: "runStatus", pdfHeader: "Run status", type: "text", inPdf: true },
      ],
      rows,
    }

    const summary: ReportSummaryItem[] = [
      { label: "Payslips", value: String(rows.length) },
      ...[...byCurrency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, c]) => ({ label: `Net payable ${currency}`, value: money(c) })),
      // One currency only: the line above already says it.
      ...(byCurrency.size > 1 ? [{ label: "All in BDT", value: money(allBdt) }] : []),
    ]

    await sendReport({
      res, spec, format, summary, baseName: "payroll-report", actor: req.user!, list: "PAYROLL_REPORT",
      filter: { from: q.from, to: q.to, status: q.status ?? null },
    })
  } catch (err) {
    next(err)
  }
}
