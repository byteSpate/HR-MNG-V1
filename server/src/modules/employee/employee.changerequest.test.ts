import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    employee: { findUnique: vi.fn(), update: vi.fn() },
    employeeChangeRequest: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  }
  return {
    default: {
      employee: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("../notification/notification.mailer", () => ({
  sendNationalIdChangeDecidedEmail: vi.fn(() => Promise.resolve()),
}))

import prisma from "../../config/prisma"
import { sendNationalIdChangeDecidedEmail } from "../notification/notification.mailer"
import {
  cancelNationalIdChangeRequest,
  decideNationalIdChangeRequest,
  requestNationalIdChange,
} from "./employee.changerequest"

const tx = (prisma as unknown as { __tx: any }).__tx

const actor = (role: string, sub = "user-1") =>
  ({ sub, role, email: "a@demo.com", mustChangePassword: false }) as never

beforeEach(() => {
  vi.clearAllMocks()
  // emitEvent looks up the subject's manager whenever managerEmployeeId is
  // left undefined. Every test that reaches it needs this to resolve to
  // something rather than throw on an unmocked call.
  tx.employee.findUnique.mockResolvedValue({
    id: "emp-1",
    fullName: "Ayesha Rahman",
    nationalId: "0000000000",
    reportingManagerId: null,
    user: { email: "ayesha@demo.com" },
  })
})

describe("requestNationalIdChange", () => {
  it("403s a caller with no employee row", async () => {
    tx.employee.findUnique.mockResolvedValueOnce(null)
    await expect(
      requestNationalIdChange(actor("HR_ADMIN"), "1234567890")
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("400s an empty value", async () => {
    await expect(requestNationalIdChange(actor("EMPLOYEE"), "   ")).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(tx.employeeChangeRequest.create).not.toHaveBeenCalled()
  })

  it("supersedes an existing pending request for the same field", async () => {
    tx.employeeChangeRequest.updateMany.mockResolvedValue({ count: 1 })
    tx.employeeChangeRequest.create.mockResolvedValue({
      id: "req-2",
      employeeId: "emp-1",
      field: "NATIONAL_ID",
      oldValue: "0000000000",
      newValue: "1234567890",
      status: "PENDING",
    })

    await requestNationalIdChange(actor("EMPLOYEE"), "1234567890")

    expect(tx.employeeChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeId: "emp-1", field: "NATIONAL_ID", status: "PENDING" },
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    )
    expect(tx.employeeChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: "emp-1",
          field: "NATIONAL_ID",
          oldValue: "0000000000",
          newValue: "1234567890",
          status: "PENDING",
        }),
      })
    )
  })
})

describe("decideNationalIdChangeRequest", () => {
  it("applies the new value to the employee record on approval", async () => {
    tx.employeeChangeRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      field: "NATIONAL_ID",
      newValue: "1234567890",
      status: "PENDING",
      employee: { fullName: "Ayesha Rahman", user: { email: "ayesha@demo.com" } },
    })
    tx.employeeChangeRequest.update.mockResolvedValue({ id: "req-1", status: "APPROVED" })

    await decideNationalIdChangeRequest(actor("HR_ADMIN"), "req-1", "APPROVE")

    expect(tx.employee.update).toHaveBeenCalledWith({
      where: { id: "emp-1" },
      data: { nationalId: "1234567890" },
    })
    expect(sendNationalIdChangeDecidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ayesha@demo.com", approved: true })
    )
  })

  it("requires a note to reject", async () => {
    await expect(
      decideNationalIdChangeRequest(actor("HR_ADMIN"), "req-1", "REJECT")
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(tx.employeeChangeRequest.findUnique).not.toHaveBeenCalled()
  })

  it("rejects without touching the employee record, and emails the reason", async () => {
    tx.employeeChangeRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      field: "NATIONAL_ID",
      newValue: "1234567890",
      status: "PENDING",
      employee: { fullName: "Ayesha Rahman", user: { email: "ayesha@demo.com" } },
    })
    tx.employeeChangeRequest.update.mockResolvedValue({ id: "req-1", status: "REJECTED" })

    await decideNationalIdChangeRequest(actor("HR_ADMIN"), "req-1", "REJECT", "Does not match")

    expect(tx.employee.update).not.toHaveBeenCalled()
    expect(sendNationalIdChangeDecidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ayesha@demo.com", approved: false, reason: "Does not match" })
    )
  })

  it("403s a caller who is not HR", async () => {
    await expect(
      decideNationalIdChangeRequest(actor("EMPLOYEE"), "req-1", "APPROVE")
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(tx.employeeChangeRequest.findUnique).not.toHaveBeenCalled()
  })

  it("409s a request that has already been decided", async () => {
    tx.employeeChangeRequest.findUnique.mockResolvedValue({ id: "req-1", status: "APPROVED" })
    await expect(
      decideNationalIdChangeRequest(actor("HR_ADMIN"), "req-1", "APPROVE")
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("cancelNationalIdChangeRequest", () => {
  it("lets the requester cancel their own pending request", async () => {
    tx.employeeChangeRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      status: "PENDING",
    })
    tx.employeeChangeRequest.update.mockResolvedValue({ id: "req-1", status: "CANCELLED" })

    await cancelNationalIdChangeRequest(actor("EMPLOYEE"), "req-1")

    expect(tx.employeeChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "req-1" },
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    )
  })

  it("403s a caller cancelling someone else's request", async () => {
    tx.employeeChangeRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-2",
      status: "PENDING",
    })

    await expect(cancelNationalIdChangeRequest(actor("EMPLOYEE"), "req-1")).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it("409s cancelling a request that is no longer pending", async () => {
    tx.employeeChangeRequest.findUnique.mockResolvedValue({
      id: "req-1",
      employeeId: "emp-1",
      status: "APPROVED",
    })

    await expect(cancelNationalIdChangeRequest(actor("EMPLOYEE"), "req-1")).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it("404s a request that does not exist", async () => {
    tx.employeeChangeRequest.findUnique.mockResolvedValue(null)
    await expect(cancelNationalIdChangeRequest(actor("EMPLOYEE"), "req-1")).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})
