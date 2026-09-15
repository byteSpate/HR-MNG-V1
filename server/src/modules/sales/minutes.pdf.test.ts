import { describe, expect, it } from "vitest"

import { contentDisposition, minutesFileName, renderMinutesHtml, type MinutesDocument } from "./minutes.pdf"

const COMPANY = "Bytespate Limited"
const OPTIONS = { draft: false, companyName: COMPANY, timeZone: "Asia/Dhaka" }

/** The APS Group minutes of 24 Aug 2026, at 11:00 to 12:00 in Dhaka (05:00 to 06:00 UTC). */
const doc = (overrides: Partial<MinutesDocument> = {}): MinutesDocument => ({
  accountName: "APS Group",
  meetingTitle: "Introduction to our services",
  scheduledAt: new Date("2026-08-24T05:00:00.000Z"),
  endsAt: new Date("2026-08-24T06:00:00.000Z"),
  mode: "CUSTOMER_SITE",
  location: "APS Group Corporate Office, Uttara, Dhaka",
  meetingWithNote: "IT Department",
  arrangedBy: "Md. Omor Ali",
  purpose: "Introduce our services",
  attendees: [
    { side: "OURS", name: "Md. Omor Ali", designation: "Pre-Sales Engineer" },
    { side: "THEIRS", name: "Md. Salim Reza", designation: "Deputy Manager – IT" },
  ],
  sections: [
    { heading: "Meeting Summary", kind: "PARAGRAPHS", content: { paragraphs: ["A meeting was **conducted**."] } },
    {
      heading: "Key Discussion Points",
      kind: "SUBTOPICS",
      content: {
        topics: [
          {
            title: "Network Infrastructure",
            text: "",
            bullets: [{ text: "Two key applications:", sub: ["ERP System", "Payment System"] }],
          },
          { title: "Client Feedback", text: "Positive feedback.", bullets: [] },
        ],
      },
    },
    {
      heading: "Next Steps",
      kind: "TABLE",
      content: {
        rows: [
          { actionItem: "Share the proposal", responsible: "Bytespate Limited", status: "Open", taskId: null },
          { actionItem: "Arrange a demo", responsible: "Both Parties", status: "Planned", taskId: null },
        ],
      },
    },
    { heading: "Meeting Outcome", kind: "PARAGRAPHS", content: { paragraphs: ["Productive."] } },
  ],
  preparers: [{ name: "Md. Omor Ali", title: "Pre-Sales Engineer", extra: "(Cloud & Cybersecurity)" }],
  ...overrides,
})

/** Where each piece of text first appears, so a test can say "this comes before that". */
const positions = (html: string, parts: string[]) => parts.map((part) => html.indexOf(part))
const inOrder = (values: number[]) => values.every((value, i) => value >= 0 && (i === 0 || value > values[i - 1]))

describe("the header", () => {
  it("prints the header lines of the real documents, in their order", () => {
    const html = renderMinutesHtml(doc(), OPTIONS)

    expect(
      inOrder(
        positions(html, [
          "Meeting Minutes – APS Group",
          "Introduction to our services",
          "<b>Date:</b> 24 Aug 2026",
          "<b>Time:</b> 11:00 AM – 12:00 PM",
          "<b>Location:</b> APS Group Corporate Office, Uttara, Dhaka",
          "<b>Meeting With:</b> APS Group, IT Department",
          `<b>On Behalf Of:</b> ${COMPANY}`,
          "<b>Arranged by:</b> Md. Omor Ali",
          "<b>Purpose:</b> Introduce our services",
        ])
      )
    ).toBe(true)
  })

  it("says Online for an online meeting rather than printing the link", () => {
    const html = renderMinutesHtml(doc({ mode: "ONLINE", location: "https://meet.example.com/abc" }), OPTIONS)

    expect(html).toContain("<b>Location:</b> Online")
    expect(html).not.toContain("meet.example.com")
  })

  it("leaves out a line the meeting has nothing for", () => {
    const html = renderMinutesHtml(
      doc({ endsAt: null, location: null, purpose: null, meetingWithNote: null, arrangedBy: null }),
      OPTIONS
    )

    expect(html).toContain("<b>Time:</b> 11:00 AM<")
    expect(html).toContain("<b>Meeting With:</b> APS Group<")
    expect(html).not.toContain("Location:")
    expect(html).not.toContain("Purpose:")
    expect(html).not.toContain("Arranged by:")
  })
})

