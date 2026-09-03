export interface CreateStaffAccountInput {
  fullName: string
  email: string
  role: "EMPLOYEE" | "REPORTING_MANAGER"
  designation: string
  departmentId: string
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN"
  joiningDate: string
  reportingManagerId?: string
  shiftId?: string
}

export interface CreateStaffAccountResult {
  employeeCode: string
  temporaryPassword: string
  fullName: string
  email: string
}

import type {
  EmploymentStatus,
  EmploymentType,
  ExitReason,
} from "../../generated/prisma/client"
import type { DocumentItem } from "./employee.media"

export interface WorkIdentity {
  fullName: string
  designation: string
  department: { id: string; name: string }
  reportingManager: { id: string; fullName: string } | null
  email: string
  phone: string | null
  avatarUrl: string | null
}

/**
 * A national-ID change the employee has asked for and HR has not yet
 * decided. Null when there is no live request — most of the time.
 */
export interface PendingNationalIdChangeRequest {
  id: string
  newValue: string
  requestedAt: string
}

export interface PersonalIdentity {
  dateOfBirth: string | null
  gender: string | null
  nationalId: string | null
  bloodGroup: string | null
  maritalStatus: string | null
  /** Present only when SELF or FULL asked and a request is PENDING. */
  nationalIdChangeRequest?: PendingNationalIdChangeRequest | null
}

export interface ContactDetails {
  presentAddress: string | null
  permanentAddress: string | null
  emergencyContact: string | null
}

export interface EmploymentDetails {
  employeeCode: string
  employmentType: EmploymentType
  employmentStatus: EmploymentStatus
  joiningDate: string
  officeLocation: string | null
  shift: { id: string; name: string } | null
  /**
   * Whether the login works — `User.isActive`, not `employmentStatus`.
   *
   * Deliberately a separate fact: an employee on garden leave has a live
   * employment record and no login, and a current employee can have a
   * disabled account during an investigation. Collapsing the two would erase
   * a distinction the schema draws on purpose.
   */
  accountActive: boolean
  /** FULL only. A biometric enrolment id the employee cannot act on. */
  deviceUserId?: string | null
}

export interface PayrollDetails {
  salaryStructure: { id: string; name: string; currency: "BDT" | "USD" } | null
  bankAccountNumber: string | null
  bankName: string | null
  bankRoutingNumber: string | null
}

export interface ExitDetailsView {
  lastWorkingDay: string
  exitReason: ExitReason
  exitNote: string | null
}

export interface Blocker {
  field: string
  blocks: string
}

/**
 * Every group key is optional on purpose.
 *
 * A COLLEAGUE payload genuinely does not contain a `personal` key, and making
 * that structural means a component reading `employee.payroll.bankName`
 * without a guard fails `tsc` rather than crashing at runtime for a viewer
 * whose tier never had it.
 */
export interface EmployeeView {
  id: string
  work: WorkIdentity
  personal?: PersonalIdentity
  contact?: ContactDetails
  employment?: EmploymentDetails
  payroll?: PayrollDetails
  exit?: ExitDetailsView | null
  documents?: DocumentItem[]
  blockers?: Blocker[]
  /** From `writableFieldsFor(tier)`. The client renders controls from this. */
  editableFields: string[]
}

/**
 * The live sessions behind one account.
 *
 * **There is no "signed in since".** Refresh tokens rotate — `refresh()`
 * revokes the old row and writes a new one — so a token's `createdAt` is when
 * the session was last refreshed, never when it began. `count` is honest
 * (rotation keeps one live row per session) and `lastActiveAt` is honest.
 * A sign-in time would need a `lastLoginAt` column that does not exist.
 */
export interface AccountSessions {
  count: number
  lastActiveAt: string | null
}

export interface MyProfileResponse {
  account: {
    email: string
    role: string
    mustChangePassword: boolean
    /** When the account was opened, not when the person joined. */
    createdAt: string
    sessions: AccountSessions
    /**
     * Set only by accounts with no employee record. Null for staff, whose
     * name and photo live on the Employee row and belong to HR — reading
     * these for them would create a second answer to "what is this person
     * called".
     */
    displayName: string | null
    avatarUrl: string | null
  }
  employee: EmployeeView | null
}
