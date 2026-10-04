import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    department: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import app from "../../app"
import prisma from "../../config/prisma"
import { expectExampleImportsCleanly } from "../../utils/import/import.testkit"
import { signAccessToken } from "../auth/auth.utils"
import {
  commitDepartmentImport,
  DEPARTMENT_IMPORT_COLUMNS,
  departmentImportSampleRows,
  previewDepartmentImport,
} from "./department.import"
import { buildDepartmentExportSpec } from "./department.export"

const db = prisma as any
const actor = { sub: "u1", role: "HR_ADMIN" } as never
const token = (role: string) =>
  signAccessToken({ sub: "u1", role: role as any, email: "e@byte.spate", mustChangePassword: false, salesRole: null })
const csv = (...lines: string[]) => Buffer.from(lines.join("\r\n"), "utf8")

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: any) => fn(prisma))
  db.department.findMany.mockResolvedValue([])
  db.department.create.mockImplementation(async ({ data }: any) => ({ id: `d-${data.name}`, ...data }))
  db.auditLog.create.mockResolvedValue({})
})

describe("department import example", () => {
  it("imports cleanly in both formats, and its headers are the column list", async () => {
    await expectExampleImportsCleanly({
      columns: DEPARTMENT_IMPORT_COLUMNS,
      sampleRows: departmentImportSampleRows(new Date()),
      preview: previewDepartmentImport,
    })
  })
})

describe("previewDepartmentImport", () => {
  it("reads headers in any letter case and with spaces around them", async () => {
    const result = await previewDepartmentImport(csv(" Name ,COSTNATURE", "Finance,direct"), "d.csv")
    expect(result.issues).toEqual([])
    expect(result.rows).toEqual([{ rowNumber: 2, name: "Finance", costNature: "DIRECT" }])
    expect(result.summary).toEqual({ departments: 1 })
  })

  it("uses ADMINISTRATIVE when the cost type is blank", async () => {
    const result = await previewDepartmentImport(csv("name,costNature", "Finance,"), "d.csv")
    expect(result.rows[0].costNature).toBe("ADMINISTRATIVE")
  })

  it("says what is wrong with a bad cost type, and with a missing name", async () => {
    const result = await previewDepartmentImport(csv("name,costNature", "Finance,SOMETIMES", ",DIRECT"), "d.csv")
    expect(result.issues).toEqual([
      { rowNumber: 2, column: "costNature", message: "Write DIRECT or ADMINISTRATIVE, or leave it blank." },
      { rowNumber: 3, column: "name", message: "name is required" },
    ])
  })

  it("marks a name that is already in the system, and stops there", async () => {
    db.department.findMany.mockResolvedValue([{ name: "Finance" }])
    const result = await previewDepartmentImport(csv("name", "Finance", "Legal"), "d.csv")
    expect(result.issues).toEqual([
      { rowNumber: 2, column: "name", message: '"Finance" is already in the system. Change it or remove the row.' },
    ])
  })

  it("marks the same name twice in one file on both rows", async () => {
    const result = await previewDepartmentImport(csv("name", "Legal", "Legal"), "d.csv")
    expect(result.issues.map((i) => i.rowNumber)).toEqual([2, 3])
    expect(result.issues[0].message).toContain("Duplicate name")
  })
})

describe("commitDepartmentImport", () => {
  it("creates every row and one audit row each, in one transaction", async () => {
    const result = await commitDepartmentImport(csv("name,costNature", "Finance,DIRECT", "Legal,"), "d.csv", actor)

    expect(result).toEqual({ created: 2 })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.department.create).toHaveBeenCalledTimes(2)
    expect(db.department.create).toHaveBeenCalledWith({ data: { name: "Finance", costNature: "DIRECT" } })
    expect(db.auditLog.create).toHaveBeenCalledTimes(2)
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entity: "DEPARTMENT", action: "IMPORT", changedBy: "u1", entityId: "d-Finance",
    })
  })

  it("writes nothing when any row has a problem", async () => {
    await expect(commitDepartmentImport(csv("name,costNature", "Finance,DIRECT", ",DIRECT"), "d.csv", actor)).rejects.toMatchObject({
      statusCode: 400,
      message: "1 row(s) have errors",
    })
    expect(db.department.create).not.toHaveBeenCalled()
  })
})

