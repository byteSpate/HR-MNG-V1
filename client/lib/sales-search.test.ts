import assert from "node:assert/strict"
import { test } from "node:test"

import { matchesAccount } from "./sales-search"

const bank = { name: "Dhaka Bank PLC", industry: "Banking", ownerName: "Rahim Uddin" }

test("finds an account by name, industry or owner, whatever the case", () => {
  assert.equal(matchesAccount(bank, "dhaka"), true)
  assert.equal(matchesAccount(bank, "BANKING"), true)
  assert.equal(matchesAccount(bank, "rahim"), true)
})

test("leaves out an account that matches nothing", () => {
  assert.equal(matchesAccount(bank, "garments"), false)
})

test("keeps every account when the search is blank", () => {
  assert.equal(matchesAccount(bank, "   "), true)
})

test("does not trip on an account with no industry", () => {
  assert.equal(matchesAccount({ ...bank, industry: null }, "banking"), false)
})
