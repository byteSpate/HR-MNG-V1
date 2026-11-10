import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    account: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    journalLine: { count: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return {
    default: {
      account: { findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import prisma from "../../config/prisma"
import {
  createAccount,
  deleteAccount,
  listAccounts,
  requirePostableAccounts,
  updateAccount,
} from "./accounting.coa.service"

const tx = (prisma as unknown as { __tx: any }).__tx

const finance = {
  sub: "user-finance",
  role: "FINANCE_OFFICER",
  email: "finance@demo.com",
  mustChangePassword: false,
} as never

beforeEach(() => {
  vi.clearAllMocks()
  tx.auditLog.create.mockResolvedValue({})
  tx.account.findFirst.mockResolvedValue(null)
  tx.journalLine.count.mockResolvedValue(0)
  tx.account.count.mockResolvedValue(0)
})

describe("createAccount", () => {
  it("creates a leaf under a group parent", async () => {
    tx.account.findUnique.mockResolvedValue({ id: "grp-1", isGroup: true, type: "EXPENSE" })
    tx.account.create.mockResolvedValue({ id: "acc-1", code: "5201" })

    await createAccount(
      { code: "5201", name: "Salary and Allowances", type: "EXPENSE", parentId: "grp-1", isGroup: false, cashKind: "NONE" },
      finance
    )

    expect(tx.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: "5201", parentId: "grp-1" }) })
    )
  })

  it("400s when the code's first digit contradicts the type", async () => {
    await expect(
      createAccount(
        { code: "1300", name: "Rent", type: "EXPENSE", isGroup: false, cashKind: "NONE" },
        finance
      )
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(tx.account.create).not.toHaveBeenCalled()
  })

  it("409s on a duplicate code, naming the account already using it", async () => {
    tx.account.findFirst.mockResolvedValue({ id: "acc-x", code: "5201", name: "Salary" })

    await expect(
      createAccount(
        { code: "5201", name: "Wages", type: "EXPENSE", parentId: "grp-1", isGroup: false, cashKind: "NONE" },
        finance
      )
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("Salary") })
  })

  it("400s when the parent is a leaf — a posted leaf cannot silently become a header", async () => {
    tx.account.findUnique.mockResolvedValue({ id: "acc-p", isGroup: false, type: "EXPENSE" })

    await expect(
      createAccount(
        { code: "5202", name: "Bonus", type: "EXPENSE", parentId: "acc-p", isGroup: false, cashKind: "NONE" },
        finance
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("400s when the parent's type differs — a child cannot cross statements", async () => {
    tx.account.findUnique.mockResolvedValue({ id: "grp-1", isGroup: true, type: "ASSET" })

    await expect(
      createAccount(
        { code: "5201", name: "Salary", type: "EXPENSE", parentId: "grp-1", isGroup: false, cashKind: "NONE" },
        finance
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("writes an ACCOUNT CREATE audit row inside the transaction", async () => {
    tx.account.create.mockResolvedValue({ id: "acc-1", code: "5201" })
    tx.account.findUnique.mockResolvedValue({ id: "grp-1", isGroup: true, type: "EXPENSE" })

    await createAccount(
      { code: "5201", name: "Salary", type: "EXPENSE", parentId: "grp-1", isGroup: false, cashKind: "NONE" },
      finance
    )

    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: "ACCOUNT", action: "CREATE", changedBy: "user-finance" }),
      })
    )
  })
})

describe("an account you post to must sit under a group", () => {
  // 5210 Water Bill was saved at "Top level". Its ৳500 then belonged to no
  // statement line, and every statement refused to show (2026-11-10).
  const topLevelLeaf = {
    id: "acc-5210", code: "5210", name: "Water Bill", type: "EXPENSE",
    parentId: null, isGroup: false, cashKind: "NONE", isActive: true, description: null,
  }
  const sitsUnder = /must sit under a group/

  it("refuses to create one at top level", async () => {
    await expect(
      createAccount({ code: "5210", name: "Water Bill", type: "EXPENSE", isGroup: false, cashKind: "NONE" }, finance)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(sitsUnder) })
    expect(tx.account.create).not.toHaveBeenCalled()
  })

  it("still lets a group be created at top level", async () => {
    tx.account.create.mockResolvedValue({ id: "grp-9", code: "5000" })

    await expect(
      createAccount({ code: "5000", name: "Expenses", type: "EXPENSE", isGroup: true, cashKind: "NONE" }, finance)
    ).resolves.toBeDefined()
  })

  it("refuses to move one to top level", async () => {
    tx.account.findUnique.mockResolvedValue({ ...topLevelLeaf, parentId: "grp-5200" })

    await expect(updateAccount("acc-5210", { parentId: null }, finance)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(sitsUnder),
    })
    expect(tx.account.update).not.toHaveBeenCalled()
  })

  it("refuses to turn a top-level group into one", async () => {
    tx.account.findUnique.mockResolvedValue({ ...topLevelLeaf, isGroup: true })

    await expect(updateAccount("acc-5210", { isGroup: false }, finance)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(sitsUnder),
    })
  })

  it("refuses other changes to one already at top level until a group is chosen", async () => {
    tx.account.findUnique.mockResolvedValue(topLevelLeaf)

    await expect(updateAccount("acc-5210", { name: "Water" }, finance)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(sitsUnder),
    })
  })

  it("lets one at top level be moved under a group, which is the fix", async () => {
    tx.account.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === "grp-5200"
          ? { id: "grp-5200", isGroup: true, type: "EXPENSE", parentId: null }
          : topLevelLeaf
      )
    )
    tx.account.update.mockResolvedValue({ ...topLevelLeaf, parentId: "grp-5200" })

    await expect(updateAccount("acc-5210", { parentId: "grp-5200" }, finance)).resolves.toBeDefined()
    expect(tx.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: "grp-5200" }) })
    )
  })
})

