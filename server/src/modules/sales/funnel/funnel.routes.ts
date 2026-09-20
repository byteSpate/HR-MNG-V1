/**
 * The funnel's routes (revision §27.18).
 *
 * A router of its own, mounted by one line in `sales.routes.ts`. Phases 1 to 5
 * each added their paths to that file directly and it now carries every route
 * in the module; the funnel is the first to stop doing that, ahead of the
 * wider tidy-up in §28.
 */

import { Router } from "express"

import { SalesRole } from "../../../generated/prisma/client"
import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import {
  addManagementNoteHandler,
  completeMeetingHandler,
  createFunnelActionHandler,
  editFunnelCellHandler,
  getFunnelHandler,
  getFunnelMeetingHandler,
  listFunnelTeamHandler,
  listMeetingActionsHandler,
  openFunnelMeetingHandler,
  reopenMeetingHandler,
  setMeetingAttendeesHandler,
  setMeetingNoteHandler,
  setPersonReviewedHandler,
} from "./funnel.controller"

const router = Router()

// ── the grid ──

// Before "/", so "team" is never read as a query against the caller's own
// funnel and quietly answered with the wrong thing.
router.get("/team", requireAuth, requireSales(SalesRole.SALES_ADMIN), listFunnelTeamHandler)

/**
 * One person's funnel. No employeeId means the caller's own; naming somebody
 * else needs a Sales Admin, which the service checks rather than the route —
 * a Sales User asking for their own funnel by id must still be allowed.
 */
router.get("/", requireAuth, requireSales(), getFunnelHandler)

/** A cell, edited in place. Deal access decides this, not a sales role. */
router.patch("/cell", requireAuth, requireSales(), editFunnelCellHandler)

// ── the meeting ──

// The literal "/meeting" paths before "/meeting/:id/...", so a fixed path is
// never read as an id.
router.get("/meeting", requireAuth, requireSales(SalesRole.SALES_ADMIN), getFunnelMeetingHandler)
router.post("/meeting", requireAuth, requireSales(SalesRole.SALES_ADMIN), openFunnelMeetingHandler)

router.put(
  "/meeting/:id/attendees",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  setMeetingAttendeesHandler
)
router.put(
  "/meeting/:id/reviewed",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  setPersonReviewedHandler
)
router.put(
  "/meeting/:id/note",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  setMeetingNoteHandler
)
router.post(
  "/meeting/:id/complete",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  completeMeetingHandler
)
router.post(
  "/meeting/:id/reopen",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  reopenMeetingHandler
)

/** A management note on a deal, written during the review (§27.8). */
router.post(
  "/meeting/:id/notes",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  addManagementNoteHandler
)

// ── action items (§27.13) ──

router.get(
  "/meeting/:id/actions",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  listMeetingActionsHandler
)
router.post(
  "/meeting/:id/actions",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  createFunnelActionHandler
)

export default router
