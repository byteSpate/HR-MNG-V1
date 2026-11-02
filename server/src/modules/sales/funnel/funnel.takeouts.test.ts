import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => {
  const tx = {
    salesAccount: { findUnique: vi.fn() },
    salesTask: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    employee: { findFirst: vi.fn() },
    opportunity: { findUnique: vi.fn() },
  }
  return {
    default: {
      $transaction: vi.fn(async (fn: (c: unknown) => unknown) => fn(tx)),
      __tx: tx,
      user: { findUnique: vi.fn() },
      employee: { findUnique: vi.fn() },
      salesTask: { findMany: vi.fn() },
      salesPermission: { findMany: vi.fn() },
    },
  }
})

import prisma from "../../../config/prisma"
import { clearPermissionCache } from "../sales.permissions"
import { ACTION_DEAL_MISSING, ACTIONS_NEED_EMPLOYEE, ASSIGNEE_NOT_SALES } from "./funnel.actions"
import { FUNNEL_NOT_YOURS } from "./funnel.service"
import { createTakeOut, listTakeOuts, TAKE_OUT_ADMIN_ONLY } from "./funnel.takeouts"

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const tx = (prisma as unknown as { __tx: Record<string, Record<string, unknown>> }).__tx

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as never
const ADMIN = { sub: "user-2", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as never

/** A Saturday: the take-out falls due the Saturday after. */
const NOW = new Date("2026-09-19T09:00:00.000Z")

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1", origin: "TAKE_OUT", type: "OTHER", salesAccountId: null, opportunityId: null, meetingId: null,
  title: "Chase the CFO", detail: null, dueOn: new Date("2026-09-26T00:00:00.000Z"), priority: "NORMAL",
  status: "PENDING", assignedToEmployeeId: "emp-1", assignedByEmployeeId: "emp-admin",
  assignedTo: { fullName: "Rahim Uddin" }, assignedBy: { fullName: "Admin Person" },
  outcome: null, cancelReason: null, completedAt: null,
  createdAt: new Date("2026-09-19T09:00:00.000Z"), updatedAt: new Date("2026-09-19T09:00:00.000Z"),
  salesAccount: null, opportunity: null, meeting: null,
  ...overrides,
})

const createData = () => (mocked(tx.salesTask.create).mock.calls[0][0] as { data: Record<string, any> }).data
const findWhere = () => (mocked(prisma.salesTask.findMany).mock.calls[0][0] as { where: Record<string, any> }).where

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-admin" } })
  mocked(prisma.salesPermission.findMany).mockResolvedValue([])
  mocked(prisma.employee.findUnique).mockImplementation(async (args: any) => ({ id: args.where.id, fullName: "Rahim Uddin" }))
  mocked(tx.employee.findFirst).mockResolvedValue({ id: "emp-1" })
  mocked(tx.salesTask.create).mockResolvedValue(row())
  mocked(prisma.salesTask.findMany).mockResolvedValue([row()])
})

