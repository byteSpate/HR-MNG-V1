import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

// The routes now check a Permission switch before the handler. This file mocks
// the services, so the switch table gets an empty answer: every switch keeps
// its default, which is today's behaviour.
vi.mock("../../../config/prisma", () => ({
  default: { salesPermission: { findMany: vi.fn().mockResolvedValue([]) } },
}))

vi.mock("./project.service", () => ({
  startProject: vi.fn(), listProjects: vi.fn(), getProject: vi.fn(),
  updateProject: vi.fn(), setProjectTeam: vi.fn(), changeProjectStatus: vi.fn(),
}))
vi.mock("./project.milestone.service", () => ({
  addMilestone: vi.fn(), updateMilestone: vi.fn(), removeMilestone: vi.fn(),
  tickLine: vi.fn(), untickLine: vi.fn(),
}))

import app from "../../../app"
import { signAccessToken } from "../../auth/auth.utils"
import * as project from "./project.service"
import * as milestones from "./project.milestone.service"

const auth = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) =>
  `Bearer ${signAccessToken({
    sub: "user-1", role: "EMPLOYEE" as never, email: "sales@example.com",
    mustChangePassword: false, salesRole: salesRole as never,
  })}`

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [project.startProject, project.getProject, project.updateProject, project.setProjectTeam, project.changeProjectStatus]) {
    vi.mocked(fn).mockResolvedValue({ id: "prj-1" } as any)
  }
  for (const fn of [milestones.addMilestone, milestones.updateMilestone, milestones.removeMilestone, milestones.tickLine, milestones.untickLine]) {
    vi.mocked(fn).mockResolvedValue({ id: "prj-1" } as any)
  }
  vi.mocked(project.listProjects).mockResolvedValue([] as any)
})

describe("project routes", () => {
  it("guards every project endpoint with Sales Hub access", async () => {
    await request(app).get("/api/sales/projects").expect(401)
    await request(app).get("/api/sales/projects")
      .set("Authorization", auth(null)).expect(403)
    await request(app).get("/api/sales/projects/prj-1").expect(401)
  })

  it("lists and reads projects", async () => {
    await request(app).get("/api/sales/projects")
      .set("Authorization", auth("SALES_USER")).expect(200)
    await request(app).get("/api/sales/projects/prj-1")
      .set("Authorization", auth("SALES_USER")).expect(200)
  })

  it("starts a Project from a Won Opportunity, with 201", async () => {
    await request(app).post("/api/sales/opportunities/opp-1/project")
      .set("Authorization", auth("SALES_USER")).expect(201)
    expect(project.startProject).toHaveBeenCalledWith("opp-1", expect.objectContaining({ sub: "user-1" }))
  })

  it("replaces the Project Team", async () => {
    await request(app).put("/api/sales/projects/prj-1/team")
      .set("Authorization", auth("SALES_USER")).send({ members: [] }).expect(200)
    expect(project.setProjectTeam).toHaveBeenCalledWith("prj-1", { members: [] }, expect.anything())
  })

  it("refuses a team with the same person twice", async () => {
    await request(app).put("/api/sales/projects/prj-1/team")
      .set("Authorization", auth("SALES_USER"))
      .send({ members: [{ employeeId: "11111111-1111-4111-8111-111111111111" }, { employeeId: "11111111-1111-4111-8111-111111111111" }] })
      .expect(400)
  })

  it("refuses a status it does not know", async () => {
    await request(app).patch("/api/sales/projects/prj-1/status")
      .set("Authorization", auth("SALES_USER")).send({ status: "WRONG" }).expect(400)
    expect(project.changeProjectStatus).not.toHaveBeenCalled()
  })

  it("changes a Project's status", async () => {
    await request(app).patch("/api/sales/projects/prj-1/status")
      .set("Authorization", auth("SALES_USER")).send({ status: "BLOCKED", reason: "No parts" }).expect(200)
  })

  it("edits a milestone by its own id, never reading it as a Project id", async () => {
    await request(app).patch("/api/sales/project-milestones/m1")
      .set("Authorization", auth("SALES_USER")).send({ done: true }).expect(200)
    expect(milestones.updateMilestone).toHaveBeenCalledWith("m1", { done: true }, expect.anything())
  })

  it("adds, ticks and unticks through the Project's own id", async () => {
    await request(app).post("/api/sales/projects/prj-1/milestones")
      .set("Authorization", auth("SALES_USER")).send({ title: "Delivery" }).expect(201)
    await request(app).put("/api/sales/projects/prj-1/lines/l1/done")
      .set("Authorization", auth("SALES_USER")).expect(200)
    await request(app).delete("/api/sales/projects/prj-1/lines/l1/done")
      .set("Authorization", auth("SALES_USER")).expect(200)
    expect(milestones.tickLine).toHaveBeenCalledWith("prj-1", "l1", expect.anything())
    expect(milestones.untickLine).toHaveBeenCalledWith("prj-1", "l1", expect.anything())
  })
})
