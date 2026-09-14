import { describe, expect, it, vi } from "vitest"

vi.mock("./env", () => ({ env: { DATABASE_URL: "postgresql://user:pass@db.example.com:5432/postgres" } }))
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }))
vi.mock("../generated/prisma/client", () => ({ PrismaClient: vi.fn() }))

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/client"
import "./prisma"

/**
 * The database is far away (Supabase in Seoul): a new connection takes about
 * a second and each query 120 to 250 ms. Prisma 7's defaults were set for a
 * database next door, and saving a meeting failed with P2028, "Unable to
 * start a transaction in the given time".
 */
describe("the one Prisma client", () => {
  it("gives a transaction time to start and to finish on a far-away database", () => {
    const options = vi.mocked(PrismaClient).mock.calls[0][0] as any

    // Prisma's defaults are 2 s to start and 5 s to run.
    expect(options.transactionOptions.maxWait).toBeGreaterThanOrEqual(10_000)
    expect(options.transactionOptions.timeout).toBeGreaterThanOrEqual(15_000)
  })

  it("keeps idle connections open, so a pause does not mean a fresh one-second connect", () => {
    const options = vi.mocked(PrismaPg).mock.calls[0][0] as any

    // pg closes an idle connection after 10 s; Prisma 6 kept it for 300 s.
    expect(options.connectionString).toBe("postgresql://user:pass@db.example.com:5432/postgres")
    expect(options.idleTimeoutMillis).toBe(300_000)
    // pg waits for ever by default; a stuck connect should fail and say so.
    expect(options.connectionTimeoutMillis).toBeGreaterThan(0)
  })
})
