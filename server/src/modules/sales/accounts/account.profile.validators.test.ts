import { describe, expect, it } from "vitest"

import { updateAccountProfileSchema } from "./account.profile.validators"

const uuid = "11111111-1111-4111-8111-111111111111"
const parse = (body: unknown) => updateAccountProfileSchema.safeParse(body)
const message = (body: unknown) => {
  const result = parse(body)
  return result.success ? null : result.error.issues[0].message
}

describe("the company profile body", () => {
  it("refuses a body that changes nothing", () => {
    expect(message({})).toBe("Nothing was changed")
    expect(message({ answers: {} })).toBe("Nothing was changed")
    expect(message({ custom: { add: [] } })).toBe("Nothing was changed")
  })

  it("takes an answer, a cleared answer, and own questions", () => {
    expect(parse({ answers: { branches: { answer: "YES", detail: "Chattogram" }, staff: null } }).success).toBe(true)
    expect(parse({ custom: { add: [{ question: "Who is the CTO?", answer: "Mr Rahman" }] } }).success).toBe(true)
    expect(parse({ custom: { update: [{ id: uuid, question: "Who is the CTO?", answer: "Mr Karim" }], remove: [uuid] } }).success).toBe(true)
  })

  it("asks for both the question and the answer of an own question", () => {
    expect(message({ custom: { add: [{ question: " ", answer: "x" }] } })).toBe("Write the question")
    expect(message({ custom: { add: [{ question: "Who?", answer: " " }] } })).toBe("Write the answer")
  })

  it("keeps answers short and stops at 30 own questions at once", () => {
    expect(message({ answers: { internet: { answer: "x".repeat(301) } } })).toBe("Keep each answer under 300 characters")
    const many = Array.from({ length: 31 }, (_, i) => ({ question: `Q${i} here`, answer: "a" }))
    expect(parse({ custom: { add: many } }).success).toBe(false)
  })
})
