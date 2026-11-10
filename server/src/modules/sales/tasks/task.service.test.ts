import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
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

import prisma from "../../../config/prisma"
import { changeTaskStatus, createTask, getTask, listTasks, logDoneTask, updateTask } from "./task.service"
import { presentTask } from "./task.present"
import { officeDateOf } from "../../attendance/attendance.time"

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
    await expect(createTask({ ...BASE, opportunityId: "opp-9" } as any, USER)).rejects.toThrow(/Opportunity/i)
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

  it("counts the day the person says it was done, not the day the button was pressed", async () => {
    await changeTaskStatus("task-1", { status: "DONE", doneOn: "2026-09-10" } as any, USER, NOW)

    expect(updateData().completedAt.getTime()).toBeLessThan(NOW.getTime() - 3 * 24 * 3600 * 1000)
  })

  it("refuses a done day in the future", async () => {
    await expect(changeTaskStatus("task-1", { status: "DONE", doneOn: "2026-09-20" } as any, USER, NOW))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.salesTask.update).not.toHaveBeenCalled()
  })

  it("editing the day of a done task moves the day it counts for", async () => {
    vi.mocked(prisma.salesTask.findFirst).mockResolvedValue(task({ status: "DONE", completedAt: NOW }) as any)
    await updateTask("task-1", { dueOn: "2026-09-02" } as any, USER)

    expect(updateData().dueOn.toISOString()).toBe("2026-09-02T00:00:00.000Z")
    expect(updateData().completedAt.getTime()).toBeLessThan(NOW.getTime() - 10 * 24 * 3600 * 1000)
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

    // What the overview's "Tasks due or overdue" row links to.
    vi.mocked(prisma.salesTask.findMany).mockClear()
    await listTasks({ due: "now" } as any, USER, NOW)
    expect(listWhere()).toMatchObject({ status: "PENDING", dueOn: { lte: new Date("2026-09-15T00:00:00.000Z") } })

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

describe("a Project Task on the Tasks page", () => {
  const projectTask = (overrides: Record<string, unknown> = {}) =>
    task({ origin: "PROJECT", projectId: "prj-1", ...overrides })

  it("lets the assignee mark it done, as for any task", async () => {
    vi.mocked(prisma.salesTask.findFirst).mockResolvedValue(projectTask() as any)
    const result = await changeTaskStatus("task-1", { status: "DONE" } as any, USER, NOW)
    expect(result.status).toBe("DONE")
  })

  it("does not let the assignee cancel it, because only the Project Manager may", async () => {
    vi.mocked(prisma.salesTask.findFirst).mockResolvedValue(projectTask() as any)
    await expect(changeTaskStatus("task-1", { status: "CANCELLED", reason: "No time" } as any, USER, NOW))
      .rejects.toThrow("Only the Project Manager or a Sales Admin can cancel a Project Task. Ask them to cancel it on the Project's Tasks tab.")
    expect(prisma.salesTask.update).not.toHaveBeenCalled()
  })

  it("does not let the assignee bring a cancelled one back", async () => {
    vi.mocked(prisma.salesTask.findFirst).mockResolvedValue(projectTask({ status: "CANCELLED", cancelReason: "Not needed" }) as any)
    await expect(changeTaskStatus("task-1", { status: "PENDING" } as any, USER, NOW))
      .rejects.toThrow("This Project Task was cancelled by the Project Manager. Ask them to add it again.")
    expect(prisma.salesTask.update).not.toHaveBeenCalled()
  })

  it("still lets a person cancel their own ordinary task", async () => {
    const result = await changeTaskStatus("task-1", { status: "CANCELLED", reason: "Customer went quiet" } as any, USER, NOW)
    expect(result.status).toBe("CANCELLED")
  })
})

describe("a task with no account (owner, 2026-11-02)", () => {
  it("makes a task with no account for the signed-in employee", async () => {
    await createTask({ title: "Read the VAT guide", dueOn: "2026-09-20", type: "LEARNING" } as any, USER)

    expect(createData()).toMatchObject({
      salesAccountId: null, assignedToEmployeeId: "emp-1", origin: "SELF", type: "LEARNING",
    })
    expect(prisma.salesAccount.findFirst).not.toHaveBeenCalled()
  })

  it("makes the type Other when none is given", async () => {
    await createTask(BASE as any, USER)
    expect(createData().type).toBe("OTHER")
  })

  it("still checks the account when there is one", async () => {
    await createTask({ ...BASE, type: "VISIT_FOLLOW_UP" } as any, USER)
    expect(prisma.salesAccount.findFirst).toHaveBeenCalled()
    expect(createData()).toMatchObject({ salesAccountId: "account-1", type: "VISIT_FOLLOW_UP" })
  })
})

describe("changing a task's type", () => {
  it("changes the type and records it in the audit row", async () => {
    await updateTask("task-1", { type: "QUOTATION_SENT" } as any, USER)
    expect(updateData()).toEqual({ type: "QUOTATION_SENT" })
    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any
    expect(JSON.stringify(audit)).toContain("QUOTATION_SENT")
  })
})

describe("I did this", () => {
  const DONE = { title: "Sent the BOQ", type: "QUOTATION_SENT", doneOn: "2026-09-15" }

  it("saves an already done task dated to the day picked", async () => {
    vi.mocked(prisma.salesTask.create).mockImplementation((async (args: any) => task({ ...args.data })) as never)
    const saved = await logDoneTask(DONE as any, USER, NOW)

    expect(createData()).toMatchObject({
      status: "DONE", completedBy: "user-1", assignedToEmployeeId: "emp-1", type: "QUOTATION_SENT", origin: "SELF", salesAccountId: null,
    })
    expect(createData().dueOn.toISOString()).toBe("2026-09-15T00:00:00.000Z")
    // The day the person picked, in office time.
    expect(officeDateOf(createData().completedAt).toISOString()).toBe("2026-09-15T00:00:00.000Z")
    expect(saved.status).toBe("DONE")
  })

  it("accepts an earlier day", async () => {
    await logDoneTask({ ...DONE, doneOn: "2026-09-10" } as any, USER, NOW)
    expect(officeDateOf(createData().completedAt).toISOString()).toBe("2026-09-10T00:00:00.000Z")
  })

  it("refuses a future day and saves nothing", async () => {
    await expect(logDoneTask({ ...DONE, doneOn: "2026-09-16" } as any, USER, NOW))
      .rejects.toThrow("Choose a day that is today or earlier.")
    expect(prisma.salesTask.create).not.toHaveBeenCalled()
  })

  it("refuses a day that is not on the calendar", async () => {
    await expect(logDoneTask({ ...DONE, doneOn: "2026-02-30" } as any, USER, NOW))
      .rejects.toThrow("2026-02-30 is not a date on the calendar")
    expect(prisma.salesTask.create).not.toHaveBeenCalled()
  })

  it("needs an employee record, with a plain message", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as any)
    await expect(logDoneTask(DONE as any, USER, NOW))
      .rejects.toThrow("Only an employee can have tasks, and your account has no employee record")
    expect(prisma.salesTask.create).not.toHaveBeenCalled()
  })

  it("puts it on the account when one is given", async () => {
    await logDoneTask({ ...DONE, salesAccountId: "account-1", opportunityId: "opp-1" } as any, USER, NOW)
    expect(createData()).toMatchObject({ salesAccountId: "account-1", opportunityId: "opp-1" })
  })
})

