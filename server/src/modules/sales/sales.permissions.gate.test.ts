import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

// Only the permission table is mocked on purpose. When a gate refuses, no
// handler runs. When a gate lets a request through, the handler fails on the
// missing mocks, and that failure is not the permission message, which is all
// these tests look for.
vi.mock("../../config/prisma", () => ({
  default: {
    salesPermission: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { signAccessToken } from "../auth/auth.utils"
import { clearPermissionCache, PERMISSION_OFF_MESSAGE, SALES_PERMISSIONS, type PermissionKey } from "./sales.permissions"

const auth = (role: string, salesRole: string | null) =>
  `Bearer ${signAccessToken({ sub: "u-1", role: role as never, email: "a@b.c", mustChangePassword: false, salesRole: salesRole as never })}`

type Method = "get" | "post" | "put" | "patch" | "delete"

/** [method, path under /api/sales, the switch that gates it] */
const GATED: [Method, string, PermissionKey][] = [
  ["post", "/opportunities", "opportunity.create"],
  ["patch", "/opportunities/x/stage", "opportunity.change_stage"],
  ["patch", "/opportunities/x/status", "opportunity.change_status"],
  ["post", "/opportunities/x/handover", "opportunity.hand_over"],
  ["post", "/opportunities/x/lines", "opportunity.edit_products"],
  ["put", "/opportunities/x/lines/reorder", "opportunity.edit_products"],
  ["patch", "/lines/x", "opportunity.edit_products"],
  ["delete", "/lines/x", "opportunity.edit_products"],
  ["delete", "/documents/x", "opportunity.remove_document"],
  ["post", "/opportunities/x/project", "project.start"],
  ["patch", "/projects/x", "project.edit"],
  ["put", "/projects/x/team", "project.edit"],
  ["post", "/projects/x/milestones", "project.edit"],
  ["patch", "/project-milestones/x", "project.edit"],
  ["delete", "/project-milestones/x", "project.edit"],
  ["post", "/meetings", "meeting.create"],
  ["post", "/minutes/x/send", "minutes.send"],
  ["put", "/settings/minutes-template", "minutes.edit_template"],
  ["post", "/tasks", "task.create"],
  ["post", "/weekly/submit", "weekly.submit"],
  ["patch", "/funnel/cell", "funnel.edit_cell"],
  ["post", "/accounts", "account.create"],
  ["get", "/employees", "account.create"],
  ["patch", "/accounts/x", "account.edit"],
  ["put", "/accounts/x/visiting-card", "account.edit"],
  ["delete", "/accounts/x/visiting-card", "account.edit"],
  ["patch", "/accounts/x/profile", "account.edit"],
  ["put", "/targets", "target.set"],
  ["get", "/funnel/team", "team.funnel"],
  ["get", "/weekly/all", "team.weekly"],
  ["get", "/weekly/all/x", "team.weekly"],
]

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as never)
})

describe.each(GATED)("%s /api/sales%s (%s)", (method, path, key) => {
  it("refuses a Sales User while the switch is off", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key, enabled: false }] as never)
    const res = await request(app)[method](`/api/sales${path}`).set("Authorization", auth("EMPLOYEE", "SALES_USER"))
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(PERMISSION_OFF_MESSAGE)
  })

  it("answers as today while the table is empty: the switch's own default decides", async () => {
    const res = await request(app)[method](`/api/sales${path}`).set("Authorization", auth("EMPLOYEE", "SALES_USER"))
    if (SALES_PERMISSIONS.find((p) => p.key === key)!.default) {
      expect(res.body.error).not.toBe(PERMISSION_OFF_MESSAGE)
    } else {
      expect(res.status).toBe(403)
      expect(res.body.error).toBe(PERMISSION_OFF_MESSAGE)
    }
  })

  it("does not refuse a Sales User for this reason once the switch is on", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key, enabled: true }] as never)
    const res = await request(app)[method](`/api/sales${path}`).set("Authorization", auth("EMPLOYEE", "SALES_USER"))
    expect(res.body.error).not.toBe(PERMISSION_OFF_MESSAGE)
  })

  it("never refuses a Sales Admin for this reason, even with the switch off", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key, enabled: false }] as never)
    const res = await request(app)[method](`/api/sales${path}`).set("Authorization", auth("EMPLOYEE", "SALES_ADMIN"))
    expect(res.body.error).not.toBe(PERMISSION_OFF_MESSAGE)
  })

  it("never refuses the Super Admin for this reason, even with the switch off", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key, enabled: false }] as never)
    const res = await request(app)[method](`/api/sales${path}`).set("Authorization", auth("SUPER_ADMIN", null))
    expect(res.body.error).not.toBe(PERMISSION_OFF_MESSAGE)
  })
})
