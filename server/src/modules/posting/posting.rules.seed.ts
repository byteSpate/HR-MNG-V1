import prisma from "../../config/prisma"
import type { PostingEvent } from "./posting.types"
export interface PostingRuleSeed { event: PostingEvent; key: string; account: string; note?: string }
export const POSTING_RULES: PostingRuleSeed[] = [
  { event: "PAYROLL_ACCRUAL", key: "DIRECT:BASIC", account: "5122" }, { event: "PAYROLL_ACCRUAL", key: "ADMINISTRATIVE:BASIC", account: "5201" },
  { event: "PAYROLL_ACCRUAL", key: "DIRECT:FESTIVAL_BONUS", account: "5123" }, { event: "PAYROLL_ACCRUAL", key: "ADMINISTRATIVE:FESTIVAL_BONUS", account: "5202" },
  { event: "PAYROLL_ACCRUAL", key: "DIRECT:*", account: "5122" }, { event: "PAYROLL_ACCRUAL", key: "ADMINISTRATIVE:*", account: "5201" },
  { event: "PAYROLL_ACCRUAL", key: "DEDUCTION:TDS", account: "2140" }, { event: "PAYROLL_ACCRUAL", key: "DEDUCTION:*", account: "2132" },
  { event: "PAYROLL_ACCRUAL", key: "NET_PAY", account: "2132" }, { event: "PAYROLL_PAYMENT", key: "NET_PAY", account: "2132" },
  { event: "PAYROLL_PAYMENT", key: "BANK", account: "1242" }, { event: "PAYROLL_PAYMENT", key: "REIMBURSEMENT", account: "2135" },
  { event: "EXPENSE_ACCRUAL", key: "TRAVEL", account: "5208" }, { event: "EXPENSE_ACCRUAL", key: "ENTERTAINMENT", account: "5205" },
  { event: "EXPENSE_ACCRUAL", key: "STATIONERY", account: "5203" }, { event: "EXPENSE_ACCRUAL", key: "IT", account: "5212" }, { event: "EXPENSE_ACCRUAL", key: "*", account: "5217" },
  { event: "EXPENSE_ACCRUAL", key: "REIMBURSEMENT", account: "2135" },
  // Keys here are `CostCategory.code` — see `cost.categories.seed.ts`. They
  // moved from bare words to the EXP-<family>-<nnn> scheme; a database seeded
  // before that is carried across by `migrateCostCategoryCodes()`, which moves
  // the category and its rule in one transaction.
  { event: "COST_ACCRUAL", key: "EXP-RNT-001", account: "5206" }, { event: "COST_ACCRUAL", key: "EXP-UTL-001", account: "5209" }, { event: "COST_ACCRUAL", key: "EXP-UTL-002", account: "5210" }, { event: "COST_ACCRUAL", key: "EXP-INT-001", account: "5211" }, { event: "COST_ACCRUAL", key: "EXP-MNT-001", account: "5213" },
  { event: "COST_ACCRUAL", key: "EXP-ENT-001", account: "5205" }, { event: "COST_ACCRUAL", key: "EXP-TRN-001", account: "5208" }, { event: "COST_ACCRUAL", key: "EXP-OFF-001", account: "5207" },
  // Salary as a *company expense* is for pay that never went through a payroll
  // run — casual wages, a contractor's monthly invoice. Anything paid through
  // payroll already debits 5201 from PAYROLL_ACCRUAL, so booking it here as
  // well counts the same cost twice.
  { event: "COST_ACCRUAL", key: "EXP-SAL-001", account: "5201", note: "Only for pay outside a payroll run — payroll already posts to 5201" },
  { event: "COST_ACCRUAL", key: "*", account: "5207" }, { event: "COST_ACCRUAL", key: "PAYABLE", account: "2110" },
  { event: "COST_PAYMENT", key: "PAYABLE", account: "2110" }, { event: "COST_PAYMENT", key: "BANK", account: "1242" },
  { event: "SETTLEMENT_ACCRUAL", key: "DIRECT:BASIC", account: "5122" }, { event: "SETTLEMENT_ACCRUAL", key: "ADMINISTRATIVE:BASIC", account: "5201" }, { event: "SETTLEMENT_ACCRUAL", key: "NET_PAY", account: "2132" }, { event: "SETTLEMENT_ACCRUAL", key: "GRATUITY", account: "5220" }, { event: "SETTLEMENT_ACCRUAL", key: "NOTICE_PAY", account: "5221" },   { event: "SETTLEMENT_ACCRUAL", key: "ADVANCE_RECOVERY", account: "1250" }, { event: "SETTLEMENT_ACCRUAL", key: "REIMBURSEMENT", account: "2135" },
  // Asset recovery is income — the company is made whole for something it
  // lost — and it points at the 4290 leaf, not the 4200 group, because
  // postSystemJournal refuses groups. Without the payroll key, the existing
  // DEDUCTION:* fallback credits 2132 Salary Payable and the deduction sits
  // forever as a payable to nobody.
  { event: "SETTLEMENT_ACCRUAL", key: "ASSET_RECOVERY", account: "4290", note: "Recovering a lost/damaged asset is income; re-point if the auditor prefers it netted against the disposal loss" },
  { event: "PAYROLL_ACCRUAL", key: "DEDUCTION:ASSET_RECOVERY", account: "4290", note: "An asset recovery is income, never a deduction payable to nobody" },
  // Always zero this phase. Seeded to the salary account so it resolves, with
  // a key of its own so a dedicated account is one edit rather than a deploy.
  { event: "SETTLEMENT_ACCRUAL", key: "DIRECT:LEAVE_ENCASHMENT", account: "5122", note: "Leave encashment is nil this phase; re-point when it is not" },
  { event: "SETTLEMENT_ACCRUAL", key: "ADMINISTRATIVE:LEAVE_ENCASHMENT", account: "5201", note: "Leave encashment is nil this phase; re-point when it is not" },
  { event: "SETTLEMENT_PAYMENT", key: "NET_PAY", account: "2132" }, { event: "SETTLEMENT_PAYMENT", key: "BANK", account: "1242" }, { event: "SETTLEMENT_PAYMENT", key: "REIMBURSEMENT", account: "2135" },
  // Asset acquisition: the key is AssetCategory.code. No bare "*" — an
  // unmapped category must stop, not land on whichever PPE account happened
  // to be the default. VEHICLE is deliberately absent: it exists as a
  // category and has no account in the filed chart, so it is the case that
  // proves the error path.
  { event: "ASSET_ACQUISITION", key: "LAPTOP", account: "1114" },
  { event: "ASSET_ACQUISITION", key: "MONITOR", account: "1112" },
  { event: "ASSET_ACQUISITION", key: "PHONE", account: "1112" },
  { event: "ASSET_ACQUISITION", key: "FURNITURE", account: "1111" },
  { event: "ASSET_ACQUISITION", key: "LICENCE", account: "1113" },
  { event: "ASSET_ACQUISITION", key: "PAYABLE", account: "2110" },
  { event: "ASSET_PAYMENT", key: "PAYABLE", account: "2110" },
  { event: "ASSET_PAYMENT", key: "BANK", account: "1242" },
  { event: "ASSET_DEPRECIATION", key: "DIRECT", account: "5128" },
  { event: "ASSET_DEPRECIATION", key: "ADMINISTRATIVE", account: "5215" },
  // 4200 and 5200 are groups; postSystemJournal refuses groups, so these
  // point at the miscellaneous leaves. A dedicated "Gain on disposal" leaf is
  // one seed row and one edit on the posting-rules screen if the auditor
  // wants them separable — the same posture leave encashment took.
  { event: "ASSET_DISPOSAL", key: "GAIN", account: "4290", note: "Shared with miscellaneous income; re-point if disposal gains need separating" },
  { event: "ASSET_DISPOSAL", key: "LOSS", account: "5217", note: "Shared with miscellaneous expenses; re-point if disposal losses need separating" },
  { event: "ASSET_DISPOSAL", key: "BANK", account: "1242" },
]
export const REQUIRED_KEYS: Record<PostingEvent, string[]> = {
  PAYROLL_ACCRUAL: ["NET_PAY", "DEDUCTION:*", "DIRECT:*", "ADMINISTRATIVE:*"],
  PAYROLL_PAYMENT: ["NET_PAY", "REIMBURSEMENT", "BANK"],
  EXPENSE_ACCRUAL: ["*", "REIMBURSEMENT"],
  COST_ACCRUAL: ["*", "PAYABLE"], COST_PAYMENT: ["PAYABLE", "BANK"],
  SETTLEMENT_ACCRUAL: ["DIRECT:BASIC", "ADMINISTRATIVE:BASIC", "DIRECT:LEAVE_ENCASHMENT", "ADMINISTRATIVE:LEAVE_ENCASHMENT", "GRATUITY", "NOTICE_PAY", "REIMBURSEMENT", "ADVANCE_RECOVERY", "ASSET_RECOVERY", "NET_PAY"],
  SETTLEMENT_PAYMENT: ["NET_PAY", "BANK"],
  ASSET_ACQUISITION: ["PAYABLE"],
  ASSET_PAYMENT: ["PAYABLE", "BANK"],
  ASSET_DEPRECIATION: ["DIRECT", "ADMINISTRATIVE"],
  ASSET_DISPOSAL: ["GAIN", "LOSS", "BANK"],
}

