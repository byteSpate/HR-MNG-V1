import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppError } from "../middleware/errorHandler"
import { createLimiter } from "./limiter"

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("createLimiter", () => {
  it("runs at most max tasks at once and starts the others in the order they came", async () => {
    const limit = createLimiter(2, 30_000)
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []

    const runs = gates.map((gate, i) =>
      limit(async () => {
        started.push(i)
        await gate.promise
        return i
      })
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0, 1])

    gates[0].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0, 1, 2])

    gates[1].resolve()
    gates[2].resolve()
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2])
  })

  it("gives the place back when a task throws", async () => {
    const limit = createLimiter(1, 30_000)

    await expect(limit(async () => { throw new Error("render failed") })).rejects.toThrow("render failed")
    await expect(limit(async () => "next one runs")).resolves.toBe("next one runs")
  })

  it("stops waiting after maxWaitMs with a 503 that says what to do, and leaks no place", async () => {
    const limit = createLimiter(1, 30_000)
    const first = deferred()
    const running = limit(() => first.promise)
    const waiting = limit(async () => "never runs")
    const caught = waiting.catch((e) => e)

    await vi.advanceTimersByTimeAsync(30_000)

    const error = await caught
    expect(error).toBeInstanceOf(AppError)
    expect(error.statusCode).toBe(503)
    expect(error.message).toBe("Many PDF files are being made right now. Please wait a minute and try again.")

    // The place is still the first task's. When it ends, a new task starts at once.
    first.resolve()
    await running
    await expect(limit(async () => "free again")).resolves.toBe("free again")
  })

  it("does not time out a task that already started", async () => {
    const limit = createLimiter(1, 1_000)
    const gate = deferred<string>()
    const run = limit(() => gate.promise)

    await vi.advanceTimersByTimeAsync(5_000)
    gate.resolve("done")

    await expect(run).resolves.toBe("done")
  })
})
