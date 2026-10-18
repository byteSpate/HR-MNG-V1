import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    salesContact: { findMany: vi.fn(), count: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { buildContactsExportSpec } from "./contacts.export"
import { listAllContacts } from "./contacts.service"
import { listContactsQuerySchema } from "./contacts.validators"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "user-9", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const ROW = {
  id: "c-1", name: "Karim Ahmed", designation: "IT Manager", phone: "01700000000", email: "karim@alpha.com",
  status: "VERIFIED", isPrimary: true, salesAccount: { id: "acc-1", name: "Alpha Ltd" },
}
const findManyArgs = () => vi.mocked(prisma.salesContact.findMany).mock.calls[0][0] as any
const q = (raw: Record<string, unknown> = {}) => listContactsQuerySchema.parse(raw)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.salesContact.findMany).mockResolvedValue([ROW] as any)
  vi.mocked(prisma.salesContact.count).mockResolvedValue(1)
})

describe("the Contacts page (owner, 2026-10-18)", () => {
  it("shows a Sales User only contacts of accounts they own or are assigned to", async () => {
    await listAllContacts(q(), USER)
    expect(findManyArgs().where).toEqual({
      AND: [{ salesAccount: { OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }] } }, {}],
    })
  })

  it("shows a Sales Admin every contact", async () => {
    await listAllContacts(q(), ADMIN)
    expect(findManyArgs().where).toEqual({ AND: [{ salesAccount: {} }, {}] })
  })

  it("searches name, job title, phone, email and account name, ignoring case and taking % and _ as letters", async () => {
    await listAllContacts(q({ q: " 50%_Ltd " }), ADMIN)
    const text = { contains: "50%_Ltd", mode: "insensitive" }
    expect(findManyArgs().where.AND[1]).toEqual({
      OR: [
        { name: text }, { designation: text }, { phone: text }, { email: text },
        { salesAccount: { name: text } },
      ],
    })
  })

  it("pages by 50 and sorts by account name", async () => {
    await listAllContacts(q({ page: "2", sort: "account", dir: "desc" }), ADMIN)
    expect(findManyArgs()).toMatchObject({ skip: 50, take: 50, orderBy: [{ salesAccount: { name: "desc" } }, { id: "asc" }] })
  })

  it("answers rows with the account, and the total for paging", async () => {
    vi.mocked(prisma.salesContact.count).mockResolvedValue(73)
    const page = await listAllContacts(q(), ADMIN)
    expect(page).toEqual({
      rows: [{
        id: "c-1", name: "Karim Ahmed", designation: "IT Manager", phone: "01700000000", email: "karim@alpha.com",
        status: "VERIFIED", isPrimary: true, accountId: "acc-1", accountName: "Alpha Ltd",
      }],
      total: 73, page: 1, pageSize: 50,
    })
  })

  it("refuses a page below 1 and an unknown sort", () => {
    expect(listContactsQuerySchema.safeParse({ page: "0" }).success).toBe(false)
    expect(listContactsQuerySchema.safeParse({ sort: "salary" }).success).toBe(false)
  })

  it("downloads the same rows, with no paging, under the title Contacts", async () => {
    const spec = await buildContactsExportSpec(q({ q: "alpha", page: "3" }), USER)
    expect(findManyArgs().skip).toBeUndefined()
    expect(findManyArgs().where.AND[1].OR).toHaveLength(5)
    expect(spec.title).toBe("Contacts")
    expect(spec.rows).toEqual([["Karim Ahmed", "IT Manager", "01700000000", "karim@alpha.com", "Alpha Ltd", "Verified"]])
  })
})
