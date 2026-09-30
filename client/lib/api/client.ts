import { renewSession } from "@/lib/auth/token-refresh"

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * Extra fields the server sent alongside `error`. The payroll preflight's
     * 409 carries a `blockers` array here, and the bank file's carries
     * `missingBankDetails` — discarding either would turn a checklist the
     * user can act on into a bare string.
     */
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = "ApiError"
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

/**
 * Auth calls go through the Next rewrite in next.config.ts, so they must be
 * same-origin — that is what makes the refresh cookie first-party. Everything
 * else goes straight to the API with a Bearer token.
 */
export function resolveBase(path: string): string {
  return path.startsWith("/api/auth/") ? "" : API_URL
}

function toApiError(status: number, body: unknown): ApiError {
  const { error, ...details } = (body ?? {}) as Record<string, unknown>
  return new ApiError(
    status,
    typeof error === "string" ? error : "Request failed",
    Object.keys(details).length > 0 ? details : undefined
  )
}

/**
 * Sends a request, and if the server says the access token has expired, gets a
 * new one with the refresh cookie and sends it once more.
 *
 * The access token lives only in memory and is short-lived, so it expires
 * while a page is open. Without this every request after that failed with a
 * 401 until the person reloaded the page. It is tried once: a request refused
 * for a real reason must not loop, and a call that carries no token (a wrong
 * password) has nothing to renew. If the session cannot be renewed the first
 * answer is returned untouched, and the session provider hears about it and
 * sends the person to sign in.
 */
async function requestWithRenewal(
  path: string,
  rest: RequestInit,
  accessToken: string | undefined,
  headersFor: (token: string | undefined) => HeadersInit
): Promise<Response> {
  const send = (token: string | undefined) =>
    fetch(`${resolveBase(path)}${path}`, { ...rest, credentials: "include", headers: headersFor(token) })

  const first = await send(accessToken)
  if (first.status !== 401 || !accessToken) return first

  const renewed = await renewSession()
  return renewed.ok ? send(renewed.accessToken) : first
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { accessToken?: string } = {}
): Promise<T> {
  const { accessToken, headers, ...rest } = options

  // The browser sets Content-Type itself for a FormData body, including the
  // multipart boundary. Setting it explicitly here would produce a request
  // the server can't parse, since the boundary would be missing.
  const isFormData = typeof FormData !== "undefined" && rest.body instanceof FormData

  const res = await requestWithRenewal(path, rest, accessToken, (token) => ({
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  }))

  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw toApiError(res.status, body)
  }

  return body as T
}

/**
 * A binary response — the bank-file CSV. `apiFetch` cannot express this
 * because it always parses JSON, and a CSV parsed as JSON is a thrown error.
 */
export async function apiFetchBlob(
  path: string,
  options: RequestInit & { accessToken?: string } = {}
): Promise<{ blob: Blob; headers: Headers }> {
  const { accessToken, headers, ...rest } = options

  const res = await requestWithRenewal(path, rest, accessToken, (token) => ({
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  }))

  if (!res.ok) {
    // An error response is still JSON, even on a route that normally returns
    // a file — so the blockers / missingBankDetails list survives.
    throw toApiError(res.status, await res.json().catch(() => ({})))
  }

  return { blob: await res.blob(), headers: res.headers }
}
