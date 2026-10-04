import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    holiday: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../../utils/month-lock", () => ({ assertMonthNotLocked: vi.fn() }))

import app from "../../app"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { expectExampleImportsCleanly } from "../../utils/import/import.testkit"
import { assertMonthNotLocked } from "../../utils/month-lock"
import { signAccessToken } from "../auth/auth.utils"
import {
  commitHolidayImport,
  HOLIDAY_IMPORT_COLUMNS,
  holidayImportSampleRows,
  previewHolidayImport,
} from "./attendance.holidays.import"
import { buildHolidayExportSpec } from "./attendance.reference.export"
import { officeDateOf } from "./attendance.time"

const db = prisma as any
const actor = { sub: "u1", role: "HR_ADMIN" } as never
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })
const csv = (...lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8")
const HEADER = "name,date,type"

/** 00:30 on 4 Oct 2026 in Dhaka. UTC is still on 3 Oct. */
const NOW = new Date("2026-10-03T18:30:00.000Z")

const holidayRow = { id: "h1", name: "Victory Day", date: new Date("2026-12-16T00:00:00.000Z"), type: "GENERAL" }

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  // The duplicate check asks with OR; the list asks by year.
  db.holiday.findMany.mockImplementation(async (args: any) => (args?.where?.OR ? [] : [holidayRow]))
  db.holiday.create.mockImplementation(async ({ data }: any) => ({ id: `h-${data.name}`, ...data }))
  db.auditLog.create.mockResolvedValue({})
  vi.mocked(assertMonthNotLocked).mockResolvedValue(undefined)
})

describe("holiday import example", () => {
  it("imports cleanly in both formats, with dates from today onward", async () => {
    await expectExampleImportsCleanly({
      columns: HOLIDAY_IMPORT_COLUMNS,
      sampleRows: holidayImportSampleRows(officeDateOf(new Date())),
      preview: previewHolidayImport,
    })
  })
})

describe("previewHolidayImport", () => {
  it("accepts a holiday dated today and refuses one dated yesterday, by the office date", async () => {
    // UTC says 3 October, the office says 4 October.
    const result = await previewHolidayImport(csv(HEADER, "Today,2026-10-04,", "Yesterday,2026-10-03,"), "h.csv", NOW)
    expect(result.rows.map((r) => r.name)).toEqual(["Today"])
    expect(result.issues).toEqual([
      {
        rowNumber: 3,
        column: "date",
        message: "This date has passed. Holidays can only be added from today onward.",
      },
    ])
  })

  it("uses GENERAL for a blank type, and explains a bad type and a bad date", async () => {
    const ok = await previewHolidayImport(csv(HEADER, "Eid,2026-12-16,"), "h.csv", NOW)
    expect(ok.rows[0]).toEqual({ rowNumber: 2, name: "Eid", date: "2026-12-16", type: "GENERAL" })

    const bad = await previewHolidayImport(csv(HEADER, "A,2026-12-16,SOMETIMES", "B,16/12/2026,", "C,2026-02-30,"), "h.csv", NOW)
    expect(bad.issues).toEqual([
      { rowNumber: 2, column: "type", message: "Write GENERAL, EXECUTIVE_ORDER, OPTIONAL or WORKING_DAY, or leave it blank." },
      { rowNumber: 3, column: "date", message: "Write the date as YYYY-MM-DD, like 2026-12-16." },
      { rowNumber: 4, column: "date", message: "Write the date as YYYY-MM-DD, like 2026-12-16." },
    ])
  })

  it("marks a holiday already in the calendar, and the same holiday twice in the file", async () => {
    db.holiday.findMany.mockImplementation(async (args: any) =>
      args?.where?.OR ? [{ name: "Victory Day", date: new Date("2026-12-16T00:00:00.000Z") }] : []
    )
    const existing = await previewHolidayImport(csv(HEADER, "Victory Day,2026-12-16,"), "h.csv", NOW)
    expect(existing.issues).toEqual([
      { rowNumber: 2, column: "name", message: '"Victory Day" on 2026-12-16 is already in the calendar. Change it or remove the row.' },
    ])

    const twice = await previewHolidayImport(csv(HEADER, "Eid,2026-12-20,", "Eid,2026-12-20,"), "h.csv", NOW)
    expect(twice.issues.map((i) => i.rowNumber)).toEqual([2, 3])
  })

  it("stops on a month whose payroll is paid, and names the rows in that month only", async () => {
    vi.mocked(assertMonthNotLocked).mockImplementation(async (date: Date) => {
      if (date.getUTCMonth() === 9) throw new AppError(409, "October 2026 payroll is already paid. Changes to that month would make money already paid incorrect.")
    })
    const result = await previewHolidayImport(csv(HEADER, "Oct one,2026-10-20,", "Nov one,2026-11-20,", "Oct two,2026-10-25,"), "h.csv", NOW)
    expect(result.issues.map((i) => i.rowNumber)).toEqual([2, 4])
    expect(result.issues[0]).toMatchObject({ column: "date", message: expect.stringContaining("October 2026 payroll is already paid") })
  })
})

