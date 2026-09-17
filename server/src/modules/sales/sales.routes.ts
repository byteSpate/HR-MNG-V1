import { Router } from "express"

import { SalesRole } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireSales } from "../../middleware/requireSales"
import {
  addContactHandler,
  createSalesAccountHandler,
  getAccountHistoryHandler,
  getAccountMarginHandler,
  getAccountTimelineHandler,
  getSalesAccountHandler,
  logCommunicationHandler,
  listContactsHandler,
  listSalesAccountsHandler,
  listSalesEligibleEmployeesHandler,
  setContactStatusHandler,
  setPrimaryContactHandler,
  getTargetYearHandler,
  setSalesTargetHandler,
  getSalesDashboardHandler,
  updateSalesAccountHandler,
  addOpportunityLineHandler,
  changeOpportunityNextStepHandler,
  setSoftwareNeededHandler,
  changeOpportunityStageHandler,
  changeOpportunityStatusHandler,
  createOpportunityHandler,
  createSalesCommentHandler,
  deleteOpportunityLineHandler,
  getOpportunityHandler,
  getOpportunityTimelineHandler,
  getOpportunityHistoryHandler,
  listOpportunitiesHandler,
  listOpportunityOwnersHandler,
  listSalesCommentsHandler,
  reorderOpportunityLinesHandler,
  suggestOpportunityLinesHandler,
  updateOpportunityHandler,
  updateOpportunityLineHandler,
  updateSalesCommentHandler,
  changeMeetingStatusHandler,
  createMeetingHandler,
  getMeetingHandler,
  listMeetingAttendeeOptionsHandler,
  listMeetingsHandler,
  updateMeetingHandler,
  changeTaskStatusHandler,
  createTaskHandler,
  getTaskHandler,
  listTasksHandler,
  updateTaskHandler,
  getMinutesTemplateHandler,
  saveMinutesTemplateHandler,
  answerRequirementHandler,
  deleteMinutesHandler,
  getMinutesHandler,
  listMinutesHandler,
  listWaitingForMinutesHandler,
  saveMinutesHandler,
  startMinutesHandler,
  previewMinutesHandler,
  sendMinutesHandler,
  sentCopyHandler,
} from "./sales.controller"
import {
  addOtherWorkHandler,
  getEmployeeWeekHandler,
  getMyWeekHandler,
  listTeamWeekHandler,
  removeOtherWorkHandler,
  saveWeeklyNoteHandler,
  previewMyWeekHandler,
  submitMyWeekHandler,
  weeklyCopyHandler,
} from "./weekly.controller"

const router = Router()

// Reads are open to anyone in the hub and narrowed by `accountScopeFor`, so
// the guard here answers "may you be in the Sales Hub at all" and the scope
// answers "which accounts". Creating one is a Sales Admin act.
router.get("/accounts", requireAuth, requireSales(), listSalesAccountsHandler)
router.get("/accounts/:id", requireAuth, requireSales(), getSalesAccountHandler)
router.post("/accounts", requireAuth, requireSales(SalesRole.SALES_ADMIN), createSalesAccountHandler)
// Editing is requireSales() and not SALES_ADMIN: the write gate inside the
// service narrows it to the owner, the collaborators and admins. An owner
// fixing a typo on their own account should not need an admin.
router.patch("/accounts/:id", requireAuth, requireSales(), updateSalesAccountHandler)

// Who the owner/collaborator pickers on the create form may offer — Sales
// Admin only, same guard as creating the account itself.
router.get(
  "/employees",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  listSalesEligibleEmployeesHandler
)

// Contacts are ordinary work on an account you already hold, so they need no
// Sales Admin. `requireAccountAccess` inside each service is what stops a
// Sales User reaching an account that is not theirs.
router.get("/accounts/:id/contacts", requireAuth, requireSales(), listContactsHandler)
router.post("/accounts/:id/contacts", requireAuth, requireSales(), addContactHandler)
router.patch("/contacts/:id/primary", requireAuth, requireSales(), setPrimaryContactHandler)
router.patch("/contacts/:id/status", requireAuth, requireSales(), setContactStatusHandler)

