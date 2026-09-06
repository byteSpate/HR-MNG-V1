import { describe, expect, it } from "vitest"

import { accountScopeFor } from "./sales.access"

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
