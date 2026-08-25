import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    assetRequest: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    assetCategory: { findUnique: vi.fn() },
    assetAssignment: { findFirst: vi.fn() },
    assetRepair: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
    employee: { findUnique: vi.fn() },
  }
  return {
    default: {
      assetRequest: { findMany: vi.fn(), findUnique: vi.fn() },
      employee: { findUnique: vi.fn(), findMany: vi.fn() },
      auditLog: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("./asset.assignments", () => ({ assignAsset: vi.fn() }))
vi.mock("../notification/notification.mailer", () => ({
  sendAssetRequestDecidedEmail: vi.fn(() => Promise.resolve()),
}))

import prisma from "../../config/prisma"
import { sendAssetRequestDecidedEmail } from "../notification/notification.mailer"
import { assignAsset } from "./asset.assignments"
import {
  approveRequest,
  cancelRequest,
  fulfilRequest,
  getRequestTimeline,
  listRequests,
  markOrdered,
  rejectRequest,
  submitRequest,
} from "./asset.requests"

const tx = (prisma as unknown as { __tx: any }).__tx

const hr = { sub: "user-hr", role: "HR_ADMIN", email: "hr@demo.com", mustChangePassword: false } as never
const mgr = { sub: "user-mgr", role: "REPORTING_MANAGER", email: "m@demo.com", mustChangePassword: false } as never
const emp = { sub: "user-emp", role: "EMPLOYEE", email: "e@demo.com", mustChangePassword: false } as never
const admin = { sub: "user-admin", role: "SUPER_ADMIN", email: "a@demo.com", mustChangePassword: false } as never
const finance = { sub: "user-fin", role: "FINANCE_OFFICER", email: "f@demo.com", mustChangePassword: false } as never

beforeEach(() => {
  vi.clearAllMocks()
  tx.auditLog.create.mockResolvedValue({})
  tx.event.create.mockResolvedValue({})
  tx.assetRequest.findFirst.mockResolvedValue(null)
})

describe("approveRequest — Super Admin alone", () => {
  beforeEach(() => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1", employeeId: "emp-1", kind: "NEW_ITEM", status: "PENDING",
      category: { name: "Monitor" }, asset: null,
      employee: { user: { email: "requester@b.com" } },
    })
    tx.assetRequest.update.mockResolvedValue({ id: "req-1", status: "APPROVED" })
    prisma.employee.findUnique = vi.fn().mockResolvedValue({ id: "emp-9" })
  })

  it("emails the requester once the decision has committed", async () => {
    await approveRequest("req-1", {}, admin)

    expect(sendAssetRequestDecidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "requester@b.com",
        requestId: "req-1",
        itemName: "Monitor",
        approved: true,
      })
    )
  })

  it("does not email when the requester has no account", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1", employeeId: "emp-1", kind: "NEW_ITEM", status: "PENDING",
      category: { name: "Monitor" }, asset: null,
      employee: { user: null },
    })

    await approveRequest("req-1", {}, admin)

    expect(sendAssetRequestDecidedEmail).not.toHaveBeenCalled()
  })

  it("lets a Super Admin approve", async () => {
    await expect(approveRequest("req-1", {}, admin)).resolves.toMatchObject({ status: "APPROVED" })
  })

  it("refuses an HR_ADMIN — approval commits money and sits with Super Admin (ADR-0002)", async () => {
    await expect(approveRequest("req-1", {}, hr)).rejects.toMatchObject({
      statusCode: 403,
      message: "Only a Super Admin can decide an asset request",
    })
  })

  it("refuses the requester's own manager", async () => {
    await expect(approveRequest("req-1", {}, mgr)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("listRequests — visibility", () => {
  it("shows a Finance Officer every request", async () => {
    // Finance capitalises whatever gets bought, so a pending purchase is a
    // pending payable. Before this they fell into the employee branch, had no
    // Employee row, and received [].
    vi.mocked(prisma.assetRequest.findMany).mockResolvedValue([] as never)

    await listRequests(finance)

    expect(prisma.assetRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    )
  })

  it("still scopes a manager to themselves and their reports", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-mgr" } as never)
    vi.mocked(prisma.assetRequest.findMany).mockResolvedValue([] as never)

    await listRequests(mgr)

    expect(prisma.assetRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ employeeId: "emp-mgr" }, { employee: { reportingManagerId: "emp-mgr" } }] },
      })
    )
  })
})

