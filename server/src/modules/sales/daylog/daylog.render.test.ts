import { describe, expect, it } from "vitest"

import { buildDays, dayLabel, periodLabel, renderDayLogHtml, summaryLine, type DayLog, type DayLogDay } from "./daylog.render"

const OPTIONS = { companyName: "Byte Spate", logo: null, madeOn: "2026-11-10" }

const empty = { tasks: [], meetings: [], closed: [] }

const busy: Omit<DayLogDay, "date"> = {
  tasks: [{ title: "Sent the quote", type: "QUOTATION_SENT", about: "Bengal Group · OPP-0012", detail: "Spoke to the IT head", outcome: "They will reply on Sunday" }],
  meetings: [{ time: "11:30", title: "Firewall review", accountName: "Bengal Group", opportunitySerial: null, outcome: null }],
  closed: [{ status: "WON", serial: "OPP-0012", name: "Firewall Upgrade", accountName: "Bengal Group", amount: "5,20,000.00", reason: null }],
}

describe("dayLabel and periodLabel", () => {
  it("writes the weekday and the long date", () => {
    expect(dayLabel("2026-11-10")).toBe("Tuesday, 10 November 2026")
  })

  it("writes one day as the day, and a range with 'to'", () => {
    expect(periodLabel("2026-11-10", "2026-11-10")).toBe("Tuesday, 10 November 2026")
    expect(periodLabel("2026-11-07", "2026-11-13")).toBe("7 November 2026 to 13 November 2026")
  })
})

describe("buildDays", () => {
  it("always shows a single day, even when nothing is on it", () => {
    // 2026-11-13 is a Friday.
    expect(buildDays("2026-11-13", "2026-11-13", new Map())).toEqual([{ date: "2026-11-13", ...empty }])
  })

  it("shows Sunday to Thursday of a week, and Friday or Saturday only with work on them", () => {
    const days = buildDays("2026-11-07", "2026-11-13", new Map([["2026-11-13", busy]]))
    expect(days.map((d) => d.date)).toEqual([
      "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
    ])
    expect(days.at(-1)).toEqual({ date: "2026-11-13", ...busy })
  })
})

describe("summaryLine", () => {
  it("counts only what is there", () => {
    expect(summaryLine([{ date: "2026-11-10", ...busy }])).toBe("1 task done, 1 meeting, 1 Opportunity won")
  })

  it("says so when nothing was logged", () => {
    expect(summaryLine([{ date: "2026-11-10", ...empty }])).toBe("Nothing logged")
  })
})

describe("renderDayLogHtml", () => {
  const log: DayLog = { personName: "Rahim Uddin", from: "2026-11-10", to: "2026-11-10", days: [{ date: "2026-11-10", ...busy }] }

  it("prints the person, the day and every item", () => {
    const html = renderDayLogHtml(log, OPTIONS)
    expect(html).toContain("Work log")
    expect(html).toContain("Rahim Uddin")
    expect(html).toContain("Tuesday, 10 November 2026")
    expect(html).toContain("Sent the quote")
    expect(html).toContain("Quotation sent")
    expect(html).toContain("Spoke to the IT head")
    expect(html).toContain("They will reply on Sunday")
    expect(html).toContain("Firewall review")
    expect(html).toContain("11:30")
    expect(html).toContain("OPP-0012 Firewall Upgrade")
    expect(html).toContain("৳ 5,20,000.00")
    expect(html).toContain('class="tag won"')
  })

  it("says a day is empty instead of showing empty lists", () => {
    const html = renderDayLogHtml({ ...log, days: [{ date: "2026-11-10", ...empty }] }, OPTIONS)
    expect(html).toContain("Nothing logged on this day.")
    expect(html).not.toContain("Tasks done (")
  })

  it("escapes what people typed", () => {
    const html = renderDayLogHtml(
      { ...log, days: [{ date: "2026-11-10", ...empty, tasks: [{ title: "<script>x</script>", type: "OTHER", about: null, detail: null, outcome: null }] }] },
      OPTIONS
    )
    expect(html).not.toContain("<script>x</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
