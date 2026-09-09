import { describe, expect, it, vi } from "vitest"

vi.mock("../media/media.service", () => ({
  signedAvatarUrl: vi.fn(() => "https://res/avatar.jpg"),
}))
vi.mock("../media/media.provider", () => ({
  isMediaConfigured: () => true,
}))

import { visibilityTierFor, writableFieldsFor } from "./employee.access"
import { projectEmployee } from "./employee.access"
import type { AccessTokenPayload } from "../auth/auth.types"

function viewer(role: AccessTokenPayload["role"], sub = "u-viewer"): AccessTokenPayload {
  return { sub, role, email: "v@b.com", mustChangePassword: false, salesRole: null }
}

const subject = { userId: "u-subject", reportingManagerId: "emp-manager" }

describe("visibilityTierFor", () => {
  it("returns SELF when the viewer is the subject", () => {
    expect(visibilityTierFor(viewer("EMPLOYEE", "u-subject"), subject, "emp-subject")).toBe("SELF")
  })

  it("returns SELF for a reporting manager viewing THEMSELVES, not MANAGER", () => {
    // Order matters: SELF is checked first, so a manager looking at their own
    // record gets the full self view rather than the narrower manager one.
    const own = { userId: "u-mgr", reportingManagerId: null }
    expect(visibilityTierFor(viewer("REPORTING_MANAGER", "u-mgr"), own, "emp-manager")).toBe("SELF")
  })

  it("returns FULL for SUPER_ADMIN and HR_ADMIN", () => {
    expect(visibilityTierFor(viewer("SUPER_ADMIN"), subject, null)).toBe("FULL")
    expect(visibilityTierFor(viewer("HR_ADMIN"), subject, null)).toBe("FULL")
  })

  it("returns FINANCE for a finance officer", () => {
    expect(visibilityTierFor(viewer("FINANCE_OFFICER"), subject, null)).toBe("FINANCE")
  })

  it("returns MANAGER for the subject's own reporting manager", () => {
    expect(visibilityTierFor(viewer("REPORTING_MANAGER"), subject, "emp-manager")).toBe("MANAGER")
  })

  it("returns COLLEAGUE for a DIFFERENT manager", () => {
    // The case a client-side rule gets wrong: a manager is not a manager of
    // everybody.
    expect(visibilityTierFor(viewer("REPORTING_MANAGER"), subject, "emp-other")).toBe("COLLEAGUE")
  })

  it("returns COLLEAGUE for an unrelated employee", () => {
    expect(visibilityTierFor(viewer("EMPLOYEE"), subject, "emp-other")).toBe("COLLEAGUE")
  })

  it("returns COLLEAGUE for a manager when the subject reports to nobody", () => {
    const orphan = { userId: "u-x", reportingManagerId: null }
    expect(visibilityTierFor(viewer("REPORTING_MANAGER"), orphan, "emp-manager")).toBe("COLLEAGUE")
  })
})

describe("writableFieldsFor", () => {
  it("gives SELF exactly the eight self-editable text fields", () => {
    // profilePicture is NOT here: it goes through PATCH /:id/avatar, because
    // it takes a Cloudinary publicId that must be verified first. nationalId
    // is NOT here either — that field goes through a request-and-approve
    // flow (EmployeeChangeRequest), never a direct write, even for SELF.
    //
    // permanentAddress moved here on 2026-09-02; dateOfBirth and gender
    // moved here on 2026-09-03. All three were originally HR-only.
    expect([...writableFieldsFor("SELF")].sort()).toEqual([
      "bloodGroup",
      "dateOfBirth",
      "emergencyContact",
      "gender",
      "maritalStatus",
      "permanentAddress",
      "phone",
      "presentAddress",
    ])
  })

  it("gives FULL the self fields plus the HR-only ones", () => {
    // The exact set, not `.has()` spot-checks: a stray field added to FULL_SET
    // by accident is precisely what this needs to catch, and a presence-only
    // assertion never would.
    expect([...writableFieldsFor("FULL")].sort()).toEqual([
      "bankAccountNumber",
      "bankName",
      "bankRoutingNumber",
      "bloodGroup",
      "dateOfBirth",
      "departmentId",
      "designation",
      "deviceUserId",
      "emergencyContact",
      "employmentType",
      "fullName",
      "gender",
      "joiningDate",
      "maritalStatus",
      "nationalId",
      "officeLocation",
      "permanentAddress",
      "phone",
      "presentAddress",
      "reportingManagerId",
      "shiftId",
    ])
  })

  it("never lets anyone write an immutable or separately-owned field", () => {
    for (const tier of ["SELF", "FULL", "FINANCE", "MANAGER", "COLLEAGUE"] as const) {
      const fields = writableFieldsFor(tier)
      for (const forbidden of [
        "id",
        "userId",
        "employeeCode",
        "role",
        "email",
        "salaryStructureId",
        "lastWorkingDay",
        "exitReason",
        "exitNote",
        "employmentStatus",
        "profilePicture",
      ]) {
        expect(fields.has(forbidden)).toBe(false)
      }
    }
  })

  it("gives FINANCE, MANAGER and COLLEAGUE empty write sets", () => {
    // Finance reads bank details to chase them; it does not author them, for
    // the same separation-of-duty reason setSalaryStructure documents.
    expect(writableFieldsFor("FINANCE").size).toBe(0)
    expect(writableFieldsFor("MANAGER").size).toBe(0)
    expect(writableFieldsFor("COLLEAGUE").size).toBe(0)
  })
})

