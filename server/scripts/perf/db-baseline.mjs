#!/usr/bin/env node
// Read-only. Shows how big the tables are and which statements cost the most.
//
//   node scripts/perf/db-baseline.mjs
//
// It sends only SELECT statements.
import "dotenv/config"
import pg from "pg"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set. Add it to server/.env and run again.")
  process.exit(1)
}

const TABLES = [
  "Employee",
  "Attendance",
  "Event",
  "AuditLog",
  "Journal",
  "JournalLine",
  "SalesCommunication",
  "Opportunity",
  "Payslip",
]

const client = new pg.Client({ connectionString: url })
await client.connect()

const tables = []
for (const name of TABLES) {
  try {
    const rows = await client.query(`select count(*)::text as rows from "${name}"`)
    const size = await client.query("select pg_total_relation_size($1::regclass)::text as bytes", [`"${name}"`])
    tables.push({ table: name, rows: Number(rows.rows[0].rows), bytes: Number(size.rows[0].bytes) })
  } catch (error) {
    tables.push({ table: name, error: error.message })
  }
}

async function topStatements() {
  const sql = (from) => `
    select left(query, 120) as query, calls::text as calls,
           round(total_exec_time::numeric, 1)::text as total_ms,
           round(mean_exec_time::numeric, 1)::text as mean_ms
    from ${from}
    order by total_exec_time desc
    limit 20`
  for (const from of ["pg_stat_statements", "extensions.pg_stat_statements"]) {
    try {
      return (await client.query(sql(from))).rows
    } catch {
      // try the next schema
    }
  }
  return "pg_stat_statements is not available. In Supabase open Database, then Extensions, and turn on pg_stat_statements."
}

const statements = await topStatements()
await client.end()

console.log(JSON.stringify({ tables, topStatements: statements }, null, 2))
