import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { SALES_PERMISSIONS } from "./sales.permissions"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}

// A switch is enforced by a route (`requireSalesPermission("key")`) or by a
// service (`canDo(actor, "key")`). Either counts.
const used = new Map<string, number>()
for (const file of sourceFiles(__dirname)) {
  const text = readFileSync(file, "utf8")
  for (const match of text.matchAll(/requireSalesPermission\("([a-z_.]+)"\)/g)) {
    used.set(match[1], (used.get(match[1]) ?? 0) + 1)
  }
  for (const match of text.matchAll(/canDo\(\s*[A-Za-z.]+\s*,\s*"([a-z_.]+)"\s*\)/g)) {
    used.set(match[1], (used.get(match[1]) ?? 0) + 1)
  }
}

describe("every Permission switch is enforced", () => {
  it("names only keys that are in the catalog", () => {
    const known = new Set<string>(SALES_PERMISSIONS.map((p) => p.key))
    expect([...used.keys()].filter((key) => !known.has(key))).toEqual([])
  })

  it("enforces every savable switch somewhere, so none of them does nothing", () => {
    const unused = SALES_PERMISSIONS.filter((p) => p.phase === 1 && !used.has(p.key)).map((p) => p.key)
    expect(unused).toEqual([])
  })
})
