import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./inbox.service", () => ({
  unreadCount: vi.fn(),
  listInbox: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import { listInbox, markAllRead, markRead, unreadCount } from "./inbox.service"

const auth = (sub = "user-1") =>
  `Bearer ${signAccessToken({ sub, role: "EMPLOYEE" as never, email: "a@demo.com", mustChangePassword: false, salesRole: null })}`

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/api/notifications", () => {
  it("needs a signed-in user", async () => {
    const res = await request(app).get("/api/notifications/count")
    expect(res.status).toBe(401)
  })

  it("returns my unread count", async () => {
    vi.mocked(unreadCount).mockResolvedValue(3)
    const res = await request(app).get("/api/notifications/count").set("Authorization", auth("user-7"))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ unread: 3 })
    expect(vi.mocked(unreadCount).mock.calls[0][0]).toBe("user-7")
  })

  it("lists a tab with its filters", async () => {
    vi.mocked(listInbox).mockResolvedValue({ items: [], nextCursor: null })
    const res = await request(app)
      .get("/api/notifications?tab=all&mine=true&unread=true&limit=10")
      .set("Authorization", auth())
    expect(res.status).toBe(200)
    expect(vi.mocked(listInbox).mock.calls[0][1]).toEqual({ tab: "all", mine: true, unread: true, limit: 10 })
  })

  it("refuses an unknown tab in plain words", async () => {
    const res = await request(app).get("/api/notifications?tab=wrong").set("Authorization", auth())
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("Choose a tab: important, primary or all.")
  })

  it("marks one read for the signed-in user", async () => {
    const res = await request(app).patch("/api/notifications/n-1/read").set("Authorization", auth("user-7"))
    expect(res.status).toBe(204)
    expect(markRead).toHaveBeenCalledWith("user-7", "n-1")
  })

  it("marks all read and is not shadowed by the :id route", async () => {
    vi.mocked(markAllRead).mockResolvedValue(5)
    const res = await request(app).post("/api/notifications/read-all").set("Authorization", auth("user-7"))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ marked: 5 })
    expect(vi.mocked(markAllRead).mock.calls[0][0]).toBe("user-7")
  })
})
