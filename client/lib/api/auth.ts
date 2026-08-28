import { apiFetch } from "./client"
import type { AccountIdentity, LoginResponse, PublicUser, SessionView } from "./types"

export function loginAdmin(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
}

export function loginStaff(employeeId: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/auth/staff-login", {
    method: "POST",
    body: JSON.stringify({ employeeId, password }),
  })
}

export function refreshSession(): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/auth/refresh", { method: "POST" })
}

export function logout(): Promise<void> {
  return apiFetch<void>("/api/auth/logout", { method: "POST" })
}

/**
 * Ends every session on the account, this one included.
 *
 * The caller is signed out as a result, so this belongs behind a confirm and
 * must be followed by the same local teardown `logout` gets — the access
 * token in memory outlives the cookie otherwise.
 */
export function logoutEverywhere(accessToken: string): Promise<void> {
  return apiFetch<void>("/api/auth/logout-all", { method: "POST", accessToken })
}

/**
 * Always resolves for a well-formed email, whether or not an account exists.
 * The server will not say which, so neither can the screen: a reset form that
 * answered "no such user" would be a membership oracle for anyone who can
 * reach the login page.
 */
export function forgotPassword(email: string): Promise<{ success: true }> {
  return apiFetch<{ success: true }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

/**
 * Unauthenticated by design: the token in the link is the credential, which is
 * the whole point of the flow. Succeeding revokes every refresh token the user
 * holds, so the caller must send them back to sign in rather than assume the
 * session it may have had is still good.
 *
 * A 400 here is always about the token (unknown, already used, expired) and
 * carries a message written for the person reading it.
 */
export function resetPassword(token: string, newPassword: string): Promise<{ success: true }> {
  return apiFetch<{ success: true }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  })
}

export function changePassword(
  accessToken: string,
  currentPassword: string,
  newPassword: string
): Promise<{ accessToken: string; user: PublicUser }> {
  return apiFetch("/api/auth/change-password", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

/* ── the account's own sessions and identity ─────────────────────────────── */

/**
 * Every live sign-in on this account, most recently used first.
 *
 * Self-scoped by the token; there is no id to pass and no way to read anyone
 * else's. The `current` flag is resolved server-side by hashing the caller's
 * own refresh cookie, which is why nothing here identifies it.
 */
export function listSessions(accessToken: string): Promise<SessionView[]> {
  return apiFetch<SessionView[]>("/api/auth/sessions", { accessToken })
}

/** Ends one other session. The server refuses the caller's own with a 409. */
export function revokeSession(accessToken: string, sessionId: string): Promise<void> {
  return apiFetch<void>(`/api/auth/sessions/${sessionId}`, { method: "DELETE", accessToken })
}

/** Null clears it, and the account shows its email again. */
export function setDisplayName(
  accessToken: string,
  displayName: string | null
): Promise<AccountIdentity> {
  return apiFetch<AccountIdentity>("/api/auth/me", {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ displayName }),
  })
}

export function uploadOwnAvatar(accessToken: string, file: File): Promise<{ avatarUrl: string }> {
  const form = new FormData()
  form.append("file", file)
  return apiFetch<{ avatarUrl: string }>("/api/auth/me/avatar", {
    method: "PATCH",
    accessToken,
    body: form,
  })
}

export function clearOwnAvatar(accessToken: string): Promise<{ avatarUrl: null }> {
  return apiFetch<{ avatarUrl: null }>("/api/auth/me/avatar", { method: "DELETE", accessToken })
}

// ── Changing the sign-in address ──────────────

export interface PendingEmailChange {
  newEmail: string
  /** Whether it has been approved from the current address yet. */
  approved: boolean
  expiresAt: string
}

/** Starts a change. Emails the address currently on file — not the new one. */
export function requestEmailChange(
  accessToken: string,
  newEmail: string
): Promise<PendingEmailChange> {
  return apiFetch<PendingEmailChange>("/api/auth/email-change", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ newEmail }),
  })
}

export function getPendingEmailChange(accessToken: string): Promise<PendingEmailChange | null> {
  return apiFetch<PendingEmailChange | null>("/api/auth/email-change", { accessToken })
}

/**
 * The three below take no access token on purpose.
 *
 * The link is the proof, and requiring a session as well would break the cases
 * these exist for — an approval read on a phone that is not signed in, or a
 * confirmation clicked from the new inbox after every session was revoked.
 */
export function approveEmailChange(token: string): Promise<{ newEmail: string }> {
  return apiFetch<{ newEmail: string }>("/api/auth/email-change/approve", {
    method: "POST",
    body: JSON.stringify({ token }),
  })
}

export function cancelEmailChange(token: string): Promise<void> {
  return apiFetch<void>("/api/auth/email-change/cancel", {
    method: "POST",
    body: JSON.stringify({ token }),
  })
}

export function confirmEmailChange(token: string): Promise<{ email: string }> {
  return apiFetch<{ email: string }>("/api/auth/email-change/confirm", {
    method: "POST",
    body: JSON.stringify({ token }),
  })
}
