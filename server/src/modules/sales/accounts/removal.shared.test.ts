import { beforeEach, describe, expect, it, vi } from "vitest"

import { assertNoOngoingOpportunities, closePendingRemovals } from "./removal.shared"

const tx = {
  opportunity: { count: vi.fn() },
  salesCollaboratorRemoval: { findMany: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
} as any

beforeEach(() => vi.clearAllMocks())

describe("assertNoOngoingOpportunities", () => {
  it("passes when the person owns no Ongoing Opportunity on the Sales Account", async () => {
    tx.opportunity.count.mockResolvedValue(0)
    await expect(assertNoOngoingOpportunities(tx, "sa-1", "emp-3", "Rahim")).resolves.toBeUndefined()
    expect(tx.opportunity.count).toHaveBeenCalledWith({
      where: { salesAccountId: "sa-1", ownerEmployeeId: "emp-3", status: "ONGOING" },
    })
  })

  it("refuses with a plain message naming the person, when they own one", async () => {
    tx.opportunity.count.mockResolvedValue(2)
    await expect(assertNoOngoingOpportunities(tx, "sa-1", "emp-3", "Rahim")).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Rahim"),
    })
  })
})

describe("closePendingRemovals", () => {
  it("closes every pending request that matches, and audits each one", async () => {
    tx.salesCollaboratorRemoval.findMany.mockResolvedValue([{ id: "r-1" }, { id: "r-2" }])
    const closed = await closePendingRemovals(tx, { salesAccountId: "sa-1" }, "CANCELLED", "u-1")
    expect(closed).toBe(2)
    expect(tx.salesCollaboratorRemoval.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["r-1", "r-2"] }, status: "PENDING" },
      data: { status: "CANCELLED", decidedBy: "u-1", decidedAt: expect.any(Date) },
    })
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2)
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: "SALES_COLLABORATOR_REMOVAL", entityId: "r-1", action: "CANCEL" }),
    })
  })

  it("does nothing when nothing is pending", async () => {
    tx.salesCollaboratorRemoval.findMany.mockResolvedValue([])
    expect(await closePendingRemovals(tx, { salesAccountId: "sa-1" }, "CANCELLED", "u-1")).toBe(0)
    expect(tx.salesCollaboratorRemoval.updateMany).not.toHaveBeenCalled()
  })
})
