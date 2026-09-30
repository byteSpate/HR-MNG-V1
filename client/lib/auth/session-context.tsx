"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"

import { logout as apiLogout } from "@/lib/api/auth"
import type { PublicUser } from "@/lib/api/types"
import { onSessionRenewed, renewSession } from "@/lib/auth/token-refresh"

type SessionStatus = "loading" | "authenticated" | "unauthenticated"

interface SessionContextValue {
  user: PublicUser | null
  accessToken: string | null
  status: SessionStatus
  setSession: (accessToken: string, user: PublicUser) => void
  clearSession: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [status, setStatus] = useState<SessionStatus>("loading")

  useEffect(() => {
    let cancelled = false

    // Every renewal that settles the question, wherever it started: the one
    // below when the page opens, or one an API call made when its token had
    // expired. A new session replaces the token in memory. "Signed out" means
    // the refresh cookie is spent or gone, so the session ends here and the
    // guards send the person to sign in.
    const stop = onSessionRenewed((result) => {
      if (cancelled) return
      if (result.ok) {
        setAccessToken(result.accessToken)
        setUser(result.user)
        setStatus("authenticated")
      } else {
        setAccessToken(null)
        setUser(null)
        setStatus("unauthenticated")
      }
    })

    // Shares one renewal with any other caller, so a page that mounts twice
    // (React does this in development) does not spend the cookie twice.
    renewSession().then((result) => {
      if (!cancelled && !result.ok) setStatus("unauthenticated")
    })

    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const setSession = useCallback((token: string, sessionUser: PublicUser) => {
    setAccessToken(token)
    setUser(sessionUser)
    setStatus("authenticated")
  }, [])

  const clearSession = useCallback(async () => {
    await apiLogout().catch(() => {})
    setAccessToken(null)
    setUser(null)
    setStatus("unauthenticated")
  }, [])

  return (
    <SessionContext.Provider value={{ user, accessToken, status, setSession, clearSession }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider")
  }
  return ctx
}