const row = {
  id: "emp-1",
  userId: "u-1",
  employeeCode: "BS-EMP-00001",
  fullName: "Rita Sen",
  profilePicture: null,
  dateOfBirth: new Date("1995-04-02T00:00:00.000Z"),
  gender: "F",
  nationalId: "1234567890",
  bloodGroup: "O+",
  maritalStatus: "Single",
  phone: "+8801700000000",
  presentAddress: "Dhanmondi",
  permanentAddress: "Sylhet",
  emergencyContact: "Mother +8801711111111",
  designation: "Analyst",
  departmentId: "dept-1",
  department: { id: "dept-1", name: "Finance" },
  reportingManagerId: "emp-mgr",
  reportingManager: { id: "emp-mgr", fullName: "Karim Rahman" },
  employmentType: "FULL_TIME",
  employmentStatus: "ACTIVE",
  joiningDate: new Date("2025-01-06T00:00:00.000Z"),
  officeLocation: "Dhaka HQ",
  shiftId: "shift-1",
  shift: { id: "shift-1", name: "General" },
  deviceUserId: "77",
  bankAccountNumber: "0011223344",
  bankName: "BRAC Bank",
  bankRoutingNumber: "060270425",
  salaryStructureId: "ss-1",
  salaryStructure: { id: "ss-1", name: "Band B", currency: "BDT" },
  lastWorkingDay: null,
  exitReason: null,
  exitNote: null,
  user: { email: "rita@demo.com", isActive: true, salesRole: null },
} as any

