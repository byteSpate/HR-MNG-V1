import type { NextFunction, Request, Response } from "express"

import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"
import { listSalaryStructures } from "./payroll.service"

/**
 * One text cell for the components, not one column each: kinds and calc rules
 * differ between structures, so a shared column would mix a percent and an
 * amount under one heading.
 */
function componentsText(
  components: Array<{ label: string; kind: string; calc: string; value: { toString(): string } }>
): string {
  return components
    .map((c) => `${c.label}: ${Number(c.value.toString())} (${c.kind}, ${c.calc})`)
    .join("; ")
}

export async function buildSalaryStructureExportSpec(): Promise<ExportSpec> {
  const structures = await listSalaryStructures()
  return {
    title: "Salary structures",
    columns: [
      { header: "name", pdfHeader: "Structure", type: "text", inPdf: true },
      { header: "currency", pdfHeader: "Currency", type: "text", inPdf: true },
      { header: "basic", pdfHeader: "Basic pay", type: "decimal", inPdf: true },
      { header: "isActive", pdfHeader: "Active", type: "boolean", inPdf: true },
      { header: "employeeCount", pdfHeader: "Employees", type: "integer", inPdf: true },
      { header: "components", pdfHeader: "Components", type: "text" },
    ],
    rows: structures.map((s) => [
      s.name,
      s.currency,
      Number(s.basic.toString()),
      s.isActive,
      s.employeeCount,
      componentsText(s.components),
    ]),
  }
}

export async function exportSalaryStructuresHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    await sendExport({
      res,
      spec: await buildSalaryStructureExportSpec(),
      format,
      baseName: "salary-structures",
      actor: req.user!,
      list: "SALARY_STRUCTURES",
    })
  } catch (err) {
    next(err)
  }
}
