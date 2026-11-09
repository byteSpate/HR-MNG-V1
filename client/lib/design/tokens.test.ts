import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BIG_SCALE, PALETTE, TYPE_SCALE, TEXT_ON_SURFACE_PAIRS, contrast } from "./tokens";

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

test("no type size is under 12 px", () => {
  for (const [name, px] of Object.entries(TYPE_SCALE)) assert.ok(px >= 12, `${name} is ${px}px`);
});

test("there are at most 8 sizes", () => {
  assert.ok(Object.keys(TYPE_SCALE).length <= 8);
});

test("every name in PALETTE exists as a CSS variable in globals.css", () => {
  for (const [name, hex] of Object.entries(PALETTE)) {
    const re = new RegExp(`--color-${name}:\\s*${hex}`, "i");
    assert.match(css, re, `--color-${name}: ${hex} missing`);
  }
});

test("every type size exists as a CSS variable in globals.css", () => {
  for (const [name, px] of Object.entries(TYPE_SCALE)) {
    assert.match(css, new RegExp(`--text-${name}:\\s*${px}px`), `--text-${name} missing`);
  }
});

test("the big marketing sizes are 30px and up, and exist as CSS variables", () => {
  for (const [name, px] of Object.entries(BIG_SCALE)) {
    assert.ok(px >= 30, `${name} is ${px}px`);
    assert.match(css, new RegExp(`--text-${name}:\\s*${px}px`), `--text-${name} missing`);
  }
});

test("every text and background pair used together passes WCAG AA (4.5 to 1)", () => {
  for (const [fg, bg] of TEXT_ON_SURFACE_PAIRS) {
    const ratio = contrast(PALETTE[fg], PALETTE[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)} to 1`);
  }
});

test("contrast of black on white is 21 to 1", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
});
