import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    salesAccount: { findUnique: vi.fn() },
    salesAccountAnswer: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../sales.access", async () => ({
  ...(await vi.importActual<object>("../sales.access")),
  requireAccountVisible: vi.fn(),
}))

import prisma from "../../../config/prisma"
import { getAccountProfile, updateAccountProfile } from "./account.profile"
import { PROFILE_QUESTIONS } from "./account.profile.questions"

const ID = "11111111-1111-4111-8111-111111111111"
const OWNER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OTHER = { sub: "user-3", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const BRANCHES = "Does the company have branches?"

const account = () => ({ ownerEmployeeId: "emp-1", assignments: [{ employeeId: "emp-2" }] })
const row = (o: Record<string, unknown> = {}) => ({
  id: "row-1", salesAccountId: ID, questionKey: "branches", customQuestion: null,
  answer: "YES", detail: "Chattogram", updatedBy: "user-1",
  createdAt: new Date("2026-09-20T00:00:00.000Z"), updatedAt: new Date("2026-09-21T00:00:00.000Z"), ...o,
})
const customRow = (o: Record<string, unknown> = {}) =>
  row({ id: "c-1", questionKey: null, customQuestion: "Who is the CTO?", answer: "Mr Rahman", detail: null, ...o })
const auditData = () => vi.mocked(prisma.auditLog.create).mock.calls[0][0].data as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "user-1", displayName: null, email: "a@b.c", employee: { fullName: "Rahim" } },
  ] as any)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(account() as any)
  vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccountAnswer.create).mockResolvedValue({} as any)
  vi.mocked(prisma.salesAccountAnswer.update).mockResolvedValue({} as any)
  vi.mocked(prisma.salesAccountAnswer.delete).mockResolvedValue({} as any)
})

describe("reading the profile", () => {
  it("lists every ready-made question in its group, with the answers found and who wrote them", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([row()] as any)
    const profile = await getAccountProfile(ID, OWNER)
    expect(profile.total).toBe(PROFILE_QUESTIONS.length)
    expect(profile.answered).toBe(1)
    expect(profile.groups[0].title).toBe("Offices and sites")
    expect(profile.groups[0].questions[0]).toMatchObject({
      key: "branches", type: "YES_NO", answer: "YES", detail: "Chattogram",
      detailLabel: "Where are they, and how many?", answeredByName: "Rahim", answeredAt: "2026-09-21T00:00:00.000Z",
    })
    expect(profile.groups[0].questions[1]).toMatchObject({ key: "staff", answer: null, answeredByName: null })
  })

  it("keeps the account's own questions in their own list", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([customRow()] as any)
    const profile = await getAccountProfile(ID, OWNER)
    expect(profile.custom).toEqual([{ id: "c-1", question: "Who is the CTO?", answer: "Mr Rahman", answeredByName: "Rahim", answeredAt: "2026-09-21T00:00:00.000Z" }])
    expect(profile.answered).toBe(0)
  })

  it("says the account is not there when it is not", async () => {
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(null as any)
    await expect(getAccountProfile(ID, OWNER)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("tells a viewer who cannot manage the account so", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-9" } } as any)
    expect((await getAccountProfile(ID, OTHER)).canManage).toBe(false)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    expect((await getAccountProfile(ID, OTHER)).canManage).toBe(true)
  })
})

