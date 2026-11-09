import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({
  env: { APP_TIMEZONE: "Asia/Dhaka", CLIENT_ORIGIN: "http://localhost:3000" },
}))

vi.mock("../config/prisma", () => {
  const tx = {
    attendance: { update: vi.fn() },
    attendanceAudit: { create: vi.fn() },
    event: { create: vi.fn() },
    employee: { findUnique: vi.fn() },
  }
  return {
    default: {
      attendance: { findMany: vi.fn() },
      shift: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

import prisma from "../config/prisma"
import { parseDateOnly } from "../utils/dates"
import { runAutoCloseOpenDays } from "./attendance-autoclose.job"

const tx = (prisma as unknown as { __tx: Record<string, Record<string, ReturnType<typeof vi.fn>>> })
  .__tx

/** 22:05 on 2026-08-18 in Dhaka (UTC+6), the moment the job runs. */
const NOW = new Date("2026-08-18T16:05:00.000Z")
const TODAY = parseDateOnly("2026-08-18")

const GENERAL = {
  id: "shift-general",
  name: "General",
  startTime: "09:00",
  endTime: "18:00",
  breakMinutes: 60,
  graceMinutes: 15,
  weeklyOffDays: [5],
  effectiveFrom: null,
  effectiveTo: null,
}

/** Dhaka is UTC+6, so 09:00 local is 03:00Z and 18:00 local is 12:00Z. */
const openRow = (over: Record<string, unknown> = {}) => ({
  id: "att-1",
  date: TODAY,
  checkIn: new Date("2026-08-18T03:05:00.000Z"),
  checkOut: null,
  employee: { id: "emp-1", shiftId: "shift-general" },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL] as never)
  vi.mocked(prisma.attendance.findMany).mockResolvedValue([] as never)
})

describe("runAutoCloseOpenDays", () => {
  it("closes today's open day at the shift's end time", async () => {
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([openRow()] as never)

    const closed = await runAutoCloseOpenDays()

    expect(closed).toBe(1)
    expect(tx.attendance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "att-1" },
        data: expect.objectContaining({
          checkOut: new Date("2026-08-18T12:00:00.000Z"),
          isEarlyOut: false,
          approval: "PENDING",
        }),
      })
    )
  })

  it("leaves the record PENDING, so an assumed time cannot reach payroll unseen", async () => {
    // The whole safety argument for doing this at all. Preflight blocks a run
    // on pending attendance, so a human still has to look at the guess.
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([openRow()] as never)

    await runAutoCloseOpenDays()

    const data = tx.attendance.update.mock.calls[0]![0].data as Record<string, unknown>
    expect(data.approval).toBe("PENDING")
    expect(data.autoCheckOutAt).toBeInstanceOf(Date)
  })

  it("marks the check-out as invented rather than punched", async () => {
    // Without autoCheckOutAt, MISSING_CHECKOUT stops firing and the guess
    // reaches the approver looking exactly like a real punch.
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([openRow()] as never)

    await runAutoCloseOpenDays()

    expect(tx.attendanceAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "AUTO_CHECK_OUT", changedBy: null }),
      })
    )
  })

  it("tells the employee, and nobody else", async () => {
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([openRow()] as never)

    await runAutoCloseOpenDays()

    expect(tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "attendance.auto_closed",
          subjectEmployeeId: "emp-1",
          actorUserId: null,
          managerEmployeeId: null,
        }),
      })
    )
  })

  it("skips a day whose shift ended before the check-in", async () => {
    // Checked in at 19:00 on a 09:00-18:00 shift. Closing at 18:00 would put
    // the check-out before the check-in, which is not a record — it is
    // corrupt data. Left open for a human, keeping MISSING_CHECKOUT.
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([
      openRow({ checkIn: new Date("2026-08-18T13:00:00.000Z") }),
    ] as never)

    const closed = await runAutoCloseOpenDays()

    expect(closed).toBe(0)
    expect(tx.attendance.update).not.toHaveBeenCalled()
  })

  it("keeps going when one record cannot be resolved", async () => {
    // `resolveShift` throws rather than returning null when the seeded
    // default is missing. Letting that escape would mean one bad row leaves
    // everybody else's day open until the job runs again tomorrow.
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([
      openRow(),
      openRow({ id: "att-2" }),
    ] as never)

    await expect(runAutoCloseOpenDays()).resolves.toBe(0)
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it("asks only for today's unclosed rows", async () => {
    await runAutoCloseOpenDays()

    expect(prisma.attendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date: TODAY, checkIn: { not: null }, checkOut: null },
      })
    )
  })

  it("does nothing, and queries no shifts, when nothing is open", async () => {
    expect(await runAutoCloseOpenDays()).toBe(0)
    expect(prisma.shift.findMany).not.toHaveBeenCalled()
  })
})
