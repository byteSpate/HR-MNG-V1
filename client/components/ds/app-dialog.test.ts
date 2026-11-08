import { test } from "node:test";
import assert from "node:assert/strict";
import { DIALOG_SIZES, dialogWidthClass, DIALOG_BODY_CLASS } from "./dialog-sizes";

test("there is a class for each size and none is arbitrary", () => {
  for (const s of DIALOG_SIZES) {
    assert.ok(dialogWidthClass(s).length > 0);
    assert.doesNotMatch(dialogWidthClass(s), /max-w-\[/);
  }
});

test("sizes are strictly increasing", () => {
  const rem = { "sm:max-w-sm": 24, "sm:max-w-lg": 32, "sm:max-w-3xl": 48, "sm:max-w-5xl": 64 } as Record<string, number>;
  const widths = DIALOG_SIZES.map((s) => rem[dialogWidthClass(s)]);
  assert.ok(widths.every((w) => typeof w === "number"));
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] > widths[i - 1]);
});

test("the body takes the space left and scrolls, with no fixed height guess", () => {
  assert.match(DIALOG_BODY_CLASS, /\bmin-h-0\b/);
  assert.match(DIALOG_BODY_CLASS, /\bflex-1\b/);
  assert.match(DIALOG_BODY_CLASS, /overflow-y-auto/);
  assert.doesNotMatch(DIALOG_BODY_CLASS, /calc\(/);
});