describe("approveRequest — status guard", () => {
  it("409s on a request that is not PENDING", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      status: "REJECTED",
      category: { name: "Monitor" },
    })

    await expect(approveRequest("req-1", {}, admin)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("approveRequest — REPAIR", () => {
  it("creates the repair in the same transaction and links it", async () => {
    // Decision 5: approval means it has gone to the repairer. The alternative
    // leaves a request APPROVED while nothing was sent — exactly the blind
    // spot ORDERED exists to close.
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1", employeeId: "emp-1", kind: "REPAIR", status: "PENDING",
      assetId: "ast-1", reason: "Keyboard is dead",
      category: null, asset: { assetTag: "BS-AST-00012", name: "MacBook Pro 14" },
    })
    tx.assetRepair.findFirst.mockResolvedValue(null)
    tx.assetRepair.create.mockResolvedValue({ id: "rep-1" })
    tx.assetRequest.update.mockResolvedValue({ id: "req-1", status: "APPROVED", repairId: "rep-1" })

    await approveRequest("req-1", {}, admin)

    expect(tx.assetRepair.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assetId: "ast-1", fault: "Keyboard is dead" }),
      })
    )
    expect(tx.assetRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ repairId: "rep-1" }) })
    )
  })

  it("409s when the asset already has an open repair", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1", employeeId: "emp-1", kind: "REPAIR", status: "PENDING",
      assetId: "ast-1", reason: "Screen flickers",
      category: null, asset: { assetTag: "BS-AST-00012", name: "MacBook Pro 14" },
    })
    tx.assetRepair.findFirst.mockResolvedValue({ id: "rep-existing" })

    await expect(approveRequest("req-1", {}, admin)).rejects.toMatchObject({
      statusCode: 409,
      message: "This asset already has an open repair",
    })
  })
})

describe("fulfilRequest", () => {
  it("creates exactly one assignment and moves the request to FULFILLED", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      kind: "NEW_ITEM",
      status: "APPROVED",
      category: { name: "Monitor" },
    })
    tx.assetRequest.update.mockResolvedValue({ id: "req-1", status: "FULFILLED" })

    await fulfilRequest("req-1", { assetId: "ast-1" }, hr)

    expect(assignAsset).toHaveBeenCalledOnce()
    expect(assignAsset).toHaveBeenCalledWith(
      "ast-1",
      expect.objectContaining({ employeeId: "emp-1", requestId: "req-1" }),
      hr,
      expect.anything()
    )
    expect(tx.assetRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FULFILLED", fulfilledAssetId: "ast-1" }),
      })
    )
  })

  it("409s on a request that was never approved", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      status: "PENDING",
      category: { name: "Monitor" },
    })

    await expect(fulfilRequest("req-1", { assetId: "ast-1" }, hr)).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(assignAsset).not.toHaveBeenCalled()
  })

  it("refuses a REPAIR — fulfilment hands out a new item, it never completes a repair", async () => {
    // A REPAIR or RETURN request is completed by physically receiving the
    // asset — receiving a repaired laptop is not the same act as handing out
    // another one.
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1", employeeId: "emp-1", kind: "REPAIR", status: "APPROVED", quantity: null,
      assetId: "ast-1", category: null, asset: { assetTag: "BS-AST-00012", name: "MacBook Pro 14" },
    })

    await expect(fulfilRequest("req-1", { assetId: "ast-1" }, hr)).rejects.toMatchObject({
      statusCode: 409,
      message: "Only a request for a new item can be fulfilled",
    })
    expect(assignAsset).not.toHaveBeenCalled()
  })
})

describe("fulfilRequest — supplies", () => {
  it("closes a supply request without creating an asset or an assignment", async () => {
    // ADR-0003: ten pens is one fact, not ten rows.
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1", employeeId: "emp-1", kind: "NEW_ITEM", status: "APPROVED", quantity: 10,
      category: { name: "Stationery", tracksIndividually: false }, asset: null,
    })
    tx.assetRequest.update.mockResolvedValue({ id: "req-1", status: "FULFILLED" })

    await fulfilRequest("req-1", { note: "Issued from the store cupboard" }, hr)

    expect(assignAsset).not.toHaveBeenCalled()
    expect(tx.assetRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FULFILLED", fulfilledAssetId: null }),
      })
    )
  })

  it("requires an assetId for a tracked request", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-2", employeeId: "emp-1", kind: "NEW_ITEM", status: "APPROVED", quantity: null,
      category: { name: "Monitor", tracksIndividually: true }, asset: null,
    })

    await expect(fulfilRequest("req-2", {}, hr)).rejects.toMatchObject({
      statusCode: 400,
      message: "Choose which asset to hand over.",
    })
  })
})

