import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { assetUpload, spreadsheetUpload } from "../media/media.upload"
import {
  acknowledgeHandler,
  approveRequestHandler,
  assetValueReportHandler,
  assignHandler,
  cancelRequestHandler,
  capitaliseHandler,
  createAssetHandler,
  createCategoryHandler,
  createRecoveryHandler,
  deleteAttachmentHandler,
  deleteCategoryHandler,
  disposeHandler,
  exitChecklistHandler,
  fulfilRequestHandler,
  getAssetHandler,
  getAttachmentUrlHandler,
  importCommitHandler,
  importPreviewHandler,
  listAssetsHandler,
  listCategoriesHandler,
  listRecoveriesHandler,
  listRepairsHandler,
  listRequestsHandler,
  listUnacknowledgedHandler,
  markLostHandler,
  markOrderedHandler,
  myHoldingsHandler,
  payAssetHandler,
  receiveRepairHandler,
  recoverFromPayrollHandler,
  rejectRequestHandler,
  requestTimelineHandler,
  retireHandler,
  returnHandler,
  sendRepairHandler,
  submitRequestHandler,
  updateAssetHandler,
  updateCategoryHandler,
  updateRecoveryHandler,
  uploadAssetAttachmentHandler,
  uploadAssignmentAttachmentHandler,
  waiveRecoveryHandler,
} from "./asset.controller"
import { exportAssetsHandler } from "./asset.export"
import { ASSET_IMPORT_COLUMNS, assetImportSampleRows } from "./asset.import"
import { guideHandler, templateHandler } from "../../utils/import/import.http"

const router = Router()

/** Roles with an Employee profile, and therefore holdings of their own. */
const STAFF_ROLES = [Role.EMPLOYEE, Role.REPORTING_MANAGER] as const
const HR_ROLES = [Role.HR_ADMIN, Role.SUPER_ADMIN] as const
/** Finance joins HR for disposal, the one asset action with an accounting
 *  consequence — but not for custody. */
