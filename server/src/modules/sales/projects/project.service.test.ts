import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    idCounter: { upsert: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    salesAccount: { findUnique: vi.fn() },
    opportunity: { findFirst: vi.fn() },
    project: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    projectMilestone: { createMany: vi.fn() },
    journalLine: { aggregate: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))
vi.mock("../../dealMoney/dealMoney.cost", () => ({ dealCostLineWhere: vi.fn().mockResolvedValue({}) }))

import prisma from "../../../config/prisma"
import { Prisma } from "../../../generated/prisma/client"
import { getProject, listProjects, startProject } from "./project.service"
import { plannedCostOf } from "./project.present"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const FINANCE = { sub: "user-9", role: "FINANCE_OFFICER", salesRole: "SALES_ADMIN" } as any
const NOW = new Date("2026-09-28T10:00:00.000Z")
const d = (v: string) => new Prisma.Decimal(v)

const OPP = {
  id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", status: "WON", track: "NETWORKING",
  salesAccountId: "acc-1", ownerEmployeeId: "emp-1", project: null,
}
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
  vi.mocked(prisma.idCounter.upsert).mockResolvedValue({ id: "PRJ", value: 1 } as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(OPP as any)
  vi.mocked(prisma.project.create).mockResolvedValue(projectRow() as any)
  vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow() as any)
  vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: d("50000"), credit: d("0") } } as any)
})

describe("startProject", () => {
  it("starts a Project on a Won Opportunity with the Opportunity Owner as manager", async () => {
    const p = await startProject("opp-1", USER)
    expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        serial: "BS-PRJ-00001", name: "Core refresh", opportunityId: "opp-1", salesAccountId: "acc-1",
        managerEmployeeId: "emp-1", status: "NOT_STARTED", createdBy: "user-1",
      }),
    }))
    expect(p.serial).toBe("BS-PRJ-00001")
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.event.create).toHaveBeenCalledTimes(1)
  })

  it("starts a Software Project with the five milestones", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({ ...OPP, track: "SOFTWARE_DEVELOPMENT" } as any)
    await startProject("opp-1", USER)
    expect(prisma.projectMilestone.createMany).toHaveBeenCalledWith({
      data: ["Design", "Development", "Testing", "UAT", "Deployment"].map((title, order) => ({
        projectId: "prj-1", title, order,
      })),
    })
  })

  it("starts a Networking Project with no milestones", async () => {
    await startProject("opp-1", USER)
    expect(prisma.projectMilestone.createMany).not.toHaveBeenCalled()
  })

  it("issues the next serial in the series", async () => {
    vi.mocked(prisma.idCounter.upsert).mockResolvedValue({ id: "PRJ", value: 12 } as any)
    await startProject("opp-1", USER)
    const data = vi.mocked(prisma.project.create).mock.calls[0][0].data as any
    expect(data.serial).toBe("BS-PRJ-00012")
  })

  it("refuses an Opportunity that is not Won", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({ ...OPP, status: "ONGOING" } as any)
    await expect(startProject("opp-1", USER)).rejects.toThrow("Only a Won Opportunity can have a Project.")
    expect(prisma.project.create).not.toHaveBeenCalled()
  })

  it("refuses a second Project", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({ ...OPP, project: { id: "prj-1" } } as any)
    await expect(startProject("opp-1", USER)).rejects.toThrow("This Opportunity already has a Project.")
  })

  it("says so in plain words when two people start the Project at the same moment", async () => {
    // The unique index on Project.opportunityId is the backstop for the check above.
    vi.mocked(prisma.project.create).mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
    await expect(startProject("opp-1", USER)).rejects.toThrow("This Opportunity already has a Project.")
  })

  it("refuses someone who is neither the Opportunity Owner nor a Sales Admin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    await expect(startProject("opp-1", USER)).rejects.toThrow("Only the Opportunity Owner or a Sales Admin can start its Project.")
  })

  it("says the Opportunity is not visible rather than leaking that it exists", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(null as any)
    await expect(startProject("opp-1", USER)).rejects.toThrow("That Opportunity does not exist, or is not yours")
  })
})