describe("commitHolidayImport", () => {
  it("creates each holiday with a real date, and one audit row each", async () => {
    const result = await commitHolidayImport(csv(HEADER, "Eid,2026-12-20,OPTIONAL"), "h.csv", actor, NOW)
    expect(result).toEqual({ created: 1 })
    expect(db.holiday.create).toHaveBeenCalledWith({
      data: { name: "Eid", date: new Date("2026-12-20T00:00:00.000Z"), type: "OPTIONAL" },
    })
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ entity: "HOLIDAY", action: "IMPORT", changedBy: "u1" })
  })

  it("writes nothing when a date has passed", async () => {
    await expect(commitHolidayImport(csv(HEADER, "Old,2026-10-03,"), "h.csv", actor, NOW)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.holiday.create).not.toHaveBeenCalled()
  })
})

describe("buildHolidayExportSpec", () => {
  it("exports name, a real date and the type, and names the year in the filter note", async () => {
    const spec = await buildHolidayExportSpec(2026)
    expect(spec.columns.map((c) => c.header)).toEqual(["name", "date", "type"])
    expect(spec.rows).toEqual([["Victory Day", new Date("2026-12-16T00:00:00.000Z"), "GENERAL"]])
    expect(spec.filterNote).toBe("Year 2026")
    expect((await buildHolidayExportSpec()).filterNote).toBe("All years")
  })
})

describe("holiday import and export routes", () => {
  it("export serves HR, refuses Finance, and refuses a year that is not a number", async () => {
    const ok = await request(app).get("/api/attendance/holidays/export?format=csv&year=2026").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(ok.status).toBe(200)
    expect(ok.text).toContain("name,date,type")

    const denied = await request(app).get("/api/attendance/holidays/export?format=csv").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(denied.status).toBe(403)

    const bad = await request(app).get("/api/attendance/holidays/export?format=csv&year=soon").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe("Year must be a whole number like 2026.")
  })

  it("serves the guide and example, and refuses an employee", async () => {
    const guide = await request(app).get("/api/attendance/holidays/import/guide").set("Authorization", `Bearer ${token("SUPER_ADMIN")}`)
    expect(guide.body.columns.map((c: any) => c.header)).toEqual(["name", "date", "type"])
    expect((await request(app).get("/api/attendance/holidays/import/template").set("Authorization", `Bearer ${token("HR_ADMIN")}`)).status).toBe(200)
    expect((await request(app).get("/api/attendance/holidays/import/template").set("Authorization", `Bearer ${token("EMPLOYEE")}`)).status).toBe(403)
  })

  it("keeps the open holiday list working", async () => {
    const res = await request(app).get("/api/attendance/holidays").set("Authorization", `Bearer ${token("EMPLOYEE")}`)
    expect(res.status).toBe(200)
  })
})
