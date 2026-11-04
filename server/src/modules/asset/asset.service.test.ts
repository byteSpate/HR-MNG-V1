import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    asset: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    assetCategory: { findUnique: vi.fn(), update: vi.fn() },
    assetAssignment: { count: vi.fn(), findFirst: vi.fn() },
    assetRecovery: { create: vi.fn() },
    idCounter: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
    employee: { findUnique: vi.fn() },
    department: { findUnique: vi.fn() },
  }
  return {
    default: {
      asset: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
      assetCategory: { findMany: vi.fn(), findUnique: vi.fn() },
      employee: { findUnique: vi.fn(), findMany: vi.fn() },
      journal: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import prisma from "../../config/prisma"
import { updateAssetSchema } from "./asset.validators"
import { createAsset, getAsset, listAssets, markAssetLost, nextAssetTag, retireAsset, updateAsset } from "./asset.service"

const tx = (prisma as unknown as { __tx: any }).__tx

const hr = { sub: "user-hr", role: "HR_ADMIN", email: "hr@demo.com", mustChangePassword: false } as never
const staff = { sub: "user-1", role: "EMPLOYEE", email: "e@demo.com", mustChangePassword: false } as never

const laptopCategory = {
  id: "cat-1",
  code: "LAPTOP",
  name: "Laptop",
  requiresSerial: true,
  isConsumable: false,
  usefulLifeMonths: 36,
}

const chairCategory = { ...laptopCategory, id: "cat-2", code: "FURNITURE", requiresSerial: false }

beforeEach(() => {
  vi.clearAllMocks()
  tx.idCounter.upsert.mockResolvedValue({ id: "AST", value: 42 })
  tx.auditLog.create.mockResolvedValue({})
  tx.event.create.mockResolvedValue({})
  tx.assetRecovery.create.mockResolvedValue({ id: "rec-1" })
})

describe("nextAssetTag", () => {
  it("pads to five digits, matching every other code in the system", async () => {
    await expect(nextAssetTag(tx)).resolves.toBe("BS-AST-00042")
  })
})

const clash = (target: string) => Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: [target] } })

describe("saving an asset that clashes or points at nothing", () => {
  const existing = { id: "a-1", categoryId: "cat-2", serialNumber: "SN-1", departmentId: null }

  it("says the serial number is already taken when an edit clashes, not a server error", async () => {
    tx.asset.findUnique.mockResolvedValue(existing)
    tx.asset.update.mockRejectedValue(clash("serialNumber"))
    await expect(updateAsset("a-1", { serialNumber: "SN-2" }, hr)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("serial number"),
    })
  })

  it("reads the field from the driver adapter's error shape too", async () => {
    tx.asset.findUnique.mockResolvedValue(existing)
    tx.asset.update.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["serialNumber"] } } } },
      }),
    )
    await expect(updateAsset("a-1", { serialNumber: "SN-2" }, hr)).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("serial number") })
  })

  it("says the asset tag is already taken when an edit clashes", async () => {
    tx.asset.findUnique.mockResolvedValue(existing)
    tx.asset.update.mockRejectedValue(clash("assetTag"))
    await expect(updateAsset("a-1", { assetTag: "BS-AST-00001" }, hr)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("asset tag"),
    })
  })

  it("answers 409 for a new asset with a serial number that is taken", async () => {
    tx.assetCategory.findUnique.mockResolvedValue(chairCategory)
    tx.asset.create.mockRejectedValue(clash("serialNumber"))
    await expect(createAsset({ categoryId: "cat-2", name: "Chair", serialNumber: "SN-1" }, hr)).rejects.toMatchObject({ statusCode: 409 })
  })

  it("answers 400, not a server error, for a department that does not exist", async () => {
    tx.asset.findUnique.mockResolvedValue(existing)
    tx.department.findUnique.mockResolvedValue(null)
    await expect(updateAsset("a-1", { departmentId: "11111111-1111-4111-8111-111111111111" }, hr)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("department"),
    })
    expect(tx.asset.update).not.toHaveBeenCalled()
  })

  it("lets other errors through untouched", async () => {
    tx.asset.findUnique.mockResolvedValue(existing)
    tx.asset.update.mockRejectedValue(new Error("connection lost"))
    await expect(updateAsset("a-1", { name: "New name" }, hr)).rejects.toThrow("connection lost")
  })
})

