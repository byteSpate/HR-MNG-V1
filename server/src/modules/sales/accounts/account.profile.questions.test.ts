import { describe, expect, it } from "vitest"

import { AppError } from "../../../middleware/errorHandler"
import {
  answerText, checkAnswer, PROFILE_GROUPS, PROFILE_QUESTIONS, QUESTION_BY_KEY,
} from "./account.profile.questions"

const q = (key: string) => QUESTION_BY_KEY.get(key)!

describe("the ready-made questions", () => {
  it("have unique keys, and every group has at least one question", () => {
    const keys = PROFILE_QUESTIONS.map((x) => x.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const group of PROFILE_GROUPS) {
      expect(PROFILE_QUESTIONS.some((x) => x.group === group.key)).toBe(true)
    }
    for (const question of PROFILE_QUESTIONS) {
      expect(PROFILE_GROUPS.some((g) => g.key === question.group)).toBe(true)
    }
  })

  it("give every pick-list question at least two options, and only Yes/No questions a follow-up", () => {
    for (const question of PROFILE_QUESTIONS) {
      if (question.type === "CHOICE") expect(question.options!.length).toBeGreaterThanOrEqual(2)
      else expect(question.options).toBeUndefined()
      if (question.type !== "YES_NO") expect(question.detailLabel).toBeUndefined()
    }
  })

  it("are written without em-dashes", () => {
    for (const question of PROFILE_QUESTIONS) {
      expect(`${question.text} ${question.detailLabel ?? ""} ${(question.options ?? []).join(" ")}`).not.toContain("—")
    }
  })
})

describe("checking an answer", () => {
  it("keeps the detail of a Yes and drops the detail of a No", () => {
    expect(checkAnswer(q("branches"), { answer: "YES", detail: " Chattogram " })).toEqual({ answer: "YES", detail: "Chattogram" })
    expect(checkAnswer(q("branches"), { answer: "NO", detail: "Chattogram" })).toEqual({ answer: "NO", detail: null })
    expect(checkAnswer(q("branches"), { answer: "YES", detail: "  " })).toEqual({ answer: "YES", detail: null })
  })

  it("refuses anything but YES or NO for a Yes/No question", () => {
    expect(() => checkAnswer(q("branches"), { answer: "MAYBE" })).toThrow(AppError)
    expect(() => checkAnswer(q("branches"), { answer: "MAYBE" })).toThrow(/Yes or No/)
  })

  it("takes whole numbers only", () => {
    expect(checkAnswer(q("staff"), { answer: "250" })).toEqual({ answer: "250", detail: null })
    for (const bad of ["1e5", "-3", "2.5", "twelve", "12345678"]) {
      expect(() => checkAnswer(q("staff"), { answer: bad })).toThrow(/whole number/)
    }
  })

  it("takes only the listed options for a pick list", () => {
    expect(checkAnswer(q("cabling"), { answer: "Fibre" })).toEqual({ answer: "Fibre", detail: null })
    expect(() => checkAnswer(q("cabling"), { answer: "Plastic" })).toThrow(/Choose one of/)
  })

  it("refuses a follow-up on a question that has none", () => {
    expect(() => checkAnswer(q("staff"), { answer: "10", detail: "about" })).toThrow(/no follow-up/)
    expect(() => checkAnswer(q("internet"), { answer: "BTCL 50 Mbps", detail: "x" })).toThrow(/no follow-up/)
  })

  it("refuses an empty answer and tells the person how to clear one", () => {
    expect(() => checkAnswer(q("internet"), { answer: "   " })).toThrow(/or clear it/)
  })
})

describe("the words for an answer", () => {
  it("reads Yes with its detail, No, or the answer itself", () => {
    expect(answerText(q("branches"), "YES", "Chattogram")).toBe("Yes, Chattogram")
    expect(answerText(q("branches"), "YES", null)).toBe("Yes")
    expect(answerText(q("branches"), "NO", null)).toBe("No")
    expect(answerText(q("staff"), "250", null)).toBe("250")
  })
})
