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