describe("listing for Logs and take-outs (owner, 2026-11-02)", () => {
  it("lists only tasks with no account when noAccount is true", async () => {
    await listTasks({ noAccount: true } as any, USER, NOW)
    expect(listWhere().salesAccountId).toBeNull()
  })

  it("filters by type", async () => {
    await listTasks({ type: "LEARNING" } as any, USER, NOW)
    expect(listWhere().type).toBe("LEARNING")
  })

  it("filters by the day a task counts for: done on that day, or due on it when not done", async () => {
    await listTasks({ from: "2026-09-13", to: "2026-09-17" } as any, USER, NOW)
    const text = JSON.stringify(listWhere())
    expect(text).toContain("completedAt")
    expect(text).toContain("dueOn")
  })

  it("lists take-outs as the tasks given at a meeting or outside one", async () => {
    await listTasks({ takeOuts: true } as any, USER, NOW)
    expect(listWhere().origin).toEqual({ in: ["FUNNEL_MEETING", "TAKE_OUT"] })
  })

  it("lets a Sales Admin list another person's tasks", async () => {
    await listTasks({ assignedToEmployeeId: "emp-5" } as any, ADMIN, NOW)
    expect(listWhere().assignedToEmployeeId).toBe("emp-5")
  })

  it("ignores that filter for anybody else, so they only ever see their own scope", async () => {
    await listTasks({ assignedToEmployeeId: "emp-5" } as any, USER, NOW)
    expect(listWhere().assignedToEmployeeId).toBeUndefined()
    expect(listWhere().AND).toEqual(expect.any(Array))
  })
})

