import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import test from "node:test"

/**
 * The Funnel, Opportunities and Tasks pages stay separate (owner, 2026-11-02).
 * The Saturday page may borrow components from the other two, but they must
 * never borrow from it, so each works alone and the Saturday page can be
 * changed or removed without breaking them.
 */

const ROOT = resolve(__dirname, "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Any import or re-export whose path names the funnel folder. */
const FUNNEL_IMPORT = /from\s+["'][^"']*\/funnel\/[^"']*["']|from\s+["']\.\/funnel[^"']*["']/

test("the Opportunities and Tasks components never import from the funnel folder", () => {
  for (const folder of ["components/sales/opportunities", "components/sales/tasks"]) {
    for (const file of sourceFiles(join(ROOT, folder))) {
      const source = readFileSync(file, "utf8")
      assert.equal(FUNNEL_IMPORT.test(source), false, `${file.replace(ROOT, "")} imports from the funnel folder`)
    }
  }
})

test("the shared components folder never imports from the funnel folder either", () => {
  for (const file of sourceFiles(join(ROOT, "components/sales/shared"))) {
    assert.equal(FUNNEL_IMPORT.test(readFileSync(file, "utf8")), false, `${file.replace(ROOT, "")} imports from the funnel folder`)
  }
})

test("the three pages each have their own entry file", () => {
  for (const entry of [
    "components/sales/opportunities/opportunities-page.tsx",
    "components/sales/tasks/tasks-page.tsx",
    "components/sales/funnel/funnel-page.tsx",
  ]) {
    assert.ok(existsSync(join(ROOT, entry)), `${entry} is missing`)
  }
})

test("the guard really sees an import of the funnel folder", () => {
  assert.equal(FUNNEL_IMPORT.test('import { X } from "@/components/sales/funnel/person-week"'), true)
  assert.equal(FUNNEL_IMPORT.test('import { X } from "../funnel/funnel-grid"'), true)
  assert.equal(FUNNEL_IMPORT.test('import { X } from "@/components/sales/opportunities/stage-bar"'), false)
})
