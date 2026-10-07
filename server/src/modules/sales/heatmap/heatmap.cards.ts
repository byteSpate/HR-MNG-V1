import { AppError } from "../../../middleware/errorHandler"
import { parseDateOnly } from "../../../utils/dates"

/**
 * The cards on an account's Heatmap tab (owner, 2026-10-07). Each card is one
 * kind of IT system the company may have, like switches or CCTV.
 *
 * The list lives here and nowhere else. The server sends it to the page with
 * the data, so the words are never copied into the client, and a saved row
 * stores only the card `key` and the field keys. To reword a label, change it
 * here. Never reuse a key for something else.
 *
 * Every word is read by people whose first language is often not English, so
 * the labels are short and plain (see CLAUDE.md, Easy English).
 */

export type HeatmapFieldType = "TEXT" | "NUMBER" | "YES_NO" | "CHOICE" | "DATE"

export interface HeatmapField {
  key: string
  label: string
  type: HeatmapFieldType
  /** Pick list only. */
  options?: readonly string[]
  /** A DATE that sets the card's colour, like the support end date does. */
  setsColour?: true
}

export const HEATMAP_GROUPS = [
  { key: "network", title: "Network" },
  { key: "servers", title: "Servers and data" },
  { key: "phones", title: "Phones and security" },
  { key: "software", title: "Software and safety" },
] as const

export type HeatmapGroupKey = (typeof HEATMAP_GROUPS)[number]["key"]

export interface HeatmapCardSpec {
  key: string
  group: HeatmapGroupKey
  title: string
  /** The words for the "how many" box, like "Cameras" on CCTV. */
  quantityLabel: string
  /** The words for the end date that sets the colour. */
  endsLabel: string
  /** Fields only this card has. */
  extras: readonly HeatmapField[]
}

const SUPPORT = "Warranty or support ends"
const LICENCE = "Licence ends"

export const HEATMAP_CARDS: readonly HeatmapCardSpec[] = [
  // Network
  {
    key: "router", group: "network", title: "Router", quantityLabel: "How many", endsLabel: SUPPORT,
    extras: [
      { key: "links", label: "Internet links", type: "NUMBER" },
      { key: "vpn", label: "VPN", type: "YES_NO" },
    ],
  },
  {
    key: "switch", group: "network", title: "Switch", quantityLabel: "How many", endsLabel: SUPPORT,
    extras: [
      { key: "ports", label: "Ports on each switch", type: "NUMBER" },
      { key: "speed", label: "Speed", type: "CHOICE", options: ["1G", "10G"] },
      { key: "poe", label: "PoE", type: "YES_NO" },
      { key: "managed", label: "Managed", type: "YES_NO" },
    ],
  },
  {
    key: "firewall", group: "network", title: "Firewall", quantityLabel: "How many", endsLabel: SUPPORT,
    extras: [
      { key: "licenceEndsOn", label: LICENCE, type: "DATE", setsColour: true },
      { key: "users", label: "Users", type: "NUMBER" },
    ],
  },
  {
    key: "wireless", group: "network", title: "Wireless", quantityLabel: "Access points", endsLabel: SUPPORT,
    extras: [{ key: "controller", label: "Controller", type: "CHOICE", options: ["Cloud", "On site", "None"] }],
  },
  // Servers and data
  {
    key: "server", group: "servers", title: "Server", quantityLabel: "How many", endsLabel: SUPPORT,
    extras: [
      { key: "kind", label: "Physical or virtual", type: "CHOICE", options: ["Physical", "Virtual"] },
      { key: "os", label: "Operating system", type: "TEXT" },
      { key: "role", label: "What it is used for", type: "TEXT" },
    ],
  },
  {
    key: "storage", group: "servers", title: "Storage and backup", quantityLabel: "How many", endsLabel: SUPPORT,
    extras: [
      { key: "kind", label: "Type", type: "CHOICE", options: ["NAS", "SAN", "Tape", "Cloud"] },
      { key: "sizeTb", label: "Size in TB", type: "NUMBER" },
    ],
  },
  {
    key: "dataCentre", group: "servers", title: "Data centre or server room", quantityLabel: "How many", endsLabel: SUPPORT,
    extras: [
      { key: "racks", label: "Racks", type: "NUMBER" },
      { key: "cooling", label: "Cooling", type: "YES_NO" },
      { key: "fireSystem", label: "Fire system", type: "YES_NO" },
    ],
  },
  // Phones and security
  {
    key: "ipPhone", group: "phones", title: "IP phone and PBX", quantityLabel: "Phones", endsLabel: SUPPORT,
    extras: [{ key: "pbxBrand", label: "PBX brand", type: "TEXT" }],
  },
  {
    key: "cctv", group: "phones", title: "CCTV", quantityLabel: "Cameras", endsLabel: SUPPORT,
    extras: [
      { key: "nvrBrand", label: "NVR brand", type: "TEXT" },
      { key: "recordingDays", label: "Days of recording kept", type: "NUMBER" },
    ],
  },
  {
    key: "accessControl", group: "phones", title: "Access control and attendance", quantityLabel: "Devices", endsLabel: SUPPORT,
    extras: [{ key: "kind", label: "Type", type: "CHOICE", options: ["Card", "Finger", "Face"] }],
  },
  {
    key: "videoConferencing", group: "phones", title: "Video conferencing", quantityLabel: "Rooms", endsLabel: SUPPORT,
    extras: [{ key: "system", label: "System", type: "TEXT" }],
  },
  // Software and safety
  {
    key: "software", group: "software", title: "Software", quantityLabel: "Users", endsLabel: LICENCE,
    extras: [{ key: "name", label: "Software name", type: "TEXT" }],
  },
  {
    key: "antivirus", group: "software", title: "Antivirus and endpoint security", quantityLabel: "Licences", endsLabel: LICENCE,
    extras: [],
  },
  {
    key: "ssl", group: "software", title: "SSL certificate", quantityLabel: "Certificates", endsLabel: "Expires on",
    extras: [
      { key: "domain", label: "Domain name", type: "TEXT" },
      { key: "certType", label: "Type", type: "CHOICE", options: ["Single", "Wildcard", "Multi-domain"] },
      { key: "validation", label: "Validation level", type: "CHOICE", options: ["DV", "OV", "EV"] },
    ],
  },
]

