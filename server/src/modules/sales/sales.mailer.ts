/**
 * The Sales Hub's two emails (revision §24.14-19).
 *
 * Both go through `notify`: a mail server refusing one must not undo a
 * meeting change or throw out of the 00:01 job, and the failure is still on
 * its EmailDispatch row.
 */

import { env } from "../../config/env"
import { renderEmail, serialFor, type FactRow, type Stamp } from "../../templates/email"
import { formatShortDate } from "../../utils/dates"
import { notify } from "../../utils/mailer"
import { officeTimeOf } from "../attendance/attendance.time"
import { MEETING_MODE_LABEL, whenLabel } from "./meetings/meeting.present"
import type { DailyDigest } from "./sales.reminders"
import type { WeeklyReminder } from "./weekly/weekly.reminders"

const appLink = (path: string) => `${env.CLIENT_ORIGIN}/sales${path}`
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

function meetingPlace(meeting: { mode: string; location: string | null }): string {
  return [MEETING_MODE_LABEL[meeting.mode], meeting.location].filter(Boolean).join(" · ")
}

export async function sendSalesDailyEmail(digest: DailyDigest, today: Date): Promise<void> {
  const counts = [
    digest.meetings.length > 0 ? plural(digest.meetings.length, "meeting") : null,
    digest.tasks.length > 0 ? plural(digest.tasks.length, "task") : null,
  ]
    .filter(Boolean)
    .join(" and ")
  const subject = `Today: ${counts}`
  const overdue = digest.tasks.filter((task) => task.overdue).length

  const facts: FactRow[] = [
    ...digest.meetings.map((meeting) => ({
      label: `${officeTimeOf(meeting.scheduledAt)} · ${meeting.title}`,
      value: [meeting.salesAccountName, meetingPlace(meeting)].filter(Boolean).join(" · "),
    })),
    ...digest.tasks.map((task) => ({
      label: task.salesAccountName ? `Task · ${task.title} (${task.salesAccountName})` : `Task · ${task.title}`,
      value: task.overdue ? `Overdue, was due ${formatShortDate(task.dueOn)}` : "Due today",
    })),
  ]
  const intro = `Here is what you have on ${formatShortDate(today)}, ${digest.fullName}.`
  const link = appLink(digest.meetings.length > 0 ? "/meetings" : "/tasks")

  await notify({
    to: digest.email,
    kind: "SALES_DAILY_EMAIL",
    subject,
    text: [intro, "", ...facts.map((fact) => `${fact.label}: ${fact.value}`), "", `Open the Sales Hub: ${link}`].join("\n"),
    html: renderEmail({
      preheader: counts,
      serial: serialFor("SALES_DAILY_EMAIL"),
      subject,
      stamp: overdue > 0 ? { label: `${overdue} overdue`, tone: "action" } : { label: "Today", tone: "issued" },
      intro,
      facts,
      action: { label: digest.meetings.length > 0 ? "Open my meetings" : "Open my tasks", href: link },
      footer:
        "You are receiving this because you have meetings or tasks in the Sales Hub today. It comes once a day at 00:01, and never on your day off.",
    }),
    entity: "EMPLOYEE",
    entityId: digest.employeeId,
  })
}

/** Told straight away, because the 00:01 email cannot know about a change at 10:00 (§24.17). */
export type MeetingChange = "added" | "moved" | "cancelled" | "back_on"

const CHANGE: Record<MeetingChange, { subject: string; stamp: Stamp; intro: string }> = {
  added: {
    subject: "Added to a meeting",
    stamp: { label: "Scheduled", tone: "issued" },
    intro: "You have been added to a meeting with a customer.",
  },
  moved: {
    subject: "Meeting moved",
    stamp: { label: "Moved", tone: "action" },
    intro: "A meeting you are in has a new time.",
  },
  cancelled: {
    subject: "Meeting cancelled",
    stamp: { label: "Cancelled", tone: "declined" },
    intro: "A meeting you are in has been cancelled. You do not need to go.",
  },
  back_on: {
    subject: "Meeting back on",
    stamp: { label: "Back on", tone: "approved" },
    intro: "A meeting you were told was cancelled is back on.",
  },
}

export interface MeetingChangedInput {
  to: string
  fullName: string
  change: MeetingChange
  meeting: {
    id: string
    title: string
    scheduledAt: Date
    mode: string
    location: string | null
    salesAccountName: string
  }
  /** For a moved meeting, the time it had. */
  previousAt?: Date
  /** For a cancelled meeting, why. */
  reason?: string
}

export async function sendMeetingChanged(input: MeetingChangedInput): Promise<void> {
  const copy = CHANGE[input.change]
  const subject = `${copy.subject}: ${input.meeting.title}`
  const facts: FactRow[] = [
    { label: "When", value: whenLabel(input.meeting.scheduledAt) },
    ...(input.previousAt ? [{ label: "Was", value: whenLabel(input.previousAt) }] : []),
    { label: "Where", value: meetingPlace(input.meeting) },
    { label: "Account", value: input.meeting.salesAccountName },
    ...(input.reason ? [{ label: "Reason", value: input.reason }] : []),
  ]
  const link = appLink("/meetings")

  await notify({
    to: input.to,
    kind: "SALES_MEETING_CHANGED",
    subject,
    text: [copy.intro, "", ...facts.map((fact) => `${fact.label}: ${fact.value}`), "", `Open your meetings: ${link}`].join("\n"),
    html: renderEmail({
      serial: serialFor("SALES_MEETING_CHANGED", input.meeting.id),
      subject,
      stamp: copy.stamp,
      intro: `${input.fullName}, ${copy.intro.charAt(0).toLowerCase()}${copy.intro.slice(1)}`,
      facts,
      action: { label: "Open my meetings", href: link },
      footer: "You are receiving this because you are on our side of this meeting.",
    }),
    entity: "SALES_MEETING",
    entityId: input.meeting.id,
  })
}

/**
 * The weekly report reminder (§26.3), at 16:00 on the day it is due — the
 * Thursday, or the last working day before it when the Thursday is a holiday.
 * One per person per week; a submitted week gets none.
 */
export async function sendWeeklyReminder(reminder: WeeklyReminder): Promise<void> {
  const week = `${formatShortDate(reminder.weekStart)} to ${formatShortDate(reminder.deadlineDay)}`
  const subject = "Your weekly report is due today"
  const intro = `${reminder.fullName}, your weekly report for ${week} has not been submitted. It is due by the end of today.`
  const link = appLink("/weekly")
  const facts: FactRow[] = [
    { label: "Week", value: week },
    { label: "Due", value: `End of ${formatShortDate(reminder.deadlineDay)}` },
  ]

  await notify({
    to: reminder.email,
    kind: "SALES_WEEKLY_REMINDER",
    subject,
    text: [intro, "", ...facts.map((fact) => `${fact.label}: ${fact.value}`), "", `Open your week: ${link}`].join("\n"),
    html: renderEmail({
      preheader: "Due by the end of today",
      serial: serialFor("SALES_WEEKLY_REMINDER"),
      subject,
      stamp: { label: "Due today", tone: "action" },
      intro,
      facts,
      action: { label: "Open my week", href: link },
      footer:
        "You are receiving this because your weekly report is still a draft on the day it is due. It comes once a week, and never on a day the office is closed.",
    }),
    entity: "EMPLOYEE",
    entityId: reminder.employeeId,
  })
}
