import { describe, expect, it } from "vitest"

import { buildDays, dayLabel, paginate, periodLabel, renderDayLogHtml, summaryLine, type DayLog, type DayLogDay, type DayLogTask } from "./daylog.render"

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

const tasks = (n: number): DayLogTask[] =>
  Array.from({ length: n }, (_, i) => ({ title: `Task ${i + 1}`, type: "OTHER", about: null, detail: null, outcome: null }))

describe("paginate", () => {
  it("keeps a short day on one picture", () => {
    const pictures = paginate([{ date: "2026-11-10", tasks: tasks(5), meetings: [], closed: [] }], 8)
    expect(pictures).toHaveLength(1)
    expect(pictures[0][0].continued).toBe(false)
  })

  it("cuts a long day into pictures of 8, and marks the rest as continued", () => {
    const pictures = paginate([{ date: "2026-11-10", tasks: tasks(19), meetings: [], closed: [] }], 8)
    expect(pictures.map((p) => p[0].day.tasks.length)).toEqual([8, 8, 3])
    expect(pictures.map((p) => p[0].continued)).toEqual([false, true, true])
    expect(pictures[2][0].day.tasks[0].title).toBe("Task 17")
    // The heading count is the whole day, on every picture.
    expect(pictures[2][0].totals.tasks).toBe(19)
  })

  it("fills a picture across days, and an empty day takes no place", () => {
    const pictures = paginate(
      [
        { date: "2026-11-08", tasks: [], meetings: [], closed: [] },
        { date: "2026-11-09", tasks: tasks(6), meetings: [], closed: [] },
        { date: "2026-11-10", tasks: tasks(3), meetings: [], closed: [] },
      ],
      8
    )
    expect(pictures.map((p) => p.map((piece) => `${piece.day.date}:${piece.day.tasks.length}`))).toEqual([
      ["2026-11-08:0", "2026-11-09:6", "2026-11-10:2"],
      ["2026-11-10:1"],
    ])
  })

  it("prints which picture it is, only when there is more than one", () => {
    const long: DayLog = { personName: "Rahim Uddin", from: "2026-11-10", to: "2026-11-10", days: [{ date: "2026-11-10", tasks: tasks(10), meetings: [], closed: [] }] }
    const second = renderDayLogHtml(long, OPTIONS, 2)
    expect(second).toContain("Picture 2 of 2")
    expect(second).toContain("Tuesday, 10 November 2026 (continued)")
    expect(second).toContain("Task 9")
    expect(second).not.toContain("Task 8<")
    expect(second).toContain("Tasks done (10)")
    expect(renderDayLogHtml({ ...long, days: [{ date: "2026-11-10", tasks: tasks(2), meetings: [], closed: [] }] }, OPTIONS)).not.toContain("Picture 1 of")
  })
})

it("never makes a picture only for empty days", () => {
  const empty = (date: string) => ({ date, tasks: [], meetings: [], closed: [] })
  const pictures = paginate([empty("2026-11-08"), { date: "2026-11-09", tasks: tasks(8), meetings: [], closed: [] }, empty("2026-11-10")], 8)
  expect(pictures).toHaveLength(1)
  expect(pictures[0]).toHaveLength(3)
})
