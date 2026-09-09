import { z } from "zod"

/**
 * A real date, not any non-empty string.
 *
 * `z.string().min(1)` accepted "banana", which reached `new Date("banana")`,
 * produced `Invalid Date`, and surfaced as a 500 from Prisma.
 */
const dateOnlyString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, "That date does not exist")

export const createStaffAccountSchema = z.object({
  // `.trim()` before `.min(1)`: otherwise a single space is a valid name.
  fullName: z.string().trim().min(1).max(200),
  // Lowercased so `Bob@x.com` and `bob@x.com` cannot become two accounts.
  email: z.string().email().toLowerCase(),
  role: z.enum(["EMPLOYEE", "REPORTING_MANAGER"]),
  designation: z.string().trim().min(1).max(200),
  departmentId: z.string().min(1),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]),
  joiningDate: dateOnlyString,
  reportingManagerId: z.string().min(1).optional(),
  // Optional. Null falls back to the General shift (attendance.grid.ts), but
  // that fallback is silent — somebody hired onto the night shift and never
  // edited is judged for lateness against the wrong window and nobody finds
  // out. Putting it on the form makes the default a visible choice.
  shiftId: z.string().min(1).optional(),
})
export type CreateStaffAccountBody = z.infer<typeof createStaffAccountSchema>

/**
 * `null` un-assigns. Kept explicit rather than inferring it from an absent
 * key, because "leave the structure alone" and "this person is now on no
 * structure" are different intentions and PATCH cannot distinguish them
 * otherwise.
 */
export const setSalaryStructureSchema = z.object({
  salaryStructureId: z.string().min(1).nullable(),
})
export type SetSalaryStructureBody = z.infer<typeof setSalaryStructureSchema>

/**
 * The document type arrives as a multipart TEXT field alongside the file, so
 * it is validated on its own rather than as part of a JSON body.
 */
export const documentTypeSchema = z.enum([
  "CONTRACT",
  "NID",
  "CERTIFICATE",
  "OFFER_LETTER",
  "RESIGNATION",
  "OTHER",
])

/**
 * Every field optional, and every nullable field distinguishes absence from
 * clearing: `undefined` means "leave it alone", `null` means "clear it".
 *
 * Same explicit distinction `setSalaryStructureSchema` documents, applied to
 * every nullable column — a PATCH cannot otherwise express "this person no
 * longer has a recorded blood group".
 */
const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable().optional()

export const updateEmployeeSchema = z
  .object({
    // Self-editable
    phone: nullableText(32),
    presentAddress: nullableText(500),
    permanentAddress: nullableText(500),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
      .nullable()
      .optional(),
    gender: nullableText(40),
    emergencyContact: nullableText(300),
    maritalStatus: nullableText(40),
    bloodGroup: nullableText(10),
    // HR-only. nationalId never becomes self-editable — it goes through
    // EmployeeChangeRequest instead, so this same rule shape (min 1, max 50)
    // is reused there rather than exposed via this schema for SELF.
    fullName: z.string().trim().min(1).max(200).optional(),
    nationalId: nullableText(50),
    designation: z.string().trim().min(1).max(200).optional(),
    departmentId: z.string().min(1).optional(),
    reportingManagerId: z.string().min(1).nullable().optional(),
    employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]).optional(),
    joiningDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
      .optional(),
    officeLocation: nullableText(200),
    shiftId: z.string().min(1).nullable().optional(),
    deviceUserId: nullableText(50),
    bankAccountNumber: nullableText(50),
    bankName: nullableText(200),
    bankRoutingNumber: nullableText(20),
  })
  // An empty body is always a client bug, never a no-op success.
  .refine((body) => Object.keys(body).length > 0, {
    message: "No fields to update",
  })

export type UpdateEmployeeBody = z.infer<typeof updateEmployeeSchema>

export const setAccountActiveSchema = z.object({
  isActive: z.boolean(),
})

export type SetAccountActiveBody = z.infer<typeof setAccountActiveSchema>

export const setSalesRoleSchema = z.object({
  salesRole: z.enum(["SALES_ADMIN", "SALES_USER"]).nullable(),
})

export type SetSalesRoleBody = z.infer<typeof setSalesRoleSchema>

export const requestNationalIdChangeSchema = z.object({
  newValue: z.string().trim().min(1).max(50),
})

export const decideNationalIdChangeSchema = z.object({
  note: z.string().trim().min(1).max(500).optional(),
})
