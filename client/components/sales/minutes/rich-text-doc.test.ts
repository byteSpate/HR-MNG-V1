import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { bulletsToRich, EMPTY_RICH, paragraphsToRich, topicsToRich } from "./rich-text-doc"

// These run from the client folder (npx tsx --test <file>).
const read = (name: string) => readFileSync(path.join(process.cwd(), "components/sales/minutes", name), "utf8")

test("the plain helpers do not load Tiptap", () => {
  assert.ok(!read("rich-text-doc.ts").includes("@tiptap"))
})

test("the minutes page loads the editor only when it is shown", () => {
  const page = read("minutes-editor.tsx")
  // A static import of the editor file would put Tiptap (about 470 KB) in the first script load.
  assert.ok(
    !/^import[^;]*from\s+["']@\/components\/sales\/minutes\/rich-text-editor["']/m.test(page),
    "minutes-editor.tsx must not import rich-text-editor statically"
  )
  assert.ok(page.includes("dynamic("), "minutes-editor.tsx must load the editor with dynamic()")
})

test("an older paragraph keeps its **bold** words as bold marks", () => {
  const result = paragraphsToRich(["a **b** c"])
  const runs = (result.content?.[0] as { content: { text: string; marks?: unknown[] }[] }).content
  assert.deepEqual(
    runs.map((r) => [r.text, Boolean(r.marks)]),
    [["a ", false], ["b", true], [" c", false]]
  )
})

test("no bullets gives the empty document, as a copy", () => {
  const result = bulletsToRich([])
  assert.deepEqual(result, EMPTY_RICH)
  assert.notEqual(result, EMPTY_RICH)
})

test("a sub-topic keeps its number as text", () => {
  const result = topicsToRich([{ title: "Network", text: "", bullets: [] }] as never, 2)
  const heading = result.content?.[0] as { type: string; content: { text: string }[] }
  assert.equal(heading.type, "heading")
  assert.equal(heading.content.map((c) => c.text).join(""), "2.1 Network")
})
