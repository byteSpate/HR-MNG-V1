import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({
  env: { APP_TIMEZONE: "Asia/Dhaka", ATTENDANCE_GO_LIVE: "2026-01-01" },
}))

vi.mock("../../config/prisma", () => ({
  default: {
    payrollRun: { findUnique: vi.fn(), findMany: vi.fn() },
    exchangeRate: { findFirst: vi.fn() },
    expenseClaim: { findMany: vi.fn() },
  },
}))

vi.mock("../payroll/payroll.preflight", () => ({ preflight: vi.fn() }))
vi.mock("../dealMoney/dealMoney.approvals", () => ({ countWaitingForApproval: vi.fn() }))

import prisma from "../../config/prisma"
import { Prisma } from "../../generated/prisma/client"
import type { AccessTokenPayload } from "../auth/auth.types"
import { preflight } from "../payroll/payroll.preflight"
import { countWaitingForApproval } from "../dealMoney/dealMoney.approvals"
import { parseDateOnly } from "../../utils/dates"
import { buildFinanceDashboard } from "./dashboard.finance"

const NOW = new Date("2026-08-15T06:00:00.000Z")
const actor = { sub: "user-1", role: "FINANCE_OFFICER", email: "a@d.com", mustChangePassword: false } as AccessTokenPayload

const dec = (n: string) => new Prisma.Decimal(n)

const cardBy = (payload: Awaited<ReturnType<typeof buildFinanceDashboard>>, label: string) => {
  const card = payload.stats.find((s) => s.label === label)
  if (!card) throw new Error(`No card labelled "${label}"`)
  return card
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)

  vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([] as never)
  vi.mocked(preflight).mockResolvedValue({ month: 7, year: 2026, ok: true, blockers: [] })
  vi.mocked(countWaitingForApproval).mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("run readiness", () => {
  it("preflights the previous month — the one about to be run", async () => {
    // `preflight` needs no run to exist, which is the point: Finance needs to
    // know a month is blocked *before* opening a run, not after.
    await buildFinanceDashboard(actor)
    expect(preflight).toHaveBeenCalledWith(7, 2026)
  })

  it("is green and says ready when nothing blocks", async () => {
    const card = cardBy(await buildFinanceDashboard(actor), "Run readiness")
    expect(card.value).toBe("0")
    expect(card.tone).toBe("green")
    expect(card.sub).toBe("July 2026 is ready to run")
  })

  it("names the first blocker in words", async () => {
    vi.mocked(preflight).mockResolvedValue({
      month: 7,
      year: 2026,
      ok: false,
      blockers: [
        { code: "UNAPPROVED_ATTENDANCE", message: "…", employees: [] },
        { code: "MISSING_EXCHANGE_RATE", message: "…", employees: [] },
      ],
    })

    const card = cardBy(await buildFinanceDashboard(actor), "Run readiness")
    expect(card.value).toBe("2")
    expect(card.sub).toBe("July 2026: attendance still awaiting approval")
    // There is no "a bit blocked".
    expect(card.tone).toBe("red")
  })

  it("crosses the year boundary backwards in January", async () => {
    vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"))
    await buildFinanceDashboard(actor)
    expect(preflight).toHaveBeenCalledWith(12, 2025)
  })
})

describe("exchange rate age", () => {
  it("reads Not set in red when no rate exists", async () => {
    // Never "0 days": zero days old is the healthiest possible reading and
    // the exact opposite of the truth.
    const card = cardBy(await buildFinanceDashboard(actor), "Exchange rate")
    expect(card.value).toBe("Not set")
    expect(card.tone).toBe("red")
    expect(card.sub).not.toContain("0 days")
  })

  it("is green for a rate effective today", async () => {
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      base: "USD",
      quote: "BDT",
      rate: dec("122.50"),
      effectiveFrom: parseDateOnly("2026-08-15"),
    } as never)

    const card = cardBy(await buildFinanceDashboard(actor), "Exchange rate")
    expect(card.value).toBe("৳122.50 / 1 USD")
    expect(card.sub).toBe("Set today")
    expect(card.tone).toBe("green")
  })

  it("is red for a rate ten days old", async () => {
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({
      base: "USD",
      quote: "BDT",
      rate: dec("122.50"),
      effectiveFrom: parseDateOnly("2026-08-05"),
    } as never)

    const card = cardBy(await buildFinanceDashboard(actor), "Exchange rate")
    expect(card.sub).toBe("Set 10 days ago")
    expect(card.tone).toBe("red")
  })

  it("takes the newest rate by effective date", async () => {
    await buildFinanceDashboard(actor)
    expect(prisma.exchangeRate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { effectiveFrom: "desc" } })
    )
  })
})

