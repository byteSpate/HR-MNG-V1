import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: { expenseClaim: { findMany: vi.fn() } },
}))

vi.mock("../attendance/attendance.service", () => ({
  requireEmployeeForUser: vi.fn(async () => ({ id: "emp-self" })),
}))

import prisma from "../../config/prisma"
import type { AccessTokenPayload } from "../auth/auth.types"
import {
  getExpenseReport,
  MAX_REPORT_DAYS,
  reportFilename,
  reportToCsv,
  resolveRange,
} from "./expense.report"

const actor = (role: string, sub = "user-1") =>
  ({ sub, role, email: "a@demo.com", mustChangePassword: false }) as AccessTokenPayload

const STAFF = actor("EMPLOYEE")
const FINANCE = actor("FINANCE_OFFICER", "user-fin")

const AYESHA = { id: "emp-self", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001" }
const KARIM = { id: "emp-2", fullName: "Karim, Md.", employeeCode: "BS-EMP-002" }

function claim(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "claim-1",
    name: "Water jar",
    employee: AYESHA,
    category: { code: "TRAVEL", name: "Travel and conveyance" },
    expenseDate: new Date("2026-07-14T00:00:00.000Z"),
    amount: { toFixed: (n: number) => (1200).toFixed(n), valueOf: () => 1200 },
    currency: "BDT",
    status: "APPROVED",
    description: "Client visit",
    travelFrom: "Gulshan 1",
    travelTo: "Motijheel",
    payslip: null,
    _count: { attachments: 1 },
    ...over,
  }
}

const rows = (...list: unknown[]) =>
  vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue(list as never)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("resolveRange", () => {
  it("rejects a range that runs backwards", () => {
    expect(() => resolveRange("2026-08-10", "2026-08-01")).toThrow(
      "`to` must not be earlier than `from`"
    )
  })

  it("accepts a single day", () => {
    const { start, end } = resolveRange("2026-08-10", "2026-08-10")
    expect(start.getTime()).toBe(end.getTime())
  })

  it(`rejects a range longer than ${MAX_REPORT_DAYS} days`, () => {
    expect(() => resolveRange("2020-01-01", "2026-12-31")).toThrow("must not span more than")
  })
})

describe("who a report may be about", () => {
  // The failure that matters. Filtering *after* a role check is the same
  // thing; filtering instead of one is how somebody reads a colleague's claims.
  it("pins an employee to their own claims, whoever they ask for", async () => {
    rows(claim())

    await getExpenseReport(STAFF, { from: "2026-07-01", to: "2026-07-31", employeeId: "emp-2" })
      .catch(() => undefined)

    await expect(
      getExpenseReport(STAFF, { from: "2026-07-01", to: "2026-07-31", employeeId: "emp-2" })
    ).rejects.toThrow("You may only report on your own expense claims")
  })

  it("scopes an employee asking for no one in particular to themselves", async () => {
    rows(claim())

    await getExpenseReport(STAFF, { from: "2026-07-01", to: "2026-07-31" })

    const where = vi.mocked(prisma.expenseClaim.findMany).mock.calls[0][0]!.where as {
      employeeId?: string
    }
    expect(where.employeeId).toBe("emp-self")
  })

  it("lets Finance report on one named person", async () => {
    rows(claim({ employee: KARIM }))

    const report = await getExpenseReport(FINANCE, {
      from: "2026-07-01",
      to: "2026-07-31",
      employeeId: "emp-2",
    })

    expect(report.employee).toEqual(KARIM)
  })

  it("lets Finance report across everybody, and names nobody in the header", async () => {
    rows(claim(), claim({ employee: KARIM }))

    const report = await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" })

    // Otherwise the header would name whoever filed the first claim.
    expect(report.employee).toBeNull()
    expect(report.rows).toHaveLength(2)
  })
})

describe("the range", () => {
  // A July taxi fare submitted in August belongs to July. Ranging on
  // createdAt would put the same spend in the wrong month for anyone who
  // claims late, which is everyone.
  it("ranges on the spend date, never on the claim date", async () => {
    rows(claim())

    await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" })

    const where = vi.mocked(prisma.expenseClaim.findMany).mock.calls[0][0]!.where as {
      expenseDate?: unknown
      createdAt?: unknown
    }
    expect(where.expenseDate).toBeDefined()
    expect(where.createdAt).toBeUndefined()
  })
})

