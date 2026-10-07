import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

// The routes check a Permission switch first. An empty table keeps every
// switch at its default.
vi.mock("../../../config/prisma", () => ({
  default: { $transaction: vi.fn(), salesPermission: { findMany: vi.fn().mockResolvedValue([]) } },
}))
// The service is tested on its own; here only the door is under test.
vi.mock("./heatmap.service", () => ({
  getHeatmap: vi.fn(),
  setCardNeed: vi.fn(),
  addHeatmapItem: vi.fn(),
  updateHeatmapItem: vi.fn(),
  removeHeatmapItem: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import { addHeatmapItem, getHeatmap, removeHeatmapItem, setCardNeed, updateHeatmapItem } from "./heatmap.service"

const ID = "11111111-1111-4111-8111-111111111111"
const ITEM_ID = "22222222-2222-4222-8222-222222222222"
const BASE = `/api/sales/accounts/${ID}/heatmap`
const token = (salesRole: "SALES_ADMIN" | "SALES_USER" | null) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: "EMPLOYEE" as never, email: "a@demo.com", mustChangePassword: false, salesRole: salesRole as never })}`
const VIEW = { groups: [], cards: [], counts: { GREEN: 0, YELLOW: 0, RED: 0, GREY: 0 }, canManage: true }
const ITEM = { brand: "Cisco", quantity: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [getHeatmap, setCardNeed, addHeatmapItem, updateHeatmapItem, removeHeatmapItem]) {
    vi.mocked(fn).mockResolvedValue(VIEW as any)
  }
})

describe("the heatmap routes", () => {
  it("need a signed-in person in the Sales Hub", async () => {
    await request(app).get(BASE).expect(401)
    await request(app).get(BASE).set("Authorization", token(null)).expect(403)
    await request(app).put(`${BASE}/server/need`).set("Authorization", token(null)).send({ need: "NEED" }).expect(403)
    expect(setCardNeed).not.toHaveBeenCalled()
  })

  it("read the heatmap for the account and the caller", async () => {
    const res = await request(app).get(BASE).set("Authorization", token("SALES_USER")).expect(200)
    expect(res.body).toEqual(VIEW)
    expect(vi.mocked(getHeatmap).mock.calls[0][0]).toBe(ID)
    expect(vi.mocked(getHeatmap).mock.calls[0][1].sub).toBe("user-1")
  })

  it("set the need on one card", async () => {
    await request(app).put(`${BASE}/server/need`).set("Authorization", token("SALES_USER"))
      .send({ need: "NO_NEED", reason: "All in the cloud" }).expect(200)
    expect(vi.mocked(setCardNeed).mock.calls[0].slice(0, 3)).toEqual([ID, "server", { need: "NO_NEED", reason: "All in the cloud" }])
  })

  it("refuse a bad body with the sentence alone", async () => {
    const res = await request(app).put(`${BASE}/server/need`).set("Authorization", token("SALES_USER"))
      .send({ need: "NO_NEED" }).expect(400)
    expect(res.body.error).toBe("Write why they do not need it.")
    const res2 = await request(app).post(`${BASE}/switch/items`).set("Authorization", token("SALES_USER"))
      .send({ quantity: 2 }).expect(400)
    expect(res2.body.error).toBe("Write the brand.")
    expect(addHeatmapItem).not.toHaveBeenCalled()
  })

  it("add, change and remove an item", async () => {
    await request(app).post(`${BASE}/switch/items`).set("Authorization", token("SALES_USER")).send(ITEM).expect(201)
    expect(vi.mocked(addHeatmapItem).mock.calls[0].slice(0, 2)).toEqual([ID, "switch"])
    expect(vi.mocked(addHeatmapItem).mock.calls[0][2]).toMatchObject(ITEM)

    await request(app).patch(`${BASE}/items/${ITEM_ID}`).set("Authorization", token("SALES_USER")).send(ITEM).expect(200)
    expect(vi.mocked(updateHeatmapItem).mock.calls[0].slice(0, 2)).toEqual([ID, ITEM_ID])

    await request(app).delete(`${BASE}/items/${ITEM_ID}`).set("Authorization", token("SALES_USER")).expect(200)
    expect(vi.mocked(removeHeatmapItem).mock.calls[0].slice(0, 2)).toEqual([ID, ITEM_ID])
  })

  it("say the item cannot be found for an id that is not an id", async () => {
    const res = await request(app).delete(`${BASE}/items/nope`).set("Authorization", token("SALES_USER")).expect(404)
    expect(res.body.error).toBe("That item is not on this account. Reload the page and try again.")
    expect(removeHeatmapItem).not.toHaveBeenCalled()
  })
})
