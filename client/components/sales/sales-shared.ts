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

import type { SalesAccountStatus, SalesChannel, SalesContactStatus } from "@/lib/api/types"
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
