#!/usr/bin/env node
// Times `SELECT 1` against DATABASE_URL, from wherever this runs.
//
//   node scripts/perf/db-latency.mjs [runs]          (default 100)
//
// It only sends `SELECT 1`. It prints the database host, never the password.
// To time it from the Heroku dyno later:
//   heroku run node scripts/perf/db-latency.mjs -a hr-payroll-server
import "dotenv/config"
import pg from "pg"

import { summarize } from "./lib.mjs"

const runs = Number(process.argv[2] ?? 100)
const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set. Add it to server/.env and run again.")
  process.exit(1)
}

const round = (n) => (n == null ? null : Math.round(n * 10) / 10)
const client = new pg.Client({ connectionString: url })

const connectStart = performance.now()
await client.connect()
const connectMs = performance.now() - connectStart

const times = []
for (let i = 0; i < runs; i++) {
  const start = performance.now()
  await client.query("select 1")
  times.push(performance.now() - start)
}
await client.end()

const s = summarize(times)
console.log(
  JSON.stringify(
    {
      host: new URL(url).host,
      runs,
      connectMs: round(connectMs),
      minMs: round(s.min),
      p50Ms: round(s.p50),
      p95Ms: round(s.p95),
      p99Ms: round(s.p99),
      maxMs: round(s.max),
    },
    null,
    2
  )
)