// The Timeline and the History are both reads of the account, so both are
// guarded exactly as the account is. Logging a call is ordinary work on
// one, like a contact.
router.get("/accounts/:id/timeline", requireAuth, requireSales(), getAccountTimelineHandler)
router.get("/accounts/:id/history", requireAuth, requireSales(), getAccountHistoryHandler)
// What the company made on the account. Narrower than the two reads above:
// the service shows it only to the people who work the account.
router.get("/accounts/:id/margin", requireAuth, requireSales(), getAccountMarginHandler)
router.post(
  "/accounts/:id/communications",
  requireAuth,
  requireSales(),
  logCommunicationHandler
)

router.get("/opportunities", requireAuth, requireSales(), listOpportunitiesHandler)
router.post("/opportunities", requireAuth, requireSales(), createOpportunityHandler)
router.get("/opportunities/owners", requireAuth, requireSales(), listOpportunityOwnersHandler)
router.get("/opportunities/:id", requireAuth, requireSales(), getOpportunityHandler)
router.patch("/opportunities/:id", requireAuth, requireSales(), updateOpportunityHandler)
router.patch("/opportunities/:id/stage", requireAuth, requireSales(), changeOpportunityStageHandler)
router.patch("/opportunities/:id/status", requireAuth, requireSales(), changeOpportunityStatusHandler)
router.patch("/opportunities/:id/next-step", requireAuth, requireSales(), changeOpportunityNextStepHandler)
// The weekly report Application column, answered on the deal (§26.9).
router.patch("/opportunities/:id/software-needed", requireAuth, requireSales(), setSoftwareNeededHandler)
router.get("/opportunities/:id/timeline", requireAuth, requireSales(), getOpportunityTimelineHandler)
router.get("/opportunities/:id/history", requireAuth, requireSales(), getOpportunityHistoryHandler)

router.post("/opportunities/:id/lines", requireAuth, requireSales(), addOpportunityLineHandler)
router.put("/opportunities/:id/lines/reorder", requireAuth, requireSales(), reorderOpportunityLinesHandler)
router.patch("/lines/:lineId", requireAuth, requireSales(), updateOpportunityLineHandler)
router.delete("/lines/:lineId", requireAuth, requireSales(), deleteOpportunityLineHandler)
router.get("/suggestions/oem", requireAuth, requireSales(), suggestOpportunityLinesHandler)

router.get("/comments", requireAuth, requireSales(), listSalesCommentsHandler)
router.post("/comments", requireAuth, requireSales(), createSalesCommentHandler)
router.patch("/comments/:id", requireAuth, requireSales(), updateSalesCommentHandler)

// Meetings. Reads are open to the hub, like the account they belong to; the
// service narrows every write to the people who work that account.
router.get("/meetings", requireAuth, requireSales(), listMeetingsHandler)
router.post("/meetings", requireAuth, requireSales(), createMeetingHandler)
// Who may attend on our side: anyone with Sales Hub access (§24.3). Open to
// every hub member, unlike /employees, because anyone who works an account
// schedules its meetings. Before /meetings/:id, or the path is read as an id.
router.get("/meetings/attendee-options", requireAuth, requireSales(), listMeetingAttendeeOptionsHandler)
router.get("/meetings/:id", requireAuth, requireSales(), getMeetingHandler)
router.patch("/meetings/:id", requireAuth, requireSales(), updateMeetingHandler)
router.patch("/meetings/:id/status", requireAuth, requireSales(), changeMeetingStatusHandler)

// Tasks. Everyone makes tasks for themselves in this phase; the service
// decides who may read one and keeps changing it to its owner.
router.get("/tasks", requireAuth, requireSales(), listTasksHandler)
router.post("/tasks", requireAuth, requireSales(), createTaskHandler)
router.get("/tasks/:id", requireAuth, requireSales(), getTaskHandler)
router.patch("/tasks/:id", requireAuth, requireSales(), updateTaskHandler)
router.patch("/tasks/:id/status", requireAuth, requireSales(), changeTaskStatusHandler)

