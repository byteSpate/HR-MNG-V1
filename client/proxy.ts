import { NextRequest, NextResponse } from "next/server"

import { loginPathFor } from "@/lib/auth/return-to"

// /sales is a role-agnostic route group (entered by salesRole, not by Role),
// but the cookie-presence check below does not care — it only needs a prefix
// to guard.
const PROTECTED_PREFIXES = ["/admin", "/hr", "/finance", "/manager", "/employee", "/sales"]

export function proxy(request: NextRequest) {
  const isProtected = PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))
  if (!isProtected) {
    return NextResponse.next()
  }

  const hasRefreshCookie = request.cookies.has("refreshToken")
  if (!hasRefreshCookie) {
    // Remember the page that was asked for, so signing in can bring the person
    // to it instead of to their dashboard. Only a path on this site is kept.
    const { pathname, search } = request.nextUrl
    return NextResponse.redirect(new URL(loginPathFor(pathname, search), request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/hr/:path*",
    "/finance/:path*",
    "/manager/:path*",
    "/employee/:path*",
    "/sales/:path*",
  ],
}