describe("rejectRequest", () => {
  it("400s an empty note — a rejection nobody explained is one the requester cannot act on", async () => {
    await expect(rejectRequest("req-1", { note: "" }, hr)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(tx.assetRequest.update).not.toHaveBeenCalled()
  })

  it("400s a whitespace-only note", async () => {
    await expect(rejectRequest("req-1", { note: "   " }, hr)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(tx.assetRequest.update).not.toHaveBeenCalled()
  })

  it("emails the requester the reason", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1", employeeId: "emp-1", kind: "NEW_ITEM", status: "PENDING",
      category: { name: "Monitor" }, asset: null,
      employee: { user: { email: "requester@b.com" } },
    })
    tx.assetRequest.update.mockResolvedValue({ id: "req-1", status: "REJECTED" })

    await rejectRequest("req-1", { note: "None left in stock" }, admin)

    expect(sendAssetRequestDecidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "requester@b.com",
        itemName: "Monitor",
        approved: false,
        reason: "None left in stock",
      })
    )
  })
})

describe("cancelRequest", () => {
  it("403s someone who is not the requester", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      status: "PENDING",
    })
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-other" } as never)

    await expect(cancelRequest("req-1", {}, mgr)).rejects.toMatchObject({ statusCode: 403 })
    expect(tx.assetRequest.update).not.toHaveBeenCalled()
  })
})

describe("markOrdered", () => {
  it("moves an APPROVED request to ORDERED", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({ id: "req-1", kind: "NEW_ITEM", status: "APPROVED" })
    tx.assetRequest.update.mockResolvedValue({ id: "req-1", status: "ORDERED" })

    await expect(markOrdered("req-1", { expectedBy: "2026-09-01" }, hr)).resolves.toMatchObject({
      status: "ORDERED",
    })
  })

  it("refuses a REPAIR — ordering is a NEW_ITEM concept", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({ id: "req-1", kind: "REPAIR", status: "APPROVED" })

    await expect(markOrdered("req-1", {}, hr)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("cancelRequest — HR's dead end", () => {
  it("lets HR cancel an ORDERED request with a note", async () => {
    // Decision 9: CANCELLED widens rather than a fifth terminal status being
    // added. The note carries "discontinued" vs "she changed her mind".
    tx.assetRequest.findUnique.mockResolvedValue({ id: "req-1", employeeId: "emp-1", status: "ORDERED" })
    tx.assetRequest.update.mockResolvedValue({ id: "req-1", status: "CANCELLED" })

    await expect(
      cancelRequest("req-1", { note: "Discontinued by the supplier" }, hr)
    ).resolves.toMatchObject({ status: "CANCELLED" })
  })

  it("requires a note when HR cancels", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({ id: "req-1", employeeId: "emp-1", status: "APPROVED" })

    await expect(cancelRequest("req-1", {}, hr)).rejects.toMatchObject({
      statusCode: 400,
      message: "A reason is required to cancel someone else's request",
    })
  })

  it("still refuses an employee cancelling after approval", async () => {
    tx.assetRequest.findUnique.mockResolvedValue({ id: "req-1", employeeId: "emp-1", status: "APPROVED" })
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1" } as never)

    await expect(cancelRequest("req-1", {}, emp)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("listRequests scoping", () => {
  it("an EMPLOYEE sees only their own", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1" } as never)
    vi.mocked(prisma.assetRequest.findMany).mockResolvedValue([] as never)

    await listRequests(emp)

    expect(prisma.assetRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: "emp-1" } })
    )
  })

  it("a REPORTING_MANAGER sees their own plus their direct reports'", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-mgr" } as never)
    vi.mocked(prisma.assetRequest.findMany).mockResolvedValue([] as never)

    await listRequests(mgr)

    expect(prisma.assetRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ employeeId: "emp-mgr" }, { employee: { reportingManagerId: "emp-mgr" } }],
        },
      })
    )
  })

  it("HR / SUPER_ADMIN see all — no scoping filter and no employee lookup", async () => {
    vi.mocked(prisma.assetRequest.findMany).mockResolvedValue([] as never)

    await listRequests(hr)

    expect(prisma.employee.findUnique).not.toHaveBeenCalled()
    expect(prisma.assetRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    )
  })
})

