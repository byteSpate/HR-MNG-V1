import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("../../../config/prisma", () => ({
  default: { $transaction: vi.fn(), salesPermission: { findMany: vi.fn().mockResolvedValue([]) } },
}))
vi.mock("./quote.service", async () => ({
  ...(await vi.importActual<object>("./quote.service")),
  addQuote: vi.fn(),
  editLatestQuote: vi.fn(),
  deleteLatestQuote: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import { addQuote, deleteLatestQuote, editLatestQuote } from "./quote.service"

const ID = "11111111-1111-4111-8111-111111111111"
const Q = "22222222-2222-4222-8222-222222222222"
const BASE = `/api/sales/opportunities/${ID}/quotes`
const token = (salesRole: "SALES_ADMIN" | "SALES_USER" | null) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: "EMPLOYEE" as never, email: "a@demo.com", mustChangePassword: false, salesRole: salesRole as never })}`
const BODY = { amount: "1200000", quotedOn: "2026-10-03" }

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [addQuote, editLatestQuote, deleteLatestQuote]) vi.mocked(fn).mockResolvedValue({ id: ID } as any)
})

describe("the quote routes", () => {
  it("need a signed-in person in the Sales Hub", async () => {
    await request(app).post(BASE).send(BODY).expect(401)
    await request(app).post(BASE).set("Authorization", token(null)).send(BODY).expect(403)
  })

  it("add, edit and delete", async () => {
    await request(app).post(BASE).set("Authorization", token("SALES_USER")).send(BODY).expect(201)
    expect(addQuote).toHaveBeenCalledWith(ID, { ...BODY, reference: null, note: null }, expect.anything())
    await request(app).patch(`${BASE}/${Q}`).set("Authorization", token("SALES_USER")).send(BODY).expect(200)
    expect(editLatestQuote).toHaveBeenCalledWith(ID, Q, { ...BODY, reference: null, note: null }, expect.anything())
    await request(app).delete(`${BASE}/${Q}`).set("Authorization", token("SALES_USER")).expect(200)
    expect(deleteLatestQuote).toHaveBeenCalledWith(ID, Q, expect.anything())
  })

  it("gives the plain sentence for a bad body and a bad id", async () => {
    const bad = await request(app).post(BASE).set("Authorization", token("SALES_USER")).send({ amount: "x", quotedOn: "2026-10-03" }).expect(400)
    expect(bad.body.error).toBe("Enter an amount with up to two decimal places")
    const gone = await request(app).delete(`${BASE}/nope`).set("Authorization", token("SALES_USER")).expect(404)
    expect(gone.body.error).toBe("That quote is not on this Opportunity. Reload the page and try again.")
  })
})
