// Rewrites hand-picked sizes and hex colors in class names to the named tokens.
// Run: node tools/codemod-tokens.mjs <dir> [--write]
// Without --write it only prints the number of changes per file.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(join(here, "design-scale.proposal.json"), "utf8"));
const COLOR_PREFIX = "text|bg|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|decoration|shadow";

export function rewrite(src, map = MAP) {
  let changes = 0;
  const unknown = [];
  let out = src.replace(/\btext-\[(\d+(?:\.\d+)?px)\]/g, (m, size) => {
    const name = map.fontSizes[size];
    if (!name) {
      unknown.push(size);
      return m;
    }
    changes++;
    return `text-${name}`;
  });
  out = out.replace(new RegExp(`\\b(${COLOR_PREFIX})-\\[(#[0-9a-fA-F]{3,8})\\]`, "g"), (m, prefix, hex) => {
    const h = hex.toLowerCase();
    const name = prefix === "text" ? map.textOverrides?.[h] ?? map.colors[h] : map.nonTextOverrides?.[h] ?? map.colors[h];
    if (!name) {
      unknown.push(hex);
      return m;
    }
    changes++;
    return `${prefix}-${name}`;
  });
  return { out, changes, unknown };
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node tools/codemod-tokens.mjs <dir> [--write]");
    process.exit(1);
  }
  const write = process.argv.includes("--write");
  const root = join(here, "..");
  let total = 0;
  const left = new Set();
  for (const f of walk(join(root, target))) {
    const rel = relative(root, f);
    if (/^(components\/(ui|ds)\/|lib\/design\/)/.test(rel)) continue;
    const r = rewrite(readFileSync(f, "utf8"));
    r.unknown.forEach((u) => left.add(u));
    if (r.changes) {
      total += r.changes;
      console.log(`${String(r.changes).padStart(4)}  ${rel}`);
      if (write) writeFileSync(f, r.out);
    }
  }
  console.log(`${write ? "Changed" : "Would change"} ${total} classes.${left.size ? ` Left alone: ${[...left].join(" ")}` : ""}`);
}
