import {
  RiBuilding2Line,
  RiContactsLine,
  RiFlashlightLine,
  RiMailLine,
  RiPhoneLine,
  RiQuestionLine,
  RiWhatsappLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import type {
  OpportunityStage,
  OpportunityStatus,
  SalesAccountStatus,
  SalesChannel,
  SalesContactStatus,
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
  REQUIREMENT_RECEIVED: "Requirement received",
  SOLUTION_DESIGN: "Solution design",
  OEM_PRICING: "OEM pricing",
  QUOTATION_SUBMITTED: "Quotation submitted",
  NEGOTIATION: "Negotiation",
  AWAITING_DECISION: "Awaiting decision",
}

/** Who we are waiting on, which is what makes a stage worth acting on. */
export const STAGE_WAITING_ON: Record<OpportunityStage, string> = {
  REQUIREMENT_RECEIVED: "Waiting on us to start",
  SOLUTION_DESIGN: "Waiting on us",
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
