import { test } from "node:test";
import assert from "node:assert/strict";
import { headingClass, textClass, type HeadingLevel, type TextVariant } from "./classes";
import { TYPE_SCALE } from "@/lib/design/tokens";

const levels: HeadingLevel[] = ["page", "section", "card"];
const variants: TextVariant[] = ["body", "small", "caption", "muted", "danger", "notice"];

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

test("headings use the heading font", () => {
  for (const l of levels) assert.match(headingClass(l), /\bfont-heading\b/);
});
