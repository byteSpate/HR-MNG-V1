import assert from "node:assert/strict"
import test, { beforeEach } from "node:test"

import { onSessionRenewed, type RenewResult } from "../auth/token-refresh"
import { ApiError, apiFetch, apiFetchBlob } from "./client"

type Call = { url: string; auth: string | null; body: unknown }
let calls: Call[] = []
let handlers: Array<(call: Call) => Response> = []

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const REFRESHED = () => json(200, { accessToken: "fresh", user: { id: "u1" } })
const isRefresh = (c: Call) => c.url.endsWith("/api/auth/refresh")

beforeEach(() => {
  calls = []
  handlers = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const call: Call = { url: String(input), auth: headers.get("authorization"), body: init?.body }
    calls.push(call)
    const next = handlers.shift()
    if (!next) throw new Error(`unexpected request to ${call.url}`)
    return next(call)
  }) as typeof fetch
})

test("renews an expired token once and repeats the request with the new one", async () => {
  handlers = [
    () => json(401, { error: "Invalid or expired token" }),
    () => REFRESHED(),
    () => json(200, { hello: "world" }),
  ]
  const data = await apiFetch<{ hello: string }>("/api/things", { accessToken: "stale" })
  assert.deepEqual(data, { hello: "world" })
  assert.deepEqual(calls.map((c) => c.auth), ["Bearer stale", null, "Bearer fresh"])
  assert.ok(isRefresh(calls[1]))
})

test("renews only once when several requests fail together", async () => {
  let refreshes = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const auth = new Headers(init?.headers).get("authorization")
    if (url.endsWith("/api/auth/refresh")) {
      refreshes++
      await new Promise((r) => setTimeout(r, 15))
      return REFRESHED()
    }
    return auth === "Bearer fresh" ? json(200, { ok: url }) : json(401, { error: "Invalid or expired token" })
  }) as typeof fetch

  const results = await Promise.all([
    apiFetch("/api/a", { accessToken: "stale" }),
    apiFetch("/api/b", { accessToken: "stale" }),
    apiFetch("/api/c", { accessToken: "stale" }),
  ])
  assert.equal(refreshes, 1)
  assert.equal(results.length, 3)
})

test("gives up with the original error when the session cannot be renewed, and tells the app it is signed out", async () => {
  const heard: RenewResult[] = []
  const stop = onSessionRenewed((r) => heard.push(r))
  handlers = [() => json(401, { error: "Invalid or expired token" }), () => json(401, { error: "Refresh token has been revoked" })]
  await assert.rejects(
    apiFetch("/api/things", { accessToken: "stale" }),
    (err: unknown) => err instanceof ApiError && err.status === 401 && err.message === "Invalid or expired token",
  )
  stop()
  assert.equal(calls.length, 2)
  assert.deepEqual(heard, [{ ok: false, reason: "signed-out" }])
})

test("does not sign anyone out when the server could not be reached", async () => {
  const heard: RenewResult[] = []
  const stop = onSessionRenewed((r) => heard.push(r))
  handlers = [() => json(401, { error: "Invalid or expired token" }), () => json(503, { error: "down" })]
  await assert.rejects(apiFetch("/api/things", { accessToken: "stale" }), (e: unknown) => e instanceof ApiError && e.status === 401)
  stop()
  assert.deepEqual(heard, [])
})

test("repeats a request only once, so a real refusal cannot loop", async () => {
  handlers = [() => json(401, { error: "nope" }), () => REFRESHED(), () => json(401, { error: "still nope" })]
  await assert.rejects(apiFetch("/api/things", { accessToken: "stale" }), (e: unknown) => e instanceof ApiError && e.message === "still nope")
  assert.equal(calls.length, 3)
})

test("does not try to renew for a call that carries no token, such as a wrong password", async () => {
  handlers = [() => json(401, { error: "Invalid email or password" })]
  await assert.rejects(
    apiFetch("/api/auth/login", { method: "POST", body: "{}" }),
    (e: unknown) => e instanceof ApiError && e.message === "Invalid email or password",
  )
  assert.equal(calls.length, 1)
})

test("does not renew for an error that is not a 401", async () => {
  handlers = [() => json(403, { error: "Not allowed" })]
  await assert.rejects(apiFetch("/api/things", { accessToken: "t" }), (e: unknown) => e instanceof ApiError && e.status === 403)
  assert.equal(calls.length, 1)
})

test("sends an uploaded file again, whole, when it repeats the request", async () => {
  handlers = [() => json(401, { error: "expired" }), () => REFRESHED(), () => json(200, { saved: true })]
  const form = new FormData()
  form.append("file", new Blob(["x"]), "card.png")
  await apiFetch("/api/upload", { method: "PUT", body: form, accessToken: "stale" })
  assert.equal(calls[0].body, form)
  assert.equal(calls[2].body, form)
})

test("a file download renews and repeats in the same way", async () => {
  handlers = [
    () => json(401, { error: "expired" }),
    () => REFRESHED(),
    () => new Response("a,b\n1,2", { status: 200, headers: { "content-type": "text/csv" } }),
  ]
  const { blob } = await apiFetchBlob("/api/export", { accessToken: "stale" })
  assert.equal(await blob.text(), "a,b\n1,2")
  assert.deepEqual(calls.map((c) => c.auth), ["Bearer stale", null, "Bearer fresh"])
})
