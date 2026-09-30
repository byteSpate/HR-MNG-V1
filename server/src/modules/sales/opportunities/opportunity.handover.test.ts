import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    idCounter: { upsert: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    department: { findUnique: vi.fn() },
    salesAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    salesAccountAssignment: { findUnique: vi.fn(), create: vi.fn() },
    opportunity: {
      create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      update: vi.fn(), count: vi.fn(),
    },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    event: { create: vi.fn(), findMany: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { handOverToSoftware, listHandOverOwners, SOFTWARE_DEPARTMENT } from "./opportunity.handover"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "sales@example.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any

const ACCOUNT = {
  id: "account-1",
  name: "Rising Group",
  ownerEmployeeId: "emp-1",
  assignments: [] as { employeeId: string }[],
}
const OWNER = {
  id: "emp-1", fullName: "Rahim", employmentStatus: "ACTIVE", lastWorkingDay: null,
  user: { salesRole: "SALES_USER", isActive: true },
}
const NOW = new Date("2026-09-28T10:00:00.000Z")

const opportunity = (overrides: Record<string, unknown> = {}) => ({
  id: "opp-1", serial: "BS-OPP-00001", salesAccountId: ACCOUNT.id,
  meetingId: null, track: "NETWORKING", name: "Core refresh",
  softwareNeeded: true, oemAccountManager: null, amount: null, currency: "BDT",
  expectedCloseDate: null, status: "ONGOING", statusReason: null, closedAt: null,
  stage: "TECHNICAL_VALIDATION", stageChangedAt: NOW, offeredOn: null,
  nextStep: null, nextStepDueOn: null, ownerEmployeeId: OWNER.id,
  wonByEmployeeId: null, lastActivityAt: NOW, createdBy: USER.sub,
  createdAt: NOW, updatedAt: NOW, owner: OWNER, salesAccount: ACCOUNT, lines: [], project: null,
  ...overrides,
})

/** Nadia: on the account, in the Software Development department, able to use Sales Hub. */
const SW = {
  id: "emp-sw", fullName: "Nadia", departmentId: "dept-sw",
  employmentStatus: "ACTIVE", lastWorkingDay: null,
  user: { salesRole: "SALES_USER", isActive: true },
}
const ON_ACCOUNT = { ...ACCOUNT, assignments: [{ employeeId: "emp-sw" }] }

/** The new Software Opportunity the Hand-over makes. */
const CREATED = opportunity({
  id: "opp-2", serial: "BS-OPP-00002", track: "SOFTWARE_DEVELOPMENT",
  name: "Core refresh (Software)", stage: "REQUIREMENT_RECEIVED",
  ownerEmployeeId: "emp-sw", handedOverFromId: "opp-1", salesAccount: ACCOUNT, lines: [],
  // Prisma fills the link from handedOverFromId, so the read comes back set.
  handedOverFrom: { id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh" },
  handedOverTo: null,
})

/**
 * Sets the source Opportunity a test needs. The queue is cleared first:
 * loadForWrite is the first read, "already handed over?" is the second, and a
 * leftover queued row from a shared beforeEach would answer the wrong one.
 */
function sourceIs(overrides: Record<string, unknown> = {}, alreadyHandedOver: unknown = null) {
  vi.mocked(prisma.opportunity.findFirst).mockReset()
  vi.mocked(prisma.opportunity.findFirst)
    .mockResolvedValueOnce(opportunity({ softwareNeeded: true, salesAccount: ON_ACCOUNT, ...overrides }) as any)
    .mockResolvedValue(alreadyHandedOver as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.opportunity.create).mockResolvedValue(CREATED as any)
  vi.mocked(prisma.opportunity.update).mockImplementation((async (args: any) => opportunity({ ...args.data }) as any) as any)
  vi.mocked(prisma.idCounter.upsert).mockResolvedValue({ id: "OPP", value: 2 } as any)
  vi.mocked(prisma.department.findUnique).mockResolvedValue({ id: "dept-sw" } as any)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(SW as any)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([SW] as any)
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)
  vi.mocked(prisma.event.create).mockResolvedValue({} as any)
  sourceIs()
})

describe("Hand-over", () => {
  it("makes a linked Software Opportunity with the chosen Owner", async () => {
    await handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER)
    expect(prisma.opportunity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: "Core refresh (Software)", track: "SOFTWARE_DEVELOPMENT", stage: "REQUIREMENT_RECEIVED",
        status: "ONGOING", handedOverFromId: "opp-1", ownerEmployeeId: "emp-sw", salesAccountId: "account-1",
      }),
    }))
    // Both Opportunities are audited: the one made, and the one that lost the software work.
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2)
  })

  it("puts an event on each Opportunity, so the team's feed shows the move", async () => {
    await handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER)
    expect(prisma.event.create).toHaveBeenCalledTimes(2)
  })

  it("returns the new Software Opportunity, not the one it was made from", async () => {
    const result = await handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER)
    expect(result).toMatchObject({ id: "opp-2", track: "SOFTWARE_DEVELOPMENT" })
    expect(result.handedOverFrom).toMatchObject({ id: "opp-1", serial: "BS-OPP-00001" })
  })

  it("uses the name the caller typed", async () => {
    await handOverToSoftware("opp-1", { name: "HR rebuild", ownerEmployeeId: "emp-sw" }, USER)
    expect(prisma.opportunity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "HR rebuild" }),
    }))
  })

  it("refuses when Software needed is not Yes", async () => {
    sourceIs({ softwareNeeded: null })
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("Set Software needed to Yes before handing this Opportunity to the Software team.")
    expect(prisma.opportunity.create).not.toHaveBeenCalled()
  })

  it("refuses a second Hand-over (Review Focus 3)", async () => {
    sourceIs({}, { id: "opp-2" })
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("This Opportunity was already handed to the Software team.")
    expect(prisma.opportunity.create).not.toHaveBeenCalled()
  })

  it("refuses a Hand-over from a Software Opportunity, which is already on that track", async () => {
    sourceIs({ track: "SOFTWARE_DEVELOPMENT" })
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("Only a Networking Opportunity can be handed to the Software team.")
  })

  it("turns a lost unique-index race into the same 409, not a 500", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      try {
        return await fn(prisma)
      } catch (err) {
        throw err
      }
    })
    vi.mocked(prisma.opportunity.create).mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }))
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("This Opportunity was already handed to the Software team.")
  })

  it("refuses an Owner who is not a Software person on the account", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...SW, departmentId: "dept-net" } as any)
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("Nadia is not in the Software Development department and on this account. Pick someone from the list.")
  })

  it("refuses an Owner who is not on the account at all", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(SW as any)
    // The account with no collaborators: only its Owner is on it.
    sourceIs({ salesAccount: ACCOUNT })
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("Nadia is not in the Software Development department and on this account.")
  })

  it("refuses an Owner who cannot use the Sales Hub", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...SW, user: { salesRole: null, isActive: true } } as any)
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("Nadia cannot use the Sales Hub right now, so they cannot own an Opportunity.")
  })

  it("refuses an Owner who has left", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...SW, employmentStatus: "TERMINATED" } as any)
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("Nadia cannot use the Sales Hub right now")
  })

  it("refuses a person who is not an employee at all", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as any)
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("That person is not an employee.")
  })

  it("refuses when HR has no Software Development department at all", async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValue(null as any)
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER))
      .rejects.toThrow("Nadia is not in the Software Development department and on this account.")
  })

  it("finds the Software team by its department name, which HR can rename", async () => {
    await handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER)
    expect(prisma.department.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: SOFTWARE_DEPARTMENT } }),
    )
    expect(SOFTWARE_DEPARTMENT).toBe("Software Development")
  })

  it("lists only Software people on the account", async () => {
    sourceIs()
    const owners = await listHandOverOwners("opp-1", USER)
    expect(owners).toEqual([{ id: "emp-sw", fullName: "Nadia" }])
    expect(prisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["emp-1", "emp-sw"] }, departmentId: "dept-sw" }),
    }))
  })

  it("leaves the picker empty when HR has no Software Development department", async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValue(null as any)
    expect(await listHandOverOwners("opp-1", USER)).toEqual([])
  })

  it("hides from the picker a Software person who cannot use the Sales Hub", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      SW,
      { ...SW, id: "emp-sw2", fullName: "Tariq", user: { salesRole: null, isActive: true } },
    ] as any)
    expect(await listHandOverOwners("opp-1", USER)).toEqual([{ id: "emp-sw", fullName: "Nadia" }])
  })

  it("refuses a Hand-over on an Opportunity the caller cannot see", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockReset()
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(null as any)
    await expect(handOverToSoftware("opp-1", { ownerEmployeeId: "emp-sw" }, USER)).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})
