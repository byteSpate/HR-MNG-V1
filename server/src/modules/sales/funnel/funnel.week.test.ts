import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    salesTask: { findMany: vi.fn() },
    salesPermission: { findMany: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { clearPermissionCache } from "../sales.permissions"
import { FUNNEL_NOT_YOURS, NO_SALES_PROFILE } from "./funnel.service"
import { getPersonWeek } from "./funnel.week"

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as never
const ADMIN = { sub: "user-2", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as never
const SUPER = { sub: "user-3", role: "SUPER_ADMIN", salesRole: null } as never

/** A Saturday review. The week it looks back on starts on Sunday 6 September. */
const NOW = new Date("2026-09-12T09:00:00.000Z")

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "t-1", origin: "SELF", type: "OTHER", salesAccountId: null, opportunityId: null, meetingId: null,
  title: "Sent the BOQ", detail: null, dueOn: new Date("2026-09-08T00:00:00.000Z"), priority: "NORMAL",
  status: "PENDING", assignedToEmployeeId: "emp-1", assignedByEmployeeId: null,
  assignedTo: { fullName: "Rahim Uddin" }, assignedBy: null,
  outcome: null, cancelReason: null, completedAt: null,
  createdAt: new Date("2026-09-06T06:00:00.000Z"), updatedAt: new Date("2026-09-06T06:00:00.000Z"),
  salesAccount: null, opportunity: null, meeting: null,
  ...overrides,
})

/** Dhaka is six hours ahead: 04:00 UTC is 10:00 that day. */
const done = (id: string, day: string, overrides: Record<string, unknown> = {}) =>
  task({ id, status: "DONE", completedAt: new Date(`${day}T04:00:00.000Z`), ...overrides })

const takeOut = (id: string, overrides: Record<string, unknown> = {}) =>
  task({
    id, origin: "TAKE_OUT", assignedBy: { fullName: "Admin Person" }, assignedByEmployeeId: "emp-admin",
    createdAt: new Date("2026-09-05T06:00:00.000Z"), ...overrides,
  })

/** The first findMany is the week; the one for open take-outs asks for an origin. */
function answer(week: unknown[], open: unknown[] = []) {
  mocked(prisma.salesTask.findMany).mockImplementation(async (args: any) => (args.where.origin ? open : week))
}

const days = (result: Awaited<ReturnType<typeof getPersonWeek>>) => Object.fromEntries(result.days.map((d) => [d.date, d.tasks.map((t) => t.id)]))

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } })
  mocked(prisma.salesPermission.findMany).mockResolvedValue([])
  mocked(prisma.employee.findUnique).mockImplementation(async (args: any) => ({ id: args.where.id, fullName: "Rahim Uddin" }))
  answer([])
})

describe("one person's week for the Saturday review (owner, 2026-11-02)", () => {
  it("looks back on the week that has just finished when no week is asked for", async () => {
    const result = await getPersonWeek({}, USER, NOW)
    expect(result.weekStart).toBe("2026-09-06")
    expect(result.employee).toEqual({ id: "emp-1", fullName: "Rahim Uddin" })
  })

  it("uses the week asked for", async () => {
    const result = await getPersonWeek({ week: "2026-09-13" }, USER, NOW)
    expect(result.weekStart).toBe("2026-09-13")
  })

  it("groups a done task under the day it was done and a planned one under its due day", async () => {
    answer([
      done("a", "2026-09-08", { dueOn: new Date("2026-09-10T00:00:00.000Z") }),
      task({ id: "b", dueOn: new Date("2026-09-09T00:00:00.000Z") }),
    ])
    const result = await getPersonWeek({}, USER, NOW)
    expect(days(result)).toMatchObject({ "2026-09-08": ["a"], "2026-09-09": ["b"], "2026-09-10": [] })
  })

  it("always lists Sunday to Thursday, with a label for each day", async () => {
    const result = await getPersonWeek({}, USER, NOW)
    expect(result.days.map((d) => d.date)).toEqual(["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"])
    expect(result.days.map((d) => d.label)).toEqual(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"])
  })

  it("adds Friday and the Saturday before only when they hold a task", async () => {
    answer([done("fri", "2026-09-11"), done("sat", "2026-09-05")])
    const result = await getPersonWeek({}, USER, NOW)
    expect(result.days.map((d) => d.date)).toEqual([
      "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
    ])
    expect(days(result)).toMatchObject({ "2026-09-05": ["sat"], "2026-09-11": ["fri"] })
  })

  it("counts tasks by type and keeps a zero for every type", async () => {
    answer([done("a", "2026-09-07", { type: "QUOTATION_SENT" }), done("b", "2026-09-08", { type: "QUOTATION_SENT" }), task({ id: "c", type: "LEARNING" })])
    const result = await getPersonWeek({}, USER, NOW)
    expect(result.countsByType).toEqual({
      VISIT_FOLLOW_UP: 0, QUOTATION_SENT: 2, REQUIREMENT_SENT: 0, CALL_OR_EMAIL: 0, LEARNING: 1, INTERNAL_WORK: 0, OTHER: 0,
    })
  })

  it("returns empty days and zero counts for a week with nothing in it", async () => {
    const result = await getPersonWeek({}, USER, NOW)
    expect(result.days.every((d) => d.tasks.length === 0)).toBe(true)
    expect(Object.values(result.countsByType).every((n) => n === 0)).toBe(true)
    expect(result.takeOuts).toEqual({ open: [], doneThisWeek: [] })
  })

  it("splits take-outs into open ones (any due day) and ones done this week", async () => {
    answer(
      [takeOut("t-done", { status: "DONE", completedAt: new Date("2026-09-09T04:00:00.000Z") }), task({ id: "plain" })],
      [takeOut("t-open", { dueOn: new Date("2026-09-19T00:00:00.000Z") })],
    )
    const result = await getPersonWeek({}, USER, NOW)
    expect(result.takeOuts.open.map((t) => t.id)).toEqual(["t-open"])
    expect(result.takeOuts.doneThisWeek.map((t) => t.id)).toEqual(["t-done"])
    expect(result.takeOuts.open[0]).toMatchObject({ givenByName: "Admin Person", givenOn: "2026-09-05" })
  })

  it("makes two reads for the whole week and never one per day", async () => {
    await getPersonWeek({}, USER, NOW)
    expect(prisma.salesTask.findMany).toHaveBeenCalledTimes(2)
  })

  it("leaves cancelled tasks out and reads only this person's tasks", async () => {
    await getPersonWeek({}, USER, NOW)
    const where = mocked(prisma.salesTask.findMany).mock.calls.map((c) => c[0].where).find((w: any) => !w.origin)
    expect(where).toMatchObject({ assignedToEmployeeId: "emp-1", status: { not: "CANCELLED" } })
  })

  it("shows a Sales Admin another person's week", async () => {
    mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-admin" } })
    const result = await getPersonWeek({ employeeId: "emp-2" }, ADMIN, NOW)
    expect(result.employee.id).toBe("emp-2")
  })

  it("refuses a Sales User who may not read the team", async () => {
    await expect(getPersonWeek({ employeeId: "emp-2" }, USER, NOW)).rejects.toMatchObject({
      statusCode: 403, message: FUNNEL_NOT_YOURS,
    })
    expect(prisma.salesTask.findMany).not.toHaveBeenCalled()
  })

  it("says plainly when the person has no sales profile", async () => {
    mocked(prisma.user.findUnique).mockResolvedValue({ employee: null })
    await expect(getPersonWeek({}, SUPER, NOW)).rejects.toMatchObject({ statusCode: 404, message: NO_SALES_PROFILE })
  })
})
