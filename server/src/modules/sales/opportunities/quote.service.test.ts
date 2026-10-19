import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    opportunity: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    opportunityQuote: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../../attendance/attendance.time", async () => ({
  ...(await vi.importActual<object>("../../attendance/attendance.time")),
  officeDateOf: () => new Date("2026-10-13T00:00:00.000Z"),
}))

import prisma from "../../../config/prisma"
import { dec } from "../../payroll/payroll.money"
import { addQuote, deleteLatestQuote, editLatestQuote, quoteText } from "./quote.service"

const OWNER_USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const COLLAB_USER = { sub: "user-2", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "user-9", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const NOW = new Date("2026-10-13T05:00:00.000Z")
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

const opp = (o: Record<string, unknown> = {}) => ({
  id: "opp-1", serial: "BS-OPP-00001", salesAccountId: "acc-1", track: "NETWORKING", name: "Core refresh",
  oemAccountManager: null, amount: dec("1000000"), currency: "BDT", expectedCloseDate: null,
  offeredOn: null, status: "ONGOING", statusReason: null, closedAt: null,
  stage: "COMMERCIAL_NEGOTIATION", stageChangedAt: NOW, nextStep: null, nextStepDueOn: null,
  softwareNeeded: null, ownerEmployeeId: "emp-1", wonByEmployeeId: null, lastActivityAt: NOW,
  createdAt: NOW, updatedAt: NOW, owner: { id: "emp-1", fullName: "Rahim" },
  salesAccount: { id: "acc-1", name: "Rising", ownerEmployeeId: "emp-1", assignments: [{ employeeId: "emp-2" }] },
  lines: [], quotes: [], project: null, handedOverFrom: null, handedOverTo: null, ...o,
})
const quote = (o: Record<string, unknown> = {}) => ({
  id: "q-1", opportunityId: "opp-1", amount: dec("1200000"), quotedOn: d("2026-10-03"), reference: null, note: null,
  stage: "COMMERCIAL_NEGOTIATION", createdBy: "user-1", updatedBy: "user-1", createdAt: NOW, updatedAt: NOW, ...o,
})
const BODY = { amount: "1200000", quotedOn: "2026-10-03", reference: "BS-Q-0012", note: null }
const audits = () => vi.mocked(prisma.auditLog.create).mock.calls.map((c) => (c[0] as any).data)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockImplementation((async (args: any) => ({
    employee: { id: args.where.id === "user-1" ? "emp-1" : args.where.id === "user-2" ? "emp-2" : "emp-9" },
  })) as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opp() as any)
  // The amount as it is once the row is locked. Matches opp() unless a test says otherwise.
  vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({ amount: dec("1000000") } as any)
  vi.mocked(prisma.opportunityQuote.create).mockImplementation((async (a: any) => quote({ ...a.data, id: "q-new" })) as any)
})

describe("quoteText", () => {
  it("reads like a sentence part", () => {
    expect(quoteText({ amount: dec("1200000"), quotedOn: d("2026-10-03"), reference: "BS-Q-0012" })).toBe(
      "৳12,00,000.00 on 3 October 2026 (BS-Q-0012)",
    )
  })
})

describe("adding a quote", () => {
  it("creates Quote 1 at the current stage, sets the amount and the Funnel date, and writes History", async () => {
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(quote({ id: "q-new" }) as any)
    await addQuote("opp-1", BODY, OWNER_USER)
    expect(prisma.opportunityQuote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        opportunityId: "opp-1", amount: dec("1200000"), quotedOn: d("2026-10-03"), reference: "BS-Q-0012",
        stage: "COMMERCIAL_NEGOTIATION", createdBy: "user-1", updatedBy: "user-1",
      }),
    })
    expect(prisma.opportunity.update).toHaveBeenCalledWith({ where: { id: "opp-1" }, data: { offeredOn: d("2026-10-03") } })
    expect(prisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: "opp-1" }, data: expect.objectContaining({ amount: dec("1200000") }),
    })
    expect(audits()).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "OPPORTUNITY", before: { quote: null }, after: { quote: "৳12,00,000.00 on 3 October 2026 (BS-Q-0012)" } }),
      expect.objectContaining({ before: { amount: "1000000.00" }, after: { amount: "1200000.00" } }),
    ]))
  })

  it("does not move the amount when the new quote is not the latest", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opp({ offeredOn: d("2026-10-01"), amount: dec("1500000") }) as any)
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({ amount: dec("1500000") } as any)
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(quote({ id: "q-latest", amount: dec("1500000"), quotedOn: d("2026-10-10") }) as any)
    await addQuote("opp-1", BODY, OWNER_USER)
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })

  it("refuses before a quote stage", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opp({ stage: "DISCOVERY_DESIGN" }) as any)
    await expect(addQuote("opp-1", BODY, OWNER_USER)).rejects.toMatchObject({
      statusCode: 409, message: "Add a quote when the Opportunity reaches a quote stage.",
    })
  })

  it("refuses a date in the future", async () => {
    await expect(addQuote("opp-1", { ...BODY, quotedOn: "2026-10-14" }, OWNER_USER)).rejects.toMatchObject({
      statusCode: 400, message: "A quote date cannot be in the future.",
    })
  })

  it("refuses a closed Opportunity", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opp({ status: "WON" }) as any)
    await expect(addQuote("opp-1", BODY, OWNER_USER)).rejects.toMatchObject({
      statusCode: 409, message: "This Opportunity is closed, so its quotes cannot change.",
    })
  })
})