describe("updateAccount", () => {
  it("records only the changed fields in the audit before/after", async () => {
    tx.account.findUnique.mockResolvedValue({
      id: "acc-1",
      code: "5201",
      name: "Salary",
      type: "EXPENSE",
      parentId: "grp-1",
      isGroup: false,
      cashKind: "NONE",
      isActive: true,
      description: null,
    })
    tx.account.update.mockResolvedValue({ id: "acc-1", name: "Salary and Allowances" })

    await updateAccount("acc-1", { name: "Salary and Allowances" }, finance)

    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "ACCOUNT",
          action: "UPDATE",
          before: { name: "Salary" },
          after: { name: "Salary and Allowances" },
        }),
      })
    )
  })

  it("404s an unknown account", async () => {
    tx.account.findUnique.mockResolvedValue(null)

    await expect(updateAccount("nope", { name: "X" }, finance)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  /**
   * The chart as a lookup, so the cycle walk can climb it. `grp-a` is a root
   * and `grp-b` sits under it — the ordinary shape before anyone breaks it.
   */
  const chart = (overrides: Record<string, string | null> = {}) => {
    const parents: Record<string, string | null> = { "grp-a": null, "grp-b": "grp-a", ...overrides }
    tx.account.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      code: where.id === "grp-a" ? "1000" : "1100",
      name: where.id,
      type: "ASSET",
      isGroup: true,
      cashKind: "NONE",
      isActive: true,
      description: null,
      parentId: parents[where.id] ?? null,
    }))
  }

  it("400s on re-parenting an account under its own child", async () => {
    chart()
    // grp-b is already under grp-a. Putting grp-a under grp-b closes the loop,
    // and both would drop out of the tree with no error anywhere.
    await expect(updateAccount("grp-a", { parentId: "grp-b" }, finance)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("its own branch"),
    })

    expect(tx.account.update).not.toHaveBeenCalled()
  })

  it("400s on re-parenting under a deeper descendant, not just a direct child", async () => {
    chart({ "grp-c": "grp-b" })

    await expect(updateAccount("grp-a", { parentId: "grp-c" }, finance)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it("allows a re-parent that stays out of its own branch", async () => {
    chart({ "leaf-1": null })
    tx.account.update.mockResolvedValue({ id: "leaf-1", parentId: "grp-b" })

    await expect(updateAccount("leaf-1", { parentId: "grp-b" }, finance)).resolves.toBeDefined()
  })

  it("terminates on a chart that already contains a cycle rather than looping forever", async () => {
    // grp-a under grp-b and grp-b under grp-a: the damage a pre-fix database
    // may already carry. The walk must refuse, not spin.
    chart({ "grp-a": "grp-b", "leaf-1": null })

    await expect(updateAccount("leaf-1", { parentId: "grp-b" }, finance)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it("converts a leaf to a group when nothing has been posted to it", async () => {
    tx.account.findUnique.mockResolvedValue({
      id: "acc-1", code: "5200", name: "Admin", type: "EXPENSE",
      parentId: null, isGroup: false, cashKind: "NONE", isActive: true, description: null,
    })
    tx.account.update.mockResolvedValue({ id: "acc-1", isGroup: true })

    await updateAccount("acc-1", { isGroup: true }, finance)

    expect(tx.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isGroup: true }) })
    )
  })

  it("409s converting a leaf with posted lines to a group — nothing may be posted to a group", async () => {
    tx.account.findUnique.mockResolvedValue({
      id: "acc-1", code: "5201", name: "Salary", type: "EXPENSE",
      parentId: null, isGroup: false, cashKind: "NONE", isActive: true, description: null,
    })
    tx.journalLine.count.mockResolvedValue(7)

    await expect(updateAccount("acc-1", { isGroup: true }, finance)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("7 journal line"),
    })
  })

  it("409s converting a group that still has accounts under it", async () => {
    tx.account.findUnique.mockResolvedValue({
      id: "grp-1", code: "5200", name: "Admin", type: "EXPENSE",
      parentId: "grp-5000", isGroup: true, cashKind: "NONE", isActive: true, description: null,
    })
    tx.account.count.mockResolvedValue(3)

    await expect(updateAccount("grp-1", { isGroup: false }, finance)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Move them first"),
    })
  })
})

