/**
 * The notification reminders, grouped by when they run.
 *
 * Each body is exported apart from its schedule, like the other jobs, so it
 * can be run by hand or in a test. Each returns how many rows it offered;
 * `dedupeKey` makes a second run write nothing new.
 */

import {
  remindAssetsNotAccepted,
  remindLeaveTomorrow,
  remindMeetingsSoon,
  remindNotCheckedOut,
  remindTasksDueAndLate,
  remindWaitingTwoDays,
} from "../modules/inbox/inbox.reminders"

/** Every 5 minutes. */
export function runMeetingReminders(): Promise<number> {
  return remindMeetingsSoon()
}

/** 08:30: the morning reminders. */
export async function runMorningReminders(): Promise<number> {
  const counts = await Promise.all([
    remindTasksDueAndLate(),
    remindWaitingTwoDays(),
    remindAssetsNotAccepted(),
    remindLeaveTomorrow(),
  ])
  return counts.reduce((a, b) => a + b, 0)
}

/** 21:30, before the 22:05 automatic check-out. */
export function runCheckOutReminders(): Promise<number> {
  return remindNotCheckedOut()
}