describe("giving a take-out", () => {
  const BODY = { assignedToEmployeeId: "emp-1", title: "Chase the CFO" }

  it("lets a Sales Admin give one without an open meeting", async () => {
    await createTakeOut(BODY, ADMIN, NOW)

    expect(createData()).toMatchObject({
      origin: "TAKE_OUT", funnelMeetingId: null, assignedToEmployeeId: "emp-1",
      assignedByEmployeeId: "emp-admin", title: "Chase the CFO",
    })
  })

  it("falls due the next Saturday when no date is given", async () => {
    await createTakeOut(BODY, ADMIN, NOW)
    expect(createData().dueOn.toISOString()).toBe("2026-09-26T00:00:00.000Z")
  })

  it("takes the Opportunity's account when it is tied to an Opportunity", async () => {
    mocked(tx.opportunity.findUnique).mockResolvedValue({ id: "opp-1", salesAccountId: "acc-1" })
    await createTakeOut({ ...BODY, opportunityId: "opp-1", salesAccountId: "acc-other" }, ADMIN, NOW)
    expect(createData()).toMatchObject({ opportunityId: "opp-1", salesAccountId: "acc-1" })
  })

  it("writes an audit row that says it was a take-out", async () => {
    await createTakeOut(BODY, ADMIN, NOW)
    const audit = mocked(tx.auditLog.create).mock.calls[0][0].data
    expect(audit).toMatchObject({ entity: "SALES_TASK", action: "CREATE", note: "Given as a take-out" })
  })

  it("is refused to a Sales User and saves nothing", async () => {
    await expect(createTakeOut(BODY, USER, NOW)).rejects.toMatchObject({ statusCode: 403, message: TAKE_OUT_ADMIN_ONLY })
    expect(tx.salesTask.create).not.toHaveBeenCalled()
  })

  it("refuses somebody who is not in the Sales Hub", async () => {
    mocked(tx.employee.findFirst).mockResolvedValue(null)
    await expect(createTakeOut(BODY, ADMIN, NOW)).rejects.toMatchObject({ statusCode: 400, message: ASSIGNEE_NOT_SALES })
    expect(tx.salesTask.create).not.toHaveBeenCalled()
  })

  it("refuses an Opportunity that does not exist", async () => {
    mocked(tx.opportunity.findUnique).mockResolvedValue(null)
    await expect(createTakeOut({ ...BODY, opportunityId: "opp-9" }, ADMIN, NOW)).rejects.toMatchObject({
      statusCode: 400, message: ACTION_DEAL_MISSING,
    })
  })

  it("needs the giver to have an employee record", async () => {
    mocked(prisma.user.findUnique).mockResolvedValue({ employee: null })
    await expect(createTakeOut(BODY, ADMIN, NOW)).rejects.toMatchObject({ statusCode: 409, message: ACTIONS_NEED_EMPLOYEE })
  })
})

describe("listing take-outs", () => {
  beforeEach(() => {
    mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } })
  })

  it("shows a person their own, from both a meeting and outside one", async () => {
    await listTakeOuts({}, USER, NOW)
    expect(findWhere()).toMatchObject({
      assignedToEmployeeId: "emp-1", origin: { in: ["FUNNEL_MEETING", "TAKE_OUT"] },
    })
  })

  it("lets a Sales Admin read another person's", async () => {
    await listTakeOuts({ employeeId: "emp-2" }, ADMIN, NOW)
    expect(findWhere().assignedToEmployeeId).toBe("emp-2")
  })

  it("refuses a Sales User who is not allowed to read the team", async () => {
    await expect(listTakeOuts({ employeeId: "emp-2" }, USER, NOW)).rejects.toMatchObject({
      statusCode: 403, message: FUNNEL_NOT_YOURS,
    })
    expect(prisma.salesTask.findMany).not.toHaveBeenCalled()
  })

  it("lets a Sales User read another person's once the team switch is on", async () => {
    mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "team.funnel", enabled: true }])
    await listTakeOuts({ employeeId: "emp-2" }, USER, NOW)
    expect(findWhere().assignedToEmployeeId).toBe("emp-2")
  })

  it("filters by Opportunity, by status and by the day range", async () => {
    await listTakeOuts({ opportunityId: "opp-1", status: "PENDING", from: "2026-09-13", to: "2026-09-19" }, USER, NOW)
    expect(findWhere()).toMatchObject({ opportunityId: "opp-1", status: "PENDING" })
    expect(JSON.stringify(findWhere())).toContain("completedAt")
  })

  it("puts open ones first, then by due day", async () => {
    await listTakeOuts({}, USER, NOW)
    const orderBy = (mocked(prisma.salesTask.findMany).mock.calls[0][0] as { orderBy: unknown[] }).orderBy
    expect(orderBy[0]).toEqual({ status: "asc" })
    expect(orderBy[1]).toEqual({ dueOn: "asc" })
  })

  it("says who gave each one and on which day", async () => {
    const [item] = await listTakeOuts({}, USER, NOW)
    expect(item).toMatchObject({ givenByName: "Admin Person", givenOn: "2026-09-19", origin: "TAKE_OUT" })
  })
})
