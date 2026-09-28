import { Router } from "express"
import type { NextFunction, Request, RequestHandler, Response } from "express"
import { requireAuth } from "../../middleware/requireAuth"
import { AppError } from "../../middleware/errorHandler"
import { isFinance } from "./receivables.access"
import {
  cancelCustomerPoHandler,
  createCustomerPoHandler,
  getCustomerPoHandler,
  listCustomerPosHandler,
  prefillPoLinesHandler,
  updateCustomerPoHandler,
} from "./customerPo.controller"

const router = Router()

// Finance and Super Admin, or the deal's own sales person (spec §6 Roles) —
// which deal narrows that further, and only the service can tell (it reads
// the deal to know its account), so this is only the coarse gate: someone
// with no sales role at all is refused before any query runs.
const requireFinanceOrSales: RequestHandler = (req: Request, _res: Response, next: NextFunction) =>
  req.user && (isFinance(req.user) || req.user.salesRole)
    ? next()
    : next(new AppError(403, "You do not have access to customer POs"))

router.get("/", requireAuth, requireFinanceOrSales, listCustomerPosHandler)
// Literal path before "/:id", or Express reads "prefill" as a PO id.
router.get("/prefill/:opportunityId", requireAuth, requireFinanceOrSales, prefillPoLinesHandler)
router.get("/:id", requireAuth, requireFinanceOrSales, getCustomerPoHandler)
router.post("/", requireAuth, requireFinanceOrSales, createCustomerPoHandler)
router.patch("/:id", requireAuth, requireFinanceOrSales, updateCustomerPoHandler)
router.post("/:id/cancel", requireAuth, requireFinanceOrSales, cancelCustomerPoHandler)

export default router
