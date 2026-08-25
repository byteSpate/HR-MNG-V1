import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    employee: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { activeSuperAdminEmails, recipientsForLeaveRequest } from "./notification.recipients"

const mockedPrisma = prisma as unknown as {
  employee: { findUnique: ReturnType<typeof vi.fn> }
  user: { findMany: ReturnType<typeof vi.fn> }
}

beforeEach(() => vi.clearAllMocks())

describe("recipientsForLeaveRequest", () => {
  it("returns the reporting manager's email", async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({
      reportingManager: { user: { email: "mgr@b.com", isActive: true } },
    })

    expect(await recipientsForLeaveRequest("e1")).toEqual(["mgr@b.com"])
  })

  it("falls back to the HR Admins when there is no reporting manager", async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({ reportingManager: null })
    mockedPrisma.user.findMany.mockResolvedValue([{ email: "hr1@b.com" }, { email: "hr2@b.com" }])

    expect(await recipientsForLeaveRequest("e1")).toEqual(["hr1@b.com", "hr2@b.com"])
  })

  it("falls back when the manager's account is deactivated", async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({
      reportingManager: { user: { email: "mgr@b.com", isActive: false } },
    })
    mockedPrisma.user.findMany.mockResolvedValue([{ email: "hr1@b.com" }])

    expect(await recipientsForLeaveRequest("e1")).toEqual(["hr1@b.com"])
  })

  it("returns an empty list rather than throwing when nobody can be notified", async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({ reportingManager: null })
    mockedPrisma.user.findMany.mockResolvedValue([])

    expect(await recipientsForLeaveRequest("e1")).toEqual([])
  })
})

describe("activeSuperAdminEmails", () => {
  it("returns only active Super Admins", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ email: "sa@b.com" }])

    expect(await activeSuperAdminEmails()).toEqual(["sa@b.com"])
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      where: { role: "SUPER_ADMIN", isActive: true },
      select: { email: true },
    })
  })
})
