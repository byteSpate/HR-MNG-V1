import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    idCounter: { upsert: vi.fn() },
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    salesAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    salesAccountAssignment: { findUnique: vi.fn(), create: vi.fn() },
    opportunity: {
      create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
      update: vi.fn(), count: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn(), findMany: vi.fn() },
    salesComment: { findMany: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { dec } from "../payroll/payroll.money"
import {
  changeOpportunityNextStep,
  changeOpportunityStage,
  changeOpportunityStatus,
  createOpportunity,
  getOpportunity,
  listOpportunities,
} from "./opportunity.service"
import { nextOpportunitySerial } from "./sales.serial"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "sales@example.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any

const ACCOUNT = { id: "account-1", name: "Rising Group", ownerEmployeeId: "emp-1" }
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
  vi.useRealTimers()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(ACCOUNT as any)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(ACCOUNT as any)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(OWNER as any)
  vi.mocked(prisma.salesAccountAssignment.findUnique).mockResolvedValue(null as any)
  vi.mocked(prisma.salesAccountAssignment.create).mockResolvedValue({ id: "assignment-1" } as any)
  vi.mocked(prisma.idCounter.upsert).mockResolvedValue({ id: "OPP", value: 1 } as any)
  vi.mocked(prisma.opportunity.create).mockResolvedValue(opportunity() as any)
  vi.mocked(prisma.opportunity.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.opportunity.count).mockResolvedValue(0)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity() as any)
  vi.mocked(prisma.opportunity.findUnique).mockResolvedValue(opportunity() as any)
  vi.mocked(prisma.opportunity.update).mockImplementation((async (args: any) =>
    opportunity({ ...args.data }) as any) as any)
})

describe("opportunity serials and creation", () => {
  it("issues distinct serials from the transaction counter", async () => {
    vi.mocked(prisma.idCounter.upsert)
      .mockResolvedValueOnce({ id: "OPP", value: 1 } as any)
      .mockResolvedValueOnce({ id: "OPP", value: 2 } as any)

    await expect(nextOpportunitySerial(prisma as any)).resolves.toBe("BS-OPP-00001")
    await expect(nextOpportunitySerial(prisma as any)).resolves.toBe("BS-OPP-00002")
  })

  it("defaults the deal owner to the account owner and writes audit and event rows", async () => {
    const result = await createOpportunity(
      { salesAccountId: ACCOUNT.id, name: "Core refresh", track: "NETWORKING" }, USER
    )

    expect(result.serial).toBe("BS-OPP-00001")
    expect(prisma.opportunity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        serial: "BS-OPP-00001", ownerEmployeeId: OWNER.id,
        stage: "REQUIREMENT_RECEIVED", status: "ONGOING",
      }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "OPPORTUNITY", action: "CREATE" }),
    }))
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "sales.opportunity.created", href: "/opportunities/opp-1",
      }),
    }))
  })

  it("refuses creation on an account the Sales User does not work", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null as any)
    await expect(createOpportunity(
      { salesAccountId: "other", name: "Hidden", track: "NETWORKING" }, USER
    )).rejects.toThrow(/does not exist, or is not yours/i)
    expect(prisma.opportunity.create).not.toHaveBeenCalled()
  })

  it("names an owner without account access and explains addAssignment", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-2", fullName: "Karim" } as any)
    await expect(createOpportunity({
      salesAccountId: ACCOUNT.id, name: "Core refresh", track: "NETWORKING",
      ownerEmployeeId: "emp-2",
    }, USER)).rejects.toThrow(/Karim.*addAssignment/i)
  })

  it("adds a missing owner assignment inside the creation transaction when requested", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...OWNER, id: "emp-2", fullName: "Karim" } as any)
    await createOpportunity({
      salesAccountId: ACCOUNT.id, name: "Core refresh", track: "NETWORKING",
      ownerEmployeeId: "emp-2", addAssignment: true,
    }, USER)
    expect(prisma.salesAccountAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ salesAccountId: ACCOUNT.id, employeeId: "emp-2" }),
    })
  })

  it("does not auto-assign an employee who cannot open the Sales Hub", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      ...OWNER, id: "emp-2", fullName: "Karim", user: { salesRole: "SALES_USER", isActive: false },
    } as any)
    await expect(createOpportunity({
      salesAccountId: ACCOUNT.id, name: "Core refresh", track: "NETWORKING",
      ownerEmployeeId: "emp-2", addAssignment: true,
    }, USER)).rejects.toThrow(/deactivated|cannot open/i)
    expect(prisma.salesAccountAssignment.create).not.toHaveBeenCalled()
  })
})

