/**
 * The Employee report on the Reports page: the employee list, narrowed by
 * status and department, shown on screen and downloadable as a file.
 *
 * The rows are the same as the plain employee export, so both carry the
 * same columns. HR Admin and Super Admin only, for the same reason: the rows
 * hold private details (national id, bank account). The screen and the PDF
 * show only the main columns.
 */

import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import { parseReportFormat, sendReport, type ReportSummaryItem } from "../../utils/export/export.report"
import { buildEmployeeExportSpec } from "./employee.export"

const STATUS_LABEL = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
} as const

type Status = keyof typeof STATUS_LABEL

const TYPE_LABEL: Record<string, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  INTERN: "Intern",
}

const query = z.object({
  status: z.enum(Object.keys(STATUS_LABEL) as [Status, ...Status[]], { message: "Pick a status from the list." }).optional(),
  departmentId: z.string().min(1).optional(),
  format: z.string().optional(),
})

export async function employeeReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, departmentId, format: rawFormat } = query.parse(req.query)
    const format = parseReportFormat(rawFormat)

    const where: Prisma.EmployeeWhereInput = {
      ...(status ? { employmentStatus: status } : {}),
      ...(departmentId ? { departmentId } : {}),
    }
    const spec = await buildEmployeeExportSpec(where)

    const notes: string[] = []
    if (status) notes.push(`Status: ${STATUS_LABEL[status]}`)
    if (departmentId) {
      const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } })
      notes.push(`Department: ${department?.name ?? "not found"}`)
    }
    spec.title = "Employee report"
    spec.filterNote = notes.length > 0 ? notes.join(" · ") : "Everyone"

    const statusAt = spec.columns.findIndex((c) => c.header === "employmentStatus")
    const counts = new Map<Status, number>()
    for (const row of spec.rows) {
      const s = row[statusAt] as Status
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const summary: ReportSummaryItem[] = [
      { label: "Employees", value: String(spec.rows.length) },
      ...(Object.keys(STATUS_LABEL) as Status[])
        .filter((s) => counts.has(s))
        .map((s) => ({ label: STATUS_LABEL[s], value: String(counts.get(s)) })),
    ]

    // Only the report changes these. The plain employee export keeps the codes.
    // A report is read by people, so it shows plain words.
    const typeAt = spec.columns.findIndex((c) => c.header === "employmentType")
    for (const row of spec.rows) {
      row[statusAt] = STATUS_LABEL[row[statusAt] as Status] ?? row[statusAt]
      row[typeAt] = TYPE_LABEL[row[typeAt] as string] ?? row[typeAt]
    }

    await sendReport({
      res, spec, format, summary, baseName: "employee-report", actor: req.user!,
      list: "EMPLOYEE_REPORT", filter: { status: status ?? null, departmentId: departmentId ?? null },
    })
  } catch (err) {
    next(err)
  }
}
