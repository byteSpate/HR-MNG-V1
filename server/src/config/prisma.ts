import { PrismaPg } from "@prisma/adapter-pg"

import { env } from "./env"
import { PrismaClient } from "../generated/prisma/client"

/**
 * Tuned for a database that is far away. The dev Supabase project is in
 * Seoul: from Dhaka, opening a connection took about a second and each query
 * 120 to 250 ms (measured 2026-09-14).
 *
 * Prisma 7's `pg` adapter closes an idle connection after 10 s, so after any
 * pause the next request paid for a fresh connection. 300 s is what Prisma 6
 * did. `pg` also waits for ever for a connection by default; 10 s fails
 * loudly instead of hanging.
 *
 * At most 5 connections per process. Supabase's session pooler allows 15
 * clients in all, and pg's default of 10, kept open for 300 s, left no room
 * for anything else: running the daily email by hand beside the dev server
 * failed with EMAXCONNSESSION. Five leaves room for a second process, such as
 * that job, Prisma Studio, or an old and a new dyno during a deploy.
 */
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 300_000,
  connectionTimeoutMillis: 10_000,
})

/**
 * Prisma's defaults give a transaction 2 s to start and 5 s to run. A write
 * here is ten or so round trips with its audit row and events, and saving a
 * meeting failed with P2028, "Unable to start a transaction in the given
 * time". One place, so no service has to remember its own numbers.
 */
const prisma = new PrismaClient({
  adapter,
  transactionOptions: { maxWait: 10_000, timeout: 15_000 },
})

export default prisma