describe("submitRequest — REPAIR and RETURN", () => {
  beforeEach(() => {
    tx.employee.findUnique.mockResolvedValue({ id: "emp-1" })
  })

  it("accepts a REPAIR for an asset the requester is holding", async () => {
    tx.assetAssignment.findFirst.mockResolvedValue({
      id: "asg-1",
      assetId: "ast-1",
      employeeId: "emp-1",
      asset: { assetTag: "BS-AST-00012", name: "MacBook Pro 14" },
    })
    tx.assetRequest.create.mockResolvedValue({ id: "req-1", kind: "REPAIR", assetId: "ast-1" })

    await expect(
      submitRequest({ kind: "REPAIR", assetId: "ast-1", reason: "Keyboard is dead" }, emp)
    ).resolves.toMatchObject({ id: "req-1" })

    expect(tx.assetRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "REPAIR", assetId: "ast-1", categoryId: null }),
      })
    )
  })

  it("404s when the requester does not hold the asset", async () => {
    // 404 not 403 (V-35): probing ids must teach nothing about what exists.
    tx.assetAssignment.findFirst.mockResolvedValue(null)

    await expect(
      submitRequest({ kind: "RETURN", assetId: "someone-elses", reason: "Done with it" }, emp)
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("409s when the asset already has an open request", async () => {
    // The unique partial index is the last line of defence; without this
    // check a double-submit throws P2002 and the error middleware renders a
    // bare 500.
    tx.assetAssignment.findFirst.mockResolvedValue({
      id: "asg-1",
      assetId: "ast-1",
      employeeId: "emp-1",
      asset: { assetTag: "BS-AST-00012", name: "MacBook Pro 14" },
    })
    tx.assetRequest.findFirst.mockResolvedValue({ id: "req-existing" })

    await expect(
      submitRequest({ kind: "REPAIR", assetId: "ast-1", reason: "Keyboard is dead" }, emp)
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "This asset already has an open request",
    })
    expect(tx.assetRequest.create).not.toHaveBeenCalled()
  })
})

describe("submitRequest — supplies and quantity", () => {
  beforeEach(() => {
    tx.employee.findUnique.mockResolvedValue({ id: "emp-1" })
  })

  it("requires a quantity for a supply category", async () => {
    tx.assetCategory.findUnique.mockResolvedValue({ id: "cat-s", name: "Stationery", tracksIndividually: false })

    await expect(
      submitRequest({ kind: "NEW_ITEM", categoryId: "cat-s", reason: "Out of pens" }, emp)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Stationery is issued by quantity, so a quantity is required.",
    })
  })

  it("rejects a quantity on a tracked category", async () => {
    // Two monitors is two requests: fulfilment writes one fulfilledAssetId
    // and an assignment is one asset to one person.
    tx.assetCategory.findUnique.mockResolvedValue({ id: "cat-m", name: "Monitor", tracksIndividually: true })

    await expect(
      submitRequest({ kind: "NEW_ITEM", categoryId: "cat-m", quantity: 2, reason: "Dual screen" }, emp)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Monitor is issued one at a time — submit one request per item.",
    })
  })
})

describe("getRequestTimeline", () => {
  it("404s — not 403s — when the request is not visible to the viewer", async () => {
    // Scoped through listRequests first, so an out-of-scope id teaches
    // nothing about what exists (V-35) and never reads a history.
    vi.mocked(prisma.assetRequest.findMany).mockResolvedValue([] as never)

    await expect(getRequestTimeline("req-invisible", finance)).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
  })

  it("maps each audit row onto the timeline shape in ascending order", async () => {
    vi.mocked(prisma.assetRequest.findMany).mockResolvedValue([
      {
        id: "req-1", employeeId: "emp-1", kind: "NEW_ITEM", status: "APPROVED",
        category: { name: "Monitor" }, asset: null, repair: null,
      } as never,
    ])
    const submittedAt = new Date("2026-08-01T10:00:00.000Z")
    const approvedAt = new Date("2026-08-02T10:00:00.000Z")
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { action: "SUBMIT", changedAt: submittedAt, changedBy: "user-emp", note: null },
      { action: "APPROVE", changedAt: approvedAt, changedBy: "user-admin", note: "Looks fine" },
    ] as never)

    const timeline = await getRequestTimeline("req-1", finance)

    expect(timeline).toEqual([
      { action: "SUBMIT", at: submittedAt, byUserId: "user-emp", note: null },
      { action: "APPROVE", at: approvedAt, byUserId: "user-admin", note: "Looks fine" },
    ])
    // The ascending order is the query's job; the service trusts the store.
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entity: "ASSET_REQUEST", entityId: "req-1" },
        orderBy: { changedAt: "asc" },
      })
    )
  })
})
