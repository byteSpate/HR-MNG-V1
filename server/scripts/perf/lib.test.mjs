import { describe, expect, it } from "vitest"

import { compareResults, parseServerTiming, pctChange, percentile, summarize } from "./lib.mjs"

describe("percentile", () => {
  it("uses the nearest-rank rule", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(sorted, 50)).toBe(5)
    expect(percentile(sorted, 95)).toBe(10)
    expect(percentile(sorted, 99)).toBe(10)
    expect(percentile([7], 95)).toBe(7)
  })

  it("is null for no data, never 0", () => {
    expect(percentile([], 50)).toBeNull()
  })
})

describe("summarize", () => {
  it("sorts and describes the values", () => {
    const s = summarize([30, 10, 20])
    expect(s).toEqual({ n: 3, min: 10, p50: 20, p95: 30, p99: 30, max: 30, avg: 20 })
  })

  it("gives null for every field when there is nothing to describe", () => {
    expect(summarize([])).toEqual({ n: 0, min: null, p50: null, p95: null, p99: null, max: null, avg: null })
  })
})

describe("parseServerTiming", () => {
  it("reads the header the server sends", () => {
    const header = 'total;dur=812.4, db;dur=640.2;desc="queries=18", poolwait;dur=95.5;desc="max=60.0"'
    expect(parseServerTiming(header)).toEqual({
      totalMs: 812.4,
      dbMs: 640.2,
      queries: 18,
      poolWaitMs: 95.5,
      maxPoolWaitMs: 60,
    })
  })

  it("gives null for everything when the header is missing", () => {
    expect(parseServerTiming(undefined)).toEqual({
      totalMs: null,
      dbMs: null,
      queries: null,
      poolWaitMs: null,
      maxPoolWaitMs: null,
    })
  })
})

describe("pctChange", () => {
  it("is a percent, negative when it got smaller", () => {
    expect(pctChange(200, 100)).toBe(-50)
    expect(pctChange(100, 150)).toBe(50)
  })

  it("is null when either side is missing or the start is zero", () => {
    expect(pctChange(null, 5)).toBeNull()
    expect(pctChange(5, null)).toBeNull()
    expect(pctChange(0, 5)).toBeNull()
  })
})

describe("compareResults", () => {
  const row = (name, p50, queries, bytesAvg) => ({
    name,
    ms: { p50, p95: p50 * 2 },
    bytesAvg,
    server: { queries },
  })

  it("lines up endpoints by name and ignores ones that are only on one side", () => {
    const before = { endpoints: [row("a", 100, 20, 1000), row("only-before", 1, 1, 1)] }
    const after = { endpoints: [row("a", 50, 18, 200), row("only-after", 1, 1, 1)] }

    const [a, ...rest] = compareResults(before, after)

    expect(rest).toEqual([])
    expect(a.name).toBe("a")
    expect(a.p50).toEqual({ before: 100, after: 50, pct: -50 })
    expect(a.queries).toEqual({ before: 20, after: 18, diff: -2 })
    expect(a.bytes).toEqual({ before: 1000, after: 200, pct: -80 })
  })
})
