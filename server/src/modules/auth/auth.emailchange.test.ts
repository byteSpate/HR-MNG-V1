import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({
  env: { CLIENT_ORIGIN: "https://app.test", COMPANY_NAME: "Byte Spate" },
}))

vi.mock("../../config/prisma", () => {
  const tx = {
    user: { update: vi.fn() },
    emailChangeRequest: { updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  }
  return {
    default: {
      user: { findUnique: vi.fn(), update: vi.fn() },
      emailChangeRequest: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("./auth.service", () => ({ revokeAllUserTokens: vi.fn() }))

vi.mock("./mailer", () => ({
  sendEmailChangeApprovalEmail: vi.fn(),
  sendEmailChangeConfirmEmail: vi.fn(),
  sendEmailChangedNotice: vi.fn(),
}))

import prisma from "../../config/prisma"
import { revokeAllUserTokens } from "./auth.service"
import {
  sendEmailChangeApprovalEmail,
  sendEmailChangeConfirmEmail,
  sendEmailChangedNotice,
} from "./mailer"
import {
  approveEmailChange,
  cancelEmailChange,
  confirmEmailChange,
  normaliseEmail,
  requestEmailChange,
} from "./auth.emailchange"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx as {
  user: { update: ReturnType<typeof vi.fn> }
  emailChangeRequest: {
    updateMany: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
}

const HOUR = 60 * 60 * 1000

/** The account doing the changing; `null` for whichever lookup means "free". */
function accounts(byId: { id: string; email: string } | null, byEmail: unknown = null) {
  vi.mocked(prisma.user.findUnique).mockImplementation((async (args: {
    where: { id?: string; email?: string }
  }) => (args.where.id ? byId : byEmail)) as never)
}

function pending(over: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    userId: "user-1",
    newEmail: "new@demo.com",
    approvedAt: null,
    confirmTokenHash: null,
    completedAt: null,
    cancelledAt: null,
    expiresAt: new Date(Date.now() + HOUR),
    user: { id: "user-1", email: "old@demo.com" },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.emailChangeRequest.findFirst).mockResolvedValue(null as never)
  tx.emailChangeRequest.create.mockResolvedValue({ newEmail: "new@demo.com" } as never)
})

describe("normaliseEmail", () => {
  // Without this, Sales@ and sales@ are two rows against a unique column that
  // considers them different, and one person ends up with two accounts.
  it("lower-cases and trims, so one address cannot become two accounts", () => {
    expect(normaliseEmail("  Sales@Bytespate.COM ")).toBe("sales@bytespate.com")
  })
})

describe("requesting a change", () => {
  it("emails the address on file, and tells the new one nothing yet", async () => {
    accounts({ id: "user-1", email: "old@demo.com" })

    await requestEmailChange("user-1", "New@demo.com")

    expect(sendEmailChangeApprovalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "old@demo.com", newEmail: "new@demo.com" })
    )
    // Mailing the new address before approval would make this endpoint a way
    // to send mail to any address of the caller's choosing.
    expect(sendEmailChangeConfirmEmail).not.toHaveBeenCalled()
  })

  it("mints no token the new address could use", async () => {
    accounts({ id: "user-1", email: "old@demo.com" })

    await requestEmailChange("user-1", "new@demo.com")

    const created = tx.emailChangeRequest.create.mock.calls[0][0].data
    expect(created.approveTokenHash).toBeTruthy()
    expect(created.confirmTokenHash).toBeUndefined()
  })

  it("cancels any earlier live request, so one inbox holds one live link", async () => {
    accounts({ id: "user-1", email: "old@demo.com" })

    await requestEmailChange("user-1", "new@demo.com")

    expect(tx.emailChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cancelledAt: expect.any(Date) } })
    )
  })

  it("refuses an address already on another account", async () => {
    accounts({ id: "user-1", email: "old@demo.com" }, { id: "someone-else" })

    await expect(requestEmailChange("user-1", "taken@demo.com")).rejects.toThrow(
      "already in use on another account"
    )
    expect(sendEmailChangeApprovalEmail).not.toHaveBeenCalled()
  })

  it("refuses the address the account already has", async () => {
    accounts({ id: "user-1", email: "old@demo.com" })

    await expect(requestEmailChange("user-1", "OLD@demo.com")).rejects.toThrow(
      "already the address on this account"
    )
  })

  it("throttles, so this cannot be used to post into an inbox repeatedly", async () => {
    accounts({ id: "user-1", email: "old@demo.com" })
    vi.mocked(prisma.emailChangeRequest.findFirst).mockResolvedValue({ id: "recent" } as never)

    await expect(requestEmailChange("user-1", "new@demo.com")).rejects.toThrow(
      "A change was just requested"
    )
  })
})

