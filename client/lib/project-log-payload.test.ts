import assert from "node:assert/strict"
import test from "node:test"

import { projectLogBody } from "./project-log-payload"

test("sends only the day, because the server wants YYYY-MM-DD and a Weekly Report day is a full timestamp", () => {
  const body = projectLogBody("2026-09-26T00:00:00.000Z", "prj-1", { text: "Racked it", noWork: false })
  assert.equal(body.date, "2026-09-26")
})

test("leaves a plain day as it is", () => {
  assert.equal(projectLogBody("2026-09-26", "prj-1", { text: "x", noWork: false }).date, "2026-09-26")
})

test("sends the line, trimmed, when work was done", () => {
  assert.deepEqual(projectLogBody("2026-09-27", "prj-1", { text: "  Racked it  ", noWork: false }), {
    date: "2026-09-27", projectId: "prj-1", noWork: false, text: "Racked it",
  })
})

test("sends no text at all when the person ticked No work", () => {
  assert.deepEqual(projectLogBody("2026-09-27", "prj-1", { text: "left over", noWork: true }), {
    date: "2026-09-27", projectId: "prj-1", noWork: true, text: null,
  })
})
