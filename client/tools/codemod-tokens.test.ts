import { test } from "node:test";
import assert from "node:assert/strict";
import { rewrite } from "./codemod-tokens.mjs";

test("a hand-picked size becomes a named size", () => {
  assert.equal(rewrite("text-[12.5px] font-bold").out, "text-caption font-bold");
  assert.equal(rewrite("sm:text-[23px]").out, "sm:text-heading");
});

test("a hex color keeps its prefix and becomes a named color", () => {
  assert.equal(rewrite("text-[#5F6B7C]").out, "text-ink-muted");
  assert.equal(rewrite("border-[#E4E9EF] bg-[#F7F9FB]").out, "border-line bg-surface-subtle");
  assert.equal(rewrite("bg-[#17191C]/50").out, "bg-ink/50");
});

test("a grey that failed contrast becomes ink-muted as text, but not as a border", () => {
  assert.equal(rewrite("text-[#7A8698]").out, "text-ink-muted");
  assert.notEqual(rewrite("border-[#7A8698]").out, "border-ink-muted");
});

test("an unknown hex or a big size is left alone and reported", () => {
  const r = rewrite("text-[#123456] text-[64px]");
  assert.equal(r.out, "text-[#123456] text-[64px]");
  assert.deepEqual(r.unknown.sort(), ["#123456", "64px"]);
});

test("it counts the changes", () => {
  assert.equal(rewrite("text-[12px] text-[13px] text-[#5F6B7C]").changes, 3);
});
