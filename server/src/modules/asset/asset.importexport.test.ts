import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    assetCategory: { findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    department: { findMany: vi.fn() },
    asset: { findMany: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./asset.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./asset.service")>()),
  listAssets: vi.fn(),
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { expectExampleImportsCleanly } from "../../utils/import/import.testkit"
import { signAccessToken } from "../auth/auth.utils"
import { buildAssetExportSpec } from "./asset.export"
import { ASSET_IMPORT_COLUMNS, assetImportSampleRows, previewAssetImport } from "./asset.import"
import { listAssets } from "./asset.service"

const db = prisma as any
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })
const viewer = { sub: "u1", role: "HR_ADMIN" } as never

const row = {
  assetTag: "BS-AST-0001", name: "Dell Latitude", serialNumber: "SN1", model: "5440",
  category: { code: "LAPTOP", name: "Laptop" },
  purchaseDate: new Date("2026-01-15T00:00:00.000Z"), purchaseCost: "95000.00", currency: "BDT", vendor: "Star Tech",
  warrantyExpiry: new Date("2029-01-14T00:00:00.000Z"), location: "Head office", notes: null,
  lifecycle: "IN_SERVICE", status: "ASSIGNED",
  heldBy: { employeeCode: "E-001", fullName: "Rahim Uddin", assignedAt: new Date("2026-02-01T00:00:00.000Z") },
}
const spare = { ...row, assetTag: "BS-AST-0002", serialNumber: null, purchaseCost: undefined, vendor: undefined, status: "AVAILABLE", heldBy: null }

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.assetCategory.findMany.mockResolvedValue([
    { id: "c1", code: "LAPTOP", name: "Laptop", requiresSerial: true },
    { id: "c2", code: "CHAIR", name: "Chair", requiresSerial: false },
  ])
  db.employee.findMany.mockResolvedValue([])
  db.department.findMany.mockResolvedValue([{ id: "d1", name: "Finance" }])
  db.asset.findMany.mockResolvedValue([])
  db.auditLog.create.mockResolvedValue({})
  vi.mocked(listAssets).mockResolvedValue([row, spare] as never)
})

describe("asset import example", () => {
  it("imports cleanly in both formats, and its headers are the column list", async () => {
    await expectExampleImportsCleanly({
      columns: ASSET_IMPORT_COLUMNS,
      sampleRows: assetImportSampleRows(new Date()),
      preview: previewAssetImport,
    })
  })

  it("describes every column, and keeps the headers the importer already read", () => {
    expect(ASSET_IMPORT_COLUMNS.map((c) => c.header)).toEqual([
      "assetTag", "categoryCode", "name", "serialNumber", "model", "purchaseDate", "purchaseCost", "currency",
      "vendor", "warrantyExpiry", "departmentName", "location", "notes", "assignedToEmployeeCode", "assignedAt", "conditionOut",
    ])
    for (const column of ASSET_IMPORT_COLUMNS) {
      expect(column.type, column.header).toBeTruthy()
      expect(column.description, column.header).toBeTruthy()
    }
  })
})

describe("buildAssetExportSpec", () => {
  it("passes the page filters to the register query and names them", async () => {
    const spec = await buildAssetExportSpec(viewer, { status: "ASSIGNED", q: "dell" })
    expect(listAssets).toHaveBeenCalledWith(viewer, { status: "ASSIGNED", q: "dell" })
    expect(spec.filterNote).toBe('Status: ASSIGNED, Search: "dell"')
  })

  it("exports each asset with its holder, and blank cost cells for a role that cannot see costs", async () => {
    const spec = await buildAssetExportSpec(viewer, {})
    const headers = spec.columns.map((c) => c.header)
    expect(headers.slice(0, 12)).toEqual([
      "assetTag", "categoryCode", "name", "serialNumber", "model", "purchaseDate", "purchaseCost", "currency",
      "vendor", "warrantyExpiry", "location", "notes",
    ])
    expect(headers.slice(12)).toEqual(["status", "assignedToEmployeeCode", "assignedAt", "holder"])
    expect(spec.rows[0]).toEqual([
      "BS-AST-0001", "LAPTOP", "Dell Latitude", "SN1", "5440", new Date("2026-01-15T00:00:00.000Z"), 95000, "BDT",
      "Star Tech", new Date("2029-01-14T00:00:00.000Z"), "Head office", null, "ASSIGNED", "E-001",
      new Date("2026-02-01T00:00:00.000Z"), "Rahim Uddin",
    ])
    expect(spec.rows[1][6]).toBeNull()
    expect(spec.rows[1][8]).toBeNull()
    expect(spec.rows[1].slice(12)).toEqual(["AVAILABLE", null, null, null])
  })
})

describe("asset routes for the guide, the example and the export", () => {
  it("export serves HR and Super Admin, refuses Finance and employees", async () => {
    expect((await request(app).get("/api/assets/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "FINANCE_OFFICER"]) {
      const res = await request(app).get("/api/assets/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }
    const ok = await request(app).get("/api/assets/export?format=csv&status=ASSIGNED").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(ok.status).toBe(200)
    expect(ok.text).toContain("assetTag,categoryCode,name")
    expect(listAssets).toHaveBeenCalledWith(expect.objectContaining({ role: "HR_ADMIN" }), { status: "ASSIGNED" })
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entity: "DATA_EXPORT", entityId: "ASSETS", after: { rows: 2, filter: { status: "ASSIGNED" } },
    })
  })

  it("is not swallowed by the /:id route", async () => {
    const res = await request(app).get("/api/assets/export?format=xlsx").set("Authorization", `Bearer ${token("SUPER_ADMIN")}`)
    expect(res.status).toBe(200)
    expect(db.asset.findUnique).not.toHaveBeenCalled()
  })

  it("serves the guide and example to HR only", async () => {
    const guide = await request(app).get("/api/assets/import/guide").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(guide.status).toBe(200)
    expect(guide.body.columns).toHaveLength(16)
    expect((await request(app).get("/api/assets/import/template?format=csv").set("Authorization", `Bearer ${token("HR_ADMIN")}`)).status).toBe(200)
    expect((await request(app).get("/api/assets/import/template").set("Authorization", `Bearer ${token("EMPLOYEE")}`)).status).toBe(403)
  })
})
