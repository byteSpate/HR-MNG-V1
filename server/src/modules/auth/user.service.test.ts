import { beforeEach, describe, expect, it, vi } from "vitest"

// `$transaction` runs its callback against this same object rather than a
// separate tx double, so an assertion on `prisma.user.update` reads the same
// whether the call sits inside a transaction or outside one.
vi.mock("../../config/prisma", () => {
  const client = {
    user: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    employee: { count: vi.fn() },
    $transaction: vi.fn(),
  }
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client))
  return { default: client }
})

vi.mock("./auth.utils", () => ({
  generateTemporaryPassword: vi.fn(() => "TempPass123"),
  hashPassword: vi.fn(async () => "hashed"),
}))

vi.mock("./auth.service", () => ({
  revokeAllUserTokens: vi.fn(async () => undefined),
}))

vi.mock("../event/event.emit", () => ({ emitEvent: vi.fn() }))

vi.mock("./mailer", () => ({ sendCredentialsEmail: vi.fn(() => Promise.resolve()) }))

import prisma from "../../config/prisma"
import { emitEvent } from "../event/event.emit"
import { revokeAllUserTokens } from "./auth.service"
import { sendCredentialsEmail } from "./mailer"
import { createUser, listUsers, setUserRole, setUserStatus } from "./user.service"

beforeEach(() => {
  vi.clearAllMocks()
})

const row = {
  id: "u-1",
  email: "hr@demo.com",
  role: "HR_ADMIN",
  isActive: true,
  mustChangePassword: false,
  createdAt: new Date("2026-01-05T00:00:00.000Z"),
  employee: null,
}

describe("listUsers", () => {
  it("returns accounts newest first", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([row] as never)

    const result = await listUsers()

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.email).toBe("hr@demo.com")
  })

  it("never selects passwordHash", async () => {
    // The rule this protects: a response shape built by spreading the row
    // would ship the hash. It must be an explicit select.
    vi.mocked(prisma.user.findMany).mockResolvedValue([row] as never)

    await listUsers()

    const args = vi.mocked(prisma.user.findMany).mock.calls[0]![0] as {
      select: Record<string, unknown>
    }
    expect(args.select).toBeDefined()
    expect(args.select.passwordHash).toBeUndefined()
  })

  it("serialises createdAt to an ISO string and carries the employee link", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        ...row,
        employee: { id: "emp-1", employeeCode: "BS-EMP-00001", fullName: "Rita Sen" },
      },
    ] as never)

    const result = await listUsers()

    expect(result[0]!.createdAt).toBe("2026-01-05T00:00:00.000Z")
    expect(result[0]!.employee).toEqual({
      id: "emp-1",
      employeeCode: "BS-EMP-00001",
      fullName: "Rita Sen",
    })
  })
})

describe("createUser", () => {
  it("creates the account with a hashed temporary password and returns it once", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "u-9",
      email: "new@demo.com",
      role: "HR_ADMIN",
    } as never)

    const result = await createUser({ email: "new@demo.com", role: "HR_ADMIN" })

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@demo.com",
          role: "HR_ADMIN",
          passwordHash: "hashed",
          // The account is unusable until they set their own password.
          mustChangePassword: true,
        }),
      })
    )
    expect(result.temporaryPassword).toBe("TempPass123")
  })

  it("lowercases and trims the email before the uniqueness check", async () => {
    // Otherwise Bob@x.com and bob@x.com become two accounts, the exact
    // problem createStaffAccount normalises against.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "u-9",
      email: "bob@x.com",
      role: "HR_ADMIN",
    } as never)

    await createUser({ email: "  Bob@X.com  ", role: "HR_ADMIN" })

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "bob@x.com" },
      select: { id: true },
    })
  })

  it("409s on a duplicate email", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u-1" } as never)

    await expect(createUser({ email: "hr@demo.com", role: "HR_ADMIN" })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it("never returns passwordHash", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "u-9",
      email: "new@demo.com",
      role: "HR_ADMIN",
    } as never)

    const result = await createUser({ email: "new@demo.com", role: "HR_ADMIN" })

    expect(result).not.toHaveProperty("passwordHash")
  })

  it("emails the credentials with the email address as the identifier", async () => {
    // An administrative account signs in at /api/auth/login with its email,
    // not at /api/auth/staff-login with an employee code.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "u1",
      email: "finance@bytespate.com",
      role: "FINANCE_OFFICER",
    } as never)

    const result = await createUser({ email: "finance@bytespate.com", role: "FINANCE_OFFICER" })

    expect(sendCredentialsEmail).toHaveBeenCalledWith({
      to: "finance@bytespate.com",
      identifier: "finance@bytespate.com",
      identifierLabel: "Email address",
      temporaryPassword: result.temporaryPassword,
    })
  })

  it("still returns the temporary password, as the fallback for a dead mail server", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      role: "HR_ADMIN",
    } as never)
    vi.mocked(sendCredentialsEmail).mockRejectedValueOnce(new Error("smtp down"))

    const result = await createUser({ email: "a@b.com", role: "HR_ADMIN" })

    expect(result.temporaryPassword).toEqual(expect.any(String))
  })
})