describe("approving from the old address", () => {
  it("only now mints a confirm token, and only now emails the new address", async () => {
    vi.mocked(prisma.emailChangeRequest.findUnique).mockResolvedValue(pending() as never)

    await approveEmailChange("raw-approve")

    const data = vi.mocked(prisma.emailChangeRequest.update).mock.calls[0][0].data as {
      approvedAt: Date
      confirmTokenHash: string
    }
    expect(data.approvedAt).toBeInstanceOf(Date)
    expect(data.confirmTokenHash).toBeTruthy()
    expect(sendEmailChangeConfirmEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "new@demo.com" })
    )
  })

  it("says which way a dead link is dead", async () => {
    const cases: [Record<string, unknown> | null, string][] = [
      [null, "not valid"],
      [{ completedAt: new Date() }, "already been completed"],
      [{ cancelledAt: new Date() }, "was cancelled"],
      [{ expiresAt: new Date(Date.now() - 1) }, "has expired"],
    ]
    for (const [over, message] of cases) {
      vi.mocked(prisma.emailChangeRequest.findUnique).mockResolvedValue(
        (over === null ? null : pending(over)) as never
      )
      await expect(approveEmailChange("raw")).rejects.toThrow(message)
    }
  })
})

describe("refusing from the old address", () => {
  // Somebody was able to start this, which means somebody may be holding a
  // session on the account.
  it("cancels the request and signs every session out", async () => {
    vi.mocked(prisma.emailChangeRequest.findUnique).mockResolvedValue(pending() as never)

    await cancelEmailChange("raw-approve")

    expect(prisma.emailChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cancelledAt: expect.any(Date) } })
    )
    expect(revokeAllUserTokens).toHaveBeenCalledWith("user-1")
  })
})

describe("confirming from the new address", () => {
  const approved = () => pending({ approvedAt: new Date(), confirmTokenHash: "hash" })

  it("applies the change, signs out everywhere, and tells both addresses", async () => {
    vi.mocked(prisma.emailChangeRequest.findUnique).mockResolvedValue(approved() as never)
    accounts(null)

    const result = await confirmEmailChange("raw-confirm")

    expect(result.email).toBe("new@demo.com")
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "new@demo.com" },
    })
    expect(revokeAllUserTokens).toHaveBeenCalledWith("user-1")

    const notified = vi.mocked(sendEmailChangedNotice).mock.calls.map((c) => c[0].to)
    // The old address too — it is the last place a change nobody wanted can
    // still be noticed.
    expect(notified).toEqual(expect.arrayContaining(["new@demo.com", "old@demo.com"]))
  })

  // The whole design rests on this: a confirm token that works without the
  // old address having approved would make the second link the only gate,
  // and an attacker controls the second inbox by definition.
  it("refuses a token whose request was never approved", async () => {
    vi.mocked(prisma.emailChangeRequest.findUnique).mockResolvedValue(
      pending({ confirmTokenHash: "hash" }) as never
    )
    accounts(null)

    await expect(confirmEmailChange("raw-confirm")).rejects.toThrow("has not been approved")
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  // An address free an hour ago can belong to somebody by now.
  it("re-checks the address, because an hour has passed since the first check", async () => {
    vi.mocked(prisma.emailChangeRequest.findUnique).mockResolvedValue(approved() as never)
    accounts(null, { id: "someone-else" })

    await expect(confirmEmailChange("raw-confirm")).rejects.toThrow("already in use")
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it("refuses a link that has already been used", async () => {
    vi.mocked(prisma.emailChangeRequest.findUnique).mockResolvedValue(
      approved() as never
    )
    vi.mocked(prisma.emailChangeRequest.findUnique).mockResolvedValue(
      pending({ approvedAt: new Date(), completedAt: new Date() }) as never
    )

    await expect(confirmEmailChange("raw-confirm")).rejects.toThrow("already been completed")
  })
})
