import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./meeting.service", () => ({
  createMeeting: vi.fn(), listMeetings: vi.fn(), getMeeting: vi.fn(),
  updateMeeting: vi.fn(), changeMeetingStatus: vi.fn(), listMeetingAttendeeOptions: vi.fn(),
}))
vi.mock("./tasks/task.service", () => ({
  createTask: vi.fn(), listTasks: vi.fn(), getTask: vi.fn(),
  updateTask: vi.fn(), changeTaskStatus: vi.fn(),
}))
vi.mock("./opportunity.service", async (original) => ({
  ...(await original<typeof import("./opportunity.service")>()),
  changeOpportunityNextStep: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as meetings from "./meeting.service"
import * as opportunities from "./opportunity.service"
import * as tasks from "./tasks/task.service"

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

  it("lists who can attend to any hub member, without reading the path as a meeting id", async () => {
    vi.mocked(meetings.listMeetingAttendeeOptions).mockResolvedValue([] as any)

    await request(app).get("/api/sales/meetings/attendee-options")
      .set("Authorization", auth("SALES_USER")).expect(200)
    expect(meetings.listMeetingAttendeeOptions).toHaveBeenCalled()
    expect(meetings.getMeeting).not.toHaveBeenCalled()

    await request(app).get("/api/sales/meetings/attendee-options").set("Authorization", auth(null)).expect(403)
  })
})

describe("task routes", () => {
  const TASK = { salesAccountId: ACCOUNT, title: "Call back about the quote", dueOn: "2026-09-20" }

  beforeEach(() => {
    vi.mocked(tasks.createTask).mockResolvedValue({ id: "task-1" } as any)
    vi.mocked(tasks.listTasks).mockResolvedValue({ items: [] } as any)
    vi.mocked(tasks.getTask).mockResolvedValue({ id: "task-1" } as any)
    vi.mocked(tasks.updateTask).mockResolvedValue({ id: "task-1" } as any)
    vi.mocked(tasks.changeTaskStatus).mockResolvedValue({ id: "task-1", nextFollowUpOn: null } as any)
    vi.mocked(opportunities.changeOpportunityNextStep).mockResolvedValue({ id: "opp-1" } as any)
  })

  it("guards the task endpoints with Sales Hub access", async () => {
    await request(app).get("/api/sales/tasks").expect(401)
    await request(app).get("/api/sales/tasks").set("Authorization", auth(null)).expect(403)
  })

  it("makes a task, dropping any owner or origin the body tries to set", async () => {
    await request(app).post("/api/sales/tasks").set("Authorization", auth("SALES_USER"))
      .send({ ...TASK, assignedToEmployeeId: ACCOUNT, origin: "FUNNEL_MEETING" }).expect(201)

    const body = vi.mocked(tasks.createTask).mock.calls[0][0] as any
    expect(body).toMatchObject({ ...TASK, priority: "NORMAL" })
    expect(body).not.toHaveProperty("assignedToEmployeeId")
    expect(body).not.toHaveProperty("origin")
  })

  it("refuses a task with no due date, or a due date that is not a date", async () => {
    for (const dueOn of [undefined, "20/09/2026"]) {
      await request(app).post("/api/sales/tasks").set("Authorization", auth("SALES_USER"))
        .send({ ...TASK, dueOn }).expect(400)
    }
    expect(tasks.createTask).not.toHaveBeenCalled()
  })

  it("needs a reason to cancel a task", async () => {
    await request(app).patch("/api/sales/tasks/task-1/status")
      .set("Authorization", auth("SALES_USER")).send({ status: "CANCELLED" }).expect(400)
    await request(app).patch("/api/sales/tasks/task-1/status")
      .set("Authorization", auth("SALES_USER")).send({ status: "DONE", outcome: "Quote accepted" }).expect(200)
    expect(tasks.changeTaskStatus).toHaveBeenCalledWith(
      "task-1", { status: "DONE", outcome: "Quote accepted" }, expect.anything()
    )
  })

  it("passes the list filters through and refuses a due filter it does not know", async () => {
    await request(app).get("/api/sales/tasks?due=overdue&mine=true&origin=SELF")
      .set("Authorization", auth("SALES_USER")).expect(200)
    expect(tasks.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ due: "overdue", mine: true, origin: "SELF" }), expect.anything()
    )

    await request(app).get("/api/sales/tasks?due=soon").set("Authorization", auth("SALES_USER")).expect(400)
    // "Due today or overdue", the overview row's link.
    await request(app).get("/api/sales/tasks?due=now").set("Authorization", auth("SALES_USER")).expect(200)
  })

  it("edits a task, and refuses an edit that changes nothing", async () => {
    await request(app).patch("/api/sales/tasks/task-1")
      .set("Authorization", auth("SALES_USER")).send({ priority: "HIGH" }).expect(200)
    await request(app).patch("/api/sales/tasks/task-1")
      .set("Authorization", auth("SALES_USER")).send({}).expect(400)
  })

  it("reads one task", async () => {
    await request(app).get("/api/sales/tasks/task-1").set("Authorization", auth("SALES_USER")).expect(200)
    expect(tasks.getTask).toHaveBeenCalledWith("task-1", expect.anything())
  })

  it("passes the Next step's also-create-a-task box through", async () => {
    await request(app).patch("/api/sales/opportunities/opp-1/next-step")
      .set("Authorization", auth("SALES_USER"))
      .send({ nextStep: "Send revised BOM", nextStepDueOn: "2026-09-20", alsoCreateTask: true }).expect(200)

    expect(opportunities.changeOpportunityNextStep).toHaveBeenCalledWith(
      "opp-1", expect.objectContaining({ alsoCreateTask: true }), expect.anything()
    )
  })
})