describe("saving answers", () => {
  it("stores a new Yes with its detail and writes one History row in words", async () => {
    await updateAccountProfile(ID, { answers: { branches: { answer: "YES", detail: "Chattogram" } } }, OWNER)
    expect(prisma.salesAccountAnswer.create).toHaveBeenCalledWith({
      data: { salesAccountId: ID, questionKey: "branches", answer: "YES", detail: "Chattogram", updatedBy: "user-1" },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(auditData()).toMatchObject({
      entity: "SALES_ACCOUNT", entityId: ID, action: "UPDATE", changedBy: "user-1",
      after: { [`Company profile: ${BRANCHES}`]: "Yes, Chattogram" },
    })
  })

  it("writes nothing when the answer is the same as before", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([row()] as any)
    await updateAccountProfile(ID, { answers: { branches: { answer: "YES", detail: "Chattogram" } } }, OWNER)
    expect(prisma.salesAccountAnswer.create).not.toHaveBeenCalled()
    expect(prisma.salesAccountAnswer.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("changes an answer and records the old and the new words, dropping the detail of a No", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([row()] as any)
    await updateAccountProfile(ID, { answers: { branches: { answer: "NO", detail: "ignored" } } }, OWNER)
    expect(prisma.salesAccountAnswer.update).toHaveBeenCalledWith({
      where: { id: "row-1" }, data: { answer: "NO", detail: null, updatedBy: "user-1" },
    })
    expect(auditData()).toMatchObject({
      before: { [`Company profile: ${BRANCHES}`]: "Yes, Chattogram" },
      after: { [`Company profile: ${BRANCHES}`]: "No" },
    })
  })

  it("clears an answer with null, and does nothing to one that was never given", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([row()] as any)
    await updateAccountProfile(ID, { answers: { branches: null, staff: null } }, OWNER)
    expect(prisma.salesAccountAnswer.delete).toHaveBeenCalledTimes(1)
    expect(prisma.salesAccountAnswer.delete).toHaveBeenCalledWith({ where: { id: "row-1" } })
    expect(auditData().after).toEqual({ [`Company profile: ${BRANCHES}`]: null })
  })

  it("refuses a key that is not on the list, and changes nothing", async () => {
    await expect(updateAccountProfile(ID, { answers: { colour: { answer: "Blue" } } }, OWNER))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/not a question on the company profile/) })
    expect(prisma.salesAccountAnswer.create).not.toHaveBeenCalled()
  })

  it("refuses answers that do not fit their question (Review Focus 4)", async () => {
    await expect(updateAccountProfile(ID, { answers: { staff: { answer: "1e5" } } }, OWNER)).rejects.toMatchObject({ statusCode: 400 })
    await expect(updateAccountProfile(ID, { answers: { cabling: { answer: "Plastic" } } }, OWNER)).rejects.toMatchObject({ statusCode: 400 })
    await expect(updateAccountProfile(ID, { answers: { internet: { answer: "BTCL", detail: "x" } } }, OWNER)).rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.salesAccountAnswer.create).not.toHaveBeenCalled()
  })

  it("refuses someone who can see the account but may not change it (Review Focus 5)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-9" } } as any)
    await expect(updateAccountProfile(ID, { answers: { staff: { answer: "10" } } }, OTHER))
      .rejects.toMatchObject({ statusCode: 403, message: "You can view this Sales Account, but only its owner, collaborators, or a Sales Admin can change its company profile" })
    expect(prisma.salesAccountAnswer.create).not.toHaveBeenCalled()
  })

  it("says the account is not there when it is not", async () => {
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(null as any)
    await expect(updateAccountProfile(ID, { answers: { staff: { answer: "10" } } }, OWNER)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("two saves at the same moment", () => {
  const uniqueClash = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" })

  it("answers 409 in words when someone saved the same new answer a moment before", async () => {
    vi.mocked(prisma.salesAccountAnswer.create).mockRejectedValue(uniqueClash())
    await expect(updateAccountProfile(ID, { answers: { staff: { answer: "10" } } }, OWNER))
      .rejects.toMatchObject({
        statusCode: 409,
        message: "Someone just saved an answer to this question. Reload the page and try again.",
      })
  })

  it("lets any other database failure through as it is", async () => {
    vi.mocked(prisma.salesAccountAnswer.create).mockRejectedValue(new Error("connection lost"))
    await expect(updateAccountProfile(ID, { answers: { staff: { answer: "10" } } }, OWNER))
      .rejects.toThrow("connection lost")
  })
})

describe("the account's own questions", () => {
  it("writes nothing when an own question is saved as it already is", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([customRow()] as any)
    await updateAccountProfile(ID, { custom: { update: [{ id: "c-1", question: "Who is the CTO?", answer: "Mr Rahman" }] } }, OWNER)
    expect(prisma.salesAccountAnswer.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("records the old and the new question when an own question is renamed", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([customRow()] as any)
    await updateAccountProfile(ID, { custom: { update: [{ id: "c-1", question: "Who is the IT head?", answer: "Mr Rahman" }] } }, OWNER)
    expect(auditData()).toMatchObject({
      before: { "Company profile: Who is the CTO?": "Mr Rahman" },
      after: { "Company profile: Who is the IT head?": "Mr Rahman" },
    })
  })

  it("records a removed own question in the History as cleared", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([customRow()] as any)
    await updateAccountProfile(ID, { custom: { remove: ["c-1"] } }, OWNER)
    expect(auditData()).toMatchObject({
      before: { "Company profile: Who is the CTO?": "Mr Rahman" },
      after: { "Company profile: Who is the CTO?": null },
    })
  })

  it("adds one, without a question key, and puts its words in the History", async () => {
    await updateAccountProfile(ID, { custom: { add: [{ question: "Who is the CTO?", answer: "Mr Rahman" }] } }, OWNER)
    expect(prisma.salesAccountAnswer.create).toHaveBeenCalledWith({
      data: { salesAccountId: ID, customQuestion: "Who is the CTO?", answer: "Mr Rahman", updatedBy: "user-1" },
    })
    expect(auditData().after).toEqual({ "Company profile: Who is the CTO?": "Mr Rahman" })
  })

  it("updates and removes one of its own", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([customRow(), customRow({ id: "c-2", customQuestion: "Any CCTV vendor?", answer: "Hikvision" })] as any)
    await updateAccountProfile(ID, { custom: {
      update: [{ id: "c-1", question: "Who is the CTO?", answer: "Mr Karim" }], remove: ["c-2"] } }, OWNER)
    expect(prisma.salesAccountAnswer.update).toHaveBeenCalledWith({
      where: { id: "c-1" }, data: { customQuestion: "Who is the CTO?", answer: "Mr Karim", updatedBy: "user-1" },
    })
    expect(prisma.salesAccountAnswer.delete).toHaveBeenCalledWith({ where: { id: "c-2" } })
  })

  it("refuses an id that another person already removed, or that is not its own question (Review Focus 3)", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue([row()] as any)
    const sentence = "That question is not on this account."
    await expect(updateAccountProfile(ID, { custom: { remove: ["22222222-2222-4222-8222-222222222222"] } }, OWNER))
      .rejects.toMatchObject({ statusCode: 404, message: sentence })
    // A ready-made answer's row id is not one of the account's own questions.
    await expect(updateAccountProfile(ID, { custom: { update: [{ id: "row-1", question: "Q here", answer: "a" }] } }, OWNER))
      .rejects.toMatchObject({ statusCode: 404, message: sentence })
    expect(prisma.salesAccountAnswer.delete).not.toHaveBeenCalled()
  })

  it("stops at 30 own questions", async () => {
    vi.mocked(prisma.salesAccountAnswer.findMany).mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => customRow({ id: `c-${i}` })) as any)
    await expect(updateAccountProfile(ID, { custom: { add: [{ question: "One more?", answer: "no" }] } }, OWNER))
      .rejects.toMatchObject({ statusCode: 400, message: "An account can have up to 30 of its own questions." })
  })
})
