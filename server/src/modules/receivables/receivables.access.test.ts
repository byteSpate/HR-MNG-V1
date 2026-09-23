import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: { opportunity: { findUnique: vi.fn() }, salesAccount: { count: vi.fn() } },
}))
vi.mock("../sales/sales.access", () => ({
  employeeIdFor: vi.fn(),
  accountScopeFor: vi.fn(() => ({})),
}))

import prisma from "../../config/prisma"
import { employeeIdFor } from "../sales/sales.access"
import { assertDealAccess, isFinance } from "./receivables.access"

const DEAL = { id: "opp-1", serial: "BS-OPP-00002", status: "WON", salesAccountId: "acc-1" }
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any
const SUPER_ADMIN = { sub: "u-a", role: "SUPER_ADMIN", salesRole: null, email: "a@b.co", mustChangePassword: false } as any
const SALES_USER = { sub: "u-s", role: "EMPLOYEE", salesRole: "SALES_USER", email: "s@b.co", mustChangePassword: false } as any
const EMPLOYEE = { sub: "u-e", role: "EMPLOYEE", salesRole: null, email: "e@b.co", mustChangePassword: false } as any

beforeEach(() => vi.clearAllMocks())

describe("isFinance", () => {
  it("is true for Finance Officer and Super Admin, false otherwise", () => {
    expect(isFinance(FINANCE)).toBe(true)
    expect(isFinance(SUPER_ADMIN)).toBe(true)
    expect(isFinance(SALES_USER)).toBe(false)
    expect(isFinance(EMPLOYEE)).toBe(false)
  })
})

describe("assertDealAccess", () => {
  it("lets Finance reach any deal", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue(DEAL as any)
    await expect(assertDealAccess(prisma as any, FINANCE, "opp-1")).resolves.toMatchObject({ id: "opp-1" })
  })

  it("lets the deal's sales person reach it", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue(DEAL as any)
    vi.mocked(employeeIdFor).mockResolvedValue("emp-1")
    vi.mocked(prisma.salesAccount.count).mockResolvedValue(1)
    await expect(assertDealAccess(prisma as any, SALES_USER, "opp-1")).resolves.toMatchObject({ id: "opp-1" })
  })

  it("refuses a sales person outside the account with 403", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue(DEAL as any)
    vi.mocked(employeeIdFor).mockResolvedValue("emp-2")
    vi.mocked(prisma.salesAccount.count).mockResolvedValue(0)
    await expect(assertDealAccess(prisma as any, SALES_USER, "opp-1")).rejects.toThrow("You do not have access to this deal")
  })

  it("refuses an employee with no sales role, without reading the deal", async () => {
    await expect(assertDealAccess(prisma as any, EMPLOYEE, "opp-1")).rejects.toThrow("You do not have access to this deal")
    expect(prisma.opportunity.findUnique).not.toHaveBeenCalled()
  })

  it("404s a deal that does not exist", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue(null)
    await expect(assertDealAccess(prisma as any, FINANCE, "nope")).rejects.toThrow("Deal not found")
  })
})
