import assert from "node:assert/strict"
import test from "node:test"

import { FUNNEL_NAME_HEADING, FUNNEL_NAME_HELP } from "./funnel-labels"

test("the funnel's name column is headed Opportunity name", () => {
  assert.equal(FUNNEL_NAME_HEADING, "Opportunity name")
})

test("the help text explains why only quoted Opportunities are listed, and never says deal or Project Name", () => {
  assert.match(FUNNEL_NAME_HELP, /quotation or proposal has been sent/)
  assert.doesNotMatch(FUNNEL_NAME_HELP, /\bdeals?\b|Project Name/i)
})
