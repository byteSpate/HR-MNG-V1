import { Router } from "express"
import type { NextFunction, Request, RequestHandler, Response } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { AppError } from "../../middleware/errorHandler"
import { isFinance } from "./receivables.access"
import {
  approveEarningEventHandler,
  createEarningEventHandler,
  getEarningEventHandler,
  listEarningEventsHandler,
} from "./earningEvent.controller"

const router = Router()

// Finance and Super Admin, or the deal's own sales person (spec §6 Roles) —
// same coarse gate customerPo.routes uses; the service narrows it to the
// specific deal.
const requireFinanceOrSales: RequestHandler = (req: Request, _res: Response, next: NextFunction) =>
  req.user && (isFinance(req.user) || req.user.salesRole)
    ? next()
    : next(new AppError(403, "You do not have access to deliveries and acceptances"))

router.get("/", requireAuth, requireFinanceOrSales, listEarningEventsHandler)
router.get("/:id", requireAuth, requireFinanceOrSales, getEarningEventHandler)
router.post("/", requireAuth, requireFinanceOrSales, createEarningEventHandler)
router.post("/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveEarningEventHandler)

export default router