// Meeting minutes (revision §25). Open to the hub at the route; the service
// narrows every read and write to the people who work the meeting's account
// and Sales Admins (§25.27).
router.post("/meetings/:id/minutes", requireAuth, requireSales(), startMinutesHandler)
router.get("/minutes", requireAuth, requireSales(), listMinutesHandler)
// Before /minutes/:id, or the path is read as an id.
router.get("/minutes/waiting", requireAuth, requireSales(), listWaitingForMinutesHandler)
router.get("/minutes/:id", requireAuth, requireSales(), getMinutesHandler)
router.put("/minutes/:id", requireAuth, requireSales(), saveMinutesHandler)
router.patch("/minutes/:id/requirement", requireAuth, requireSales(), answerRequirementHandler)
router.delete("/minutes/:id", requireAuth, requireSales(), deleteMinutesHandler)
// PDFs. The preview is DRAFT and keeps nothing. Sending is record-only
// (§25.22): it keeps the copy, marks the minutes sent, and answers with that
// same file. A kept copy downloads again, exactly as it went out.
router.get("/minutes/:id/preview", requireAuth, requireSales(), previewMinutesHandler)
router.post("/minutes/:id/send", requireAuth, requireSales(), sendMinutesHandler)
router.get("/minutes/sends/:sendId/file", requireAuth, requireSales(), sentCopyHandler)

// The Weekly Report (revision §26). Open to the hub at the route; the service
// decides the rest: only a Sales User writes, and only their own week. All
// Reports is guarded here as well, because it is an admin screen end to end.
router.get("/weekly", requireAuth, requireSales(), getMyWeekHandler)
router.put("/weekly/notes", requireAuth, requireSales(), saveWeeklyNoteHandler)
router.post("/weekly/other-work", requireAuth, requireSales(), addOtherWorkHandler)
router.delete("/weekly/other-work/:id", requireAuth, requireSales(), removeOtherWorkHandler)
// Submitting keeps the copy and answers with that same file; a kept copy
// downloads again exactly as it was (§26.17).
// A look at the week as it would print, keeping nothing (the owner's ask,
// 2026-09-16). Before /weekly/submit, which is the one that records.
router.get("/weekly/preview", requireAuth, requireSales(), previewMyWeekHandler)
router.post("/weekly/submit", requireAuth, requireSales(), submitMyWeekHandler)
router.get("/weekly/copies/:id/file", requireAuth, requireSales(), weeklyCopyHandler)
// Before /weekly/all/:employeeId, or the path is read as an employee id.
router.get("/weekly/all", requireAuth, requireSales(SalesRole.SALES_ADMIN), listTeamWeekHandler)
router.get(
  "/weekly/all/:employeeId",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  getEmployeeWeekHandler
)

// Sales Settings (revision §25.30). The minutes template is its first section,
// open to everyone in the hub since 2026-09-15 (§25.20): the format changes
// often, and waiting for an admin slowed people down. Later settings join it
// under the same prefix, each with its own guard.
router.get("/settings/minutes-template", requireAuth, requireSales(), getMinutesTemplateHandler)
router.put("/settings/minutes-template", requireAuth, requireSales(), saveMinutesTemplateHandler)

export default router

// Targets and the dashboard. Reads are open to any hub member and narrowed by
// the service, which is where "your own, or anybody if you are an admin"
// lives. Setting a target is a Sales Admin act: a target somebody sets for
// themselves is not a target.
router.get("/targets", requireAuth, requireSales(), getTargetYearHandler)
router.put("/targets", requireAuth, requireSales(SalesRole.SALES_ADMIN), setSalesTargetHandler)
router.get("/dashboard", requireAuth, requireSales(), getSalesDashboardHandler)
