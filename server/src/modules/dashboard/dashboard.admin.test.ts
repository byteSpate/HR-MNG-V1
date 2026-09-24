import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({
  env: { APP_TIMEZONE: "Asia/Dhaka", ATTENDANCE_GO_LIVE: "2026-01-01" },
}))

vi.mock("../../config/prisma", () => ({
  default: {
    payrollRun: { count: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    settlement: { count: vi.fn(), findMany: vi.fn() },
    employee: { count: vi.fn(), findMany: vi.fn() },
    department: { count: vi.fn() },
    attendance: { count: vi.fn(), findFirst: vi.fn() },
    assetRequest: { count: vi.fn() },
    assetAssignment: { count: vi.fn() },
  },
}))

vi.mock("../event/event.service", () => ({ listEvents: vi.fn() }))
vi.mock("../dealMoney/dealMoney.approvals", () => ({ listWaitingForApproval: vi.fn() }))

import prisma from "../../config/prisma"
import type { AccessTokenPayload } from "../auth/auth.types"
import { listWaitingForApproval } from "../dealMoney/dealMoney.approvals"
import { listEvents } from "../event/event.service"
import { parseDateOnly } from "../../utils/dates"
import { Prisma } from "../../generated/prisma/client"
import { buildAdminDashboard } from "./dashboard.admin"

const NOW = new Date("2026-08-15T06:00:00.000Z")
const actor = { sub: "user-1", role: "SUPER_ADMIN", email: "a@d.com", mustChangePassword: false } as AccessTokenPayload

const cardBy = (payload: Awaited<ReturnType<typeof buildAdminDashboard>>, label: string) => {
  const card = payload.stats.find((s) => s.label === label)
  if (!card) throw new Error(`No card labelled "${label}"`)
  return card
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)

  vi.mocked(prisma.payrollRun.count).mockResolvedValue(0)
  vi.mocked(prisma.settlement.count).mockResolvedValue(0)
  vi.mocked(prisma.assetRequest.count).mockResolvedValue(0)
  vi.mocked(prisma.assetAssignment.count).mockResolvedValue(0)
  vi.mocked(prisma.settlement.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.employee.count).mockResolvedValue(0)
  vi.mocked(prisma.department.count).mockResolvedValue(0)
  vi.mocked(prisma.attendance.count).mockResolvedValue(0)
  vi.mocked(prisma.attendance.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never)
  vi.mocked(listEvents).mockResolvedValue({ items: [], nextCursor: null })
  vi.mocked(listWaitingForApproval).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("awaiting your approval", () => {
  it("counts submitted runs plus calculated draft settlements", async () => {
    vi.mocked(prisma.payrollRun.count).mockResolvedValue(1)
    vi.mocked(prisma.settlement.count).mockResolvedValue(2)

    const card = cardBy(await buildAdminDashboard(actor), "Awaiting your approval")
    expect(card.value).toBe("3")
    expect(card.sub).toBe("1 payroll run · 2 settlements")
    expect(card.tone).toBe("red")
    expect(card.href).toBe("/admin/payroll")
  })

  it("excludes a draft settlement that was never calculated", async () => {
    // A stub, not a queued decision — counting it puts a number on the card
    // that nobody can action.
    await buildAdminDashboard(actor)
    expect(prisma.settlement.count).toHaveBeenCalledWith({
      where: { status: "DRAFT", calculatedAt: { not: null } },
    })
  })

  it("is green and reads Clear when nothing is waiting", async () => {
    const card = cardBy(await buildAdminDashboard(actor), "Awaiting your approval")
    expect(card.value).toBe("0")
    expect(card.tone).toBe("green")
    expect(card.tag).toBe("Clear")
  })

  it("drives the payroll badge from the same number as the card", async () => {
    vi.mocked(prisma.payrollRun.count).mockResolvedValue(2)
    vi.mocked(prisma.settlement.count).mockResolvedValue(1)

    const payload = await buildAdminDashboard(actor)
    expect(payload.badges["/admin/payroll"]).toBe(3)
    expect(cardBy(payload, "Awaiting your approval").value).toBe("3")
  })
})

describe("total employees", () => {
  it("counts active staff and names joiners and departments", async () => {
    vi.mocked(prisma.employee.count)
      .mockResolvedValueOnce(48)
      .mockResolvedValueOnce(3)
    vi.mocked(prisma.department.count).mockResolvedValue(4)

    const card = cardBy(await buildAdminDashboard(actor), "Total employees")
    expect(card.value).toBe("48")
    expect(card.sub).toBe("+3 joined this month · 4 departments")
  })

  it("counts only ACTIVE staff", async () => {
    await buildAdminDashboard(actor)
    expect(prisma.employee.count).toHaveBeenCalledWith({
      where: { employmentStatus: "ACTIVE" },
    })
  })

  it("carries a real headcount trend", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { joiningDate: parseDateOnly("2020-01-01"), lastWorkingDay: null },
    ] as never)

    const card = cardBy(await buildAdminDashboard(actor), "Total employees")
    expect(card.trend).toHaveLength(6)
    expect(card.hotBar).toBe(5)
  })

  it("omits the trend entirely rather than sending zeros", async () => {
    // A fake sparkline is worse than none: it is indistinguishable from a
    // real one.
    const card = cardBy(await buildAdminDashboard(actor), "Total employees")
    expect(card.trend).toBeUndefined()
    expect(card.hotBar).toBeUndefined()
  })
})

