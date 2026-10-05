import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { SALES_PERMISSIONS } from "./sales.permissions"

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return name.endsWith(".routes.ts") ? [path] : []
  })
}

const used = new Map<string, number>()
for (const file of routeFiles(__dirname)) {
  for (const match of readFileSync(file, "utf8").matchAll(/requireSalesPermission\("([a-z_.]+)"\)/g)) {
    used.set(match[1], (used.get(match[1]) ?? 0) + 1)
  }
}

describe("every Permission switch is enforced", () => {
  it("names only keys that are in the catalog", () => {
    const known = new Set<string>(SALES_PERMISSIONS.map((p) => p.key))
    expect([...used.keys()].filter((key) => !known.has(key))).toEqual([])
  })

  it("has a route for every Phase 1 switch, so none of them does nothing", () => {
    const unused = SALES_PERMISSIONS.filter((p) => p.phase === 1 && !used.has(p.key)).map((p) => p.key)
    expect(unused).toEqual([])
  })
})
