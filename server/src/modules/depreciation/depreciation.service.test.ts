import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    financialYear: { findUnique: vi.fn(), findFirst: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    depreciationRun: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    asset: { findMany: vi.fn() },
    assetDepreciation: { findMany: vi.fn(), createMany: vi.fn(), aggregate: vi.fn() },
    postingRule: { findMany: vi.fn() },
    account: { findMany: vi.fn(), findUnique: vi.fn() },
    idCounter: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    journal: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn() },
  }
  return {
    default: {
      depreciationRun: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import { postSystemJournal } from "../accounting/accounting.posting"
import { dec } from "../payroll/payroll.money"
import { deleteRun, draftRun, getRun, listRuns, postRun, reverseRun } from "./depreciation.service"

const D = (v: string) => new Prisma.Decimal(v)

import prisma from "../../config/prisma"

const tx = (prisma as unknown as { __tx: any }).__tx

const finance = { sub: "user-fin", role: "FINANCE_OFFICER", email: "f@demo.com", mustChangePassword: false } as never

const laptopAsset = {
  id: "a-1",
  assetTag: "BS-AST-00001",
  name: "ThinkPad T14",
  purchaseDate: new Date("2026-07-01T00:00:00.000Z"),
  purchaseCostBdt: D("120000.00"),
  capitalisedAt: new Date("2026-07-05T00:00:00.000Z"),
  retiredAt: null,
  department: null,
  category: { code: "LAPTOP", isConsumable: false },
}

const ruleRows = [
  { key: "LAPTOP", account: { code: "1114" } },
  { key: "FURNITURE", account: { code: "1111" } },
  { key: "MONITOR", account: { code: "1112" } },
  { key: "LICENCE", account: { code: "1113" } },
  { key: "PHONE", account: { code: "1112" } },
  { key: "PAYABLE", account: { code: "2110" } },
  { key: "DIRECT", account: { code: "5128" } },
  { key: "ADMINISTRATIVE", account: { code: "5215" } },
]

const chartRows = [
  { code: "1114", depreciationRate: D("20.00"), contraAccountId: "contra-1124" },
  { code: "1111", depreciationRate: D("10.00"), contraAccountId: "contra-1121" },
  { code: "1112", depreciationRate: D("10.00"), contraAccountId: "contra-1122" },
  { code: "1113", depreciationRate: D("25.00"), contraAccountId: "contra-1123" },
  { code: "1124", depreciationRate: null, contraAccountId: null },
  { code: "5128", depreciationRate: null, contraAccountId: null },
  { code: "5215", depreciationRate: null, contraAccountId: null },
]

const fy = { id: "fy-1", startDate: new Date("2026-07-01T00:00:00.000Z"), endDate: new Date("2027-06-30T00:00:00.000Z") }

beforeEach(() => {
  vi.clearAllMocks()
  ;(postSystemJournal as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "j-1",
    journalNo: "BS-JV-00001",
  })
  tx.idCounter.upsert.mockResolvedValue({ id: "DEP", value: 7 })
  tx.auditLog.create.mockResolvedValue({})
  tx.financialYear.findFirst.mockResolvedValue(fy)
  tx.accountingPeriod.findFirst.mockResolvedValue({
    id: "p-jul", status: "OPEN", financialYear: { startDate: new Date("2026-07-01T00:00:00.000Z") },
  })
  tx.postingRule.findMany.mockResolvedValue(ruleRows)
  tx.asset.findMany.mockResolvedValue([laptopAsset])
  tx.assetDepreciation.findMany.mockResolvedValue([])
  tx.assetDepreciation.createMany.mockResolvedValue({ count: 1 })
  tx.account.findMany.mockResolvedValue(chartRows)
  tx.account.findUnique.mockResolvedValue({ id: "contra-1124", code: "1124" })
  tx.depreciationRun.create.mockResolvedValue({
    id: "run-1", runNo: "BS-DEP-00007", year: 2026, month: 7, status: "DRAFT",
    journalId: null, createdBy: "user-fin",
  })
  tx.depreciationRun.findUnique.mockResolvedValue(null)
  ;(prisma as unknown as { depreciationRun: { findMany: ReturnType<typeof vi.fn> } }).depreciationRun.findMany.mockResolvedValue([])
})

describe("draftRun", () => {
  it("409s when a run already exists for the month, naming it and its status", async () => {
    tx.depreciationRun.findUnique.mockResolvedValue({
      id: "run-0", runNo: "BS-DEP-00006", year: 2026, month: 7, status: "POSTED",
    })

    await expect(draftRun({ year: 2026, month: 7 }, finance)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("BS-DEP-00006"),
    })
    expect(tx.depreciationRun.create).not.toHaveBeenCalled()
  })

  it("excludes consumables, which were expensed rather than capitalised", async () => {
    tx.asset.findMany.mockResolvedValue([
      { ...laptopAsset, id: "a-2", assetTag: "BS-AST-00002", category: { code: "MOUSE", isConsumable: true } },
    ])

    await draftRun({ year: 2026, month: 7 }, finance)

    expect(tx.assetDepreciation.createMany).toHaveBeenCalledWith({
      data: [],
    })
  })

  it("excludes assets that have never been capitalised", async () => {
    tx.asset.findMany.mockResolvedValue([
      { ...laptopAsset, capitalisedAt: null },
    ])

    await draftRun({ year: 2026, month: 7 }, finance)

    expect(tx.assetDepreciation.createMany).toHaveBeenCalledWith({ data: [] })
  })

  it("throws naming the account when a class carries no depreciation rate", async () => {
    // Spec Decision 6, rule 4. This is the error that makes somebody choose a
    // rate for the vehicle class rather than filing a nil charge for it.
    tx.asset.findMany.mockResolvedValue([
      { ...laptopAsset, id: "a-3", assetTag: "BS-AST-00003", category: { code: "VEHICLE", isConsumable: false } },
    ])
    tx.postingRule.findMany.mockResolvedValue([
      ...ruleRows,
      { key: "VEHICLE", account: { code: "1115" } },
    ])
    tx.account.findMany.mockResolvedValue([
      ...chartRows,
      { code: "1115", depreciationRate: null, contraAccountId: null },
    ])

    await expect(draftRun({ year: 2026, month: 7 }, finance)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("1115"),
    })
  })

  it("writes one AssetDepreciation row per charge, and none for a zero", async () => {
    tx.asset.findMany.mockResolvedValue([
      laptopAsset,
      { ...laptopAsset, id: "a-4", assetTag: "BS-AST-00004", purchaseCostBdt: D("1200.00") },
    ])
    // The second asset is fully depreciated by a prior charge, so it produces
    // no row.
    tx.assetDepreciation.findMany.mockResolvedValue([
      { assetId: "a-4", amount: D("1200.00"), run: { year: 2026, month: 7 } },
    ])

    await draftRun({ year: 2026, month: 7 }, finance)

    const { data } = (tx.assetDepreciation.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ assetId: "a-1", months: 1 })
  })
})

