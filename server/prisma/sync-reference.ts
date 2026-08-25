import "dotenv/config"

import prisma from "../src/config/prisma"
import { seedAssetCategories } from "../src/modules/asset/asset.categories.seed"
import { seedChartOfAccounts } from "../src/modules/accounting/accounting.seed"
import {
  migrateCostCategoryCodes,
  seedCostCategories,
} from "../src/modules/cost/cost.categories.seed"
import { seedPolicyNotes } from "../src/modules/statements/statements.policy.seed"
import { seedPostingRules } from "../src/modules/posting/posting.rules.seed"

/**
 * Brings a live database's **reference data** up to date with the code.
 *
 * The gap this closes: `prisma db seed` runs once, by hand, when a database
 * is created. The release phase runs `prisma migrate deploy` and nothing
 * else. So a chart account, posting rule or category added to a seed file
 * *after* a database was first seeded reaches that database by no route at
 * all — it simply stays missing, and the first symptom is a posting failing,
 * or worse, quietly resolving through a wildcard to the wrong account.
 *
 * That is exactly what happened to `SETTLEMENT_ACCRUAL/ASSET_RECOVERY`,
 * `PAYROLL_ACCRUAL/DEDUCTION:ASSET_RECOVERY` and `ASSET_DISPOSAL/BANK`.
 *
 * **Safe to run against production, repeatedly.** Every seeder below is
 * idempotent on a natural key and leaves existing rows alone, so a re-run
 * fills in what is missing and changes nothing a human has since edited.
 *
 * **Deliberately not the whole seed.** `prisma/seed.ts` also creates demo
 * admin users and announcements; the announcements are `create`d rather than
 * upserted and would duplicate on every run, and the users would have their
 * passwords reset. Those are fixtures, not reference data, and they are not
 * called here.
 *
 * Order matters: posting rules resolve account codes against the chart, and
 * now throw rather than skipping silently if one is absent.
 */
async function main() {
  console.log("Syncing reference data\n")

  await seedChartOfAccounts()
  console.log("  chart of accounts")

  // Before the posting rules, not after. The rules are keyed by cost category
  // code; seeding them first would insert the new keys alongside the old ones
  // and leave every existing category pointing at a rule nothing renames.
  const movedCodes = await migrateCostCategoryCodes()
  console.log(`  cost category codes (${movedCodes} moved to the EXP- scheme)`)

  await seedPostingRules()
  console.log("  posting rules")

  await seedAssetCategories()
  console.log("  asset categories")

  await seedCostCategories()
  console.log("  cost categories")

  await seedPolicyNotes()
  console.log("  policy notes")

  const [accounts, rules, assetCats, costCats, notes] = await Promise.all([
    prisma.account.count(),
    prisma.postingRule.count(),
    prisma.assetCategory.count(),
    prisma.costCategory.count(),
    prisma.policyNote.count(),
  ])
  console.log(
    `\nDone. ${accounts} accounts, ${rules} posting rules, ${assetCats} asset categories, ` +
      `${costCats} cost categories, ${notes} policy notes.`
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