export const CARD_BY_KEY: Map<string, HeatmapCardSpec> = new Map(HEATMAP_CARDS.map((c) => [c.key, c]))

const NUMBER = /^\d{1,7}(\.\d{1,2})?$/

/**
 * Checks an item's extra fields against its card and returns what to store.
 * The Zod schema only checks that each is short text; what a field may hold
 * depends on the card, so it is decided here. An empty field is dropped, so a
 * stored item holds only what was filled in.
 */
export function checkDetails(card: HeatmapCardSpec, details: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(details)) {
    const field = card.extras.find((f) => f.key === key)
    if (!field) throw new AppError(400, `${card.title} has no field "${key}". Reload the page and try again.`)
    const value = raw.trim()
    if (value === "") continue
    switch (field.type) {
      case "NUMBER":
        if (!NUMBER.test(value)) throw new AppError(400, `${field.label} needs a number, like 24.`)
        break
      case "YES_NO":
        if (value !== "YES" && value !== "NO") throw new AppError(400, `${field.label}: pick Yes or No.`)
        break
      case "CHOICE":
        if (!field.options!.includes(value)) throw new AppError(400, `${field.label}: choose one of ${field.options!.join(", ")}.`)
        break
      case "DATE":
        try {
          parseDateOnly(value)
        } catch {
          throw new AppError(400, `${field.label} needs a date. Pick one from the calendar.`)
        }
        break
      case "TEXT":
        break
    }
    out[key] = value
  }
  return out
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const

/** "3 March 2027", from "2027-03-03". Read in UTC, so the day never shifts. */
export function longDate(dateOnly: string): string {
  const d = parseDateOnly(dateOnly)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "March 2027", from "2027-03-03". */
export function monthYear(dateOnly: string): string {
  const d = parseDateOnly(dateOnly)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** An item as a person reads it, for the account History. */
export function itemText(
  card: HeatmapCardSpec,
  item: { brand: string; model: string | null; quantity: number; supportEndsOn: string | null },
): string {
  const name = item.model ? `${item.brand} ${item.model}` : item.brand
  const parts = [name, String(item.quantity)]
  if (item.supportEndsOn) parts.push(`${card.endsLabel} ${longDate(item.supportEndsOn)}`)
  return parts.join(", ")
}
