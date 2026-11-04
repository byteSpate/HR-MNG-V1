import type { Role } from "@/lib/api/types"

/**
 * Who can add employees and read the shift list. This is the same set the
 * server allows on `POST /api/employees/staff` and `GET /api/attendance/shifts`
 * (HR Admin and Super Admin). Keep the two in step by hand.
 *
 * It only decides what to SHOW. The server still refuses everyone else.
 */
export function canManageEmployees(role: Role | undefined): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN"
}
