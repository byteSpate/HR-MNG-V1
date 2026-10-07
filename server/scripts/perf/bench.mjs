#!/usr/bin/env node
// Calls the LOCAL API and records time, database trips and size.
//
//   node scripts/perf/bench.mjs --label baseline [--runs 20] [--concurrency 1] [--only name]
//
// Read-only: it sends GET requests, plus one login for each demo user.
// It refuses to run against anything that is not localhost.
//   BENCH_BASE_URL   default http://localhost:4000
//   BENCH_PASSWORD   default Demo@12345 (the seed password)
//   BENCH_OUT        default perf-results
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

import { parseServerTiming, summarize } from "./lib.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const baseUrl = process.env.BENCH_BASE_URL ?? "http://localhost:4000"
const password = process.env.BENCH_PASSWORD ?? "Demo@12345"
const outDir = process.env.BENCH_OUT ?? "perf-results"
const label = arg("label", "run")
const runs = Number(arg("runs", "20"))
const concurrency = Number(arg("concurrency", "1"))
const only = arg("only", null)
const USERS = { admin: "admin@demo.com", hr: "hr@demo.com", finance: "finance@demo.com" }

const host = new URL(baseUrl).hostname
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`This script only runs against a local server. ${baseUrl} is not local. Stop here.`)
  process.exit(1)
}

const agents = {
  "http:": new http.Agent({ keepAlive: true }),
  "https:": new https.Agent({ keepAlive: true }),
}

/** One request. Asks for gzip and keeps the bytes as they came over the wire. */
function send(urlString, { method = "GET", headers = {}, body } = {}) {
  const url = new URL(urlString)
  const lib = url.protocol === "https:" ? https : http
  return new Promise((resolve, reject) => {
    const start = performance.now()
    const req = lib.request(
      url,
      { method, agent: agents[url.protocol], headers: { "Accept-Encoding": "gzip", ...headers } },
      (res) => {
        const chunks = []
        let bytes = 0
        res.on("data", (chunk) => {
          chunks.push(chunk)
          bytes += chunk.length
        })
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            bytes,
            ms: performance.now() - start,
            body: Buffer.concat(chunks),
          })
        )
      }
    )
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

function bodyText(res) {
  const raw = res.headers["content-encoding"] === "gzip" ? zlib.gunzipSync(res.body) : res.body
  return raw.toString("utf8")
}

function errorText(res) {
  try {
    return JSON.parse(bodyText(res)).error ?? `status ${res.status}`
  } catch {
    return `status ${res.status}`
  }
}

async function login(who) {
  const res = await send(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: USERS[who], password }),
  })
  if (res.status !== 200) {
    console.error(`Login failed for ${who} (${USERS[who]}): ${errorText(res)}. Is the server running and the database seeded?`)
    process.exit(1)
  }
  return JSON.parse(bodyText(res)).accessToken
}

const avg = (values) => {
  const real = values.filter((v) => v != null)
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null
}
const max = (values) => {
  const real = values.filter((v) => v != null)
  return real.length ? Math.max(...real) : null
}

async function measure(endpoint, token) {
  const url = baseUrl + endpoint.path
  const headers = { Authorization: `Bearer ${token}` }

  // The first request is kept apart: it may pay for a new connection.
  const first = await send(url, { headers })
  const base = { name: endpoint.name, as: endpoint.as, path: endpoint.path, firstMs: first.ms }
  if (first.status < 200 || first.status >= 300) {
    return { ...base, ok: 0, failed: [{ status: first.status, error: errorText(first) }], ms: null, bytesAvg: null, encoding: null, server: null }
  }

  const good = []
  const failed = []
  let next = 0
  async function worker() {
    while (next++ < runs) {
      const res = await send(url, { headers })
      if (res.status >= 200 && res.status < 300) good.push(res)
      else failed.push({ status: res.status, error: errorText(res) })
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  const timings = good.map((r) => parseServerTiming(r.headers["server-timing"]))
  return {
    ...base,
    ok: good.length,
    failed,
    ms: good.length ? summarize(good.map((r) => r.ms)) : null,
    bytesAvg: avg(good.map((r) => r.bytes)),
    encoding: first.headers["content-encoding"] ?? "none",
    server: {
      totalMs: avg(timings.map((t) => t.totalMs)),
      dbMs: avg(timings.map((t) => t.dbMs)),
      queries: avg(timings.map((t) => t.queries)),
      poolWaitMs: avg(timings.map((t) => t.poolWaitMs)),
      maxPoolWaitMs: max(timings.map((t) => t.maxPoolWaitMs)),
    },
  }
}

const fmt = (n, digits = 0) => (n == null ? "n/a" : n.toFixed(digits))

const endpoints = JSON.parse(fs.readFileSync(path.join(here, "endpoints.json"), "utf8")).filter((e) => !only || e.name === only)
const tokens = {}
for (const who of new Set(endpoints.map((e) => e.as))) tokens[who] = await login(who)

const results = []
for (const endpoint of endpoints) results.push(await measure(endpoint, tokens[endpoint.as]))

const header = "| endpoint | ok | p50 ms | p95 ms | p99 ms | queries | db ms | pool wait ms | bytes | encoding |"
console.log(`\n${label}: ${runs} runs, concurrency ${concurrency}, ${baseUrl}\n`)
console.log(header)
console.log("|" + header.split("|").slice(1, -1).map(() => "---").join("|") + "|")
for (const r of results) {
  console.log(
    `| ${r.name} | ${r.ok}/${runs} | ${fmt(r.ms?.p50)} | ${fmt(r.ms?.p95)} | ${fmt(r.ms?.p99)} | ${fmt(r.server?.queries, 1)} | ${fmt(r.server?.dbMs)} | ${fmt(r.server?.poolWaitMs)} | ${fmt(r.bytesAvg)} | ${r.encoding ?? "n/a"} |`
  )
}
for (const r of results) {
  for (const f of r.failed.slice(0, 1)) console.log(`\n${r.name} failed: HTTP ${f.status}: ${f.error}`)
}

fs.mkdirSync(outDir, { recursive: true })
const file = path.join(outDir, `${label}.json`)
fs.writeFileSync(file, JSON.stringify({ label, at: new Date().toISOString(), baseUrl, runs, concurrency, endpoints: results }, null, 2))
console.log(`\nSaved ${file}`)
