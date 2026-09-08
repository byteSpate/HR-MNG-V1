import { describe, expect, it } from "vitest"

import { accountScopeFor, canManageAccount, ownedScopeFor } from "./sales.access"

/**
 * The function that decides who sees which accounts. Pure on purpose — the
 * user-to-employee lookup lives in `employeeIdFor` so these stay three lines
 * each and need no database.
 */
describe("accountScopeFor", () => {
  it("gives a Sales Admin everything", () => {
    expect(accountScopeFor({ role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as never, "emp-1")).toEqual({})
  })

  it("gives a Super Admin everything even with no employee row", () => {
    expect(accountScopeFor({ role: "SUPER_ADMIN", salesRole: null } as never, null)).toEqual({})
  })

  it("scopes a Sales User to owned and assigned accounts", () => {
    expect(accountScopeFor({ role: "EMPLOYEE", salesRole: "SALES_USER" } as never, "emp-1")).toEqual({
      OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }],
    })
  })

  // An HR Admin granted SALES_USER has no Employee row to own anything with.
  // Matching nothing is the honest answer; matching everything would be a
  // privilege escalation via a missing row.
  it("matches nothing for a Sales User with no employee row", () => {
    expect(accountScopeFor({ role: "EMPLOYEE", salesRole: "SALES_USER" } as never, null)).toEqual({
      id: "__none__",
    })
  })
})

/**
 * The scope behind "My Accounts". Its whole reason for existing is that it
 * does NOT bypass for an admin the way `accountScopeFor` does — an admin may
 * reach every account, but that is not the same as owning one.
 */
describe("ownedScopeFor", () => {
  it("scopes to owned and assigned accounts", () => {
    expect(ownedScopeFor("emp-1")).toEqual({
      OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }],
    })
  })

  // The bug this closes: "My Accounts" was rendering every account in the
  // company to a Super Admin, identical to "All Accounts", because the scope
  // it used answered a permission question rather than an ownership one.
  it("matches nothing for a caller with no employee row, admin or not", () => {
    expect(ownedScopeFor(null)).toEqual({ id: "__none__" })
  })
})

describe("canManageAccount", () => {
  const SALES_USER = { role: "EMPLOYEE", salesRole: "SALES_USER" } as never

  it("lets the owner manage their own account", () => {
    expect(canManageAccount(SALES_USER, "emp-1", "emp-1", [])).toBe(true)
  })

  it("lets an assignee manage the account they are on", () => {
    expect(canManageAccount(SALES_USER, "emp-2", "emp-1", ["emp-2"])).toBe(true)
  })

  // The read-only directory: visible to everyone in the hub, writable by few.
  it("refuses a Sales User who is neither owner nor assignee", () => {
    expect(canManageAccount(SALES_USER, "emp-3", "emp-1", ["emp-2"])).toBe(false)
  })

  it("lets a Sales Admin manage an account they have no part in", () => {
    expect(
      canManageAccount({ role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as never, "emp-3", "emp-1", [])
    ).toBe(true)
  })

  it("lets a Super Admin with no employee row manage an account", () => {
    expect(canManageAccount({ role: "SUPER_ADMIN", salesRole: null } as never, null, "emp-1", [])).toBe(
      true
    )
  })

  it("refuses a Sales User with no employee row", () => {
    expect(canManageAccount(SALES_USER, null, "emp-1", [])).toBe(false)
  })
})