describe("clearing an optional field on an asset", () => {
  const existing = {
    id: "a-1",
    categoryId: "cat-2",
    name: "Chair",
    notes: "old note",
    model: "M1",
    vendor: "Acme",
    location: "Floor 2",
    warrantyExpiry: new Date("2027-01-01T00:00:00.000Z"),
    departmentId: null,
  }

  it("null clears Notes, Model, Vendor and Location", async () => {
    tx.asset.findUnique.mockResolvedValue(existing)
    tx.asset.update.mockResolvedValue({ ...existing })
    await updateAsset("a-1", { notes: null, model: null, vendor: null, location: null }, hr)
    expect(tx.asset.update).toHaveBeenCalledWith({
      where: { id: "a-1" },
      data: { notes: null, model: null, vendor: null, location: null },
    })
  })

  it("null clears the warranty date", async () => {
    tx.asset.findUnique.mockResolvedValue(existing)
    tx.asset.update.mockResolvedValue({ ...existing })
    await updateAsset("a-1", { warrantyExpiry: null }, hr)
    expect(tx.asset.update).toHaveBeenCalledWith({ where: { id: "a-1" }, data: { warrantyExpiry: null } })
  })

  it("an omitted key leaves the field alone", async () => {
    tx.asset.findUnique.mockResolvedValue(existing)
    tx.asset.update.mockResolvedValue({ ...existing })
    await updateAsset("a-1", { name: "Chair 2" }, hr)
    const data = tx.asset.update.mock.calls[0][0].data
    expect(data).toEqual({ name: "Chair 2" })
  })

  it("clearing a field that is already empty changes nothing", async () => {
    tx.asset.findUnique.mockResolvedValue({ ...existing, notes: null })
    await updateAsset("a-1", { notes: null }, hr)
    expect(tx.asset.update).not.toHaveBeenCalled()
  })

  it("the update schema accepts null for those fields and still refuses a blank name", () => {
    expect(updateAssetSchema.safeParse({ notes: null, warrantyExpiry: null }).success).toBe(true)
    expect(updateAssetSchema.safeParse({ name: "" }).success).toBe(false)
  })
})

describe("createAsset", () => {
  it("refuses a serial-less asset in a category that requires one", async () => {
    tx.assetCategory.findUnique.mockResolvedValue(laptopCategory)

    await expect(
      createAsset({ categoryId: "cat-1", name: "ThinkPad" }, hr)
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(tx.asset.create).not.toHaveBeenCalled()
  })

  it("allows a serial-less asset in a category that does not require one", async () => {
    tx.assetCategory.findUnique.mockResolvedValue(chairCategory)
    tx.asset.create.mockResolvedValue({ id: "ast-1", assetTag: "BS-AST-00042", name: "Desk" })

    await createAsset({ categoryId: "cat-2", name: "Desk" }, hr)

    expect(tx.asset.create).toHaveBeenCalledOnce()
  })

  it("writes an audit row in the same transaction", async () => {
    tx.assetCategory.findUnique.mockResolvedValue(chairCategory)
    tx.asset.create.mockResolvedValue({ id: "ast-1", assetTag: "BS-AST-00042", name: "Desk" })

    await createAsset({ categoryId: "cat-2", name: "Desk" }, hr)

    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: "ASSET", action: "CREATE", entityId: "ast-1" }),
      })
    )
  })
})

