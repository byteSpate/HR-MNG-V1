/**
 * The shape of a role's landing page.
 *
 * `Tone`, `ChartBar`, `TableCell` and `ActivityItem` are re-declared here
 * rather than imported: they live in `client/components/dashboard/types.ts`
 * and there is no shared package between the two projects. Hand-mirroring is
 * the established deliberate choice in this repo (see `CLAUDE.md`), the same
 * one the `Role` union already follows.
 */

import type { Role } from "../../generated/prisma/client"

export type Tone = "green" | "yellow" | "red" | "neutral"

export interface ChartBar {
  label: string
  /** What the bar reads as. Empty for a month nobody was paid in. */
  display: string
  /** 0–100. */
  height: number
}

export interface TableCell {
  text?: string
  sub?: string
  weight?: number
  tag?: string
  tone?: Tone
  /**
   * An `AuditEntity`-shaped key the client maps to a glyph. A name, never a
   * component or an SVG: the server has no view layer, and shipping markup
   * from here would put presentation in two places.
   */
  icon?: string
}

export interface ActivityItem {
  initial: string
  tone: Tone
  title: string
  meta: string
  status?: string
  statusTone?: Tone
  time: string
}

export interface DashboardStat {
  label: string
  /** Pre-formatted for display, money included. Never a raw number. */
  value: string
  sub: string
  tag: string
  tone: Tone
  /**
   * A real 5-or-6 point series, or absent. Only three families of stat can
   * have one — headcount, payroll totals and attendance rate — because
   * everything else here is current-state with no stored history. Absent
   * means "no series exists", never "not loaded", and never a row of zeros:
   * a fake sparkline is worse than none, being indistinguishable from a real
   * one.
   */
  trend?: number[]
  hotBar?: number
  href?: string
  /**
   * This card's query failed. `value` and `sub` are placeholders and the
   * client renders an error state for this card while its siblings render
   * normally.
   */
  failed?: boolean
  /**
   * What the stat is about, as a meaning ("target", "margin"), never an icon
   * component name. The client's card maps it to an icon; an unknown meaning
   * renders none. Absent on the role dashboards, which keep their old look.
   */
  icon?: string
  /**
   * The labelled row the stat sits in, when a page groups its stats
   * ("This quarter"). Consecutive stats sharing one are drawn together.
   */
  group?: string
}

export interface TimeClockState {
  checkedIn: boolean
  /**
   * The server's instant, office-local. The client ticks its display from
   * this and **never** seeds it from `new Date()`: lateness is decided
   * server-side against the shift, and a browser clock four minutes fast
   * turns an on-time check-in into a visibly late one.
   */
  serverNow: string
  /** From the employee's assigned shift, never a hardcoded string. */
  shift: string
  checkIn: string | null
  checkOut: string | null
  hoursToday: number | null
  canCheckIn: boolean
  canCheckOut: boolean
  /** Why today is not a working day, when it is not. */
  detail: string | null
}

export interface DashboardPayload {
  role: Role
  greeting: {
    kicker: string
    heading: string
    sub: string
    cta: { label: string; href: string }
  }
  /** Exactly four. */
  stats: DashboardStat[]
  chart?: { title: string; sub: string; bars: ChartBar[] }
  table?: { title: string; headers: string[]; rows: TableCell[][]; href: string }
  feed?: ActivityItem[]
  timeClock?: TimeClockState
  /**
   * Nav badge counts keyed by nav href, e.g. `{ "/hr/leave": 8 }`. The same
   * numbers as the cards, computed once — two sources drift, and the one
   * that drifts is always the one nobody is looking at.
   */
  badges: Record<string, number>
}