describe("deleteAccount", () => {
  it("deletes an account nothing references", async () => {
    tx.account.findUnique.mockResolvedValue({ id: "acc-1", code: "5201", name: "Salary" })

    await deleteAccount("acc-1", finance)

    expect(tx.account.delete).toHaveBeenCalledWith({ where: { id: "acc-1" } })
  })

  it("409s when any journal line references it — draft lines count too", async () => {
    tx.account.findUnique.mockResolvedValue({ id: "acc-1", code: "5201", name: "Salary" })
    tx.journalLine.count.mockResolvedValue(3)

    await expect(deleteAccount("acc-1", finance)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Deactivate"),
    })

    expect(tx.account.delete).not.toHaveBeenCalled()
  })

  it("409s when it has children", async () => {
    tx.account.findUnique.mockResolvedValue({ id: "grp-1", code: "5200", name: "Admin" })
    tx.account.count.mockResolvedValue(2)

    await expect(deleteAccount("grp-1", finance)).rejects.toMatchObject({ statusCode: 409 })
  })

  it("409s on a system-role account whatever else is true", async () => {
    tx.account.findUnique.mockResolvedValue({
      id: "acc-re",
      code: "3300",
      name: "Retained Earnings",
      systemRole: "RETAINED_EARNINGS",
    })

    await expect(deleteAccount("acc-re", finance)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("requirePostableAccounts", () => {
  it("returns a lookup keyed by id when every account is an active leaf", async () => {
    tx.account.findMany.mockResolvedValue([
      { id: "a", code: "5201", isGroup: false, isActive: true },
      { id: "b", code: "2132", isGroup: false, isActive: true },
    ])

    const map = await requirePostableAccounts(tx as never, ["a", "b"])

    expect(map.get("a")?.code).toBe("5201")
    expect(map.size).toBe(2)
  })

  it("400s naming the account when one is a group", async () => {
    tx.account.findMany.mockResolvedValue([
      { id: "a", code: "5200", name: "Administrative & Selling", isGroup: true, isActive: true },
      { id: "b", code: "2132", name: "Salary Payable", isGroup: false, isActive: true },
    ])

    await expect(requirePostableAccounts(tx as never, ["a", "b"])).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("5200"),
    })
  })

  it("400s naming the account when one is inactive", async () => {
    tx.account.findMany.mockResolvedValue([
      { id: "a", code: "5201", name: "Salary", isGroup: false, isActive: false },
    ])

    await expect(requirePostableAccounts(tx as never, ["a"])).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("5201"),
    })
  })

  it("400s when an id does not resolve at all", async () => {
    tx.account.findMany.mockResolvedValue([])

    await expect(requirePostableAccounts(tx as never, ["ghost"])).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})

describe("listAccounts", () => {
  it("nests children under parents and sorts each level by code", async () => {
    // Rows arrive code-ordered from the query; the mock must match.
    ;(prisma.account.findMany as any).mockResolvedValue([
      { id: "g1", code: "5200", name: "Admin", type: "EXPENSE", parentId: null, isGroup: true, cashKind: "NONE", isActive: true, systemRole: "ADMIN_SELLING", description: null },
      { id: "c1", code: "5201", name: "Salary", type: "EXPENSE", parentId: "g1", isGroup: false, cashKind: "NONE", isActive: true, systemRole: null, description: null },
      { id: "c2", code: "5206", name: "Office Rent", type: "EXPENSE", parentId: "g1", isGroup: false, cashKind: "NONE", isActive: true, systemRole: null, description: null },
    ])

    const tree = await listAccounts()

    expect(tree).toHaveLength(1)
    expect(tree[0].children.map((c) => c.code)).toEqual(["5201", "5206"])
  })
})
