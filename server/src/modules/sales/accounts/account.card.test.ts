import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    salesAccount: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../../media/media.provider", () => ({
  assertMediaConfigured: vi.fn(),
  isMediaConfigured: vi.fn(() => true),
}))
vi.mock("../../media/media.service", async () => ({
  ...(await vi.importActual<object>("../../media/media.service")),
  uploadBuffer: vi.fn(),
  destroyAsset: vi.fn(),
  signedAvatarUrl: vi.fn((publicId: string, version?: number) => `https://cdn.test/${publicId}?v=${version}`),
}))

import prisma from "../../../config/prisma"
import { assertMediaConfigured, isMediaConfigured } from "../../media/media.provider"
import { destroyAsset, uploadBuffer } from "../../media/media.service"
import { removeVisitingCard, setVisitingCard, visitingCardUrlOf } from "./account.card"

const OWNER_USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OTHER_USER = { sub: "user-3", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "user-9", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const FILE = { buffer: Buffer.from("png-bytes"), originalname: "card.png" }
const ID = "11111111-1111-4111-8111-111111111111"

const account = (overrides: Record<string, unknown> = {}) => ({
  id: ID, ownerEmployeeId: "emp-1", visitingCard: null, assignments: [{ employeeId: "emp-2" }], ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(isMediaConfigured).mockReturnValue(true)
  // The caller is the owner, emp-1, unless a test says otherwise.
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(account() as any)
  vi.mocked(prisma.salesAccount.update).mockResolvedValue({} as any)
  vi.mocked(uploadBuffer).mockResolvedValue({ publicId: `hr/sales/visiting-cards/${ID}`, version: 7, bytes: 9, format: "png" })
})

describe("setting a visiting card", () => {
  it("uploads to one stable path per account and stores that path with its version", async () => {
    await setVisitingCard(ID, FILE, OWNER_USER)
    expect(uploadBuffer).toHaveBeenCalledWith(FILE.buffer, `hr/sales/visiting-cards/${ID}`)
    expect(prisma.salesAccount.update).toHaveBeenCalledWith({
      where: { id: ID }, data: { visitingCard: `hr/sales/visiting-cards/${ID}#7` },
    })
  })

  it("answers with a link the page can show", async () => {
    const result = await setVisitingCard(ID, FILE, OWNER_USER)
    expect(result).toEqual({ visitingCardUrl: `https://cdn.test/hr/sales/visiting-cards/${ID}?v=7` })
  })

  it("writes a history row that says a card was set, without keeping the picture in the log", async () => {
    await setVisitingCard(ID, FILE, OWNER_USER)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entity: "SALES_ACCOUNT", entityId: ID, action: "UPDATE", changedBy: "user-1",
        after: { visitingCard: "added" },
      }),
    }))
  })

  it("says the card was replaced when there already was one", async () => {
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(account({ visitingCard: `hr/sales/visiting-cards/${ID}#3` }) as any)
    await setVisitingCard(ID, FILE, OWNER_USER)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ before: { visitingCard: "present" }, after: { visitingCard: "replaced" } }),
    }))
  })

  it("lets a collaborator and a Sales Admin set it", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    await expect(setVisitingCard(ID, FILE, OTHER_USER)).resolves.toBeDefined()
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-9" } } as any)
    await expect(setVisitingCard(ID, FILE, ADMIN)).resolves.toBeDefined()
  })

  it("refuses somebody who can only look at the account, and uploads nothing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-7" } } as any)
    await expect(setVisitingCard(ID, FILE, OTHER_USER))
      .rejects.toThrow("You can view this Sales Account, but only its owner, collaborators, or a Sales Admin can change its visiting card")
    expect(uploadBuffer).not.toHaveBeenCalled()
  })

  it("says the account does not exist before it uploads anything", async () => {
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(null)
    await expect(setVisitingCard(ID, FILE, OWNER_USER)).rejects.toThrow("That Sales Account does not exist")
    expect(uploadBuffer).not.toHaveBeenCalled()
  })

  it("asks for a file when none came", async () => {
    await expect(setVisitingCard(ID, undefined, OWNER_USER)).rejects.toThrow("Choose an image of the visiting card")
    expect(uploadBuffer).not.toHaveBeenCalled()
  })

  it("stops with a clear sentence when file storage is not set up", async () => {
    vi.mocked(assertMediaConfigured).mockImplementationOnce(() => { throw new Error("File storage is not configured on this server") })
    await expect(setVisitingCard(ID, FILE, OWNER_USER)).rejects.toThrow("File storage is not configured on this server")
    expect(uploadBuffer).not.toHaveBeenCalled()
  })

  it("throws away the uploaded picture when saving the account fails, so nothing is left behind", async () => {
    vi.mocked(prisma.salesAccount.update).mockRejectedValue(new Error("db down"))
    await expect(setVisitingCard(ID, FILE, OWNER_USER)).rejects.toThrow("db down")
    expect(destroyAsset).toHaveBeenCalledWith(`hr/sales/visiting-cards/${ID}`)
  })
})

describe("removing a visiting card", () => {
  const WITH_CARD = () =>
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(account({ visitingCard: `hr/sales/visiting-cards/${ID}#3` }) as any)

  it("deletes the picture, clears the field and says so in the history", async () => {
    WITH_CARD()
    const result = await removeVisitingCard(ID, OWNER_USER)
    expect(destroyAsset).toHaveBeenCalledWith(`hr/sales/visiting-cards/${ID}`)
    expect(prisma.salesAccount.update).toHaveBeenCalledWith({ where: { id: ID }, data: { visitingCard: null } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ before: { visitingCard: "present" }, after: { visitingCard: "removed" } }),
    }))
    expect(result).toEqual({ visitingCardUrl: null })
  })

  it("says so when there is no card to remove", async () => {
    await expect(removeVisitingCard(ID, OWNER_USER)).rejects.toThrow("This Sales Account has no visiting card")
    expect(destroyAsset).not.toHaveBeenCalled()
  })

  it("refuses somebody who can only look at the account", async () => {
    WITH_CARD()
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-7" } } as any)
    await expect(removeVisitingCard(ID, OTHER_USER)).rejects.toThrow("only its owner, collaborators, or a Sales Admin can change its visiting card")
    expect(destroyAsset).not.toHaveBeenCalled()
  })
})

describe("the link the page shows", () => {
  it("is null when the account has no card", () => {
    expect(visitingCardUrlOf(null)).toBeNull()
  })

  it("carries the version, so a replaced card is not served from an old cache", () => {
    expect(visitingCardUrlOf("hr/sales/visiting-cards/abc#4")).toBe("https://cdn.test/hr/sales/visiting-cards/abc?v=4")
  })

  it("is null, not an error, when file storage is not set up, so the account page still opens", () => {
    vi.mocked(isMediaConfigured).mockReturnValue(false)
    expect(visitingCardUrlOf("hr/sales/visiting-cards/abc#4")).toBeNull()
  })
})
