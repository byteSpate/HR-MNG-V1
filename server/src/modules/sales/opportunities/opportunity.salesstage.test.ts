import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    salesAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    salesAccountAssignment: { findUnique: vi.fn(), create: vi.fn() },
    opportunity: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    event: { create: vi.fn() },
    customerPo: { count: vi.fn() },
    supplierBill: { count: vi.fn() },
    project: { count: vi.fn() },
    opportunityQuote: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}))

vi.mock("../sales.permissions", async () => ({
  ...(await vi.importActual<object>("../sales.permissions")),
  canDo: vi.fn().mockResolvedValue(true),
}))

vi.mock("../../customer/customer.link", () => ({ ensureCustomerForAccount: vi.fn() }))

import prisma from "../../../config/prisma"
import { dec } from "../../payroll/payroll.money"
import { PAIR_REFUSAL, WRONG_TRACK_SALES_STAGE } from "../sales.stages"
import { changeOpportunityStage, changeOpportunityStatus, getOpportunity, updateOpportunity } from "./opportunity.service"
import { changeOpportunityStageSchema } from "./opportunity.validators"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "sales@example.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any

const ACCOUNT = { id: "account-1", name: "Rising Group", ownerEmployeeId: "emp-1", assignments: [] as { employeeId: string }[] }
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
  stage: "DISCOVERY_DESIGN", salesStage: null, stageChangedAt: NOW,
  nextStep: null, nextStepDueOn: null, ownerEmployeeId: OWNER.id,
  wonByEmployeeId: null, lastActivityAt: NOW, createdBy: USER.sub,
  createdAt: NOW, updatedAt: NOW, owner: OWNER, salesAccount: ACCOUNT, lines: [],
  ...overrides,
})

const found = (overrides: Record<string, unknown> = {}) =>
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity(overrides) as any)

const updateData = () => (vi.mocked(prisma.opportunity.update).mock.calls[0][0] as any).data
const auditRows = () => vi.mocked(prisma.auditLog.create).mock.calls.map((c) => (c[0] as any).data)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.customerPo.count).mockResolvedValue(0)
  vi.mocked(prisma.supplierBill.count).mockResolvedValue(0)
  vi.mocked(prisma.project.count).mockResolvedValue(0)
  vi.mocked(prisma.opportunityQuote.count).mockResolvedValue(0)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(ACCOUNT as any)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(OWNER as any)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity() as any)
  vi.mocked(prisma.opportunity.update).mockImplementation((async (args: any) => opportunity({ ...args.data }) as any) as any)
})

describe("the stage change request", () => {
  it("needs a work stage or a sales stage", () => {
    const result = changeOpportunityStageSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/stage/i)
  })

  it("accepts a sales stage on its own, with or without a reason", () => {
    expect(changeOpportunityStageSchema.safeParse({ salesStage: "AWARENESS" }).success).toBe(true)
    expect(changeOpportunityStageSchema.safeParse({ salesStage: "AWARENESS", pairReason: "Paid in advance" }).success).toBe(true)
  })

  it("refuses a sales stage name that does not exist, and a reason over 300 characters", () => {
    expect(changeOpportunityStageSchema.safeParse({ salesStage: "HAPPY" }).success).toBe(false)
    expect(changeOpportunityStageSchema.safeParse({ salesStage: "AWARENESS", pairReason: "x".repeat(301) }).success).toBe(false)
  })
})

describe("moving the sales stage", () => {
  it("sets only the sales stage, and leaves the work stage and its clock alone", async () => {
    found()
    await changeOpportunityStage("opp-1", { salesStage: "AWARENESS" }, USER)
    const data = updateData()
    expect(data.salesStage).toBe("AWARENESS")
    expect(data).not.toHaveProperty("stage")
    expect(data).not.toHaveProperty("stageChangedAt")
    expect(auditRows()).toEqual([expect.objectContaining({ before: { salesStage: null }, after: { salesStage: "AWARENESS" } })])
  })

  it("moves both stages in one write, and starts the work stage clock", async () => {
    found({ stage: "DISCOVERY_DESIGN", salesStage: "AWARENESS" })
    await changeOpportunityStage("opp-1", { stage: "TECHNICAL_VALIDATION", salesStage: "SOLUTION_FRONT_RUNNER" }, USER)
    expect(prisma.opportunity.update).toHaveBeenCalledTimes(1)
    expect(updateData()).toMatchObject({ stage: "TECHNICAL_VALIDATION", salesStage: "SOLUTION_FRONT_RUNNER", stageChangedAt: NOW })
  })

  it("does nothing when neither stage changes", async () => {
    found({ stage: "DISCOVERY_DESIGN", salesStage: "AWARENESS" })
    await changeOpportunityStage("opp-1", { stage: "DISCOVERY_DESIGN", salesStage: "AWARENESS" }, USER)
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })
})

