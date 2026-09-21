import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./task.service", () => ({
  createTask: vi.fn(), listTasks: vi.fn(), getTask: vi.fn(),
  updateTask: vi.fn(), changeTaskStatus: vi.fn(),
}))
vi.mock("../opportunities/opportunity.service", async (original) => ({
  ...(await original<typeof import("../opportunities/opportunity.service")>()),
  changeOpportunityNextStep: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import * as opportunities from "../opportunities/opportunity.service"
import * as tasks from "./task.service"

const token = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => signAccessToken({
  sub: "user-1", role: "EMPLOYEE" as never, email: "sales@example.com",
  mustChangePassword: false, salesRole: salesRole as never,
})
const auth = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => `Bearer ${token(salesRole)}`

const ACCOUNT = "11111111-1111-4111-8111-111111111111"

beforeEach(() => {
  vi.clearAllMocks()
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
