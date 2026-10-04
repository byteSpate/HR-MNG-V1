import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { costUpload, spreadsheetUpload } from "../media/media.upload"
import {
  createCategoryHandler,
  createCommitmentHandler,
  createCostHandler,
  deleteCategoryHandler,
  deleteReceiptHandler,
  getCostHandler,
  getReceiptUrlHandler,
  importCommitHandler,
  importPreviewHandler,
  listCategoriesHandler,
  listCommitmentsHandler,
  listCostsHandler,
  payCostHandler,
  summaryHandler,
  updateCategoryHandler,
  updateCommitmentHandler,
  updateCostHandler,
  uploadReceiptHandler,
} from "./cost.controller"
import { exportCostsHandler } from "./cost.export"
import { COST_IMPORT_COLUMNS, costImportSampleRows } from "./cost.import"
import { guideHandler, templateHandler } from "../../utils/import/import.http"

const router = Router()

const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const
// HR already reads payroll, expenses and settlements; overheads are the
// same tier of information. Managers and employees get nothing at all —
// not even GET. Company overheads are not their business.
const READ_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN, Role.HR_ADMIN] as const

// Literal paths before /:id, or Express matches "categories", "commitments"
// and "summary" as bill ids.
router.get("/categories", requireAuth, requireRole(...READ_ROLES), listCategoriesHandler)
router.post("/categories", requireAuth, requireRole(...WRITE_ROLES), createCategoryHandler)
router.patch("/categories/:id", requireAuth, requireRole(...WRITE_ROLES), updateCategoryHandler)
router.delete("/categories/:id", requireAuth, requireRole(...WRITE_ROLES), deleteCategoryHandler)

router.get("/commitments", requireAuth, requireRole(...READ_ROLES), listCommitmentsHandler)
router.post("/commitments", requireAuth, requireRole(...WRITE_ROLES), createCommitmentHandler)
router.patch("/commitments/:id", requireAuth, requireRole(...WRITE_ROLES), updateCommitmentHandler)

router.get("/summary", requireAuth, requireRole(...READ_ROLES), summaryHandler)

// costUpload is already a complete handler with .single("file") baked in —
// calling .single() on it again throws at request time. The same is true of
// spreadsheetUpload, which these two use because they carry a sheet rather
// than a receipt.
router.post(
  "/import/preview",
  requireAuth,
  requireRole(...WRITE_ROLES),
  spreadsheetUpload,
  importPreviewHandler
)
router.post(
  "/import/commit",
  requireAuth,
  requireRole(...WRITE_ROLES),
  spreadsheetUpload,
  importCommitHandler
)

router.get("/receipts/:id/url", requireAuth, requireRole(...READ_ROLES), getReceiptUrlHandler)
router.delete("/receipts/:id", requireAuth, requireRole(...WRITE_ROLES), deleteReceiptHandler)

// File export, and the guide and example for the import above. The literal
// paths sit above `/:id`. Export follows the write roles, like the import.
router.get("/export", requireAuth, requireRole(...WRITE_ROLES), exportCostsHandler)
router.get("/import/guide", requireAuth, requireRole(...WRITE_ROLES), guideHandler(COST_IMPORT_COLUMNS))
router.get(
  "/import/template",
  requireAuth,
  requireRole(...WRITE_ROLES),
  templateHandler({ columns: COST_IMPORT_COLUMNS, sampleRows: costImportSampleRows, baseName: "operating-costs" })
)

router.get("/", requireAuth, requireRole(...READ_ROLES), listCostsHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createCostHandler)
router.get("/:id", requireAuth, requireRole(...READ_ROLES), getCostHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateCostHandler)
router.post("/:id/pay", requireAuth, requireRole(...WRITE_ROLES), payCostHandler)
router.post(
  "/:id/receipts",
  requireAuth,
  requireRole(...WRITE_ROLES),
  costUpload,
  uploadReceiptHandler
)

export default router
