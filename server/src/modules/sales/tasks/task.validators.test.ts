import { describe, expect, it } from "vitest"

import { createTaskSchema, listTaskSchema, logDoneSchema } from "./task.validators"

const ID = "11111111-1111-4111-8111-111111111111"

describe("the task validators (owner, 2026-11-02: a task is also the daily log)", () => {
  it("lets a task have no account and defaults its type to Other", () => {
    const parsed = createTaskSchema.parse({ title: "Read the VAT guide", dueOn: "2026-11-03" })
    expect(parsed.salesAccountId).toBeUndefined()
    expect(parsed.type).toBe("OTHER")
  })

  it("refuses an Opportunity or a meeting on a task with no account", () => {
    for (const extra of [{ opportunityId: ID }, { meetingId: ID }]) {
      const result = createTaskSchema.safeParse({ title: "Call back", dueOn: "2026-11-03", ...extra })
      expect(result.success).toBe(false)
      expect(JSON.stringify(result.error?.issues)).toContain("A task with an Opportunity or a meeting needs an account.")
    }
  })

  it("accepts an Opportunity when the task has an account", () => {
    const result = createTaskSchema.safeParse({ title: "Call back", dueOn: "2026-11-03", salesAccountId: ID, opportunityId: ID })
    expect(result.success).toBe(true)
  })

  it("refuses a type that is not on the list", () => {
    expect(createTaskSchema.safeParse({ title: "Call back", dueOn: "2026-11-03", type: "PARTY" }).success).toBe(false)
  })

  it("I did this needs a title, a type and a day, and the account is optional", () => {
    expect(logDoneSchema.safeParse({ title: "Sent the BOQ", type: "QUOTATION_SENT", doneOn: "2026-11-02" }).success).toBe(true)
    expect(logDoneSchema.safeParse({ title: "Sent the BOQ", doneOn: "2026-11-02" }).success).toBe(false)
    expect(logDoneSchema.safeParse({ title: "S", type: "OTHER", doneOn: "2026-11-02" }).success).toBe(false)
    expect(logDoneSchema.safeParse({ title: "Sent the BOQ", type: "OTHER", doneOn: "02/11/2026" }).success).toBe(false)
  })

  it("I did this refuses an Opportunity with no account", () => {
    const result = logDoneSchema.safeParse({ title: "Sent the BOQ", type: "OTHER", doneOn: "2026-11-02", opportunityId: ID })
    expect(result.success).toBe(false)
  })

  it("the list accepts the Logs and take-out filters", () => {
    const parsed = listTaskSchema.parse({
      noAccount: "true", type: "LEARNING", from: "2026-11-01", to: "2026-11-05", assignedToEmployeeId: ID, takeOuts: "true",
    })
    expect(parsed).toMatchObject({ noAccount: true, type: "LEARNING", from: "2026-11-01", to: "2026-11-05", assignedToEmployeeId: ID, takeOuts: true })
  })

  it("the list leaves noAccount and takeOuts off unless they are 'true'", () => {
    const parsed = listTaskSchema.parse({ noAccount: "false", takeOuts: "false" })
    expect(parsed.noAccount).toBeUndefined()
    expect(parsed.takeOuts).toBeUndefined()
  })
})
