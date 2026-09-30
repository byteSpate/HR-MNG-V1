import type { PublicUser } from "@/lib/api/types"

/**
 * Renewing the access token, one renewal at a time.
 *
 * The access token lives only in memory and is short-lived, so it expires
 * while a page is open. The refresh cookie is what lets the app get another.
 * That cookie is single-use: every renewal spends it and hands back a new one.
 * So two renewals started with the same cookie, from two failed requests, two
 * tabs, or a page that mounts twice, make the second one fail, and a failed
 * renewal looks exactly like being signed out.
 *
 * Two layers stop that:
 *   - within a tab, callers that arrive while a renewal is running share it;
 *   - across tabs, renewals take turns on a browser lock, and the second tab
 *     then renews with the cookie the first one just set.
 *
 * This file must not import `client.ts`, which imports this one.
 */

export type RenewResult =
  | { ok: true; accessToken: string; user: PublicUser }
  /** The refresh cookie is missing, spent, revoked or expired: the person is signed out. */
  | { ok: false; reason: "signed-out" }
  /** The server could not be reached. This says nothing about the session. */
  | { ok: false; reason: "unreachable" }

type Listener = (result: RenewResult) => void

export function createRenewer(deps: {
  refresh: () => Promise<RenewResult>
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
}) {
  const listeners = new Set<Listener>()
  let inFlight: Promise<RenewResult> | null = null

  function renew(): Promise<RenewResult> {
    if (inFlight) return inFlight
    inFlight = deps
      .withLock(async () => {
        try {
          return await deps.refresh()
        } catch {
          return { ok: false, reason: "unreachable" } as RenewResult
        }
      })
      .then((result) => {
        // A renewal that never reached the server proves nothing about the
        // session, so nobody is told and nobody is signed out because of it.
        if (result.ok || result.reason === "signed-out") {
          for (const listener of listeners) listener(result)
        }
        return result
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return { renew, subscribe }
}

/** One browser lock, shared by every tab of this site. Where there is none, renewals still share a flight. */
function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined
  return locks ? (locks.request("byteSpate-session-renewal", () => fn()) as Promise<T>) : fn()
}

async function callRefreshEndpoint(): Promise<RenewResult> {
  try {
    // Same-origin on purpose: this path goes through the Next rewrite, which is
    // what keeps the refresh cookie first-party (see `resolveBase` in client.ts).
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
    if (res.ok) {
      const body = (await res.json()) as { accessToken: string; user: PublicUser }
      return { ok: true, accessToken: body.accessToken, user: body.user }
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "signed-out" }
    return { ok: false, reason: "unreachable" }
  } catch {
    return { ok: false, reason: "unreachable" }
  }
}

const renewer = createRenewer({ refresh: callRefreshEndpoint, withLock: withBrowserLock })

/** Gets a new access token with the refresh cookie. Safe to call from anywhere, at any time. */
export const renewSession = renewer.renew

/** Hears every renewal that settles the question: a new session, or none. */
export const onSessionRenewed = renewer.subscribe
