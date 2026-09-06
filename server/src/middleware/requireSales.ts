import type { NextFunction, Request, Response } from "express"

import { Role, SalesRole } from "../generated/prisma/client"
import { AppError } from "./errorHandler"

/**
 * Enforces the Sales Hub's second permission axis from the authenticated
 * user's JWT claim, without querying the database.
 *
 * With no arguments, any sales role can pass. With arguments, the user's
 * sales role must be one of the requested roles. SUPER_ADMIN is always
 * treated as a Sales Admin so the first sales role can be granted.
 */
export function requireSales(...roles: SalesRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"))
    }
    if (req.user.role === Role.SUPER_ADMIN) {
      return next()
    }
    const held = req.user.salesRole
    if (!held) {
      return next(new AppError(403, "You do not have access to the Sales Hub"))
    }
    if (roles.length > 0 && !roles.includes(held)) {
      return next(new AppError(403, "You do not have permission to perform this action"))
    }
    return next()
  }
}