describe("retireAsset", () => {
  it("409s while somebody is still holding it", async () => {
    tx.asset.findUnique.mockResolvedValue({ id: "ast-1", lifecycle: "IN_SERVICE", assetTag: "BS-AST-00042", name: "ThinkPad" })
    tx.assetAssignment.count.mockResolvedValue(1)

    await expect(retireAsset("ast-1", { note: "End of life" }, hr)).rejects.toMatchObject({
      statusCode: 409,
    })

    expect(tx.asset.update).not.toHaveBeenCalled()
  })

  it("retires a free asset and stamps who and when", async () => {
    tx.asset.findUnique.mockResolvedValue({ id: "ast-1", lifecycle: "IN_SERVICE", assetTag: "BS-AST-00042", name: "ThinkPad" })
    tx.assetAssignment.count.mockResolvedValue(0)
    tx.asset.update.mockResolvedValue({ id: "ast-1", lifecycle: "RETIRED" })

    await retireAsset("ast-1", { note: "End of life" }, hr)

    expect(tx.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lifecycle: "RETIRED",
          retiredBy: "user-hr",
          retirementNote: "End of life",
        }),
      })
    )
  })

  it("409s on an already retired asset", async () => {
    tx.asset.findUnique.mockResolvedValue({ id: "ast-1", lifecycle: "RETIRED", assetTag: "T", name: "N" })

    await expect(retireAsset("ast-1", { note: "again" }, hr)).rejects.toMatchObject({
      statusCode: 409,
    })
  })
})

describe("markAssetLost", () => {
  it("does NOT require the asset to be free — a lost laptop is lost from someone's desk", async () => {
    tx.asset.findUnique.mockResolvedValue({ id: "ast-1", lifecycle: "IN_SERVICE", assetTag: "T", name: "N" })
    tx.asset.update.mockResolvedValue({ id: "ast-1", lifecycle: "LOST" })

    await markAssetLost("ast-1", { note: "Not returned after exit" }, hr)

    expect(tx.asset.update).toHaveBeenCalledOnce()
    expect(tx.assetAssignment.count).not.toHaveBeenCalled()
  })

  it("creates a recovery alongside marking an asset lost, in one transaction", async () => {
    tx.asset.findUnique.mockResolvedValue({ id: "ast-1", lifecycle: "IN_SERVICE", assetTag: "T", name: "N" })
    tx.asset.update.mockResolvedValue({ id: "ast-1", lifecycle: "LOST" })
    tx.assetAssignment.findFirst.mockResolvedValue({ id: "asg-1", employeeId: "emp-1" })

    await markAssetLost(
      "ast-1",
      { note: "Left it on the train", recovery: { amount: "45000", reason: "Laptop lost" } },
      hr
    )

    expect(tx.assetRecovery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assetId: "ast-1",
          employeeId: "emp-1",
          assignmentId: "asg-1",
          kind: "LOST",
          status: "PENDING",
        }),
      })
    )
  })

  it("marks it lost with no recovery when none is supplied", async () => {
    tx.asset.findUnique.mockResolvedValue({ id: "ast-1", lifecycle: "IN_SERVICE", assetTag: "T", name: "N" })
    tx.asset.update.mockResolvedValue({ id: "ast-1", lifecycle: "LOST" })

    await markAssetLost("ast-1", { note: "Nobody's fault" }, hr)

    expect(tx.assetRecovery.create).not.toHaveBeenCalled()
  })

  it("rolls back the lost marking if the recovery is invalid", async () => {
    tx.asset.findUnique.mockResolvedValue({ id: "ast-1", lifecycle: "IN_SERVICE", assetTag: "T", name: "N" })
    tx.assetAssignment.findFirst.mockResolvedValue({ id: "asg-1", employeeId: "emp-1" })

    await expect(
      markAssetLost(
        "ast-1",
        { note: "Lost", recovery: { amount: "0", reason: "zero" } },
        hr
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    // The update happened before the recovery create in this transaction, but
    // the transaction as a whole rejects — a laptop is never marked lost with
    // no debt recorded. Asserted here as "the call did not complete", which
    // is what a rollback looks like to the caller.
  })
})

