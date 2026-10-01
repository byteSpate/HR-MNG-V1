import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/prisma", () => ({
  default: {
    payrollRun: { findUnique: vi.fn() },
  },
}))

import prisma from "../config/prisma"
import { AppError } from "../middleware/errorHandler"
import { parseDateOnly } from "./dates"
import { assertMonthNotLocked, monthName } from "./month-lock"

type Status = "DRAFT" | "SUBMITTED" | "APPROVED" | "DISBURSED"

const runAt = (status: Status | null) => {
  vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(
    status === null ? null : ({ status } as never)
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("assertMonthNotLocked", () => {
  it("passes when no run exists for the month", async () => {
    runAt(null)
    await expect(assertMonthNotLocked(parseDateOnly("2026-07-15"))).resolves.toBeUndefined()
  })

  it("passes on DRAFT — nothing has been paid, and a draft is meant to be reworked", async () => {
    runAt("DRAFT")
    await expect(assertMonthNotLocked(parseDateOnly("2026-07-15"))).resolves.toBeUndefined()
  })

  it("passes on SUBMITTED — awaiting approval is not yet money", async () => {
    // Locking here would mean a rejected run could never have its cause fixed,
    // since reject returns it to DRAFT for exactly that purpose.
    runAt("SUBMITTED")
    await expect(assertMonthNotLocked(parseDateOnly("2026-07-15"))).resolves.toBeUndefined()
  })

  it("409s on APPROVED", async () => {
    runAt("APPROVED")
    await expect(assertMonthNotLocked(parseDateOnly("2026-07-15"))).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it("409s on DISBURSED", async () => {
    runAt("DISBURSED")
    await expect(assertMonthNotLocked(parseDateOnly("2026-07-15"))).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it("throws an AppError, so the error middleware renders it as JSON", async () => {
    runAt("APPROVED")
    await expect(assertMonthNotLocked(parseDateOnly("2026-07-15"))).rejects.toBeInstanceOf(AppError)
  })

  it("names the month and year in the message", async () => {
    // A bare "month is locked" leaves the reader guessing which month they
    // touched, which is the whole reason the guard was hard to find before.
    runAt("APPROVED")
    await expect(assertMonthNotLocked(parseDateOnly("2026-07-15"))).rejects.toThrow(
      /July 2026 payroll is already approved/
    )
  })

  it("looks the run up by the date's UTC month and year", async () => {
    runAt(null)
    await assertMonthNotLocked(parseDateOnly("2026-01-31"))
    expect(prisma.payrollRun.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activeKey: "2026-01" } })
    )
  })

  it("reads December as month 12, not 0", async () => {
    // getUTCMonth() is zero-based; the schema's month column is not.
    runAt(null)
    await assertMonthNotLocked(parseDateOnly("2026-12-01"))
    expect(prisma.payrollRun.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activeKey: "2026-12" } })
    )
  })
})

describe("monthName", () => {
  it("labels January and December from a UTC-midnight date", () => {
    expect(monthName(parseDateOnly("2026-01-01"))).toBe("January")
    expect(monthName(parseDateOnly("2026-12-31"))).toBe("December")
  })
})
