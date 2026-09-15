import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

vi.mock("./minutes.template.service", () => ({
  getMinutesTemplate: vi.fn(), saveMinutesTemplate: vi.fn(),
}))

import app from "../../app"
import { signAccessToken } from "../auth/auth.utils"
import * as template from "./minutes.template.service"

const token = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => signAccessToken({
  sub: "user-1", role: "EMPLOYEE" as never, email: "sales@example.com",
  mustChangePassword: false, salesRole: salesRole as never,
})
const auth = (salesRole: "SALES_USER" | "SALES_ADMIN" | null) => `Bearer ${token(salesRole)}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(template.getMinutesTemplate).mockResolvedValue({ sections: [], isDefault: true, updatedAt: null } as any)
  vi.mocked(template.saveMinutesTemplate).mockResolvedValue({ sections: [], isDefault: false, updatedAt: null } as any)
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