describe("presenting a task", () => {
  const TODAY = new Date("2026-11-02T00:00:00.000Z")

  it("says who gave a take-out and on which day", () => {
    const shown = presentTask(
      task({ origin: "TAKE_OUT", type: "OTHER", assignedBy: { fullName: "Rima" }, createdAt: new Date("2026-11-01T06:00:00.000Z") }),
      false, TODAY,
    )
    expect(shown).toMatchObject({ origin: "TAKE_OUT", givenByName: "Rima", givenOn: "2026-11-01", type: "OTHER" })
  })

  it("says the same for a task given at a funnel meeting", () => {
    const shown = presentTask(task({ origin: "FUNNEL_MEETING", assignedBy: { fullName: "Rima" } }), false, TODAY)
    expect(shown.givenByName).toBe("Rima")
    expect(shown.givenOn).toBe("2026-09-13")
  })

  it("leaves the giver empty on a task a person made for themselves", () => {
    const shown = presentTask(task({ type: "LEARNING" }), true, TODAY)
    expect(shown).toMatchObject({ givenByName: null, givenOn: null, type: "LEARNING" })
  })

  it("gives the office day a task was done, so a screen never has to guess the time zone", () => {
    // 04:00 UTC is 10:00 in Dhaka, the same day; 20:00 UTC is 02:00 the next day there.
    const morning = presentTask(task({ status: "DONE", completedAt: new Date("2026-11-02T04:00:00.000Z") }), true, TODAY)
    const lateNight = presentTask(task({ status: "DONE", completedAt: new Date("2026-11-02T20:00:00.000Z") }), true, TODAY)
    expect(morning.doneOn).toBe("2026-11-02")
    expect(lateNight.doneOn).toBe("2026-11-03")
  })

  it("has no done day for a task that is not done", () => {
    expect(presentTask(task(), true, TODAY).doneOn).toBeNull()
  })

  it("reads a row with no type as Other", () => {
    expect(presentTask(task(), true, TODAY).type).toBe("OTHER")
  })
})

describe("searching the Tasks list (owner, 2026-11-10)", () => {
  it("searches the title, account and Opportunity, and keeps who may see what", async () => {
    await listTasks({ q: "quote" } as any, USER, NOW)
    expect(listWhere().AND).toContainEqual({
      OR: [
        { title: { contains: "quote", mode: "insensitive" } },
        { salesAccount: { name: { contains: "quote", mode: "insensitive" } } },
        { opportunity: { serial: { contains: "quote", mode: "insensitive" } } },
        { opportunity: { name: { contains: "quote", mode: "insensitive" } } },
      ],
    })
    // The scope is still in AND beside the search.
    expect(listWhere().AND.length).toBeGreaterThan(1)
  })
})
