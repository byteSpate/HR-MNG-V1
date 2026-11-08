// Design ratchet: counts, per rule, how many places break it. Fails if any count goes UP
// compared with tools/design-debt.json. Run: node tools/design-ratchet.mjs [--update]
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const RULES = {
  fontSize: /text-\[\d+(?:\.\d+)?px\]/,
  hexColor: /(?:text|bg|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|decoration|shadow)-\[#[0-9a-fA-F]{3,8}\]/,
  arbitraryWidth: /(?<![\w-])(?:w|min-w|max-w)-\[\d+(?:\.\d+)?px\]/,
  rawHeading: /<h[1-3][\s>]/,
  dialogWidth: /<DialogContent[^>]*?className="[^"]*(?:sm:|md:)?max-w-/,
  rawImg: /<img[\s>]/,
};

const EXEMPT = ["components/ui/", "components/ds/", "lib/design/", "app/globals.css"];
export const isExempt = (rel) => EXEMPT.some((e) => rel.startsWith(e));

export function countFiles(files) {
  const out = Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
  for (const [rel, src] of Object.entries(files)) {
    if (isExempt(rel)) continue;
    for (const [rule, re] of Object.entries(RULES)) out[rule] += (src.match(new RegExp(re.source, "g")) ?? []).length;
  }
  return out;
}

export function compare(baseline, current) {
  const worse = [], better = [];
  for (const k of Object.keys(current)) {
    if (current[k] > (baseline[k] ?? 0)) worse.push(k);
    else if (current[k] < (baseline[k] ?? 0)) better.push(k);
  }
  return { ok: worse.length === 0, worse, better };
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

function readTree(root) {
  const files = {};
  for (const d of ["app", "components"]) for (const f of walk(join(root, d))) files[relative(root, f).split(sep).join("/")] = readFileSync(f, "utf8");
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), "..", "..");
  const baselinePath = join(root, "tools", "design-debt.json");
  const current = countFiles(readTree(root));
  if (process.argv.includes("--update")) {
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
    console.log("Baseline written:", JSON.stringify(current));
    process.exit(0);
  }
  if (!existsSync(baselinePath)) {
    console.error("No baseline. Run: node tools/design-ratchet.mjs --update");
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const r = compare(baseline, current);
  console.log("Places that break each design rule:", JSON.stringify(current));
  if (!r.ok) {
    console.error(`Design debt went UP for: ${r.worse.join(", ")}. Use the ds pieces (Heading, Text, Icon, Img, AppDialog) and the named sizes and colors in globals.css.`);
    process.exit(1);
  }
  if (r.better.length) console.log(`Debt went down for: ${r.better.join(", ")}. Run with --update to lower the baseline.`);
}
