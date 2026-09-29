import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    salesAccount: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { accountPeople, canManageProject, loadProjectRow, peopleOf, PROJECT_NOT_VISIBLE, requireManage } from "./project.access"
import {
  addMilestoneSchema, changeProjectStatusSchema, listProjectSchema,
  setProjectTeamSchema, updateMilestoneSchema, updateProjectSchema,
} from "./project.validators"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "user-3", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const SUPER = { sub: "user-4", role: "SUPER_ADMIN", salesRole: null } as any

describe("peopleOf", () => {
  it("is the Owner plus every collaborator, with no duplicates", () => {
    const people = peopleOf({
      ownerEmployeeId: "emp-1",
      assignments: [{ employeeId: "emp-2" }, { employeeId: "emp-1" }, { employeeId: "emp-2" }],
    })
    expect([...people].sort()).toEqual(["emp-1", "emp-2"])
  })

  it("is the Owner alone on an account nobody else works", () => {
    expect([...peopleOf({ ownerEmployeeId: "emp-1", assignments: [] })]).toEqual(["emp-1"])
  })
})

describe("accountPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue({
      ownerEmployeeId: "emp-1", assignments: [{ employeeId: "emp-2" }],
    } as any)
  })

  it("reads the account's people", async () => {
    const people = await accountPeople(prisma, "acc-1")
    expect([...people].sort()).toEqual(["emp-1", "emp-2"])
  })

  it("says the Project is not visible rather than leaking that the account exists", async () => {
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(null as any)
    await expect(accountPeople(prisma, "acc-1")).rejects.toThrow(PROJECT_NOT_VISIBLE)
  })
})

describe("canManageProject", () => {
  it("is the Project Manager, or any Sales Admin or Super Admin", () => {
    expect(canManageProject(USER, "emp-1", "emp-1")).toBe(true)
    expect(canManageProject(USER, "emp-2", "emp-1")).toBe(false)
    expect(canManageProject(ADMIN, "emp-2", "emp-1")).toBe(true)
    expect(canManageProject(SUPER, null, "emp-1")).toBe(true)
  })

  it("is nobody's when the viewer has no employee record at all", () => {
    expect(canManageProject(USER, null, "emp-1")).toBe(false)
  })

  it("requireManage says the same thing in words", () => {
    expect(() => requireManage(USER, "emp-1", "emp-1")).not.toThrow()
    expect(() => requireManage(USER, "emp-2", "emp-1"))
      .toThrow("Only the Project Manager or a Sales Admin can change this Project.")
  })
})

describe("loadProjectRow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: "prj-1" } as any)
  })

  it("hands back the row and the viewer's employee id together", async () => {
    const { row, employeeId } = await loadProjectRow(prisma, "prj-1", USER)
    expect(row).toEqual({ id: "prj-1" })
    expect(employeeId).toBe("emp-1")
  })

  it("hands back a null employee id for somebody with no Employee row", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as any)
    const { employeeId } = await loadProjectRow(prisma, "prj-1", SUPER)
    expect(employeeId).toBeNull()
  })

  it("404s one message for both 'no such Project' and 'not yours'", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null as any)
    await expect(loadProjectRow(prisma, "prj-9", USER)).rejects.toThrow(PROJECT_NOT_VISIBLE)
  })
})

describe("the Project validators", () => {
  it("refuses an update that changes nothing", () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false)
    expect(updateProjectSchema.safeParse({ name: "New" }).success).toBe(true)
  })

  it("reads a budget as blank for no budget, never as zero", () => {
    expect(updateProjectSchema.parse({ budget: null }).budget).toBeNull()
    expect(updateProjectSchema.safeParse({ budget: "0" }).success).toBe(true)
    expect(updateProjectSchema.safeParse({ budget: "-100" }).success).toBe(false)
    expect(updateProjectSchema.safeParse({ budget: "1.234" }).success).toBe(false)
  })

  it("refuses a start or finish date that is not a plain calendar day", () => {
    expect(updateProjectSchema.safeParse({ startOn: "2026-10-05" }).success).toBe(true)
    expect(updateProjectSchema.safeParse({ startOn: "05/10/2026" }).success).toBe(false)
    expect(updateProjectSchema.safeParse({ startOn: "2026-1-5" }).success).toBe(false)
    expect(updateProjectSchema.safeParse({ dueOn: null }).success).toBe(true)
  })

  it("does not check the calendar itself: 2026-13-01 is a well-formed day that is not a day", () => {
    // `dateOnly` is the shared house primitive and checks the *format* only,
    // for every module that uses it. Widening it is a whole-app change, out of
    // this plan's scope. Recorded here so the gap is visible rather than
    // assumed: a month of 13 reaches Prisma as an Invalid Date and the write
    // fails there rather than with a clean 400.
    expect(updateProjectSchema.safeParse({ startOn: "2026-13-01" }).success).toBe(true)
    expect(Number.isNaN(new Date("2026-13-01T00:00:00.000Z").getTime())).toBe(true)
  })

  it("refuses the same person on the team twice, and more than fifty people", () => {
    const id = "11111111-1111-4111-8111-111111111111"
    expect(setProjectTeamSchema.safeParse({ members: [{ employeeId: id }, { employeeId: id }] }).success).toBe(false)
    expect(setProjectTeamSchema.safeParse({ members: [] }).success).toBe(true)
    const many = Array.from({ length: 51 }, (_, i) => ({
      employeeId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    }))
    expect(setProjectTeamSchema.safeParse({ members: many }).success).toBe(false)
  })

  it("trims a responsibility, so the service stores null rather than spaces", () => {
    const id = "11111111-1111-4111-8111-111111111111"
    // The schema trims; the service then turns "" into null. Neither end can
    // store "   " on a Project Team row.
    expect(setProjectTeamSchema.parse({ members: [{ employeeId: id, responsibility: "  " }] }).members[0].responsibility)
      .toBe("")
  })

  it("accepts every Project status, and an empty status change is not a thing", () => {
    for (const status of ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "ON_HOLD", "COMPLETED", "CANCELLED"]) {
      expect(changeProjectStatusSchema.safeParse({ status }).success).toBe(true)
    }
    expect(changeProjectStatusSchema.safeParse({ status: "WRONG" }).success).toBe(false)
    expect(changeProjectStatusSchema.parse({ status: "BLOCKED", reason: "  " }).reason).toBe("")
  })

  it("needs a milestone name, and refuses a name that is only spaces", () => {
    expect(addMilestoneSchema.safeParse({ title: "Delivery" }).success).toBe(true)
    expect(addMilestoneSchema.safeParse({ title: "  " }).success).toBe(false)
    expect(addMilestoneSchema.safeParse({ title: "x".repeat(181) }).success).toBe(false)
  })

  it("refuses a milestone change that changes nothing", () => {
    expect(updateMilestoneSchema.safeParse({}).success).toBe(false)
    expect(updateMilestoneSchema.safeParse({ done: false }).success).toBe(true)
    expect(updateMilestoneSchema.safeParse({ done: "yes" }).success).toBe(false)
  })

  it("reads the list filters, and leaves every one optional", () => {
    expect(listProjectSchema.parse({})).toEqual({})
    expect(listProjectSchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(true)
    expect(listProjectSchema.safeParse({ status: "NOPE" }).success).toBe(false)
    expect(listProjectSchema.safeParse({ managerEmployeeId: "not-a-uuid" }).success).toBe(false)
  })
})
