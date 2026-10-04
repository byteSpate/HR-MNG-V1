import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplier: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { expectExampleImportsCleanly } from "../../utils/import/import.testkit"
import { signAccessToken } from "../auth/auth.utils"
import { buildSupplierExportSpec } from "./supplier.export"
import {
  commitSupplierImport,
  previewSupplierImport,
  SUPPLIER_IMPORT_COLUMNS,
  supplierImportSampleRows,
} from "./supplier.import"

const db = prisma as any
const actor = { sub: "u1", role: "FINANCE_OFFICER" } as never
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })
const csv = (...lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8")
const HEADER = "name,contactName,contactPhone,contactEmail,bin,paymentDays,isActive"

const listRow = {
  id: "s1", name: "Star Tech", contactName: "Rahim", contactPhone: "+8801711000000", contactEmail: "a@b.co",
  bin: "123", paymentDays: 30, isActive: true, createdAt: new Date("2026-10-01T00:00:00.000Z"), detailsMissing: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  // The duplicate check asks by nameKey; the list asks for everything.
  db.supplier.findMany.mockImplementation(async (args: any) => (args?.where?.nameKey ? [] : [listRow]))
  db.supplier.create.mockImplementation(async ({ data }: any) => ({ id: `s-${data.nameKey}`, ...data }))
  db.auditLog.create.mockResolvedValue({})
})

describe("supplier import example", () => {
  it("imports cleanly in both formats, and its headers are the column list", async () => {
    await expectExampleImportsCleanly({
      columns: SUPPLIER_IMPORT_COLUMNS,
      sampleRows: supplierImportSampleRows(new Date()),
      preview: previewSupplierImport,
    })
  })
})

describe("previewSupplierImport", () => {
  it("reads a full row and applies the defaults to a short one", async () => {
    const result = await previewSupplierImport(
      csv(HEADER, "Star Tech Ltd,Rahim,+8801711000000,a@b.co,123456789,45,No", "Smart Tech,,,,,,"),
      "s.csv"
    )
    expect(result.issues).toEqual([])
    expect(result.rows[0]).toMatchObject({
      name: "Star Tech Ltd", contactPhone: "+8801711000000", bin: "123456789", paymentDays: 45, isActive: false,
    })
    expect(result.rows[1]).toMatchObject({ name: "Smart Tech", isActive: true })
    expect(result.rows[1].paymentDays).toBeUndefined()
    expect(result.summary).toEqual({ suppliers: 2 })
  })

  it("explains a bad number, a bad yes/no and a bad email", async () => {
    const result = await previewSupplierImport(csv(HEADER, "A,,,not-an-email,,abc,maybe"), "s.csv")
    const byColumn = Object.fromEntries(result.issues.map((i) => [i.column, i.message]))
    expect(byColumn.paymentDays).toBe("Use a whole number like 30.")
    expect(byColumn.isActive).toBe("Write Yes or No.")
    expect(byColumn.contactEmail).toBeTruthy()
  })

  it("refuses a name with no letter or number in it", async () => {
    const result = await previewSupplierImport(csv("name", "!!!"), "s.csv")
    expect(result.issues[0]).toMatchObject({ column: "name", message: "Use at least one letter or number in the name." })
  })

  it("marks a supplier that already exists, even when spelt a little differently", async () => {
    db.supplier.findMany.mockImplementation(async (args: any) =>
      args?.where?.nameKey ? [{ name: "Star Tech", nameKey: "startech" }] : []
    )
    const result = await previewSupplierImport(csv("name", "STAR-TECH"), "s.csv")
    expect(result.issues).toEqual([
      { rowNumber: 2, column: "name", message: '"STAR-TECH" is already in the system as "Star Tech". Change it or remove the row.' },
    ])
  })

  it("marks two names in one file that count as the same supplier", async () => {
    const result = await previewSupplierImport(csv("name", "Star Tech", "star-tech"), "s.csv")
    expect(result.issues.map((i) => i.rowNumber)).toEqual([2, 3])
    expect(result.issues[0].message).toContain("looks the same as another name in this file (rows 2, 3)")
  })
})

describe("commitSupplierImport", () => {
  it("creates each supplier with its name key and one audit row", async () => {
    const result = await commitSupplierImport(csv(HEADER, "Star Tech Ltd,Rahim,,,123,45,No"), "s.csv", actor)

    expect(result).toEqual({ created: 1 })
    expect(db.supplier.create).toHaveBeenCalledWith({
      data: {
        name: "Star Tech Ltd", nameKey: "startechltd", contactName: "Rahim", contactPhone: null,
        contactEmail: null, bin: "123", paymentDays: 45, isActive: false,
      },
    })
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ entity: "SUPPLIER", action: "IMPORT", changedBy: "u1" })
  })

  it("uses 30 payment days when the column is blank", async () => {
    await commitSupplierImport(csv("name", "Smart Tech"), "s.csv", actor)
    expect(db.supplier.create.mock.calls[0][0].data.paymentDays).toBe(30)
  })
})

describe("buildSupplierExportSpec", () => {
  it("exports every supplier with the import column names first", async () => {
    const spec = await buildSupplierExportSpec()
    expect(spec.columns.map((c) => c.header)).toEqual([
      "name", "contactName", "contactPhone", "contactEmail", "bin", "paymentDays", "isActive", "createdAt",
    ])
    expect(spec.rows[0]).toEqual([
      "Star Tech", "Rahim", "+8801711000000", "a@b.co", "123", 30, true, new Date("2026-10-01T00:00:00.000Z"),
    ])
  })
})

describe("supplier import and export routes", () => {
  it("export serves Finance and Super Admin, and refuses HR, employees and no token", async () => {
    expect((await request(app).get("/api/suppliers/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "HR_ADMIN"]) {
      const res = await request(app).get("/api/suppliers/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    for (const role of ["FINANCE_OFFICER", "SUPER_ADMIN"]) {
      const res = await request(app).get("/api/suppliers/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(200)
      expect(res.text).toContain("name,contactName,contactPhone")
    }
  })

  it("is not swallowed by the /:id route", async () => {
    const res = await request(app).get("/api/suppliers/export?format=xlsx").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toContain("spreadsheetml")
  })

  it("serves the example, previews and commits for Finance", async () => {
    const auth = { Authorization: `Bearer ${token("FINANCE_OFFICER")}` }
    expect((await request(app).get("/api/suppliers/import/template?format=csv").set(auth)).status).toBe(200)
    expect((await request(app).get("/api/suppliers/import/guide").set(auth)).body.columns).toHaveLength(7)

    const file = { filename: "s.csv", contentType: "text/csv" }
    const preview = await request(app).post("/api/suppliers/import/preview").set(auth).attach("file", csv("name", "Smart Tech"), file)
    expect(preview.status).toBe(200)
    const commit = await request(app).post("/api/suppliers/import/commit").set(auth).attach("file", csv("name", "Smart Tech"), file)
    expect(commit.status).toBe(201)
    expect(commit.body).toEqual({ created: 1 })
  })

  it("refuses HR for import", async () => {
    const res = await request(app).get("/api/suppliers/import/guide").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(403)
  })
})
