import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./accounting.coa.service", () => ({
  listAccounts: vi.fn(async () => []),
  listAccountsFlat: vi.fn(async () => []),
  getAccount: vi.fn(async () => ({ id: "acc-1" })),
  createAccount: vi.fn(async () => ({ id: "acc-1" })),
  updateAccount: vi.fn(async () => ({ id: "acc-1" })),
  deleteAccount: vi.fn(async () => undefined),
  requirePostableAccounts: vi.fn(),
}))

vi.mock("./accounting.period.service", () => ({
  listFinancialYears: vi.fn(async () => []),
  createFinancialYear: vi.fn(async () => ({ id: "fy-1" })),
  updateFinancialYear: vi.fn(async () => ({ id: "fy-1" })),
  deleteFinancialYear: vi.fn(async () => undefined),
  listPeriods: vi.fn(async () => []),
  closePeriod: vi.fn(async () => ({ id: "p-1" })),
  reopenPeriod: vi.fn(async () => ({ id: "p-1" })),
  resolveOpenPeriod: vi.fn(),
  earliestOpenPeriodFrom: vi.fn(),
  monthLabel: vi.fn(() => "July 2026"),
}))

vi.mock("./accounting.journal.service", () => ({
  listJournals: vi.fn(async () => ({ rows: [], total: 0 })),
  getJournal: vi.fn(async () => ({ id: "j-1" })),
  createJournal: vi.fn(async () => ({ id: "j-1" })),
  updateJournal: vi.fn(async () => ({ id: "j-1" })),
  deleteJournal: vi.fn(async () => undefined),
  submitJournal: vi.fn(async () => ({ id: "j-1" })),
  nextJournalNo: vi.fn(),
  toLineData: vi.fn(),
  assertEditable: vi.fn(),
}))

vi.mock("./accounting.journal.post", () => ({
  approveJournal: vi.fn(async () => ({ id: "j-1" })),
  rejectJournal: vi.fn(async () => ({ id: "j-1" })),
  reverseJournal: vi.fn(async () => ({ id: "j-2" })),
  postApprovedJournal: vi.fn(),
}))

vi.mock("./accounting.yearend", () => ({
  draftYearEndJournal: vi.fn(async () => ({ id: "j-close" })),
  lockYearAfterClosing: vi.fn(),
}))

vi.mock("./accounting.ledger.service", () => ({
  generalLedger: vi.fn(async () => ({ rows: [] })),
  cashOrBankBook: vi.fn(async () => ({ rows: [] })),
  listCashAccounts: vi.fn(async () => []),
  trialBalance: vi.fn(async () => ({ rows: [], isBalanced: true })),
}))

