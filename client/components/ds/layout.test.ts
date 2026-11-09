import { test } from "node:test";
import assert from "node:assert/strict";
import { amountClass, formatMoney, toCards } from "./layout-helpers";

test("amountClass is right-aligned, tabular and never wraps", () => {
  const c = amountClass("neutral");
  assert.match(c, /\btext-right\b/);
  assert.match(c, /\btabular-nums\b/);
  assert.match(c, /\bwhitespace-nowrap\b/);
});

test("amountClass gives each tone a named color and no hex", () => {
  assert.match(amountClass("danger"), /\btext-danger\b/);
  assert.match(amountClass("success"), /\btext-success\b/);
  assert.match(amountClass("muted"), /\btext-ink-muted\b/);
  for (const t of ["neutral", "danger", "success", "muted"] as const) assert.doesNotMatch(amountClass(t), /\[#/);
});

test("formatMoney only formats: it never changes the number", () => {
  assert.equal(formatMoney("1234567.5", "total"), "12,34,567.50");
  assert.equal(formatMoney("0", "amount"), "—");
  assert.equal(formatMoney("0", "total"), "0.00");
  assert.equal(formatMoney("-256935", "signed"), "(2,56,935.00)");
});

test("toCards turns a row into labelled pairs, in column order", () => {
  const cols = [
    { key: "account", label: "Account" },
    { key: "debit", label: "Debit" },
    { key: "credit", label: "Credit" },
  ];
  assert.deepEqual(toCards(cols, { account: "Cash", debit: "10.00", credit: "" }), [
    { label: "Account", value: "Cash" },
    { label: "Debit", value: "10.00" },
  ]);
});