describe("buildDepartmentExportSpec", () => {
  it("lists every department with its cost type and head count", async () => {
    db.department.findMany.mockResolvedValue([{ name: "Finance", costNature: "DIRECT", _count: { employees: 4 } }])
    const spec = await buildDepartmentExportSpec()
    expect(spec.columns.map((c) => c.header)).toEqual(["name", "costNature", "employees"])
    expect(spec.rows).toEqual([["Finance", "DIRECT", 4]])
  })
})

describe("department import and export routes", () => {
  it("export refuses no token, an employee and Finance, and serves HR a CSV", async () => {
    db.department.findMany.mockResolvedValue([{ name: "Finance", costNature: "DIRECT", _count: { employees: 4 } }])

    expect((await request(app).get("/api/departments/export?format=csv")).status).toBe(401)
    for (const role of ["EMPLOYEE", "FINANCE_OFFICER"]) {
      const res = await request(app).get("/api/departments/export?format=csv").set("Authorization", `Bearer ${token(role)}`)
      expect(res.status).toBe(403)
    }

    const ok = await request(app).get("/api/departments/export?format=csv").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(ok.status).toBe(200)
    expect(ok.headers["content-type"]).toContain("text/csv")
    expect(ok.headers["content-disposition"]).toMatch(/^attachment; filename="departments-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(ok.text).toContain("name,costNature,employees")
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({ entity: "DATA_EXPORT", action: "EXPORT", entityId: "DEPARTMENTS" })
  })

  it("export refuses an unknown file type", async () => {
    const res = await request(app).get("/api/departments/export?format=docx").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("Choose a file type: xlsx, csv or pdf.")
  })

  it("serves the guide and the example file to HR only", async () => {
    const guide = await request(app).get("/api/departments/import/guide").set("Authorization", `Bearer ${token("SUPER_ADMIN")}`)
    expect(guide.status).toBe(200)
    expect(guide.body.columns.map((c: any) => c.header)).toEqual(["name", "costNature"])
    expect(guide.body.maxRows).toBe(2000)

    const example = await request(app).get("/api/departments/import/template").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(example.status).toBe(200)
    expect(example.headers["content-disposition"]).toContain("departments-example.xlsx")

    const denied = await request(app).get("/api/departments/import/template").set("Authorization", `Bearer ${token("EMPLOYEE")}`)
    expect(denied.status).toBe(403)
  })

  it("previews and commits an uploaded file", async () => {
    const file = { filename: "d.csv", contentType: "text/csv" }
    const preview = await request(app)
      .post("/api/departments/import/preview")
      .set("Authorization", `Bearer ${token("HR_ADMIN")}`)
      .attach("file", csv("name", "Legal"), file)
    expect(preview.status).toBe(200)
    expect(preview.body.rows).toHaveLength(1)
    expect(db.department.create).not.toHaveBeenCalled()

    const commit = await request(app)
      .post("/api/departments/import/commit")
      .set("Authorization", `Bearer ${token("HR_ADMIN")}`)
      .attach("file", csv("name", "Legal"), file)
    expect(commit.status).toBe(201)
    expect(commit.body).toEqual({ created: 1 })
  })

  it("asks for a file when none is sent, and refuses an employee", async () => {
    const none = await request(app).post("/api/departments/import/preview").set("Authorization", `Bearer ${token("HR_ADMIN")}`)
    expect(none.status).toBe(400)
    expect(none.body.error).toBe("Choose an Excel (.xlsx) or CSV file to import.")

    const denied = await request(app)
      .post("/api/departments/import/preview")
      .set("Authorization", `Bearer ${token("EMPLOYEE")}`)
      .attach("file", csv("name", "Legal"), { filename: "d.csv", contentType: "text/csv" })
    expect(denied.status).toBe(403)
  })

  it("keeps the open department list working", async () => {
    const res = await request(app).get("/api/departments").set("Authorization", `Bearer ${token("EMPLOYEE")}`)
    expect(res.status).toBe(200)
  })
})
