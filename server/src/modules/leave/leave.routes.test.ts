import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./leave.service", () => ({
  listLeaveTypes: vi.fn(),
  getMyBalances: vi.fn(),
  getBalancesFor: vi.fn(),
  listLeaveRequests: vi.fn(),
  getTeamStatus: vi.fn(),
  applyForLeave: vi.fn(),
  approveLeaveRequest: vi.fn(),
  rejectLeaveRequest: vi.fn(),
  cancelLeaveRequest: vi.fn(),
  revertLeaveRequest: vi.fn(),
  getHalfDayWindow: vi.fn(),
}))

vi.mock("./leave.admin", () => ({
  createLeaveType: vi.fn(),
  updateLeaveType: vi.fn(),
  deleteLeaveType: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as leaveService from "./leave.service"

type TestRole = "EMPLOYEE" | "REPORTING_MANAGER" | "HR_ADMIN" | "SUPER_ADMIN" | "FINANCE_OFFICER"

function tokenFor(role: TestRole) {
  return signAccessToken({
    sub: "actor-1",
    role: role as any,
    email: "actor@b.com",
    mustChangePassword: false,
    salesRole: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/leave/types", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/leave/types")
    expect(res.status).toBe(401)
  })

  it("returns 200 for any authenticated role", async () => {
    vi.mocked(leaveService.listLeaveTypes).mockResolvedValue([
      {
        id: "lt-1",
        code: "CASUAL",
        name: "Casual",
        isPaid: true,
        annualQuota: 10,
        carryForwardPct: 0,
        maxConsecutive: null,
        allowsBackdating: false,
        eligibleFor: ["FULL_TIME"],
        statutory: true,
        countsHolidays: false,
        accrualBasis: "PRO_RATED",
        minServiceMonths: 0,
        maxAccrual: null,
      },
    ] as any)
    const res = await request(app)
      .get("/api/leave/types")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(res.body[0].name).toBe("Casual")
  })
})

describe("GET /api/leave/balances/me", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/leave/balances/me")
    expect(res.status).toBe(401)
  })

  it("returns 403 for a reviewer role that has no employee profile", async () => {
    const res = await request(app)
      .get("/api/leave/balances/me")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
    expect(res.status).toBe(403)
  })

  it("returns 200 with balances for an employee", async () => {
    vi.mocked(leaveService.getMyBalances).mockResolvedValue([
      {
        leaveTypeId: "lt-1",
        code: "CASUAL",
        name: "Casual",
        isPaid: true,
        annualQuota: 10,
        entitlement: 10,
        used: 3,
        pending: 2,
        balance: 5,
      },
    ] as any)
    const res = await request(app)
      .get("/api/leave/balances/me")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(200)
    expect(res.body[0].balance).toBe(5)
  })
})

describe("GET /api/leave/balances/:employeeId", () => {
  it("returns 401 unauthenticated", async () => {
    const res = await request(app).get("/api/leave/balances/emp-1")
    expect(res.status).toBe(401)
  })

  it("still routes /balances/me to the me handler", async () => {
    vi.mocked(leaveService.getMyBalances).mockResolvedValue([])
    const res = await request(app)
      .get("/api/leave/balances/me")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(200)
    expect(leaveService.getBalancesFor).not.toHaveBeenCalled()
  })

  it("returns 200 for an authorised caller", async () => {
    vi.mocked(leaveService.getBalancesFor).mockResolvedValue([])
    const res = await request(app)
      .get("/api/leave/balances/emp-1")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
    expect(res.status).toBe(200)
  })
})

describe("GET /api/leave/requests", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/leave/requests")
    expect(res.status).toBe(401)
  })

  it("returns 200 for every authenticated role", async () => {
    vi.mocked(leaveService.listLeaveRequests).mockResolvedValue([])
    for (const role of [
      "EMPLOYEE",
      "REPORTING_MANAGER",
      "HR_ADMIN",
      "SUPER_ADMIN",
      "FINANCE_OFFICER",
    ] as const) {
      const res = await request(app)
        .get("/api/leave/requests")
        .set("Authorization", `Bearer ${tokenFor(role)}`)
      expect(res.status).toBe(200)
    }
  })
})

describe("GET /api/leave/team-status", () => {
  it("returns 403 for a non-manager", async () => {
    const res = await request(app)
      .get("/api/leave/team-status")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })

  it("returns 200 for a reporting manager", async () => {
    vi.mocked(leaveService.getTeamStatus).mockResolvedValue([])
    const res = await request(app)
      .get("/api/leave/team-status")
      .set("Authorization", `Bearer ${tokenFor("REPORTING_MANAGER")}`)
    expect(res.status).toBe(200)
  })
})

