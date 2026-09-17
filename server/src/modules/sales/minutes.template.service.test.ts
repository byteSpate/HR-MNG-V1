import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesMinutesTemplate: { findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { DEFAULT_TEMPLATE } from "./minutes.content"
import { getMinutesTemplate, saveMinutesTemplate } from "./minutes.template.service"

const ADMIN = {
  sub: "user-admin", role: "EMPLOYEE", email: "admin@demo.com",
  mustChangePassword: false, salesRole: "SALES_ADMIN",
} as any

const STORED = [
  { heading: "Summary", kind: "PARAGRAPHS", startsWithOutcome: true },
  { heading: "Actions", kind: "TABLE" },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.salesMinutesTemplate.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.salesMinutesTemplate.upsert).mockImplementation((async (args: any) => ({
    id: 1, sections: args.create.sections, updatedBy: "user-admin", updatedAt: new Date("2026-09-15T04:00:00.000Z"),
  })) as never)
})

describe("reading the template", () => {
  it("is the default template until a Sales Admin saves one", async () => {
    const template = await getMinutesTemplate()

    expect(template.sections).toEqual(DEFAULT_TEMPLATE)
    expect(template.isDefault).toBe(true)
    expect(template.updatedAt).toBeNull()
  })

  it("is the saved template once there is one", async () => {
    vi.mocked(prisma.salesMinutesTemplate.findUnique).mockResolvedValue({
      id: 1, sections: STORED, updatedBy: "user-admin", updatedAt: new Date("2026-09-15T04:00:00.000Z"),
    } as any)

    const template = await getMinutesTemplate()

    expect(template.sections).toEqual(STORED)
    expect(template.isDefault).toBe(false)
    expect(template.updatedAt).toBe("2026-09-15T04:00:00.000Z")
  })

  it("falls back to the default when the saved one no longer reads", async () => {
    vi.mocked(prisma.salesMinutesTemplate.findUnique).mockResolvedValue({
      id: 1, sections: [{ heading: "", kind: "POEM" }], updatedBy: null, updatedAt: new Date(),
    } as any)

    expect((await getMinutesTemplate()).sections).toEqual(DEFAULT_TEMPLATE)
  })
})

describe("saving the template", () => {
  it("writes the one row and an audit row naming the sections before and after", async () => {
    const saved = await saveMinutesTemplate({ sections: STORED } as any, ADMIN)

    expect(prisma.salesMinutesTemplate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      create: expect.objectContaining({ id: 1, sections: STORED, updatedBy: "user-admin" }),
      update: expect.objectContaining({ sections: STORED, updatedBy: "user-admin" }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entity: "SALES_MINUTES_TEMPLATE",
        action: "UPDATE",
        changedBy: "user-admin",
        before: { sections: "Meeting Summary, Key Discussion Points, Next Steps, Meeting Outcome" },
        after: { sections: "Summary, Actions" },
      }),
    }))
    expect(saved.sections).toEqual(STORED)
    expect(saved.isDefault).toBe(false)
  })
})
