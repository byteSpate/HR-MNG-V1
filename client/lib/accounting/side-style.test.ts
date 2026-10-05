import assert from "node:assert/strict"
import test from "node:test"

import { bankBookHeadings, createSideStyle, toInOut } from "./side-style"

const bank = createSideStyle("bank")
const books = createSideStyle("books")

// ── a bank-style screen reads the sides the way the bank's own statement does ──

test("bank style: a line stored as debit is shown as credit, and the other way round", () => {
  assert.deepEqual(bank.pair({ debit: "100.00", credit: "0.00", note: "x" }), { debit: "0.00", credit: "100.00", note: "x" })
})

test("books style leaves a line as it is stored", () => {
  assert.deepEqual(books.pair({ debit: "100.00", credit: "0.00" }), { debit: "100.00", credit: "0.00" })
})

test("a journal has every line swapped and nothing else changed", () => {
  const journal = { id: "j1", lines: [{ debit: "5.00", credit: "0.00" }, { debit: "0.00", credit: "5.00" }] }
  assert.deepEqual(bank.journal(journal), { id: "j1", lines: [{ debit: "0.00", credit: "5.00" }, { debit: "5.00", credit: "0.00" }] })
})

test("a page of journals has every journal swapped", () => {
  const page = { total: 1, rows: [{ lines: [{ debit: "1.00", credit: "0.00" }] }] }
  assert.deepEqual(bank.journalPage(page), { total: 1, rows: [{ lines: [{ debit: "0.00", credit: "1.00" }] }] })
})

test("what a person types is saved on the opposite side, and an unused side stays unused", () => {
  assert.deepEqual(bank.lineInput({ accountId: "a", debit: "7.00" }), { accountId: "a", credit: "7.00" })
  assert.deepEqual(bank.lineInput({ accountId: "a", credit: "7.00" }), { accountId: "a", debit: "7.00" })
  assert.deepEqual(books.lineInput({ accountId: "a", debit: "7.00" }), { accountId: "a", debit: "7.00" })
})

test("swapping twice gives back what was stored", () => {
  const line = { debit: "9.00", credit: "0.00" }
  assert.deepEqual(bank.pair(bank.pair(line)), line)
})

test("a ledger swaps every row and both totals, and keeps the balances", () => {
  const ledger = {
    openingBalance: "10.00",
    closingBalance: "30.00",
    totalDebit: "25.00",
    totalCredit: "5.00",
    rows: [{ debit: "25.00", credit: "0.00", runningBalance: "35.00" }, { debit: "0.00", credit: "5.00", runningBalance: "30.00" }],
  }
  assert.deepEqual(bank.ledger(ledger), {
    openingBalance: "10.00",
    closingBalance: "30.00",
    totalDebit: "5.00",
    totalCredit: "25.00",
    rows: [{ debit: "0.00", credit: "25.00", runningBalance: "35.00" }, { debit: "5.00", credit: "0.00", runningBalance: "30.00" }],
  })
})

test("a customer statement swaps its entries and keeps empty cells empty", () => {
  const entry = { debit: "100.00", credit: null, balance: "100.00" }
  assert.deepEqual(bank.pair(entry), { debit: null, credit: "100.00", balance: "100.00" })
})

test("the totals of an unbalanced books message swap too", () => {
  assert.deepEqual(bank.totals({ debitTotal: "10.00", creditTotal: "4.00", difference: "6.00" }), {
    debitTotal: "4.00",
    creditTotal: "10.00",
    difference: "6.00",
  })
})

// ── the Trial Balance: Opening, In, Out, Closing ─────────────────────────────

const tbRow = {
  accountId: "a1", code: "1242", name: "City Bank", type: "ASSET" as const,
  openingDebit: "100000.00", openingCredit: "0.00",
  periodDebit: "50000.00", periodCredit: "20000.00",
  closingDebit: "130000.00", closingCredit: "0.00",
}

test("trial balance: In is what was debited, Out is what was credited, and balances are one signed number", () => {
  assert.deepEqual(toInOut(tbRow), {
    accountId: "a1", code: "1242", name: "City Bank", type: "ASSET",
    opening: "100000.00", in: "50000.00", out: "20000.00", closing: "130000.00",
  })
})

test("trial balance: an account that owes shows a negative balance", () => {
  const payables = {
    ...tbRow, type: "LIABILITY" as const, name: "Payables",
    openingDebit: "0.00", openingCredit: "40000.00",
    periodDebit: "10000.00", periodCredit: "30000.00",
    closingDebit: "0.00", closingCredit: "60000.00",
  }
  const view = toInOut(payables)
  assert.equal(view.opening, "-40000.00")
  assert.equal(view.closing, "-60000.00")
})

test("trial balance: a balance of nothing is not written as minus zero", () => {
  const view = toInOut({ ...tbRow, openingDebit: "0.00", openingCredit: "0.00", closingDebit: "0.00", closingCredit: "0.00" })
  assert.equal(view.opening, "0.00")
  assert.equal(view.closing, "0.00")
})

// ── the Bank Book uses the bank statement's own column names ─────────────────

test("bank style: the Bank Book columns read Withdrawal (Dr) then Deposit (Cr), like the statement", () => {
  assert.deepEqual(bankBookHeadings("bank"), { debit: "Withdrawal (Dr)", credit: "Deposit (Cr)" })
})

test("books style: the Bank Book columns read Debit then Credit", () => {
  assert.deepEqual(bankBookHeadings("books"), { debit: "Debit", credit: "Credit" })
})