describe("a pair that does not fit", () => {
  it("is refused with plain words, and nothing is written", async () => {
    found({ stage: "DISCOVERY_DESIGN" })
    await expect(changeOpportunityStage("opp-1", { salesStage: "PO_RECEIVED_BY_VAR" }, USER))
      .rejects.toMatchObject({ statusCode: 400, message: PAIR_REFUSAL })
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("is saved when a reason is given, and the reason goes to History", async () => {
    found({ stage: "DISCOVERY_DESIGN" })
    await changeOpportunityStage("opp-1", { salesStage: "PO_RECEIVED_BY_VAR", pairReason: "Customer paid in advance" }, USER)
    expect(updateData().salesStage).toBe("PO_RECEIVED_BY_VAR")
    expect(auditRows()[0].note).toContain("Customer paid in advance")
  })

  it("is refused when a work stage move leaves the old sales stage behind", async () => {
    found({ stage: "DISCOVERY_DESIGN", salesStage: "AWARENESS" })
    await expect(changeOpportunityStage("opp-1", { stage: "CUSTOMER_PROCUREMENT", skipQuoteReason: "later" }, USER))
      .rejects.toMatchObject({ statusCode: 400, message: PAIR_REFUSAL })
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })

  it("never blocks an old Opportunity that has no sales stage", async () => {
    found({ stage: "ASSIGNED_QUALIFIED", salesStage: null })
    await changeOpportunityStage("opp-1", { stage: "DISCOVERY_DESIGN" }, USER)
    expect(updateData()).toMatchObject({ stage: "DISCOVERY_DESIGN" })
    expect(updateData().salesStage).toBeUndefined()
  })

  it("is refused for a sales stage that belongs to the other track", async () => {
    found({ track: "NETWORKING" })
    await expect(changeOpportunityStage("opp-1", { salesStage: "NEED_UNDERSTOOD" }, USER))
      .rejects.toMatchObject({ statusCode: 400, message: WRONG_TRACK_SALES_STAGE.NETWORKING })
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })
})

describe("a closed Opportunity", () => {
  for (const status of ["WON", "LOST", "CANCELLED"]) {
    it(`cannot change its sales stage when it is ${status}`, async () => {
      found({ status })
      await expect(changeOpportunityStage("opp-1", { salesStage: "AWARENESS" }, USER))
        .rejects.toMatchObject({ statusCode: 409, message: "This Opportunity is closed, so you cannot move its stage." })
      expect(prisma.opportunity.update).not.toHaveBeenCalled()
    })
  }
})

describe("quotes and the sales stage", () => {
  it("refuses a quote that comes with only a sales stage change", async () => {
    found()
    await expect(changeOpportunityStage("opp-1", {
      salesStage: "AWARENESS",
      quote: { amount: "100", quotedOn: "2026-09-05", reference: null, note: null },
    }, USER)).rejects.toMatchObject({ statusCode: 400, message: "Quotes are added from a quote stage." })
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })

  it("still asks for Quote 1 when the work stage moves into a quote stage", async () => {
    found({ stage: "TECHNICAL_VALIDATION", salesStage: "SOLUTION_FRONT_RUNNER", offeredOn: null })
    await expect(changeOpportunityStage("opp-1", { stage: "COMMERCIAL_NEGOTIATION" }, USER))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })
})

describe("Won, Lost and Cancelled", () => {
  it("Won sets the last Networking sales stage in the same write as the status", async () => {
    found({ stage: "DISCOVERY_DESIGN", salesStage: "AWARENESS" })
    await changeOpportunityStatus("opp-1", { status: "WON" }, USER)
    expect(updateData()).toMatchObject({ status: "WON", salesStage: "PO_RECEIVED_BY_VAR" })
    expect(prisma.opportunity.update).toHaveBeenCalledTimes(1)
  })

  it("Won sets Work Order Received on a Software Opportunity, although no Software work stage allows it", async () => {
    found({ track: "SOFTWARE_DEVELOPMENT", stage: "PROPOSAL_SUBMITTED", salesStage: null })
    await changeOpportunityStatus("opp-1", { status: "WON" }, USER)
    expect(updateData()).toMatchObject({ status: "WON", salesStage: "WORK_ORDER_RECEIVED" })
  })

  it("Won on a Networking Opportunity still works when the work stage is not PO Received", async () => {
    found({ stage: "TECHNICAL_VALIDATION" })
    await expect(changeOpportunityStatus("opp-1", { status: "WON" }, USER)).resolves.toBeDefined()
    expect(updateData().stage).toBeUndefined()
  })

  it("writes the sales stage into the audit row for Won", async () => {
    found({ salesStage: "DECISION_TO_FUND" })
    await changeOpportunityStatus("opp-1", { status: "WON" }, USER)
    const row = auditRows()[0]
    expect(row.before).toMatchObject({ status: "ONGOING", salesStage: "DECISION_TO_FUND" })
    expect(row.after).toMatchObject({ status: "WON", salesStage: "PO_RECEIVED_BY_VAR" })
  })

  for (const status of ["LOST", "CANCELLED"] as const) {
    it(`${status} keeps the last sales stage`, async () => {
      found({ salesStage: "SOLUTION_FRONT_RUNNER" })
      await changeOpportunityStatus("opp-1", { status, statusReason: "Price" }, USER)
      expect(updateData()).not.toHaveProperty("salesStage")
    })
  }
})

describe("changing the track", () => {
  it("clears the sales stage with the work stage, because the two lists differ", async () => {
    found({ stage: "DISCOVERY_DESIGN", salesStage: "AWARENESS" })
    await updateOpportunity("opp-1", { track: "SOFTWARE_DEVELOPMENT" } as any, USER)
    expect(updateData()).toMatchObject({ track: "SOFTWARE_DEVELOPMENT", stage: "REQUIREMENT_RECEIVED", salesStage: null })
  })

  it("leaves a null sales stage alone", async () => {
    found({ stage: "DISCOVERY_DESIGN", salesStage: null })
    await updateOpportunity("opp-1", { track: "SOFTWARE_DEVELOPMENT" } as any, USER)
    expect(updateData().salesStage).toBeNull()
  })
})

describe("reading an Opportunity", () => {
  it("returns the sales stage, and null when none is set", async () => {
    found({ salesStage: "AWARENESS" })
    await expect(getOpportunity("opp-1", USER)).resolves.toMatchObject({ salesStage: "AWARENESS" })
    found({ salesStage: null })
    await expect(getOpportunity("opp-1", USER)).resolves.toMatchObject({ salesStage: null })
  })
})
