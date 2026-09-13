import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
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
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    event: { create: vi.fn(), findMany: vi.fn() },
    salesComment: { findMany: vi.fn() },
    salesMeeting: { findMany: vi.fn() },
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
  getOpportunityHistory,
  getOpportunityTimeline,
  listOpportunities,
  listOpportunityOwners,
  updateOpportunity,
} from "./opportunity.service"
import { nextOpportunitySerial } from "./sales.serial"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "sales@example.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any

// `assignments` is part of the read include, so the fixture carries it too —
// the payload now reports whether the viewer may write to the deal.
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
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.opportunity.update).mockImplementation((async (args: any) =>
    opportunity({ ...args.data }) as any) as any)
})

describe("a deal's margin, from its products", () => {
  /** A product line on the deal, priced and with a margin unless a test says otherwise. */
  const line = (overrides: Record<string, unknown> = {}) => ({
    id: "l1", opportunityId: "opp-1", product: "Firewall", oemBrand: null, model: null, quantity: null,
    unitValue: null, lineValue: dec("10000"), marginPercent: dec("12"), note: null, order: 0,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  })

  it("adds up its products' margins", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({
      lines: [line(), line({ id: "l2", product: "Switch", lineValue: dec("5000"), marginPercent: dec("10"), order: 1 })],
    }) as any)

    const deal = await getOpportunity("opp-1", USER)

    // 12% of 10,000 plus 10% of 5,000.
    expect(deal.marginAmount).toBe("1700.00")
    expect(deal.unmarginedLineCount).toBe(0)
    expect(deal.lines[0]).toMatchObject({ marginPercent: "12.00", marginAmount: "1200.00" })
  })

  it("has no margin rather than ৳0 when no product carries one, and counts the products without", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({
      // A margin with no Total price cannot be worked out: Total price is never calculated.
      lines: [line({ lineValue: null })],
    }) as any)

    const deal = await getOpportunity("opp-1", USER)

    expect(deal.marginAmount).toBeNull()
    expect(deal.unmarginedLineCount).toBe(1)
    expect(deal.lines[0].marginAmount).toBeNull()
  })

  it("no longer keeps a margin on the deal itself", async () => {
    await createOpportunity(
      { salesAccountId: ACCOUNT.id, name: "Core refresh", track: "NETWORKING", marginPercent: "12" } as any, USER
    )
    await updateOpportunity("opp-1", { name: "Core switch refresh", marginPercent: "15" } as any, USER)

    const created = vi.mocked(prisma.opportunity.create).mock.calls[0][0].data as any
    const updated = vi.mocked(prisma.opportunity.update).mock.calls[0][0].data as any
    expect(created).not.toHaveProperty("marginPercent")
    expect(updated).not.toHaveProperty("marginPercent")
  })
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
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      ...OWNER, id: "emp-2", fullName: "Karim",
    } as any)
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

  it("does not accept an ineligible owner merely because they are already assigned", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      ...OWNER, id: "emp-2", fullName: "Karim", user: { salesRole: null, isActive: true },
    } as any)
    vi.mocked(prisma.salesAccountAssignment.findUnique).mockResolvedValue({ id: "assignment-1" } as any)

    await expect(createOpportunity({
      salesAccountId: ACCOUNT.id, name: "Core refresh", track: "NETWORKING",
      ownerEmployeeId: "emp-2",
    }, USER)).rejects.toThrow(/Sales Hub access/i)
    expect(prisma.opportunity.create).not.toHaveBeenCalled()
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

  it("lists every owner represented in the viewer's opportunity directory", async () => {
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([
      { ownerEmployeeId: "emp-2", owner: { id: "emp-2", fullName: "Karim" } },
      { ownerEmployeeId: "emp-1", owner: { id: "emp-1", fullName: "Rahim" } },
    ] as any)
    await expect(listOpportunityOwners(USER)).resolves.toEqual([
      { id: "emp-2", fullName: "Karim" }, { id: "emp-1", fullName: "Rahim" },
    ])
    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      distinct: ["ownerEmployeeId"],
      where: { salesAccount: expect.any(Object) },
    }))
  })

  it("turns dashboard action filters into matching date predicates", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    await listOpportunities({ closing: 30, quiet: 30, stuck: 21 } as any, USER)

    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "ONGOING",
        expectedCloseDate: { gte: expect.any(Date), lte: expect.any(Date) },
        lastActivityAt: { lt: expect.any(Date) },
        stageChangedAt: { lt: expect.any(Date) },
      }),
    }))
  })

  it("returns opportunity and line audits as one capped history", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({ lines: [] }) as any)
    vi.mocked(prisma.auditLog.findMany)
      // The line has been deleted, so only its create/delete audit anchors it
      // to this Opportunity. Its earlier edits must still remain visible.
      .mockResolvedValueOnce([{ entityId: "line-deleted" }] as any)
      .mockResolvedValueOnce([{
      id: "audit-1", entity: "OPPORTUNITY_LINE", entityId: "line-deleted", action: "UPDATE",
      changedAt: NOW, changedBy: USER.sub, before: { product: "Old" }, after: { product: "Switch" }, note: null,
      }] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{
      id: USER.sub, email: USER.email, displayName: "Rahim", employee: null,
    }] as any)

    await expect(getOpportunityHistory("opp-1", USER)).resolves.toMatchObject({
      items: [{ entity: "OPPORTUNITY_LINE", changedByName: "Rahim", changes: [{ label: "Product" }] }],
      truncated: false,
      limit: 100,
    })
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { OR: [
        { entity: "OPPORTUNITY", entityId: "opp-1" },
        { entity: "OPPORTUNITY_LINE", entityId: { in: ["line-deleted"] } },
      ] },
      take: 101,
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

  it("does not report a difference when no line has been priced yet", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({
      amount: dec("500000"),
      lines: [
        { id: "l1", opportunityId: "opp-1", product: "Switch", lineValue: null, order: 0, createdAt: NOW, updatedAt: NOW },
        { id: "l2", opportunityId: "opp-1", product: "Service", lineValue: null, order: 1, createdAt: NOW, updatedAt: NOW },
      ],
    }) as any)
    // Nothing has been costed, so there is no line total to differ from.
    // Reporting a difference offers "set deal value to line total", and the
    // total of nothing is zero, so pressing it would wipe a real deal value.
    await expect(getOpportunity("opp-1", USER)).resolves.toMatchObject({
      unpricedLineCount: 2, amountDiffersFromLines: false,
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

  it("preserves closedAt when correcting one closed status to another", async () => {
    const originallyClosedAt = new Date("2026-08-31T09:00:00.000Z")
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opportunity({
      status: "LOST", statusReason: "Budget", closedAt: originallyClosedAt,
    }) as any)

    await changeOpportunityStatus("opp-1", { status: "CANCELLED", statusReason: "Project stopped" }, USER)

    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ closedAt: expect.anything() }),
    }))
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

