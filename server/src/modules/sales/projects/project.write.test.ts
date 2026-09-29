import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    idCounter: { upsert: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    salesAccount: { findUnique: vi.fn() },
    opportunity: { findFirst: vi.fn() },
    opportunityLine: { findFirst: vi.fn() },
    project: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    projectTeamMember: { deleteMany: vi.fn(), createMany: vi.fn() },
    projectMilestone: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    projectLineDone: { upsert: vi.fn(), deleteMany: vi.fn() },
    journalLine: { aggregate: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))
vi.mock("../../dealMoney/dealMoney.cost", () => ({ dealCostLineWhere: vi.fn().mockResolvedValue({}) }))

import prisma from "../../../config/prisma"
import { Prisma } from "../../../generated/prisma/client"
import { changeProjectStatus, setProjectTeam, updateProject } from "./project.service"
import { addMilestone, removeMilestone, tickLine, untickLine, updateMilestone } from "./project.milestone.service"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OUTSIDER = "33333333-3333-4333-8333-333333333333"
const NOW = new Date("2026-09-28T10:00:00.000Z")
const d = (v: string) => new Prisma.Decimal(v)

const projectRow = (o: Record<string, unknown> = {}) => ({
  id: "prj-1", serial: "BS-PRJ-00001", name: "Core refresh", opportunityId: "opp-1", salesAccountId: "acc-1",
  managerEmployeeId: "emp-1", startOn: null, dueOn: null, priority: "NORMAL", budget: null,
  status: "NOT_STARTED", statusReason: null, completedAt: null, createdBy: "user-1", createdAt: NOW, updatedAt: NOW,
  manager: { id: "emp-1", fullName: "Rahim" },
  salesAccount: { id: "acc-1", name: "Rising Group", ownerEmployeeId: "emp-1", assignments: [{ employeeId: "emp-2" }] },
  opportunity: {
    id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", track: "NETWORKING", amount: d("100000"),
    lines: [
      { id: "l1", product: "Firewall", oemBrand: "Fortinet", model: "100F", quantity: 1, lineValue: d("80000"), marginPercent: d("10"), order: 0, supplier: { name: "Star Tech" }, projectTicks: [] },
    ],
  },
  team: [{ employeeId: "emp-2", responsibility: "Install", employee: { id: "emp-2", fullName: "Karim" } }],
  milestones: [],
  tasks: [],
  ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([{ id: OUTSIDER, fullName: "Salma" }] as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({
    id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", status: "WON",
    salesAccountId: "acc-1", ownerEmployeeId: "emp-1", project: null,
  } as any)
  vi.mocked(prisma.project.create).mockResolvedValue(projectRow() as any)
  vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow() as any)
  vi.mocked(prisma.project.update).mockResolvedValue(projectRow() as any)
  vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue({ id: "l1" } as any)
  vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: d("0"), credit: d("0") } } as any)
})

