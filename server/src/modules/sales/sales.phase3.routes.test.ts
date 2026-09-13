import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./meeting.service", () => ({
  createMeeting: vi.fn(), listMeetings: vi.fn(), getMeeting: vi.fn(),
  updateMeeting: vi.fn(), changeMeetingStatus: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as meetings from "./meeting.service"

const token = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => signAccessToken({
  sub: "user-1", role: "EMPLOYEE" as never, email: "sales@example.com",
  mustChangePassword: false, salesRole: salesRole as never,
})
const auth = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => `Bearer ${token(salesRole)}`

const ACCOUNT = "11111111-1111-4111-8111-111111111111"
const BASE = { salesAccountId: ACCOUNT, title: "Firewall walkthrough", scheduledAt: "2026-09-20T10:00:00+06:00" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(meetings.createMeeting).mockResolvedValue({ id: "meeting-1" } as any)
  vi.mocked(meetings.listMeetings).mockResolvedValue({ items: [] } as any)
  vi.mocked(meetings.getMeeting).mockResolvedValue({ id: "meeting-1" } as any)
  vi.mocked(meetings.updateMeeting).mockResolvedValue({ id: "meeting-1" } as any)
  vi.mocked(meetings.changeMeetingStatus).mockResolvedValue({ id: "meeting-1" } as any)
})

describe("meeting routes", () => {
  it("guards the meeting endpoints with Sales Hub access", async () => {
    await request(app).get("/api/sales/meetings").expect(401)
    await request(app).get("/api/sales/meetings").set("Authorization", auth(null)).expect(403)
  })

  it("schedules a meeting, defaulting the mode to a visit and the attendees to none", async () => {
    await request(app).post("/api/sales/meetings")
      .set("Authorization", auth("SALES_USER")).send(BASE).expect(201)

    expect(meetings.createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "CUSTOMER_SITE", attendees: [] }), expect.anything()
    )
  })

  it("refuses a meeting with no title or no time before calling the service", async () => {
    await request(app).post("/api/sales/meetings")
      .set("Authorization", auth("SALES_USER")).send({ salesAccountId: ACCOUNT }).expect(400)
    expect(meetings.createMeeting).not.toHaveBeenCalled()
  })

  it("refuses an attendee who is neither an employee on our side nor a contact or name on theirs", async () => {
    for (const attendee of [{ side: "OURS" }, { side: "THEIRS" }]) {
      await request(app).post("/api/sales/meetings")
        .set("Authorization", auth("SALES_USER")).send({ ...BASE, attendees: [attendee] }).expect(400)
    }
    expect(meetings.createMeeting).not.toHaveBeenCalled()
  })

  it("needs a reason to cancel, and passes one through", async () => {
    await request(app).patch("/api/sales/meetings/meeting-1/status")
      .set("Authorization", auth("SALES_USER")).send({ status: "CANCELLED" }).expect(400)

    await request(app).patch("/api/sales/meetings/meeting-1/status")
      .set("Authorization", auth("SALES_USER"))
      .send({ status: "CANCELLED", reason: "Customer travelling" }).expect(200)
    expect(meetings.changeMeetingStatus).toHaveBeenCalledWith(
      "meeting-1", { status: "CANCELLED", reason: "Customer travelling" }, expect.anything()
    )
  })

  it("passes the list filters through", async () => {
    await request(app).get(`/api/sales/meetings?mine=true&salesAccountId=${ACCOUNT}`)
      .set("Authorization", auth("SALES_USER")).expect(200)

    expect(meetings.listMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ mine: true, salesAccountId: ACCOUNT }), expect.anything()
    )
  })

  it("edits a meeting, and refuses an edit that changes nothing", async () => {
    await request(app).patch("/api/sales/meetings/meeting-1")
      .set("Authorization", auth("SALES_USER")).send({ notes: "Bring the rack diagram" }).expect(200)
    await request(app).patch("/api/sales/meetings/meeting-1")
      .set("Authorization", auth("SALES_USER")).send({}).expect(400)
  })

  it("reads one meeting", async () => {
    await request(app).get("/api/sales/meetings/meeting-1")
      .set("Authorization", auth("SALES_USER")).expect(200)
    expect(meetings.getMeeting).toHaveBeenCalledWith("meeting-1", expect.anything())
  })
})
