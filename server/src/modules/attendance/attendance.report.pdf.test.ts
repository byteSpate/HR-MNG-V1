import { describe, expect, it, vi } from "vitest"

// Note what this file does NOT do: launch a browser. `renderPdf` imports
// puppeteer lazily inside itself, so nothing here starts Chromium — a leaked
// browser handle hangs vitest exactly as a leaked cron handle does. The
// document is the part worth asserting anyway; a PDF is the one output a test
// cannot really check.
vi.mock("../../config/env", () => ({
  env: { COMPANY_NAME: "Byte Spate", COMPANY_ADDRESS: "Dhaka", APP_TIMEZONE: "Asia/Dhaka" },
}))

import type { AttendanceReport, AttendanceReportDay, AttendanceReportRow } from "./attendance.report"
import {
  renderAttendanceReportHtml,
  reportFooterHtml,
  reportTypeLabel,
  shapeOf,
} from "./attendance.report.pdf"

const GENERATED = new Date("2026-08-25T09:30:00.000Z")

const AYESHA = {
  id: "emp-1",
  fullName: "Ayesha Rahman",
  employeeCode: "BS-EMP-001",
  designation: "Software Engineer",
}

function row(over: Partial<AttendanceReportRow> = {}): AttendanceReportRow {
  return {
    employee: AYESHA,
    department: "Engineering",
    workingDays: 22,
    present: 20,
    absent: 1,
    onLeave: 1,
    onPaidLeave: 1,
    onUnpaidLeave: 0,
    notCheckedIn: 0,
    late: 3,
    earlyOut: 2,
    holidays: 4,
    weeklyOffs: 4,
    workedOnOffDays: 0,
    workedHours: 160.25,
    workedHoursOnWorkingDays: 160.25,
    workingDaysFullyRecorded: 20,
    expectedHours: 176,
    expectedHoursToDate: 176,
    shortfallHours: 15.75,
    missingCheckOut: 0,
    pendingApproval: 0,
    approved: 2,
    regularised: 1,
    rejected: 0,
    ...over,
  }
}

function day(over: Partial<AttendanceReportDay> = {}): AttendanceReportDay {
  return {
    employee: AYESHA,
    department: "Engineering",
    date: "2026-08-03",
    status: "PRESENT",
    isWorkingDay: true,
    checkIn: "2026-08-03T03:14:00.000Z",
    checkOut: "2026-08-03T12:02:00.000Z",
    workedHours: 7.8,
    expectedHours: 8,
    isLate: false,
    isEarlyOut: false,
    approval: null,
    regularised: false,
    autoCheckOut: false,
    detail: null,
    ...over,
  }
}

function report(over: Partial<AttendanceReport> = {}): AttendanceReport {
  return {
    from: "2026-08-01",
    to: "2026-08-31",
    granularity: "summary",
    headcount: 1,
    rows: [row()],
    days: [],
    totals: {
      workingDays: 22,
      present: 20,
      absent: 1,
      onLeave: 1,
      notCheckedIn: 0,
      late: 3,
      earlyOut: 2,
      workedHours: 160.25,
      expectedHours: 176,
      shortfallHours: 15.75,
      missingCheckOut: 0,
      pendingApproval: 0,
    },
    ...over,
  }
}

const html = (r: AttendanceReport) =>
  renderAttendanceReportHtml(r, GENERATED, "Byte Spate", {
    logo: "data:image/png;base64,LOGO",
    timeZone: "Asia/Dhaka",
  })

/** The header's value lines, in order: type, range, generated stamp. */
const metaLines = (out: string) =>
  [...out.matchAll(/<div class="v(?: vmuted)?">([^<]*)<\/div>/g)].map((m) => m[1])

/**
 * Column headings and band figures are asserted separately on purpose: "Early
 * out" is legitimately a band total on every shape while being a *column* on
 * the range summary alone, and a bare `toContain` cannot tell them apart.
 */
const hasColumn = (out: string, label: string) => out.includes(`>${label}</th>`)
const hasFigure = (out: string, label: string) =>
  out.includes(`<span class="figl">${label}</span>`)

/** A one-day range: the same report the client asks for with `today`. */
const oneDay = (over: Partial<AttendanceReport> = {}) =>
  report({
    from: "2026-08-25",
    to: "2026-08-25",
    rows: [row()],
    days: [day({ date: "2026-08-25" })],
    ...over,
  })

