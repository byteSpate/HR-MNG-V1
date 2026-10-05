import { describe, expect, it } from "vitest"

import { Prisma } from "../../generated/prisma/client"
import {
  assertBalanced,
  assertLineShape,
  financialYearName,
  financialYearPeriods,
  invertLines,
  monthWindow,
  normalSide,
  signedBalance,
  sumSides,
  toLedgerDate,
  utcDate,
  validateAccountCode,
} from "./accounting.utils"

const D = (v: string | number) => new Prisma.Decimal(v)
const line = (debit: string | number, credit: string | number) => ({
  debit: D(debit),
  credit: D(credit),
})

describe("sumSides", () => {
  it("totals both columns across four legs", () => {
    const totals = sumSides([
      line("500000.00", 0),
      line("20000.00", 0),
      line(0, "30000.00"),
      line(0, "490000.00"),
    ])

    expect(totals.debit.toFixed(2)).toBe("520000.00")
    expect(totals.credit.toFixed(2)).toBe("520000.00")
  })

  it("returns zeroes for no lines rather than throwing", () => {
    const totals = sumSides([])

    expect(totals.debit.toFixed(2)).toBe("0.00")
    expect(totals.credit.toFixed(2)).toBe("0.00")
  })
})

describe("assertBalanced", () => {
  it("accepts a balanced four-leg journal", () => {
    expect(() =>
      assertBalanced([
        line("500000.00", 0),
        line("20000.00", 0),
        line(0, "30000.00"),
        line(0, "490000.00"),
      ])
    ).not.toThrow()
  })

  it("names both totals when they differ, so the error is diagnosable", () => {
    // en-IN grouping, the way the statements print: 5,20,000.00.
    // The screens show the stored sides the other way round (bank style), so
    // the message does too: the stored debit is read as the credit.
    expect(() => assertBalanced([line("520000.00", 0), line(0, "500000.00")])).toThrow(
      /Debit 5,00,000\.00 does not equal credit 5,20,000\.00/
    )
  })

  it("rejects a journal whose totals agree at zero", () => {
    expect(() => assertBalanced([line(0, 0), line(0, 0)])).toThrow(/greater than zero/i)
  })

  it("rejects a single-line journal", () => {
    expect(() => assertBalanced([line("100.00", 0)])).toThrow(/at least two lines/i)
  })

  it("catches a one-paisa difference that float arithmetic would hide", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Decimal must not agree.
    // Stored debit 0.30 and credit 0.31, said the way the screens say it.
    expect(() =>
      assertBalanced([line("0.10", 0), line("0.20", 0), line(0, "0.31")])
    ).toThrow(/0\.31.*0\.30/)
  })

  it("accepts the same figures when they do balance", () => {
    expect(() =>
      assertBalanced([line("0.10", 0), line("0.20", 0), line(0, "0.30")])
    ).not.toThrow()
  })
})

describe("assertLineShape", () => {
  it("accepts a debit-only line", () => {
    expect(() => assertLineShape(line("100.00", 0), 0)).not.toThrow()
  })

  it("accepts a credit-only line", () => {
    expect(() => assertLineShape(line(0, "100.00"), 0)).not.toThrow()
  })

  it("rejects a line carrying both a debit and a credit, naming the row", () => {
    expect(() => assertLineShape(line("100.00", "100.00"), 2)).toThrow(/line 3/i)
  })

  it("rejects a line with neither", () => {
    expect(() => assertLineShape(line(0, 0), 0)).toThrow(/line 1/i)
  })

  it("rejects a negative amount", () => {
    expect(() => assertLineShape(line("-100.00", 0), 0)).toThrow(/negative/i)
  })
})

describe("validateAccountCode", () => {
  it.each([
    ["1110", "ASSET"],
    ["2120", "LIABILITY"],
    ["3300", "EQUITY"],
    ["4110", "INCOME"],
    ["5201", "EXPENSE"],
  ] as const)("accepts %s for %s", (code, type) => {
    expect(() => validateAccountCode(code, type)).not.toThrow()
  })

  it("rejects an expense account coded in the asset range", () => {
    expect(() => validateAccountCode("1300", "EXPENSE")).toThrow(/must start with 5/)
  })

  it("rejects a three-digit code", () => {
    expect(() => validateAccountCode("511", "EXPENSE")).toThrow(/four digits/i)
  })

  it("rejects a non-numeric code", () => {
    expect(() => validateAccountCode("5A10", "EXPENSE")).toThrow(/four digits/i)
  })
})

describe("normalSide", () => {
  it("puts assets and expenses on the debit side", () => {
    expect(normalSide("ASSET")).toBe("DEBIT")
    expect(normalSide("EXPENSE")).toBe("DEBIT")
  })

  it("puts liabilities, equity and income on the credit side", () => {
    expect(normalSide("LIABILITY")).toBe("CREDIT")
    expect(normalSide("EQUITY")).toBe("CREDIT")
    expect(normalSide("INCOME")).toBe("CREDIT")
  })
})

