/**
 * The company-expense categories, and their codes.
 *
 * A table rather than an enum because Finance will add "gas bill" and no
 * code branches on the name. Extracted from `prisma/seed.ts` so it can be
 * imported without running the whole seed — see the note in
 * `asset.categories.seed.ts`.
 *
 * ## The coding scheme
 *
 * `EXP-<family>-<nnn>`. The family groups things that answer the same
 * question — `UTL` covers electricity and water, which are two bills and one
 * kind of cost — and the number separates them inside it. New members of a
 * family take the next number; a new family takes a new three-letter code.
 *
 * **`code` is not decoration.** `PostingRule.key` for the `COST_ACCRUAL`
 * event *is* this string (`cost.posting.ts` resolves the debit account with
 * `resolveAccountCode(rules, cost.categoryCode)`), so a category's code is
 * what decides which account its bills land in. Changing one without moving
 * its posting rule sends every future bill in that category to the `*`
 * fallback — silently, because a fallback exists. That is why the rename
 * below moves both together, in one transaction.
 */

import prisma from "../../config/prisma"

export const COST_CATEGORIES = [
  { code: "EXP-SAL-001", name: "Salary" },
  { code: "EXP-OFF-001", name: "Stationery and office supplies" },
  { code: "EXP-ENT-001", name: "Entertainment" },
  { code: "EXP-UTL-001", name: "Electricity" },
  { code: "EXP-UTL-002", name: "Water" },
  { code: "EXP-RNT-001", name: "Office rent" },
  { code: "EXP-INT-001", name: "Internet" },
  { code: "EXP-TRN-001", name: "Transportation" },
  { code: "EXP-CLN-001", name: "Cleaning" },
  { code: "EXP-SEC-001", name: "Security" },
  { code: "EXP-MNT-001", name: "Maintenance" },
  { code: "EXP-OTH-001", name: "Other" },
]

/**
 * Old code to new, for databases seeded before the scheme existed.
 *
 * Names are deliberately absent: this renames machine keys only. Category
 * names are editable from the settings screen, and `sync-reference.ts`
 * promises it "leaves existing rows alone" — overwriting a name somebody
 * changed would break that promise for no gain.
 */
export const COST_CODE_RENAMES: Readonly<Record<string, string>> = {
  RENT: "EXP-RNT-001",
  ELECTRICITY: "EXP-UTL-001",
  WATER: "EXP-UTL-002",
  INTERNET: "EXP-INT-001",
  CLEANING: "EXP-CLN-001",
  SECURITY: "EXP-SEC-001",
  MAINTENANCE: "EXP-MNT-001",
  STATIONERY: "EXP-OFF-001",
  OTHER: "EXP-OTH-001",
}

/** The event whose rule keys are cost category codes. */
const COST_EVENT = "COST_ACCRUAL"

/**
 * Moves a database off the old bare-word codes.
 *
 * Runs **before** the posting rules are seeded, so the rules arrive to find
 * their keys already renamed rather than inserting a second set beside the
 * old ones.
 *
 * Idempotent twice over: a code that has already moved is not found, and a
 * rename whose destination already exists is skipped rather than allowed to
 * collide with the `@@unique` on `code` — which is the state a half-finished
 * run would leave behind.
 */
export async function migrateCostCategoryCodes(): Promise<number> {
  let moved = 0

  for (const [from, to] of Object.entries(COST_CODE_RENAMES)) {
    const [existing, target] = await Promise.all([
      prisma.costCategory.findUnique({ where: { code: from }, select: { id: true } }),
      prisma.costCategory.findUnique({ where: { code: to }, select: { id: true } }),
    ])
    if (!existing || target) continue

    // One transaction. A category that moved without its posting rule would
    // post to the wildcard account, and nothing would report an error.
    await prisma.$transaction(async (tx) => {
      await tx.costCategory.update({ where: { code: from }, data: { code: to } })
      await tx.postingRule.updateMany({
        where: { event: COST_EVENT, key: from },
        data: { key: to },
      })
    })
    moved++
  }

  return moved
}

export async function seedCostCategories(): Promise<void> {
  for (const category of COST_CATEGORIES) {
    await prisma.costCategory.upsert({
      where: { code: category.code },
      update: {},
      create: category,
    })
  }
}
