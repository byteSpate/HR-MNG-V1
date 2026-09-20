import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import {
  changeMeetingStatusHandler,
  createMeetingHandler,
  getMeetingHandler,
  listMeetingAttendeeOptionsHandler,
  listMeetingsHandler,
  updateMeetingHandler,
} from "./meeting.controller"

const router = Router()

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

export default router
