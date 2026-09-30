import assert from "node:assert/strict"
import test from "node:test"

import { NextRequest } from "next/server"

import { proxy } from "./proxy"

const visit = (url: string, cookie?: string) =>
  proxy(new NextRequest(url, cookie ? { headers: { cookie } } : undefined))

test("sends a signed-out visitor to sign in, remembering the page they asked for", () => {
  const res = visit("https://hr.example.com/employee/attendance")
  assert.equal(res.status, 307)
  assert.equal(res.headers.get("location"), "https://hr.example.com/login?next=%2Femployee%2Fattendance")
})

test("remembers the query as well, so a tab or filter is not lost", () => {
  const res = visit("https://hr.example.com/employee/leave?tab=history")
  assert.equal(res.headers.get("location"), "https://hr.example.com/login?next=%2Femployee%2Fleave%3Ftab%3Dhistory")
})

test("remembers a page in the Sales Hub too", () => {
  const res = visit("https://hr.example.com/sales/accounts/abc")
  assert.equal(res.headers.get("location"), "https://hr.example.com/login?next=%2Fsales%2Faccounts%2Fabc")
})

test("lets a visitor with a session cookie through, to be checked by the page", () => {
  const res = visit("https://hr.example.com/employee/attendance", "refreshToken=abc")
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("location"), null)
})

test("does not touch a public page", () => {
  const res = visit("https://hr.example.com/login")
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("location"), null)
})