describe("project writes", () => {
  it("refuses someone who is not the manager or a Sales Admin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    await expect(updateProject("prj-1", { name: "New" }, USER))
      .rejects.toThrow("Only the Project Manager or a Sales Admin can change this Project.")
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it("lets a Sales Admin change a Project they do not manage", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    await updateProject("prj-1", { name: "New" }, { ...USER, salesRole: "SALES_ADMIN" })
    expect(prisma.project.update).toHaveBeenCalled()
  })

  it("refuses a team member who is not on the account, naming them (Review Focus 4)", async () => {
    await expect(setProjectTeam("prj-1", { members: [{ employeeId: OUTSIDER }] }, USER))
      .rejects.toThrow("Salma is not the Owner or a collaborator on Rising Group. A Sales Admin can add them to the account first.")
    expect(prisma.projectTeamMember.deleteMany).not.toHaveBeenCalled()
  })

  it("says 'Someone' when the outsider's name is not on file", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)
    await expect(setProjectTeam("prj-1", { members: [{ employeeId: OUTSIDER }] }, USER))
      .rejects.toThrow("Someone is not the Owner or a collaborator on Rising Group.")
  })

  it("replaces the team with people from the account", async () => {
    await setProjectTeam("prj-1", { members: [{ employeeId: "emp-2", responsibility: "Install" }] }, USER)
    expect(prisma.projectTeamMember.deleteMany).toHaveBeenCalledWith({ where: { projectId: "prj-1" } })
    expect(prisma.projectTeamMember.createMany).toHaveBeenCalledWith({
      data: [{ projectId: "prj-1", employeeId: "emp-2", responsibility: "Install" }],
    })
  })

  it("clears a responsibility typed as nothing", async () => {
    await setProjectTeam("prj-1", { members: [{ employeeId: "emp-2", responsibility: "   " }] }, USER)
    expect(prisma.projectTeamMember.createMany).toHaveBeenCalledWith({
      data: [{ projectId: "prj-1", employeeId: "emp-2", responsibility: null }],
    })
  })

  it("empties the team without writing empty rows", async () => {
    await setProjectTeam("prj-1", { members: [] }, USER)
    expect(prisma.projectTeamMember.deleteMany).toHaveBeenCalled()
    expect(prisma.projectTeamMember.createMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
  })

  it("refuses a manager who is not on the account", async () => {
    await expect(updateProject("prj-1", { managerEmployeeId: OUTSIDER }, USER))
      .rejects.toThrow("The Project Manager must be the Owner or a collaborator on Rising Group.")
  })

  it("refuses a finish date before the start date", async () => {
    await expect(updateProject("prj-1", { startOn: "2026-10-10", dueOn: "2026-10-01" }, USER))
      .rejects.toThrow("The finish date cannot be before the start date.")
  })

  it("refuses a finish date before a start date already on the Project", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({ startOn: new Date("2026-10-10T00:00:00.000Z") }) as any)
    await expect(updateProject("prj-1", { dueOn: "2026-10-01" }, USER))
      .rejects.toThrow("The finish date cannot be before the start date.")
  })

  it("saves only the fields that changed, and audits them", async () => {
    await updateProject("prj-1", { name: "Core refresh 2" }, USER)
    const data = vi.mocked(prisma.project.update).mock.calls[0][0].data as any
    expect(data).toEqual({ name: "Core refresh 2" })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        before: { name: "Core refresh" }, after: { name: "Core refresh 2" },
      }),
    }))
  })

  it("writes nothing and audits nothing when nothing changed", async () => {
    await updateProject("prj-1", { name: "Core refresh" }, USER)
    expect(prisma.project.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("saves a budget", async () => {
    await updateProject("prj-1", { budget: "50000" }, USER)
    expect(vi.mocked(prisma.project.update).mock.calls[0][0].data).toMatchObject({ budget: d("50000") })
  })

  it("clears a budget, so no budget is never ৳0", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({ budget: d("50000") }) as any)
    await updateProject("prj-1", { budget: null }, USER)
    expect(vi.mocked(prisma.project.update).mock.calls[0][0].data).toMatchObject({ budget: null })
  })

  it("writes nothing when a cleared budget is already clear", async () => {
    await updateProject("prj-1", { budget: null }, USER)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it("needs a reason for Blocked, On Hold and Cancelled", async () => {
    await expect(changeProjectStatus("prj-1", { status: "BLOCKED" }, USER))
      .rejects.toThrow("Say why the Project is blocked.")
    await expect(changeProjectStatus("prj-1", { status: "ON_HOLD" }, USER))
      .rejects.toThrow("Say why the Project is on hold.")
    await expect(changeProjectStatus("prj-1", { status: "CANCELLED" }, USER))
      .rejects.toThrow("Say why the Project is cancelled.")
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it("does not need a reason for In progress, and clears a reason it had", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({ status: "BLOCKED", statusReason: "No parts" }) as any)
    await changeProjectStatus("prj-1", { status: "IN_PROGRESS" }, USER)
    expect(vi.mocked(prisma.project.update).mock.calls[0][0].data).toMatchObject({ status: "IN_PROGRESS", statusReason: null })
  })

  it("stamps completedAt on Completed and clears it when leaving", async () => {
    await changeProjectStatus("prj-1", { status: "COMPLETED" }, USER)
    expect(vi.mocked(prisma.project.update).mock.calls[0][0].data).toMatchObject({ status: "COMPLETED", statusReason: null, completedAt: expect.any(Date) })
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({ status: "COMPLETED", completedAt: NOW }) as any)
    await changeProjectStatus("prj-1", { status: "IN_PROGRESS" }, USER)
    expect(vi.mocked(prisma.project.update).mock.calls[1][0].data).toMatchObject({ status: "IN_PROGRESS", completedAt: null })
  })

  it("never moves the completed date a Project already had", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({ status: "IN_PROGRESS", completedAt: NOW }) as any)
    await changeProjectStatus("prj-1", { status: "COMPLETED" }, USER)
    expect(vi.mocked(prisma.project.update).mock.calls[0][0].data).toMatchObject({ completedAt: NOW })
  })

  it("adds a milestone at the end", async () => {
    vi.mocked(prisma.projectMilestone.count).mockResolvedValue(2)
    vi.mocked(prisma.projectMilestone.create).mockResolvedValue({ id: "m1", title: "Delivery" } as any)
    await addMilestone("prj-1", { title: "Delivery", dueOn: "2026-10-05" }, USER)
    expect(prisma.projectMilestone.create).toHaveBeenCalledWith({
      data: { projectId: "prj-1", title: "Delivery", dueOn: new Date("2026-10-05T00:00:00.000Z"), order: 2 },
    })
  })

  it("adds a milestone with no date, never an invented one", async () => {
    vi.mocked(prisma.projectMilestone.count).mockResolvedValue(0)
    vi.mocked(prisma.projectMilestone.create).mockResolvedValue({ id: "m1", title: "Delivery" } as any)
    await addMilestone("prj-1", { title: "Delivery" }, USER)
    expect(prisma.projectMilestone.create).toHaveBeenCalledWith({
      data: { projectId: "prj-1", title: "Delivery", dueOn: null, order: 0 },
    })
  })

  it("lets a team member tick a line, and refuses a line from another Opportunity", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue({ id: "l1" } as any)
    await tickLine("prj-1", "l1", USER)
    expect(prisma.projectLineDone.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_opportunityLineId: { projectId: "prj-1", opportunityLineId: "l1" } },
    }))
    vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue(null as any)
    await expect(tickLine("prj-1", "l9", USER)).rejects.toThrow("That line is not on this Project's Opportunity.")
  })

  it("refuses a tick from someone on neither the team nor the account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-9" } } as any)
    await expect(tickLine("prj-1", "l1", USER))
      .rejects.toThrow("Only the Project Team, the Project Manager or a Sales Admin can tick a line.")
    expect(prisma.projectLineDone.upsert).not.toHaveBeenCalled()
  })

  it("unticks a line without inventing a person", async () => {
    await untickLine("prj-1", "l1", USER)
    expect(prisma.projectLineDone.deleteMany).toHaveBeenCalledWith({ where: { projectId: "prj-1", opportunityLineId: "l1" } })
  })

  it("reaches a milestone only through the Project that owns it", async () => {
    vi.mocked(prisma.projectMilestone.findUnique).mockResolvedValue({ id: "m1", projectId: "prj-1", title: "Delivery", doneAt: null, doneBy: null } as any)
    vi.mocked(prisma.projectMilestone.update).mockResolvedValue({ id: "m1" } as any)
    await updateMilestone("m1", { done: true }, USER)
    expect(prisma.projectMilestone.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "m1" }, data: expect.objectContaining({ doneBy: USER.sub }),
    }))
  })

  it("keeps the person who first reached a milestone", async () => {
    vi.mocked(prisma.projectMilestone.findUnique).mockResolvedValue({
      id: "m1", projectId: "prj-1", title: "Delivery", doneAt: NOW, doneBy: "user-original",
    } as any)
    vi.mocked(prisma.projectMilestone.update).mockResolvedValue({ id: "m1" } as any)
    await updateMilestone("m1", { done: true }, USER)
    expect(vi.mocked(prisma.projectMilestone.update).mock.calls[0][0].data).toMatchObject({ doneBy: "user-original" })
  })

  it("unticking a milestone clears the person as well as the date", async () => {
    vi.mocked(prisma.projectMilestone.findUnique).mockResolvedValue({
      id: "m1", projectId: "prj-1", title: "Delivery", doneAt: NOW, doneBy: "user-original",
    } as any)
    vi.mocked(prisma.projectMilestone.update).mockResolvedValue({ id: "m1" } as any)
    await updateMilestone("m1", { done: false }, USER)
    expect(vi.mocked(prisma.projectMilestone.update).mock.calls[0][0].data).toMatchObject({ doneAt: null, doneBy: null })
  })

  it("says a milestone that does not exist is not yours", async () => {
    vi.mocked(prisma.projectMilestone.findUnique).mockResolvedValue(null as any)
    await expect(updateMilestone("m9", { done: true }, USER)).rejects.toThrow("That milestone does not exist, or is not yours")
    await expect(removeMilestone("m9", USER)).rejects.toThrow("That milestone does not exist, or is not yours")
    expect(prisma.projectMilestone.update).not.toHaveBeenCalled()
    expect(prisma.projectMilestone.delete).not.toHaveBeenCalled()
  })

  it("removes a milestone", async () => {
    vi.mocked(prisma.projectMilestone.findUnique).mockResolvedValue({ id: "m1", projectId: "prj-1", title: "Delivery" } as any)
    vi.mocked(prisma.projectMilestone.delete).mockResolvedValue({ id: "m1" } as any)
    await removeMilestone("m1", USER)
    expect(prisma.projectMilestone.delete).toHaveBeenCalledWith({ where: { id: "m1" } })
  })

  it("refuses a milestone change from someone who cannot manage the Project", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-9" } } as any)
    vi.mocked(prisma.projectMilestone.findUnique).mockResolvedValue({ id: "m1", projectId: "prj-1", title: "Delivery" } as any)
    await expect(removeMilestone("m1", USER)).rejects.toThrow("Only the Project Manager or a Sales Admin can change this Project.")
    expect(prisma.projectMilestone.delete).not.toHaveBeenCalled()
  })
})
