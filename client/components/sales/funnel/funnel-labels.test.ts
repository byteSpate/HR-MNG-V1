import assert from "node:assert/strict"
import test from "node:test"

import { coverageText, daysLeftText, FUNNEL_NAME_HEADING, FUNNEL_NAME_HELP, quarterOptions } from "./funnel-labels"

test("the funnel's name column is headed Opportunity name", () => {
  assert.equal(FUNNEL_NAME_HEADING, "Opportunity name")
})

test("the help text explains why only quoted Opportunities are listed, and never says deal or Project Name", () => {
  assert.match(FUNNEL_NAME_HELP, /quotation or proposal has been sent/)
  assert.doesNotMatch(FUNNEL_NAME_HELP, /\bdeals?\b|Project Name/i)
})

test("days left say overdue in plain words, and no date when there is none", () => {
  assert.equal(daysLeftText(12), "12 days")
  assert.equal(daysLeftText(1), "1 day")
  assert.equal(daysLeftText(0), "Today")
  assert.equal(daysLeftText(-5), "Overdue 5 days")
  assert.equal(daysLeftText(null), "No date")
})

test("coverage reads as times, or says the target is met, and never shows zero for no target", () => {
  assert.equal(coverageText({ coverage: "2.1", targetMet: false, target: "1" }), "2.1×")
  assert.equal(coverageText({ coverage: null, targetMet: true, target: "1" }), "Target met")
  assert.equal(coverageText({ coverage: null, targetMet: false, target: null }), "No target set")
  assert.equal(coverageText({ coverage: null, targetMet: false, target: "1" }), "No open quotes")
})

test("quarters for the picker: this one, the next, and this year's four", () => {
  const options = quarterOptions(new Date(2026, 9, 13))
  assert.deepEqual(options.slice(0, 2), [
    { value: "2026-Q4", label: "This quarter (Q4 2026)" },
    { value: "2027-Q1", label: "Next quarter (Q1 2027)" },
  ])
  assert.deepEqual(options.slice(2).map((o) => o.value), ["2026-Q1", "2026-Q2", "2026-Q3"])
})
