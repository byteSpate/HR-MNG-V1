import assert from "node:assert/strict"
import test from "node:test"

import { badgeText, bellLabel, emptyText, itemHref, timeAgo } from "./inbox-format"

test("the badge shows the number, and 99+ above 99", () => {
  assert.equal(badgeText(1), "1")
  assert.equal(badgeText(99), "99")
  assert.equal(badgeText(100), "99+")
})

test("the badge is hidden for zero, while loading, and when the count failed", () => {
  // Never a 0 and never a guess: no number is a different fact from "none".
  assert.equal(badgeText(0), null)
  assert.equal(badgeText(undefined), null)
})

test("the bell button says how many are not read", () => {
  assert.equal(bellLabel(3), "Notifications, 3 not read")
  assert.equal(bellLabel(1), "Notifications, 1 not read")
  assert.equal(bellLabel(0), "Notifications")
  assert.equal(bellLabel(undefined), "Notifications")
})

test("each tab has its own empty message", () => {
  assert.equal(emptyText("important", false), "Nothing is waiting for you.")
  assert.equal(emptyText("primary", false), "No news about your things yet.")
  assert.equal(emptyText("all", false), "Nothing has happened yet.")
  assert.equal(emptyText("important", true), "You have read everything here.")
})

test("a link gets the reader's own route group in front", () => {
  assert.equal(itemHref("/hr", "/leave"), "/hr/leave")
  assert.equal(itemHref("/employee", null), null)
})

test("a sales link opens the Sales Hub, which has no route group", () => {
  // Sales events store paths relative to /sales (sales.mailer.ts, task.service.ts).
  assert.equal(itemHref("/employee", "/tasks"), "/sales/tasks")
  assert.equal(itemHref("/manager", "/accounts/acc-1"), "/sales/accounts/acc-1")
  assert.equal(itemHref("/admin", "/opportunities/op-1"), "/sales/opportunities/op-1")
  assert.equal(itemHref("/employee", "/meetings/minutes"), "/sales/meetings/minutes")
  assert.equal(itemHref("/employee", "/tasks?due=now"), "/sales/tasks?due=now")
  assert.equal(itemHref("/admin", "/sales/funnel"), "/sales/funnel")
})

test("a word that only starts like a sales area is not a sales link", () => {
  assert.equal(itemHref("/hr", "/tasksheet"), "/hr/tasksheet")
  assert.equal(itemHref("/hr", "/assets"), "/hr/assets")
})

test("time is short: just now, minutes, hours, days, then a date", () => {
  const now = new Date("2026-11-10T06:00:00.000Z").getTime()
  assert.equal(timeAgo("2026-11-10T05:59:30.000Z", now), "just now")
  assert.equal(timeAgo("2026-11-10T05:48:00.000Z", now), "12m")
  assert.equal(timeAgo("2026-11-10T03:00:00.000Z", now), "3h")
  assert.equal(timeAgo("2026-11-05T06:00:00.000Z", now), "5d")
  assert.equal(timeAgo("2026-10-01T06:00:00.000Z", now), "Oct 1")
})
