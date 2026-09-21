import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./comment.service", () => ({
  createSalesComment: vi.fn(), listSalesComments: vi.fn(), updateSalesComment: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import * as comments from "./comment.service"

const token = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => signAccessToken({
  sub: "user-1", role: "EMPLOYEE" as never, email: "sales@example.com",
  mustChangePassword: false, salesRole: salesRole as never,
})
const auth = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => `Bearer ${token(salesRole)}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(comments.createSalesComment).mockResolvedValue({ id: "comment-1" } as any)
  vi.mocked(comments.listSalesComments).mockResolvedValue({ items: [], truncated: false, limit: 100 } as any)
})

describe("comment routes", () => {
  it("creates and lists comments but exposes no delete route", async () => {
    await request(app).post("/api/sales/comments")
      .set("Authorization", auth("SALES_USER"))
      .send({
        entity: "SALES_ACCOUNT", entityId: "11111111-1111-4111-8111-111111111111",
        kind: "GENERAL", body: "Customer asked for a revision",
      }).expect(201)
    await request(app).get(
      "/api/sales/comments?entity=SALES_ACCOUNT&entityId=11111111-1111-4111-8111-111111111111"
    ).set("Authorization", auth("SALES_USER")).expect(200)
    await request(app).delete("/api/sales/comments/comment-1")
      .set("Authorization", auth("SALES_ADMIN")).expect(404)
  })
})
