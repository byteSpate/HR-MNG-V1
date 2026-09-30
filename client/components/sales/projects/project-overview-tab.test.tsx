import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { ProjectLineSummary, ProjectSummary } from "@/lib/api/types"
import { ProjectOverviewTab } from "@/components/sales/projects/project-overview-tab"

const summary = (o: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: "prj-1", serial: "BS-PRJ-00001", name: "Core refresh",
  opportunity: { id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", track: "NETWORKING" },
  salesAccount: { id: "acc-1", name: "Rising Group" },
  manager: { employeeId: "emp-1", fullName: "Rahim", onAccount: true },
  team: [],
  startOn: null, dueOn: "2026-10-05", priority: "NORMAL",
  budget: "500000", value: "1000000", plannedCost: "800000",
  spentSoFar: null, canSeeCost: false,
  status: "IN_PROGRESS", statusReason: null, completedAt: null,
  milestones: [],
  progress: null,
  people: [],
  health: "ON_TRACK",
  daysLeft: 7, quietDays: null, lastUpdateAt: "2026-09-27T10:00:00.000Z",
  latestLog: null,
  openTaskCount: 0,
  lines: [],
  canManage: true, canTick: true,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-27T10:00:00.000Z",
  ...o,
} as ProjectSummary)

const line = (o: Partial<ProjectLineSummary> = {}): ProjectLineSummary => ({
  id: "l1", product: "Firewall", oemBrand: null, model: null, partNo: null, quantity: 1,
  supplierName: null, lineValue: null, marginPercent: null, note: null, done: null, ...o,
})

const html = (p: ProjectSummary) => renderToStaticMarkup(<ProjectOverviewTab project={p} />)

test("says no progress rather than 0% when a Project has no tasks yet (Review Focus 1)", () => {
  const out = html(summary({ progress: null }))
  assert.match(out, /No tasks yet, so there is no progress to show\./)
  assert.doesNotMatch(out, /0%/)
  assert.doesNotMatch(out, /role="progressbar"/)
})

test("shows no health for a finished or not started Project, rather than a made-up On track (Review Focus 1)", () => {
  const none = html(summary({ health: null }))
  assert.match(none, /No health to show yet/)
  assert.doesNotMatch(none, />On track</)
  // A real health is shown as a tag, and the placeholder goes away.
  const late = html(summary({ health: "LATE" }))
  assert.match(late, />Late</)
  assert.doesNotMatch(late, /No health to show yet/)
  assert.match(html(summary({ health: "AT_RISK" })), />At risk</)
})

test("says a passed finish date is late, and no health means a dash rather than On track (Review Focus 3)", () => {
  assert.match(html(summary({ daysLeft: -3 })), />3 days late/)
  assert.match(html(summary({ daysLeft: 0 })), />Due today/)
  assert.match(html(summary({ daysLeft: 7 })), />7 days left/)
  assert.match(html(summary({ daysLeft: null })), />No finish date/)
  assert.match(html(summary({ daysLeft: null, status: "COMPLETED" })), />Finished/)
  // The finish date itself is shown as a calendar day, read as written.
  assert.match(html(summary()), /Finish date 05\/10\/2026/)
})

test("warns a quiet Project in plain words, and stays quiet about a Project that is not (Review Focus 2)", () => {
  const out = html(summary({ quietDays: 9 }))
  assert.match(out, /No update for 9 days/)
  assert.match(out, /Ask the Project Manager for an update\./)
  assert.doesNotMatch(html(summary({ quietDays: null })), /No update for/)
})

test("shows no Spent so far row at all to a viewer who may not see cost (Review Focus 4)", () => {
  const hidden = html(summary({ canSeeCost: false, spentSoFar: null }))
  assert.doesNotMatch(hidden, /Spent so far/)
  // Not even a placeholder that hints at a number somebody else can see.
  assert.doesNotMatch(hidden, /Not set/)

  const shown = html(summary({ canSeeCost: true, spentSoFar: "250000.00" }))
  assert.match(shown, /Spent so far/)
  assert.match(shown, /৳250,000/)
  // The other money rows are there either way.
  assert.match(hidden, /Opportunity value/)
  assert.match(hidden, /Budget/)
  assert.match(hidden, /Planned cost/)
})

