import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON_SIZE, iconClass } from "./icon-sizes";

test("ICON_SIZE has five sizes and none is under 14", () => {
  const sizes = Object.values(ICON_SIZE);
  assert.equal(sizes.length, 5);
  for (const s of sizes) assert.ok(s >= 14);
});

test("sizes go up from xs to xl", () => {
  const s = Object.values(ICON_SIZE);
  assert.deepEqual(s, [...s].sort((a, b) => a - b));
});

test("iconClass never returns an arbitrary [..] class", () => {
  for (const k of Object.keys(ICON_SIZE) as Array<keyof typeof ICON_SIZE>) {
    assert.doesNotMatch(iconClass(k), /\[/);
    assert.match(iconClass(k), /\bshrink-0\b/);
  }
});