describe("setUserStatus", () => {
  const target = {
    id: "u-2",
    email: "hr@demo.com",
    role: "HR_ADMIN",
    isActive: true,
    mustChangePassword: false,
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    employee: null,
  }

  it("deactivates another user and returns the updated account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(target as never)
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...target,
      isActive: false,
    } as never)

    const result = await setUserStatus("u-1", "u-2", false)

    expect(result.isActive).toBe(false)
  })

  it("refuses self-deactivation — it revokes the caller's own session", async () => {
    // updateUserStatusHandler calls revokeAllUserTokens on the target. Doing
    // that to yourself logs you out mid-request, and every route here is
    // SUPER_ADMIN-gated, so there is no way back in.
    await expect(setUserStatus("u-1", "u-1", false)).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("refuses deactivating the last ACTIVE super admin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...target,
      id: "u-3",
      role: "SUPER_ADMIN",
    } as never)
    vi.mocked(prisma.user.count).mockResolvedValue(1 as never)

    await expect(setUserStatus("u-1", "u-3", false)).rejects.toMatchObject({ statusCode: 409 })

    // Counts ACTIVE super admins, not all of them — three super admins where
    // two are already deactivated is still one away from lockout.
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: "SUPER_ADMIN", isActive: true },
    })
  })

  it("allows deactivating a super admin when another active one remains", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...target,
      id: "u-3",
      role: "SUPER_ADMIN",
    } as never)
    vi.mocked(prisma.user.count).mockResolvedValue(2 as never)
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...target,
      id: "u-3",
      role: "SUPER_ADMIN",
      isActive: false,
    } as never)

    await expect(setUserStatus("u-1", "u-3", false)).resolves.toBeDefined()
  })

  it("does not run the last-admin check when REACTIVATING", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...target,
      id: "u-3",
      role: "SUPER_ADMIN",
      isActive: false,
    } as never)
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...target,
      id: "u-3",
      role: "SUPER_ADMIN",
    } as never)

    await setUserStatus("u-1", "u-3", true)

    expect(prisma.user.count).not.toHaveBeenCalled()
  })

  it("404s for an unknown user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never)

    await expect(setUserStatus("u-1", "nope", false)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("setUserRole", () => {
  const adminTarget = {
    id: "u-2",
    email: "hr@demo.com",
    role: "HR_ADMIN",
    isActive: true,
    mustChangePassword: false,
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    employee: null,
  }

  const staffTarget = {
    ...adminTarget,
    id: "u-4",
    role: "REPORTING_MANAGER",
    employee: { id: "emp-4", employeeCode: "BS-MGR-00001", fullName: "Karim Rahman" },
  }

  it("promotes a staff account to an administrative role", async () => {
    // Allowed in this direction: they keep their Employee row, so payroll,
    // leave and attendance all keep resolving.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(staffTarget as never)
    vi.mocked(prisma.employee.count).mockResolvedValue(0 as never)
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...staffTarget,
      role: "HR_ADMIN",
    } as never)

    const result = await setUserRole("u-1", "u-4", "HR_ADMIN")

    expect(result.role).toBe("HR_ADMIN")
  })

  it("refuses an employee-tier role on an account with no Employee record", async () => {
    // employeeIdForUser would return null, and leave, insights, attendance
    // and the employee update path all resolve a caller through it.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(adminTarget as never)

    await expect(setUserRole("u-1", "u-2", "EMPLOYEE")).rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("refuses demoting a REPORTING_MANAGER who still has subordinates", async () => {
    // assertIsReportingManager gates on user.role, so their reports would
    // point at somebody the system no longer accepts as a manager.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(staffTarget as never)
    vi.mocked(prisma.employee.count).mockResolvedValue(3 as never)

    await expect(setUserRole("u-1", "u-4", "EMPLOYEE")).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.employee.count).toHaveBeenCalledWith({
      where: { reportingManagerId: "emp-4" },
    })
  })

  it("allows demoting a manager with no subordinates", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(staffTarget as never)
    vi.mocked(prisma.employee.count).mockResolvedValue(0 as never)
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...staffTarget,
      role: "EMPLOYEE",
    } as never)

    await expect(setUserRole("u-1", "u-4", "EMPLOYEE")).resolves.toBeDefined()
  })

  it("refuses demoting the last active super admin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...adminTarget,
      id: "u-3",
      role: "SUPER_ADMIN",
    } as never)
    vi.mocked(prisma.user.count).mockResolvedValue(1 as never)

    await expect(setUserRole("u-1", "u-3", "HR_ADMIN")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("is a no-op that still returns the account when the role is unchanged", async () => {
    // Not an error: the UI can submit the current value, and a 409 for
    // "changed nothing" would be a worse experience than a 200.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(adminTarget as never)

    const result = await setUserRole("u-1", "u-2", "HR_ADMIN")

    expect(result.role).toBe("HR_ADMIN")
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("404s for an unknown user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never)

    await expect(setUserRole("u-1", "nope", "HR_ADMIN")).rejects.toMatchObject({ statusCode: 404 })
  })

  describe("telling people about it", () => {
    const employeeTarget = {
      ...adminTarget,
      id: "u-5",
      role: "EMPLOYEE",
      employee: { id: "emp-5", employeeCode: "BS-EMP-00007", fullName: "Nadia Rahman" },
    }

    function promoteTo(role: string) {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(employeeTarget as never)
      vi.mocked(prisma.employee.count).mockResolvedValue(0 as never)
      vi.mocked(prisma.user.update).mockResolvedValue({ ...employeeTarget, role } as never)
    }

    it("announces the change to the person it happened to", async () => {
      // The whole point: without a subject audience the row exists and the
      // one person who most needs it never sees it.
      promoteTo("REPORTING_MANAGER")

      await setUserRole("u-1", "u-5", "REPORTING_MANAGER")

      expect(emitEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: "user.role_changed",
          severity: "SUCCESS",
          actorUserId: "u-1",
          entity: "USER",
          entityId: "u-5",
          subjectEmployeeId: "emp-5",
          title: "Nadia Rahman is now a Reporting Manager",
          meta: "Was Employee",
        })
      )
    })

    it("writes the event inside the transaction that changes the role", async () => {
      // A role change that lands without its announcement is the bug this
      // whole change exists to fix, so the two must not be separable.
      promoteTo("REPORTING_MANAGER")

      await setUserRole("u-1", "u-5", "REPORTING_MANAGER")

      expect(prisma.$transaction).toHaveBeenCalled()
      const tx = vi.mocked(emitEvent).mock.calls[0]![0]
      expect(tx).toBe(prisma)
    })

    it("names an administrative account by its email, having no employee record", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(adminTarget as never)
      vi.mocked(prisma.user.count).mockResolvedValue(3 as never)
      vi.mocked(prisma.user.update).mockResolvedValue({
        ...adminTarget,
        role: "SUPER_ADMIN",
      } as never)

      await setUserRole("u-1", "u-2", "SUPER_ADMIN")

      expect(emitEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: "hr@demo.com is now a Super Admin",
          subjectEmployeeId: null,
        })
      )
    })

    it("emits nothing when the role is unchanged", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(adminTarget as never)

      await setUserRole("u-1", "u-2", "HR_ADMIN")

      expect(emitEvent).not.toHaveBeenCalled()
    })

    it("emits nothing when the change is refused", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(staffTarget as never)
      vi.mocked(prisma.employee.count).mockResolvedValue(3 as never)

      await expect(setUserRole("u-1", "u-4", "EMPLOYEE")).rejects.toMatchObject({
        statusCode: 409,
      })
      expect(emitEvent).not.toHaveBeenCalled()
    })
  })

  describe("the session", () => {
    const managerTarget = {
      ...adminTarget,
      id: "u-4",
      role: "REPORTING_MANAGER",
      employee: { id: "emp-4", employeeCode: "BS-MGR-00001", fullName: "Karim Rahman" },
    }

    it("leaves a promotion's session alone", async () => {
      // Nothing was taken away, so there is nothing to cut short. The next
      // refresh re-reads the role from the row within the access token's life.
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...managerTarget,
        role: "EMPLOYEE",
      } as never)
      vi.mocked(prisma.employee.count).mockResolvedValue(0 as never)
      vi.mocked(prisma.user.update).mockResolvedValue(managerTarget as never)

      await setUserRole("u-1", "u-4", "REPORTING_MANAGER")

      expect(revokeAllUserTokens).not.toHaveBeenCalled()
    })

    it("signs out a demotion, so the lost privilege is lost now", async () => {
      // The access token carries the role for its full 15 minutes and the
      // refresh cookie keeps minting new ones — the same reasoning
      // setUserStatus already applies to a deactivation.
      vi.mocked(prisma.user.findUnique).mockResolvedValue(managerTarget as never)
      vi.mocked(prisma.employee.count).mockResolvedValue(0 as never)
      vi.mocked(prisma.user.update).mockResolvedValue({
        ...managerTarget,
        role: "EMPLOYEE",
      } as never)

      await setUserRole("u-1", "u-4", "EMPLOYEE")

      expect(revokeAllUserTokens).toHaveBeenCalledWith("u-4")
      expect(emitEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ severity: "WARNING" })
      )
    })

    it("signs out a sideways move between the two peer admin roles", async () => {
      // HR_ADMIN and FINANCE_OFFICER rank equally, so neither direction is a
      // promotion — and each one takes the other's endpoints away.
      vi.mocked(prisma.user.findUnique).mockResolvedValue(adminTarget as never)
      vi.mocked(prisma.user.update).mockResolvedValue({
        ...adminTarget,
        role: "FINANCE_OFFICER",
      } as never)

      await setUserRole("u-1", "u-2", "FINANCE_OFFICER")

      expect(revokeAllUserTokens).toHaveBeenCalledWith("u-2")
    })

    it("does not sign anyone out when the change is refused", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(adminTarget as never)

      await expect(setUserRole("u-1", "u-2", "EMPLOYEE")).rejects.toMatchObject({
        statusCode: 400,
      })
      expect(revokeAllUserTokens).not.toHaveBeenCalled()
    })
  })
})