describe("the deal Timeline, management notes", () => {
  const ADMIN = { ...USER, salesRole: "SALES_ADMIN" } as any

  beforeEach(() => {
    vi.mocked(prisma.salesComment.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.event.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([] as any)
  })

  it("puts meetings about the deal on its Timeline", async () => {
    vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([{
      id: "meeting-1", title: "Firewall walkthrough", mode: "CUSTOMER_SITE", status: "SCHEDULED",
      scheduledAt: new Date("2026-09-20T04:00:00.000Z"),
    }] as any)

    const { items } = await getOpportunityTimeline("opp-1", USER)

    expect(prisma.salesMeeting.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { opportunityId: "opp-1" },
    }))
    expect(items).toContainEqual(expect.objectContaining({
      id: "meeting:meeting-1", kind: "meeting", title: "Firewall walkthrough",
      at: "2026-09-20T04:00:00.000Z",
    }))
  })

  it("leaves management notes out of a Sales User's deal Timeline", async () => {
    await getOpportunityTimeline("opp-1", USER)

    expect(prisma.salesComment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ kind: { not: "MANAGEMENT_NOTE" } }),
    }))
  })

  it("keeps management notes in a Sales Admin's deal Timeline", async () => {
    await getOpportunityTimeline("opp-1", ADMIN)

    const where = (vi.mocked(prisma.salesComment.findMany).mock.calls[0][0] as any).where
    expect(where).not.toHaveProperty("kind")
  })
})
