import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    employee: { findUnique: vi.fn().mockResolvedValue(null) },
    leaveRequest: { findMany: vi.fn() },
    leaveType: { findUnique: vi.fn() },
    holiday: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"
import { daysInRange } from "./leave.report"

const db = prisma as any
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const casual = { code: "CL", name: "Casual leave", isPaid: true, countsHolidays: false }
const unpaid = { code: "LWP", name: "Leave Without Pay", isPaid: false, countsHolidays: false }

const leave = (over: Record<string, unknown>) => ({
  id: "r1",
  startDate: d("2026-02-01"),
  endDate: d("2026-02-02"),
  startSession: "FIRST_HALF",
  endSession: "SECOND_HALF",
  status: "APPROVED",
  reason: "Family",
  decisionNote: null,
  createdAt: d("2026-01-20"),
  decidedAt: d("2026-01-21"),
  leaveType: casual,
  employee: { employeeCode: "E-1", fullName: "Rahim", department: { name: "Tech" } },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.holiday.findMany.mockResolvedValue([])
  db.leaveType.findUnique.mockResolvedValue({ name: "Casual leave" })
  db.auditLog.create.mockResolvedValue({})
  db.leaveRequest.findMany.mockResolvedValue([
    leave({}),
    leave({ id: "r2", status: "PENDING", leaveType: unpaid, startDate: d("2026-02-10"), endDate: d("2026-02-10") }),
  ])
})

describe("daysInRange", () => {
  const empty = { holidayDates: new Set<string>(), workingOverrides: new Set<string>() }

  it("counts only the days inside the report range", () => {
    // 30 Jan (Fri, day off) to 3 Feb. February only: 1, 2, 3 Feb.
    const r = { startDate: d("2026-01-30"), endDate: d("2026-02-03"), startSession: "FIRST_HALF", endSession: "SECOND_HALF" } as const
    expect(daysInRange(r, false, d("2026-02-01"), d("2026-02-28"), empty)).toBe(3)
  })

  it("keeps a half day at an edge that is inside the range, and drops it at an edge that was cut", () => {
    const r = { startDate: d("2026-01-29"), endDate: d("2026-02-02"), startSession: "SECOND_HALF", endSession: "FIRST_HALF" } as const
    // February: 1 Feb whole, 2 Feb first half only.
    expect(daysInRange(r, false, d("2026-02-01"), d("2026-02-28"), empty)).toBe(1.5)
    // January: 29 Jan second half only, 30 Jan Friday off, 31 Jan whole.
    expect(daysInRange(r, false, d("2026-01-01"), d("2026-01-31"), empty)).toBe(1.5)
  })
})

describe("GET /api/leave/report", () => {
  it("is for HR Admin and Super Admin only", async () => {
    for (const role of ["EMPLOYEE", "REPORTING_MANAGER", "FINANCE_OFFICER"]) {
      const res = await request(app)
        .get("/api/leave/report?from=2026-02-01&to=2026-02-28")
        .set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
  })

  it("asks for leave that overlaps the range, and totals the days by status", async () => {
    const res = await request(app)
      .get("/api/leave/report?from=2026-02-01&to=2026-02-28")
      .set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(db.leaveRequest.findMany.mock.calls[0][0].where).toEqual({
      startDate: { lte: d("2026-02-28") },
      endDate: { gte: d("2026-02-01") },
    })
    expect(res.body.filterNote).toBe("1 February 2026 to 28 February 2026")
    expect(res.body.rows[0]).toEqual([
      "E-1", "Rahim", "Tech", "Casual leave", "Paid",
      "2026-02-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z", 2, "Approved",
      "2026-01-20T00:00:00.000Z", "2026-01-21T00:00:00.000Z", "Family", null,
    ])
    expect(res.body.rows[1][4]).toBe("Unpaid")
    expect(res.body.summary).toEqual([
      { label: "Requests", value: "2" },
      { label: "Approved days", value: "2" },
      { label: "Waiting days", value: "1" },
      { label: "Unpaid days approved", value: "0" },
    ])
  })

  it("filters by status and leave type, and names them in the note", async () => {
    const res = await request(app)
      .get("/api/leave/report?from=2026-02-01&to=2026-02-28&status=APPROVED&leaveTypeId=t1")
      .set("Authorization", `Bearer ${token("SUPER_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(db.leaveRequest.findMany.mock.calls[0][0].where).toMatchObject({ status: "APPROVED", leaveTypeId: "t1" })
    expect(res.body.filterNote).toBe("1 February 2026 to 28 February 2026 · Approved · Casual leave")
  })

  it("needs a From and To date", async () => {
    const res = await request(app).get("/api/leave/report").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(400)
  })

  it("downloads a CSV and writes an audit row", async () => {
    const res = await request(app)
      .get("/api/leave/report?from=2026-02-01&to=2026-02-28&format=csv")
      .set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(res.headers["content-disposition"]).toMatch(/leave-report-/)
    expect(db.auditLog.create).toHaveBeenCalledTimes(1)
  })
})
