import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    costCategory: { update: vi.fn() },
    postingRule: { updateMany: vi.fn() },
  }
  return {
    default: {
      costCategory: { findUnique: vi.fn(), upsert: vi.fn() },
      postingRule: { updateMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  }
})

import prisma from "../../config/prisma"
import { COST_CATEGORIES } from "./cost.categories.seed"
import { COST_CODE_RENAMES, migrateCostCategoryCodes } from "./cost.categories.seed"
import { POSTING_RULES } from "../posting/posting.rules.seed"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx as {
  costCategory: { update: ReturnType<typeof vi.fn> }
  postingRule: { updateMany: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Codes are only half the story. `PostingRule.key` for COST_ACCRUAL *is* the
 * category code, so a code that exists without a matching rule silently
 * resolves through the `*` wildcard to the office-expense account — a wrong
 * posting that raises no error. These tests are here to catch that pairing
 * coming apart, in the seed and in the migration alike.
 */
describe("the EXP- coding scheme", () => {
  it("gives every category a well-formed, unique code", () => {
    const codes = COST_CATEGORIES.map((c) => c.code)

    for (const code of codes) expect(code).toMatch(/^EXP-[A-Z]{3}-\d{3}$/)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("gives every category a unique name, which the schema requires", () => {
    const names = COST_CATEGORIES.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("covers every category the business asked for", () => {
    const names = COST_CATEGORIES.map((c) => c.name.toLowerCase())
    for (const wanted of ["salary", "entertainment", "transportation", "internet", "office rent"]) {
      expect(names.some((n) => n.includes(wanted))).toBe(true)
    }
  })

  it("groups a family under one prefix and separates its members by number", () => {
    // Electricity and water are two bills and one kind of cost.
    const utilities = COST_CATEGORIES.filter((c) => c.code.startsWith("EXP-UTL-"))
    expect(utilities.map((c) => c.name).sort()).toEqual(["Electricity", "Water"])
  })
})

describe("cost posting rules", () => {
  const costRules = POSTING_RULES.filter((r) => r.event === "COST_ACCRUAL")

  it("keys every cost rule on a real category code, or on a reserved key", () => {
    const known = new Set(COST_CATEGORIES.map((c) => c.code))
    // `*` is the fallback and `PAYABLE` is the credit side — neither is a
    // category, and both are legitimately not in the category table.
    const reserved = new Set(["*", "PAYABLE"])

    for (const rule of costRules) {
      if (reserved.has(rule.key)) continue
      expect(known, `posting rule keyed on unknown category ${rule.key}`).toContain(rule.key)
    }
  })

  it("still has a fallback, so an added category cannot fail to post", () => {
    expect(costRules.some((r) => r.key === "*")).toBe(true)
  })

  it("carries no rule under an old bare-word code", () => {
    for (const old of Object.keys(COST_CODE_RENAMES)) {
      expect(costRules.some((r) => r.key === old)).toBe(false)
    }
  })
})

describe("migrateCostCategoryCodes", () => {
  /** What `findUnique` is called with here: a lookup by the unique `code`. */
  type ByCode = { where: { code?: string } }
  const lookup = (fn: (code: string) => { id: string } | null) =>
    vi.mocked(prisma.costCategory.findUnique).mockImplementation((async (args: ByCode) =>
      fn(args.where.code ?? "")) as never)

  /** `from` exists, `to` does not — the state a pre-scheme database is in. */
  function needsMove(...codes: string[]) {
    lookup((code) => (codes.includes(code) ? { id: `cat-${code}` } : null))
  }

  it("moves the category and its posting rule together, in one transaction", async () => {
    needsMove("RENT")

    const moved = await migrateCostCategoryCodes()

    expect(moved).toBe(1)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.costCategory.update).toHaveBeenCalledWith({
      where: { code: "RENT" },
      data: { code: "EXP-RNT-001" },
    })
    expect(tx.postingRule.updateMany).toHaveBeenCalledWith({
      where: { event: "COST_ACCRUAL", key: "RENT" },
      data: { key: "EXP-RNT-001" },
    })
  })

  it("does nothing on a database that has already moved", async () => {
    // Nothing found under an old code.
    vi.mocked(prisma.costCategory.findUnique).mockResolvedValue(null as never)

    expect(await migrateCostCategoryCodes()).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  // The state a half-finished run leaves behind. Renaming into an occupied
  // code violates the unique constraint on `code`, so the run would die
  // part-way through and leave the rest of the categories unmigrated.
  it("skips a rename whose destination already exists rather than colliding", async () => {
    lookup((code) => (code === "RENT" || code === "EXP-RNT-001" ? { id: "cat-x" } : null))

    expect(await migrateCostCategoryCodes()).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("moves every old code the scheme replaced", async () => {
    needsMove(...Object.keys(COST_CODE_RENAMES))

    expect(await migrateCostCategoryCodes()).toBe(Object.keys(COST_CODE_RENAMES).length)
  })

  it("renames only into codes the seed actually creates", () => {
    const seeded = new Set(COST_CATEGORIES.map((c) => c.code))
    for (const to of Object.values(COST_CODE_RENAMES)) {
      expect(seeded, `rename target ${to} is not a seeded category`).toContain(to)
    }
  })
})
