import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    costCategory: { findMany: vi.fn() },
    operatingCost: { findMany: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { expectExampleImportsCleanly } from "../../utils/import/import.testkit"
import { signAccessToken } from "../auth/auth.utils"
import { buildCostExportSpec } from "./cost.export"
import { COST_IMPORT_COLUMNS, costImportSampleRows, previewCostImport } from "./cost.import"

const db = prisma as any
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })

const bill = {
  id: "b1", category: { code: "RENT" }, label: "Office rent", payee: "Dhanmondi Properties",
  periodMonth: 10, periodYear: 2026, amount: "150000.00", currency: "BDT",
  dueDate: new Date("2026-10-05T00:00:00.000Z"), paidAt: null, paymentRef: null, notes: null,
  status: "PENDING", commitment: null, createdAt: new Date("2026-10-01T00:00:00.000Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.costCategory.findMany.mockResolvedValue([
    { id: "k1", code: "RENT", name: "Rent" },
    { id: "k2", code: "ELECTRICITY", name: "Electricity" },
  ])
  db.operatingCost.findMany.mockResolvedValue([bill])
  db.operatingCost.findUnique.mockResolvedValue(null)
  db.auditLog.create.mockResolvedValue({})
})

describe("cost import example", () => {
  it("imports cleanly in both formats, and its headers are the column list", async () => {
    await expectExampleImportsCleanly({
      columns: COST_IMPORT_COLUMNS,
      sampleRows: costImportSampleRows(new Date()),
      preview: previewCostImport,
    })
  })

  it("describes every column, and keeps the headers the importer already read", () => {
    expect(COST_IMPORT_COLUMNS.map((c) => c.header)).toEqual([
      "categoryCode", "label", "payee", "periodMonth", "periodYear", "amount", "currency", "dueDate", "paidAt", "paymentRef", "notes",
    ])
    for (const column of COST_IMPORT_COLUMNS) {
      expect(column.type, column.header).toBeTruthy()
      expect(column.description, column.header).toBeTruthy()
    }
  })

  it("uses this month and year in the example, so the year check always passes", () => {
    const rows = costImportSampleRows(new Date("2027-03-09T00:00:00.000Z"))
    expect(rows[0]).toMatchObject({ periodMonth: "3", periodYear: "2027" })
  })
})

describe("buildCostExportSpec", () => {
  it("passes the month and category to the list and names them", async () => {
    const spec = await buildCostExportSpec({ year: 2026, month: 10, categoryId: "k1" })
    expect(db.operatingCost.findMany.mock.calls[0][0].where).toEqual({ periodYear: 2026, periodMonth: 10, categoryId: "k1" })
    expect(spec.filterNote).toBe("Month 10/2026, One category only")
  })

  it("exports the import columns first, then status and overdue", async () => {
    const spec = await buildCostExportSpec({})
    expect(spec.columns.map((c) => c.header)).toEqual([
      "categoryCode", "label", "payee", "periodMonth", "periodYear", "amount", "currency", "dueDate", "paidAt",
      "paymentRef", "notes", "status", "isOverdue",
    ])
    expect(spec.rows[0].slice(0, 12)).toEqual([
      "RENT", "Office rent", "Dhanmondi Properties", 10, 2026, 150000, "BDT",
      new Date("2026-10-05T00:00:00.000Z"), null, null, null, "PENDING",
    ])
    expect(typeof spec.rows[0][12]).toBe("boolean")
  })
})

describe("cost routes for the guide, the example and the export", () => {
  it("export serves Finance and Super Admin, refuses HR and employees", async () => {
    expect((await request(app).get("/api/costs/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "HR_ADMIN"]) {
      const res = await request(app).get("/api/costs/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    const ok = await request(app).get("/api/costs/export?format=csv&year=2026&month=10").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(ok.status).toBe(200)
    expect(ok.text).toContain("categoryCode,label,payee")
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entity: "DATA_EXPORT", entityId: "COSTS", after: { filter: { year: 2026, month: 10 } },
    })
  })

  it("is not swallowed by the /:id route", async () => {
    const res = await request(app).get("/api/costs/export?format=xlsx").set("Authorization", `Bearer ${token("SUPER_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(db.operatingCost.findUnique).not.toHaveBeenCalled()
  })

  it("serves the guide and the example to Finance only", async () => {
    const guide = await request(app).get("/api/costs/import/guide").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)
    expect(guide.status).toBe(200)
    expect(guide.body.columns).toHaveLength(11)
    expect((await request(app).get("/api/costs/import/template?format=csv").set("Authorization", `Bearer ${token("FINANCE_OFFICER")}`)).status).toBe(200)
    expect((await request(app).get("/api/costs/import/template").set("Authorization", `Bearer ${token("HR_ADMIN")}`)).status).toBe(403)
  })
})