describe("editing and deleting the latest quote", () => {
  beforeEach(() => {
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(quote() as any)
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opp({ offeredOn: d("2026-10-03"), amount: dec("1200000") }) as any)
    vi.mocked(prisma.opportunityQuote.update).mockImplementation((async (a: any) => quote({ ...a.data })) as any)
  })

  it("lets the owner edit the latest, and the amount follows", async () => {
    vi.mocked(prisma.opportunityQuote.findFirst)
      .mockResolvedValueOnce(quote() as any)
      .mockResolvedValueOnce(quote({ amount: dec("1100000") }) as any)
    await editLatestQuote("opp-1", "q-1", { ...BODY, amount: "1100000" }, OWNER_USER)
    expect(prisma.opportunityQuote.update).toHaveBeenCalledWith({
      where: { id: "q-1" },
      data: expect.objectContaining({ amount: dec("1100000"), updatedBy: "user-1" }),
    })
    expect(prisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: "opp-1" }, data: expect.objectContaining({ amount: dec("1100000") }),
    })
  })

  it("moves the Funnel date when Quote 1's date is corrected", async () => {
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(quote() as any)
    await editLatestQuote("opp-1", "q-1", { ...BODY, quotedOn: "2026-10-01" }, OWNER_USER)
    expect(prisma.opportunity.update).toHaveBeenCalledWith({ where: { id: "opp-1" }, data: { offeredOn: d("2026-10-01") } })
  })

  it("refuses an older quote", async () => {
    await expect(editLatestQuote("opp-1", "q-old", BODY, OWNER_USER)).rejects.toMatchObject({
      statusCode: 409, message: "Only the latest quote can be changed. Older quotes are kept as history.",
    })
  })

  it("refuses a collaborator who is not the owner, and lets a Sales Admin", async () => {
    await expect(editLatestQuote("opp-1", "q-1", BODY, COLLAB_USER)).rejects.toMatchObject({
      statusCode: 403, message: "Only the Opportunity owner or a Sales Admin can change a quote.",
    })
    await expect(deleteLatestQuote("opp-1", "q-1", ADMIN)).resolves.toBeDefined()
  })

  it("deleting the latest of two moves the amount to the one left", async () => {
    vi.mocked(prisma.opportunityQuote.findFirst)
      .mockResolvedValueOnce(quote() as any)
      .mockResolvedValueOnce(quote({ id: "q-0", amount: dec("1300000"), quotedOn: d("2026-09-20") }) as any)
    await deleteLatestQuote("opp-1", "q-1", OWNER_USER)
    expect(prisma.opportunityQuote.delete).toHaveBeenCalledWith({ where: { id: "q-1" } })
    expect(prisma.opportunity.update).toHaveBeenCalledWith({
      where: { id: "opp-1" }, data: expect.objectContaining({ amount: dec("1300000") }),
    })
    expect(audits()[0]).toMatchObject({ before: { quote: "৳12,00,000.00 on 3 October 2026" }, after: { quote: null } })
  })

  it("deleting the only quote leaves the amount and the Funnel date alone", async () => {
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValueOnce(quote() as any).mockResolvedValueOnce(null)
    await deleteLatestQuote("opp-1", "q-1", OWNER_USER)
    expect(prisma.opportunity.update).not.toHaveBeenCalled()
  })

  it("says so when the quote is not on this Opportunity", async () => {
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(null)
    await expect(deleteLatestQuote("opp-1", "q-x", OWNER_USER)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("two quote saves at the same moment (review of PR #99)", () => {
  const order = (fn: unknown) => (vi.mocked(fn as any).mock.invocationCallOrder[0] ?? Infinity)

  it("locks the Opportunity before it reads the latest quote, on add", async () => {
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(quote({ id: "q-new" }) as any)
    await addQuote("opp-1", BODY, OWNER_USER)
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(order(prisma.$queryRaw)).toBeLessThan(order(prisma.opportunityQuote.findFirst))
  })

  it("locks the Opportunity before it reads the latest quote, on edit and delete", async () => {
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(quote() as any)
    await editLatestQuote("opp-1", "q-1", BODY, OWNER_USER)
    expect(order(prisma.$queryRaw)).toBeLessThan(order(prisma.opportunityQuote.findFirst))
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(opp() as any)
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({ amount: dec("1000000") } as any)
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(quote() as any)
    await deleteLatestQuote("opp-1", "q-1", OWNER_USER)
    expect(order(prisma.$queryRaw)).toBeLessThan(order(prisma.opportunityQuote.findFirst))
  })

  it("compares with the amount saved once locked, not the one read before", async () => {
    // Another save already set the amount to this quote's figure while we waited for the lock.
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({ amount: dec("1200000") } as any)
    vi.mocked(prisma.opportunityQuote.findFirst).mockResolvedValue(quote({ id: "q-new" }) as any)
    await addQuote("opp-1", BODY, OWNER_USER)
    expect(prisma.opportunity.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: expect.anything() }) }))
  })
})
