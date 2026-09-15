import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./minutes.template.service", () => ({
  getMinutesTemplate: vi.fn(), saveMinutesTemplate: vi.fn(),
}))
vi.mock("./minutes.service", () => ({
  startMinutes: vi.fn(), getMinutes: vi.fn(), saveMinutes: vi.fn(), answerRequirement: vi.fn(),
  deleteMinutes: vi.fn(), listMinutes: vi.fn(),
}))
vi.mock("./meeting.service", async (original) => ({
  ...(await original<typeof import("./meeting.service")>()),
  listMeetingsWaitingForMinutes: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as meetings from "./meeting.service"
import * as minutes from "./minutes.service"
import * as template from "./minutes.template.service"

const token = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => signAccessToken({
  sub: "user-1", role: "EMPLOYEE" as never, email: "sales@example.com",
  mustChangePassword: false, salesRole: salesRole as never,
})
const auth = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => `Bearer ${token(salesRole)}`

const EMPLOYEE = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(template.getMinutesTemplate).mockResolvedValue({ sections: [], isDefault: true, updatedAt: null } as any)
  vi.mocked(template.saveMinutesTemplate).mockResolvedValue({ sections: [], isDefault: false, updatedAt: null } as any)
  vi.mocked(minutes.startMinutes).mockResolvedValue({ id: "minutes-1", created: true })
  vi.mocked(minutes.getMinutes).mockResolvedValue({ id: "minutes-1" } as any)
  vi.mocked(minutes.saveMinutes).mockResolvedValue({ id: "minutes-1" } as any)
  vi.mocked(minutes.answerRequirement).mockResolvedValue({ id: "minutes-1" } as any)
  vi.mocked(minutes.deleteMinutes).mockResolvedValue(undefined)
  vi.mocked(minutes.listMinutes).mockResolvedValue({ items: [] })
  vi.mocked(meetings.listMeetingsWaitingForMinutes).mockResolvedValue({ items: [] })
})

describe("the minutes template on Sales Settings", () => {
  const PATH = "/api/sales/settings/minutes-template"
  const BODY = { sections: [{ heading: "Summary", kind: "PARAGRAPHS" }] }

  it("is for Sales Admins only", async () => {
    await request(app).get(PATH).expect(401)
    await request(app).get(PATH).set("Authorization", auth("SALES_USER")).expect(403)
    await request(app).put(PATH).set("Authorization", auth("SALES_USER")).send(BODY).expect(403)
    expect(template.saveMinutesTemplate).not.toHaveBeenCalled()

    await request(app).get(PATH).set("Authorization", auth("SALES_ADMIN")).expect(200)
  })

  it("refuses a template with no sections before calling the service", async () => {
    await request(app).put(PATH).set("Authorization", auth("SALES_ADMIN")).send({ sections: [] }).expect(400)
    expect(template.saveMinutesTemplate).not.toHaveBeenCalled()
  })

  it("saves a template", async () => {
    await request(app).put(PATH).set("Authorization", auth("SALES_ADMIN")).send(BODY).expect(200)
    expect(template.saveMinutesTemplate).toHaveBeenCalledWith(BODY, expect.anything())
  })
})

describe("minutes", () => {
  const SAVE = {
    purpose: "Introduce our services",
    meetingWithNote: null,
    sections: [{ heading: "Meeting Summary", kind: "PARAGRAPHS", content: { paragraphs: ["Held."] } }],
    preparers: [{ employeeId: EMPLOYEE, titleExtra: null }],
  }

  it("needs Sales Hub access", async () => {
    await request(app).get("/api/sales/minutes").expect(401)
    await request(app).get("/api/sales/minutes").set("Authorization", auth(null)).expect(403)
  })

  it("starts minutes from a meeting: 201 when new, 200 when they already existed", async () => {
    const created = await request(app).post("/api/sales/meetings/meeting-1/minutes")
      .set("Authorization", auth("SALES_USER")).expect(201)
    expect(created.body).toEqual({ id: "minutes-1" })
    expect(minutes.startMinutes).toHaveBeenCalledWith("meeting-1", expect.anything())

    vi.mocked(minutes.startMinutes).mockResolvedValue({ id: "minutes-1", created: false })
    await request(app).post("/api/sales/meetings/meeting-1/minutes")
      .set("Authorization", auth("SALES_USER")).expect(200)
  })

  it("lists the meetings waiting for minutes without reading the path as an id", async () => {
    await request(app).get("/api/sales/minutes/waiting?mine=true")
      .set("Authorization", auth("SALES_USER")).expect(200)

    expect(meetings.listMeetingsWaitingForMinutes).toHaveBeenCalledWith({ mine: true }, expect.anything())
    expect(minutes.getMinutes).not.toHaveBeenCalled()
  })

  it("passes the list filters through", async () => {
    await request(app).get("/api/sales/minutes?mine=true&status=EDITED_AFTER_SENDING")
      .set("Authorization", auth("SALES_USER")).expect(200)

    expect(minutes.listMinutes).toHaveBeenCalledWith({ mine: true, status: "EDITED_AFTER_SENDING" }, expect.anything())
  })

  it("reads one document", async () => {
    await request(app).get("/api/sales/minutes/minutes-1").set("Authorization", auth("SALES_USER")).expect(200)
    expect(minutes.getMinutes).toHaveBeenCalledWith("minutes-1", expect.anything())
  })

  it("saves, and refuses a section whose content is for another kind before calling the service", async () => {
    await request(app).put("/api/sales/minutes/minutes-1").set("Authorization", auth("SALES_USER"))
      .send({ ...SAVE, sections: [{ heading: "Summary", kind: "PARAGRAPHS", content: { bullets: [] } }] })
      .expect(400)
    expect(minutes.saveMinutes).not.toHaveBeenCalled()

    await request(app).put("/api/sales/minutes/minutes-1").set("Authorization", auth("SALES_USER")).send(SAVE).expect(200)
    expect(minutes.saveMinutes).toHaveBeenCalledWith("minutes-1", expect.objectContaining({ purpose: "Introduce our services" }), expect.anything())
  })

  it("needs a yes or a no for the requirement question", async () => {
    await request(app).patch("/api/sales/minutes/minutes-1/requirement")
      .set("Authorization", auth("SALES_USER")).send({}).expect(400)

    await request(app).patch("/api/sales/minutes/minutes-1/requirement")
      .set("Authorization", auth("SALES_USER")).send({ found: false }).expect(200)
    expect(minutes.answerRequirement).toHaveBeenCalledWith("minutes-1", { found: false }, expect.anything())
  })

  it("deletes a document", async () => {
    await request(app).delete("/api/sales/minutes/minutes-1").set("Authorization", auth("SALES_USER")).expect(204)
    expect(minutes.deleteMinutes).toHaveBeenCalledWith("minutes-1", expect.anything())
  })
})
