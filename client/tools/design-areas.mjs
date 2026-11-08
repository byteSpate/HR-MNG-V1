// Prints the design debt per folder, so a migration wave knows what is left.
// Run: node tools/design-areas.mjs [prefix]   e.g. node tools/design-areas.mjs components/sales
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, isExempt } from "./design-ratchet.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const prefix = process.argv[2] ?? "";
const rows = {};
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) {
      const rel = relative(root, p).split(sep).join("/");
      if (isExempt(rel) || !rel.startsWith(prefix)) continue;
      const src = readFileSync(p, "utf8");
      for (const [rule, re] of Object.entries(RULES)) {
        const n = (src.match(new RegExp(re.source, "g")) ?? []).length;
        if (n) (rows[rel] ??= {})[rule] = n;
      }
    }
  }
}
for (const d of ["app", "components"]) walk(join(root, d));
for (const [f, r] of Object.entries(rows).sort()) console.log(f.padEnd(70), JSON.stringify(r));
console.log("files with debt:", Object.keys(rows).length);
