import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    salesAccount: { findUnique: vi.fn() },
    salesAccountAssignment: { create: vi.fn(), deleteMany: vi.fn() },
    salesCollaboratorRemoval: { findMany: vi.fn(), updateMany: vi.fn() },
    opportunity: { count: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./account.card", () => ({ visitingCardUrlOf: () => null }))

import prisma from "../../../config/prisma"
import { addCollaborator, listCollaboratorOptions, removeCollaboratorDirect } from "./collaborator.service"

const OWNER = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OTHER = { sub: "u-3", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "u-0", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any

const ACCOUNT = { id: "sa-1", name: "Rising Group", ownerEmployeeId: "emp-1", assignments: [{ employeeId: "emp-3" }] }
const PERSON = {
  id: "emp-4",
  fullName: "Nasir",
  employmentStatus: "ACTIVE",
  lastWorkingDay: null,
  user: { salesRole: "SALES_USER", isActive: true },
}

async function failureOf(run: () => Promise<unknown>) {
  try {
    await run()
    return null
  } catch (err) {
    return err as { statusCode?: number; message: string }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) => fn(prisma)) as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as never)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(ACCOUNT as never)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(PERSON as never)
})

describe("addCollaborator", () => {
  it("lets the Owner add an eligible person, and records it", async () => {
    const added = await addCollaborator("sa-1", { employeeId: "emp-4" }, OWNER)
    expect(added).toEqual({ id: "emp-4", fullName: "Nasir" })
    expect(prisma.salesAccountAssignment.create).toHaveBeenCalledWith({
      data: { salesAccountId: "sa-1", employeeId: "emp-4", assignedBy: "u-1" },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: "SALES_ACCOUNT_ASSIGNMENT", action: "ASSIGN", entityId: "sa-1" }),
    })
  })

  it("lets a Sales Admin add one", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as never)
    expect(await addCollaborator("sa-1", { employeeId: "emp-4" }, ADMIN)).toMatchObject({ id: "emp-4" })
  })

  it("refuses a collaborator who is not the Owner", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-3" } } as never)
    expect(await failureOf(() => addCollaborator("sa-1", { employeeId: "emp-4" }, OTHER))).toMatchObject({ statusCode: 403 })
    expect(prisma.salesAccountAssignment.create).not.toHaveBeenCalled()
  })

  it("answers 404 for a Sales Account that does not exist", async () => {
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(null as never)
    expect(await failureOf(() => addCollaborator("sa-9", { employeeId: "emp-4" }, OWNER))).toMatchObject({ statusCode: 404 })
  })

  it("refuses someone who is already a collaborator", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...PERSON, id: "emp-3", fullName: "Rahim" } as never)
    const err = await failureOf(() => addCollaborator("sa-1", { employeeId: "emp-3" }, OWNER))
    expect(err).toMatchObject({ statusCode: 409 })
    expect(err?.message).toContain("Rahim")
  })

  it("refuses the Owner being added to their own Sales Account", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...PERSON, id: "emp-1", fullName: "Karim" } as never)
    expect(await failureOf(() => addCollaborator("sa-1", { employeeId: "emp-1" }, OWNER))).toMatchObject({ statusCode: 400 })
  })

  it("refuses a person who has left the company", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      ...PERSON,
      employmentStatus: "RESIGNED",
      lastWorkingDay: new Date("2020-01-01"),
    } as never)
    const err = await failureOf(() => addCollaborator("sa-1", { employeeId: "emp-4" }, OWNER))
    expect(err).toMatchObject({ statusCode: 400 })
    expect(err?.message).toContain("left the company")
  })

  it("refuses a person with no Sales Hub access, a Sales Admin, and a disabled login", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...PERSON, user: { salesRole: null, isActive: true } } as never)
    expect(await failureOf(() => addCollaborator("sa-1", { employeeId: "emp-4" }, OWNER))).toMatchObject({ statusCode: 400 })
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...PERSON, user: { salesRole: "SALES_ADMIN", isActive: true } } as never)
    expect(await failureOf(() => addCollaborator("sa-1", { employeeId: "emp-4" }, OWNER))).toMatchObject({ statusCode: 400 })
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ ...PERSON, user: { salesRole: "SALES_USER", isActive: false } } as never)
    expect(await failureOf(() => addCollaborator("sa-1", { employeeId: "emp-4" }, OWNER))).toMatchObject({ statusCode: 400 })
  })
})

describe("listCollaboratorOptions", () => {
  it("lists eligible people who are not already on the Sales Account", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-1", fullName: "Karim", designation: "Manager", employmentStatus: "ACTIVE", lastWorkingDay: null },
      { id: "emp-3", fullName: "Rahim", designation: "Engineer", employmentStatus: "ACTIVE", lastWorkingDay: null },
      { id: "emp-4", fullName: "Nasir", designation: "Engineer", employmentStatus: "ACTIVE", lastWorkingDay: null },
    ] as never)
    const options = await listCollaboratorOptions("sa-1", OWNER)
    expect(options.map((o) => o.id)).toEqual(["emp-4"])
  })

  it("refuses a collaborator who is not the Owner", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-3" } } as never)
    expect(await failureOf(() => listCollaboratorOptions("sa-1", OTHER))).toMatchObject({ statusCode: 403 })
  })
})

describe("removeCollaboratorDirect", () => {
  beforeEach(() => {
    vi.mocked(prisma.opportunity.count).mockResolvedValue(0 as never)
    vi.mocked(prisma.salesCollaboratorRemoval.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-3", fullName: "Rahim" } as never)
  })

  it("lets a Sales Admin remove a collaborator, with no request", async () => {
    await removeCollaboratorDirect("sa-1", "emp-3", ADMIN)
    expect(prisma.salesAccountAssignment.deleteMany).toHaveBeenCalledWith({
      where: { salesAccountId: "sa-1", employeeId: "emp-3" },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: "SALES_ACCOUNT_ASSIGNMENT", action: "DELETE" }),
    })
  })

  it("refuses a Sales User, even the Owner: they must ask", async () => {
    expect(await failureOf(() => removeCollaboratorDirect("sa-1", "emp-3", OWNER))).toMatchObject({ statusCode: 403 })
    expect(prisma.salesAccountAssignment.deleteMany).not.toHaveBeenCalled()
  })

  it("refuses to remove someone who is not a collaborator", async () => {
    expect(await failureOf(() => removeCollaboratorDirect("sa-1", "emp-9", ADMIN))).toMatchObject({ statusCode: 404 })
  })

  it("refuses while the person owns an Ongoing Opportunity on the Sales Account", async () => {
    vi.mocked(prisma.opportunity.count).mockResolvedValue(1 as never)
    expect(await failureOf(() => removeCollaboratorDirect("sa-1", "emp-3", ADMIN))).toMatchObject({ statusCode: 409 })
    expect(prisma.salesAccountAssignment.deleteMany).not.toHaveBeenCalled()
  })

  it("closes a pending request for that person as approved", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.findMany).mockResolvedValue([{ id: "r-1" }] as never)
    await removeCollaboratorDirect("sa-1", "emp-3", ADMIN)
    expect(prisma.salesCollaboratorRemoval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) })
    )
  })
})
