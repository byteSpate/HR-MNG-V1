import type { Role, SalesRole } from "@/lib/api/types"

import { ROLE_ROUTES } from "./role-routes"

/**
 * Where a person goes once they are signed in, and how the page they first
 * asked for is remembered on the way to the sign-in screen.
 *
 * The remembered page travels in the address bar (`/login?next=/employee/leave`),
 * so it is untrusted input. Two rules keep it harmless:
 *
 *   1. It must be a path on this site. Anything that could leave it, such as
 *      `//evil.com`, `https://...` or `/\evil.com`, is dropped, because
 *      following it after a sign-in would be an open redirect.
 *   2. It must be a page this person's role may open. A signed-in employee who
 *      follows a link to an admin page is sent to the employee dashboard,
 *      never to the admin page. The server refuses their data either way; this
 *      keeps them from landing on a screen that was never theirs.
 */

const MAX_LENGTH = 2000

/** The sign-in screens. Returning to one of them would loop. */
const AUTH_PAGES = ["/login", "/change-password", "/forgot-password", "/reset-password"]

/** Anything below a space, DEL, and the backslash some browsers read as a slash. */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/

const pathOf = (value: string) => value.split(/[?#]/)[0]

/** A path on this site that is safe to send a person to, or null. */
export function sanitizeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_LENGTH) return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  if (UNSAFE_CHARS.test(raw)) return null

  // One round of decoding, then the same checks: `/%2F%2Fevil.com` and
  // `/%5Cevil.com` mean `//evil.com` and `/\evil.com` to anything that decodes
  // the address before following it.
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (decoded.startsWith("//") || UNSAFE_CHARS.test(decoded)) return null

  const path = pathOf(raw)
  if (AUTH_PAGES.some((page) => path === page || path.startsWith(`${page}/`))) return null
  return raw
}

/** Whether a role's own area, or the Sales Hub for those who hold it, contains this path. */
export function roleMayOpen(user: { role: Role; salesRole: SalesRole | null }, path: string): boolean {
  const p = pathOf(path)
  const inArea = (prefix: string) => p === prefix || p.startsWith(`${prefix}/`)

  if (inArea(ROLE_ROUTES[user.role])) return true
  // The same rule the Sales Hub shell applies: a Super Admin, or anyone with a sales role.
  if (inArea("/sales")) return user.role === "SUPER_ADMIN" || !!user.salesRole
  return false
}

/**
 * The page to open after signing in.
 *
 * A temporary password comes first: it has to be replaced before anything
 * else, and the page that was asked for is carried through that screen in
 * `next`, so it is not lost on the way.
 */
export function postLoginPath(
  user: { role: Role; salesRole: SalesRole | null; mustChangePassword: boolean },
  next?: string | null,
): string {
  const safe = sanitizeNext(next)
  const asked = safe && roleMayOpen(user, safe) ? safe : null

  if (user.mustChangePassword) {
    return asked ? `/change-password?next=${encodeURIComponent(asked)}` : "/change-password"
  }
  return asked ?? ROLE_ROUTES[user.role]
}

/** The sign-in address that remembers where the person was going. */
export function loginPathFor(pathname: string, search = ""): string {
  const target = sanitizeNext(`${pathname}${search}`)
  return target && target !== "/" ? `/login?next=${encodeURIComponent(target)}` : "/login"
}

/** The remembered page, read back out of a query string. */
export function nextFromSearch(search: string): string | null {
  return sanitizeNext(new URLSearchParams(search).get("next"))
}

export type GuardDecision = { action: "wait" } | { action: "allow" } | { action: "go"; to: string }

/**
 * What a role's area does with a visitor. `area` is the area's root, such as
 * "/employee".
 *
 * `proxy.ts` can only see whether a cookie exists, never whose it is or
 * whether it still works, so this is where a stale cookie and a wrong role are
 * caught. While the session is still being checked nothing moves: sending a
 * person away before the answer is known would bounce a valid session.
 */
export function guardDecision(input: {
  status: "loading" | "authenticated" | "unauthenticated"
  user: { role: Role; salesRole: SalesRole | null; mustChangePassword: boolean } | null
  area: string
  pathname: string
  search: string
}): GuardDecision {
  const { status, user, area, pathname, search } = input
  if (status === "loading") return { action: "wait" }
  if (status === "unauthenticated") return { action: "go", to: loginPathFor(pathname, search) }
  if (!user) return { action: "wait" }
  if (roleMayOpen(user, area)) return { action: "allow" }
  return { action: "go", to: postLoginPath(user, null) }
}

export type LoginScreen = "checking" | "form"

/**
 * What the sign-in page draws.
 *
 * A person who is already signed in must never see the form: the session check
 * takes a moment, and a form that shows first and then jumps away looks like
 * the app does not know who they are. So while that check runs, and while a
 * signed-in person is being sent on, the page shows a loading screen instead.
 *
 * `hasRefreshCookie` comes from the server. The cookie is httpOnly, so the
 * browser cannot read it, but the server can. Without it the check would hold
 * every first-time visitor behind a loading screen for a network round trip,
 * when there is nothing to check.
 */
export function loginScreen(input: {
  status: "loading" | "authenticated" | "unauthenticated"
  hasRefreshCookie: boolean
}): LoginScreen {
  if (input.status === "unauthenticated") return "form"
  if (input.status === "authenticated") return "checking"
  return input.hasRefreshCookie ? "checking" : "form"
}