describe("getProject", () => {
  it("works out the planned cost and hides the spend from a Sales User", async () => {
    const p = await getProject("prj-1", USER)
    expect(p.plannedCost).toBe("72000.00")
    expect(p.spentSoFar).toBeNull()
    expect(p.canSeeCost).toBe(false)
    expect(p.canManage).toBe(true)
    expect(p.canTick).toBe(true)
    expect(p.team[0]).toMatchObject({ fullName: "Karim", onAccount: true })
    expect(prisma.journalLine.aggregate).not.toHaveBeenCalled()
  })

  it("shows the spend to Finance", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as any)
    const p = await getProject("prj-1", FINANCE)
    expect(p.spentSoFar).toBe("50000.00")
    expect(p.canSeeCost).toBe(true)
  })

  it("marks a team member who has left the account, and a manager too", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({
      salesAccount: { id: "acc-1", name: "Rising Group", ownerEmployeeId: "emp-9", assignments: [] },
    }) as any)
    const p = await getProject("prj-1", USER)
    expect(p.team[0].onAccount).toBe(false)
    expect(p.manager.onAccount).toBe(false)
  })

  it("reports a line as done with the name of the person who ticked it", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow({
      opportunity: {
        ...projectRow().opportunity,
        lines: [{ ...projectRow().opportunity.lines[0], projectTicks: [{ projectId: "prj-1", doneAt: NOW, doneBy: "user-9" }] }],
      },
    }) as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-9", displayName: null, email: "f@x", employee: { fullName: "Farah" } }] as any)
    const p = await getProject("prj-1", USER)
    expect(p.lines[0].done).toEqual({ at: NOW.toISOString(), byName: "Farah" })
  })

  it("says the Project is not visible rather than leaking that it exists", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null as any)
    await expect(getProject("prj-9", USER)).rejects.toThrow("That Project does not exist, or is not yours")
  })
})

describe("plannedCostOf", () => {
  it("is null when any line has no price or no margin, never ৳0", () => {
    expect(plannedCostOf([{ lineValue: d("100"), marginPercent: null }])).toBeNull()
    expect(plannedCostOf([{ lineValue: null, marginPercent: d("10") }])).toBeNull()
    expect(plannedCostOf([])).toBeNull()
  })

  it("is each line's price minus its margin, added up", () => {
    expect(plannedCostOf([{ lineValue: d("100"), marginPercent: d("10") }])).toBe("90.00")
    expect(plannedCostOf([
      { lineValue: d("100"), marginPercent: d("10") },
      { lineValue: d("200"), marginPercent: d("0") },
    ])).toBe("290.00")
  })
})

describe("listProjects", () => {
  it("applies the filters and the account scope", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([] as any)
    await listProjects({ status: "IN_PROGRESS", salesAccountId: "acc-1" }, USER)
    const where = vi.mocked(prisma.project.findMany).mock.calls[0][0]!.where as any
    expect(where).toMatchObject({ status: "IN_PROGRESS", salesAccountId: "acc-1" })
    expect(where.salesAccount).toBeDefined()
  })

  it("leaves out a filter the caller did not send", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([] as any)
    await listProjects({}, USER)
    const where = vi.mocked(prisma.project.findMany).mock.calls[0][0]!.where as any
    expect(where).not.toHaveProperty("status")
    expect(where).not.toHaveProperty("salesAccountId")
  })

  it("filters Projects by the Opportunity's track", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([] as any)
    await listProjects({ track: "SOFTWARE_DEVELOPMENT" } as any, USER)
    const where = vi.mocked(prisma.project.findMany).mock.calls[0][0]!.where as any
    expect(where.opportunity).toEqual({ track: "SOFTWARE_DEVELOPMENT" })
  })

  it("leaves the track out of the where when no track was asked for", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([] as any)
    await listProjects({}, USER)
    const where = vi.mocked(prisma.project.findMany).mock.calls[0][0]!.where as any
    expect(where).not.toHaveProperty("opportunity")
  })

  it("counts done and total milestones per row", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      {
        id: "prj-1", serial: "BS-PRJ-00001", name: "Core refresh", status: "IN_PROGRESS", dueOn: new Date("2026-10-05T00:00:00.000Z"),
        salesAccount: { name: "Rising Group" }, opportunity: { serial: "BS-OPP-00001" }, manager: { fullName: "Rahim" },
        milestones: [{ doneAt: new Date("2026-09-30T00:00:00.000Z") }, { doneAt: null }],
      },
    ] as any)
    const rows = await listProjects({}, USER)
    expect(rows[0]).toEqual({
      id: "prj-1", serial: "BS-PRJ-00001", name: "Core refresh",
      salesAccountName: "Rising Group", opportunitySerial: "BS-OPP-00001", managerName: "Rahim",
      status: "IN_PROGRESS", dueOn: "2026-10-05", milestonesDone: 1, milestonesTotal: 2,
    })
  })
})
