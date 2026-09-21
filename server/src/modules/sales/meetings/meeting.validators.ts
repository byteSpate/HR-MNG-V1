import { z } from "zod"

// ── meetings (phase 3, revision §24) ─────────────────────────────────────────
const meetingMode = z.enum(["CUSTOMER_SITE", "OUR_OFFICE", "ONLINE"])
const instant = z.string().datetime({ offset: true })

/** Our side is an employee; their side is a saved contact, or a typed name. */
const meetingAttendeeSchema = z
  .object({
    side: z.enum(["OURS", "THEIRS"]),
    employeeId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    designation: z.string().trim().max(120).optional(),
  })
  .refine((a) => (a.side === "OURS" ? !!a.employeeId : !!a.contactId || !!a.name), {
    message: "Somebody on our side is an employee; somebody on theirs is a saved contact or a name",
  })

export const createMeetingSchema = z.object({
  salesAccountId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Give the meeting a title").max(180),
  // A visit is the usual meeting, so it is the default.
  mode: meetingMode.default("CUSTOMER_SITE"),
  scheduledAt: instant,
  endsAt: instant.optional(),
  location: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(4000).optional(),
  attendees: z.array(meetingAttendeeSchema).max(50).default([]),
})

export const updateMeetingSchema = z
  .object({
    opportunityId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2, "Give the meeting a title").max(180).optional(),
    mode: meetingMode.optional(),
    scheduledAt: instant.optional(),
    endsAt: instant.nullable().optional(),
    location: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    attendees: z.array(meetingAttendeeSchema).max(50).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing was changed" })

export const changeMeetingStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("COMPLETED"), outcome: z.string().trim().max(2000).optional() }),
  z.object({
    status: z.literal("CANCELLED"),
    reason: z.string().trim().min(2, "Say why the meeting is cancelled").max(500),
  }),
  z.object({ status: z.literal("SCHEDULED") }),
])

export const listMeetingSchema = z.object({
  salesAccountId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]).optional(),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === "true" ? true : undefined)),
  from: instant.optional(),
  to: instant.optional(),
})

export type CreateMeetingBody = z.infer<typeof createMeetingSchema>
export type UpdateMeetingBody = z.infer<typeof updateMeetingSchema>
export type ChangeMeetingStatusBody = z.infer<typeof changeMeetingStatusSchema>
export type ListMeetingQuery = z.infer<typeof listMeetingSchema>