test("says a day marked as no work was a day with no work", () => {
  const out = html(summary({
    latestLog: { date: "2026-09-26", byName: "Karim", text: null, noWork: true },
  }))
  assert.match(out, /Latest Daily Log line/)
  assert.match(out, /No work on this day/)
  assert.match(out, /Karim · 26\/09\/2026/)
  assert.match(html(summary({ latestLog: null })), /No Daily Log line yet/)
  assert.match(html(summary()), /No milestones yet/)
})

test("counts the people, the products and the tasks of one Project", () => {
  const out = html(summary({
    progress: { done: 3, total: 5, percent: 60 },
    openTaskCount: 2,
    people: [{ employeeId: "emp-1", fullName: "Rahim", open: 1, late: 1 }],
    lines: [line({ done: { at: "2026-09-20T00:00:00.000Z", byName: "Rahim" } }), line({ id: "l2" })],
  } as Partial<ProjectSummary>))
  assert.match(out, /3 of 5 tasks done \(60%\)/)
  assert.match(out, /aria-valuenow="60"/)
  assert.match(out, />2 open tasks/)
  assert.match(out, /Rahim/)
  assert.match(out, /1 open/)
  assert.match(out, /1 late/)
  assert.match(out, />Products delivered</)
  assert.match(out, /1 of 2 products done/)
})

test("calls a Software Opportunity's lines Modules, and a Networking one's Products", () => {
  const software = (o: Partial<ProjectSummary> = {}) => html(summary({
    opportunity: { id: "opp-1", serial: "BS-OPP-00001", name: "Leave", track: "SOFTWARE_DEVELOPMENT" },
    ...o,
  } as Partial<ProjectSummary>))
  assert.match(software(), />Modules delivered</)
  assert.match(software({ lines: [] }), /The Opportunity has no modules yet\./)
  assert.match(software({ lines: [line({ id: "m1", done: { at: "x", byName: null } })] }), /1 of 1 module done/)
  assert.match(html(summary()), />Products delivered</)
  assert.match(html(summary({ lines: [] })), /The Opportunity has no products yet\./)
})

test("says 'No finish date' once, without a second 'Finish date Not set' beside it", () => {
  const none = html(summary({ dueOn: null, daysLeft: null } as Partial<ProjectSummary>))
  assert.match(none, /No finish date/)
  assert.doesNotMatch(none, /Finish date\s*(<!-- -->)?\s*Not set/)
  assert.doesNotMatch(none, /Not set<\/span>/)
  // With a date, the date is shown next to the days left, as before.
  assert.match(html(summary()), /Finish date 05\/10\/2026/)
})

test("says 1 task and 1 product, not 1 tasks and 1 products", () => {
  const one = html(summary({
    progress: { done: 1, total: 1, percent: 100 },
    openTaskCount: 1,
    lines: [line({ id: "p1", done: null })],
  } as Partial<ProjectSummary>))
  assert.match(one, /1 of 1 task done \(100%\)/)
  assert.match(one, />1 open task</)
  assert.match(one, /0 of 1 product done/)
  assert.doesNotMatch(one, /1 open tasks|1 of 1 tasks|1 of 1 products/)
  // And the plural is still a plural.
  const many = html(summary({
    progress: { done: 1, total: 2, percent: 50 },
    openTaskCount: 2,
    lines: [line({ id: "p1", done: null }), line({ id: "p2", done: null })],
  } as Partial<ProjectSummary>))
  assert.match(many, /1 of 2 tasks done \(50%\)/)
  assert.match(many, />2 open tasks</)
  assert.match(many, /0 of 2 products done/)
})
