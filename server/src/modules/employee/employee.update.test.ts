import { beforeEach, describe, expect, it, vi } from "vitest"

const txMock = {
  employee: { update: vi.fn() },
  auditLog: { create: vi.fn() },
  event: { create: vi.fn() },
}

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn((fn: any) => fn(txMock)),
    employee: { findUnique: vi.fn() },
    department: { findUnique: vi.fn() },
    shift: { findUnique: vi.fn() },
    document: { findMany: vi.fn() },
  },
}))

vi.mock("../media/media.service", () => ({ signedAvatarUrl: vi.fn(() => "https://res/a.jpg") }))
vi.mock("../media/media.provider", () => ({ isMediaConfigured: () => false }))
vi.mock("../event/event.emit", () => ({ emitEvent: vi.fn() }))

import prisma from "../../config/prisma"
import { emitEvent } from "../event/event.emit"
import { updateEmployee } from "./employee.update"

const existing = {
  id: "emp-1",
  userId: "u-1",
  employeeCode: "BS-EMP-00001",
  fullName: "Rita Sen",
  profilePicture: null,
  dateOfBirth: null,
  gender: null,
  nationalId: null,
  bloodGroup: "O+",
  maritalStatus: null,
  phone: "+8801700000000",
  presentAddress: null,
  permanentAddress: null,
  emergencyContact: null,
  designation: "Analyst",
  departmentId: "dept-1",
  department: { id: "dept-1", name: "Finance" },
  reportingManagerId: null,
  reportingManager: null,
  employmentType: "FULL_TIME",
  employmentStatus: "ACTIVE",
  joiningDate: new Date("2025-01-06T00:00:00.000Z"),
  officeLocation: null,
  shiftId: null,
  shift: null,
  deviceUserId: null,
  bankAccountNumber: null,
  bankName: null,
  bankRoutingNumber: null,
  salaryStructureId: null,
  salaryStructure: null,
  lastWorkingDay: null,
  exitReason: null,
  exitNote: null,
  user: { email: "rita@demo.com" },
} as any

function viewer(role: any, sub: string) {
  return { sub, role, email: "v@b.com", mustChangePassword: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.employee.findUnique).mockResolvedValue(existing)
  vi.mocked(prisma.document.findMany).mockResolvedValue([])
  txMock.employee.update.mockResolvedValue(existing)
})

describe("updateEmployee authorisation", () => {
  it("lets SELF change their own phone", async () => {
    await expect(
      updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", { phone: "+8801800000000" })
    ).resolves.toBeDefined()
  })

  it("REJECTS a disallowed field with 403 rather than dropping it", async () => {
    // Silently ignoring it returns 200, the UI shows success, and the value
    // did not change — the worst of the three options.
    await expect(
      updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", { bankAccountNumber: "999" })
    ).rejects.toThrowError("You cannot change: bankAccountNumber")
  })

  it("names every forbidden field, not just the first", async () => {
    await expect(
      updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", {
        nationalId: "1",
        dateOfBirth: "2000-01-01",
      })
    ).rejects.toThrowError("You cannot change: nationalId, dateOfBirth")
  })

  it("refuses FINANCE any write at all", async () => {
    await expect(
      updateEmployee(viewer("FINANCE_OFFICER", "u-f"), "emp-1", { phone: "+880" })
    ).rejects.toThrowError("You cannot change: phone")
  })

  it("lets FULL change a bank field", async () => {
    await expect(
      updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", { bankRoutingNumber: "060270425" })
    ).resolves.toBeDefined()
  })
})

