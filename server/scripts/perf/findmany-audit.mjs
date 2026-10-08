#!/usr/bin/env node
// Lists every findMany in server/src (not tests, not generated code), by model.
//
//   node scripts/perf/findmany-audit.mjs > perf-results/findmany-audit.md
import fs from "node:fs"
import path from "node:path"

import { auditFindMany } from "./findmany-audit.lib.mjs"

const root = path.resolve("src")
const files = fs
  .readdirSync(root, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("generated"))

const all = files.flatMap((f) => auditFindMany(fs.readFileSync(path.join(root, f), "utf8"), f))
const without = all.filter((r) => !r.hasTake)

console.log(`# findMany audit\n`)
console.log(`${all.length} calls, ${without.length} without a take (${Math.round((100 * without.length) / all.length)}%).\n`)
console.log("| model | calls without a take | where |")
console.log("|---|---|---|")
const byModel = new Map()
for (const r of without) byModel.set(r.model, [...(byModel.get(r.model) ?? []), `${r.file}:${r.line}`])
for (const [model, places] of [...byModel].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`| ${model} | ${places.length} | ${places.slice(0, 4).join(", ")}${places.length > 4 ? ", ..." : ""} |`)
}
