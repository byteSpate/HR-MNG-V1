import { describe, expect, it } from "vitest"

import { toCsvFile } from "./export.csv"
import type { ExportSpec } from "./export.types"

const spec: ExportSpec = {
  title: "Suppliers",
  columns: [
    { header: "name", type: "text" },
    { header: "paymentDays", type: "integer" },
    { header: "rate", type: "decimal" },
    { header: "createdAt", type: "date" },
    { header: "isActive", type: "boolean" },
  ],
  rows: [
    ["Rahman, Md. \"Star\" Ltd", 30, 7.5, new Date("2026-10-04T00:00:00.000Z"), true],
    ["=SUM(A1)", null, null, null, false],
  ],
}

describe("toCsvFile", () => {
  const text = toCsvFile(spec).toString("utf8")

  it("starts with a byte order mark so Excel reads UTF-8", () => {
    expect(text.charCodeAt(0)).toBe(0xfeff)
  })

  it("writes the headers first, with CRLF line endings", () => {
    expect(text.slice(1).split("\r\n")[0]).toBe("name,paymentDays,rate,createdAt,isActive")
  })

  it("quotes commas and quotes, formats numbers, dates and yes/no", () => {
    const lines = text.slice(1).split("\r\n")
    expect(lines[1]).toBe('"Rahman, Md. ""Star"" Ltd",30,7.50,2026-10-04,Yes')
  })

  it("makes formula-looking text safe and writes null as empty", () => {
    const lines = text.slice(1).split("\r\n")
    expect(lines[2]).toBe("'=SUM(A1),,,,No")
  })

  it("writes only the header row for an empty list", () => {
    const empty = toCsvFile({ ...spec, rows: [] }).toString("utf8")
    expect(empty.slice(1)).toBe("name,paymentDays,rate,createdAt,isActive")
  })
})