vi.mock("./accounting.media", () => ({
  uploadJournalAttachment: vi.fn(async () => ({ id: "att-1" })),
  listJournalAttachments: vi.fn(async () => []),
  getJournalAttachmentUrl: vi.fn(async () => ({ url: "https://signed", expiresAt: "x" })),
  deleteJournalAttachment: vi.fn(async () => undefined),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { approveJournal } from "./accounting.journal.post"
import { listAccounts } from "./accounting.coa.service"

// Valid v4-format UUIDs — Zod's uuid() enforces the version/variant bits.
const UUID_A = "11111111-1111-4111-8111-111111111111"
const UUID_B = "22222222-2222-4222-8222-222222222222"

const authHeader = (role: string) => ({
  Authorization: `Bearer ${signAccessToken({
    sub: `user-${role}`,
    role: role as never,
    email: `${role}@demo.com`,
    mustChangePassword: false,
    salesRole: null,
  })}`,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("read access", () => {
  it("lets a FINANCE_OFFICER read the chart of accounts", async () => {
    const res = await request(app).get("/api/accounting/accounts").set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(200)
    expect(listAccounts).toHaveBeenCalled()
  })

  it("lets a SUPER_ADMIN read the chart of accounts", async () => {
    const res = await request(app).get("/api/accounting/accounts").set(authHeader("SUPER_ADMIN"))

    expect(res.status).toBe(200)
  })

  it("403s an HR_ADMIN — seeing one payroll run is not seeing the company's position", async () => {
    const res = await request(app).get("/api/accounting/accounts").set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(403)
  })

  it("403s a REPORTING_MANAGER", async () => {
    const res = await request(app).get("/api/accounting/accounts").set(authHeader("REPORTING_MANAGER"))

    expect(res.status).toBe(403)
  })

  it("403s an EMPLOYEE", async () => {
    const res = await request(app).get("/api/accounting/accounts").set(authHeader("EMPLOYEE"))

    expect(res.status).toBe(403)
  })

  it("401s without a token", async () => {
    const res = await request(app).get("/api/accounting/accounts")

    expect(res.status).toBe(401)
  })

  it("403s an HR_ADMIN on the trial balance too", async () => {
    const res = await request(app)
      .get("/api/accounting/trial-balance?from=2026-07-01&to=2026-07-31")
      .set(authHeader("HR_ADMIN"))

    expect(res.status).toBe(403)
  })
})

describe("Super Admin only actions", () => {
  it("lets a SUPER_ADMIN approve a journal", async () => {
    const res = await request(app)
      .post("/api/accounting/journals/j-1/approve")
      .set(authHeader("SUPER_ADMIN"))

    expect(res.status).toBe(200)
    expect(approveJournal).toHaveBeenCalledWith("j-1", expect.objectContaining({ sub: "user-SUPER_ADMIN" }))
  })

  it("403s a FINANCE_OFFICER on approve", async () => {
    const res = await request(app)
      .post("/api/accounting/journals/j-1/approve")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(403)
    expect(approveJournal).not.toHaveBeenCalled()
  })

  it("403s a FINANCE_OFFICER on reject", async () => {
    const res = await request(app)
      .post("/api/accounting/journals/j-1/reject")
      .send({ note: "wrong account" })
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(403)
  })

  it("403s a FINANCE_OFFICER on closing a period", async () => {
    const res = await request(app)
      .post("/api/accounting/periods/p-1/close")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(403)
  })

  it("403s a FINANCE_OFFICER on reopening a period", async () => {
    const res = await request(app)
      .post("/api/accounting/periods/p-1/reopen")
      .send({ reason: "late invoice" })
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(403)
  })
})

describe("Finance Officer actions", () => {
  it("lets a FINANCE_OFFICER create a journal", async () => {
    const res = await request(app)
      .post("/api/accounting/journals")
      .send({
        date: "2026-07-31",
        narration: "Office rent for July",
        lines: [
          { accountId: UUID_A, debit: "70500.00" },
          { accountId: UUID_B, credit: "70500.00" },
        ],
      })
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(201)
  })

  it("lets a FINANCE_OFFICER draft the year-end journal", async () => {
    const res = await request(app)
      .post("/api/accounting/financial-years/fy-1/year-end")
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(201)
  })

  it("lets a FINANCE_OFFICER reverse a posted journal", async () => {
    const res = await request(app)
      .post("/api/accounting/journals/j-1/reverse")
      .send({ reason: "Posted to the wrong account" })
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(201)
  })
})

describe("validation", () => {
  it("400s a journal with no narration", async () => {
    const res = await request(app)
      .post("/api/accounting/journals")
      .send({
        date: "2026-07-31",
        lines: [
          { accountId: UUID_A, debit: "1" },
          { accountId: UUID_B, credit: "1" },
        ],
      })
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(400)
  })

  it("400s a reopen with no reason", async () => {
    const res = await request(app)
      .post("/api/accounting/periods/p-1/reopen")
      .send({})
      .set(authHeader("SUPER_ADMIN"))

    expect(res.status).toBe(400)
  })

  it("400s a ledger request with no date range", async () => {
    const res = await request(app)
      .get(`/api/accounting/ledger?accountId=${UUID_A}`)
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(400)
  })
})

describe("route ordering", () => {
  it("matches /journals/:id/approve rather than treating 'approve' as an id", async () => {
    const res = await request(app)
      .post("/api/accounting/journals/j-1/approve")
      .set(authHeader("SUPER_ADMIN"))

    expect(res.status).toBe(200)
  })

  it("matches /cash-book before any /:id route", async () => {
    const res = await request(app)
      .get(`/api/accounting/cash-book?accountId=${UUID_A}&from=2026-07-01&to=2026-07-31`)
      .set(authHeader("FINANCE_OFFICER"))

    expect(res.status).toBe(200)
  })
})
