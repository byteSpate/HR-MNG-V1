import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    salesAccount: { findFirst: vi.fn() },
    opportunity: { findFirst: vi.fn() },
    salesMeeting: { findFirst: vi.fn() },
    salesTask: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { changeTaskStatus, createTask, getTask, listTasks, updateTask } from "./task.service"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "rahim@demo.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any
const ADMIN = { ...USER, sub: "user-9", salesRole: "SALES_ADMIN" } as any

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1", origin: "SELF", salesAccountId: "account-1", opportunityId: null, meetingId: null,
  projectId: null, funnelMeetingId: null, title: "Call back about the quote", detail: null,
  dueOn: new Date("2026-09-20T00:00:00.000Z"), priority: "NORMAL",
  assignedToEmployeeId: "emp-1", assignedByEmployeeId: null,
  status: "PENDING", outcome: null, cancelReason: null, completedAt: null, completedBy: null,
  createdAt: new Date("2026-09-13T06:00:00.000Z"), updatedAt: new Date("2026-09-13T06:00:00.000Z"),
  salesAccount: { name: "Bengal Group" }, opportunity: null, meeting: null,
  assignedTo: { fullName: "Rahim" },
  ...overrides,
})

const BASE = { salesAccountId: "account-1", title: "Call back about the quote", dueOn: "2026-09-20" }

/** 02:00 on 15 Sep in Dhaka is still 14 Sep in UTC: the office date is the 15th. */
const NOW = new Date("2026-09-14T20:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  // The caller is emp-1 and works account-1 unless a test says otherwise.
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "account-1", ownerEmployeeId: "emp-1" } as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({ id: "opp-1" } as any)
  vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue({ id: "meeting-1" } as any)
  vi.mocked(prisma.salesTask.create).mockResolvedValue(task() as any)
  vi.mocked(prisma.salesTask.findFirst).mockResolvedValue(task() as any)
  vi.mocked(prisma.salesTask.update).mockImplementation((async (args: any) => task({ ...args.data })) as never)
  vi.mocked(prisma.salesTask.findMany).mockResolvedValue([] as any)
})

const createData = () => (vi.mocked(prisma.salesTask.create).mock.calls[0][0] as any).data
const updateData = () => (vi.mocked(prisma.salesTask.update).mock.calls[0][0] as any).data
const listWhere = () => (vi.mocked(prisma.salesTask.findMany).mock.calls[0][0] as any).where

describe("making a task", () => {
  it("always makes the task for the caller, as their own, whatever the body says", async () => {
    await createTask({ ...BASE, assignedToEmployeeId: "emp-9", origin: "FUNNEL_MEETING" } as any, USER)

    expect(createData()).toMatchObject({
      assignedToEmployeeId: "emp-1", assignedByEmployeeId: null, origin: "SELF",
      salesAccountId: "account-1", title: "Call back about the quote",
    })
  })

  it("stores the due date at UTC midnight and defaults the priority to normal", async () => {
    await createTask(BASE as any, USER)

    expect(createData().dueOn.toISOString()).toBe("2026-09-20T00:00:00.000Z")
    expect(createData().priority).toBe("NORMAL")
  })

  it("writes an audit row and a task event, in one transaction", async () => {
    await createTask(BASE as any, USER)

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_TASK", action: "CREATE" }),
    }))
    // Keyed to the task, not the account: the account's Timeline is open to
    // every hub member, and a task is for the people who work the account.
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "sales.task.created", entity: "SALES_TASK", subjectEmployeeId: "emp-1",
      }),
    }))
  })

  it("refuses a caller with no employee record, plainly", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as any)

    await expect(createTask(BASE as any, ADMIN)).rejects.toThrow(/employee record/i)
    expect(prisma.salesTask.create).not.toHaveBeenCalled()
  })

  it("refuses an account the caller does not work", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(createTask(BASE as any, USER)).rejects.toMatchObject({ statusCode: 404 })
    expect(prisma.salesTask.create).not.toHaveBeenCalled()
  })

  it("refuses a deal or a meeting from another account", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(null)
    await expect(createTask({ ...BASE, opportunityId: "opp-9" } as any, USER)).rejects.toThrow(/deal/i)
    expect(prisma.opportunity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "opp-9", salesAccountId: "account-1" },
    }))

    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(null)
    await expect(createTask({ ...BASE, meetingId: "meeting-9" } as any, USER)).rejects.toThrow(/meeting/i)
    expect(prisma.salesTask.create).not.toHaveBeenCalled()
  })
})

