import { EmploymentStatus, SalesRole } from "../../generated/prisma/client"
import { formatDateOnly } from "../../utils/dates"
import { officeDateOf } from "../attendance/attendance.time"

/**
 * What the hub needs to know about one person's standing.
 *
 * Grouped rather than passed as loose arguments: every rule below needs all
 * four, and three of them are booleans and dates that are easy to hand over
 * in the wrong order without the compiler noticing.
 */
export interface SalesStanding {
  salesRole: SalesRole | null
  employmentStatus: EmploymentStatus | null
  /** Set the moment an exit is recorded, which may be weeks ahead. */
  lastWorkingDay: Date | null
  /** `User.isActive` — whether the login works at all. */
  loginActive: boolean
}

/**
 * Whether someone's employment still entitles them to the Techno Sales Hub.
 *
 * Leaving ends hub access — but not before they have actually left.
 * `setExitDetails` flips `employmentStatus` to RESIGNED/TERMINATED the moment
 * an exit is recorded, which is routinely weeks before the person stops
 * working. Status alone would therefore cut somebody off mid-notice-period,
 * on exactly the accounts they are trying to hand over. `lastWorkingDay` is
 * authoritative when set, matching `attendance.grid.ts`, which clips a
 * leaver's grid at the same boundary for the same reason.
 *
 * `ON_LEAVE` deliberately keeps access — maternity or sick leave is an
 * absence, not a departure, and locking someone out while they are away would
 * strand every account they own.
 *
 * A `null` status covers a login with no Employee row at all: Super Admin and
 * HR Admin are seeded that way. They never resigned, so nothing here revokes
 * them, and `requireSales` decides their access on role alone.
 */
export function employmentAllowsSales(
  status: EmploymentStatus | null,
  lastWorkingDay: Date | null = null,
  now: Date = new Date()
): boolean {
  if (status !== EmploymentStatus.RESIGNED && status !== EmploymentStatus.TERMINATED) {
    return true
  }
  // No recorded exit date on a leaver means the departure already happened
  // and nobody wrote it down — the same fallback attendance makes.
  if (!lastWorkingDay) return false
  // Compared as calendar dates, not instants: access lasts through the whole
  // of the last working day, not up to midnight at the start of it.
  return formatDateOnly(lastWorkingDay) >= formatDateOnly(officeDateOf(now))
}

/**
 * The sales role a freshly minted token should actually carry.
 *
 * The stored `salesRole` is deliberately left alone when somebody resigns: it
 * records what HR granted, it survives a re-hire, and clearing it would lose
 * that fact. So the row keeps saying SALES_USER while this returns null, and
 * the token is what the door reads.
 *
 * Consequence worth knowing: this is evaluated when a token is minted, not on
 * every request, so a resignation processed mid-session takes effect at the
 * next refresh — inside the 15-minute access-token lifetime. That is the same
 * staleness every other claim in the token already carries, `role` included.
 */
export function effectiveSalesRole(
  salesRole: SalesRole | null,
  employmentStatus: EmploymentStatus | null,
  lastWorkingDay: Date | null = null
): SalesRole | null {
  return employmentAllowsSales(employmentStatus, lastWorkingDay) ? salesRole : null
}

/**
 * Whether this person can actually work an account right now.
 *
 * Three independent facts have to line up, and each fails differently:
 * a granted role, employment that has not ended, and a login that still
 * works. `User.isActive` is deliberately separate from `employmentStatus`
 * throughout this codebase — a current employee can have a disabled login and
 * a leaver can keep a live one — so neither implies the other and both are
 * checked.
 */
export function canWorkAccounts(standing: SalesStanding, now: Date = new Date()): boolean {
  return (
    standing.salesRole !== null &&
    standing.loginActive &&
    employmentAllowsSales(standing.employmentStatus, standing.lastWorkingDay, now)
  )
}

/**
 * Who may be named an owner or a collaborator on a Sales Account.
 *
 * Sales Users only. A Sales Admin administers the hub rather than carrying
 * accounts inside it, so they are not offered by the pickers and are refused
 * by `createSalesAccount`.
 *
 * This governs *new* assignments only. Someone who owned accounts before
 * being promoted to Sales Admin keeps them: the account still has a real
 * owner, an admin can manage everything regardless, and rewriting history to
 * satisfy the rule would cost more than it buys.
 */
export function canBeAccountOwner(standing: SalesStanding, now: Date = new Date()): boolean {
  return standing.salesRole === SalesRole.SALES_USER && canWorkAccounts(standing, now)
}
