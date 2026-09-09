import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./payroll.service", () => ({
  listExchangeRates: vi.fn(),
  createExchangeRate: vi.fn(),
  updateExchangeRate: vi.fn(),
  listSalaryStructures: vi.fn(),
  createSalaryStructure: vi.fn(),
  updateSalaryStructure: vi.fn(),
  deleteSalaryStructure: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as service from "./payroll.service"

type TestRole = "EMPLOYEE" | "REPORTING_MANAGER" | "HR_ADMIN" | "SUPER_ADMIN" | "FINANCE_OFFICER"

function tokenFor(role: TestRole) {
  return signAccessToken({
    sub: "actor-1",
    role: role as never,
    email: "actor@demo.com",
    mustChangePassword: false,
    salesRole: null,
  })
}

const auth = (role: TestRole) => `Bearer ${tokenFor(role)}`

const validRate = { base: "USD", quote: "BDT", rate: 122.5, effectiveFrom: "2026-01-01" }
const validStructure = {
  name: "Standard (BDT)",
  currency: "BDT",
  basic: 50000,
  components: [
    { code: "HOUSE_RENT", label: "House rent", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: 50 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/payroll/exchange-rates", () => {
  it("401s with no Authorization header", async () => {
    expect((await request(app).get("/api/payroll/exchange-rates")).status).toBe(401)
  })

  it.each<TestRole>(["EMPLOYEE", "REPORTING_MANAGER", "HR_ADMIN", "FINANCE_OFFICER", "SUPER_ADMIN"])(
    "200s for %s — an employee's own payslip quotes the rate",
    async (role) => {
      vi.mocked(service.listExchangeRates).mockResolvedValue([])
      const res = await request(app)
        .get("/api/payroll/exchange-rates")
        .set("Authorization", auth(role))
      expect(res.status).toBe(200)
    }
  )
})

describe("POST /api/payroll/exchange-rates", () => {
  it.each<TestRole>(["EMPLOYEE", "REPORTING_MANAGER", "HR_ADMIN"])(
    "403s for %s — Finance owns the rate, not HR",
    async (role) => {
      const res = await request(app)
        .post("/api/payroll/exchange-rates")
        .set("Authorization", auth(role))
        .send(validRate)
      expect(res.status).toBe(403)
    }
  )

  it.each<TestRole>(["FINANCE_OFFICER", "SUPER_ADMIN"])("201s for %s", async (role) => {
    vi.mocked(service.createExchangeRate).mockResolvedValue({ id: "rate-1" } as never)
    const res = await request(app)
      .post("/api/payroll/exchange-rates")
      .set("Authorization", auth(role))
      .send(validRate)
    expect(res.status).toBe(201)
  })

  it("400s a malformed body", async () => {
    const res = await request(app)
      .post("/api/payroll/exchange-rates")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send({ base: "USD", quote: "USD", rate: 122.5, effectiveFrom: "2026-01-01" })
    expect(res.status).toBe(400)
  })
})

describe("GET /api/payroll/salary-structures", () => {
  it("403s an employee", async () => {
    const res = await request(app)
      .get("/api/payroll/salary-structures")
      .set("Authorization", auth("EMPLOYEE"))
    expect(res.status).toBe(403)
  })

  it.each<TestRole>(["HR_ADMIN", "FINANCE_OFFICER", "SUPER_ADMIN"])("200s for %s", async (role) => {
    vi.mocked(service.listSalaryStructures).mockResolvedValue([])
    const res = await request(app)
      .get("/api/payroll/salary-structures")
      .set("Authorization", auth(role))
    expect(res.status).toBe(200)
  })
})

describe("POST /api/payroll/salary-structures", () => {
  it("403s HR — Finance owns structures", async () => {
    const res = await request(app)
      .post("/api/payroll/salary-structures")
      .set("Authorization", auth("HR_ADMIN"))
      .send(validStructure)
    expect(res.status).toBe(403)
  })

  it("201s for Finance", async () => {
    vi.mocked(service.createSalaryStructure).mockResolvedValue({ id: "struct-1" } as never)
    const res = await request(app)
      .post("/api/payroll/salary-structures")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send(validStructure)
    expect(res.status).toBe(201)
  })

  it("201s a structure with only deductions", async () => {
    vi.mocked(service.createSalaryStructure).mockResolvedValue({ id: "struct-1" } as never)
    const res = await request(app)
      .post("/api/payroll/salary-structures")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send({
        ...validStructure,
        components: [{ code: "TAX", label: "Tax", kind: "DEDUCTION", calc: "FIXED", value: 100 }],
      })
    expect(res.status).toBe(201)
  })

  // A flat negotiated monthly salary, which is how private-sector pay in
  // Bangladesh is normally agreed. This is the common case, not an edge one.
  it("201s a structure with no components, and passes an empty array through", async () => {
    vi.mocked(service.createSalaryStructure).mockResolvedValue({ id: "struct-1" } as never)
    const { components: _omitted, ...flat } = validStructure
    const res = await request(app)
      .post("/api/payroll/salary-structures")
      .set("Authorization", auth("FINANCE_OFFICER"))
      .send(flat)
    expect(res.status).toBe(201)
    expect(service.createSalaryStructure).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ components: [] })
    )
  })
})

describe("DELETE /api/payroll/salary-structures/:id", () => {
  const url = "/api/payroll/salary-structures/struct-1"

  it("401s with no Authorization header", async () => {
    expect((await request(app).delete(url)).status).toBe(401)
  })

  it.each<TestRole>(["EMPLOYEE", "REPORTING_MANAGER", "HR_ADMIN"])(
    "403s for %s — Finance owns structures",
    async (role) => {
      const res = await request(app).delete(url).set("Authorization", auth(role))
      expect(res.status).toBe(403)
    }
  )

  it.each<TestRole>(["FINANCE_OFFICER", "SUPER_ADMIN"])("200s for %s", async (role) => {
    vi.mocked(service.deleteSalaryStructure).mockResolvedValue({ id: "struct-1" } as never)
    const res = await request(app).delete(url).set("Authorization", auth(role))
    expect(res.status).toBe(200)
    expect(service.deleteSalaryStructure).toHaveBeenCalledWith("struct-1", "actor-1")
  })
})
