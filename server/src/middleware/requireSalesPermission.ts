import type { NextFunction, Request, Response } from "express"

import { canDo, PERMISSION_OFF_MESSAGE, type PermissionKey } from "../modules/sales/sales.permissions"
import { AppError } from "./errorHandler"

/**
 * The Sales Hub's third gate, after `requireAuth` and `requireSales()`: has a
 * Sales Admin switched this action on for Sales Users?
 *
 * A Sales Admin and the Super Admin always pass. `requireSales()` stays a
 * zero-query check on the token. This adds at most one cached read, kept for
 * 30 seconds in `getPermissionMap`.
 */
export function requireSalesPermission(key: PermissionKey) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, "Authentication required"))
    try {
      if (await canDo(req.user, key)) return next()
      return next(new AppError(403, PERMISSION_OFF_MESSAGE))
    } catch (err) {
      return next(err)
    }
  }
}
