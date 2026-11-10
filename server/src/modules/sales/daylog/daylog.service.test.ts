import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    salesTask: { findMany: vi.fn() },
    salesMeeting: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { Prisma } from "../../../generated/prisma/client"
import { getDayLog } from "./daylog.service"
import { dayLogQuerySchema } from "./daylog.validators"

const USER = { sub: "user-1", role: "EMPLOYEE", email: "rahim@demo.com", mustChangePassword: false, salesRole: "SALES_USER" } as any

const m = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  m.user.findUnique.mockResolvedValue({ employee: { id: "emp-1" } })
  m.employee.findUnique.mockResolvedValue({ fullName: "Rahim Uddin" })
  m.salesTask.findMany.mockResolvedValue([])
  m.salesMeeting.findMany.mockResolvedValue([])
  m.opportunity.findMany.mockResolvedValue([])
})

describe("getDayLog", () => {
  it("reads only the caller's own work, in office time", async () => {
    await getDayLog({ from: "2026-11-10", to: "2026-11-10" }, USER)

    // Dhaka is UTC+6, so the office day 10 Nov starts at 18:00 UTC on the 9th.
    const window = { gte: new Date("2026-11-09T18:00:00.000Z"), lt: new Date("2026-11-10T18:00:00.000Z") }
    expect(m.salesTask.findMany.mock.calls[0][0].where).toEqual({
      assignedToEmployeeId: "emp-1", status: "DONE", completedAt: window,
    })
    expect(m.salesMeeting.findMany.mock.calls[0][0].where).toEqual({
      status: "COMPLETED", scheduledAt: window, attendees: { some: { side: "OURS", employeeId: "emp-1" } },
    })
    expect(m.opportunity.findMany.mock.calls[0][0].where).toEqual({
      ownerEmployeeId: "emp-1", status: { in: ["WON", "LOST", "CANCELLED"] }, closedAt: window,
    })
  })

  it("puts each item on its office day", async () => {
    // 19:00 UTC on the 9th is 01:00 on the 10th in Dhaka.
    m.salesTask.findMany.mockResolvedValue([{
      title: "Sent the quote", type: "QUOTATION_SENT", outcome: null,
      completedAt: new Date("2026-11-09T19:00:00.000Z"),
      salesAccount: { name: "Bengal Group" }, opportunity: { serial: "OPP-0012" },
    }])
    m.salesMeeting.findMany.mockResolvedValue([{
      title: "Firewall review", scheduledAt: new Date("2026-11-10T05:30:00.000Z"), outcome: "Went well",
      salesAccount: { name: "Bengal Group" }, opportunity: null,
    }])
    m.opportunity.findMany.mockResolvedValue([{
      serial: "OPP-0012", name: "Firewall Upgrade", amount: new Prisma.Decimal("520000"), status: "LOST",
      statusReason: "Price too high", closedAt: new Date("2026-11-10T09:00:00.000Z"), salesAccount: { name: "Bengal Group" },
    }])

    const log = await getDayLog({ from: "2026-11-10", to: "2026-11-10" }, USER)

    expect(log.personName).toBe("Rahim Uddin")
    expect(log.days).toEqual([{
      date: "2026-11-10",
      tasks: [{ title: "Sent the quote", type: "QUOTATION_SENT", about: "Bengal Group · OPP-0012", outcome: null }],
      meetings: [{ time: "11:30", title: "Firewall review", accountName: "Bengal Group", opportunitySerial: null, outcome: "Went well" }],
      closed: [{
        status: "LOST", serial: "OPP-0012", name: "Firewall Upgrade", accountName: "Bengal Group",
        amount: "5,20,000.00", reason: "Price too high",
      }],
    }])
  })

  it("gives an empty log, and reads nothing, for someone with no staff record", async () => {
    m.user.findUnique.mockResolvedValue({ employee: null })
    const log = await getDayLog({ from: "2026-11-10", to: "2026-11-10" }, USER)
    expect(m.salesTask.findMany).not.toHaveBeenCalled()
    expect(log.personName).toBe("rahim@demo.com")
    expect(log.days).toEqual([{ date: "2026-11-10", tasks: [], meetings: [], closed: [] }])
  })
})

describe("dayLogQuerySchema", () => {
  it("takes one day or up to seven days", () => {
    expect(dayLogQuerySchema.safeParse({ from: "2026-11-10", to: "2026-11-10" }).success).toBe(true)
    expect(dayLogQuerySchema.safeParse({ from: "2026-11-07", to: "2026-11-13" }).success).toBe(true)
  })

  it("refuses more than a week, dates out of order, and dates that do not exist", () => {
    expect(dayLogQuerySchema.safeParse({ from: "2026-11-07", to: "2026-11-14" }).success).toBe(false)
    expect(dayLogQuerySchema.safeParse({ from: "2026-11-10", to: "2026-11-09" }).success).toBe(false)
    expect(dayLogQuerySchema.safeParse({ from: "2026-02-30", to: "2026-02-30" }).success).toBe(false)
  })
})
