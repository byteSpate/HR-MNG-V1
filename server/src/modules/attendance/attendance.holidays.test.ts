import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    holiday: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    employee: { count: vi.fn() },
    // The month lock reads this. Defaulted to null in beforeEach — without
    // that, every holiday write test below hits an unmocked table.
    payrollRun: { findUnique: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import type { Holiday } from "../../generated/prisma/client"
import { parseDateOnly } from "../../utils/dates"
import { resolveGrid } from "./attendance.grid"
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  updateHoliday,
} from "./attendance.holidays"

const NOW = new Date("2026-08-15T06:00:00.000Z")

const row = (over: Partial<Holiday> = {}): Holiday => ({
  id: "hol-1",
  name: "Victory Day",
  date: parseDateOnly("2026-12-16"),
  type: "GENERAL",
  ...over,
})

/** A unique-constraint failure as Prisma reports it. */
const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(prisma.employee.count).mockResolvedValue(42)
  vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

// The stub this file used to assert on is gone: assertMonthNotLocked is real,
// lives in utils/month-lock.ts, and is unit-tested there. What matters here is
// that each holiday write actually consults it — a holiday moves the
// working-day count, and therefore the payroll denominator, for the whole
// company in that month.
describe("holiday writes respect the payroll month lock", () => {
  const locked = () =>
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ status: "APPROVED" } as never)

  it("409s creating a holiday in an approved month", async () => {
    locked()
    await expect(
      createHoliday({ name: "Ad-hoc holiday", date: "2026-07-20", type: "GENERAL" })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.holiday.create).not.toHaveBeenCalled()
  })

  it("409s updating a holiday in an approved month", async () => {
    vi.mocked(prisma.holiday.findUnique).mockResolvedValue(row({ date: parseDateOnly("2026-07-20") }))
    locked()
    await expect(updateHoliday("hol-1", { name: "Renamed" })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(prisma.holiday.update).not.toHaveBeenCalled()
  })

  it("409s deleting a holiday in an approved month", async () => {
    vi.mocked(prisma.holiday.findUnique).mockResolvedValue(row({ date: parseDateOnly("2026-07-20") }))
    locked()
    await expect(deleteHoliday("hol-1")).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.holiday.delete).not.toHaveBeenCalled()
  })

  it("checks both the old and the new month when a holiday moves", async () => {
    // Moving a holiday *out* of a paid month is as damaging as moving one in.
    vi.mocked(prisma.holiday.findUnique).mockResolvedValue(row({ date: parseDateOnly("2026-07-20") }))
    vi.mocked(prisma.holiday.update).mockResolvedValue(row({ date: parseDateOnly("2026-08-20") }))
    await updateHoliday("hol-1", { date: "2026-08-20" })
    expect(prisma.payrollRun.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activeKey: "2026-07" } })
    )
    expect(prisma.payrollRun.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activeKey: "2026-08" } })
    )
  })
})

describe("listHolidays", () => {
  it("defaults to the current office year", async () => {
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([row()])
    await listHolidays()
    expect(prisma.holiday.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date: {
            gte: new Date("2026-01-01T00:00:00.000Z"),
            lte: new Date("2026-12-31T00:00:00.000Z"),
          },
        },
      })
    )
  })

  it("returns date-only strings, not instants", async () => {
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([row()])
    expect(await listHolidays(2026)).toEqual([
      { id: "hol-1", name: "Victory Day", date: "2026-12-16", type: "GENERAL" },
    ])
  })
})

