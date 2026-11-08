import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeFades, fadeMask } from "./scroll-edges";

test("a strip that fits has no fade", () => {
  assert.deepEqual(edgeFades(0, 300, 300), { start: false, end: false });
});

test("at the start, only the end fades", () => {
  assert.deepEqual(edgeFades(0, 300, 500), { start: false, end: true });
});

test("in the middle, both edges fade", () => {
  assert.deepEqual(edgeFades(80, 300, 500), { start: true, end: true });
});

test("at the end, only the start fades", () => {
  assert.deepEqual(edgeFades(200, 300, 500), { start: true, end: false });
});

test("a pixel of rounding does not show a fade", () => {
  assert.deepEqual(edgeFades(0.6, 300, 300.4), { start: false, end: false });
  assert.deepEqual(edgeFades(199.5, 300, 500), { start: true, end: false });
});

test("the mask fades only the sides that need it", () => {
  assert.equal(fadeMask({ start: false, end: false }), undefined);
  assert.match(fadeMask({ start: true, end: false })!, /transparent 0/);
  assert.doesNotMatch(fadeMask({ start: true, end: false })!, /transparent 100%/);
  assert.match(fadeMask({ start: false, end: true })!, /transparent 100%/);
});
