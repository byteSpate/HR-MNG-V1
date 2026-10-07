#!/usr/bin/env node
// Shows before and after for two bench files.
//
//   node scripts/perf/compare.mjs perf-results/baseline.json perf-results/after.json
import fs from "node:fs"

import { compareResults } from "./lib.mjs"

const [beforePath, afterPath] = process.argv.slice(2)
if (!beforePath || !afterPath) {
  console.error("Use: node scripts/perf/compare.mjs <before.json> <after.json>")
  process.exit(1)
}

const before = JSON.parse(fs.readFileSync(beforePath, "utf8"))
const after = JSON.parse(fs.readFileSync(afterPath, "utf8"))

const n = (v, d = 0) => (v == null ? "n/a" : v.toFixed(d))
const pct = (v) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`)
const diff = (v) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`)

console.log(`\n${before.label} -> ${after.label}\n`)
console.log("| endpoint | p50 ms | p95 ms | queries | bytes |")
console.log("|---|---|---|---|---|")
for (const r of compareResults(before, after)) {
  console.log(
    `| ${r.name} | ${n(r.p50.before)} -> ${n(r.p50.after)} (${pct(r.p50.pct)}) | ${n(r.p95.before)} -> ${n(r.p95.after)} (${pct(r.p95.pct)}) | ${n(r.queries.before, 1)} -> ${n(r.queries.after, 1)} (${diff(r.queries.diff)}) | ${n(r.bytes.before)} -> ${n(r.bytes.after)} (${pct(r.bytes.pct)}) |`
  )
}
console.log("\nMilliseconds here are laptop to the dev database. Trust the queries column and the ratios.")
