/**
 * The single implementation of both employee access matrices.
 *
 * Everything that reads or writes an employee goes through this file: the list
 * endpoint, the detail endpoint, the edit endpoint, My Profile, the details
 * page, the directory and the document endpoints. The alternative — role
 * checks written at each call site — is how two copies of the same rule end up
 * disagreeing about whether Finance may see a national ID.
 */

import type { AccessTokenPayload } from "../auth/auth.types"
import type { Prisma } from "../../generated/prisma/client"
import { signedAvatarUrl } from "../media/media.service"
import { isMediaConfigured } from "../media/media.provider"
import { unpackAvatar } from "./employee.media"
import type { DocumentItem } from "./employee.media"
import type { Blocker, EmployeeView } from "./employee.types"

export type Tier = "SELF" | "FULL" | "FINANCE" | "MANAGER" | "COLLEAGUE"

export interface TierSubject {
  userId: string
  reportingManagerId: string | null
}

/**
 * Resolved in order; the first match wins.
 *
 * SELF is checked first so a reporting manager viewing their own record gets
 * the full self view rather than the narrower MANAGER one.
 *
 * COLLEAGUE is the floor, not a denial: every authenticated user may see every
 * other user's work identity. That is what a staff directory is.
 */
export function visibilityTierFor(
  viewer: AccessTokenPayload,
  subject: TierSubject,
  viewerEmployeeId: string | null
): Tier {
  if (subject.userId === viewer.sub) return "SELF"
  if (viewer.role === "SUPER_ADMIN" || viewer.role === "HR_ADMIN") return "FULL"
  if (viewer.role === "FINANCE_OFFICER") return "FINANCE"
  if (
    viewer.role === "REPORTING_MANAGER" &&
    viewerEmployeeId !== null &&
    subject.reportingManagerId === viewerEmployeeId
  ) {
    return "MANAGER"
  }
  return "COLLEAGUE"
}

/**
 * The facts the employee is the authority on.
 *
 * `permanentAddress` moved here from HR-only on 2026-09-02, and
 * `dateOfBirth`/`gender` moved here on 2026-09-03 — all three were
 * originally excluded on document-proof reasoning that the user decided
 * did not need to apply.
 *
 * `nationalId` is deliberately still absent, and unlike the other three it
 * never moves here: it goes through `EmployeeChangeRequest` instead, a
 * request an employee submits and HR decides. See
 * `employee.changerequest.ts`.
 *
 * Bank fields are absent. Self-service bank editing is the classic
 * payroll-diversion vector — a compromised login redirects that person's
 * salary and the change looks legitimate because it came from the right
 * account.
 */
export const SELF_EDITABLE_FIELDS = [
  "phone",
  "presentAddress",
  "permanentAddress",
  "dateOfBirth",
  "gender",
  "emergencyContact",
  "maritalStatus",
  "bloodGroup",
] as const

export const HR_ONLY_EDITABLE_FIELDS = [
  "fullName",
  "nationalId",
  "designation",
  "departmentId",
  "reportingManagerId",
  "employmentType",
  "joiningDate",
  "officeLocation",
  "shiftId",
  "deviceUserId",
  "bankAccountNumber",
  "bankName",
  "bankRoutingNumber",
] as const

const SELF_SET: ReadonlySet<string> = new Set(SELF_EDITABLE_FIELDS)
const FULL_SET: ReadonlySet<string> = new Set([
  ...SELF_EDITABLE_FIELDS,
  ...HR_ONLY_EDITABLE_FIELDS,
])
const EMPTY_SET: ReadonlySet<string> = new Set()

export function writableFieldsFor(tier: Tier): ReadonlySet<string> {
  if (tier === "FULL") return FULL_SET
  if (tier === "SELF") return SELF_SET
  return EMPTY_SET
}

