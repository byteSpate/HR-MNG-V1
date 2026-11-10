import type { NextConfig } from "next";

/**
 * Auth endpoints are proxied through this app rather than called directly.
 *
 * The client is on vercel.app and the API on herokuapp.com — separate
 * registrable domains, so a refresh cookie set directly by the API would be a
 * third-party cookie: blocked by Safari today, deprecated in Chrome. Proxying
 * makes the browser see the Set-Cookie as coming from this origin, so the
 * cookie is first-party and `proxy.ts` can still see it.
 *
 * Only /api/auth/* is proxied. Uploads run to 15MB and Vercel caps proxied
 * request bodies well below that; every other route calls the API directly
 * with a Bearer token, which needs no cookie.
 */
const nextConfig: NextConfig = {
  // Next's dev server rejects cross-origin requests (HMR websocket, RSC
  // fetches on client-side navigation) by default — only same-origin
  // localhost is trusted. A `trycloudflare.com` quick tunnel serves the app
  // under a different, randomly-generated hostname each run, so without this
  // every click after the first SSR page load gets torn down as unauthorized.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // The statement pages were reorganised on 2026-11-09: the three-tab
  // "Financial statements" page became three pages, "Policy notes" merged
  // into "Notes", and the Annexure-A page went (the schedule is still in the
  // PDF). Old bookmarks land on the nearest page instead of a 404. The query
  // string (?from=&to=) is passed through by Next.
  async redirects() {
    return [
      {
        source: "/:role(admin|finance)/accounting/statements",
        destination: "/:role/statements/income-statement",
        permanent: false,
      },
      {
        source: "/:role(admin|finance)/statements/policy-notes",
        destination: "/:role/statements/notes",
        permanent: false,
      },
      {
        source: "/:role(admin|finance)/statements/annexure-a",
        destination: "/:role/statements/balance-sheet",
        permanent: false,
      },
    ]
  },
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN
    if (!apiOrigin) {
      // NODE_ENV is "production" for a developer's local `next build` too, so
      // gating on that would break local production builds. VERCEL_ENV is
      // only set by Vercel's own build, and only "production" is the
      // real deploy — without this, a missing API_ORIGIN silently drops the
      // rewrite and /api/auth/* 404s to an HTML page at runtime instead,
      // which is exactly the "broken and nobody notices" failure mode this
      // branch exists to fix.
      if (process.env.VERCEL_ENV === "production") {
        throw new Error("API_ORIGIN is required: /api/auth/* cannot be proxied without it")
      }
      return []
    }
    // A trailing slash on API_ORIGIN would otherwise double up into
    // "…//api/auth/...", 404-ing every auth call.
    const origin = apiOrigin.replace(/\/$/, "")
    return [
      {
        source: "/api/auth/:path*",
        destination: `${origin}/api/auth/:path*`,
      },
    ]
  },
};

export default nextConfig;
