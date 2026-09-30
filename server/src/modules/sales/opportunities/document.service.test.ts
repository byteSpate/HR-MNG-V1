import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    opportunity: { findFirst: vi.fn() },
    opportunityDocumentLink: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { addDocumentLink, listDocumentLinks, removeDocumentLink } from "./document.service"
import { addDocumentLinkSchema } from "./opportunity.validators"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OTHER = { sub: "user-2", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "user-3", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const NOW = new Date("2026-09-28T10:00:00.000Z")
const link = (o: Record<string, unknown> = {}) => ({
  id: "doc-1", opportunityId: "opp-1", name: "SRS v1", url: "https://drive.google.com/x",
  stage: "DISCOVERY_DESIGN", createdBy: "user-1", createdAt: NOW, ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-1", displayName: null, email: "a@x", employee: { fullName: "Rahim" } }] as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({ id: "opp-1", salesAccountId: "acc-1", ownerEmployeeId: "emp-1", stage: "DISCOVERY_DESIGN" } as any)
  vi.mocked(prisma.opportunityDocumentLink.create).mockImplementation((async (args: any) => link(args.data)) as any)
})

describe("the document link form", () => {
  it("accepts only https addresses", () => {
    expect(addDocumentLinkSchema.safeParse({ name: "SRS", url: "http://x.com" }).success).toBe(false)
    expect(addDocumentLinkSchema.safeParse({ name: "SRS", url: "https://x.com/a" }).success).toBe(true)
  })

  it("needs a name, and refuses one over 120 characters", () => {
    expect(addDocumentLinkSchema.safeParse({ name: "  ", url: "https://x.com" }).success).toBe(false)
    expect(addDocumentLinkSchema.safeParse({ name: "n".repeat(121), url: "https://x.com" }).success).toBe(false)
  })
})

describe("document links", () => {
  it("defaults the stage to the Opportunity's current stage", async () => {
    await addDocumentLink("opp-1", { name: "SRS v1", url: "https://drive.google.com/x" }, USER)
    expect(prisma.opportunityDocumentLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stage: "DISCOVERY_DESIGN", createdBy: "user-1" }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
  })

  it("keeps a stage the person chose over the current one", async () => {
    await addDocumentLink("opp-1", { name: "SRS v1", url: "https://drive.google.com/x", stage: "REQUIREMENT_RECEIVED" }, USER)
    expect(prisma.opportunityDocumentLink.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stage: "REQUIREMENT_RECEIVED" }),
    }))
  })

  it("names the person who added a link, and says who may remove it", async () => {
    const saved = await addDocumentLink("opp-1", { name: "SRS v1", url: "https://drive.google.com/x" }, USER)
    expect(saved).toMatchObject({ id: "doc-1", name: "SRS v1", createdByName: "Rahim", canRemove: true })
  })

  it("lists a link with its author's name and no remove for someone else", async () => {
    vi.mocked(prisma.opportunityDocumentLink.findMany).mockResolvedValue([link()] as any)
    const rows = await listDocumentLinks("opp-1", OTHER)
    expect(rows[0]).toMatchObject({ id: "doc-1", stage: "DISCOVERY_DESIGN", createdByName: "Rahim", canRemove: false })
  })

  it("lets a Sales Admin remove anyone else's link", async () => {
    vi.mocked(prisma.opportunityDocumentLink.findMany).mockResolvedValue([link()] as any)
    expect((await listDocumentLinks("opp-1", ADMIN))[0].canRemove).toBe(true)
  })

  it("lists nothing without asking for any names", async () => {
    vi.mocked(prisma.opportunityDocumentLink.findMany).mockResolvedValue([] as any)
    await expect(listDocumentLinks("opp-1", USER)).resolves.toEqual([])
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it("lets only the person who added it, or a Sales Admin, remove it", async () => {
    vi.mocked(prisma.opportunityDocumentLink.findUnique).mockResolvedValue(link() as any)
    await expect(removeDocumentLink("doc-1", OTHER)).rejects.toThrow("Only the person who added this link, or a Sales Admin, can remove it.")
    await removeDocumentLink("doc-1", ADMIN)
    expect(prisma.opportunityDocumentLink.delete).toHaveBeenCalledWith({ where: { id: "doc-1" } })
  })

  it("says a link that does not exist is not theirs", async () => {
    vi.mocked(prisma.opportunityDocumentLink.findUnique).mockResolvedValue(null as any)
    await expect(removeDocumentLink("doc-9", USER)).rejects.toThrow("That link does not exist, or is not yours")
  })

  it("writes nothing when the removal is refused", async () => {
    vi.mocked(prisma.opportunityDocumentLink.findUnique).mockResolvedValue(link() as any)
    await expect(removeDocumentLink("doc-1", OTHER)).rejects.toThrow()
    expect(prisma.opportunityDocumentLink.delete).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })
})
