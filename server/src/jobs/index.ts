/**
 * Scheduled jobs. The first use of this directory, which the source spec
 * reserved for exactly this.
 */

import cron from "node-cron"

import { env } from "../config/env"
import { runAutoCloseOpenDays } from "./attendance-autoclose.job"
import { runApprovalsDigest, runMissingCheckOutNudge } from "./attendance-digest.job"
import {
  runDailyAttendanceReportEmail,
  runMonthlyAttendanceReportEmail,
} from "./attendance-report-email.job"
import { runSalesDailyEmail } from "./sales-daily-email.job"

/** Runs `job`, logging rather than throwing — an unhandled rejection inside
 *  a scheduled task takes the process down with it. */
async function guard(name: string, job: () => Promise<number>): Promise<void> {
  try {
    const count = await job()
    console.log(`[jobs] ${name}: ${count} notification${count === 1 ? "" : "s"}`)
  } catch (err) {
    console.error(`[jobs] ${name} failed`, err)
  }
}

export function startJobs(): void {
  // node-cron 4: schedule() starts the task immediately — there is no
  // `scheduled: false`. The timezone must be explicit, or the server's
  // locale decides when "morning" is, and a US-hosted server would send
  // the digest in the middle of the Dhaka night.
  // 21:59, one minute before the 22:00 attendance report, so the report counts
  // today's forgotten check-outs as closed. Each is closed at its shift's end
  // time, and the employee is told the next morning by the 09:30 nudge.
  cron.schedule("59 21 * * *", () => guard("auto check-out", runAutoCloseOpenDays), {
    timezone: env.APP_TIMEZONE,
  })

  cron.schedule("0 9 * * *", () => guard("approvals digest", runApprovalsDigest), {
    timezone: env.APP_TIMEZONE,
  })

  cron.schedule("30 9 * * *", () => guard("missing check-out nudge", runMissingCheckOutNudge), {
    timezone: env.APP_TIMEZONE,
  })

  // 22:00: today's report, to every Super Admin, right after the auto check-out above.
  cron.schedule("0 22 * * *", () => guard("daily attendance report", () => runDailyAttendanceReportEmail()), {
    timezone: env.APP_TIMEZONE,
  })

  // 08:00 on the 1st: last month's report, to every Super Admin.
  cron.schedule("0 8 1 * *", () => guard("monthly attendance report", () => runMonthlyAttendanceReportEmail()), {
    timezone: env.APP_TIMEZONE,
  })

  // 00:01, so the email is waiting when people wake and they can prepare for
  // a meeting before coming in (revision §24.14).
  cron.schedule("1 0 * * *", () => guard("sales daily email", () => runSalesDailyEmail()), {
    timezone: env.APP_TIMEZONE,
  })


  console.log(`[jobs] scheduled, timezone ${env.APP_TIMEZONE}`)
}
