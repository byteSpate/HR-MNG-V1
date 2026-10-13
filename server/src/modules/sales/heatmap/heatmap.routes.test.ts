import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

// The routes check a Permission switch first. An empty table keeps every
// switch at its default.
vi.mock("../../../config/prisma", () => ({
  default: { $transaction: vi.fn(), salesPermission: { findMany: vi.fn().mockResolvedValue([]) } },
}))
// The services are tested on their own; here only the door is under test.
vi.mock("./heatmap.service", () => ({
  getHeatmap: vi.fn(),
  setProductColour: vi.fn(),
  setPartScope: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import { getHeatmap, setPartScope, setProductColour } from "./heatmap.service"

const ID = "11111111-1111-4111-8111-111111111111"
const PRODUCT = "33333333-3333-4333-8333-333333333333"
const BASE = `/api/sales/accounts/${ID}/heatmap`
const token = (salesRole: "SALES_ADMIN" | "SALES_USER" | null) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: "EMPLOYEE" as never, email: "a@demo.com", mustChangePassword: false, salesRole: salesRole as never })}`
const VIEW = { groups: [], counts: { GREEN: 0, RED: 0, GREY: 0 }, canManage: true }

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [getHeatmap, setProductColour, setPartScope]) vi.mocked(fn).mockResolvedValue(VIEW as any)
})

describe("the heatmap routes", () => {
  it("need a signed-in person in the Sales Hub", async () => {
    await request(app).get(BASE).expect(401)
    await request(app).get(BASE).set("Authorization", token(null)).expect(403)
    await request(app).put(`${BASE}/products/${PRODUCT}/colour`).set("Authorization", token(null)).send({ colour: "GREEN" }).expect(403)
    expect(setProductColour).not.toHaveBeenCalled()
  })

  it("read the heatmap for the account and the caller", async () => {
    const res = await request(app).get(BASE).set("Authorization", token("SALES_USER")).expect(200)
    expect(res.body).toEqual(VIEW)
    expect(vi.mocked(getHeatmap).mock.calls[0][0]).toBe(ID)
    expect(vi.mocked(getHeatmap).mock.calls[0][1].sub).toBe("user-1")
  })

  it("set a colour and a tick", async () => {
    await request(app).put(`${BASE}/products/${PRODUCT}/colour`).set("Authorization", token("SALES_USER"))
      .send({ colour: "RED", reason: "No budget" }).expect(200)
    expect(setProductColour).toHaveBeenCalledWith(ID, PRODUCT, { colour: "RED", reason: "No budget" }, expect.anything())
    await request(app).put(`${BASE}/parts/${PRODUCT}/scope`).set("Authorization", token("SALES_USER"))
      .send({ inScope: true }).expect(200)
    expect(setPartScope).toHaveBeenCalledWith(ID, PRODUCT, { inScope: true }, expect.anything())
  })

  it("refuse a bad body with the sentence alone", async () => {
    const res = await request(app).put(`${BASE}/products/${PRODUCT}/colour`).set("Authorization", token("SALES_USER"))
      .send({ colour: "RED" }).expect(400)
    expect(res.body.error).toBe("Write why there is no chance here.")
    expect(setProductColour).not.toHaveBeenCalled()
  })

  it("turn away an id that is not an id with the reload sentence", async () => {
    const res = await request(app).put(`${BASE}/products/nope/colour`).set("Authorization", token("SALES_USER"))
      .send({ colour: "GREEN" }).expect(404)
    expect(res.body.error).toBe("That is no longer on the heatmap. Reload the page and try again.")
    await request(app).put(`${BASE}/parts/nope/scope`).set("Authorization", token("SALES_USER")).send({ inScope: true }).expect(404)
    expect(setPartScope).not.toHaveBeenCalled()
  })
})
