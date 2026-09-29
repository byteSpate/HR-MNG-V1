import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    idCounter: { upsert: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    employee: { findMany: vi.fn(), findUnique: vi.fn() },
    salesAccount: { findUnique: vi.fn() },
    opportunity: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    projectTeamMember: { findFirst: vi.fn() },
    salesTask: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))
vi.mock("../../dealMoney/dealMoney.cost", () => ({ dealCostLineWhere: vi.fn().mockResolvedValue({}) }))

import prisma from "../../../config/prisma"
import { addProjectTask, cancelProjectTask, listProjectTasks } from "./project.task.service"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "user-9", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const NOW = new Date("2026-09-28T10:00:00.000Z")
const OUTSIDER = "33333333-3333-4333-8333-333333333333"

const projectRow = (o: Record<string, unknown> = {}) => ({
  id: "prj-1", serial: "BS-PRJ-00001", name: "Core refresh", opportunityId: "opp-1", salesAccountId: "acc-1",
  managerEmployeeId: "emp-1", startOn: null, dueOn: null, priority: "NORMAL", budget: null,
  status: "IN_PROGRESS", statusReason: null, completedAt: null, createdBy: "user-1", createdAt: NOW, updatedAt: NOW,
  manager: { id: "emp-1", fullName: "Rahim" },
  salesAccount: { id: "acc-1", name: "Rising Group", ownerEmployeeId: "emp-1", assignments: [{ employeeId: "emp-2" }] },
  opportunity: {
    id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", track: "NETWORKING", amount: null, lines: [],
  },
  team: [{ employeeId: "emp-2", responsibility: "Install", employee: { id: "emp-2", fullName: "Karim" } }],
  milestones: [],
  tasks: [],
  ...o,
})

const TASK = (o: Record<string, unknown> = {}) => ({
  id: "t1", origin: "PROJECT", projectId: "prj-1", salesAccountId: "acc-1", opportunityId: "opp-1", meetingId: null,
  title: "Rack the firewall", detail: null, dueOn: new Date("2026-10-02T00:00:00.000Z"), priority: "NORMAL",
  assignedToEmployeeId: "emp-2", assignedByEmployeeId: "emp-1", status: "PENDING", outcome: null, cancelReason: null,
  completedAt: null, createdAt: NOW, updatedAt: NOW,
  salesAccount: { name: "Rising Group" }, opportunity: { serial: "BS-OPP-00001", name: "Core refresh" },
  meeting: null, assignedTo: { fullName: "Karim" },
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  // The Project Manager by default.
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow() as any)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([{ id: OUTSIDER, fullName: "Salma" }] as any)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({ fullName: "Salma" } as any)
  vi.mocked(prisma.salesTask.findMany).mockResolvedValue([TASK()] as any)
  vi.mocked(prisma.salesTask.create).mockResolvedValue(TASK() as any)
  vi.mocked(prisma.salesTask.findUnique).mockResolvedValue(TASK() as any)
  vi.mocked(prisma.salesTask.update).mockResolvedValue(TASK({ status: "CANCELLED", cancelReason: "Not needed" }) as any)
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)
  vi.mocked(prisma.event.create).mockResolvedValue({} as any)
})

