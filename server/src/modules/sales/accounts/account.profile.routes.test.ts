import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../../config/prisma", () => ({ default: { $transaction: vi.fn() } }))
// The service is tested on its own; here only the door is under test.
vi.mock("./account.profile", () => ({
  getAccountProfile: vi.fn(),
  updateAccountProfile: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import { getAccountProfile, updateAccountProfile } from "./account.profile"

const ID = "11111111-1111-4111-8111-111111111111"
const token = (salesRole: "SALES_ADMIN" | "SALES_USER" | null) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: "EMPLOYEE" as never, email: "a@demo.com", mustChangePassword: false, salesRole: salesRole as never })}`
const PROFILE = { groups: [], custom: [], answered: 0, total: 21, canManage: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccountProfile).mockResolvedValue(PROFILE as any)
  vi.mocked(updateAccountProfile).mockResolvedValue(PROFILE as any)
})

describe("GET /api/sales/accounts/:id/profile", () => {
  it("needs a signed-in person in the Sales Hub", async () => {
    await request(app).get(`/api/sales/accounts/${ID}/profile`).expect(401)
    await request(app).get(`/api/sales/accounts/${ID}/profile`).set("Authorization", token(null)).expect(403)
  })

  it("hands the account and the caller to the service", async () => {
    const res = await request(app).get(`/api/sales/accounts/${ID}/profile`).set("Authorization", token("SALES_USER")).expect(200)
    expect(res.body).toEqual(PROFILE)
    expect(vi.mocked(getAccountProfile).mock.calls[0][0]).toBe(ID)
    expect(vi.mocked(getAccountProfile).mock.calls[0][1].sub).toBe("user-1")
  })
})

describe("PATCH /api/sales/accounts/:id/profile", () => {
  it("needs a signed-in person in the Sales Hub", async () => {
    await request(app).patch(`/api/sales/accounts/${ID}/profile`).send({ answers: { staff: { answer: "5" } } }).expect(401)
    await request(app).patch(`/api/sales/accounts/${ID}/profile`).set("Authorization", token(null)).send({ answers: { staff: { answer: "5" } } }).expect(403)
    expect(updateAccountProfile).not.toHaveBeenCalled()
  })

  it("passes a good body on, parsed", async () => {
    await request(app).patch(`/api/sales/accounts/${ID}/profile`).set("Authorization", token("SALES_USER"))
      .send({ answers: { staff: { answer: " 5 " } } }).expect(200)
    expect(vi.mocked(updateAccountProfile).mock.calls[0][1]).toEqual({ answers: { staff: { answer: "5" } } })
  })

  it("refuses a body that changes nothing, in words", async () => {
    const res = await request(app).patch(`/api/sales/accounts/${ID}/profile`).set("Authorization", token("SALES_USER")).send({}).expect(400)
    expect(JSON.stringify(res.body)).toMatch(/Nothing was changed/)
    expect(updateAccountProfile).not.toHaveBeenCalled()
  })

  it("refuses an own question with no question, in words", async () => {
    const res = await request(app).patch(`/api/sales/accounts/${ID}/profile`).set("Authorization", token("SALES_USER"))
      .send({ custom: { add: [{ question: " ", answer: "x" }] } }).expect(400)
    expect(JSON.stringify(res.body)).toMatch(/Write the question/)
  })
})