const DISPOSAL_ROLES = [Role.HR_ADMIN, Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const
/** The ledger actions: only people authorised to move the ledger. */
const LEDGER_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

// Literal paths before /:id, or Express matches "me" and "categories" as ids.
router.get("/categories", requireAuth, listCategoriesHandler)
router.post("/categories", requireAuth, requireRole(...HR_ROLES), createCategoryHandler)
router.patch("/categories/:id", requireAuth, requireRole(...HR_ROLES), updateCategoryHandler)
router.delete("/categories/:id", requireAuth, requireRole(...HR_ROLES), deleteCategoryHandler)

// The book-value report is read-only and finance + HR both need it — HR
// prices a lost laptop from it, Finance files it. Nobody below that sees it.
router.get(
  "/value",
  requireAuth,
  requireRole(Role.FINANCE_OFFICER, Role.HR_ADMIN, Role.SUPER_ADMIN),
  assetValueReportHandler
)

// Recoveries: HR creates, corrects and waives; Finance reads; an employee
// sees their own. The split mirrors payroll.routes.ts — recovery from payroll
// is an explicit act, and Finance cannot move money alone (Decision 3). The
// service scopes an EMPLOYEE/manager read to their own recoveries.
router.get(
  "/recoveries",
  requireAuth,
  requireRole(Role.EMPLOYEE, Role.REPORTING_MANAGER, Role.HR_ADMIN, Role.FINANCE_OFFICER, Role.SUPER_ADMIN),
  listRecoveriesHandler
)
router.post("/recoveries", requireAuth, requireRole(...HR_ROLES), createRecoveryHandler)
router.patch("/recoveries/:id", requireAuth, requireRole(...HR_ROLES), updateRecoveryHandler)
router.post("/recoveries/:id/waive", requireAuth, requireRole(...HR_ROLES), waiveRecoveryHandler)
router.post(
  "/recoveries/:id/recover-from-payroll",
  requireAuth,
  requireRole(...HR_ROLES),
  recoverFromPayrollHandler
)
// Decision 7: deleting a recovery is refused outright at every status — a
// PENDING recovery that turns out to be a mistake is waived with a reason
// saying so. The route exists so the refusal is a 405, not a 404.
router.delete("/recoveries/:id", requireAuth, requireRole(...HR_ROLES), (_req, res) => {
  res.status(405).json({ error: "Recoveries cannot be deleted. Waive one instead — it keeps the audit trail." })
})

// The exit checklist is read-only and never gates a settlement (Decision 6) —
// it is a warning surfaced in the settlement builder.
router.get(
  "/exit-checklist/:employeeId",
  requireAuth,
  requireRole(Role.HR_ADMIN, Role.FINANCE_OFFICER, Role.SUPER_ADMIN),
  exitChecklistHandler
)

// Ledger actions: capitalise (move cost onto the balance sheet), pay (clear
// the payable), dispose (book the gain or loss). Finance and admin only.
router.post("/:id/capitalise", requireAuth, requireRole(...LEDGER_ROLES), capitaliseHandler)
router.post("/:id/pay", requireAuth, requireRole(...LEDGER_ROLES), payAssetHandler)
router.post("/:id/dispose", requireAuth, requireRole(...LEDGER_ROLES), disposeHandler)

router.get("/me", requireAuth, requireRole(...STAFF_ROLES), myHoldingsHandler)
router.get("/unacknowledged", requireAuth, requireRole(...HR_ROLES), listUnacknowledgedHandler)
router.get(
  "/repairs",
  requireAuth,
  requireRole(Role.HR_ADMIN, Role.FINANCE_OFFICER, Role.SUPER_ADMIN),
  listRepairsHandler
)

router.post("/requests", requireAuth, requireRole(...STAFF_ROLES), submitRequestHandler)
router.get("/requests", requireAuth, listRequestsHandler)
router.get("/requests/:id/timeline", requireAuth, requestTimelineHandler)
// ADR-0002: Super Admin alone decides. The 403 for anyone else lives in the
// service, but the route narrows it too so an HR_ADMIN never reaches it.
router.patch("/requests/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveRequestHandler)
router.patch("/requests/:id/reject", requireAuth, requireRole(Role.SUPER_ADMIN), rejectRequestHandler)
// Cancel is both the requester's withdrawal and HR's dead end, so no role
// guard here — the service decides which rule applies from the caller.
router.patch("/requests/:id/cancel", requireAuth, cancelRequestHandler)
router.patch("/requests/:id/order", requireAuth, requireRole(...HR_ROLES), markOrderedHandler)
router.post("/requests/:id/fulfil", requireAuth, requireRole(...HR_ROLES), fulfilRequestHandler)

// spreadsheetUpload, not assetUpload: these carry an .xlsx/.csv register,
// not a photo. assetUpload's document filter rejected every import.
router.post(
  "/import/preview",
  requireAuth,
  requireRole(...HR_ROLES),
  spreadsheetUpload,
  importPreviewHandler
)
router.post(
  "/import/commit",
  requireAuth,
  requireRole(...HR_ROLES),
  spreadsheetUpload,
  importCommitHandler
)

router.post(
  "/assignments/:id/acknowledge",
  requireAuth,
  requireRole(...STAFF_ROLES),
  acknowledgeHandler
)
router.post(
  "/assignments/:id/attachments",
  requireAuth,
  requireRole(...HR_ROLES),
  assetUpload,
  uploadAssignmentAttachmentHandler
)

router.get("/attachments/:id/url", requireAuth, getAttachmentUrlHandler)
router.delete("/attachments/:id", requireAuth, requireRole(...HR_ROLES), deleteAttachmentHandler)

// File export, and the guide and example for the import above. The literal
// paths sit above `/:id`.
router.get("/export", requireAuth, requireRole(...HR_ROLES), exportAssetsHandler)
router.get("/import/guide", requireAuth, requireRole(...HR_ROLES), guideHandler(ASSET_IMPORT_COLUMNS))
router.get(
  "/import/template",
  requireAuth,
  requireRole(...HR_ROLES),
  templateHandler({ columns: ASSET_IMPORT_COLUMNS, sampleRows: assetImportSampleRows, baseName: "assets" })
)

router.get("/", requireAuth, listAssetsHandler)
router.post("/", requireAuth, requireRole(...HR_ROLES), createAssetHandler)
router.get("/:id", requireAuth, getAssetHandler)
router.patch("/:id", requireAuth, requireRole(...HR_ROLES), updateAssetHandler)
router.post("/:id/assign", requireAuth, requireRole(...HR_ROLES), assignHandler)
router.post("/:id/return", requireAuth, requireRole(...HR_ROLES), returnHandler)
router.post("/:id/retire", requireAuth, requireRole(...DISPOSAL_ROLES), retireHandler)
router.post("/:id/mark-lost", requireAuth, requireRole(...HR_ROLES), markLostHandler)
router.post("/:id/repairs", requireAuth, requireRole(...HR_ROLES), sendRepairHandler)
router.post(
  "/:id/attachments",
  requireAuth,
  requireRole(...HR_ROLES),
  assetUpload,
  uploadAssetAttachmentHandler
)

router.patch("/repairs/:id/receive", requireAuth, requireRole(...HR_ROLES), receiveRepairHandler)

export default router
