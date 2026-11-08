import { test } from "node:test";
import assert from "node:assert/strict";
import { headingClass, textClass, type HeadingLevel, type TextVariant } from "./classes";
import { TYPE_SCALE } from "@/lib/design/tokens";

const levels: HeadingLevel[] = ["hero", "label", "display", "page", "section", "card"];
const variants: TextVariant[] = ["body", "small", "caption", "muted", "danger", "notice"];

test("display heading is heading on a phone and display from sm up", () => {
  const c = headingClass("display");
  assert.match(c, /\btext-heading\b/);
  assert.match(c, /\bsm:text-display\b/);
});

test("label heading is a small muted uppercase caption", () => {
  const c = headingClass("label");
  assert.match(c, /\btext-caption\b/);
  assert.match(c, /\buppercase\b/);
  assert.match(c, /\btext-ink-muted\b/);
});

test("page heading is title on a phone and heading from md up", () => {
  const c = headingClass("page");
  assert.match(c, /\btext-title\b/);
  assert.match(c, /\bmd:text-heading\b/);
});

test("no class string has a hand-picked size", () => {
  for (const l of levels) assert.doesNotMatch(headingClass(l), /text-\[/);
  for (const v of variants) assert.doesNotMatch(textClass(v), /text-\[/);
});

test("every text variant uses a named size from TYPE_SCALE", () => {
  for (const v of variants) {
    const names = textClass(v).split(" ").map((c) => c.replace(/^md:/, "")).filter((c) => c.startsWith("text-"));
    const sizes = names.map((c) => c.slice(5)).filter((n) => n in TYPE_SCALE);
    assert.ok(sizes.length >= 1, `${v}: ${textClass(v)}`);
  }
});

test("hero heading sets no size, the page passes its own", () => {
  assert.doesNotMatch(headingClass("hero"), /\btext-(?!balance)/);
});

test("headings use the heading font, except the small label", () => {
  for (const l of levels.filter((x) => x !== "label")) assert.match(headingClass(l), /\bfont-heading\b/);
});