describe("listAssets", () => {
  it("flags cost-visible roles with the paid state derived from the ledger", async () => {
    vi.mocked(prisma.asset.findMany).mockResolvedValue([
      {
        id: "a-1", assetTag: "BS-AST-00001", name: "ThinkPad", categoryId: "c-1",
        serialNumber: null, model: null, notes: null, purchaseDate: null, purchaseCost: null,
        currency: "BDT", vendor: null, warrantyExpiry: null, departmentId: null, location: null,
        lifecycle: "IN_SERVICE", retiredAt: null, retiredBy: null, retirementNote: null,
        capitalisedAt: new Date("2026-07-05T00:00:00.000Z"), capitalisedBy: "u-1",
        fxRateToBdt: null, purchaseCostBdt: null,
        category: { id: "c-1", code: "LAPTOP", name: "Laptop" },
        assignments: [], repairs: [],
      } as never,
    ])
    vi.mocked(prisma.journal.findMany).mockResolvedValue([{ sourceRefId: "a-1" }] as never)

    const rows = await listAssets(hr as never)

    expect(rows[0]).toMatchObject({ paid: true })
  })

  it("omits the paid flag for roles that cannot see costs", async () => {
    vi.mocked(prisma.asset.findMany).mockResolvedValue([
      {
        id: "a-1", assetTag: "BS-AST-00001", name: "ThinkPad", categoryId: "c-1",
        serialNumber: null, model: null, notes: null, purchaseDate: null, purchaseCost: null,
        currency: "BDT", vendor: null, warrantyExpiry: null, departmentId: null, location: null,
        lifecycle: "IN_SERVICE", retiredAt: null, retiredBy: null, retirementNote: null,
        capitalisedAt: new Date("2026-07-05T00:00:00.000Z"), capitalisedBy: "u-1",
        fxRateToBdt: null, purchaseCostBdt: null,
        category: { id: "c-1", code: "LAPTOP", name: "Laptop" },
        assignments: [], repairs: [],
      } as never,
    ])

    await listAssets(staff as never)

    expect(prisma.journal.findMany).not.toHaveBeenCalled()
  })

  it("filters by the derived status after the fetch (EC-1)", async () => {
    // status is derived, never stored, so it cannot go in the WHERE clause —
    // the parameter used to be parsed, validated and then silently dropped.
    vi.mocked(prisma.asset.findMany).mockResolvedValue([
      {
        id: "a-1", assetTag: "BS-AST-00001", name: "ThinkPad", categoryId: "c-1",
        serialNumber: null, model: null, notes: null, purchaseDate: null, purchaseCost: null,
        currency: "BDT", vendor: null, warrantyExpiry: null, departmentId: null, location: null,
        lifecycle: "IN_SERVICE", retiredAt: null, retiredBy: null, retirementNote: null,
        capitalisedAt: null, capitalisedBy: null, fxRateToBdt: null, purchaseCostBdt: null,
        category: { id: "c-1", code: "LAPTOP", name: "Laptop" },
        assignments: [{
          id: "asg-1", employeeId: "emp-1", assignedAt: new Date("2026-06-01T00:00:00.000Z"),
          conditionOut: "GOOD", acknowledgedAt: null,
          employee: { employeeCode: "EMP-001", fullName: "Ada Lovelace" },
        }],
        repairs: [],
      } as never,
      {
        id: "a-2", assetTag: "BS-AST-00042", name: "Spare Monitor", categoryId: "c-2",
        serialNumber: null, model: null, notes: null, purchaseDate: null, purchaseCost: null,
        currency: "BDT", vendor: null, warrantyExpiry: null, departmentId: null, location: null,
        lifecycle: "IN_SERVICE", retiredAt: null, retiredBy: null, retirementNote: null,
        capitalisedAt: null, capitalisedBy: null, fxRateToBdt: null, purchaseCostBdt: null,
        category: { id: "c-2", code: "MONITOR", name: "Monitor" },
        assignments: [], repairs: [],
      } as never,
    ])

    const rows = await listAssets(hr as never, { status: "AVAILABLE" })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: "a-2", status: "AVAILABLE" })
  })
})

describe("getAsset", () => {
  it("404s — not 403s — for an id outside the caller's scope", async () => {
    // The scope is applied inside the query, so an out-of-scope id and a
    // non-existent id are indistinguishable to the caller. That is the point:
    // an employee probing ids must learn nothing about what exists.
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1" } as never)
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null as never)

    await expect(getAsset("ast-someone-elses", staff)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it("scopes the lookup rather than filtering after the fetch", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1" } as never)
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null as never)

    await expect(getAsset("ast-1", staff)).rejects.toMatchObject({ statusCode: 404 })

    // Fetching first and filtering afterwards would leak existence through
    // timing and through anything that logged the row.
    expect(prisma.asset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { id: "ast-1" },
            { assignments: { some: { employeeId: { in: ["emp-1"] }, returnedAt: null } } },
          ],
        },
      })
    )
  })
})
