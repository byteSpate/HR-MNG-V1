import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    shift: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    salesAccount: { findMany: vi.fn(), findFirst: vi.fn() },
    salesCommunication: { findMany: vi.fn() },
    salesMeeting: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn(), findFirst: vi.fn() },
    event: { findMany: vi.fn() },
    salesTask: { findMany: vi.fn(), create: vi.fn() },
    weeklyReport: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    weeklyAccountNote: { upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    weeklyOtherWork: { create: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { addOtherWork, getMyWeek, listTeamWeek, removeOtherWork, saveAccountNote } from "./weekly.service"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)
const SUNDAY = day("2026-09-13")
const MONDAY = day("2026-09-14")

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "rahim@demo.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as never
const ADMIN = {
  sub: "user-2", role: "EMPLOYEE", email: "admin@demo.com",
  mustChangePassword: false, salesRole: "SALES_ADMIN",
} as never

const GENERAL = {
  id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  graceMinutes: 15, weeklyOffDays: [5], effectiveFrom: null, effectiveTo: null,
}

const employee = {
  id: "emp-1", fullName: "Rahim", designation: "Pre-Sales Engineer", shiftId: "shift-1",
  joiningDate: day("2020-01-01"), lastWorkingDay: null,
}

const report = (overrides: Record<string, unknown> = {}) => ({
  id: "week-1", employeeId: "emp-1", weekStart: SUNDAY, status: "DRAFT",
  firstSubmittedAt: null, submittedLate: false, lastSubmittedAt: null,
  createdBy: "user-1", createdAt: SUNDAY, updatedAt: SUNDAY,
  notes: [], otherWork: [], copies: [],
  ...overrides,
})

/** The transaction runs its callback against the same mocked client. */
const runsTransaction = () =>
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) =>
    typeof fn === "function" ? await (fn as (tx: unknown) => unknown)(prisma) : fn) as never)

beforeEach(() => {
  vi.clearAllMocks()
  runsTransaction()
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as never)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as never)
  vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL] as never)
  vi.mocked(prisma.holiday.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesAccount.findMany).mockResolvedValue([{ id: "acc-1", name: "Bengal Group" }] as never)
  vi.mocked(prisma.salesCommunication.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.opportunity.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.event.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesTask.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.weeklyReport.findUnique).mockResolvedValue(null as never)
})

