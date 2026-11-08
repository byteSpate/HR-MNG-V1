import { test } from "node:test";
import assert from "node:assert/strict";
import { countSource } from "./design-inventory.mjs";

test("counts hand-picked font sizes", () => {
  const c = countSource('<p className="text-[12.5px] text-[12.5px] text-[13px]">');
  assert.equal(c.fontSizes["12.5px"], 2);
  assert.equal(c.fontSizes["13px"], 1);
});

test("counts hex colors in classes, lower-cased", () => {
  const c = countSource('className="text-[#5F6B7C] bg-[#FFF] border-[#5f6b7c]"');
  assert.equal(c.hexColors["#5f6b7c"], 2);
  assert.equal(c.hexColors["#fff"], 1);
});

test("counts dialog widths and raw headings", () => {
  const c = countSource('<DialogContent className="max-w-[600px]"><h2>x</h2><img src="a" />');
  assert.equal(c.dialogWidths["max-w-[600px]"], 1);
  assert.equal(c.rawHeadings, 1);
  assert.equal(c.rawImg, 1);
});

test("counts icon size classes on remixicon usages", () => {
  const c = countSource('<RiAddLine className="size-4" /><RiEditLine className="size-3.5 mr-1" />');
  assert.equal(c.iconSizes["size-4"], 1);
  assert.equal(c.iconSizes["size-3.5"], 1);
});
