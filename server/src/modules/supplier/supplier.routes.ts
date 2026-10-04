import type { NextFunction, Request, Response } from "express"
import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  createSupplierHandler,
  deactivateSupplierHandler,
  findSimilarSuppliersHandler,
  getSupplierHandler,
  listSupplierOptionsHandler,
  listSuppliersHandler,
  quickAddSupplierHandler,
  reactivateSupplierHandler,
  updateSupplierHandler,
} from "./supplier.controller"
import { exportSuppliersHandler } from "./supplier.export"
import { commitSupplierImport, previewSupplierImport, SUPPLIER_IMPORT_COLUMNS, supplierImportSampleRows } from "./supplier.import"
import { commitHandler, guideHandler, previewHandler, templateHandler } from "../../utils/import/import.http"
import { spreadsheetUpload } from "../media/media.upload"

const router = Router()

const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

// The quick-add / similar / options trio is for anyone filling in a
// product line on a deal, not only Finance: a sales role reaches these,
// but the full create and edit (below) stay Finance only.
function requireFinanceOrSales(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, "Authentication required"))
  if (req.user.role === Role.FINANCE_OFFICER || req.user.role === Role.SUPER_ADMIN || req.user.salesRole) {
    return next()
  }
  return next(new AppError(403, "You do not have permission to perform this action"))
}

// File import and export. The literal paths sit above `/:id`.
router.get("/export", requireAuth, requireRole(...WRITE_ROLES), exportSuppliersHandler)
router.get("/import/guide", requireAuth, requireRole(...WRITE_ROLES), guideHandler(SUPPLIER_IMPORT_COLUMNS))
router.get(
  "/import/template",
  requireAuth,
  requireRole(...WRITE_ROLES),
  templateHandler({ columns: SUPPLIER_IMPORT_COLUMNS, sampleRows: supplierImportSampleRows, baseName: "suppliers" })
)
router.post("/import/preview", requireAuth, requireRole(...WRITE_ROLES), spreadsheetUpload, previewHandler(previewSupplierImport))
router.post("/import/commit", requireAuth, requireRole(...WRITE_ROLES), spreadsheetUpload, commitHandler(commitSupplierImport))

router.get("/", requireAuth, listSuppliersHandler)
router.post("/quick", requireAuth, requireFinanceOrSales, quickAddSupplierHandler)
router.get("/similar", requireAuth, requireFinanceOrSales, findSimilarSuppliersHandler)
router.get("/options", requireAuth, requireFinanceOrSales, listSupplierOptionsHandler)
router.get("/:id", requireAuth, getSupplierHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createSupplierHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateSupplierHandler)
router.post("/:id/deactivate", requireAuth, requireRole(...WRITE_ROLES), deactivateSupplierHandler)
router.post("/:id/reactivate", requireAuth, requireRole(...WRITE_ROLES), reactivateSupplierHandler)

export default router
