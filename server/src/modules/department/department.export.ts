import type { NextFunction, Request, Response } from "express"

import prisma from "../../config/prisma"
import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"

export async function buildDepartmentExportSpec(): Promise<ExportSpec> {
  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { name: true, costNature: true, _count: { select: { employees: true } } },
  })
  return {
    title: "Departments",
    columns: [
      { header: "name", pdfHeader: "Department", type: "text", inPdf: true },
      { header: "costNature", pdfHeader: "Cost type", type: "text", inPdf: true },
      { header: "employees", pdfHeader: "Employees", type: "integer", inPdf: true },
    ],
    rows: departments.map((d) => [d.name, d.costNature, d._count.employees]),
  }
}

export async function exportDepartmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    await sendExport({
      res, spec: await buildDepartmentExportSpec(), format, baseName: "departments", actor: req.user!, list: "DEPARTMENTS",
    })
  } catch (err) {
    next(err)
  }
}
