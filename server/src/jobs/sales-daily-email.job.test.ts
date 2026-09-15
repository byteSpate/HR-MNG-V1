import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/prisma", () => ({
  default: {
    salesMeeting: { findMany: vi.fn() },
    salesTask: { findMany: vi.fn() },
    shift: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    emailDispatch: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
  },
}))
vi.mock("../modules/sales/sales.mailer", () => ({ sendSalesDailyEmail: vi.fn(), sendMeetingChanged: vi.fn() }))

import prisma from "../config/prisma"
import { sendSalesDailyEmail } from "../modules/sales/sales.mailer"
import { runSalesDailyEmail } from "./sales-daily-email.job"

/** 00:01 on Tuesday 15 Sep in Dhaka is 18:01 on the 14th in UTC. */
const NOW = new Date("2026-09-14T18:01:00.000Z")
const TODAY = new Date("2026-09-15T00:00:00.000Z")

const GENERAL = {
  id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  graceMinutes: 15, weeklyOffDays: [5], effectiveFrom: null, effectiveTo: null,
}

const employee = (id: string) => ({
  id, fullName: id === "emp-1" ? "Rahim" : "Karim", shiftId: null,
  employmentStatus: "ACTIVE", lastWorkingDay: null,
  user: { email: `${id}@demo.com`, salesRole: "SALES_USER", isActive: true },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([{
    id: "meeting-1", title: "Firewall walkthrough", scheduledAt: new Date("2026-09-15T04:00:00.000Z"),
    mode: "CUSTOMER_SITE", location: null, salesAccount: { name: "Bengal Group" },
    attendees: [{ employeeId: "emp-1" }],
  }] as any)
  vi.mocked(prisma.salesTask.findMany).mockResolvedValue([
    { id: "task-1", title: "Call back", dueOn: TODAY, priority: "NORMAL", assignedToEmployeeId: "emp-1", salesAccount: { name: "Bengal Group" } },
    { id: "task-2", title: "Send the BOM", dueOn: new Date("2026-09-12T00:00:00.000Z"), priority: "HIGH", assignedToEmployeeId: "emp-2", salesAccount: null },
  ] as any)
  vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL] as any)
  vi.mocked(prisma.holiday.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.emailDispatch.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.employee.findMany).mockImplementation((async (args: any) =>
    (args.where?.id?.in ?? []).map(employee)) as never)
})

describe("the 00:01 daily email", () => {
  it("reads today's scheduled meetings in office time and pending tasks due today or before", async () => {
    await runSalesDailyEmail(NOW)

    const meetings = (vi.mocked(prisma.salesMeeting.findMany).mock.calls[0][0] as any).where
    expect(meetings.status).toBe("SCHEDULED")
    expect(meetings.scheduledAt.gte.toISOString()).toBe("2026-09-14T18:00:00.000Z")
    expect(meetings.scheduledAt.lt.toISOString()).toBe("2026-09-15T18:00:00.000Z")

    const tasks = (vi.mocked(prisma.salesTask.findMany).mock.calls[0][0] as any).where
    expect(tasks).toEqual({ status: "PENDING", dueOn: { lte: TODAY } })
  })

  it("sends one email per person, meetings and tasks together, and counts them", async () => {
    const sent = await runSalesDailyEmail(NOW)

    expect(sent).toBe(2)
    expect(sendSalesDailyEmail).toHaveBeenCalledTimes(2)
    expect(sendSalesDailyEmail).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "emp-1",
      email: "emp-1@demo.com",
      meetings: [expect.objectContaining({ id: "meeting-1", salesAccountName: "Bengal Group" })],
      tasks: [expect.objectContaining({ id: "task-1", overdue: false })],
    }), TODAY)
    expect(sendSalesDailyEmail).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "emp-2", meetings: [], tasks: [expect.objectContaining({ id: "task-2", overdue: true })],
    }), TODAY)
  })

  it("sends nothing to somebody who already had today's email", async () => {
    vi.mocked(prisma.emailDispatch.findMany).mockResolvedValue([{ entityId: "emp-1" }] as any)

    expect(await runSalesDailyEmail(NOW)).toBe(1)

    const where = (vi.mocked(prisma.emailDispatch.findMany).mock.calls[0][0] as any).where
    expect(where.kind).toBe("SALES_DAILY_EMAIL")
    expect(where.createdAt.gte.toISOString()).toBe("2026-09-14T18:00:00.000Z")
    expect(sendSalesDailyEmail).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "emp-2" }), TODAY)
  })

  it("sends nothing on a company holiday", async () => {
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([{ date: TODAY, type: "GENERAL", name: "Holiday" }] as any)

    expect(await runSalesDailyEmail(NOW)).toBe(0)
    expect(sendSalesDailyEmail).not.toHaveBeenCalled()
  })

  it("looks nobody up on a day with nothing on", async () => {
    vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.salesTask.findMany).mockResolvedValue([] as any)

    expect(await runSalesDailyEmail(NOW)).toBe(0)
    expect(prisma.employee.findMany).not.toHaveBeenCalled()
  })
})
