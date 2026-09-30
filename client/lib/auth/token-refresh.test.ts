import assert from "node:assert/strict"
import test from "node:test"

import { createRenewer, type RenewResult } from "./token-refresh"

const OK: RenewResult = { ok: true, accessToken: "new-token", user: { id: "u1" } as never }
const SIGNED_OUT: RenewResult = { ok: false, reason: "signed-out" }
const UNREACHABLE: RenewResult = { ok: false, reason: "unreachable" }
const noLock = <T,>(fn: () => Promise<T>) => fn()

test("many callers at once share a single renewal", async () => {
  let calls = 0
  const renewer = createRenewer({
    refresh: async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return OK
    },
    withLock: noLock,
  })
  const results = await Promise.all([renewer.renew(), renewer.renew(), renewer.renew()])
  assert.equal(calls, 1)
  assert.ok(results.every((r) => r.ok && r.accessToken === "new-token"))
})

test("a later renewal is a new one, not the finished one again", async () => {
  let calls = 0
  const renewer = createRenewer({ refresh: async () => (calls++, OK), withLock: noLock })
  await renewer.renew()
  await renewer.renew()
  assert.equal(calls, 2)
})

test("takes its turn on the lock, so two tabs never spend the same token", async () => {
  const order: string[] = []
  // A lock that lets one holder in at a time, like the browser's.
  let tail: Promise<unknown> = Promise.resolve()
  const lock = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn)
    tail = run.catch(() => undefined)
    return run
  }
  const tabA = createRenewer({
    refresh: async () => { order.push("A start"); await new Promise((r) => setTimeout(r, 15)); order.push("A end"); return OK },
    withLock: lock,
  })
  const tabB = createRenewer({
    refresh: async () => { order.push("B start"); order.push("B end"); return OK },
    withLock: lock,
  })
  await Promise.all([tabA.renew(), tabB.renew()])
  assert.deepEqual(order, ["A start", "A end", "B start", "B end"])
})

test("tells every listener about a renewed session", async () => {
  const seen: RenewResult[] = []
  const renewer = createRenewer({ refresh: async () => OK, withLock: noLock })
  renewer.subscribe((r) => seen.push(r))
  await renewer.renew()
  assert.equal(seen.length, 1)
  assert.equal(seen[0].ok, true)
})

test("tells listeners when the session is gone for good", async () => {
  const seen: RenewResult[] = []
  const renewer = createRenewer({ refresh: async () => SIGNED_OUT, withLock: noLock })
  renewer.subscribe((r) => seen.push(r))
  const result = await renewer.renew()
  assert.deepEqual(result, SIGNED_OUT)
  assert.deepEqual(seen, [SIGNED_OUT])
})

test("says nothing to listeners when the server simply could not be reached, so a bad connection never signs anyone out", async () => {
  const seen: RenewResult[] = []
  const renewer = createRenewer({ refresh: async () => UNREACHABLE, withLock: noLock })
  renewer.subscribe((r) => seen.push(r))
  const result = await renewer.renew()
  assert.deepEqual(result, UNREACHABLE)
  assert.deepEqual(seen, [])
})

test("a listener that is removed hears nothing more", async () => {
  const seen: RenewResult[] = []
  const renewer = createRenewer({ refresh: async () => OK, withLock: noLock })
  const stop = renewer.subscribe((r) => seen.push(r))
  stop()
  await renewer.renew()
  assert.deepEqual(seen, [])
})

test("a renewal that throws counts as unreachable and does not block the next one", async () => {
  let n = 0
  const renewer = createRenewer({
    refresh: async () => { if (n++ === 0) throw new Error("boom"); return OK },
    withLock: noLock,
  })
  assert.deepEqual(await renewer.renew(), UNREACHABLE)
  assert.equal((await renewer.renew()).ok, true)
})