describe("opportunity reads and plain edits", () => {
  it("scopes a Sales User list through the parent account and accepts filters", async () => {
    await listOpportunities({ status: "ONGOING", stage: "OEM_PRICING", mine: true }, USER)
    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "ONGOING", stage: "OEM_PRICING", ownerEmployeeId: "emp-1",
        salesAccount: { OR: [
          { ownerEmployeeId: "emp-1" },
          { assignments: { some: { employeeId: "emp-1" } } },
        ] },
      }),
    }))
  })

  it("reports line totals without pretending unpriced lines are zero", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({
      amount: dec("300"),
      lines: [
        { id: "l1", opportunityId: "opp-1", product: "Switch", lineValue: dec("250"), order: 0, createdAt: NOW, updatedAt: NOW },
        { id: "l2", opportunityId: "opp-1", product: "Service", lineValue: null, order: 1, createdAt: NOW, updatedAt: NOW },
      ],
    }) as any)
    const result = await getOpportunity("opp-1", USER)
    expect(result).toMatchObject({
      amount: "300.00", lineTotal: "250.00", unpricedLineCount: 1,
      amountDiffersFromLines: true,
    })
  })

  it("does not call a null deal amount different from its line total", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({
      amount: null, lines: [{ id: "l1", opportunityId: "opp-1", product: "Switch", lineValue: dec("250"), order: 0, createdAt: NOW, updatedAt: NOW }],
    }) as any)
    await expect(getOpportunity("opp-1", USER)).resolves.toMatchObject({
      amount: null, amountDiffersFromLines: false,
    })
  })

  it("uses the not-visible refusal for an opportunity outside the shared directory", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(null as any)
    await expect(getOpportunity("missing", USER)).rejects.toThrow(/does not exist, or is not yours/i)
  })
})

describe("stage, status, and next step", () => {
  beforeEach(() => vi.setSystemTime(NOW))

  it("moves a stage in either direction and writes one audit and one event", async () => {
    await changeOpportunityStage("opp-1", { stage: "OEM_PRICING" }, USER)
    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stage: "OEM_PRICING", stageChangedAt: NOW, lastActivityAt: NOW }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.event.create).toHaveBeenCalledTimes(1)
  })

  it("refuses a stage change on a won deal and says to reopen first", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({ status: "WON" }) as any)
    await expect(changeOpportunityStage("opp-1", { stage: "NEGOTIATION" }, USER))
      .rejects.toThrow(/reopen/i)
  })

  it("requires a reason for a lost deal and leaves the stage untouched", async () => {
    await expect(changeOpportunityStatus("opp-1", { status: "LOST" }, USER))
      .rejects.toThrow(/reason/i)
    expect(prisma.opportunity.update).not.toHaveBeenCalled()

    await changeOpportunityStatus("opp-1", { status: "LOST", statusReason: "Competitor" }, USER)
    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ stage: expect.anything() }),
    }))
  })

  it("reopening clears closedAt but preserves stage and the original winner", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({
      status: "WON", stage: "NEGOTIATION", closedAt: NOW, wonByEmployeeId: "emp-original",
    }) as any)
    await changeOpportunityStatus("opp-1", { status: "ONGOING" }, USER)
    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ closedAt: null, status: "ONGOING" }),
    }))
    const data = vi.mocked(prisma.opportunity.update).mock.calls[0][0].data as any
    expect(data.stage).toBeUndefined()
    expect(data.wonByEmployeeId).toBeUndefined()
  })

  it("re-winning under a different owner never re-stamps the original winner", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({
      ownerEmployeeId: "emp-new", wonByEmployeeId: "emp-original",
    }) as any)
    await changeOpportunityStatus("opp-1", { status: "WON" }, USER)
    const data = vi.mocked(prisma.opportunity.update).mock.calls[0][0].data as any
    expect(data.wonByEmployeeId).toBeUndefined()
  })

  it("stamps the current owner as winner on the first win", async () => {
    await changeOpportunityStatus("opp-1", { status: "WON" }, USER)
    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ wonBy: { connect: { id: "emp-1" } } }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.event.create).toHaveBeenCalledTimes(1)
  })

  it("updates next-step date at UTC midnight with one audit and one event", async () => {
    await changeOpportunityNextStep("opp-1", {
      nextStep: "Send revised BOM", nextStepDueOn: "2026-09-12",
    }, USER)
    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nextStepDueOn: new Date("2026-09-12T00:00:00.000Z"), lastActivityAt: NOW,
      }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.event.create).toHaveBeenCalledTimes(1)
  })
})