describe("POST /api/leave/requests", () => {
  const body = { leaveTypeId: "lt-1", startDate: "2026-09-07", endDate: "2026-09-09" }

  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).post("/api/leave/requests").send(body)
    expect(res.status).toBe(401)
  })

  it("returns 403 for a reviewer role", async () => {
    const res = await request(app)
      .post("/api/leave/requests")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
      .send(body)
    expect(res.status).toBe(403)
  })

  it("returns 400 for a malformed body", async () => {
    const res = await request(app)
      .post("/api/leave/requests")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({ leaveTypeId: "lt-1", startDate: "07/09/2026", endDate: "2026-09-09" })
    expect(res.status).toBe(400)
  })

  it("returns 201 for a valid application", async () => {
    vi.mocked(leaveService.applyForLeave).mockResolvedValue({ id: "req-1" } as any)
    const res = await request(app)
      .post("/api/leave/requests")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send(body)
    expect(res.status).toBe(201)
  })
})

describe("leave decision routes", () => {
  it("403s when an employee tries to approve", async () => {
    const res = await request(app)
      .patch("/api/leave/requests/req-1/approve")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })

  it("403s when finance tries to approve — read-only per the matrix", async () => {
    const res = await request(app)
      .patch("/api/leave/requests/req-1/approve")
      .set("Authorization", `Bearer ${tokenFor("FINANCE_OFFICER")}`)
    expect(res.status).toBe(403)
  })

  it("403s when a reporting manager tries to approve", async () => {
    const res = await request(app)
      .patch("/api/leave/requests/req-1/approve")
      .set("Authorization", `Bearer ${tokenFor("REPORTING_MANAGER")}`)
    expect(res.status).toBe(403)
  })

  it("200s when HR approves", async () => {
    vi.mocked(leaveService.approveLeaveRequest).mockResolvedValue({ id: "req-1" } as any)
    const res = await request(app)
      .patch("/api/leave/requests/req-1/approve")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
    expect(res.status).toBe(200)
  })

  it("400s when rejecting without a note", async () => {
    const res = await request(app)
      .patch("/api/leave/requests/req-1/reject")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it("200s when rejecting with a note", async () => {
    vi.mocked(leaveService.rejectLeaveRequest).mockResolvedValue({ id: "req-1" } as any)
    const res = await request(app)
      .patch("/api/leave/requests/req-1/reject")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
      .send({ note: "Short-staffed" })
    expect(res.status).toBe(200)
  })

  it("403s when HR tries to cancel (cancel is the requester's action)", async () => {
    const res = await request(app)
      .patch("/api/leave/requests/req-1/cancel")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
    expect(res.status).toBe(403)
  })
})

describe("GET /api/leave/half-day-window", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/leave/half-day-window?date=2026-09-07")
    expect(res.status).toBe(401)
  })

  it("returns 403 for a role with no leave of its own", async () => {
    const res = await request(app)
      .get("/api/leave/half-day-window?date=2026-09-07")
      .set("Authorization", `Bearer ${tokenFor("HR_ADMIN")}`)
    expect(res.status).toBe(403)
  })

  it("returns the shift window and its midpoint", async () => {
    vi.mocked(leaveService.getHalfDayWindow).mockResolvedValue({
      startTime: "09:00",
      midpoint: "13:30",
      endTime: "18:00",
    })

    const res = await request(app)
      .get("/api/leave/half-day-window?date=2026-09-07")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ startTime: "09:00", midpoint: "13:30", endTime: "18:00" })
  })

  it("returns 400 on a malformed date", async () => {
    const res = await request(app)
      .get("/api/leave/half-day-window?date=07-09-2026")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(400)
    expect(leaveService.getHalfDayWindow).not.toHaveBeenCalled()
  })

  it("returns 400 when the date is missing entirely", async () => {
    const res = await request(app)
      .get("/api/leave/half-day-window")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(400)
  })
})

describe("leave-type writes", () => {
  it("refuses POST /api/leave/types for a staff role", async () => {
    const res = await request(app)
      .post("/api/leave/types")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
      .send({ code: "STUDY", name: "Study", annualQuota: 5, eligibleFor: ["FULL_TIME"] })
    expect(res.status).toBe(403)
  })

  it("refuses DELETE /api/leave/types/:id for a staff role", async () => {
    const res = await request(app)
      .delete("/api/leave/types/lt1")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(403)
  })

  // The read stays open — every leave application form needs the list.
  it("still allows any authenticated role to GET /api/leave/types", async () => {
    vi.mocked(leaveService.listLeaveTypes).mockResolvedValue([] as never)

    const res = await request(app)
      .get("/api/leave/types")
      .set("Authorization", `Bearer ${tokenFor("EMPLOYEE")}`)
    expect(res.status).toBe(200)
  })
})