describe("totals", () => {
  // The one that cannot be got wrong: a BDT total silently containing a USD
  // claim is a number nobody can spot and nobody can use.
  it("sums money per currency and never across them", async () => {
    rows(
      claim(),
      claim({ id: "c2", currency: "USD", amount: { toFixed: (n: number) => (80).toFixed(n), valueOf: () => 80 } })
    )

    const report = await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" })

    expect(report.totals.byCurrency).toEqual([
      { currency: "BDT", claims: 1, amount: "1200.00" },
      { currency: "USD", claims: 1, amount: "80.00" },
    ])
    expect(report.totals.claims).toBe(2)
  })

  it("counts claims by status", async () => {
    rows(claim(), claim({ id: "c2", status: "PENDING" }), claim({ id: "c3", status: "PENDING" }))

    const report = await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" })

    // Money rides along with the count. "2 pending" answers how many; the
    // employee's actual question is how much, and that is an amount.
    expect(report.totals.byStatus).toEqual([
      { status: "APPROVED", claims: 1, byCurrency: [{ currency: "BDT", amount: "1200.00" }] },
      { status: "PENDING", claims: 2, byCurrency: [{ currency: "BDT", amount: "2400.00" }] },
    ])
  })

  // The same rule `byCurrency` exists for. A status holding one BDT and one
  // USD claim is two figures, never one.
  it("splits a status by currency rather than adding across them", async () => {
    rows(
      claim({ status: "PENDING" }),
      claim({
        id: "c2",
        status: "PENDING",
        currency: "USD",
        amount: { toFixed: (n: number) => (80).toFixed(n), valueOf: () => 80 },
      })
    )

    const report = await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" })
    const pending = report.totals.byStatus.find((s) => s.status === "PENDING")!

    expect(pending.claims).toBe(2)
    expect(pending.byCurrency).toEqual([
      { currency: "BDT", amount: "1200.00" },
      { currency: "USD", amount: "80.00" },
    ])
  })
})

describe("CSV", () => {
  /**
   * The headers and the row builder are two separate lists that have to stay
   * in step. Adding "Expense" moved every column after it by one, and a
   * mismatch does not throw — it silently files each value under its
   * neighbour's heading, which is worse than an error.
   */
  it("puts exactly as many values in a row as there are headings", async () => {
    rows(claim())
    const csv = reportToCsv(await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" }))
    const [header, row] = csv.split("\r\n")

    expect(row.split(",")).toHaveLength(header.split(",").length)
    expect(header.split(",")).toContain("Expense")
  })

  it("carries the expense name, which is what identifies a claim", async () => {
    rows(claim({ name: "Water jar" }))
    const csv = reportToCsv(await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" }))
    const headers = csv.split("\r\n")[0].split(",")

    expect(csv.split("\r\n")[1].split(",")[headers.indexOf("Expense")]).toBe("Water jar")
  })

  it("carries the route columns, which only travel claims fill in", async () => {
    rows(claim())
    const csv = reportToCsv(await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" }))

    const [header, row] = csv.split("\r\n")
    expect(header).toContain("From,To")
    expect(row).toContain("Gulshan 1")
    expect(row).toContain("Motijheel")
  })

  it("quotes a name containing a comma, so the columns do not shift", async () => {
    rows(claim({ employee: KARIM }))
    const csv = reportToCsv(await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" }))

    expect(csv).toContain('"Karim, Md."')
  })

  it("leaves the route blank for a claim that is not a journey", async () => {
    rows(claim({ category: { code: "STATIONERY", name: "Stationery" }, travelFrom: null, travelTo: null }))
    const csv = reportToCsv(await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" }))

    expect(csv.split("\r\n")[1]).toContain(",,")
  })
})

describe("reportFilename", () => {
  it("names the person when the report is about one", async () => {
    rows(claim())
    const report = await getExpenseReport(FINANCE, {
      from: "2026-07-01",
      to: "2026-07-31",
      employeeId: "emp-self",
    })

    expect(reportFilename(report, "pdf")).toBe("expenses-BS-EMP-001-2026-07-01-to-2026-07-31.pdf")
  })

  it("names only the range when it covers everybody", async () => {
    rows(claim())
    const report = await getExpenseReport(FINANCE, { from: "2026-07-01", to: "2026-07-31" })

    expect(reportFilename(report, "csv")).toBe("expenses-2026-07-01-to-2026-07-31.csv")
  })
})
