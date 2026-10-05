import assert from "node:assert/strict"
import test from "node:test"

import { guardDecision, loginPathFor, loginScreen, nextFromSearch, postLoginPath, roleMayOpen, sanitizeNext } from "./return-to"

const employee = { role: "EMPLOYEE", salesRole: null, mustChangePassword: false } as const
const manager = { role: "REPORTING_MANAGER", salesRole: null, mustChangePassword: false } as const
const hr = { role: "HR_ADMIN", salesRole: null, mustChangePassword: false } as const
const finance = { role: "FINANCE_OFFICER", salesRole: null, mustChangePassword: false } as const
const superAdmin = { role: "SUPER_ADMIN", salesRole: null, mustChangePassword: false } as const
const salesUser = { role: "EMPLOYEE", salesRole: "SALES_USER", mustChangePassword: false } as const

// ── sanitizeNext: only a path on this site is ever followed ──────────────────

test("keeps a path on this site, with its query and hash", () => {
  assert.equal(sanitizeNext("/employee/attendance"), "/employee/attendance")
  assert.equal(sanitizeNext("/employee/leave?tab=history"), "/employee/leave?tab=history")
  assert.equal(sanitizeNext("/sales/accounts/abc?tab=projects#top"), "/sales/accounts/abc?tab=projects#top")
})

test("says nothing for a missing or empty value", () => {
  assert.equal(sanitizeNext(null), null)
  assert.equal(sanitizeNext(undefined), null)
  assert.equal(sanitizeNext(""), null)
})

test("refuses anything that could leave this site", () => {
  for (const bad of [
    "//evil.com",
    "//evil.com/employee",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com/employee",
    "http://evil.com",
    "javascript:alert(1)",
    "data:text/html,x",
    "employee/attendance",
    "/%2F%2Fevil.com",
    "/%5Cevil.com",
  ]) {
    assert.equal(sanitizeNext(bad), null, bad)
  }
})

test("refuses control characters that could split a header or hide a scheme", () => {
  assert.equal(sanitizeNext("/employee\r\nSet-Cookie: x=1"), null)
  assert.equal(sanitizeNext("/emp\tloyee"), null)
  assert.equal(sanitizeNext("/employee\u0000"), null)
})

test("refuses the sign-in pages themselves, so a return can never loop", () => {
  assert.equal(sanitizeNext("/login"), null)
  assert.equal(sanitizeNext("/login?next=%2Femployee"), null)
  assert.equal(sanitizeNext("/change-password"), null)
  assert.equal(sanitizeNext("/forgot-password"), null)
  assert.equal(sanitizeNext("/reset-password?token=abc"), null)
})

test("refuses a very long value", () => {
  assert.equal(sanitizeNext("/employee/" + "a".repeat(2100)), null)
})

// ── roleMayOpen: a role opens its own area, never another's ─────────────────

test("an employee may open the employee area and nothing else", () => {
  assert.equal(roleMayOpen(employee, "/employee"), true)
  assert.equal(roleMayOpen(employee, "/employee/attendance"), true)
  assert.equal(roleMayOpen(employee, "/employee?x=1"), true)
  assert.equal(roleMayOpen(employee, "/employee/leave#top"), true)
  assert.equal(roleMayOpen(employee, "/admin"), false)
  assert.equal(roleMayOpen(employee, "/admin/payroll"), false)
  assert.equal(roleMayOpen(employee, "/hr/employees"), false)
  assert.equal(roleMayOpen(employee, "/finance"), false)
  assert.equal(roleMayOpen(employee, "/manager/team"), false)
})

test("a path that only starts with the same letters is a different area", () => {
  assert.equal(roleMayOpen(employee, "/employeeX"), false)
  assert.equal(roleMayOpen(employee, "/employees"), false)
  assert.equal(roleMayOpen(hr, "/hrx"), false)
})

test("each role opens its own area", () => {
  assert.equal(roleMayOpen(superAdmin, "/admin/users"), true)
  assert.equal(roleMayOpen(hr, "/hr/employees"), true)
  assert.equal(roleMayOpen(finance, "/finance/invoices"), true)
  assert.equal(roleMayOpen(manager, "/manager/team"), true)
})

test("no role opens another role's area, an administrator included", () => {
  assert.equal(roleMayOpen(superAdmin, "/hr"), false)
  assert.equal(roleMayOpen(hr, "/admin"), false)
  assert.equal(roleMayOpen(finance, "/hr/x"), false)
  assert.equal(roleMayOpen(manager, "/employee"), false)
})

test("the Sales Hub is for a Super Admin or anybody with a sales role", () => {
  assert.equal(roleMayOpen(salesUser, "/sales/accounts"), true)
  assert.equal(roleMayOpen(superAdmin, "/sales"), true)
  assert.equal(roleMayOpen(employee, "/sales/accounts"), false)
  assert.equal(roleMayOpen(hr, "/sales"), false)
})

test("a path that is not one of the areas is not opened", () => {
  assert.equal(roleMayOpen(employee, "/somewhere"), false)
  assert.equal(roleMayOpen(employee, "/"), false)
})

// ── postLoginPath: where to go once signed in ───────────────────────────────

test("goes to the page that was asked for, when the role may open it", () => {
  assert.equal(postLoginPath(employee, "/employee/attendance"), "/employee/attendance")
  assert.equal(postLoginPath(hr, "/hr/employees?tab=exits"), "/hr/employees?tab=exits")
  assert.equal(postLoginPath(salesUser, "/sales/accounts/abc"), "/sales/accounts/abc")
})

