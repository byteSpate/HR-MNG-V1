import {
  RiBuilding2Line,
  RiCalendar2Line,
  RiContactsLine,
  RiFileList3Line,
  RiFlashlightLine,
  RiMailLine,
  RiPhoneLine,
  RiQuestionLine,
  RiTaskLine,
  RiWhatsappLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import type {
  OpportunityStage,
  OpportunityStatus,
  SalesAccountStatus,
  SalesChannel,
  SalesContactStatus,
  MinutesKind,
  SalesMeetingMode,
  SalesMeetingStatus,
  SalesMeetingSummary,
  SalesMinutesStatus,
  SalesTaskOrigin,
  SalesTaskPriority,
  SalesTaskStatus,
} from "@/lib/api/types"
import type { Tone } from "@/components/dashboard/types"

/** Shared between the accounts list and the account detail header, so the
    two screens can never describe the same status differently. */
export const ACCOUNT_STATUS_LABEL: Record<SalesAccountStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  DO_NOT_CONTACT: "Do not contact",
}

export const ACCOUNT_STATUS_TONE: Record<SalesAccountStatus, Tone> = {
  ACTIVE: "green",
  INACTIVE: "neutral",
  DO_NOT_CONTACT: "red",
}

/** Verified means somebody actually reached them, not that a number was
    written down — see contact.service.ts. */
export const CONTACT_STATUS_LABEL: Record<SalesContactStatus, string> = {
  UNVERIFIED: "Unverified",
  VERIFIED: "Verified",
  UNREACHABLE: "Unreachable",
  INVALID: "Invalid",
}

export const CONTACT_STATUS_TONE: Record<SalesContactStatus, Tone> = {
  UNVERIFIED: "neutral",
  VERIFIED: "green",
  UNREACHABLE: "yellow",
  INVALID: "red",
}

export const CHANNEL_LABEL: Record<SalesChannel, string> = {
  CALL: "Call",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  OTHER: "Other",
}

/** One glyph per channel, so a Timeline row is recognisable before reading
    a word of it. */
export const CHANNEL_ICON: Record<SalesChannel, RemixiconComponentType> = {
  CALL: RiPhoneLine,
  EMAIL: RiMailLine,
  WHATSAPP: RiWhatsappLine,
  OTHER: RiQuestionLine,
}

/** History mixes two entities in one feed; the glyph is the fast way to tell
    which row is about the account itself versus one of its contacts. */
export const HISTORY_ENTITY_ICON: Record<"SALES_ACCOUNT" | "SALES_CONTACT", RemixiconComponentType> = {
  SALES_ACCOUNT: RiBuilding2Line,
  SALES_CONTACT: RiContactsLine,
}

/** A system-recorded milestone (verification, account created) rather than
    something a person logged — its own glyph, distinct from every channel. */
export const EVENT_ICON: RemixiconComponentType = RiFlashlightLine

/**
 * A Timeline communication row's `meta` is server-rendered prose — "Call" or
 * "WhatsApp · Mr Rahman" — not a channel enum, so the channel has to be read
 * back out of the label it starts with rather than passed directly. Returns
 * the key rather than the icon component itself, so a caller picks the icon
 * with a plain `CHANNEL_ICON[...]` lookup at render time instead of through a
 * function call — the lookup is what React's static-components check can
 * verify is stable.
 */
export function channelForMeta(meta: string | null): SalesChannel {
  if (!meta) return "OTHER"
  const label = meta.split(" · ")[0]
  const channel = (Object.keys(CHANNEL_LABEL) as SalesChannel[]).find((c) => CHANNEL_LABEL[c] === label)
  return channel ?? "OTHER"
}

/** Each stage is named for who the deal is waiting on. */
export const STAGE_LABEL: Record<OpportunityStage, string> = {
  SOLUTION_DESIGN: "Solution design",
  REQUIREMENT_RECEIVED: "Requirement received",
  OEM_PRICING: "OEM pricing",
  QUOTATION_SUBMITTED: "Quotation submitted",
  NEGOTIATION: "Quotation Revision",
  AWAITING_DECISION: "Awaiting decision",
}

/** Who we are waiting on, which is what makes a stage worth acting on. */
export const STAGE_WAITING_ON: Record<OpportunityStage, string> = {
  SOLUTION_DESIGN: "Waiting on us",
  REQUIREMENT_RECEIVED: "Waiting on us to start",
  OEM_PRICING: "Waiting on the OEM",
  QUOTATION_SUBMITTED: "Waiting on the customer",
  NEGOTIATION: "Both sides",
  AWAITING_DECISION: "Waiting on the customer",
}

export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  ONGOING: "Ongoing",
  WON: "Won",
  LOST: "Lost",
  CANCELLED: "Cancelled",
}

export const OPPORTUNITY_STATUS_TONE: Record<OpportunityStatus, Tone> = {
  ONGOING: "neutral",
  WON: "green",
  LOST: "red",
  CANCELLED: "yellow",
}

