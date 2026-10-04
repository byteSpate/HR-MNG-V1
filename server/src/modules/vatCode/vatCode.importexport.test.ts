import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    vatCode: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { expectExampleImportsCleanly } from "../../utils/import/import.testkit"
import { signAccessToken } from "../auth/auth.utils"
import { buildVatCodeExportSpec } from "./vatCode.export"
import {
  commitVatCodeImport,
  previewVatCodeImport,
  VAT_CODE_IMPORT_COLUMNS,
  vatCodeImportSampleRows,
} from "./vatCode.import"

const db = prisma as any
const actor = { sub: "u1", role: "FINANCE_OFFICER" } as never
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })
const csv = (...lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8")
const HEADER = "code,name,ratePercent,isActive"

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  // The duplicate check asks `where: { code: { in } }`; the export list asks for all.
  db.vatCode.findMany.mockImplementation(async (args: any) =>
    args?.where?.code ? [] : [{ code: "VAT15", name: "Standard", ratePercent: "15", isActive: true }]
  )
  db.vatCode.create.mockImplementation(async ({ data }: any) => ({ id: `v-${data.code}`, ...data }))
  db.auditLog.create.mockResolvedValue({})
})

describe("VAT code import example", () => {
  it("imports cleanly in both formats, and its headers are the column list", async () => {
    await expectExampleImportsCleanly({
      columns: VAT_CODE_IMPORT_COLUMNS,
      sampleRows: vatCodeImportSampleRows(new Date()),
      preview: previewVatCodeImport,
    })
  })
})

describe("previewVatCodeImport", () => {
  it("reads codes, rates and the active flag", async () => {
    const result = await previewVatCodeImport(csv(HEADER, "VAT15,Standard VAT,15,Yes", "ZERO,Zero rated,0,No", "HALF,Half,7.5,"), "v.csv")
    expect(result.issues).toEqual([])
    expect(result.rows).toEqual([
      { rowNumber: 2, code: "VAT15", name: "Standard VAT", ratePercent: "15", isActive: true },
      { rowNumber: 3, code: "ZERO", name: "Zero rated", ratePercent: "0", isActive: false },
      { rowNumber: 4, code: "HALF", name: "Half", ratePercent: "7.5", isActive: true },
    ])
    expect(result.summary).toEqual({ vatCodes: 3 })
  })

  it("uses the same rules as the New VAT code form", async () => {
    const result = await previewVatCodeImport(csv(HEADER, "vat15,Standard,15,", "OK,Bad rate,150,", "OK2,Bad text,abc,"), "v.csv")
    // Zod can report one column twice (a failed pattern and a failed range check),
    // so compare the unique row and column pairs.
    const where = [...new Set(result.issues.map((i) => `${i.rowNumber}:${i.column}`))]
    expect(where).toEqual(["2:code", "3:ratePercent", "4:ratePercent"])
  })

  it("explains a bad yes/no", async () => {
    const result = await previewVatCodeImport(csv(HEADER, "OK,Name,10,maybe"), "v.csv")
    expect(result.issues).toEqual([{ rowNumber: 2, column: "isActive", message: "Write Yes or No." }])
  })

  it("marks a code that already exists, and a code twice in one file", async () => {
    db.vatCode.findMany.mockImplementation(async (args: any) => (args?.where?.code ? [{ code: "VAT15" }] : []))
    const existing = await previewVatCodeImport(csv(HEADER, "VAT15,Standard,15,"), "v.csv")
    expect(existing.issues).toEqual([
      { rowNumber: 2, column: "code", message: 'The code "VAT15" is already in the system. Change it or remove the row.' },
    ])

    const twice = await previewVatCodeImport(csv(HEADER, "NEW1,One,5,", "NEW1,Two,6,"), "v.csv")
    expect(twice.issues.map((i) => i.rowNumber)).toEqual([2, 3])
  })
})

describe("commitVatCodeImport", () => {
  it("creates each code with its audit row", async () => {
    const result = await commitVatCodeImport(csv(HEADER, "VAT15,Standard,15,Yes", "ZERO,Zero,0,No"), "v.csv", actor)
    expect(result).toEqual({ created: 2 })
    expect(db.vatCode.create).toHaveBeenCalledWith({ data: { code: "ZERO", name: "Zero", ratePercent: "0", isActive: false } })
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ entity: "VAT_CODE", action: "IMPORT", changedBy: "u1" })
  })
})

describe("buildVatCodeExportSpec", () => {
  it("exports every code, including turned-off ones, with the rate as a number", async () => {
    const spec = await buildVatCodeExportSpec()
    expect(db.vatCode.findMany.mock.calls[0][0].where).toBeUndefined()
    expect(spec.columns.map((c) => c.header)).toEqual(["code", "name", "ratePercent", "isActive"])
    expect(spec.rows).toEqual([["VAT15", "Standard", 15, true]])
  })
})

describe("VAT code import and export routes", () => {
  it("export serves Finance, refuses HR and employees", async () => {
    expect((await request(app).get("/api/vat-codes/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "HR_ADMIN"]) {
      const res = await request(app).get("/api/vat-codes/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    const ok = await request(app).get("/api/vat-codes/export?format=csv").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(ok.status).toBe(200)
    expect(ok.text).toContain("code,name,ratePercent,isActive")
  })

  it("serves the guide and example, then previews and commits", async () => {
    const auth = { Authorization: `Bearer ${token("SUPER_ADMIN")}` }
    expect((await request(app).get("/api/vat-codes/import/guide").set(auth)).body.columns).toHaveLength(4)
    expect((await request(app).get("/api/vat-codes/import/template").set(auth)).status).toBe(200)

    const file = { filename: "v.csv", contentType: "text/csv" }
    const preview = await request(app).post("/api/vat-codes/import/preview").set(auth).attach("file", csv(HEADER, "NEW1,One,5,Yes"), file)
    expect(preview.status).toBe(200)
    const commit = await request(app).post("/api/vat-codes/import/commit").set(auth).attach("file", csv(HEADER, "NEW1,One,5,Yes"), file)
    expect(commit.status).toBe(201)
  })

  it("keeps the open list working", async () => {
    const res = await request(app).get("/api/vat-codes").set("Authorization", `Bearer ${token("EMPLOYEE")}`)
    expect(res.status).toBe(200)
  })
})
