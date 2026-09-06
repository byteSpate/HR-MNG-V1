import type { Role, SalesRole } from "../../generated/prisma/client"

export interface AccessTokenPayload {
  sub: string
  role: Role
  email: string
  mustChangePassword: boolean
  /**
   * The second permission axis. Null means no Sales Hub access. In the token
   * so `requireSales` stays a zero-query check exactly as `requireRole` is —
   * the cost is that a grant or revoke takes up to 15 minutes to bite, which
   * is already true of `role`.
   */
  salesRole: SalesRole | null
}

export interface PublicUser {
  id: string
  email: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  employeeCode?: string
}