describe("Project Tasks", () => {
  it("lets the Project Manager give a task to a team member", async () => {
    await addProjectTask("prj-1", { title: "Rack the firewall", dueOn: "2026-10-02", assigneeEmployeeId: "emp-2" }, USER)
    expect(prisma.salesTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        origin: "PROJECT", projectId: "prj-1", salesAccountId: "acc-1", opportunityId: "opp-1",
        assignedToEmployeeId: "emp-2", assignedByEmployeeId: "emp-1", title: "Rack the firewall",
        // Priority is never asked for on a Project Task and is not shown.
        priority: "NORMAL",
      }),
    }))
  })

  it("stores the due date as a plain day, so no timezone can move it", async () => {
    await addProjectTask("prj-1", { title: "Rack the firewall", dueOn: "2026-10-02", assigneeEmployeeId: "emp-2" }, USER)
    const data = vi.mocked(prisma.salesTask.create).mock.calls[0][0].data as any
    expect(data.dueOn.toISOString()).toBe("2026-10-02T00:00:00.000Z")
  })

  it("refuses someone outside the Project Team (Review Focus 5)", async () => {
    await expect(addProjectTask("prj-1", { title: "X task", dueOn: "2026-10-02", assigneeEmployeeId: OUTSIDER }, USER))
      .rejects.toThrow("Salma is not on this Project's team. Add them to the team first.")
    expect(prisma.salesTask.create).not.toHaveBeenCalled()
  })

  it("names the person even when the directory has no name for them", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as any)
    await expect(addProjectTask("prj-1", { title: "X task", dueOn: "2026-10-02", assigneeEmployeeId: OUTSIDER }, USER))
      .rejects.toThrow("That person is not on this Project's team.")
  })

  it("lets a team member add a task only for themselves", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    await expect(addProjectTask("prj-1", { title: "X task", dueOn: "2026-10-02", assigneeEmployeeId: "emp-1" }, USER))
      .rejects.toThrow("You can add a task only for yourself. The Project Manager gives tasks to others.")
    await addProjectTask("prj-1", { title: "My task", dueOn: "2026-10-02", assigneeEmployeeId: "emp-2" }, USER)
    expect(vi.mocked(prisma.salesTask.create).mock.calls[0][0].data).toMatchObject({ assignedByEmployeeId: null })
  })

  it("refuses somebody who is on neither the team nor the Project", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-9" } } as any)
    await expect(addProjectTask("prj-1", { title: "X task", dueOn: "2026-10-02", assigneeEmployeeId: "emp-1" }, USER))
      .rejects.toThrow("Only the Project Team, the Project Manager or a Sales Admin can add a task.")
  })

  it("lets a Sales Admin add a task without being on the team", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-9" } } as any)
    await addProjectTask("prj-1", { title: "X task", dueOn: "2026-10-02", assigneeEmployeeId: "emp-2" }, ADMIN)
    expect(prisma.salesTask.create).toHaveBeenCalled()
  })

  it("lets a team member take work even when the Project is not started", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({ status: "NOT_STARTED" }) as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    await addProjectTask("prj-1", { title: "My task", dueOn: "2026-10-02", assigneeEmployeeId: "emp-2" }, USER)
    expect(prisma.salesTask.create).toHaveBeenCalled()
  })

  it("refuses a task on a Project the caller cannot see", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null as any)
    await expect(addProjectTask("prj-1", { title: "X task", dueOn: "2026-10-02", assigneeEmployeeId: "emp-2" }, USER))
      .rejects.toThrow("That Project does not exist, or is not yours")
  })

  it("audits the task, so the Project's History records who was given what", async () => {
    await addProjectTask("prj-1", { title: "Rack the firewall", dueOn: "2026-10-02", assigneeEmployeeId: "emp-2" }, USER)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_TASK", action: "CREATE" }),
    }))
  })

  it("gives the task to the caller when no assignee is sent, so a page never has to guess who is asking", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    await addProjectTask("prj-1", { title: "My task", dueOn: "2026-10-02" }, USER)
    expect(vi.mocked(prisma.salesTask.create).mock.calls[0][0].data).toMatchObject({
      assignedToEmployeeId: "emp-2", assignedByEmployeeId: null,
    })
  })

  it("gives the Project Manager's own task to the Project Manager when no assignee is sent", async () => {
    await addProjectTask("prj-1", { title: "My task", dueOn: "2026-10-02" }, USER)
    expect(vi.mocked(prisma.salesTask.create).mock.calls[0][0].data).toMatchObject({ assignedToEmployeeId: "emp-1" })
  })

  it("says the person is not on the team when a Sales Admin with no place on it sends no assignee", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-9" } } as any)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ fullName: "Admin Anwar" } as any)
    await expect(addProjectTask("prj-1", { title: "X task", dueOn: "2026-10-02" }, ADMIN))
      .rejects.toThrow("Admin Anwar is not on this Project's team. Add them to the team first.")
  })

  it("marks a task as the caller's to close only when the caller is its assignee", async () => {
    vi.mocked(prisma.salesTask.findMany).mockResolvedValue([
      TASK({ id: "mine", assignedToEmployeeId: "emp-1" }), TASK({ id: "theirs", assignedToEmployeeId: "emp-2" }),
    ] as any)
    const asManager = await listProjectTasks("prj-1", USER)
    // The Project Manager may cancel any task, but closing one is the assignee's.
    expect(asManager.map((t) => [t.id, t.canManage])).toEqual([["mine", true], ["theirs", false]])
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    const asMember = await listProjectTasks("prj-1", USER)
    expect(asMember.map((t) => [t.id, t.canManage])).toEqual([["mine", false], ["theirs", true]])
  })

  it("lists the Project's tasks", async () => {
    const tasks = await listProjectTasks("prj-1", USER)
    expect(prisma.salesTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "prj-1" } }))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ id: "t1", title: "Rack the firewall" })
  })

  it("lets the Project Manager cancel a Project Task with a reason", async () => {
    await cancelProjectTask("t1", { reason: "Not needed" }, USER)
    expect(prisma.salesTask.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED", cancelReason: "Not needed" }),
    }))
  })

  it("keeps the reason in the audit, so the cancel can be explained later", async () => {
    await cancelProjectTask("t1", { reason: "Not needed" }, USER)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ note: "Not needed" }),
    }))
  })

  it("refuses a cancel from somebody who is only a team member", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    await expect(cancelProjectTask("t1", { reason: "Not needed" }, USER))
      .rejects.toThrow("Only the Project Manager or a Sales Admin can cancel a Project Task.")
  })

  it("refuses a cancel of a task that is not a Project Task", async () => {
    vi.mocked(prisma.salesTask.findUnique).mockResolvedValue(TASK({ projectId: null }) as any)
    await expect(cancelProjectTask("t1", { reason: "Not needed" }, USER))
      .rejects.toThrow("That task does not exist, or is not yours")
  })

  it("refuses a cancel of a task that does not exist", async () => {
    vi.mocked(prisma.salesTask.findUnique).mockResolvedValue(null as any)
    await expect(cancelProjectTask("t1", { reason: "Not needed" }, USER))
      .rejects.toThrow("That task does not exist, or is not yours")
  })

  it("refuses a second cancel, because a done task is not a pending one", async () => {
    vi.mocked(prisma.salesTask.findUnique).mockResolvedValue(TASK({ status: "DONE" }) as any)
    await expect(cancelProjectTask("t1", { reason: "Not needed" }, USER))
      .rejects.toThrow("Only a pending task can be cancelled.")
  })
})