describe("shapeOf", () => {
  it("treats a one-day range as its own document, whatever the granularity", () => {
    expect(shapeOf(oneDay())).toBe("single-day")
    expect(shapeOf(oneDay({ granularity: "daily" }))).toBe("single-day")
  })

  it("separates a range summary from a day-by-day range", () => {
    expect(shapeOf(report())).toBe("range-summary")
    expect(shapeOf(report({ granularity: "daily", rows: [], days: [day()] }))).toBe("day-by-day")
  })
})

describe("reportTypeLabel", () => {
  const typeOf = (from: string, to: string, granularity: "summary" | "daily" = "summary") =>
    reportTypeLabel(report({ from, to, granularity, rows: [row()], days: [day()] }))

  it("names the four periods off the range, not off a button the server never saw", () => {
    expect(typeOf("2026-08-25", "2026-08-25")).toBe("Daily")
    expect(typeOf("2026-08-22", "2026-08-28")).toBe("Weekly — per employee")
    expect(typeOf("2026-08-01", "2026-08-31")).toBe("Monthly — per employee")
  })

  // The failure that matters: a document is filed and read later, so a header
  // claiming "Monthly" over 1–20 August is a lie the reader cannot check.
  it("refuses to call a partial month Monthly", () => {
    expect(typeOf("2026-08-01", "2026-08-20")).toBe("Custom range (20 days) — per employee")
    expect(typeOf("2026-08-02", "2026-08-31")).toBe("Custom range (30 days) — per employee")
  })

  it("handles a short month, where the last day is not the 31st", () => {
    expect(typeOf("2026-02-01", "2026-02-28")).toBe("Monthly — per employee")
  })

  it("carries the granularity, since two documents share one period", () => {
    expect(typeOf("2026-08-01", "2026-08-31", "daily")).toBe("Monthly — day by day")
  })
})

describe("reportFooterHtml", () => {
  // Chrome's footer template inherits nothing from the document, so every rule
  // has to be inline and the font-size has to be stated or it renders at zero.
  it("carries the seal, the range and the page numbers, all inline-styled", () => {
    const out = reportFooterHtml(report(), "Byte Spate", "data:image/png;base64,SEAL")

    expect(out).toContain('<img src="data:image/png;base64,SEAL"')
    expect(out).toContain("font-size:7pt")
    expect(out).toContain("Byte Spate · attendance 2026-08-01 to 2026-08-31")
    expect(out).toContain('<span class="pageNumber"></span>')
    expect(out).toContain('<span class="totalPages"></span>')
    // No stylesheet reaches this document, so a class would style nothing.
    expect(out).not.toContain('class="seal"')
  })

  it("is the same running foot on every shape, and survives a missing seal", () => {
    for (const r of [report(), oneDay(), report({ granularity: "daily", rows: [], days: [day()] })]) {
      expect(reportFooterHtml(r, "Byte Spate", null)).toContain("Page <span")
    }
    expect(reportFooterHtml(report(), "Byte Spate", null)).not.toContain("<img")
  })
})

