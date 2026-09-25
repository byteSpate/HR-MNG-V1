import { describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({ default: {} }))

import { ensureCustomerForAccount } from "./customer.link"

function txWith(account: any = { id: "acc-1", name: "Bengal Group", address: "Dhaka", customer: null }) {
  return {
    salesAccount: { findUniqueOrThrow: vi.fn().mockResolvedValue(account) },
    customer: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  } as any
}

describe("ensureCustomerForAccount", () => {
  it("returns the customer already linked to the account", async () => {
    const tx = txWith({ id: "acc-1", name: "Bengal Group", address: null, customer: { id: "c1", legalName: "Bengal Group" } })
    await expect(ensureCustomerForAccount(tx, "acc-1", "throw-on-conflict", "u-1")).resolves.toEqual({ id: "c1", legalName: "Bengal Group" })
    expect(tx.customer.create).not.toHaveBeenCalled()
  })

  it("links an opening-balance customer with the same legal name instead of duplicating it", async () => {
    const tx = txWith()
    tx.customer.findUnique.mockResolvedValue({ id: "c-ob", legalName: "Bengal Group", salesAccountId: null })
    tx.customer.update.mockResolvedValue({ id: "c-ob", legalName: "Bengal Group" })
    await ensureCustomerForAccount(tx, "acc-1", "throw-on-conflict", "u-1")
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: "c-ob" }, data: { salesAccountId: "acc-1" }, select: { id: true, legalName: true } })
    expect(tx.customer.create).not.toHaveBeenCalled()
  })

  it("creates one from the account's name and address", async () => {
    const tx = txWith()
    tx.customer.create.mockResolvedValue({ id: "c-new", legalName: "Bengal Group" })
    await ensureCustomerForAccount(tx, "acc-1", "throw-on-conflict", "u-1")
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: { legalName: "Bengal Group", billingAddress: "Dhaka", salesAccountId: "acc-1" },
      select: { id: true, legalName: true },
    })
  })

  it("returns null, without throwing, when the name belongs to another account's customer", async () => {
    const tx = txWith()
    tx.customer.findUnique.mockResolvedValue({ id: "c-x", legalName: "Bengal Group", salesAccountId: "acc-9" })
    await expect(ensureCustomerForAccount(tx, "acc-1", "skip-on-conflict", "u-1")).resolves.toBeNull()
  })

  it("throws a 409 naming the fix when asked to", async () => {
    const tx = txWith()
    tx.customer.findUnique.mockResolvedValue({ id: "c-x", legalName: "Bengal Group", salesAccountId: "acc-9" })
    await expect(ensureCustomerForAccount(tx, "acc-1", "throw-on-conflict", "u-1")).rejects.toThrow(
      "A customer called Bengal Group already belongs to another sales account. Rename one of them on Customers, then try again."
    )
  })
})
