"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { nextFromSearch, postLoginPath } from "@/lib/auth/return-to"
import { useSession } from "@/lib/auth/session-context"

/**
 * Draws nothing. If the person opening the sign-in page already has a working
 * session, it sends them on to the page they were heading for (or their own
 * dashboard), so a valid session never has to look at a login form.
 */
export function AlreadySignedIn() {
  const router = useRouter()
  const { user, status } = useSession()

  useEffect(() => {
    if (status === "authenticated" && user) {
      router.replace(postLoginPath(user, nextFromSearch(window.location.search)))
    }
  }, [status, user, router])

  return null
}
