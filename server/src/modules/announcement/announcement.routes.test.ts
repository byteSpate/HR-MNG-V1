import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./announcement.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./announcement.service")>()
  return {
    // The route file imports PUBLISHER_ROLES from the service, so the real
    // constant has to survive the mock or every route would be unguarded.
    PUBLISHER_ROLES: actual.PUBLISHER_ROLES,
    listAnnouncements: vi.fn(),
    getAnnouncement: vi.fn(),
    createAnnouncement: vi.fn(),
    updateAnnouncement: vi.fn(),
    deleteAnnouncement: vi.fn(),
  }
})

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as service from "./announcement.service"

type TestRole = "EMPLOYEE" | "REPORTING_MANAGER" | "HR_ADMIN" | "SUPER_ADMIN" | "FINANCE_OFFICER"
const auth = (role: TestRole) =>
  `Bearer ${signAccessToken({ sub: "user-1", role: role as never, email: "a@demo.com", mustChangePassword: false, salesRole: null })}`

const validBody = { title: "Office closed", body: "Sunday", audience: "ALL" }

beforeEach(() => {
  vi.mocked(service.listAnnouncements).mockResolvedValue([])
  vi.mocked(service.getAnnouncement).mockResolvedValue({ id: "ann-1" } as never)
  vi.mocked(service.createAnnouncement).mockResolvedValue({ id: "ann-1" } as never)
  vi.mocked(service.updateAnnouncement).mockResolvedValue({ id: "ann-1" } as never)
  vi.mocked(service.deleteAnnouncement).mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

describe("GET /api/announcements", () => {
  it("401s unauthenticated", async () => {
    expect((await request(app).get("/api/announcements")).status).toBe(401)
  })

  it.each<TestRole>(["EMPLOYEE", "REPORTING_MANAGER", "HR_ADMIN", "SUPER_ADMIN", "FINANCE_OFFICER"])(
    "200s for %s — everyone reads, the service decides what",
    async (role) => {
      const res = await request(app).get("/api/announcements").set("Authorization", auth(role))
      expect(res.status).toBe(200)
    }
  )

  it("400s a malformed limit", async () => {
    const res = await request(app)
      .get("/api/announcements?limit=abc")
      .set("Authorization", auth("EMPLOYEE"))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/announcements", () => {
  it("403s an employee", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", auth("EMPLOYEE"))
      .send(validBody)
    expect(res.status).toBe(403)
    expect(service.createAnnouncement).not.toHaveBeenCalled()
  })

  it.each<TestRole>(["SUPER_ADMIN", "HR_ADMIN", "FINANCE_OFFICER", "REPORTING_MANAGER"])(
    "201s for %s at the middleware, leaving the audience to the service",
    async (role) => {
      const res = await request(app)
        .post("/api/announcements")
        .set("Authorization", auth(role))
        .send(validBody)
      expect(res.status).toBe(201)
    }
  )

  it("400s a DEPARTMENT announcement with no departmentId", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", auth("HR_ADMIN"))
      .send({ title: "T", body: "B", audience: "DEPARTMENT" })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("departmentId")
  })

  it("400s a ROLE announcement with no targetRole", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", auth("HR_ADMIN"))
      .send({ title: "T", body: "B", audience: "ROLE" })
    expect(res.status).toBe(400)
  })

  it("400s an ALL announcement that also carries a department", async () => {
    // A field nothing reads and everything half-trusts.
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", auth("HR_ADMIN"))
      .send({ title: "T", body: "B", audience: "ALL", departmentId: "dept-eng" })
    expect(res.status).toBe(400)
  })

  it("400s a DEPARTMENT announcement that also carries a role", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", auth("HR_ADMIN"))
      .send({
        title: "T",
        body: "B",
        audience: "DEPARTMENT",
        departmentId: "dept-eng",
        targetRole: "EMPLOYEE",
      })
    expect(res.status).toBe(400)
  })

  it("400s an empty title", async () => {
    const res = await request(app)
      .post("/api/announcements")
      .set("Authorization", auth("HR_ADMIN"))
      .send({ ...validBody, title: "" })
    expect(res.status).toBe(400)
  })

  it("passes an explicit null publishedAt through as a draft", async () => {
    await request(app)
      .post("/api/announcements")
      .set("Authorization", auth("HR_ADMIN"))
      .send({ ...validBody, publishedAt: null })
    expect(service.createAnnouncement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ publishedAt: null })
    )
  })
})

describe("PATCH and DELETE /api/announcements/:id", () => {
  it("403s an employee patching", async () => {
    const res = await request(app)
      .patch("/api/announcements/ann-1")
      .set("Authorization", auth("EMPLOYEE"))
      .send({ title: "New" })
    expect(res.status).toBe(403)
  })

  it("403s an employee deleting", async () => {
    const res = await request(app)
      .delete("/api/announcements/ann-1")
      .set("Authorization", auth("EMPLOYEE"))
    expect(res.status).toBe(403)
    expect(service.deleteAnnouncement).not.toHaveBeenCalled()
  })

  it("lets a manager past the middleware, leaving ownership to the service", async () => {
    const res = await request(app)
      .patch("/api/announcements/ann-1")
      .set("Authorization", auth("REPORTING_MANAGER"))
      .send({ title: "New" })
    expect(res.status).toBe(200)
    expect(service.updateAnnouncement).toHaveBeenCalledWith(
      expect.anything(),
      "ann-1",
      { title: "New" }
    )
  })

  it("400s an empty patch", async () => {
    const res = await request(app)
      .patch("/api/announcements/ann-1")
      .set("Authorization", auth("HR_ADMIN"))
      .send({})
    expect(res.status).toBe(400)
  })

  it("204s a successful delete", async () => {
    const res = await request(app)
      .delete("/api/announcements/ann-1")
      .set("Authorization", auth("HR_ADMIN"))
    expect(res.status).toBe(204)
  })
})
