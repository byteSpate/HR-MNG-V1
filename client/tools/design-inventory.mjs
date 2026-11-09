// Design inventory: counts every hand-picked size and color in the client.
// Run: node tools/design-inventory.mjs [--json]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const bump = (o, k) => {
  o[k] = (o[k] ?? 0) + 1;
};

export function countSource(src) {
  const out = {
    fontSizes: {},
    hexColors: {},
    iconSizes: {},
    dialogWidths: {},
    rawHeadings: 0,
    rawImg: 0,
  };
  for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?px)\]/g)) bump(out.fontSizes, m[1]);
  for (const m of src.matchAll(/(?:text|bg|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|decoration|shadow)-\[(#[0-9a-fA-F]{3,8})\]/g))
    bump(out.hexColors, m[1].toLowerCase());
  for (const m of src.matchAll(/<Ri[A-Za-z0-9]+[^>]*?className="([^"]*)"/g)) {
    const s = m[1].split(/\s+/).find((c) => /^size-[\d.]+$/.test(c));
    if (s) bump(out.iconSizes, s);
  }
  for (const m of src.matchAll(/<DialogContent[^>]*?className="([^"]*)"/g)) {
    const w = m[1].split(/\s+/).find((c) => /^(?:sm:|md:)?max-w-/.test(c));
    if (w) bump(out.dialogWidths, w);
  }
  out.rawHeadings = (src.match(/<h[1-3][\s>]/g) ?? []).length;
  out.rawImg = (src.match(/<img[\s>]/g) ?? []).length;
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (p.endsWith(".tsx")) files.push(p);
  }
  return files;
}

export function scan(root) {
  const total = { fontSizes: {}, hexColors: {}, iconSizes: {}, dialogWidths: {}, rawHeadings: 0, rawImg: 0 };
  const perFile = {};
  for (const dir of ["app", "components"]) {
    for (const f of walk(join(root, dir))) {
      const c = countSource(readFileSync(f, "utf8"));
      const rel = relative(root, f);
      for (const k of ["fontSizes", "hexColors", "iconSizes", "dialogWidths"]) {
        for (const [v, n] of Object.entries(c[k])) {
          total[k][v] = (total[k][v] ?? 0) + n;
          ((perFile[k] ??= {})[v] ??= {})[rel] = n;
        }
      }
      total.rawHeadings += c.rawHeadings;
      total.rawImg += c.rawImg;
    }
  }
  return { total, perFile };
}

const top = (o, n = 99) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), "..", "..");
  const { total, perFile } = scan(root);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(total, null, 2));
  } else {
    for (const k of ["fontSizes", "hexColors", "iconSizes", "dialogWidths"]) {
      console.log(`\n== ${k}: ${Object.keys(total[k]).length} distinct`);
      for (const [v, n] of top(total[k], k === "hexColors" ? 200 : 40)) {
        const files = top(perFile[k][v], 3).map(([f, c]) => `${f}(${c})`).join(" ");
        console.log(`${String(n).padStart(5)}  ${v.padEnd(16)} ${files}`);
      }
    }
    console.log(`\nraw h1-h3: ${total.rawHeadings}   raw <img>: ${total.rawImg}`);
  }
}
