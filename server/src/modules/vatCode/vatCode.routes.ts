import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { createVatCodeHandler, listVatCodesHandler, updateVatCodeHandler } from "./vatCode.controller"
import { exportVatCodesHandler } from "./vatCode.export"
import { commitVatCodeImport, previewVatCodeImport, VAT_CODE_IMPORT_COLUMNS, vatCodeImportSampleRows } from "./vatCode.import"
import { commitHandler, guideHandler, previewHandler, templateHandler } from "../../utils/import/import.http"
import { spreadsheetUpload } from "../media/media.upload"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

// File import and export.
router.get("/export", requireAuth, requireRole(...WRITE_ROLES), exportVatCodesHandler)
router.get("/import/guide", requireAuth, requireRole(...WRITE_ROLES), guideHandler(VAT_CODE_IMPORT_COLUMNS))
router.get(
  "/import/template",
  requireAuth,
  requireRole(...WRITE_ROLES),
  templateHandler({ columns: VAT_CODE_IMPORT_COLUMNS, sampleRows: vatCodeImportSampleRows, baseName: "vat-codes" })
)
router.post("/import/preview", requireAuth, requireRole(...WRITE_ROLES), spreadsheetUpload, previewHandler(previewVatCodeImport))
router.post("/import/commit", requireAuth, requireRole(...WRITE_ROLES), spreadsheetUpload, commitHandler(commitVatCodeImport))

router.get("/", requireAuth, listVatCodesHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createVatCodeHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateVatCodeHandler)

export default router