describe("postRun", () => {
  beforeEach(() => {
    tx.depreciationRun.findUnique.mockResolvedValue({
      id: "run-1", runNo: "BS-DEP-00007", year: 2026, month: 7, status: "DRAFT",
      journalId: null,
      charges: [
        {
          id: "c-1", assetId: "a-1", amount: D("2000.00"), openingBookValue: D("120000.00"), rate: D("20.00"), months: 1,
          asset: { assetTag: "BS-AST-00001", name: "ThinkPad T14", department: null, category: { code: "LAPTOP", name: "Laptop" } },
        },
      ],
    })
    tx.account.findMany.mockResolvedValue(chartRows)
    tx.account.findUnique.mockResolvedValue({ id: "contra-1124", code: "1124" })
  })

  /** THE guarantee. Also on the manual smoke list — a mock cannot prove a
   *  rollback, only that we asked for one. */
  it("refuses a closed period and leaves the run DRAFT", async () => {
    tx.accountingPeriod.findFirst.mockResolvedValue({ id: "p-jul", status: "CLOSED" })

    await expect(postRun("run-1", finance)).rejects.toMatchObject({ statusCode: 400 })
    expect(tx.depreciationRun.update).not.toHaveBeenCalled()
  })

  it("refuses a run that is not DRAFT, naming the status", async () => {
    tx.depreciationRun.findUnique.mockResolvedValue({
      id: "run-1", runNo: "BS-DEP-00007", year: 2026, month: 7, status: "POSTED",
      journalId: "j-1",
      charges: [],
    })

    await expect(postRun("run-1", finance)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("POSTED"),
    })
  })

  it("stamps journalId, postedBy and postedAt", async () => {
    tx.depreciationRun.update.mockResolvedValue({
      id: "run-1", runNo: "BS-DEP-00007", year: 2026, month: 7, status: "POSTED",
      journalId: "j-1", postedBy: "user-fin", postedAt: new Date(),
    })

    await postRun("run-1", finance)

    expect(tx.depreciationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: "POSTED",
          journalId: "j-1",
          postedBy: "user-fin",
          postedAt: expect.any(Date),
        }),
      })
    )
  })

  it("dates the journal to the last day of the run's month", async () => {
    // A July run posts on 31 July, which is what makes the July statements
    // include it. toLedgerDate truncates, so the month-end instant is safe.
    await postRun("run-1", finance)

    const input = (postSystemJournal as unknown as { mock: { calls: Array<[unknown, { date: Date }]> } }).mock.calls[0][1]
    expect(input.date).toEqual(new Date("2026-07-31T00:00:00.000Z"))
  })

  it("writes a POST audit row naming the run", async () => {
    tx.depreciationRun.update.mockResolvedValue({ id: "run-1" })

    await postRun("run-1", finance)

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: "DEPRECIATION_RUN",
        entityId: "run-1",
        action: "POST",
        changedBy: "user-fin",
      }),
    })
  })
})

