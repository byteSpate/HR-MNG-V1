import { NextRequest, NextResponse } from "next/server"

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
    const loginUrl = new URL("/login", request.url)
    return NextResponse.redirect(loginUrl)
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