describe("projectEmployee", () => {
  it("gives COLLEAGUE work identity and NOTHING else", () => {
    const view = projectEmployee(row, "COLLEAGUE")
    // Asserted key by key. A test that only checks the allowed keys are
    // present passes happily while leaking every other field.
    expect(Object.keys(view).sort()).toEqual(["editableFields", "id", "work"])
    expect(view.work.fullName).toBe("Rita Sen")
    expect(view.work.phone).toBe("+8801700000000")
  })

  it("gives MANAGER work identity and employment, but no payroll and no personal", () => {
    const view = projectEmployee(row, "MANAGER")
    expect(Object.keys(view).sort()).toEqual([
      "editableFields",
      "employment",
      "id",
      "work",
    ])
    expect(view.employment?.employeeCode).toBe("BS-EMP-00001")
  })

  it("gives FINANCE employment, payroll and exit, but no personal and no contact", () => {
    const view = projectEmployee(row, "FINANCE")
    expect(Object.keys(view).sort()).toEqual([
      "editableFields",
      "employment",
      "exit",
      "id",
      "payroll",
      "work",
    ])
    expect(view.payroll?.bankRoutingNumber).toBe("060270425")
  })

  it("never leaks nationalId to FINANCE, MANAGER or COLLEAGUE", () => {
    for (const tier of ["FINANCE", "MANAGER", "COLLEAGUE"] as const) {
      expect(JSON.stringify(projectEmployee(row, tier))).not.toContain("1234567890")
    }
  })

  // Scans the serialised payload for the VALUE, so it catches a field misfiled
  // into a group the tier is allowed to see — which asserting on top-level keys
  // alone cannot. Every value below is unique to one field in `row`.
  it.each([
    ["nationalId", "1234567890"],
    ["dateOfBirth", "1995-04-02"],
    ["presentAddress", "Dhanmondi"],
    ["permanentAddress", "Sylhet"],
    ["emergencyContact", "Mother +8801711111111"],
  ])("never leaks %s to MANAGER or COLLEAGUE", (_field, value) => {
    for (const tier of ["MANAGER", "COLLEAGUE"] as const) {
      expect(JSON.stringify(projectEmployee(row, tier))).not.toContain(value)
    }
  })

  it.each([
    ["bankAccountNumber", "0011223344"],
    ["bankRoutingNumber", "060270425"],
    ["bankName", "BRAC Bank"],
  ])("never leaks %s to MANAGER or COLLEAGUE", (_field, value) => {
    // Finance is deliberately excluded: chasing bank details is its job.
    for (const tier of ["MANAGER", "COLLEAGUE"] as const) {
      expect(JSON.stringify(projectEmployee(row, tier))).not.toContain(value)
    }
  })

  // COLLEAGUE, MANAGER and FINANCE each pin an exact key set above; without
  // these two, SELF and FULL pin none, so a group dropped from either branch
  // would go unnoticed.
  it("gives SELF every group except documents and blockers", () => {
    expect(Object.keys(projectEmployee(row, "SELF")).sort()).toEqual([
      "contact",
      "editableFields",
      "employment",
      "exit",
      "id",
      "payroll",
      "personal",
      "work",
    ])
  })

  it("gives FULL the same groups as SELF", () => {
    expect(Object.keys(projectEmployee(row, "FULL")).sort()).toEqual(
      Object.keys(projectEmployee(row, "SELF")).sort()
    )
  })

  it("hides deviceUserId even from SELF", () => {
    // A biometric enrolment id only HR configures. Showing it to the employee
    // invites support questions about a field they cannot act on.
    const view = projectEmployee(row, "SELF")
    expect(view.employment?.deviceUserId).toBeUndefined()
    expect(projectEmployee(row, "FULL").employment?.deviceUserId).toBe("77")
  })

  it("gives SELF everything except deviceUserId", () => {
    const view = projectEmployee(row, "SELF")
    expect(view.personal?.nationalId).toBe("1234567890")
    expect(view.contact?.permanentAddress).toBe("Sylhet")
    expect(view.payroll?.bankName).toBe("BRAC Bank")
  })

  it("returns exit as null when the employee has not left", () => {
    expect(projectEmployee(row, "FULL").exit).toBeNull()
  })

  it("returns exit details when they exist", () => {
    const leaver = {
      ...row,
      lastWorkingDay: new Date("2026-09-30T00:00:00.000Z"),
      exitReason: "RESIGNATION",
      exitNote: "60 days waived",
    }
    expect(projectEmployee(leaver, "FULL").exit).toEqual({
      lastWorkingDay: "2026-09-30",
      exitReason: "RESIGNATION",
      exitNote: "60 days waived",
    })
  })

  it("carries editableFields so the client renders controls without knowing a rule", () => {
    expect(projectEmployee(row, "SELF").editableFields.sort()).toEqual([
      "bloodGroup",
      "dateOfBirth",
      "emergencyContact",
      "gender",
      "maritalStatus",
      "permanentAddress",
      "phone",
      "presentAddress",
    ])
    expect(projectEmployee(row, "FINANCE").editableFields).toEqual([])
  })

  it("only includes documents and blockers when they are passed", () => {
    const bare = projectEmployee(row, "FULL")
    expect(bare.documents).toBeUndefined()
    expect(bare.blockers).toBeUndefined()

    const rich = projectEmployee(row, "FULL", [], [{ field: "x", blocks: "y" }])
    expect(rich.documents).toEqual([])
    expect(rich.blockers).toHaveLength(1)
  })
})

describe("projectEmployee — accountActive", () => {
  it("reports the login state for a FULL viewer", () => {
    const view = projectEmployee(row, "FULL")
    expect(view.employment?.accountActive).toBe(true)
  })

  it("reports a DISABLED login as false, independently of employmentStatus", () => {
    // The bug: these are separate fields with separate writers. Deactivating
    // a login never touches employmentStatus, so a locked-out employee still
    // read as ACTIVE everywhere in the UI.
    const disabled = { ...row, user: { email: "rita@demo.com", isActive: false } } as never
    const view = projectEmployee(disabled, "FULL")

    expect(view.employment?.employmentStatus).toBe("ACTIVE")
    expect(view.employment?.accountActive).toBe(false)
  })

  it("is absent for COLLEAGUE, which has no employment group at all", () => {
    // Who is locked out is not directory information.
    const view = projectEmployee(row, "COLLEAGUE")
    expect(view.employment).toBeUndefined()
  })

  it("is present for FINANCE and MANAGER, which do see employment", () => {
    expect(projectEmployee(row, "FINANCE").employment?.accountActive).toBe(true)
    expect(projectEmployee(row, "MANAGER").employment?.accountActive).toBe(true)
  })
})

describe("projectEmployee — salesRole", () => {
  it("reports null for an employee with no Sales Hub access", () => {
    expect(projectEmployee(row, "FULL").employment?.salesRole).toBeNull()
  })

  it("reports the granted role", () => {
    const granted = { ...row, user: { email: "rita@demo.com", isActive: true, salesRole: "SALES_USER" } } as never
    expect(projectEmployee(granted, "FULL").employment?.salesRole).toBe("SALES_USER")
  })

  it("is absent for COLLEAGUE, same as the rest of the employment group", () => {
    expect(projectEmployee(row, "COLLEAGUE").employment).toBeUndefined()
  })
})
