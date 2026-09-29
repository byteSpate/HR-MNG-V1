import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    idCounter: { upsert: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    salesAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    salesAccountAssignment: { findUnique: vi.fn(), create: vi.fn() },
    opportunity: {
      create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      update: vi.fn(), count: vi.fn(),
    },
    project: { count: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    event: { create: vi.fn(), findMany: vi.fn() },
    salesComment: { findMany: vi.fn() },
    salesMeeting: { findMany: vi.fn(), findFirst: vi.fn() },
    salesTask: { create: vi.fn() },
    customerPo: { count: vi.fn() },
    supplierBill: { count: vi.fn() },
  },
}))

vi.mock("../../customer/customer.link", () => ({ ensureCustomerForAccount: vi.fn() }))

import prisma from "../../../config/prisma"
import { dec } from "../../payroll/payroll.money"
import { ensureCustomerForAccount } from "../../customer/customer.link"
import { correctOpportunityStatus, hasMoneyOrLiveProject, MONEY_OR_PROJECT } from "./opportunity.status"
import { changeOpportunityStatus } from "./opportunity.service"
import { changeOpportunityStatusSchema } from "./opportunity.validators"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "sales@example.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any
const ADMIN = { ...USER, salesRole: "SALES_ADMIN" } as any

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
const NOW = new Date("2026-09-09T10:00:00.000Z")

const opportunity = (overrides: Record<string, unknown> = {}) => ({
  id: "opp-1", serial: "BS-OPP-00001", salesAccountId: ACCOUNT.id,
  meetingId: null, track: "NETWORKING", name: "Core refresh",
  oemAccountManager: null, amount: dec("125000"), currency: "BDT",
  expectedCloseDate: null, status: "ONGOING", statusReason: null, closedAt: null,
  stage: "REQUIREMENT_RECEIVED", stageChangedAt: NOW,
  nextStep: null, nextStepDueOn: null, ownerEmployeeId: OWNER.id,
  wonByEmployeeId: null, lastActivityAt: NOW, createdBy: USER.sub,
  createdAt: NOW, updatedAt: NOW, owner: OWNER, salesAccount: ACCOUNT, lines: [],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.customerPo.count).mockResolvedValue(0)
  vi.mocked(prisma.supplierBill.count).mockResolvedValue(0)
  vi.mocked(prisma.project.count).mockResolvedValue(0)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(ACCOUNT as any)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(ACCOUNT as any)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(OWNER as any)
  vi.mocked(prisma.salesAccountAssignment.findUnique).mockResolvedValue(null as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity() as any)
  vi.mocked(prisma.opportunity.update).mockImplementation((async (args: any) =>
    opportunity({ ...args.data }) as any) as any)
})

describe("final statuses", () => {
  it("refuses Ongoing on the normal status route (Review Focus 3)", () => {
    expect(changeOpportunityStatusSchema.safeParse({ status: "ONGOING" }).success).toBe(false)
  })

  it("accepts Won, Lost and Cancelled on the normal status route", () => {
    for (const status of ["WON", "LOST", "CANCELLED"]) {
      expect(changeOpportunityStatusSchema.safeParse({ status }).success).toBe(true)
    }
  })

  it("refuses to change a Won Opportunity on the normal route", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({ status: "WON", closedAt: NOW }) as any)
    await expect(changeOpportunityStatus("opp-1", { status: "LOST", statusReason: "Price" }, USER))
      .rejects.toThrow("This Opportunity is already Won. If this is a mistake, a Sales Admin can correct it.")
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })

  it("still needs a reason for Lost or Cancelled", async () => {
    await expect(changeOpportunityStatus("opp-1", { status: "LOST" }, USER))
      .rejects.toThrow("Lost Opportunities need a reason")
  })
})