describe("signedBalance", () => {
  it("reads a cash account as debit minus credit", () => {
    expect(signedBalance("ASSET", D("614845.00"), D("0")).toFixed(2)).toBe("614845.00")
  })

  it("reads a payable as credit minus debit", () => {
    expect(signedBalance("LIABILITY", D("0"), D("40635.00")).toFixed(2)).toBe("40635.00")
  })

  it("reports a negative retained earnings as negative, not as an absolute", () => {
    // The FY2024-25 accounts carry Retained Earnings of (256,935).
    expect(signedBalance("EQUITY", D("256935.00"), D("0")).toFixed(2)).toBe("-256935.00")
  })

  it("reads accumulated depreciation, an ASSET with a credit balance, as negative", () => {
    expect(signedBalance("ASSET", D("0"), D("29650.00")).toFixed(2)).toBe("-29650.00")
  })
})

describe("invertLines", () => {
  it("swaps every debit and credit on a four-leg journal and keeps the rest", () => {
    const inverted = invertLines([
      { debit: D("500000.00"), credit: D(0), accountId: "a", sortOrder: 0 },
      { debit: D("20000.00"), credit: D(0), accountId: "b", sortOrder: 1 },
      { debit: D(0), credit: D("30000.00"), accountId: "c", sortOrder: 2 },
      { debit: D(0), credit: D("490000.00"), accountId: "d", sortOrder: 3 },
    ])

    expect(inverted.map((l) => l.debit.toFixed(2))).toEqual([
      "0.00",
      "0.00",
      "30000.00",
      "490000.00",
    ])
    expect(inverted.map((l) => l.credit.toFixed(2))).toEqual([
      "500000.00",
      "20000.00",
      "0.00",
      "0.00",
    ])
    expect(inverted.map((l) => l.accountId)).toEqual(["a", "b", "c", "d"])
    expect(inverted.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3])
  })

  it("produces a journal that is still balanced", () => {
    const original = [line("520000.00", 0), line(0, "520000.00")]

    expect(() => assertBalanced(invertLines(original))).not.toThrow()
  })
})

describe("utcDate and monthWindow", () => {
  it("builds UTC midnight, not local midnight", () => {
    expect(utcDate(2026, 7, 1).toISOString()).toBe("2026-07-01T00:00:00.000Z")
  })

  it("ends a 31-day month on the 31st", () => {
    const { startDate, endDate } = monthWindow(2026, 7)

    expect(startDate.toISOString()).toBe("2026-07-01T00:00:00.000Z")
    expect(endDate.toISOString()).toBe("2026-07-31T00:00:00.000Z")
  })

  it("ends February on the 28th in a common year and the 29th in a leap year", () => {
    expect(monthWindow(2026, 2).endDate.toISOString()).toBe("2026-02-28T00:00:00.000Z")
    expect(monthWindow(2028, 2).endDate.toISOString()).toBe("2028-02-29T00:00:00.000Z")
  })
})

describe("financialYearPeriods", () => {
  it("generates twelve months from July 2026 to June 2027, crossing the calendar year", () => {
    const periods = financialYearPeriods(utcDate(2026, 7, 1))

    expect(periods).toHaveLength(12)
    expect(periods[0]).toMatchObject({ year: 2026, month: 7 })
    expect(periods[5]).toMatchObject({ year: 2026, month: 12 })
    expect(periods[6]).toMatchObject({ year: 2027, month: 1 })
    expect(periods[11]).toMatchObject({ year: 2027, month: 6 })
  })

  it("gives the last period an end date of 30 June", () => {
    const periods = financialYearPeriods(utcDate(2026, 7, 1))

    expect(periods[11].endDate.toISOString()).toBe("2027-06-30T00:00:00.000Z")
  })

  it("works for a calendar-year start too, so nothing assumes a July offset", () => {
    const periods = financialYearPeriods(utcDate(2026, 1, 1))

    expect(periods[0]).toMatchObject({ year: 2026, month: 1 })
    expect(periods[11]).toMatchObject({ year: 2026, month: 12 })
  })
})

describe("toLedgerDate", () => {
  it("drops the time of day", () => {
    expect(toLedgerDate(new Date("2026-07-31T10:34:56.789Z")).toISOString()).toBe(
      "2026-07-31T00:00:00.000Z"
    )
  })

  it("leaves a date that is already UTC midnight alone", () => {
    expect(toLedgerDate(utcDate(2026, 7, 31)).toISOString()).toBe("2026-07-31T00:00:00.000Z")
  })

  it("keeps the last day of a month inside its own period", () => {
    // The bug this exists for: 31 July at 10:00 is *greater* than the July
    // period's endDate of 31 July at 00:00, so resolveOpenPeriod would answer
    // "no financial year covers 2026-07-31" for a perfectly valid date.
    const july = monthWindow(2026, 7)
    const stamped = new Date("2026-07-31T10:00:00.000Z")

    expect(stamped > july.endDate).toBe(true)
    expect(toLedgerDate(stamped) <= july.endDate).toBe(true)
  })

  it("truncates in UTC, the convention every other date in this module uses", () => {
    // 23:30 UTC on 30 June is still 30 June here, whatever the local clock says.
    expect(toLedgerDate(new Date("2026-06-30T23:30:00.000Z")).toISOString()).toBe(
      "2026-06-30T00:00:00.000Z"
    )
  })
})

describe("financialYearName", () => {
  it("names a July start as a straddling year", () => {
    expect(financialYearName(utcDate(2026, 7, 1))).toBe("FY 2026-27")
  })

  it("names a January start as a single year", () => {
    expect(financialYearName(utcDate(2026, 1, 1))).toBe("FY 2026")
  })

  it("straddles a century boundary without producing FY 2099-00", () => {
    expect(financialYearName(utcDate(2099, 7, 1))).toBe("FY 2099-00")
  })
})
