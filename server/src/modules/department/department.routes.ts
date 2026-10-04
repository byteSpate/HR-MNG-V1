import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  createDepartmentHandler,
  deleteDepartmentHandler,
  listDepartmentsHandler,
  updateDepartmentHandler,
} from "./department.controller"
import { exportDepartmentsHandler } from "./department.export"
import { commitDepartmentImport, DEPARTMENT_IMPORT_COLUMNS, departmentImportSampleRows, previewDepartmentImport } from "./department.import"
import { commitHandler, guideHandler, previewHandler, templateHandler } from "../../utils/import/import.http"
import { spreadsheetUpload } from "../media/media.upload"

const router = Router()

// HR owns the org chart; Finance and managers read it. The read stays open to
// any authenticated role because every employee form has a department picker.
const WRITE_ROLES = [Role.HR_ADMIN, Role.SUPER_ADMIN] as const

// File import and export. The literal paths sit above the `/:id` routes.
router.get("/export", requireAuth, requireRole(...WRITE_ROLES), exportDepartmentsHandler)
router.get("/import/guide", requireAuth, requireRole(...WRITE_ROLES), guideHandler(DEPARTMENT_IMPORT_COLUMNS))
router.get(
  "/import/template",
  requireAuth,
  requireRole(...WRITE_ROLES),
  templateHandler({ columns: DEPARTMENT_IMPORT_COLUMNS, sampleRows: departmentImportSampleRows, baseName: "departments" })
)
router.post("/import/preview", requireAuth, requireRole(...WRITE_ROLES), spreadsheetUpload, previewHandler(previewDepartmentImport))
router.post("/import/commit", requireAuth, requireRole(...WRITE_ROLES), spreadsheetUpload, commitHandler(commitDepartmentImport))

router.get("/", requireAuth, listDepartmentsHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createDepartmentHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateDepartmentHandler)
router.delete("/:id", requireAuth, requireRole(...WRITE_ROLES), deleteDepartmentHandler)

export default router
