import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

// The routes check a Permission switch first. An empty table keeps every
// switch at its default, which is today's behaviour.
vi.mock("../../../config/prisma", () => ({
  default: { $transaction: vi.fn(), salesPermission: { findMany: vi.fn().mockResolvedValue([]) } },
}))
// The service is tested on its own; here only the door is under test.
vi.mock("./account.card", () => ({
  setVisitingCard: vi.fn(),
  removeVisitingCard: vi.fn(),
  visitingCardUrlOf: vi.fn(() => null),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import { removeVisitingCard, setVisitingCard } from "./account.card"

const ID = "11111111-1111-4111-8111-111111111111"
const token = (salesRole: "SALES_ADMIN" | "SALES_USER" | null) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: "EMPLOYEE" as never, email: "a@demo.com", mustChangePassword: false, salesRole: salesRole as never })}`
const PNG = Buffer.from("89504e470d0a1a0a", "hex")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(setVisitingCard).mockResolvedValue({ visitingCardUrl: "https://cdn.test/card" })
  vi.mocked(removeVisitingCard).mockResolvedValue({ visitingCardUrl: null })
})

describe("PUT /api/sales/accounts/:id/visiting-card", () => {
  it("needs a signed-in person", async () => {
    await request(app).put(`/api/sales/accounts/${ID}/visiting-card`).expect(401)
  })

  it("is for people in the Sales Hub only", async () => {
    await request(app).put(`/api/sales/accounts/${ID}/visiting-card`).set("Authorization", token(null)).attach("file", PNG, "card.png").expect(403)
    expect(setVisitingCard).not.toHaveBeenCalled()
  })

  it("hands a picture to the service, with the account and the caller", async () => {
    const res = await request(app).put(`/api/sales/accounts/${ID}/visiting-card`)
      .set("Authorization", token("SALES_USER")).attach("file", PNG, "card.png").expect(200)
    expect(res.body).toEqual({ visitingCardUrl: "https://cdn.test/card" })
    const [id, file, actor] = vi.mocked(setVisitingCard).mock.calls[0]
    expect(id).toBe(ID)
    expect(file?.originalname).toBe("card.png")
    expect(actor.sub).toBe("user-1")
  })

  it("takes JPG, JPEG, PNG and WebP", async () => {
    for (const name of ["a.jpg", "a.jpeg", "a.png", "a.webp", "A.PNG"]) {
      await request(app).put(`/api/sales/accounts/${ID}/visiting-card`).set("Authorization", token("SALES_USER")).attach("file", PNG, name).expect(200)
    }
  })

  it("refuses a file that is not a picture, in words", async () => {
    const res = await request(app).put(`/api/sales/accounts/${ID}/visiting-card`)
      .set("Authorization", token("SALES_USER")).attach("file", Buffer.from("%PDF"), "card.pdf").expect(400)
    expect(res.body.error).toBe("Only jpg, jpeg, png, webp files are accepted")
    expect(setVisitingCard).not.toHaveBeenCalled()
  })

  it("refuses a picture over 5 MB and says the limit", async () => {
    const res = await request(app).put(`/api/sales/accounts/${ID}/visiting-card`)
      .set("Authorization", token("SALES_USER")).attach("file", Buffer.alloc(5 * 1024 * 1024 + 10), "big.png").expect(413)
    expect(res.body.error).toBe("That file is larger than 5 MB")
  })

  it("passes no file on to the service, which says what to do", async () => {
    await request(app).put(`/api/sales/accounts/${ID}/visiting-card`).set("Authorization", token("SALES_USER")).expect(200)
    expect(vi.mocked(setVisitingCard).mock.calls[0][1]).toBeUndefined()
  })
})

describe("DELETE /api/sales/accounts/:id/visiting-card", () => {
  it("needs a signed-in person", async () => {
    await request(app).delete(`/api/sales/accounts/${ID}/visiting-card`).expect(401)
  })

  it("removes the card", async () => {
    const res = await request(app).delete(`/api/sales/accounts/${ID}/visiting-card`).set("Authorization", token("SALES_USER")).expect(200)
    expect(res.body).toEqual({ visitingCardUrl: null })
    expect(removeVisitingCard).toHaveBeenCalledWith(ID, expect.objectContaining({ sub: "user-1" }))
  })
})
