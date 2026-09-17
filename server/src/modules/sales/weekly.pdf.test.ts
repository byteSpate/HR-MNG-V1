import { describe, expect, it } from "vitest"

import { renderWeeklyHtml, weeklyFileName, type WeeklyDocument } from "./weekly.pdf"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

const row = (overrides: Record<string, unknown> = {}) => ({
  salesAccountId: "acc-1",
  accountName: "Bengal Group",
  deals: [
    {
      id: "opp-1",
      serial: "BS-OPP-00001",
      name: "Firewall Upgrade",
      requirement: "Cisco C9300 × 2",
      softwareNeeded: true,
      nextStep: "Send the revised quotation",
    },
  ],
  requirement: "Cisco C9300 × 2",
  visited: ["Call: Asked about the quote"],
  pendingTasks: [{ id: "task-1", title: "Submit the quotation", dueOn: day("2026-09-20") }],
  challenges: "He was sick",
  gap: "No company profile to send",
  nextStep: null,
  taskId: null,
  ...overrides,
})

const document = (overrides: Partial<WeeklyDocument> = {}): WeeklyDocument => ({
  fullName: "Rahim",
  designation: "Pre-Sales Engineer",
  weekStart: day("2026-09-13"),
  weekEnd: day("2026-09-17"),
  status: "SUBMITTED",
  submittedLate: false,
  submittedAt: new Date("2026-09-17T11:42:00.000Z"),
  updatedAt: null,
  counts: { accounts: 1, communications: 1, meetings: 0, dealChanges: 0, tasksDone: 0 },
  days: [
    { date: day("2026-09-13"), label: null, accounts: [row()], otherWork: [] },
    {
      date: day("2026-09-16"),
      label: { kind: "HOLIDAY", text: "Eid-e-Milad" },
      accounts: [],
      otherWork: [],
    },
    {
      date: day("2026-09-17"),
      label: null,
      accounts: [],
      otherWork: [{ id: "ow-1", date: day("2026-09-17"), text: "Office discussion" }],
    },
  ],
  logo: null,
  companyName: "Bytespate Limited",
  timeZone: "Asia/Dhaka",
  ...overrides,
})

describe("renderWeeklyHtml", () => {
  it("names the person, the week and the company at the top", () => {
    const html = renderWeeklyHtml(document())
    expect(html).toContain("Weekly Report")
    expect(html).toContain("Rahim")
    expect(html).toContain("Pre-Sales Engineer")
    expect(html).toContain("13–17 Sep 2026")
    expect(html).toContain("Bytespate Limited")
  })

  it("prints the week's real counts", () => {
    const html = renderWeeklyHtml(
      document({ counts: { accounts: 3, communications: 7, meetings: 2, dealChanges: 1, tasksDone: 4 } })
    )
    for (const [figure, caption] of [
      ["3", "Accounts worked on"],
      ["7", "Calls and messages"],
      ["2", "Meetings"],
      ["1", "Deals changed"],
      ["4", "Tasks done"],
    ]) {
      expect(html).toContain(caption)
      expect(html).toContain(`<div class="count">${figure}</div>`)
    }
  })

  it("prints the days in order, each as its own band", () => {
    const html = renderWeeklyHtml(document())
    const positions = ["Sunday 13 Sep", "Wednesday 16 Sep", "Thursday 17 Sep"].map((label) =>
      html.indexOf(label)
    )
    expect(positions.every((position) => position > -1)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it("fills a row with the team's own columns", () => {
    const html = renderWeeklyHtml(document())
    expect(html).toContain("Bengal Group")
    expect(html).toContain("<strong>Firewall Upgrade</strong>")
    expect(html).toContain("Cisco C9300 × 2")
    expect(html).toContain("Call: Asked about the quote")
    expect(html).toContain("Submit the quotation")
    expect(html).toContain("He was sick")
    expect(html).toContain("No company profile to send")
    expect(html).toContain("Send the revised quotation")
    expect(html).toContain('<span class="badge yes">Yes</span>')
  })

  it("says when there is no requirement, and leaves Application blank", () => {
    const html = renderWeeklyHtml(
      document({
        days: [
          {
            date: day("2026-09-13"),
            label: null,
            accounts: [row({ deals: [], requirement: "No open requirement", nextStep: "Meet the IT team" })],
            otherWork: [],
          },
        ],
      })
    )
    expect(html).toContain("No open requirement")
    expect(html).toContain("Meet the IT team")
    expect(html).not.toContain('<span class="badge yes">')
  })

  it("marks a holiday day with its own colour and prints it empty", () => {
    const html = renderWeeklyHtml(document())
    expect(html).toContain('class="day off"')
    expect(html).toContain("Eid-e-Milad")
  })

  it("prints Other work under its day", () => {
    const html = renderWeeklyHtml(document())
    expect(html).toContain("Other work")
    expect(html).toContain("Office discussion")
  })

  it("says Submitted late only when it was", () => {
    expect(renderWeeklyHtml(document({ submittedLate: true }))).toContain("Submitted late")
    expect(renderWeeklyHtml(document())).not.toContain("Submitted late")
  })

  it("says when a submitted week was added to and sent again", () => {
    const html = renderWeeklyHtml(document({ updatedAt: new Date("2026-09-19T05:00:00.000Z") }))
    expect(html).toContain("Updated 19 Sep 2026")
  })

  it("prints the logo when there is one, and holds its place when there is not", () => {
    expect(renderWeeklyHtml(document({ logo: "data:image/png;base64,AAAA" }))).toContain(
      '<img class="logo" src="data:image/png;base64,AAAA"'
    )
    expect(renderWeeklyHtml(document())).not.toContain('<img class="logo"')
  })

  it("escapes everything a person typed", () => {
    const html = renderWeeklyHtml(
      document({
        days: [
          {
            date: day("2026-09-13"),
            label: null,
            accounts: [row({ challenges: "<script>alert(1)</script>" })],
            otherWork: [],
          },
        ],
      })
    )
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})

describe("weeklyFileName", () => {
  it("is Weekly Report – name – the week", () => {
    expect(weeklyFileName("Rahim", day("2026-09-13"), day("2026-09-17"), "Asia/Dhaka")).toBe(
      "Weekly Report – Rahim – 13–17 Sep 2026.pdf"
    )
  })

  it("keeps the month on both sides when the week crosses one", () => {
    expect(weeklyFileName("Rahim", day("2026-09-27"), day("2026-10-01"), "Asia/Dhaka")).toBe(
      "Weekly Report – Rahim – 27 Sep–1 Oct 2026.pdf"
    )
  })

  it("drops what a file name cannot hold", () => {
    expect(weeklyFileName('Rahim/"X"', day("2026-09-13"), day("2026-09-17"), "Asia/Dhaka")).toBe(
      "Weekly Report – Rahim--X- – 13–17 Sep 2026.pdf"
    )
  })
})