/** The `include` every employee read uses, so every projection has what it needs. */
export const EMPLOYEE_INCLUDE = {
  department: { select: { id: true, name: true } },
  reportingManager: { select: { id: true, fullName: true } },
  shift: { select: { id: true, name: true } },
  salaryStructure: { select: { id: true, name: true, currency: true } },
  user: { select: { email: true, isActive: true } },
} satisfies Prisma.EmployeeInclude

export type EmployeeWithRelations = Prisma.EmployeeGetPayload<{
  include: typeof EMPLOYEE_INCLUDE
}>

/** Date-only columns are stored at UTC midnight; the wire format is YYYY-MM-DD. */
function dateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10)
}

/**
 * Turns a stored `publicId#version` into a signed delivery URL.
 *
 * Returns null when media is unconfigured rather than throwing: an
 * unconfigured Cloudinary should degrade an avatar to initials, not make every
 * employee read fail.
 */
function avatarUrlFor(profilePicture: string | null): string | null {
  if (profilePicture === null || !isMediaConfigured()) return null
  const { publicId, version } = unpackAvatar(profilePicture)
  return signedAvatarUrl(publicId, version)
}

export function projectEmployee(
  employee: EmployeeWithRelations,
  tier: Tier,
  documents?: DocumentItem[],
  blockers?: Blocker[]
): EmployeeView {
  const view: EmployeeView = {
    id: employee.id,
    work: {
      fullName: employee.fullName,
      designation: employee.designation,
      department: { id: employee.department.id, name: employee.department.name },
      reportingManager: employee.reportingManager
        ? { id: employee.reportingManager.id, fullName: employee.reportingManager.fullName }
        : null,
      email: employee.user.email,
      phone: employee.phone,
      avatarUrl: avatarUrlFor(employee.profilePicture),
    },
    editableFields: [...writableFieldsFor(tier)],
  }

  const canSeePersonal = tier === "SELF" || tier === "FULL"
  const canSeeEmployment = tier !== "COLLEAGUE"
  const canSeeMoney = tier === "SELF" || tier === "FULL" || tier === "FINANCE"

  if (canSeePersonal) {
    view.personal = {
      dateOfBirth: dateOnly(employee.dateOfBirth),
      gender: employee.gender,
      nationalId: employee.nationalId,
      bloodGroup: employee.bloodGroup,
      maritalStatus: employee.maritalStatus,
    }
    view.contact = {
      presentAddress: employee.presentAddress,
      permanentAddress: employee.permanentAddress,
      emergencyContact: employee.emergencyContact,
    }
  }

  if (canSeeEmployment) {
    view.employment = {
      employeeCode: employee.employeeCode,
      employmentType: employee.employmentType,
      employmentStatus: employee.employmentStatus,
      joiningDate: dateOnly(employee.joiningDate) as string,
      officeLocation: employee.officeLocation,
      shift: employee.shift ? { id: employee.shift.id, name: employee.shift.name } : null,
      // Behind canSeeEmployment on purpose: who is locked out is not
      // directory information, so COLLEAGUE never receives it.
      accountActive: employee.user.isActive,
      // FULL only, deliberately not SELF.
      ...(tier === "FULL" ? { deviceUserId: employee.deviceUserId } : {}),
    }
  }

  if (canSeeMoney) {
    view.payroll = {
      salaryStructure: employee.salaryStructure
        ? {
            id: employee.salaryStructure.id,
            name: employee.salaryStructure.name,
            currency: employee.salaryStructure.currency as "BDT" | "USD",
          }
        : null,
      bankAccountNumber: employee.bankAccountNumber,
      bankName: employee.bankName,
      bankRoutingNumber: employee.bankRoutingNumber,
    }
    view.exit =
      employee.lastWorkingDay && employee.exitReason
        ? {
            lastWorkingDay: dateOnly(employee.lastWorkingDay) as string,
            exitReason: employee.exitReason,
            exitNote: employee.exitNote,
          }
        : null
  }

  if (documents !== undefined) view.documents = documents
  if (blockers !== undefined) view.blockers = blockers

  return view
}
