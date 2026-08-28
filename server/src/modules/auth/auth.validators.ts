import { z } from "zod"

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type AdminLoginInput = z.infer<typeof adminLoginSchema>

export const staffLoginSchema = z.object({
  employeeId: z.string().min(1),
  password: z.string().min(1),
})
export type StaffLoginInput = z.infer<typeof staffLoginSchema>

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
})
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
})
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
})
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>

/**
 * Narrower than the Role enum on purpose. An EMPLOYEE or REPORTING_MANAGER
 * account needs an Employee row — department, designation, employment type,
 * joining date — which is POST /api/employees/staff, not this. Creating one
 * here would produce exactly the state setUserRole's guard refuses.
 */
export const createUserSchema = z.object({
  // trim/lowercase BEFORE email(): Zod applies these in order, so validating
  // first rejects a pasted "  Bob@X.com  " as a malformed body rather than
  // normalising it. The service normalises again — that is the uniqueness
  // check's guarantee, not this one's.
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["SUPER_ADMIN", "HR_ADMIN", "FINANCE_OFFICER"]),
})
export type CreateUserInput = z.infer<typeof createUserSchema>

export const setUserRoleSchema = z.object({
  role: z.enum([
    "SUPER_ADMIN",
    "HR_ADMIN",
    "FINANCE_OFFICER",
    "REPORTING_MANAGER",
    "EMPLOYEE",
  ]),
})
export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>

/**
 * Nullable on purpose. Clearing the name is a real choice — it falls back to
 * showing the email — and is not the same as omitting the field.
 */
export const displayNameSchema = z.object({
  displayName: z.string().trim().max(120).nullable(),
})
export type DisplayNameInput = z.infer<typeof displayNameSchema>

/**
 * The new sign-in address. Validated as an email here so a typo is refused
 * before anything is created — the service lower-cases it, and only the
 * service knows whether it collides with an existing account.
 */
export const emailChangeRequestBody = z.object({
  newEmail: z.string().trim().email("Enter a valid email address").max(255),
})
export type EmailChangeRequestBody = z.infer<typeof emailChangeRequestBody>

/** Shared by approve, cancel and confirm — all three carry only a token. */
export const emailChangeTokenBody = z.object({
  token: z.string().min(1, "A token is required"),
})
export type EmailChangeTokenBody = z.infer<typeof emailChangeTokenBody>
