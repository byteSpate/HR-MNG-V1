// Small pure helpers for the perf scripts. No I/O, so they can be tested.

/** Nearest-rank percentile of an ascending array. Null when there is no data. */
export function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null
  const index = Math.ceil((p / 100) * sortedAsc.length) - 1
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, index))]
}

export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? null,
    avg: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
  }
}

/** Reads the `Server-Timing` header the API sends (see request-metrics.ts). */
export function parseServerTiming(header) {
  const out = { totalMs: null, dbMs: null, queries: null, poolWaitMs: null, maxPoolWaitMs: null }
  if (!header) return out
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().split(";").map((s) => s.trim())
    const dur = params.find((p) => p.startsWith("dur="))
    const desc = params.find((p) => p.startsWith("desc="))
    const ms = dur ? Number(dur.slice(4)) : null
    const text = desc ? desc.slice(5).replace(/^"|"$/g, "") : ""
    if (name === "total") out.totalMs = ms
    if (name === "db") {
      out.dbMs = ms
      const m = /queries=(\d+)/.exec(text)
      out.queries = m ? Number(m[1]) : null
    }
    if (name === "poolwait") {
      out.poolWaitMs = ms
      const m = /max=([\d.]+)/.exec(text)
      out.maxPoolWaitMs = m ? Number(m[1]) : null
    }
  }
  return out
}

export function pctChange(before, after) {
  if (before == null || after == null || before === 0) return null
  return ((after - before) / before) * 100
}

/** Lines two bench results up by endpoint name. */
export function compareResults(before, after) {
  const afterByName = new Map(after.endpoints.map((e) => [e.name, e]))
  return before.endpoints
    .filter((b) => afterByName.has(b.name))
    .map((b) => {
      const a = afterByName.get(b.name)
      const diff = (x, y) => (x == null || y == null ? null : y - x)
      return {
        name: b.name,
        p50: { before: b.ms?.p50 ?? null, after: a.ms?.p50 ?? null, pct: pctChange(b.ms?.p50, a.ms?.p50) },
        p95: { before: b.ms?.p95 ?? null, after: a.ms?.p95 ?? null, pct: pctChange(b.ms?.p95, a.ms?.p95) },
        queries: {
          before: b.server?.queries ?? null,
          after: a.server?.queries ?? null,
          diff: diff(b.server?.queries, a.server?.queries),
        },
        bytes: { before: b.bytesAvg ?? null, after: a.bytesAvg ?? null, pct: pctChange(b.bytesAvg, a.bytesAvg) },
      }
    })
}
