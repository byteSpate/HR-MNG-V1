#!/usr/bin/env node
// Read-only. Prints one payroll run's payslips as sorted JSON, so two runs of
// the same month can be compared with `diff`.
//
//   node scripts/perf/dump-payslips.mjs <runId> > perf-results/payslips-before.json
//
// It leaves out ids, payslip numbers and dates, which change on every
// reprocess. Everything that is money, and every link, is kept.
import "dotenv/config"
import pg from "pg"

const runId = process.argv[2]
if (!runId) {
  console.error("Use: node scripts/perf/dump-payslips.mjs <runId>")
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to server/.env and run again.")
  process.exit(1)
}
// So it is always clear which database was read. The password is never printed.
console.error(`reading from ${new URL(process.env.DATABASE_URL).host}`)

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const payslips = await client.query(
  `select p."employeeId", p."calendarDays", p."lopDays"::text, p."payableDays"::text, p."currency",
          p."basic"::text, p."grossFull"::text, p."grossPay"::text, p."totalDeductions"::text,
          p."netPay"::text, p."reimbursements"::text, p."netPayable"::text, p."fxRateToBdt"::text,
          p."grossPayBdt"::text, p."totalDeductionsBdt"::text, p."netPayBdt"::text,
          p."netPayableBdt"::text, p."breakdown"
   from "Payslip" p where p."payrollRunId" = $1 order by p."employeeId"`,
  [runId]
)
const adjustments = await client.query(
  `select a."id", p."employeeId" from "PayrollAdjustment" a
   join "Payslip" p on p."id" = a."payslipId" where p."payrollRunId" = $1 order by a."id"`,
  [runId]
)
const claims = await client.query(
  `select c."id", p."employeeId" from "ExpenseClaim" c
   join "Payslip" p on p."id" = c."payslipId" where p."payrollRunId" = $1 order by c."id"`,
  [runId]
)
const numbers = await client.query(
  `select p."employeeId", p."payslipNo" from "Payslip" p where p."payrollRunId" = $1 order by p."payslipNo"`,
  [runId]
)
await client.end()

console.log(
  JSON.stringify(
    {
      payslips: payslips.rows,
      adjustmentLinks: adjustments.rows,
      claimLinks: claims.rows,
      // Only the ORDER of employees by payslip number, not the numbers.
      numberingOrder: numbers.rows.map((r) => r.employeeId),
    },
    null,
    2
  )
)
