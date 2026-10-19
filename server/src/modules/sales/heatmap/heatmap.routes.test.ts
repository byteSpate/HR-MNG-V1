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
  setPartMark: vi.fn(),
  setProductMarks: vi.fn(),
  setProductNote: vi.fn(),
}))
vi.mock("./heatmap.list.service", () => ({
  getHeatmapList: vi.fn(),
  addListRow: vi.fn(),
  editListRow: vi.fn(),
  moveListRow: vi.fn(),
  deleteListRow: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import { addListRow, deleteListRow, editListRow, getHeatmapList, moveListRow } from "./heatmap.list.service"
import { getHeatmap, setPartMark, setProductMarks, setProductNote } from "./heatmap.service"

const ID = "11111111-1111-4111-8111-111111111111"
const PRODUCT = "33333333-3333-4333-8333-333333333333"
const BASE = `/api/sales/accounts/${ID}/heatmap`
const token = (salesRole: "SALES_ADMIN" | "SALES_USER" | null) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: "EMPLOYEE" as never, email: "a@demo.com", mustChangePassword: false, salesRole: salesRole as never })}`
const VIEW = { groups: [], counts: { GREEN: 0, RED: 0, GREY: 0 }, canManage: true }

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [getHeatmap, setPartMark, setProductMarks, setProductNote]) vi.mocked(fn).mockResolvedValue(VIEW as any)
  for (const fn of [getHeatmapList, addListRow, editListRow, moveListRow, deleteListRow]) vi.mocked(fn).mockResolvedValue({ groups: [] } as any)
})

describe("the heatmap routes", () => {
  it("need a signed-in person in the Sales Hub", async () => {
    await request(app).get(BASE).expect(401)
    await request(app).get(BASE).set("Authorization", token(null)).expect(403)
    await request(app).put(`${BASE}/products/${PRODUCT}/marks`).set("Authorization", token(null)).send({ mark: "GREEN" }).expect(403)
    expect(setProductMarks).not.toHaveBeenCalled()
  })

  it("read the heatmap for the account and the caller", async () => {
    const res = await request(app).get(BASE).set("Authorization", token("SALES_USER")).expect(200)
    expect(res.body).toEqual(VIEW)
    expect(vi.mocked(getHeatmap).mock.calls[0][0]).toBe(ID)
    expect(vi.mocked(getHeatmap).mock.calls[0][1].sub).toBe("user-1")
  })

  it("set a tick or cross on a part, on every part, and a note", async () => {
    await request(app).put(`${BASE}/parts/${PRODUCT}/mark`).set("Authorization", token("SALES_USER"))
      .send({ mark: "GREEN" }).expect(200)
    expect(setPartMark).toHaveBeenCalledWith(ID, PRODUCT, { mark: "GREEN" }, expect.anything())
    await request(app).put(`${BASE}/products/${PRODUCT}/marks`).set("Authorization", token("SALES_USER"))
      .send({ mark: "RED" }).expect(200)
    expect(setProductMarks).toHaveBeenCalledWith(ID, PRODUCT, { mark: "RED" }, expect.anything())
    await request(app).put(`${BASE}/products/${PRODUCT}/note`).set("Authorization", token("SALES_USER"))
      .send({ note: " No budget " }).expect(200)
    expect(setProductNote).toHaveBeenCalledWith(ID, PRODUCT, { note: "No budget" }, expect.anything())
  })

  it("no longer has the old colour and scope routes", async () => {
    await request(app).put(`${BASE}/products/${PRODUCT}/colour`).set("Authorization", token("SALES_USER")).send({ colour: "GREEN" }).expect(404)
    await request(app).put(`${BASE}/parts/${PRODUCT}/scope`).set("Authorization", token("SALES_USER")).send({ inScope: true }).expect(404)
  })

  it("refuse a bad body with the sentence alone", async () => {
    const res = await request(app).put(`${BASE}/parts/${PRODUCT}/mark`).set("Authorization", token("SALES_USER"))
      .send({ mark: "YELLOW" }).expect(400)
    expect(res.body.error).toBe("Choose a tick, a cross, or clear it.")
    expect(setPartMark).not.toHaveBeenCalled()
  })

    it("turn away an id that is not an id with the reload sentence", async () => {
      const res = await request(app).put(`${BASE}/products/nope/marks`).set("Authorization", token("SALES_USER"))
        .send({ mark: "GREEN" }).expect(404)
      expect(res.body.error).toBe("That is no longer on the heatmap. Reload the page and try again.")
      await request(app).put(`${BASE}/parts/nope/mark`).set("Authorization", token("SALES_USER")).send({ mark: "GREEN" }).expect(404)
      await request(app).put(`${BASE}/products/nope/note`).set("Authorization", token("SALES_USER")).send({ note: "x" }).expect(404)
      expect(setPartMark).not.toHaveBeenCalled()
      expect(setProductMarks).not.toHaveBeenCalled()
      expect(setProductNote).not.toHaveBeenCalled()
    })

    describe("the list in Sales Settings", () => {
    const LIST = "/api/sales/settings/heatmap-list"
    it("lets only a Sales Admin touch the list", async () => {
      await request(app).get(LIST).set("Authorization", token("SALES_USER")).expect(403)
      await request(app).get(LIST).set("Authorization", token("SALES_ADMIN")).expect(200)
      await request(app).post(`${LIST}/groups`).set("Authorization", token("SALES_ADMIN")).send({ title: "Cloud" }).expect(201)
      expect(addListRow).toHaveBeenCalledWith("groups", null, { title: "Cloud", note: null }, expect.anything())
    })
    it("passes level and id through, and refuses an unknown level", async () => {
      await request(app).post(`${LIST}/parts/${PRODUCT}/move`).set("Authorization", token("SALES_ADMIN")).send({ direction: "DOWN" }).expect(200)
      expect(moveListRow).toHaveBeenCalledWith("parts", PRODUCT, "DOWN", expect.anything())
      await request(app).delete(`${LIST}/cards/${PRODUCT}`).set("Authorization", token("SALES_ADMIN")).expect(404)
    })
    it("reads the add-product path as an add, not as a level", async () => {
      await request(app).post(`${LIST}/groups/${PRODUCT}/products`).set("Authorization", token("SALES_ADMIN")).send({ title: "Router" }).expect(201)
      expect(addListRow).toHaveBeenCalledWith("products", PRODUCT, { title: "Router", note: null }, expect.anything())
  })
  it("edits a row and refuses an empty change", async () => {
    await request(app).patch(`${LIST}/products/${PRODUCT}`).set("Authorization", token("SALES_ADMIN")).send({ hidden: true }).expect(200)
    expect(editListRow).toHaveBeenCalledWith("products", PRODUCT, { hidden: true }, expect.anything())
    const res = await request(app).patch(`${LIST}/products/${PRODUCT}`).set("Authorization", token("SALES_ADMIN")).send({}).expect(400)
    expect(res.body.error).toBe("Nothing to change.")
    await request(app).delete(`${LIST}/parts/${PRODUCT}`).set("Authorization", token("SALES_ADMIN")).expect(200)
    expect(deleteListRow).toHaveBeenCalledWith("parts", PRODUCT, expect.anything())
  })
  })
})
