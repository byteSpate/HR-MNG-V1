import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    expenseClaim: { findUnique: vi.fn() },
    expenseAttachment: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) =>
      fn({
        expenseAttachment: { create: vi.fn(async () => ({ id: "att-1" })), delete: vi.fn() },
        auditLog: { create: vi.fn() },
      })
    ),
  },
}))

vi.mock("../attendance/attendance.service", () => ({
  requireEmployeeForUser: vi.fn(async () => ({ id: "emp-self" })),
}))

vi.mock("../media/media.service", () => ({
  expensePublicId: vi.fn(() => "hr/expenses/claim-1/uuid"),
  uploadBuffer: vi.fn(async () => ({ publicId: "hr/expenses/claim-1/uuid", bytes: 10, format: "pdf" })),
  destroyAsset: vi.fn(),
  signedDocumentUrl: vi.fn(async () => ({ url: "https://signed", expiresAt: "2026-08-25T10:00:00Z" })),
}))

vi.mock("../../utils/audit", () => ({ writeAudit: vi.fn() }))

import prisma from "../../config/prisma"
import { destroyAsset, uploadBuffer } from "../media/media.service"
import { deleteReceipt, getReceiptUrl, listReceipts, uploadReceipt } from "./expense.media"
import type { AccessTokenPayload } from "../auth/auth.types"

const actor = (role: string, sub = "user-1") =>
  ({ sub, role, email: "a@demo.com", mustChangePassword: false }) as AccessTokenPayload

const OWNER = actor("EMPLOYEE")
const OTHER = actor("EMPLOYEE", "user-2")
const FINANCE = actor("FINANCE_OFFICER", "user-fin")

const file = { buffer: Buffer.from("pdf"), originalname: "receipt.pdf" }

/** `emp-self` is what the mocked `requireEmployeeForUser` returns. */
function claim(over: { employeeId?: string; status?: string } = {}) {
  vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
    id: "claim-1",
    employeeId: over.employeeId ?? "emp-self",
    status: over.status ?? "PENDING",
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("who may attach a receipt", () => {
  it("lets an employee attach to their own pending claim", async () => {
    claim()
    await expect(uploadReceipt("claim-1", file, OWNER)).resolves.toBeDefined()
    expect(uploadBuffer).toHaveBeenCalled()
  })

  // A 403, not a 404: the claim plainly exists, and pretending otherwise
  // helps nobody.
  it("refuses somebody else's claim", async () => {
    claim({ employeeId: "emp-other" })
    await expect(uploadReceipt("claim-1", file, OTHER)).rejects.toThrow(
      "You may only work on your own expense claims"
    )
  })

  // The check runs before the upload. Uploading first would leave a blob in
  // Cloudinary that nothing points at, pushed there by somebody with no right
  // to the claim.
  it("does not upload anything when the caller is refused", async () => {
    claim({ employeeId: "emp-other" })
    await expect(uploadReceipt("claim-1", file, OTHER)).rejects.toThrow()
    expect(uploadBuffer).not.toHaveBeenCalled()
  })

  it("refuses a claim that has already been decided, even for Finance", async () => {
    claim({ status: "APPROVED" })
    await expect(uploadReceipt("claim-1", file, FINANCE)).rejects.toThrow(
      "already approved, so its receipts can no longer be changed"
    )
    expect(uploadBuffer).not.toHaveBeenCalled()
  })

  it("destroys the blob when the row write fails after the upload", async () => {
    claim()
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("db down"))

    await expect(uploadReceipt("claim-1", file, OWNER)).rejects.toThrow("db down")
    expect(destroyAsset).toHaveBeenCalledWith("hr/expenses/claim-1/uuid")
  })
})

describe("who may read a receipt", () => {
  it("lets Finance read anybody's, which is the point of a receipt", async () => {
    claim({ employeeId: "emp-other" })
    vi.mocked(prisma.expenseAttachment.findMany).mockResolvedValue([] as never)

    await expect(listReceipts("claim-1", FINANCE)).resolves.toEqual([])
  })

  it("lets Finance read a decided claim, unlike writing to one", async () => {
    claim({ employeeId: "emp-other", status: "REIMBURSED" })
    vi.mocked(prisma.expenseAttachment.findMany).mockResolvedValue([] as never)

    await expect(listReceipts("claim-1", FINANCE)).resolves.toEqual([])
  })

  it("refuses an employee reading a colleague's", async () => {
    claim({ employeeId: "emp-other" })
    await expect(listReceipts("claim-1", OTHER)).rejects.toThrow("your own expense claims")
  })

  // A signed URL is the file itself, so it asks the claim's question, not the
  // receipt row's.
  it("checks the parent claim before signing a URL", async () => {
    vi.mocked(prisma.expenseAttachment.findUnique).mockResolvedValue({
      id: "att-1",
      claimId: "claim-1",
      publicId: "p",
      format: "pdf",
    } as never)
    claim({ employeeId: "emp-other" })

    await expect(getReceiptUrl("att-1", OTHER)).rejects.toThrow("your own expense claims")
  })
})

describe("removing a receipt", () => {
  beforeEach(() => {
    vi.mocked(prisma.expenseAttachment.findUnique).mockResolvedValue({
      id: "att-1",
      claimId: "claim-1",
      publicId: "hr/expenses/claim-1/uuid",
      fileName: "receipt.pdf",
      format: "pdf",
    } as never)
  })

  it("removes the blob before the row, so nothing is orphaned", async () => {
    claim()
    await deleteReceipt("att-1", OWNER)
    expect(destroyAsset).toHaveBeenCalledWith("hr/expenses/claim-1/uuid")
  })

  // The evidence behind a decision somebody already made must not vanish.
  it("refuses to remove evidence from a decided claim", async () => {
    claim({ status: "APPROVED" })
    await expect(deleteReceipt("att-1", OWNER)).rejects.toThrow("no longer be changed")
    expect(destroyAsset).not.toHaveBeenCalled()
  })
})
