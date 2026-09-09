import type { ReactNode } from "react"

import type { IconName } from "@/components/dashboard/icons"

export type Tone = "green" | "yellow" | "red" | "neutral"

export const tones: Record<Tone, { bg: string; color: string }> = {
  green: { bg: "#E3F3E8", color: "#1E7A3C" },
  yellow: { bg: "#FBF0D9", color: "#9A6B10" },
  red: { bg: "#FBE4E4", color: "#B03A3A" },
  neutral: { bg: "#ECEEF1", color: "#17191C" },
}

export type Stat = {
  label: string
  value: string
  sub: string
  tag: string
  tone: Tone
  /**
   * Absent when the stat has no real history — which is most of them. Only
   * headcount, payroll totals and attendance rate have anything stored to
   * draw from; everything else is current-state. Absent means "no series
   * exists", never "not loaded", and the server sends no array of zeros: a
   * fake sparkline is worse than none, being indistinguishable from a real
   * one.
   */
  bars?: number[]
  hotBar?: number
  href?: string
  /** This card's query failed. Its siblings still rendered. */
  failed?: boolean
}

export type ActivityItem = {
  initial: string
  tone: Tone
  title: string
  meta: string
  status?: string
  statusTone?: Tone
  time: string
}

export type TableCell = {
  text?: string
  sub?: string
  weight?: number
  tag?: string
  tone?: Tone
  /**
   * A glyph key from the server (an `AuditEntity` name), resolved to a real
   * icon by `data-table`. Unknown keys render nothing rather than a fallback
   * glyph, so a new entity server-side degrades quietly.
   */
  icon?: string
  /** Rendered instead of text/tag — the escape hatch for per-row action buttons. */
  node?: ReactNode
}

export type SubpageData = {
  kicker: string
  title: string
  sub: string
  cta: string
  stats: { label: string; value: string; sub: string }[]
  tableTitle: string
  cols: string
  headers: string[]
  rows: TableCell[][]
}

export type ChartBar = {
  label: string
  display: string
  height: number
}

export type NavChild = {
  label: string
  href: string
}

/**
 * No `badge` here. Counts come from the dashboard payload, keyed by `href` —
 * a literal in a nav config is a number that was true once and drifts
 * silently forever after. A parent's badge is the sum of its children's,
 * counted from that same payload for the same reason.
 */
export type NavItem = {
  label: string
  href: string
  icon: IconName
  /**
   * Present only where an item genuinely holds several different pages, each
   * with its own route. A page that holds three things as tabs behind one URL
   * cannot be linked to, and the back button does not move between them.
   *
   * Never one child: an item with a single child is worse than a plain link,
   * hiding a page behind a click for no reason. A parent with children
   * expands rather than navigating, so its own `href` is used only to decide
   * which group opens on load.
   */
  children?: NavChild[]
}

export type NavGroup = {
  label: string
  items: NavItem[]
}