/**
 * Writes the rules above into the database. Idempotent, and safe to re-run
 * against a live system — which is the point, because a rule added to the
 * list after a database was first seeded reaches it no other way.
 *
 * **An existing rule is left completely alone.** Finance may deliberately
 * re-point one on the posting-rules screen (several rows above carry a note
 * inviting exactly that), so an `update` here would quietly undo their
 * decision on the next run. Same posture, and the same reasoning, as
 * `accounting.seed.ts`: a re-run fills in what is missing and changes
 * nothing else.
 */
export async function seedPostingRules(): Promise<void> {
  const codes = [...new Set(POSTING_RULES.map((r) => r.account))]
  const accounts = await prisma.account.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  })
  const ids = new Map(accounts.map((a) => [a.code, a.id]))

  // Loudly, not `continue`. A rule pointing at an account that is not in the
  // chart used to be skipped in silence, so the first anyone knew of it was a
  // posting failing months later — or, worse, resolving through a wildcard to
  // the wrong account and never failing at all.
  const orphans = POSTING_RULES.filter((r) => !ids.has(r.account))
  if (orphans.length > 0) {
    const detail = orphans.map((r) => `${r.event}/${r.key} -> ${r.account}`).join(", ")
    throw new Error(
      `Posting rules reference ${orphans.length} account code(s) missing from the chart: ${detail}. ` +
        `Seed the chart of accounts first, or correct the codes.`
    )
  }

  for (const r of POSTING_RULES) {
    await prisma.postingRule.upsert({
      where: { event_key: { event: r.event, key: r.key } },
      update: {},
      create: { event: r.event, key: r.key, accountId: ids.get(r.account)!, note: r.note ?? null },
    })
  }
}
