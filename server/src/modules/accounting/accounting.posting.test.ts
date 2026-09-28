import { beforeEach, describe, expect, it, vi } from "vitest"

import { Prisma } from "../../generated/prisma/client"
import { postSystemJournal } from "./accounting.posting"
import { utcDate } from "./accounting.utils"

/**
 * No prisma singleton mock here: postSystemJournal takes a `tx` and never
 * opens its own transaction. That is the property under test — a caller's
 * payroll run and its journal must commit or roll back together.
 */
function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    account: {
      findMany: vi.fn(async () => [
        { id: "acc-sal", code: "5201", name: "Salary and Allowances", isGroup: false, isActive: true },
        { id: "acc-pay", code: "2132", name: "Salary Payable", isGroup: false, isActive: true },
      ]),
    },
    accountingPeriod: {
      findFirst: vi.fn(async () => ({ id: "p-1", year: 2026, month: 7, status: "OPEN" })),
    },
    journal: {
      create: vi.fn(async () => ({ id: "j-1", journalNo: "BS-JV-00042" })),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({ id: "j-1", journalNo: "BS-JV-00042", status: "POSTED" })),
    },
    idCounter: { upsert: vi.fn(async () => ({ id: "JV", value: 42 })) },
    auditLog: { create: vi.fn(async () => ({})) },
    ...overrides,
  } as never
}