/**
 * How a stage reads once the deal is closed.
 *
 * Past tense, and the stage is kept rather than cleared: "Lost, at
 * Negotiation" and "Lost, at OEM pricing" are different businesses, and the
 * second is usually a pricing problem somebody can fix. Clearing the field
 * would have thrown that away permanently.
 */
export function stageSentence(status: OpportunityStatus, stage: OpportunityStage): string {
  if (status === "ONGOING") return STAGE_LABEL[stage]
  return `${OPPORTUNITY_STATUS_LABEL[status]}, at ${STAGE_LABEL[stage].toLowerCase()}`
}

/**
 * Money, or the word for its absence.
 *
 * `null` is not zero. An unpriced deal is one nobody has costed yet; a deal
 * worth nothing is one being given away. Rendering the first as ৳0 states the
 * second, which is the defect UI rule 1 exists to stop — so this returns a
 * word and callers never fall back to a number.
 */
export function taka(amount: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "No price yet"
  const value = Number(amount)
  if (!Number.isFinite(value)) return "No price yet"
  return `৳${value.toLocaleString("en-BD", { maximumFractionDigits: 0 })}`
}

/** Whole days between two instants, floored. */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000))
}

// ── meetings and tasks (phase 3) ─────────────────────────────────────────────

/** How a person says where a meeting happens. The server's own words, kept in step. */
export const MEETING_MODE_LABEL: Record<SalesMeetingMode, string> = {
  CUSTOMER_SITE: "At the customer",
  OUR_OFFICE: "At our office",
  ONLINE: "Online",
}

export const MEETING_STATUS_LABEL: Record<SalesMeetingStatus, string> = {
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
}

/** Completed is done (green); cancelled needs a look (yellow), as a cancelled deal does. */
export const MEETING_STATUS_TONE: Record<SalesMeetingStatus, Tone> = {
  SCHEDULED: "neutral",
  COMPLETED: "green",
  CANCELLED: "yellow",
}

export const TASK_STATUS_LABEL: Record<SalesTaskStatus, string> = {
  PENDING: "Pending",
  DONE: "Done",
  CANCELLED: "Cancelled",
}

export const TASK_STATUS_TONE: Record<SalesTaskStatus, Tone> = {
  PENDING: "neutral",
  DONE: "green",
  CANCELLED: "yellow",
}

export const TASK_PRIORITY_LABEL: Record<SalesTaskPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
}

/** Only High carries a colour: it is the one priority that asks for a look. */
export const TASK_PRIORITY_TONE: Record<SalesTaskPriority, Tone> = {
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "yellow",
}

export const TASK_ORIGIN_LABEL: Record<SalesTaskOrigin, string> = {
  SELF: "My own",
  FUNNEL_MEETING: "Funnel meeting",
}

/** One glyph each, used on the Timeline, the panels and the overview. */
export const MEETING_ICON: RemixiconComponentType = RiCalendar2Line
export const TASK_ICON: RemixiconComponentType = RiTaskLine

/** "Sun 20 Sep, 10:00": a meeting's time as a person reads it. */
export function meetingWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** A date-only value, read as written: "20/09/2026". */
export function onDay(value: string | null): string {
  if (!value) return "—"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

/** A day as YYYY-MM-DD in the browser's own calendar, for a date input. */
export function dateOnlyOf(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

// ── meeting minutes (phase 4) ────────────────────────────────────────────────

export const MINUTES_STATUS_LABEL: Record<SalesMinutesStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  EDITED_AFTER_SENDING: "Edited after sending",
}

/** Sent is done (green). Edited after sending may need sending again (yellow). A draft is work in hand. */
export const MINUTES_STATUS_TONE: Record<SalesMinutesStatus, Tone> = {
  DRAFT: "neutral",
  SENT: "green",
  EDITED_AFTER_SENDING: "yellow",
}

/** What a section holds, as a person would say it. */
export const MINUTES_KIND_LABEL: Record<MinutesKind, string> = {
  PARAGRAPHS: "Paragraphs",
  BULLETS: "Bullet points",
  SUBTOPICS: "Numbered sub-topics",
  TABLE: "Next Steps table",
  RICH: "Formatted text",
}

export const MINUTES_ICON: RemixiconComponentType = RiFileList3Line

/**
 * Written out rather than asked of the locale, which spells September "Sept"
 * in en-GB; the PDF and its file name say "Sep".
 */
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "24 Aug", in the viewer's calendar. */
export function shortDay(iso: string): string {
  const date = new Date(iso)
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`
}

/** What a meeting row says about its minutes (§25.26): "Minutes · Draft", "Minutes · Sent 24 Aug". */
export function minutesLine(minutes: NonNullable<SalesMeetingSummary["minutes"]>): string {
  if (minutes.status === "EDITED_AFTER_SENDING") return "Minutes · Edited after sending"
  if (minutes.status === "SENT" && minutes.lastSentAt) return `Minutes · Sent ${shortDay(minutes.lastSentAt)}`
  return "Minutes · Draft"
}

/** An instant as a `datetime-local` value, in the browser's own time. */
export function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