describe("this month's payroll", () => {
  it("reads Not started when no run exists, never ৳0", async () => {
    // Zero is a claim that payroll ran and came to nothing.
    const card = cardBy(await buildAdminDashboard(actor), "This month's payroll")
    expect(card.value).toBe("Not started")
    expect(card.sub).toBe("No run opened for August 2026")
  })

  it("reads the current month's run and puts its status in words", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({
      status: "SUBMITTED",
      payslips: [{ netPayableBdt: new Prisma.Decimal("1200000") }],
    } as never)

    const card = cardBy(await buildAdminDashboard(actor), "This month's payroll")
    expect(card.value).toBe("৳12L")
    // The status in words, not a second number.
    expect(card.sub).toBe("Submitted, awaiting approval")
    expect(card.tone).toBe("yellow")
  })

  it("asks for the current office month", async () => {
    await buildAdminDashboard(actor)
    expect(prisma.payrollRun.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { month_year: { month: 8, year: 2026 } } })
    )
  })
})

describe("attendance backlog", () => {
  it("names the age of the oldest pending record", async () => {
    vi.mocked(prisma.attendance.count).mockResolvedValue(12)
    vi.mocked(prisma.attendance.findFirst).mockResolvedValue({
      date: parseDateOnly("2026-08-10"),
    } as never)

    const card = cardBy(await buildAdminDashboard(actor), "Attendance backlog")
    expect(card.value).toBe("12")
    expect(card.sub).toBe("Oldest waiting 5 days")
    expect(card.tone).toBe("red")
  })

  it("is green and says so when nothing is pending", async () => {
    const card = cardBy(await buildAdminDashboard(actor), "Attendance backlog")
    expect(card.tone).toBe("green")
    expect(card.sub).toBe("Nothing pending")
  })

  it("drives the attendance badge from the same count", async () => {
    vi.mocked(prisma.attendance.count).mockResolvedValue(12)
    const payload = await buildAdminDashboard(actor)
    expect(payload.badges["/admin/attendance"]).toBe(12)
  })
})

describe("waiting for approval", () => {
  it("reads Nothing is waiting when the queue is empty", async () => {
    const card = cardBy(await buildAdminDashboard(actor), "Waiting for approval")
    expect(card.value).toBe("0")
    expect(card.sub).toBe("Nothing is waiting")
    expect(card.tone).toBe("green")
  })

  it("counts the queue on the card and drives the approvals badge from the same count", async () => {
    vi.mocked(listWaitingForApproval).mockResolvedValueOnce([
      { kind: "SUPPLIER_BILL", id: "b1", number: "BILL-1", dealId: "d1", dealSerial: "BS-OPP-1", party: "Star Tech", amount: "500.00", preparedBy: "Admin One", preparedAt: "2026-11-01T00:00:00.000Z" },
    ])
    const payload = await buildAdminDashboard(actor)
    const card = cardBy(payload, "Waiting for approval")
    expect(card.value).toBe("1")
    expect(payload.badges["/admin/accounting/approvals"]).toBe(1)
  })
})

describe("chart and table", () => {
  it("draws six months of payroll, gaps included", async () => {
    const payload = await buildAdminDashboard(actor)
    expect(payload.chart?.bars).toHaveLength(6)
    expect(payload.chart?.bars[0].display).toBe("")
  })

  it("lists what is waiting, oldest first, across both queues", async () => {
    // The panel used to repeat the events log column for column. It now
    // answers what a landing page should: what needs this person.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      { month: 7, year: 2026, submittedAt: new Date("2026-08-10T10:00:00.000Z"), createdAt: new Date("2026-08-01T00:00:00.000Z"), payslips: [] },
    ] as never)
    vi.mocked(prisma.settlement.findMany).mockResolvedValue([
      {
        calculatedAt: new Date("2026-08-05T10:00:00.000Z"),
        employee: { fullName: "Nadia Rahman", employeeCode: "BS-EMP-00007" },
      },
    ] as never)

    const payload = await buildAdminDashboard(actor)

    expect(payload.table?.title).toBe("Waiting on you")
    // The settlement was calculated first, so it has been waiting longer.
    expect(payload.table?.rows[0][0]).toEqual({
      text: "Nadia Rahman",
      sub: "BS-EMP-00007",
      weight: 500,
    })
    expect(payload.table?.rows[0][1].text).toBe("Settlement")
    expect(payload.table?.rows[1][0].text).toBe("July 2026 payroll")
  })

  it("falls back to createdAt when a submitted run carries no submittedAt", async () => {
    // Nullable in the schema even though a SUBMITTED run should always have
    // it. Without the fallback the ageing column reads from an Invalid Date.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      { month: 7, year: 2026, submittedAt: null, createdAt: new Date("2026-08-02T00:00:00.000Z"), payslips: [] },
    ] as never)

    const payload = await buildAdminDashboard(actor)

    expect(payload.table?.rows[0][2].text).toBe("Aug 2, 2026")
  })
})

describe("card isolation", () => {
  it("gives four good cards and one failure when a sub-query throws", async () => {
    vi.mocked(prisma.department.count).mockRejectedValue(new Error("db down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const payload = await buildAdminDashboard(actor)
    expect(payload.stats).toHaveLength(5)
    expect(payload.stats.filter((s) => s.failed)).toHaveLength(1)
    expect(cardBy(payload, "Total employees").failed).toBe(true)
    expect(cardBy(payload, "This month's payroll").failed).toBeUndefined()
  })
})