test("goes to the person's own dashboard when the page belongs to another role", () => {
  assert.equal(postLoginPath(employee, "/admin/payroll"), "/employee")
  assert.equal(postLoginPath(hr, "/finance"), "/hr")
  assert.equal(postLoginPath(manager, "/employee/attendance"), "/manager")
})

test("goes to the person's own dashboard when nothing was asked for", () => {
  assert.equal(postLoginPath(employee, null), "/employee")
  assert.equal(postLoginPath(superAdmin, undefined), "/admin")
  assert.equal(postLoginPath(finance, ""), "/finance")
})

test("goes to the dashboard when the address is not safe", () => {
  assert.equal(postLoginPath(employee, "//evil.com"), "/employee")
  assert.equal(postLoginPath(employee, "https://evil.com/employee"), "/employee")
})

test("a new password comes first, and the asked-for page is remembered through it", () => {
  const fresh = { ...employee, mustChangePassword: true }
  assert.equal(postLoginPath(fresh, null), "/change-password")
  assert.equal(
    postLoginPath(fresh, "/employee/attendance"),
    "/change-password?next=%2Femployee%2Fattendance",
  )
})

test("a new password does not carry a page the role may not open", () => {
  const fresh = { ...employee, mustChangePassword: true }
  assert.equal(postLoginPath(fresh, "/admin"), "/change-password")
})

// ── loginPathFor / nextFromSearch ───────────────────────────────────────────

test("the sign-in address remembers where the person was going", () => {
  assert.equal(loginPathFor("/employee/attendance", ""), "/login?next=%2Femployee%2Fattendance")
  assert.equal(
    loginPathFor("/employee/leave", "?tab=history"),
    "/login?next=%2Femployee%2Fleave%3Ftab%3Dhistory",
  )
})

test("the sign-in address stays plain when there is nothing worth remembering", () => {
  assert.equal(loginPathFor("/", ""), "/login")
  assert.equal(loginPathFor("/login", ""), "/login")
  assert.equal(loginPathFor("//evil.com", ""), "/login")
})

test("reads the remembered page back out of a query string, safely", () => {
  assert.equal(nextFromSearch("?next=%2Femployee%2Fattendance"), "/employee/attendance")
  assert.equal(nextFromSearch("next=%2Femployee"), "/employee")
  assert.equal(nextFromSearch("?next=%2F%2Fevil.com"), null)
  assert.equal(nextFromSearch("?other=1"), null)
  assert.equal(nextFromSearch(""), null)
})

// ── guardDecision: what a role's area does with a visitor ───────────────────

const at = (area: string, pathname: string, search = "") => ({ area, pathname, search })

test("waits while the session is still being checked, and does not move anyone", () => {
  assert.deepEqual(
    guardDecision({ status: "loading", user: null, ...at("/employee", "/employee/attendance") }),
    { action: "wait" },
  )
})

test("sends a signed-out visitor to sign in, remembering the page", () => {
  assert.deepEqual(
    guardDecision({ status: "unauthenticated", user: null, ...at("/employee", "/employee/attendance") }),
    { action: "go", to: "/login?next=%2Femployee%2Fattendance" },
  )
  assert.deepEqual(
    guardDecision({ status: "unauthenticated", user: null, ...at("/employee", "/employee/leave", "?tab=history") }),
    { action: "go", to: "/login?next=%2Femployee%2Fleave%3Ftab%3Dhistory" },
  )
})

test("lets a signed-in person into their own area", () => {
  assert.deepEqual(
    guardDecision({ status: "authenticated", user: employee, ...at("/employee", "/employee/attendance") }),
    { action: "allow" },
  )
  assert.deepEqual(
    guardDecision({ status: "authenticated", user: hr, ...at("/hr", "/hr/employees") }),
    { action: "allow" },
  )
})

test("sends a signed-in person who is in another role's area to their own dashboard", () => {
  assert.deepEqual(
    guardDecision({ status: "authenticated", user: employee, ...at("/admin", "/admin/payroll") }),
    { action: "go", to: "/employee" },
  )
  assert.deepEqual(
    guardDecision({ status: "authenticated", user: hr, ...at("/finance", "/finance/invoices") }),
    { action: "go", to: "/hr" },
  )
  assert.deepEqual(
    guardDecision({ status: "authenticated", user: superAdmin, ...at("/hr", "/hr/employees") }),
    { action: "go", to: "/admin" },
  )
})

test("waits when signed in but the person is not known yet", () => {
  assert.deepEqual(
    guardDecision({ status: "authenticated", user: null, ...at("/employee", "/employee") }),
    { action: "wait" },
  )
})

// ── loginScreen: the sign-in form never shows to a person who is signed in ───

test("shows a loading screen while a person with a refresh cookie is being checked", () => {
  assert.equal(loginScreen({ status: "loading", hasRefreshCookie: true }), "checking")
})

test("shows the form at once to a person with no refresh cookie", () => {
  assert.equal(loginScreen({ status: "loading", hasRefreshCookie: false }), "form")
})

test("keeps the loading screen while a signed-in person is sent on", () => {
  assert.equal(loginScreen({ status: "authenticated", hasRefreshCookie: true }), "checking")
  assert.equal(loginScreen({ status: "authenticated", hasRefreshCookie: false }), "checking")
})

test("shows the form once the session is known to be gone", () => {
  assert.equal(loginScreen({ status: "unauthenticated", hasRefreshCookie: true }), "form")
  assert.equal(loginScreen({ status: "unauthenticated", hasRefreshCookie: false }), "form")
})