describe("renderAttendanceReportHtml", () => {
  // Branding on the left, what-this-document-is on the right.
  it("puts the logo and tagline left, and the document's facts right", () => {
    const out = html(report())

    expect(out).toContain('<img class="logo" src="data:image/png;base64,LOGO"')
    expect(out).toContain('<div class="tagline">HR and Payroll</div>')
    expect(out).toContain('<div class="metatitle">Attendance Report</div>')
    // Values only. Each line says what it is; a Type/Date/Generated column
    // beside them was three words of furniture per line.
    expect(metaLines(out)).toEqual([
      "Monthly — per employee",
      "1 August 2026 to 31 August 2026",
      "25 August 2026 at 15:30",
    ])
    expect(out).not.toContain(">Type<")
    expect(out).not.toContain(">Generated<")
    // The logo is the company name. Printing the wordmark beside it says it
    // twice.
    expect(out).not.toContain('class="company"')
  })

  // 09:30 UTC is 15:30 in Dhaka. A header stamped in UTC beside a table of
  // office-local check-in times invites the reader to read both on one clock
  // when they are six hours apart.
  it("stamps the generation time in office time, not UTC", () => {
    const out = html(report())

    expect(out).toContain("25 August 2026 at 15:30")
    expect(out).not.toContain("UTC")
    expect(out).toContain("All times are Asia/Dhaka local.")
  })

  it("takes the timezone from the caller rather than the deployment", () => {
    const utc = renderAttendanceReportHtml(report(), GENERATED, "Byte Spate", {
      timeZone: "UTC",
    })

    expect(utc).toContain("25 August 2026 at 09:30")
    expect(utc).toContain("All times are UTC local.")
  })

  // The roster size is already the first figure in the band below, where it
  // sits beside the counts it gives context to.
  it("does not repeat the employee count in the header", () => {
    const out = html(report({ headcount: 7 }))

    expect(metaLines(out)).toHaveLength(3)
    expect(hasFigure(out, "Employees")).toBe(true)
  })

  it("falls back to the company name when the logo is missing", () => {
    // A file that did not get copied must not stop anybody exporting, and must
    // not leave the document unattributed either.
    const out = renderAttendanceReportHtml(report(), GENERATED, "Byte Spate")

    expect(out).not.toContain("<img")
    expect(out).toContain('<div class="company">Byte Spate</div>')
  })

  it("keeps the seal out of the body, so it cannot float where content stops", () => {
    const out = html(report())

    expect(out).not.toContain("SEAL")
    expect(out).not.toContain("Authorised signature")
  })

  it("prints the table headings in the app's black on white", () => {
    const out = html(report())

    expect(out).toContain("background: #17191C; color: #FFFFFF")
  })

  it("names the weekday when the range is a single day", () => {
    const out = html(oneDay())

    // 25 August 2026 is a Tuesday.
    expect(out).toContain("Tuesday, 25 August 2026")
    expect(out).not.toContain("25 August 2026 to")
  })

  it("gives a single day a register, not a rollup", () => {
    const out = html(oneDay())

    expect(metaLines(out)[0]).toBe("Daily")
    // The day's facts.
    expect(hasColumn(out, "Status")).toBe(true)
    expect(out).toContain(">09:14<")
    // Rollup columns that say nothing over one day.
    expect(hasColumn(out, "Working days")).toBe(false)
    expect(hasColumn(out, "Shortfall hrs")).toBe(false)
    expect(hasColumn(out, "Holidays")).toBe(false)
    // Working days goes from the band too: over one day it is 0 or 1 per
    // person, which the status column already says.
    expect(hasFigure(out, "Working days")).toBe(false)
  })

  it("carries Holidays and Early out as columns on a range summary only", () => {
    const range = html(report())

    expect(hasColumn(range, "Holidays")).toBe(true)
    expect(hasColumn(range, "Early out")).toBe(true)
    // 4 holidays and 2 early-outs, off the row the server built.
    expect(range).toContain(">4</td>")
    expect(range).toContain(">2</td>")

    // The day-by-day table folds early-out into the notes instead. The band
    // still carries the total — that is a fact about the range either way.
    const byDay = html(report({ granularity: "daily", rows: [], days: [day()] }))
    expect(hasColumn(byDay, "Holidays")).toBe(false)
    expect(hasColumn(byDay, "Early out")).toBe(false)
    expect(hasFigure(byDay, "Early out")).toBe(true)
  })

  it("drops No check-in from every shape, table and band alike", () => {
    for (const r of [
      report(),
      oneDay(),
      report({ granularity: "daily", rows: [], days: [day()] }),
    ]) {
      expect(html(r)).not.toContain("No check-in")
      expect(html(r)).not.toContain("NO CHECK")
    }
  })

  it("shows department in its own column and designation under the name", () => {
    const out = html(report())

    expect(hasColumn(out, "Department")).toBe(true)
    expect(out).toContain('<div class="nm">Ayesha Rahman</div>')
    expect(out).toContain('<div class="ds">Software Engineer</div>')
    expect(out).toContain(">Engineering</td>")
    // Designation is no longer a column of its own — Department took it.
    expect(hasColumn(out, "Designation")).toBe(false)
  })

  // The widths once summed to 102%, which pushed the last column off the right
  // edge and printed "Shortfall hrs" as "Shortfal l hrs". Nothing about the
  // rendered HTML says so; only the arithmetic does.
  it("gives every table column widths that add up to the page", () => {
    for (const r of [
      report(),
      oneDay(),
      report({ granularity: "daily", rows: [], days: [day()] }),
    ]) {
      const widths = [...html(r).matchAll(/<col style="width:(\d+(?:\.\d+)?)%">/g)].map((m) =>
        Number(m[1])
      )
      expect(widths.length).toBeGreaterThan(0)
      expect(widths.reduce((a, b) => a + b, 0)).toBe(100)
    }
  })

  it("fixes the column widths, so a long designation cannot squeeze the code", () => {
    const out = html(report())

    expect(out).toContain("<colgroup>")
    expect(out).toContain("table-layout: fixed")
    // The code column never wraps.
    expect(out).toContain('class="l nw">BS-EMP-001</td>')
  })

  it("prints the server's totals, never a recomputed one", () => {
    const out = html(report())

    // 15.75 hours is 15h 45m. `8.7` was the same number saying nothing —
    // nobody converts 0.3 into eighteen minutes in their head.
    expect(out).toContain(">15h 45m<")
    expect(out).toContain(">20<")
  })

  describe("hours", () => {
    const worked = (value: number) =>
      html(report({ rows: [row({ workedHours: value })] })).match(
        /<td class="nw">(\d+h \d\dm)<\/td>/
      )?.[1]

    it("reads as hours and minutes, matching what the screen shows", () => {
      expect(worked(8.7)).toBe("8h 42m")
      expect(worked(0.3)).toBe("0h 18m")
      expect(worked(117)).toBe("117h 00m")
    })

    // A real measured zero is not missing data. Somebody who worked nothing
    // and somebody with no record are different facts, and collapsing them is
    // how an absence starts looking like a gap in the data.
    it("prints a measured zero, and a dash only for no data", () => {
      expect(worked(0)).toBe("0h 00m")
      const noData = html(
        report({ granularity: "daily", rows: [], days: [day({ workedHours: null })] })
      )
      expect(noData).toContain(">—<")
    })

    // Rounding the fractional part on its own turns 7.999 into "7h 60m".
    it("never prints sixty minutes", () => {
      expect(worked(7.999)).toBe("8h 00m")
      expect(worked(1.9999)).toBe("2h 00m")
    })
  })

  it("keeps the range columns readable rather than printing all 23 CSV ones", () => {
    const out = html(report())

    expect(hasColumn(out, "Working days")).toBe(true)
    // "hrs" left the heading when the value started saying it itself.
    expect(hasColumn(out, "Shortfall")).toBe(true)
    expect(hasColumn(out, "Shortfall hrs")).toBe(false)
    expect(out).not.toContain("WorkedOnOffDays")
    expect(out).not.toContain("Worked on off days")
    expect(hasColumn(out, "Weekly offs")).toBe(false)
  })

  it("folds the day flags into one note column", () => {
    const out = html(
      report({
        granularity: "daily",
        rows: [],
        days: [day({ isLate: true, autoCheckOut: true, detail: "Shift ended" })],
      })
    )

    expect(metaLines(out)[0]).toContain("day by day")
    expect(out).toContain("Late, Auto-closed, Shift ended")
    // Five Yes/No columns nobody scans are exactly what the notes column
    // replaces.
    expect(out).not.toContain(">No<")
  })

  it("shows times as office-local clock values", () => {
    const out = html(report({ granularity: "daily", rows: [], days: [day()] }))

    // 03:14 UTC is 09:14 in Dhaka — the time the person actually arrived.
    expect(out).toContain(">09:14<")
    expect(out).toContain(">18:02<")
  })

  it("escapes user data, since a name lands in the template", () => {
    const out = html(
      report({
        rows: [row({ employee: { ...AYESHA, fullName: "<script>alert(1)</script>" } })],
      })
    )

    expect(out).not.toContain("<script>alert(1)</script>")
    expect(out).toContain("&lt;script&gt;")
  })

  it("says an empty roster and an empty range are different facts", () => {
    const noEmployees = html(report({ headcount: 0, rows: [] }))
    const noRecords = html(report({ headcount: 7, rows: [] }))

    expect(noEmployees).toContain("No employees were on the roster")
    expect(noRecords).toContain("No attendance was recorded for the 7 employee(s)")
  })
})