describe("createHoliday", () => {
  it("stores the date at UTC midnight", async () => {
    // A stray time component would silently never match a day-grid
    // comparison — it would read as "the holiday just doesn't work".
    vi.mocked(prisma.holiday.create).mockResolvedValue(row())
    await createHoliday({ name: "Victory Day", date: "2026-12-16", type: "GENERAL" })
    expect(prisma.holiday.create).toHaveBeenCalledWith({
      data: {
        name: "Victory Day",
        date: new Date("2026-12-16T00:00:00.000Z"),
        type: "GENERAL",
      },
    })
  })

  it("reports no impact for a future date", async () => {
    vi.mocked(prisma.holiday.create).mockResolvedValue(row())
    const result = await createHoliday({ name: "Victory Day", date: "2026-12-16", type: "GENERAL" })
    expect(result.impact).toBeUndefined()
  })

  it("reports impact when backdating, because the change rewrites history", async () => {
    const past = row({ date: parseDateOnly("2026-08-03") })
    vi.mocked(prisma.holiday.create).mockResolvedValue(past)
    const result = await createHoliday({ name: "Founders Day", date: "2026-08-03", type: "GENERAL" })
    expect(result.impact).toEqual({
      affectedEmployees: 42,
      affectedDates: ["2026-08-03"],
      monthsTouched: ["2026-08"],
    })
  })

  it("409s on a repeated name for the same date", async () => {
    vi.mocked(prisma.holiday.create).mockRejectedValue(p2002)
    await expect(
      createHoliday({ name: "May Day", date: "2026-05-01", type: "GENERAL" })
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("allows a second, differently named holiday on the same date", async () => {
    // 2026-05-01 is both May Day and Buddha Purnima.
    vi.mocked(prisma.holiday.create).mockResolvedValue(
      row({ name: "Buddha Purnima", date: parseDateOnly("2026-05-01") })
    )
    const result = await createHoliday({
      name: "Buddha Purnima",
      date: "2026-05-01",
      type: "GENERAL",
    })
    expect(result.holiday.name).toBe("Buddha Purnima")
  })
})

describe("updateHoliday", () => {
  it("404s for an unknown id", async () => {
    vi.mocked(prisma.holiday.findUnique).mockResolvedValue(null)
    await expect(updateHoliday("nope", { name: "x" })).rejects.toMatchObject({ statusCode: 404 })
  })

  it("reports both dates when a holiday moves", async () => {
    // The old date stops being a holiday and the new one starts, so two
    // sets of employee-days change.
    const existing = row({ date: parseDateOnly("2026-08-03") })
    vi.mocked(prisma.holiday.findUnique).mockResolvedValue(existing)
    vi.mocked(prisma.holiday.update).mockResolvedValue(
      row({ date: parseDateOnly("2026-08-04") })
    )

    const result = await updateHoliday("hol-1", { date: "2026-08-04" })
    expect(result.impact?.affectedDates).toEqual(["2026-08-03", "2026-08-04"])
  })

  it("reports one date when only the name changes", async () => {
    const existing = row({ date: parseDateOnly("2026-08-03") })
    vi.mocked(prisma.holiday.findUnique).mockResolvedValue(existing)
    vi.mocked(prisma.holiday.update).mockResolvedValue(existing)

    const result = await updateHoliday("hol-1", { name: "Renamed" })
    expect(result.impact?.affectedDates).toEqual(["2026-08-03"])
  })
})

describe("deleteHoliday", () => {
  it("404s for an unknown id", async () => {
    vi.mocked(prisma.holiday.findUnique).mockResolvedValue(null)
    await expect(deleteHoliday("nope")).rejects.toMatchObject({ statusCode: 404 })
  })

  it("reports impact for a past holiday", async () => {
    vi.mocked(prisma.holiday.findUnique).mockResolvedValue(row({ date: parseDateOnly("2026-08-05") }))
    vi.mocked(prisma.holiday.delete).mockResolvedValue(row())
    const result = await deleteHoliday("hol-1")
    expect(result.impact).toMatchObject({ affectedDates: ["2026-08-05"], affectedEmployees: 42 })
  })
})

describe("what a holiday write actually does to the grid", () => {
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
  const employee = {
    id: "emp-1",
    joiningDate: parseDateOnly("2024-01-06"),
    employmentStatus: "ACTIVE" as const,
    shiftId: null,
    lastWorkingDay: null,
  }
  const from = parseDateOnly("2026-08-03")
  const to = parseDateOnly("2026-08-07")

  const build = (holidays: Holiday[]) =>
    resolveGrid([employee], from, to, {
      attendances: [],
      leaves: [],
      holidays,
      shifts: [GENERAL],
    }).get("emp-1")!

  it("adding a holiday over a past working day turns ABSENT into HOLIDAY", () => {
    expect(build([]).find((d) => d.date === "2026-08-04")!.status).toBe("ABSENT")
    expect(
      build([row({ date: parseDateOnly("2026-08-04"), name: "Founders Day" })]).find(
        (d) => d.date === "2026-08-04"
      )!.status
    ).toBe("HOLIDAY")
  })

  it("removing a WORKING_DAY row takes a working day away again", () => {
    // The inverted delete: every other delete restores a working day, this
    // one restores the weekly off.
    const withOverride = build([
      row({ date: parseDateOnly("2026-08-07"), name: "Cancelled", type: "WORKING_DAY" }),
    ])
    expect(withOverride.find((d) => d.date === "2026-08-07")!.isWorkingDay).toBe(true)

    const without = build([])
    expect(without.find((d) => d.date === "2026-08-07")!.status).toBe("WEEKLY_OFF")
    expect(without.find((d) => d.date === "2026-08-07")!.isWorkingDay).toBe(false)
  })
})