describe("updateEmployee semantics", () => {
  it("clears a field given null", async () => {
    await updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", { bloodGroup: null })
    expect(txMock.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bloodGroup: null }) })
    )
  })

  it("leaves an absent key alone", async () => {
    await updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", { phone: "+8801800000000" })
    const [{ data }] = txMock.employee.update.mock.calls[0]
    expect("bloodGroup" in data).toBe(false)
  })

  it("converts a YYYY-MM-DD date to UTC midnight", async () => {
    await updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", { dateOfBirth: "1995-04-02" })
    const [{ data }] = txMock.employee.update.mock.calls[0]
    expect(data.dateOfBirth.toISOString()).toBe("1995-04-02T00:00:00.000Z")
  })

  it("rejects a future date of birth", async () => {
    await expect(
      updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", { dateOfBirth: "2999-01-01" })
    ).rejects.toThrowError("Date of birth must be in the past")
  })

  it("rejects an unknown department", async () => {
    vi.mocked(prisma.department.findUnique).mockResolvedValue(null)
    await expect(
      updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", { departmentId: "nope" })
    ).rejects.toThrowError("Department not found")
  })

  it("rejects an employee as their own reporting manager", async () => {
    await expect(
      updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", { reportingManagerId: "emp-1" })
    ).rejects.toThrowError("cannot report to themselves")
  })

  it("rejects a joining date after an existing last working day", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      ...existing,
      lastWorkingDay: new Date("2026-03-31T00:00:00.000Z"),
    })
    await expect(
      updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", { joiningDate: "2026-06-01" })
    ).rejects.toThrowError("cannot start after their last working day")
  })

  it("404s an unknown employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    await expect(
      updateEmployee(viewer("HR_ADMIN", "u-hr"), "nope", { phone: "+880" })
    ).rejects.toThrowError("Employee not found")
  })
})

describe("updateEmployee audit and events", () => {
  it("records ONLY the fields that actually changed", async () => {
    // The log answers "what changed", not "what was sent". A field submitted
    // with its existing value is not a change.
    await updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", {
      phone: "+8801800000000",
      bloodGroup: "O+", // unchanged
    })
    const [{ data }] = txMock.auditLog.create.mock.calls[0]
    expect(data.entity).toBe("EMPLOYEE_PROFILE")
    expect(data.before).toEqual({ phone: "+8801700000000" })
    expect(data.after).toEqual({ phone: "+8801800000000" })
  })

  it("writes no audit row when nothing actually changed", async () => {
    await updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", { bloodGroup: "O+" })
    expect(txMock.auditLog.create).not.toHaveBeenCalled()
  })

  it("emits employee.bank_changed on a bank edit", async () => {
    await updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", { bankAccountNumber: "0011" })
    expect(emitEvent).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ type: "employee.bank_changed", severity: "WARNING" })
    )
  })

  it("never puts bank VALUES in the event", async () => {
    // The event says which fields changed so HR can look; it is not a place to
    // publish an account number.
    await updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", { bankAccountNumber: "0011223344" })
    const [, event] = vi.mocked(emitEvent).mock.calls[0]
    expect(JSON.stringify(event)).not.toContain("0011223344")
  })

  it("does NOT emit an event on a phone change", async () => {
    await updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", { phone: "+8801800000000" })
    expect(emitEvent).not.toHaveBeenCalled()
  })
})

describe("updateEmployee response shape", () => {
  // GET and PATCH must return the same projection for the same tier: a
  // client that replaces its cached EmployeeView with a "returns the updated
  // resource" PATCH response should not watch documents/blockers vanish.
  it("includes documents and blockers on a SELF edit, matching getEmployee", async () => {
    const view = await updateEmployee(viewer("EMPLOYEE", "u-1"), "emp-1", {
      phone: "+8801800000000",
    })
    expect(view.documents).toBeDefined()
    expect(view.blockers).toBeDefined()
  })

  it("includes documents and blockers on a FULL edit, matching getEmployee", async () => {
    const view = await updateEmployee(viewer("HR_ADMIN", "u-hr"), "emp-1", {
      bankRoutingNumber: "060270425",
    })
    expect(view.documents).toBeDefined()
    expect(view.blockers).toBeDefined()
  })

  it("omits documents and blockers for a non-SELF/FULL tier, matching getEmployee", async () => {
    // COLLEAGUE has no writable fields, so an empty body is the only body a
    // COLLEAGUE-tier caller can submit without a 403 — this exercises the
    // no-op return path at that tier.
    const view = await updateEmployee(viewer("EMPLOYEE", "u-2"), "emp-1", {})
    expect(view.documents).toBeUndefined()
    expect(view.blockers).toBeUndefined()
  })
})