describe("reimbursements outstanding", () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    amount: dec("1200"),
    currency: "BDT",
    fxRateToBdt: null,
    ...over,
  })

  it("excludes a claim a payslip or settlement already consumed", async () => {
    // APPROVED is not paid. Those columns exist precisely so reimbursement is
    // a checkable fact rather than a label.
    await buildFinanceDashboard(actor)
    expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ["PENDING", "APPROVED"] },
          payslipId: null,
          settlementId: null,
        },
      })
    )
  })

  it("sums a foreign claim at its own frozen rate, not today's", async () => {
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValueOnce([
      claim({ amount: dec("100"), currency: "USD", fxRateToBdt: dec("122.5") }),
      claim({ amount: dec("1000") }),
    ] as never)

    const card = cardBy(await buildFinanceDashboard(actor), "Reimbursements outstanding")
    expect(card.value).toBe("2")
    // 100 × 122.5 + 1000 = 13,250.
    expect(card.sub).toBe("৳13,250 owed")
  })

  it("excludes an unconvertible claim from the sum but still counts it", async () => {
    // A silent 1.0 would be a 122× understatement, exactly as in payroll.
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValueOnce([
      claim({ amount: dec("100"), currency: "USD", fxRateToBdt: null }),
      claim({ amount: dec("1000") }),
    ] as never)

    const card = cardBy(await buildFinanceDashboard(actor), "Reimbursements outstanding")
    expect(card.value).toBe("2")
    expect(card.sub).toBe("৳1,000 · 1 not yet converted")
  })

  it("reads Nothing owed when there is nothing", async () => {
    const card = cardBy(await buildFinanceDashboard(actor), "Reimbursements outstanding")
    expect(card.value).toBe("0")
    expect(card.sub).toBe("Nothing owed")
    expect(card.tone).toBe("green")
  })

  it("drives the expenses badge from the same count", async () => {
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValueOnce([claim(), claim()] as never)
    const payload = await buildFinanceDashboard(actor)
    expect(payload.badges["/finance/expenses"]).toBe(2)
  })
})

describe("waiting for approval", () => {
  it("reads Nothing is waiting when the queue is empty", async () => {
    const card = cardBy(await buildFinanceDashboard(actor), "Waiting for approval")
    expect(card.value).toBe("0")
    expect(card.sub).toBe("Nothing is waiting")
    expect(card.tone).toBe("green")
  })

  it("counts the queue on the card and drives the approvals badge from the same count", async () => {
    vi.mocked(countWaitingForApproval).mockResolvedValueOnce(1)
    const payload = await buildFinanceDashboard(actor)
    const card = cardBy(payload, "Waiting for approval")
    expect(card.value).toBe("1")
    expect(payload.badges["/finance/accounting/approvals"]).toBe(1)
  })

  it("tells a Finance viewer the draft is waiting on a Super Admin, not that they can act on it", async () => {
    // A Finance Officer can see this queue but cannot approve or send back
    // a draft — only a Super Admin can (elevated finding 5).
    vi.mocked(countWaitingForApproval).mockResolvedValueOnce(2)
    const card = cardBy(await buildFinanceDashboard(actor), "Waiting for approval")
    expect(card.sub).toBe("2 drafts waiting for a Super Admin")
  })
})

describe("chart and table", () => {
  it("uses the same payroll series the admin chart uses", async () => {
    const payload = await buildFinanceDashboard(actor)
    expect(payload.chart?.bars).toHaveLength(6)
  })

  it("shows a currency on every claim row", async () => {
    // A USD claim beside a BDT one with no currency shown is a misread
    // waiting to happen — still true, but the currency now travels in the
    // text rather than a `tag` beside it. The client's CellBody returns on
    // `tag` before it reaches `text`, so a cell carrying both rendered the
    // pill alone and dropped the figure. `money()` already prints ৳ or $, so
    // the tag was duplicating what the text says and losing it in the process.
    vi.mocked(prisma.expenseClaim.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          amount: dec("80"),
          currency: "USD",
          category: "Travel",
          expenseDate: parseDateOnly("2026-07-03"),
          employee: { fullName: "Ayesha Rahman", employeeCode: "BS-EMP-DEMO" },
        },
      ] as never)

    const payload = await buildFinanceDashboard(actor)
    expect(payload.table?.rows[0][2]).toEqual({ text: "$80" })
  })

  it("lists claims oldest first", async () => {
    await buildFinanceDashboard(actor)
    expect(prisma.expenseClaim.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } })
    )
  })
})

describe("card isolation", () => {
  it("survives preflight failing", async () => {
    vi.mocked(preflight).mockRejectedValue(new Error("attendance grid blew up"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const payload = await buildFinanceDashboard(actor)
    expect(payload.stats).toHaveLength(5)
    expect(cardBy(payload, "Run readiness").failed).toBe(true)
    expect(cardBy(payload, "Exchange rate").failed).toBeUndefined()
  })
})

describe("the claims table", () => {
  const claim = {
    amount: new Prisma.Decimal("12500.50"),
    currency: "BDT",
    category: { name: "Travel" },
    expenseDate: new Date("2026-08-11T00:00:00.000Z"),
    employee: { fullName: "Nadia Rahman", employeeCode: "BS-EMP-00007" },
  }

  it("renders the amount, not just its currency", async () => {
    // `tag` short-circuits `text` in the client's CellBody, so a cell carrying
    // both rendered the currency pill alone and dropped the figure — a money
    // column with no money, on the dashboard whose whole job is money.
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([claim] as never)

    const payload = await buildFinanceDashboard(actor)
    const amount = payload.table!.rows[0][2]

    expect(amount.tag).toBeUndefined()
    // `money()` rounds below a lakh and carries the symbol, so the currency is
    // still on screen without a second element to say it.
    expect(amount.text).toBe("৳12,501")
  })

  it("writes the spent-on date in the same words as the rest of the product", async () => {
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([claim] as never)

    const payload = await buildFinanceDashboard(actor)

    expect(payload.table!.rows[0][3].text).toBe("Aug 11, 2026")
  })
})
