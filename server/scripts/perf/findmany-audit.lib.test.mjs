import { describe, expect, it } from "vitest"

import { auditFindMany } from "./findmany-audit.lib.mjs"

describe("auditFindMany", () => {
  it("finds a call and says it has no limit", () => {
    const found = auditFindMany(`const a = await prisma.employee.findMany({ where: { x: 1 } })`, "a.ts")
    expect(found).toEqual([{ file: "a.ts", line: 1, model: "employee", hasTake: false, hasCursor: false }])
  })

  it("sees a take and a cursor, also when the call spans lines", () => {
    const source = [
      "const a = await prisma.event.findMany({",
      "  where: { y: 2 },",
      "  take: 20,",
      "  cursor: { id },",
      "})",
    ].join("\n")
    const [found] = auditFindMany(source, "b.ts")
    expect(found).toMatchObject({ model: "event", line: 1, hasTake: true, hasCursor: true })
  })

  it("does not count a take that belongs to a different call", () => {
    const source = [
      "await prisma.a.findMany({ where: {} })",
      "await prisma.b.findMany({ where: {}, take: 5 })",
    ].join("\n")
    const found = auditFindMany(source, "c.ts")
    expect(found.map((f) => [f.model, f.hasTake])).toEqual([["a", false], ["b", true]])
  })

  it("finds a call on a transaction client too", () => {
    const [found] = auditFindMany(`await tx.shift.findMany()`, "d.ts")
    expect(found).toMatchObject({ model: "shift", hasTake: false })
  })
})
