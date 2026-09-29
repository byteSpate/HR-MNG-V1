import assert from "node:assert/strict"
import test from "node:test"

import { generalTaskChoices, projectTaskChoices, taskPeople } from "./task-choices"

test("on the Tasks page a person's own task can be cancelled and brought back", () => {
  assert.deepEqual(generalTaskChoices({ origin: "SELF", status: "PENDING" }), { cancel: true, reopen: true })
  assert.deepEqual(generalTaskChoices({ origin: "FUNNEL_MEETING", status: "CANCELLED" }), { cancel: true, reopen: true })
})

test("on the Tasks page a Project Task cannot be cancelled: only the Project Manager does that", () => {
  assert.equal(generalTaskChoices({ origin: "PROJECT", status: "PENDING" }).cancel, false)
})

test("on the Tasks page a cancelled Project Task cannot be brought back, but a done one can", () => {
  assert.equal(generalTaskChoices({ origin: "PROJECT", status: "CANCELLED" }).reopen, false)
  assert.equal(generalTaskChoices({ origin: "PROJECT", status: "DONE" }).reopen, true)
})

test("on the Project a pending task is marked done by its assignee only", () => {
  assert.equal(projectTaskChoices({ status: "PENDING", canManage: true }, false).done, true)
  assert.equal(projectTaskChoices({ status: "PENDING", canManage: false }, true).done, false)
})

test("on the Project the manager can cancel any pending task, even one that is not theirs", () => {
  assert.equal(projectTaskChoices({ status: "PENDING", canManage: false }, true).cancel, true)
  assert.equal(projectTaskChoices({ status: "PENDING", canManage: true }, false).cancel, false)
})

test("on the Project a finished or cancelled task offers nothing", () => {
  assert.deepEqual(projectTaskChoices({ status: "DONE", canManage: true }, true), { done: false, cancel: false })
  assert.deepEqual(projectTaskChoices({ status: "CANCELLED", canManage: true }, true), { done: false, cancel: false })
})

test("the Who list names the manager once, even when the manager is also on the team", () => {
  const manager = { employeeId: "e1", fullName: "Rezaul" }
  const team = [
    { employeeId: "e1", fullName: "Rezaul" },
    { employeeId: "e2", fullName: "Noman" },
  ]
  assert.deepEqual(taskPeople(manager, team).map((p) => p.employeeId), ["e1", "e2"])
})

test("the Who list keeps the manager first, then the team in order", () => {
  const manager = { employeeId: "e9", fullName: "Anwar" }
  const team = [{ employeeId: "e2", fullName: "Noman" }, { employeeId: "e3", fullName: "Salma" }]
  assert.deepEqual(taskPeople(manager, team).map((p) => p.employeeId), ["e9", "e2", "e3"])
})