const input = {
  date: utcDate(2026, 7, 31),
  narration: "Salary accrual for July 2026",
  source: { module: "PAYROLL", refId: "run-2026-07", event: "SALARY_ACCRUAL" },
  lines: [
    { accountCode: "5201", debit: "500000.00" },
    { accountCode: "2132", credit: "500000.00" },
  ],
  createdBy: "system",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("postSystemJournal", () => {
  it("posts directly as POSTED, bypassing the approval queue", async () => {
    const tx = makeTx()

    await postSystemJournal(tx, input)

    expect((tx as any).journal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "POSTED", type: "SYSTEM" }),
      })
    )
  })

  it("stamps the source triple that makes it idempotent", async () => {
    const tx = makeTx()

    await postSystemJournal(tx, input)

    expect((tx as any).journal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceModule: "PAYROLL",
          sourceRefId: "run-2026-07",
          sourceEvent: "SALARY_ACCRUAL",
        }),
      })
    )
  })

  it("resolves accounts by code, so a caller never holds an Account uuid", async () => {
    const tx = makeTx()

    await postSystemJournal(tx, input)

    expect((tx as any).account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: { in: ["5201", "2132"] } } })
    )
    const lines = (tx as any).journal.create.mock.calls[0][0].data.lines.createMany.data
    expect(lines.map((l: any) => l.accountId)).toEqual(["acc-sal", "acc-pay"])
  })

  it("returns the existing journal instead of throwing when the same event is posted twice", async () => {
    const tx = makeTx({
      journal: {
        create: vi.fn(async () => {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "7.0.0",
          })
        }),
        findFirst: vi.fn(async () => ({ id: "j-existing", journalNo: "BS-JV-00007", status: "POSTED" })),
        findUnique: vi.fn(async () => ({ id: "j-existing", journalNo: "BS-JV-00007", status: "POSTED" })),
      },
    })

    const result = await postSystemJournal(tx, input)

    expect(result.journalNo).toBe("BS-JV-00007")
  })

  it("400s when a referenced account code does not exist, naming the code", async () => {
    const tx = makeTx({ account: { findMany: vi.fn(async () => []) } })

    await expect(postSystemJournal(tx, input)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("5201"),
    })
  })

  it("400s when a referenced account is a group", async () => {
    const tx = makeTx({
      account: {
        findMany: vi.fn(async () => [
          { id: "acc-sal", code: "5201", name: "Admin", isGroup: true, isActive: true },
          { id: "acc-pay", code: "2132", name: "Salary Payable", isGroup: false, isActive: true },
        ]),
      },
    })

    await expect(postSystemJournal(tx, input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400s an unbalanced generated entry — a machine gets no exemption", async () => {
    const tx = makeTx()

    await expect(
      postSystemJournal(tx, {
        ...input,
        lines: [
          { accountCode: "5201", debit: "500000.00" },
          { accountCode: "2132", credit: "490000.00" },
        ],
      })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400s when the target period is closed", async () => {
    const tx = makeTx({
      accountingPeriod: {
        findFirst: vi.fn(async () => ({ id: "p-1", year: 2026, month: 7, status: "CLOSED" })),
      },
    })

    await expect(postSystemJournal(tx, input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it("carries the department and employee dimensions through to the lines", async () => {
    const tx = makeTx()

    await postSystemJournal(tx, {
      ...input,
      lines: [
        { accountCode: "5201", debit: "500000.00", departmentId: "dept-1", employeeId: "emp-1" },
        { accountCode: "2132", credit: "500000.00" },
      ],
    })

    const lines = (tx as any).journal.create.mock.calls[0][0].data.lines.createMany.data
    expect(lines[0]).toMatchObject({ departmentId: "dept-1", employeeId: "emp-1" })
    expect(lines[1]).toMatchObject({ departmentId: null, employeeId: null })
  })

  /**
   * The three memo columns existed on `JournalLine` from slice 1, with a
   * comment saying they are there so a line reading 61,25,000 can answer
   * "why?" with "USD 50,000 at 122.50" — but the seam's input type did not
   * carry them, so every caller that worked one out had it silently dropped.
   */
  it("persists the FX memo a caller supplies", async () => {
    const tx = makeTx()

    await postSystemJournal(tx, {
      ...input,
      lines: [
        { accountCode: "5201", debit: "6125000.00", sourceCurrency: "USD", sourceAmount: "50000.00", fxRateToBdt: "122.500000" },
        { accountCode: "2132", credit: "6125000.00" },
      ],
    })

    const lines = (tx as any).journal.create.mock.calls[0][0].data.lines.createMany.data
    expect(lines[0].sourceCurrency).toBe("USD")
    expect(lines[0].sourceAmount.toFixed(2)).toBe("50000.00")
    expect(lines[0].fxRateToBdt.toFixed(6)).toBe("122.500000")
  })

  it("leaves the FX memo null on a BDT transaction", async () => {
    const tx = makeTx()

    await postSystemJournal(tx, input)

    const lines = (tx as any).journal.create.mock.calls[0][0].data.lines.createMany.data
    expect(lines[0]).toMatchObject({ sourceCurrency: null, sourceAmount: null, fxRateToBdt: null })
  })

  it("writes a POST audit row naming the source", async () => {
    const tx = makeTx()

    await postSystemJournal(tx, input)

    expect((tx as any).auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "JOURNAL",
          action: "POST",
          after: expect.objectContaining({ sourceModule: "PAYROLL" }),
        }),
      })
    )
  })

  it("never opens a transaction of its own", async () => {
    const tx = makeTx()

    await postSystemJournal(tx, input)

    expect((tx as any).$transaction).toBeUndefined()
  })

  /**
   * Callers hold real timestamps, not date-only values: a payroll run's
   * `createdAt`, a disbursement's `new Date()`. Untruncated, a 31 July
   * timestamp is past the July period's endDate of 31 July at midnight, so
   * every month-end posting would fail with "no financial year covers
   * 2026-07-31". Truncating here rather than in each caller is what makes the
   * seam safe to call with whatever date the calling module happens to have.
   */
  describe("date truncation", () => {
    const stamped = { ...input, date: new Date("2026-07-31T14:22:07.412Z") }

    it("resolves the period from the truncated date", async () => {
      const tx = makeTx()

      await postSystemJournal(tx, stamped)

      expect((tx as any).accountingPeriod.findFirst).toHaveBeenCalledWith({
        where: {
          startDate: { lte: utcDate(2026, 7, 31) },
          endDate: { gte: utcDate(2026, 7, 31) },
        },
      })
    })

    it("stores the truncated date on the journal", async () => {
      const tx = makeTx()

      await postSystemJournal(tx, stamped)

      const created = (tx as any).journal.create.mock.calls[0][0].data
      expect(created.date.toISOString()).toBe("2026-07-31T00:00:00.000Z")
    })
  })

  describe("receivables & payables dimensions", () => {
    it("carries opportunityId, customerId and supplierId through to the JournalLine data", async () => {
      const tx = makeTx()
      const withDimensions = {
        date: utcDate(2026, 10, 5),
        narration: "Supplier bill — Smart Technologies",
        source: { module: "SUPPLIER", refId: "bill-1", event: "ACCRUAL" },
        lines: [
          { accountCode: "5201", debit: "80000.00", supplierId: "sup-1", opportunityId: "opp-1" },
          { accountCode: "2132", credit: "80000.00", customerId: "cus-1" },
        ],
        createdBy: "system",
      }

      await postSystemJournal(tx, withDimensions)

      const created = (tx as any).journal.create.mock.calls[0][0].data
      const lines = created.lines.createMany.data
      expect(lines[0]).toEqual(
        expect.objectContaining({ supplierId: "sup-1", opportunityId: "opp-1", customerId: null })
      )
      expect(lines[1]).toEqual(
        expect.objectContaining({ customerId: "cus-1", supplierId: null, opportunityId: null })
      )
    })

    it("defaults all three dimensions to null when a caller omits them, unchanged from every existing caller", async () => {
      const tx = makeTx()

      await postSystemJournal(tx, input)

      const created = (tx as any).journal.create.mock.calls[0][0].data
      const lines = created.lines.createMany.data
      for (const line of lines) {
        expect(line.opportunityId).toBeNull()
        expect(line.customerId).toBeNull()
        expect(line.supplierId).toBeNull()
      }
    })
  })
})
