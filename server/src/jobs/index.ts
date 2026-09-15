/**
 * Scheduled jobs. The first use of this directory, which the source spec
 * reserved for exactly this.
 */

import cron from "node-cron"

import { env } from "../config/env"
import { runAutoCloseOpenDays } from "./attendance-autoclose.job"
import { runApprovalsDigest, runMissingCheckOutNudge } from "./attendance-digest.job"
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
  // Just after the day rolls over, so a day is only ever closed once it is
  // genuinely over. Before the 09:30 nudge, which then describes what this
  // did rather than asking about a day still open.
  cron.schedule("5 0 * * *", () => guard("auto check-out", runAutoCloseOpenDays), {
    timezone: env.APP_TIMEZONE,
  })

  cron.schedule("0 9 * * *", () => guard("approvals digest", runApprovalsDigest), {
    timezone: env.APP_TIMEZONE,
  })

  cron.schedule("30 9 * * *", () => guard("missing check-out nudge", runMissingCheckOutNudge), {
    timezone: env.APP_TIMEZONE,
  })

  // 00:01, so the email is waiting when people wake and they can prepare for
  // a meeting before coming in (revision §24.14).
  cron.schedule("1 0 * * *", () => guard("sales daily email", () => runSalesDailyEmail()), {
    timezone: env.APP_TIMEZONE,
  })

  console.log(`[jobs] scheduled, timezone ${env.APP_TIMEZONE}`)
}
