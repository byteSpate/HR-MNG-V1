import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/prisma", () => ({
  default: {
    emailDispatch: { create: vi.fn(), update: vi.fn() },
  },
}))

const sendMailMock = vi.fn()
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}))

vi.mock("../config/env", () => ({
  env: {
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: 587,
    SMTP_USER: "user",
    SMTP_PASS: "pass",
    EMAIL_FROM: "no-reply@example.com",
  },
}))

import nodemailer from "nodemailer"
import prisma from "../config/prisma"
import { notify, sendMail } from "./mailer"

const mockedPrisma = prisma as unknown as {
  emailDispatch: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
}

const dispatch = {
  to: "a@b.com",
  kind: "PASSWORD_RESET" as const,
  subject: "Reset",
  text: "text body",
  html: "<p>html body</p>",
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPrisma.emailDispatch.create.mockResolvedValue({ id: "d1" })
  mockedPrisma.emailDispatch.update.mockResolvedValue({})
  sendMailMock.mockResolvedValue({})
})

describe("sendMail", () => {
  it("writes a dispatch row before sending and stamps sentAt after", async () => {
    await sendMail(dispatch)

    expect(mockedPrisma.emailDispatch.create).toHaveBeenCalledWith({
      data: {
        to: "a@b.com",
        kind: "PASSWORD_RESET",
        subject: "Reset",
        entity: null,
        entityId: null,
      },
    })
    expect(mockedPrisma.emailDispatch.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { sentAt: expect.any(Date) },
    })
  })

  it("records the entity pair when one is given", async () => {
    await sendMail({ ...dispatch, entity: "PAYSLIP", entityId: "p1" })

    expect(mockedPrisma.emailDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: "PAYSLIP", entityId: "p1" }),
    })
  })

  it("records the error and rethrows when the transport refuses", async () => {
    sendMailMock.mockRejectedValue(new Error("550 mailbox unavailable"))

    await expect(sendMail(dispatch)).rejects.toThrow("550 mailbox unavailable")

    expect(mockedPrisma.emailDispatch.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { error: "550 mailbox unavailable" },
    })
  })

  it("reuses one transporter across sends", async () => {
    // A fresh module registry, so the memoised transporter starts unbuilt —
    // the tests above have already built it, and clearAllMocks zeroes the
    // call count without clearing the module-level cache.
    vi.resetModules()
    const { sendMail: freshSendMail } = await import("./mailer")

    await freshSendMail(dispatch)
    await freshSendMail(dispatch)

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1)
  })
})

describe("with no SMTP_HOST configured", () => {
  it("still writes and completes a dispatch row, so the log is exercisable locally", async () => {
    vi.resetModules()
    vi.doMock("../config/env", () => ({ env: { SMTP_HOST: undefined } }))
    const { sendMail: sendMailNoSmtp } = await import("./mailer")

    await sendMailNoSmtp(dispatch)

    expect(mockedPrisma.emailDispatch.create).toHaveBeenCalled()
    expect(mockedPrisma.emailDispatch.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { sentAt: expect.any(Date) },
    })
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})

describe("notify", () => {
  it("swallows a transport failure but still records it", async () => {
    sendMailMock.mockRejectedValue(new Error("connection refused"))

    await expect(notify(dispatch)).resolves.toBeUndefined()

    expect(mockedPrisma.emailDispatch.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { error: "connection refused" },
    })
  })
})

/**
 * The TLS mode is derived from the port, and getting it wrong does not throw
 * — it hangs until the socket times out, which reads as "email silently does
 * not work". Both branches are asserted because the failure is invisible.
 */
describe("transport security", () => {
  it("upgrades with mandatory STARTTLS on 587", async () => {
    vi.resetModules()
    vi.doMock("../config/env", () => ({
      env: { SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: 587, SMTP_USER: "u", SMTP_PASS: "p" },
    }))
    const nm = (await import("nodemailer")).default
    const { sendMail } = await import("./mailer")
    await sendMail({ to: "a@b.c", kind: "PASSWORD_RESET", subject: "s", text: "t", html: "<p>t</p>" })

    expect(nm.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true })
    )
  })

  it("uses implicit TLS on 465, where the socket is encrypted before SMTP begins", async () => {
    vi.resetModules()
    vi.doMock("../config/env", () => ({
      env: { SMTP_HOST: "smtp.example.com", SMTP_PORT: 465, SMTP_USER: "u", SMTP_PASS: "p" },
    }))
    const nm = (await import("nodemailer")).default
    const { sendMail } = await import("./mailer")
    await sendMail({ to: "a@b.c", kind: "PASSWORD_RESET", subject: "s", text: "t", html: "<p>t</p>" })

    expect(nm.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, requireTLS: false })
    )
  })
})

describe("mailMode", () => {
  it("says plainly that nothing is sent when SMTP_HOST is absent", async () => {
    vi.resetModules()
    vi.doMock("../config/env", () => ({ env: {} }))
    const { mailMode } = await import("./mailer")
    expect(mailMode()).toContain("nothing is actually sent")
  })

  it("names the host and the from address when it is really sending", async () => {
    vi.resetModules()
    vi.doMock("../config/env", () => ({
      env: { SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: 587, EMAIL_FROM: "no-reply@bytespate.com" },
    }))
    const { mailMode } = await import("./mailer")
    const line = mailMode()
    expect(line).toContain("smtp-relay.brevo.com:587")
    expect(line).toContain("no-reply@bytespate.com")
  })
})
