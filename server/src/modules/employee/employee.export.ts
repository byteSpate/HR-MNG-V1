/**
 * The employee list as a file. HR Admin and Super Admin only, so both get the
 * private columns (national id, birth date, address, bank details). The PDF
 * carries the public columns only: a printed page travels further than a file.
 */

import type { NextFunction, Request, Response } from "express"

import prisma from "../../config/prisma"
import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"

export async function buildEmployeeExportSpec(): Promise<ExportSpec> {
  const employees = await prisma.employee.findMany({
    orderBy: { fullName: "asc" },
    include: {
      department: { select: { name: true } },
      reportingManager: { select: { fullName: true } },
      shift: { select: { name: true } },
      user: { select: { email: true } },
    },
  })
  return {
    title: "Employees",
    columns: [
      { header: "employeeCode", pdfHeader: "Code", type: "text", inPdf: true },
      { header: "fullName", pdfHeader: "Name", type: "text", inPdf: true },
      { header: "designation", pdfHeader: "Designation", type: "text", inPdf: true },
      { header: "department", pdfHeader: "Department", type: "text", inPdf: true },
      { header: "reportingManager", pdfHeader: "Manager", type: "text", inPdf: true },
      { header: "employmentType", pdfHeader: "Type", type: "text" },
      { header: "employmentStatus", pdfHeader: "Status", type: "text", inPdf: true },
      { header: "joiningDate", pdfHeader: "Joined", type: "date", inPdf: true },
      { header: "shift", pdfHeader: "Shift", type: "text" },
      { header: "phone", pdfHeader: "Phone", type: "text", inPdf: true },
      { header: "email", pdfHeader: "Email", type: "text", inPdf: true },
      // Private. Not in the PDF.
      { header: "nationalId", pdfHeader: "National ID", type: "text" },
      { header: "dateOfBirth", pdfHeader: "Date of birth", type: "date" },
      { header: "presentAddress", pdfHeader: "Address", type: "text" },
      { header: "bankName", pdfHeader: "Bank", type: "text" },
      { header: "bankAccountNumber", pdfHeader: "Bank account", type: "text" },
      { header: "bankRoutingNumber", pdfHeader: "Routing number", type: "text" },
    ],
    rows: employees.map((e) => [
      e.employeeCode,
      e.fullName,
      e.designation,
      e.department.name,
      e.reportingManager?.fullName ?? null,
      e.employmentType,
      e.employmentStatus,
      e.joiningDate,
      e.shift?.name ?? null,
      e.phone,
      e.user.email,
      e.nationalId,
      e.dateOfBirth,
      e.presentAddress,
      e.bankName,
      e.bankAccountNumber,
      e.bankRoutingNumber,
    ]),
  }
}

export async function exportEmployeesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    await sendExport({
      res, spec: await buildEmployeeExportSpec(), format, baseName: "employees", actor: req.user!, list: "EMPLOYEES",
    })
  } catch (err) {
    next(err)
  }
}
