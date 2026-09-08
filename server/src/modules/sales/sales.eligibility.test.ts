import { describe, expect, it } from "vitest"

import {
  canBeAccountOwner,
  canWorkAccounts,
  effectiveSalesRole,
  employmentAllowsSales,
} from "./sales.eligibility"

/**
 * Pure rules, so these need no database. The behaviour they guard is the one
 * found in manual testing: Ayesha had resigned, still held SALES_USER, still
 * owned an account, and could still open the hub.
 */
describe("employmentAllowsSales", () => {
  it("allows a current employee", () => {
    expect(employmentAllowsSales("ACTIVE")).toBe(true)
  })

  // An absence, not a departure. Locking someone out while they are away
  // would strand every account they own.
  it("allows someone on leave", () => {
    expect(employmentAllowsSales("ON_LEAVE")).toBe(true)
  })

  // No exit date recorded means the departure already happened and nobody
  // wrote it down — the same fallback attendance.grid.ts makes.
  it("refuses a leaver with no recorded last working day", () => {
    expect(employmentAllowsSales("RESIGNED")).toBe(false)
    expect(employmentAllowsSales("TERMINATED")).toBe(false)
  })

  /**
   * setExitDetails flips employmentStatus the moment an exit is agreed, which
   * is routinely weeks before the person stops working. Cutting access off at
   * that moment strands them mid-handover, on exactly the accounts they are
   * trying to hand over.
   */
  it("keeps access through a notice period", () => {
    const today = new Date("2026-09-08T09:00:00.000Z")
    const inAMonth = new Date("2026-10-31T00:00:00.000Z")

    expect(employmentAllowsSales("RESIGNED", inAMonth, today)).toBe(true)
  })

  // Through the whole of the last day, not up to midnight at the start of it.
  it("keeps access on the last working day itself", () => {
    const lastDay = new Date("2026-09-08T00:00:00.000Z")
    const thatAfternoon = new Date("2026-09-08T17:30:00.000Z")

    expect(employmentAllowsSales("RESIGNED", lastDay, thatAfternoon)).toBe(true)
  })

  it("refuses once the last working day has passed", () => {
    const lastDay = new Date("2026-09-07T00:00:00.000Z")
    const nextMorning = new Date("2026-09-08T09:00:00.000Z")

    expect(employmentAllowsSales("RESIGNED", lastDay, nextMorning)).toBe(false)
  })

  it("uses the office date when UTC is still on the previous day", () => {
    const lastDay = new Date("2026-09-07T00:00:00.000Z")
    // 01:00 on 8 September in Asia/Dhaka, while UTC still says 7 September.
    const afterMidnightAtTheOffice = new Date("2026-09-07T19:00:00.000Z")

    expect(employmentAllowsSales("RESIGNED", lastDay, afterMidnightAtTheOffice)).toBe(false)
  })

  // Super Admin and HR Admin are seeded with no Employee row. They never
  // resigned, so nothing here should revoke them.
  it("allows a login with no employee record", () => {
    expect(employmentAllowsSales(null)).toBe(true)
  })
})

describe("effectiveSalesRole", () => {
  it("carries the granted role for a current employee", () => {
    expect(effectiveSalesRole("SALES_USER", "ACTIVE")).toBe("SALES_USER")
  })

  // The stored row still says SALES_USER — this only decides what the token
  // carries, so the grant survives a re-hire.
  it("strips the role from someone who has left", () => {
    expect(effectiveSalesRole("SALES_USER", "RESIGNED")).toBeNull()
    expect(effectiveSalesRole("SALES_ADMIN", "TERMINATED")).toBeNull()
  })

  it("leaves an administrative login alone", () => {
    expect(effectiveSalesRole("SALES_ADMIN", null)).toBe("SALES_ADMIN")
  })

  it("stays null when nothing was granted", () => {
    expect(effectiveSalesRole(null, "ACTIVE")).toBeNull()
  })
})

/** An employed Sales User with a working login, for tests to vary one axis of. */
const ELIGIBLE = {
  salesRole: "SALES_USER",
  employmentStatus: "ACTIVE",
  lastWorkingDay: null,
  loginActive: true,
} as const

describe("canBeAccountOwner", () => {
  it("allows an employed Sales User", () => {
    expect(canBeAccountOwner({ ...ELIGIBLE })).toBe(true)
  })

  // Admins administer the hub rather than carrying accounts in it.
  it("refuses a Sales Admin", () => {
    expect(canBeAccountOwner({ ...ELIGIBLE, salesRole: "SALES_ADMIN" })).toBe(false)
  })

  it("refuses a Sales User who has left", () => {
    expect(canBeAccountOwner({ ...ELIGIBLE, employmentStatus: "RESIGNED" })).toBe(false)
  })

  it("refuses somebody with no hub access at all", () => {
    expect(canBeAccountOwner({ ...ELIGIBLE, salesRole: null })).toBe(false)
  })

  // A deactivated login cannot authenticate at all, so an account owned by
  // one is answerable to somebody who can never open it. `isActive` and
  // `employmentStatus` are independent facts — neither implies the other.
  it("refuses a current employee whose login has been deactivated", () => {
    expect(canBeAccountOwner({ ...ELIGIBLE, loginActive: false })).toBe(false)
  })
})

describe("canWorkAccounts", () => {
  it("needs all three of role, employment and a working login", () => {
    expect(canWorkAccounts({ ...ELIGIBLE })).toBe(true)
    expect(canWorkAccounts({ ...ELIGIBLE, salesRole: null })).toBe(false)
    expect(canWorkAccounts({ ...ELIGIBLE, loginActive: false })).toBe(false)
    expect(canWorkAccounts({ ...ELIGIBLE, employmentStatus: "TERMINATED" })).toBe(false)
  })

  // Capability, not ownership — unlike canBeAccountOwner it does not care
  // which role, because a Sales Admin works every account.
  it("accepts a Sales Admin", () => {
    expect(canWorkAccounts({ ...ELIGIBLE, salesRole: "SALES_ADMIN" })).toBe(true)
  })
})