describe("correctOpportunityStatus", () => {
  beforeEach(() => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(
      opportunity({ status: "WON", closedAt: NOW, wonByEmployeeId: "emp-1" }) as any
    )
  })

  it("is for a Sales Admin or the Super Admin only", async () => {
    await expect(correctOpportunityStatus("opp-1", { status: "LOST", reason: "Wrong click" }, USER))
      .rejects.toThrow("Only a Sales Admin or the Super Admin can correct a status.")
  })

  it("refuses an Opportunity that is still open", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity() as any)
    await expect(correctOpportunityStatus("opp-1", { status: "LOST", reason: "Wrong click" }, ADMIN))
      .rejects.toThrow("This Opportunity is still open. Use Mark Won, Mark Lost or Mark Cancelled.")
  })

  it("does nothing when the correction is the status it already has", async () => {
    await correctOpportunityStatus("opp-1", { status: "WON", reason: "Wrong click" }, ADMIN)
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })

  it("refuses when money is recorded", async () => {
    vi.mocked(prisma.customerPo.count).mockResolvedValue(1)
    await expect(correctOpportunityStatus("opp-1", { status: "LOST", reason: "Wrong click" }, ADMIN))
      .rejects.toThrow("This Opportunity has money or a Project on it, so its status cannot be changed. Ask Finance for help.")
  })

  it("refuses when a Project is not cancelled (Review Focus 5)", async () => {
    vi.mocked(prisma.project.count).mockResolvedValue(1)
    await expect(correctOpportunityStatus("opp-1", { status: "LOST", reason: "Wrong click" }, ADMIN))
      .rejects.toThrow("This Opportunity has money or a Project on it")
    expect(prisma.project.count).toHaveBeenCalledWith({ where: { opportunityId: "opp-1", status: { not: "CANCELLED" } } })
  })

  it("corrects Won to Lost, keeps closedAt and the winner, and records the reason", async () => {
    await correctOpportunityStatus("opp-1", { status: "LOST", reason: "Marked Won by mistake" }, ADMIN)
    const data = vi.mocked(prisma.opportunity.update).mock.calls[0][0].data as any
    expect(data).toMatchObject({ status: "LOST", statusReason: "Marked Won by mistake" })
    expect(data.closedAt).toBeUndefined()
    expect(data.wonBy).toBeUndefined()
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ note: "Corrected: Marked Won by mistake" }),
    }))
  })

  it("corrects back to Ongoing and clears closedAt", async () => {
    await correctOpportunityStatus("opp-1", { status: "ONGOING", reason: "Customer came back" }, ADMIN)
    const data = vi.mocked(prisma.opportunity.update).mock.calls[0][0].data as any
    expect(data).toMatchObject({ status: "ONGOING", closedAt: null, statusReason: null })
  })

  it("corrects Lost to Won, stamps the winner once and makes the Customer", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(
      opportunity({ status: "LOST", closedAt: NOW, statusReason: "Price", wonByEmployeeId: null }) as any
    )
    await correctOpportunityStatus("opp-1", { status: "WON", reason: "It was won" }, ADMIN)
    const data = vi.mocked(prisma.opportunity.update).mock.calls[0][0].data as any
    expect(data).toMatchObject({ status: "WON", statusReason: null, wonBy: { connect: { id: "emp-1" } } })
    expect(ensureCustomerForAccount).toHaveBeenCalled()
  })

  it("refuses to correct to Won while a product line has no supplier", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(
      opportunity({
        status: "LOST", closedAt: NOW, wonByEmployeeId: null,
        lines: [{ id: "l1", product: "Installation", supplierId: null }],
      }) as any
    )
    await expect(correctOpportunityStatus("opp-1", { status: "WON", reason: "It was won" }, ADMIN))
      .rejects.toThrow("Pick a supplier for every product before marking this Opportunity won. Missing: Installation.")
  })
})

describe("hasMoneyOrLiveProject", () => {
  it("is false on an Opportunity with nothing recorded on it", async () => {
    await expect(hasMoneyOrLiveProject(prisma as never, "opp-1")).resolves.toBe(false)
  })

  it("counts a PO that is not cancelled, a bill, and a Project that is not cancelled", async () => {
    vi.mocked(prisma.customerPo.count).mockResolvedValue(1)
    await expect(hasMoneyOrLiveProject(prisma as never, "opp-1")).resolves.toBe(true)
    vi.mocked(prisma.customerPo.count).mockResolvedValue(0)
    vi.mocked(prisma.supplierBill.count).mockResolvedValue(1)
    await expect(hasMoneyOrLiveProject(prisma as never, "opp-1")).resolves.toBe(true)
    vi.mocked(prisma.supplierBill.count).mockResolvedValue(0)
    vi.mocked(prisma.project.count).mockResolvedValue(1)
    await expect(hasMoneyOrLiveProject(prisma as never, "opp-1")).resolves.toBe(true)
  })

  it("asks each question with the right exclusion", async () => {
    await hasMoneyOrLiveProject(prisma as never, "opp-1")
    // A cancelled PO and a cancelled Project leave nothing behind, so only the
    // others count. A bill has no cancelled state, so it is asked plainly.
    expect(prisma.customerPo.count).toHaveBeenCalledWith({ where: { opportunityId: "opp-1", status: { not: "CANCELLED" } } })
    expect(prisma.project.count).toHaveBeenCalledWith({ where: { opportunityId: "opp-1", status: { not: "CANCELLED" } } })
    expect(prisma.supplierBill.count).toHaveBeenCalledWith({ where: { opportunityId: "opp-1" } })
  })

  it("names the money-or-Project refusal in words a person can act on", () => {
    expect(MONEY_OR_PROJECT).toBe(
      "This Opportunity has money or a Project on it, so its status cannot be changed. Ask Finance for help."
    )
  })
})
