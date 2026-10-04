import ExcelJS from "exceljs"
import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    shift: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { expectExampleImportsCleanly } from "../../utils/import/import.testkit"
import { signAccessToken } from "../auth/auth.utils"
import { buildShiftExportSpec } from "./attendance.reference.export"
import {
  commitShiftImport,
  previewShiftImport,
  SHIFT_IMPORT_COLUMNS,
  shiftImportSampleRows,
} from "./attendance.shifts.import"

const db = prisma as any
const actor = { sub: "u1", role: "HR_ADMIN" } as never
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })
const csv = (...lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8")
const HEADER = "name,startTime,endTime,breakMinutes,graceMinutes,weeklyOffDays"

const shiftRow = {
  id: "sh1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60, graceMinutes: 15,
  weeklyOffDays: [5, 6], effectiveFrom: null, effectiveTo: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  // The duplicate check asks `where: { name: { in } }`; the list asks for everything.
  db.shift.findMany.mockImplementation(async (args: any) => (args?.where?.name ? [] : [shiftRow]))
  db.shift.create.mockImplementation(async ({ data }: any) => ({ id: `sh-${data.name}`, ...data }))
  db.auditLog.create.mockResolvedValue({})
})

describe("shift import example", () => {
  it("imports cleanly in both formats, and its headers are the column list", async () => {
    await expectExampleImportsCleanly({
      columns: SHIFT_IMPORT_COLUMNS,
      sampleRows: shiftImportSampleRows(new Date()),
      preview: previewShiftImport,
    })
  })
})

describe("previewShiftImport", () => {
  it("reads a full row", async () => {
    const result = await previewShiftImport(csv(HEADER, "Morning,08:00,17:00,45,10,5;6"), "s.csv")
    expect(result.issues).toEqual([])
    expect(result.rows[0]).toMatchObject({
      name: "Morning", startTime: "08:00", endTime: "17:00", breakMinutes: 45, graceMinutes: 10, weeklyOffDays: [5, 6],
    })
    expect(result.summary).toEqual({ shifts: 1 })
  })

  it("uses the form's defaults for blank cells, and none for no weekly off", async () => {
    const result = await previewShiftImport(csv(HEADER, "Late,10:00,19:00,,,", "Seven days,10:00,19:00,,,none"), "s.csv")
    expect(result.rows[0]).toMatchObject({ breakMinutes: 60, graceMinutes: 15, weeklyOffDays: [5] })
    expect(result.rows[1].weeklyOffDays).toEqual([])
  })

  it("explains a bad off-day list, a bad number and a bad time", async () => {
    const result = await previewShiftImport(
      csv(HEADER, "A,10:00,19:00,,,7", "B,10:00,19:00,abc,,", "C,9am,19:00,,,"),
      "s.csv"
    )
    const at = (rowNumber: number) => result.issues.filter((i) => i.rowNumber === rowNumber)
    expect(at(2)).toEqual([
      {
        rowNumber: 2, column: "weeklyOffDays",
        message: "Use numbers from 0 (Sunday) to 6 (Saturday), separated by ;. Write none for no weekly off.",
      },
    ])
    expect(at(3)).toEqual([{ rowNumber: 3, column: "breakMinutes", message: "Use a whole number like 60." }])
    expect(at(4).map((i) => i.column)).toContain("startTime")
  })

  it("reads a time that Excel turned into a time value", async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet("Data")
    ws.addRow(["name", "startTime", "endTime"])
    ws.addRow(["Morning", new Date(Date.UTC(1899, 11, 30, 8, 0)), new Date(Date.UTC(1899, 11, 30, 17, 0))])
    const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer)

    const result = await previewShiftImport(buffer, "s.xlsx")
    expect(result.issues).toEqual([])
    expect(result.rows[0]).toMatchObject({ startTime: "08:00", endTime: "17:00" })
  })

  it("marks a name that already exists, and a name twice in one file", async () => {
    db.shift.findMany.mockImplementation(async (args: any) => (args?.where?.name ? [{ name: "General" }] : []))
    const existing = await previewShiftImport(csv(HEADER, "General,09:00,18:00,,,"), "s.csv")
    expect(existing.issues).toEqual([
      { rowNumber: 2, column: "name", message: 'The shift "General" is already in the system. Change it or remove the row.' },
    ])

    const twice = await previewShiftImport(csv(HEADER, "Same,09:00,18:00,,,", "Same,10:00,19:00,,,"), "s.csv")
    expect(twice.issues.map((i) => i.rowNumber)).toEqual([2, 3])
  })
})

describe("commitShiftImport", () => {
  it("creates each shift with its audit row", async () => {
    const result = await commitShiftImport(csv(HEADER, "Morning,08:00,17:00,45,10,5;6"), "s.csv", actor)
    expect(result).toEqual({ created: 1 })
    expect(db.shift.create).toHaveBeenCalledWith({
      data: { name: "Morning", startTime: "08:00", endTime: "17:00", breakMinutes: 45, graceMinutes: 10, weeklyOffDays: [5, 6] },
    })
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ entity: "SHIFT", action: "IMPORT", changedBy: "u1" })
  })
})

describe("buildShiftExportSpec", () => {
  it("exports the import columns first, then the day names and the effective dates", async () => {
    const spec = await buildShiftExportSpec()
    expect(spec.columns.map((c) => c.header)).toEqual([
      "name", "startTime", "endTime", "breakMinutes", "graceMinutes", "weeklyOffDays", "weeklyOff", "effectiveFrom", "effectiveTo",
    ])
    expect(spec.rows[0]).toEqual(["General", "09:00", "18:00", 60, 15, "5;6", "Fri, Sat", null, null])
  })
})

describe("shift import and export routes", () => {
  it("export serves HR and Super Admin, and refuses Finance and employees", async () => {
    expect((await request(app).get("/api/attendance/shifts/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "FINANCE_OFFICER"]) {
      const res = await request(app).get("/api/attendance/shifts/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    const ok = await request(app).get("/api/attendance/shifts/export?format=csv").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(ok.status).toBe(200)
    expect(ok.text).toContain("name,startTime,endTime")
  })

  it("serves the guide and example, then previews and commits", async () => {
    const auth = { Authorization: `Bearer ${token("HR_ADMIN")}` }
    const guide = await request(app).get("/api/attendance/shifts/import/guide").set(auth)
    expect(guide.body.columns.map((c: any) => c.header)).toEqual(SHIFT_IMPORT_COLUMNS.map((c) => c.header))
    expect((await request(app).get("/api/attendance/shifts/import/template").set(auth)).status).toBe(200)

    const file = { filename: "s.csv", contentType: "text/csv" }
    const preview = await request(app).post("/api/attendance/shifts/import/preview").set(auth).attach("file", csv(HEADER, "Morning,08:00,17:00,,,"), file)
    expect(preview.status).toBe(200)
    const commit = await request(app).post("/api/attendance/shifts/import/commit").set(auth).attach("file", csv(HEADER, "Morning,08:00,17:00,,,"), file)
    expect(commit.status).toBe(201)
    expect(commit.body).toEqual({ created: 1 })
  })

  it("keeps the shift list working", async () => {
    const res = await request(app).get("/api/attendance/shifts").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(200)
  })
})