describe("getMyWeek", () => {
  it("gives back the week with its days, and creates nothing on a read", async () => {
    const week = await getMyWeek({ week: "2026-09-13" }, USER)

    expect(week.weekStart).toEqual(SUNDAY)
    expect(week.days).toHaveLength(5)
    expect(week.status).toBe("NOT_STARTED")
    expect(week.deadlineDay).toEqual(day("2026-09-17"))
    expect(prisma.weeklyReport.create).not.toHaveBeenCalled()
  })

  it("reads the week of today when none is asked for", async () => {
    vi.setSystemTime(new Date("2026-09-15T05:00:00.000Z"))
    const week = await getMyWeek({}, USER)
    expect(week.weekStart).toEqual(SUNDAY)
    vi.useRealTimers()
  })

  it("refuses a week that has not happened yet", async () => {
    vi.setSystemTime(new Date("2026-09-15T05:00:00.000Z"))
    await expect(getMyWeek({ week: "2026-09-20" }, USER)).rejects.toMatchObject({ statusCode: 400 })
    vi.useRealTimers()
  })

  it("refuses somebody with no employee record", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as never)
    await expect(getMyWeek({ week: "2026-09-13" }, USER)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe("saveAccountNote", () => {
  it("writes the typed lines, making the week on the first write", async () => {
    vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue(report() as never)
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "acc-1", ownerEmployeeId: "emp-1" } as never)

    await saveAccountNote(
      { date: "2026-09-14", salesAccountId: "acc-1", challenges: "He was sick", gap: null, nextStep: null, makeTask: false },
      USER
    )

    expect(prisma.weeklyReport.upsert).toHaveBeenCalled()
    expect(prisma.weeklyAccountNote.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          weeklyReportId_date_salesAccountId: { weeklyReportId: "week-1", date: MONDAY, salesAccountId: "acc-1" },
        }),
      })
    )
    expect(prisma.auditLog.create).toHaveBeenCalled()
  })

  it("refuses a day outside the week, and a day still to come", async () => {
    vi.setSystemTime(new Date("2026-09-15T05:00:00.000Z"))
    await expect(
      saveAccountNote({ date: "2026-09-18", salesAccountId: "acc-1", challenges: "x", gap: null, nextStep: null, makeTask: false }, USER)
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      saveAccountNote({ date: "2026-09-16", salesAccountId: "acc-1", challenges: "x", gap: null, nextStep: null, makeTask: false }, USER)
    ).rejects.toMatchObject({ statusCode: 400 })
    vi.useRealTimers()
  })

  it("refuses an account the person does not work", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null as never)
    await expect(
      saveAccountNote({ date: "2026-09-14", salesAccountId: "acc-9", challenges: "x", gap: null, nextStep: null, makeTask: false }, USER)
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("makes a task from the typed next step, due a week out, and keeps its id", async () => {
    // A week out from the day it is ticked, so the clock is held still.
    vi.setSystemTime(new Date("2026-09-14T05:00:00.000Z"))
    vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue(report() as never)
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "acc-1", ownerEmployeeId: "emp-1" } as never)
    vi.mocked(prisma.salesTask.create).mockResolvedValue({ id: "task-7" } as never)

    await saveAccountNote(
      { date: "2026-09-14", salesAccountId: "acc-1", challenges: null, gap: null, nextStep: "Meet the IT team", makeTask: true },
      USER
    )

    expect(prisma.salesTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Meet the IT team",
          salesAccountId: "acc-1",
          assignedToEmployeeId: "emp-1",
          dueOn: day("2026-09-21"),
        }),
      })
    )
    expect(prisma.weeklyAccountNote.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ taskId: "task-7" }) })
    )
    vi.useRealTimers()
  })

  it("refuses a typed next step when the account already has an open deal", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "acc-1", ownerEmployeeId: "emp-1" } as never)
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({ id: "opp-1" } as never)

    await expect(
      saveAccountNote(
        { date: "2026-09-14", salesAccountId: "acc-1", challenges: null, gap: null, nextStep: "Call tomorrow", makeTask: true },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(prisma.salesTask.create).not.toHaveBeenCalled()
    expect(prisma.weeklyAccountNote.upsert).not.toHaveBeenCalled()
  })

  it("puts a submitted week back to Draft when it is added to", async () => {
    vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue(
      report({ status: "SUBMITTED", firstSubmittedAt: day("2026-09-17"), lastSubmittedAt: day("2026-09-17") }) as never
    )
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "acc-1", ownerEmployeeId: "emp-1" } as never)

    await saveAccountNote(
      { date: "2026-09-14", salesAccountId: "acc-1", challenges: "Added later", gap: null, nextStep: null, makeTask: false },
      USER
    )

    expect(prisma.weeklyReport.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT" }) })
    )
  })

  it("refuses a Sales Admin writing somebody else's week", async () => {
    await expect(
      saveAccountNote({ date: "2026-09-14", salesAccountId: "acc-1", challenges: "x", gap: null, nextStep: null, makeTask: false }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("other work", () => {
  it("adds a line to a day", async () => {
    vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue(report() as never)
    await addOtherWork({ date: "2026-09-12", text: "Office discussion" }, USER)
    expect(prisma.weeklyOtherWork.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ date: day("2026-09-12"), text: "Office discussion" }) })
    )
  })

  it("removes only a line of the person's own week", async () => {
    vi.mocked(prisma.weeklyOtherWork.findFirst).mockResolvedValue(null as never)
    await expect(removeOtherWork("ow-9", USER)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("listTeamWeek", () => {
  it("lists every Sales User for the week, including those who have not started", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-1", fullName: "Rahim", designation: "Pre-Sales Engineer" },
      { id: "emp-2", fullName: "Karim", designation: "Sales Executive" },
    ] as never)
    vi.mocked(prisma.weeklyReport.findMany).mockResolvedValue([
      report({ employeeId: "emp-1", status: "SUBMITTED", firstSubmittedAt: day("2026-09-17"), submittedLate: false }),
    ] as never)

    const rows = await listTeamWeek({ week: "2026-09-13" }, ADMIN)

    expect(rows.map((row) => [row.fullName, row.status])).toEqual([
      ["Rahim", "SUBMITTED"],
      ["Karim", "NOT_STARTED"],
    ])
  })

  it("is refused to a Sales User", async () => {
    await expect(listTeamWeek({ week: "2026-09-13" }, USER)).rejects.toMatchObject({ statusCode: 403 })
  })

  it("keeps a past report visible after its writer becomes a Sales Admin", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-2", fullName: "Current user", designation: "Sales Executive" },
    ] as never)
    vi.mocked(prisma.weeklyReport.findMany).mockResolvedValue([
      report({
        employeeId: "emp-1",
        status: "SUBMITTED",
        firstSubmittedAt: day("2026-09-17"),
        employee: { id: "emp-1", fullName: "Promoted user", designation: "Sales Manager" },
      }),
    ] as never)

    const rows = await listTeamWeek({ week: "2026-09-13" }, ADMIN)

    expect(rows.map((row) => [row.fullName, row.status])).toEqual([
      ["Current user", "NOT_STARTED"],
      ["Promoted user", "SUBMITTED"],
    ])
  })
})
