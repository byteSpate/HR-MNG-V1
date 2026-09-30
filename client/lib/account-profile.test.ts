import assert from "node:assert/strict"
import test from "node:test"

import type { AccountProfile } from "@/lib/api/types"
import { answerLine, customAdds, diffProfile, draftOf, draftProblem } from "./account-profile"

const profile: AccountProfile = {
  groups: [
    {
      key: "offices",
      title: "Offices and sites",
      questions: [
        { key: "branches", text: "Does the company have branches?", type: "YES_NO", detailLabel: "Where are they, and how many?", options: null, answer: "YES", detail: "Chattogram", answeredByName: "Rahim", answeredAt: "2026-09-21T00:00:00.000Z" },
        { key: "staff", text: "How many people work in the company?", type: "NUMBER", detailLabel: null, options: null, answer: null, detail: null, answeredByName: null, answeredAt: null },
      ],
    },
  ],
  custom: [{ id: "c1", question: "Who is the CTO?", answer: "Mr Rahman", answeredByName: "Rahim", answeredAt: "2026-09-21T00:00:00.000Z" }],
  answered: 1,
  total: 2,
  canManage: true,
}

test("a draft made from the profile changes nothing", () => {
  assert.equal(diffProfile(profile, draftOf(profile)), null)
})

test("sends a new answer, and a changed Yes with its detail", () => {
  const draft = draftOf(profile)
  draft.answers.staff = { answer: "250", detail: "" }
  draft.answers.branches = { answer: "YES", detail: "Chattogram, Sylhet" }
  assert.deepEqual(diffProfile(profile, draft), {
    answers: { staff: { answer: "250" }, branches: { answer: "YES", detail: "Chattogram, Sylhet" } },
  })
})

test("drops the detail when the answer becomes No", () => {
  const draft = draftOf(profile)
  draft.answers.branches = { answer: "NO", detail: "Chattogram" }
  assert.deepEqual(diffProfile(profile, draft), { answers: { branches: { answer: "NO" } } })
})

test("clears an answer that was blanked, and ignores a blank that was already blank", () => {
  const draft = draftOf(profile)
  draft.answers.branches = { answer: "", detail: "" }
  draft.answers.staff = { answer: "  ", detail: "" }
  assert.deepEqual(diffProfile(profile, draft), { answers: { branches: null } })
})

test("adds, updates and removes the account's own questions", () => {
  const draft = draftOf(profile)
  draft.custom = [
    { id: "c1", question: "Who is the CTO?", answer: "Mr Karim" },
    { id: null, question: " Any CCTV vendor? ", answer: " Hikvision " },
    { id: null, question: "", answer: "" },
  ]
  assert.deepEqual(diffProfile(profile, draft), {
    custom: { add: [{ question: "Any CCTV vendor?", answer: "Hikvision" }], update: [{ id: "c1", question: "Who is the CTO?", answer: "Mr Karim" }] },
  })
  draft.custom = []
  assert.deepEqual(diffProfile(profile, draft), { custom: { remove: ["c1"] } })
})

test("says so when an own question has only one of its two boxes filled", () => {
  const sentence = "Fill in both the question and the answer, or remove the row."
  assert.equal(draftProblem({ custom: [{ id: null, question: "Who?", answer: "" }] }), sentence)
  assert.equal(draftProblem({ custom: [{ id: "c1", question: "", answer: "x" }] }), sentence)
  assert.equal(draftProblem({ custom: [{ id: null, question: "", answer: "" }] }), null)
  assert.equal(draftProblem({ custom: [{ id: null, question: "Who?", answer: "Me" }] }), null)
})

test("makes a body from the rows of the create form", () => {
  assert.equal(customAdds([]), null)
  assert.equal(customAdds([{ id: null, question: " ", answer: " " }]), null)
  assert.deepEqual(customAdds([{ id: null, question: " Who? ", answer: " Me " }]), { custom: { add: [{ question: "Who?", answer: "Me" }] } })
})

test("reads an answer as a sentence, or nothing", () => {
  const [branches, staff] = profile.groups[0].questions
  assert.equal(answerLine(branches), "Yes, Chattogram")
  assert.equal(answerLine({ ...branches, detail: null }), "Yes")
  assert.equal(answerLine({ ...branches, answer: "NO", detail: null }), "No")
  assert.equal(answerLine(staff), null)
  assert.equal(answerLine({ ...staff, answer: "250" }), "250")
})
