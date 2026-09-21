import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./minutes.template.service", () => ({
  getMinutesTemplate: vi.fn(), saveMinutesTemplate: vi.fn(),
}))
vi.mock("./minutes.service", () => ({
  startMinutes: vi.fn(), getMinutes: vi.fn(), saveMinutes: vi.fn(), answerRequirement: vi.fn(),
  deleteMinutes: vi.fn(), listMinutes: vi.fn(),
}))
vi.mock("./minutes.send", () => ({ previewMinutes: vi.fn(), sendMinutes: vi.fn(), getSentCopy: vi.fn() }))
vi.mock("../meetings/meeting.service", async (original) => ({
  ...(await original<typeof import("../meetings/meeting.service")>()),
  listMeetingsWaitingForMinutes: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import * as meetings from "../meetings/meeting.service"
import * as sending from "./minutes.send"
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

  it("is open to everyone in the hub, Sales Users included, and to nobody outside it", async () => {
    await request(app).get(PATH).expect(401)
    await request(app).get(PATH).set("Authorization", auth(null)).expect(403)
    await request(app).put(PATH).set("Authorization", auth(null)).send(BODY).expect(403)
    expect(template.saveMinutesTemplate).not.toHaveBeenCalled()

    // Changed by the owner on 2026-09-15: the format changes often, and
    // waiting for an admin slowed people down.
    await request(app).get(PATH).set("Authorization", auth("SALES_USER")).expect(200)
    await request(app).put(PATH).set("Authorization", auth("SALES_USER")).send(BODY).expect(200)
    expect(template.saveMinutesTemplate).toHaveBeenCalledWith(BODY, expect.anything())
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

describe("minutes as PDFs", () => {
  const FILE = { pdf: Buffer.from("%PDF-1"), fileName: "Meeting Minutes – APS Group – 13 Sep 2026.pdf" }
  const ENCODED = "filename*=UTF-8''Meeting%20Minutes%20%E2%80%93%20APS%20Group%20%E2%80%93%2013%20Sep%202026.pdf"

  beforeEach(() => {
    vi.mocked(sending.previewMinutes).mockResolvedValue(FILE)
    vi.mocked(sending.sendMinutes).mockResolvedValue(FILE)
    vi.mocked(sending.getSentCopy).mockResolvedValue(FILE)
  })

  it("shows a preview in the browser", async () => {
    const res = await request(app).get("/api/sales/minutes/minutes-1/preview")
      .set("Authorization", auth("SALES_USER")).expect(200)

    expect(res.headers["content-type"]).toContain("application/pdf")
    expect(res.headers["content-disposition"]).toMatch(/^inline;/)
    expect(res.headers["content-disposition"]).toContain(ENCODED)
    expect(sending.previewMinutes).toHaveBeenCalledWith("minutes-1", expect.anything())
  })

  it("downloads the copy for sending, with the Sent to note", async () => {
    const res = await request(app).post("/api/sales/minutes/minutes-1/send")
      .set("Authorization", auth("SALES_USER")).send({ sentTo: "Md. Salim Reza, by email" }).expect(200)

    expect(res.headers["content-type"]).toContain("application/pdf")
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/)
    expect(sending.sendMinutes).toHaveBeenCalledWith("minutes-1", { sentTo: "Md. Salim Reza, by email" }, expect.anything())
  })

  it("downloads a kept copy again", async () => {
    const res = await request(app).get("/api/sales/minutes/sends/send-1/file")
      .set("Authorization", auth("SALES_USER")).expect(200)

    expect(res.headers["content-type"]).toContain("application/pdf")
    expect(sending.getSentCopy).toHaveBeenCalledWith("send-1", expect.anything())
  })
})
