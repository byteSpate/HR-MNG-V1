import { test } from "node:test";
import assert from "node:assert/strict";
import { countFiles, compare, isExempt } from "./design-ratchet.mjs";

const files = {
  "components/a.tsx": '<p className="text-[12px] text-[#fff]">x</p><h2>t</h2>',
  "components/b.tsx": '<p className="text-[13px] text-[14px]">x</p><img src="a" />',
  "components/ds/c.tsx": '<p className="text-[13px] text-[#000]">x</p>',
  "components/d.tsx": '<DialogContent className="sm:max-w-[600px]"><div className="w-[320px]" /></DialogContent>',
};

test("counts every place that breaks each rule, ignoring exempt folders", () => {
  const c = countFiles(files);
  assert.equal(c.fontSize, 3);
  assert.equal(c.hexColor, 1);
  assert.equal(c.rawHeading, 1);
  assert.equal(c.rawImg, 1);
  assert.equal(c.dialogWidth, 1);
  assert.equal(c.arbitraryWidth, 2);
});

test("exempt folders are components/ui, components/ds, lib/design and globals.css", () => {
  assert.ok(isExempt("components/ui/button.tsx"));
  assert.ok(isExempt("components/ds/heading.tsx"));
  assert.ok(isExempt("lib/design/tokens.ts"));
  assert.ok(isExempt("app/globals.css"));
  assert.ok(!isExempt("components/sales/x.tsx"));
});

test("a higher count than the baseline fails", () => {
  const r = compare({ fontSize: 2, hexColor: 1 }, { fontSize: 3, hexColor: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.worse, ["fontSize"]);
});

test("equal or lower passes, and lower is reported as improved", () => {
  const r = compare({ fontSize: 2, hexColor: 2 }, { fontSize: 2, hexColor: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.better, ["hexColor"]);
});

test("a new violation in a file that already has one raises the count", () => {
  const before = countFiles({ "components/a.tsx": '<p className="text-[12px]">' });
  const after = countFiles({ "components/a.tsx": '<p className="text-[12px] text-[13px]">' });
  assert.ok(after.fontSize > before.fontSize);
});

test("big hand-picked sizes are counted too", () => {
  const c = countFiles({ "components/a.tsx": '<p className="text-[58px] text-[34px] text-[12.5px]">' });
  assert.equal(c.fontSize, 3);
});

test("hand-picked colors on a side or a variant are counted too", () => {
  const c = countFiles({ "components/a.tsx": '<p className="border-l-[#17191C] data-active:border-b-[#fff] accent-[#000]">' });
  assert.equal(c.hexColor, 3);
});