describe("the attendees", () => {
  it("groups them From the account first, then From the company, as Name (Designation)", () => {
    const html = renderMinutesHtml(
      doc({
        attendees: [
          { side: "OURS", name: "Md. Omor Ali", designation: "Pre-Sales Engineer" },
          { side: "THEIRS", name: "Md. Salim Reza", designation: "Deputy Manager – IT" },
          { side: "THEIRS", name: "Guest", designation: null },
        ],
      }),
      OPTIONS
    )

    expect(
      inOrder(
        positions(html, [
          "From APS Group:",
          "Md. Salim Reza (Deputy Manager – IT)",
          `From ${COMPANY}:`,
          "Md. Omor Ali (Pre-Sales Engineer)",
        ])
      )
    ).toBe(true)
    expect(html).toContain("<li>Guest</li>")
  })
})

describe("the sections", () => {
  const html = renderMinutesHtml(doc(), OPTIONS)

  it("numbers sections by position, and sub-topics under their section", () => {
    expect(
      inOrder(
        positions(html, [
          "1. Meeting Summary",
          "2. Key Discussion Points",
          "2.1 Network Infrastructure",
          "2.2 Client Feedback",
          "3. Next Steps",
          "4. Meeting Outcome",
        ])
      )
    ).toBe(true)
  })

  it("prints bold, and the second level of bullets", () => {
    expect(html).toContain("A meeting was <strong>conducted</strong>.")
    expect(html).toMatch(/Two key applications:<ul class="sub"><li>ERP System<\/li><li>Payment System<\/li><\/ul>/)
  })

  it("prints the Next Steps table with its fixed columns and a serial number per row", () => {
    expect(
      inOrder(positions(html, ["<th>SL</th>", "<th>Action Item</th>", "<th>Responsible Person/Team</th>", "<th>Status</th>"]))
    ).toBe(true)
    expect(html).toMatch(/<td>1<\/td><td>Share the proposal<\/td><td>Bytespate Limited<\/td><td>Open<\/td>/)
    expect(html).toMatch(/<td>2<\/td><td>Arrange a demo<\/td>/)
  })

  it("skips a section with nothing in it", () => {
    const empty = renderMinutesHtml(
      doc({ sections: [{ heading: "Client Feedback", kind: "BULLETS", content: { bullets: [] } }] }),
      OPTIONS
    )
    expect(empty).not.toContain("Client Feedback")
  })
})

describe("prepared by, the draft mark, and escaping", () => {
  it("names who prepared it with their title, the extra line and the company", () => {
    const html = renderMinutesHtml(doc(), OPTIONS)
    // From "Prepared by" on: the title and the company are printed higher up too.
    const tail = html.slice(html.indexOf("Prepared by"))
    expect(
      inOrder(positions(tail, ["Prepared by", "Md. Omor Ali</b>", "Pre-Sales Engineer", "(Cloud &amp; Cybersecurity)", COMPANY]))
    ).toBe(true)
  })

  it("marks a preview DRAFT and a copy for sending not", () => {
    expect(renderMinutesHtml(doc(), { ...OPTIONS, draft: true })).toContain('class="draft"')
    expect(renderMinutesHtml(doc(), OPTIONS)).not.toContain('class="draft"')
  })

  it("escapes what people typed", () => {
    const html = renderMinutesHtml(doc({ accountName: "<img src=x>", purpose: "<script>" }), OPTIONS)
    expect(html).not.toContain("<img src=x>")
    expect(html).not.toContain("<script>")
  })
})

describe("the file name", () => {
  it("is Meeting Minutes – account – date, as the team names them", () => {
    expect(minutesFileName("APS Group", new Date("2026-08-24T05:00:00.000Z"), "Asia/Dhaka")).toBe(
      "Meeting Minutes – APS Group – 24 Aug 2026.pdf"
    )
  })

  it("travels in the download header as typed, with a plain fallback, because a header cannot hold the dash", () => {
    expect(contentDisposition("attachment", "Meeting Minutes – APS Group – 24 Aug 2026.pdf")).toBe(
      "attachment; filename=\"Meeting Minutes - APS Group - 24 Aug 2026.pdf\"; " +
        "filename*=UTF-8''Meeting%20Minutes%20%E2%80%93%20APS%20Group%20%E2%80%93%2024%20Aug%202026.pdf"
    )
  })

  it("takes out characters a file name cannot hold", () => {
    expect(minutesFileName('A/B: "C"', new Date("2026-08-24T05:00:00.000Z"), "Asia/Dhaka")).toBe(
      "Meeting Minutes – A-B- -C- – 24 Aug 2026.pdf"
    )
  })
})