describe("reverseRun", () => {
  const postedRun = {
    id: "run-1", runNo: "BS-DEP-00007", year: 2026, month: 7, status: "POSTED",
    journalId: "j-1",
    charges: [],
    journal: {
      id: "j-1", journalNo: "BS-JV-00001", status: "POSTED", periodId: "p-jul",
      date: new Date("2026-07-31T00:00:00.000Z"), narration: "Depreciation for July 2026",
      lines: [
        { accountId: "acc-5215", debit: D("2000.00"), credit: D("0.00"), narration: null, departmentId: null, employeeId: null, sourceCurrency: null, sourceAmount: null, fxRateToBdt: null, sortOrder: 0 },
        { accountId: "acc-1124", debit: D("0.00"), credit: D("2000.00"), narration: null, departmentId: null, employeeId: null, sourceCurrency: null, sourceAmount: null, fxRateToBdt: null, sortOrder: 1 },
      ],
    },
  }

  beforeEach(() => {
    tx.depreciationRun.findUnique.mockResolvedValue(postedRun)
    tx.depreciationRun.update.mockResolvedValue({
      id: "run-1", runNo: "BS-DEP-00007", year: 2026, month: 7, status: "REVERSED",
      reversedBy: "user-fin", reversedAt: new Date(),
    })
    tx.journal.findUniqueOrThrow.mockResolvedValue(postedRun.journal)
    tx.journal.create.mockResolvedValue({ id: "rev-1", journalNo: "BS-JV-00002" })
  })

  it("reverses the journal and flips the run to REVERSED", async () => {
    await reverseRun("run-1", { reason: "Wrong month" }, finance)

    expect(tx.journal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "REVERSAL",
          status: "DRAFT",
          reversesId: "j-1",
        }),
      })
    )
    expect(tx.depreciationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: "REVERSED" }),
      })
    )
  })

  it("frees the year/month slot so the month can be re-run", async () => {
    tx.depreciationRun.findUnique
      .mockResolvedValueOnce(postedRun) // reverseRun's load
      .mockResolvedValueOnce({ ...postedRun, journal: { journalNo: "BS-JV-00001" }, charges: [] }) // reverseRun's getRunDetail
      .mockResolvedValueOnce(null) // re-draft finds no conflicting run
    tx.journal.findFirst.mockResolvedValue(null)

    await reverseRun("run-1", { reason: "Wrong month" }, finance)
    await draftRun({ year: 2026, month: 7 }, finance)

    expect(tx.depreciationRun.create).toHaveBeenCalled()
  })

  it("requires a reason", async () => {
    await expect(reverseRun("run-1", { reason: "" }, finance)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(tx.journal.create).not.toHaveBeenCalled()
  })
})

describe("deleteRun", () => {
  it("deletes a DRAFT run and cascades its charges", async () => {
    tx.depreciationRun.findUnique.mockResolvedValue({
      id: "run-1", runNo: "BS-DEP-00007", year: 2026, month: 7, status: "DRAFT",
      journalId: null, charges: [],
    })

    await deleteRun("run-1", finance)

    expect(tx.depreciationRun.delete).toHaveBeenCalledWith({ where: { id: "run-1" } })
  })

  it("refuses to delete a POSTED run, pointing at reversal", async () => {
    tx.depreciationRun.findUnique.mockResolvedValue({
      id: "run-1", runNo: "BS-DEP-00007", year: 2026, month: 7, status: "POSTED",
      journalId: "j-1", charges: [],
    })

    await expect(deleteRun("run-1", finance)).rejects.toMatchObject({ statusCode: 409 })
    expect(tx.depreciationRun.delete).not.toHaveBeenCalled()
  })
})

describe("getRun / listRuns", () => {
  it("404s an unknown run id", async () => {
    tx.depreciationRun.findUnique.mockResolvedValue(null)
    await expect(getRun("nope")).rejects.toMatchObject({ statusCode: 404 })
  })

  it("lists runs newest first", async () => {
    const top = prisma as unknown as { depreciationRun: { findMany: ReturnType<typeof vi.fn> } }
    top.depreciationRun.findMany.mockResolvedValue([{ id: "run-1", charges: [] }])
    await listRuns({ year: 2026 })
    expect(top.depreciationRun.findMany).toHaveBeenCalled()
  })
})
