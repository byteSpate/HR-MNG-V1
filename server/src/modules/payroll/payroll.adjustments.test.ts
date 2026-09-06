import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../config/prisma", () => {
  const tx = {
    payrollAdjustment: { create: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return {
    default: {
      payrollAdjustment: { findMany: vi.fn(), findUnique: vi.fn() },
      employee: { findUnique: vi.fn() },
      payrollRun: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"
import { createAdjustment, deleteAdjustment } from "./payroll.service"
import { dec } from "./payroll.money"

const tx = (prisma as unknown as { __tx: any }).__tx

type TestRole = "EMPLOYEE" | "REPORTING_MANAGER" | "HR_ADMIN" | "SUPER_ADMIN" | "FINANCE_OFFICER"
const auth = (role: TestRole) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: role as never, email: "a@demo.com", mustChangePassword: false, salesRole: null })}`

const validBody = {
  employeeId: "emp-1",
  month: 7,
  year: 2026,
  kind: "EARNING" as const,
  code: "FESTIVAL_BONUS",
  label: "Eid bonus",
  currency: "BDT" as const,
  amount: 50000,
  reason: "Eid-ul-Fitr bonus per company policy",
}

beforeEach(() => {
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1" } as never)
  vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(null)
  tx.payrollAdjustment.create.mockResolvedValue({ id: "adj-1", ...validBody, amount: dec(50000) })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("route roles", () => {
  it("403s Finance creating an adjustment — HR owns this, Finance pays it", async () => {
    const res = await request(app)
      .post("/api/payroll/adjustments")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send(validBody)
    expect(res.status).toBe(403)
  })

  it.each<TestRole>(["EMPLOYEE", "REPORTING_MANAGER"])("403s %s", async (role) => {
    const res = await request(app)
      .post("/api/payroll/adjustments")
      .set("Authorization", auth(role))
      .send(validBody)
    expect(res.status).toBe(403)
  })

  it.each<TestRole>(["HR_ADMIN", "SUPER_ADMIN"])("201s for %s", async (role) => {
    const res = await request(app)
      .post("/api/payroll/adjustments")
      .set("Authorization", auth(role))
      .send(validBody)
    expect(res.status).toBe(201)
  })

  it("400s a body with no reason — an unexplained pay line is a dispute waiting", async () => {
    const { reason, ...withoutReason } = validBody
    void reason
    const res = await request(app)
      .post("/api/payroll/adjustments")
      .set("Authorization", auth("HR_ADMIN"))
      .send(withoutReason)
    expect(res.status).toBe(400)
  })

  it("403s Finance deleting an adjustment", async () => {
    const res = await request(app)
      .delete("/api/payroll/adjustments/adj-1")
      .set("Authorization", auth("FINANCE_OFFICER"))
    expect(res.status).toBe(403)
  })
})

describe("createAdjustment", () => {
  it("404s an unknown employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    await expect(createAdjustment("hr-1", validBody)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("409s when the month's payroll is already approved", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ status: "APPROVED" } as never)
    await expect(createAdjustment("hr-1", validBody)).rejects.toMatchObject({ statusCode: 409 })
    expect(tx.payrollAdjustment.create).not.toHaveBeenCalled()
  })

  it("succeeds while the month's run is still a draft", async () => {
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ status: "DRAFT" } as never)
    await expect(createAdjustment("hr-1", validBody)).resolves.toMatchObject({ id: "adj-1" })
  })

  it("records the reason on the audit row", async () => {
    await createAdjustment("hr-1", validBody)
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "ADJUSTMENT",
          action: "CREATE",
          note: "Eid-ul-Fitr bonus per company policy",
        }),
      })
    )
  })
})

describe("deleteAdjustment", () => {
  it("404s an unknown id", async () => {
    vi.mocked(prisma.payrollAdjustment.findUnique).mockResolvedValue(null)
    await expect(deleteAdjustment("nope", "hr-1")).rejects.toMatchObject({ statusCode: 404 })
  })

  it("409s an adjustment already claimed by a payslip", async () => {
    // Reprocess the run to release it first, rather than silently orphaning
    // a line that has already been paid.
    vi.mocked(prisma.payrollAdjustment.findUnique).mockResolvedValue({
      id: "adj-1",
      month: 7,
      year: 2026,
      payslipId: "payslip-1",
    } as never)
    await expect(deleteAdjustment("adj-1", "hr-1")).rejects.toMatchObject({ statusCode: 409 })
    expect(tx.payrollAdjustment.delete).not.toHaveBeenCalled()
  })

  it("409s in a locked month even when unclaimed", async () => {
    vi.mocked(prisma.payrollAdjustment.findUnique).mockResolvedValue({
      id: "adj-1",
      month: 7,
      year: 2026,
      payslipId: null,
    } as never)
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ status: "DISBURSED" } as never)
    await expect(deleteAdjustment("adj-1", "hr-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("deletes an unclaimed adjustment in an open month, with an audit row", async () => {
    vi.mocked(prisma.payrollAdjustment.findUnique).mockResolvedValue({
      id: "adj-1",
      employeeId: "emp-1",
      month: 7,
      year: 2026,
      code: "FESTIVAL_BONUS",
      amount: dec(50000),
      payslipId: null,
    } as never)
    await expect(deleteAdjustment("adj-1", "hr-1")).resolves.toEqual({ id: "adj-1" })
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "DELETE" }) })
    )
  })
})