describe("changing a task", () => {
  it("lets the owner change the title, date and priority, with an audit row", async () => {
    await updateTask("task-1", { dueOn: "2026-09-25", priority: "HIGH" } as any, USER)

    expect(updateData().dueOn.toISOString()).toBe("2026-09-25T00:00:00.000Z")
    expect(updateData().priority).toBe("HIGH")
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_TASK", action: "UPDATE" }),
    }))
  })

  it("refuses anyone but the owner, a Sales Admin included, in the same words as a missing task", async () => {
    vi.mocked(prisma.salesTask.findFirst).mockResolvedValue(task({ assignedToEmployeeId: "emp-2" }) as any)

    await expect(updateTask("task-1", { title: "Mine now" } as any, USER))
      .rejects.toMatchObject({ statusCode: 404 })
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-7" } } as any)
    await expect(changeTaskStatus("task-1", { status: "DONE" } as any, ADMIN))
      .rejects.toMatchObject({ statusCode: 404 })
    expect(prisma.salesTask.update).not.toHaveBeenCalled()
  })
})

describe("ending a task", () => {
  it("marks it done with an optional outcome, stamped, and offers the next follow-up in 15 days", async () => {
    const result = await changeTaskStatus("task-1", { status: "DONE", outcome: "Quote accepted" } as any, USER, NOW)

    expect(updateData()).toMatchObject({ status: "DONE", outcome: "Quote accepted", completedBy: "user-1" })
    expect(updateData().completedAt).toBeInstanceOf(Date)
    // Office date 15 Sep, plus 15 days.
    expect(result.nextFollowUpOn).toBe("2026-09-30")
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "sales.task.completed", entity: "SALES_TASK" }),
    }))
  })

  it("cancels it with a reason, and offers no follow-up", async () => {
    const result = await changeTaskStatus("task-1", { status: "CANCELLED", reason: "Customer went quiet" } as any, USER, NOW)

    expect(updateData()).toMatchObject({ status: "CANCELLED", cancelReason: "Customer went quiet" })
    expect(result.nextFollowUpOn).toBeNull()
  })

  it("reopens a done task and clears what closed it", async () => {
    vi.mocked(prisma.salesTask.findFirst).mockResolvedValue(task({
      status: "DONE", outcome: "Called", completedAt: NOW, completedBy: "user-1",
    }) as any)

    await changeTaskStatus("task-1", { status: "PENDING" } as any, USER, NOW)

    expect(updateData()).toMatchObject({
      status: "PENDING", outcome: null, cancelReason: null, completedAt: null, completedBy: null,
    })
  })

  it("refuses a change to the status it already has", async () => {
    await expect(changeTaskStatus("task-1", { status: "PENDING" } as any, USER, NOW)).rejects.toThrow(/already/i)
  })
})

describe("who sees tasks", () => {
  it("shows a Sales User their own tasks and those on accounts they work", async () => {
    await listTasks({} as any, USER, NOW)

    expect(listWhere().AND).toContainEqual({
      OR: [
        { assignedToEmployeeId: "emp-1" },
        { salesAccount: { OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }] } },
      ],
    })
  })

  it("shows a Sales Admin every task", async () => {
    await listTasks({} as any, ADMIN, NOW)

    expect(listWhere().AND).toEqual([])
  })

  it("reads the due filters against the office date", async () => {
    await listTasks({ due: "overdue" } as any, USER, NOW)
    expect(listWhere()).toMatchObject({ status: "PENDING", dueOn: { lt: new Date("2026-09-15T00:00:00.000Z") } })

    vi.mocked(prisma.salesTask.findMany).mockClear()
    await listTasks({ due: "today" } as any, USER, NOW)
    expect(listWhere()).toMatchObject({ dueOn: new Date("2026-09-15T00:00:00.000Z") })

    vi.mocked(prisma.salesTask.findMany).mockClear()
    await listTasks({ due: "week" } as any, USER, NOW)
    expect(listWhere()).toMatchObject({
      dueOn: { gte: new Date("2026-09-15T00:00:00.000Z"), lt: new Date("2026-09-22T00:00:00.000Z") },
    })
  })

  it("passes status, origin and mine through, soonest due first", async () => {
    await listTasks({ status: "DONE", origin: "SELF", mine: true } as any, USER, NOW)

    const args = vi.mocked(prisma.salesTask.findMany).mock.calls[0][0] as any
    expect(args.where).toMatchObject({ status: "DONE", origin: "SELF", assignedToEmployeeId: "emp-1" })
    expect(args.orderBy[0]).toEqual({ dueOn: "asc" })
  })

  it("lets only the owner change a task they can see", async () => {
    vi.mocked(prisma.salesTask.findMany).mockResolvedValue([
      task(), task({ id: "task-2", assignedToEmployeeId: "emp-2", assignedTo: { fullName: "Karim" } }),
    ] as any)

    const { items } = await listTasks({} as any, USER, NOW)

    expect(items.map((item) => [item.id, item.canManage])).toEqual([["task-1", true], ["task-2", false]])
    expect(items[1].assignedToName).toBe("Karim")
  })

  it("reads one task through the same visibility, and 404s outside it", async () => {
    await getTask("task-1", USER)
    const where = (vi.mocked(prisma.salesTask.findFirst).mock.calls[0][0] as any).where
    expect(where.AND[0]).toEqual({ id: "task-1" })

    vi.mocked(prisma.salesTask.findFirst).mockResolvedValue(null)
    await expect(getTask("task-9", USER)).rejects.toMatchObject({ statusCode: 404 })
  })
})
