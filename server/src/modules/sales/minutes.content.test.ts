import { describe, expect, it } from "vitest"

import {
  DEFAULT_TEMPLATE,
  RICH_HIGHLIGHTS,
  cleanContent,
  hasContent,
  inlineHtml,
  sectionInputSchema,
  sectionsFromTemplate,
  templateSchema,
} from "./minutes.content"

const BULLETS = { bullets: [{ text: "ERP System", sub: ["Payment System"] }] }

describe("what a section may hold", () => {
  it("accepts each kind's own shape", () => {
    const inputs = [
      { heading: "Meeting Summary", kind: "PARAGRAPHS", content: { paragraphs: ["A meeting was held."] } },
      { heading: "Next Steps", kind: "BULLETS", content: BULLETS },
      {
        heading: "Key Discussion Points",
        kind: "SUBTOPICS",
        content: { topics: [{ title: "Network", text: "", bullets: BULLETS.bullets }] },
      },
      {
        heading: "Next Steps",
        kind: "TABLE",
        content: { rows: [{ actionItem: "Send the quote", responsible: "Bytespate Limited", status: "Open", taskId: null }] },
      },
    ]
    for (const input of inputs) expect(sectionInputSchema.safeParse(input).success).toBe(true)
  })

  it("refuses content shaped for another kind", () => {
    expect(sectionInputSchema.safeParse({ heading: "Summary", kind: "PARAGRAPHS", content: BULLETS }).success).toBe(false)
  })

  it("keeps bullets two levels deep and no deeper", () => {
    const deeper = { bullets: [{ text: "Network", sub: [{ text: "Core", sub: ["Access"] }] }] }
    expect(sectionInputSchema.safeParse({ heading: "Points", kind: "BULLETS", content: deeper }).success).toBe(false)
  })

  it("keeps a Next Steps row to its fixed columns", () => {
    const parsed = sectionInputSchema.parse({
      heading: "Next Steps",
      kind: "TABLE",
      content: { rows: [{ actionItem: "Demo", responsible: "Both Parties", status: "Open", owner: "Rahim" }] },
    })
    const row = (parsed.content as { rows: Record<string, unknown>[] }).rows[0]
    expect(Object.keys(row).sort()).toEqual(["actionItem", "responsible", "status", "taskId"])
    expect(row.taskId).toBeNull()
  })

  it("needs a heading", () => {
    expect(sectionInputSchema.safeParse({ heading: "  ", kind: "PARAGRAPHS", content: { paragraphs: [] } }).success).toBe(false)
  })
})

describe("cleaning what was typed", () => {
  it("drops empty paragraphs, bullets, topics and rows, and keeps the rest in order", () => {
    expect(cleanContent("PARAGRAPHS", { paragraphs: ["", "One", "  ", "Two"] })).toEqual({ paragraphs: ["One", "Two"] })
    expect(
      cleanContent("BULLETS", { bullets: [{ text: "", sub: [] }, { text: "Kept", sub: ["", "Sub"] }] })
    ).toEqual({ bullets: [{ text: "Kept", sub: ["Sub"] }] })
    expect(
      cleanContent("SUBTOPICS", {
        topics: [
          { title: "", text: "", bullets: [] },
          { title: "Network", text: "", bullets: [{ text: "", sub: [] }] },
        ],
      })
    ).toEqual({ topics: [{ title: "Network", text: "", bullets: [] }] })
    expect(
      cleanContent("TABLE", {
        rows: [
          { actionItem: "", responsible: "", status: "", taskId: null },
          { actionItem: "Demo", responsible: "", status: "", taskId: null },
        ],
      })
    ).toEqual({ rows: [{ actionItem: "Demo", responsible: "", status: "", taskId: null }] })
  })

  it("keeps a bullet with no text of its own when it has sub-points", () => {
    expect(cleanContent("BULLETS", { bullets: [{ text: "", sub: ["ERP"] }] })).toEqual({
      bullets: [{ text: "", sub: ["ERP"] }],
    })
  })
})

describe("the template", () => {
  it("defaults to the four sections the real documents use", () => {
    expect(DEFAULT_TEMPLATE.map((section) => [section.heading, section.kind])).toEqual([
      ["Meeting Summary", "PARAGRAPHS"],
      ["Key Discussion Points", "SUBTOPICS"],
      ["Next Steps", "TABLE"],
      ["Meeting Outcome", "PARAGRAPHS"],
    ])
    expect(DEFAULT_TEMPLATE.filter((section) => section.startsWithOutcome).map((s) => s.heading)).toEqual([
      "Meeting Outcome",
    ])
  })

  it("starts new minutes from the template, with the outcome note in the marked section", () => {
    const sections = sectionsFromTemplate(DEFAULT_TEMPLATE, "Productive. They want a demo.")

    expect(sections.map((section) => section.order)).toEqual([0, 1, 2, 3])
    expect(sections[0].content).toEqual({ paragraphs: [] })
    expect(sections[1].content).toEqual({ topics: [] })
    expect(sections[2].content).toEqual({ rows: [] })
    expect(sections[3]).toMatchObject({
      heading: "Meeting Outcome",
      content: { paragraphs: ["Productive. They want a demo."] },
    })
  })

  it("leaves the outcome section empty when the meeting has no note", () => {
    expect(sectionsFromTemplate(DEFAULT_TEMPLATE, null)[3].content).toEqual({ paragraphs: [] })
  })

  it("refuses a template with no sections, a blank heading, or a misplaced outcome mark", () => {
    const ok = { sections: [{ heading: "Summary", kind: "PARAGRAPHS", startsWithOutcome: true }] }
    expect(templateSchema.safeParse(ok).success).toBe(true)

    expect(templateSchema.safeParse({ sections: [] }).success).toBe(false)
    expect(templateSchema.safeParse({ sections: [{ heading: " ", kind: "PARAGRAPHS" }] }).success).toBe(false)
    expect(
      templateSchema.safeParse({
        sections: [
          { heading: "Summary", kind: "PARAGRAPHS", startsWithOutcome: true },
          { heading: "Outcome", kind: "PARAGRAPHS", startsWithOutcome: true },
        ],
      }).success
    ).toBe(false)
    expect(
      templateSchema.safeParse({ sections: [{ heading: "Next Steps", kind: "TABLE", startsWithOutcome: true }] }).success
    ).toBe(false)
  })
})

describe("bold, and only bold", () => {
  it("turns **words** into bold and escapes everything else", () => {
    expect(inlineHtml("The **ERP** team <script>alert(1)</script> & co")).toBe(
      "The <strong>ERP</strong> team &lt;script&gt;alert(1)&lt;/script&gt; &amp; co"
    )
  })

  it("leaves a lone pair of stars as typed", () => {
    expect(inlineHtml("5 ** 2")).toBe("5 ** 2")
  })
})

describe("formatted text (owner's change, 2026-09-15)", () => {
  const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) })
  const paragraph = (...content: unknown[]) => ({ type: "paragraph", content })
  /** One of everything the toolbar makes, in the shape the editor saves. */
  const EVERYTHING = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3, textAlign: "left" }, content: [text("Network")] },
      {
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [
          text("Bold", [{ type: "bold" }]),
          text(" italic", [{ type: "italic" }]),
          text(" under", [{ type: "underline" }]),
          text(" struck", [{ type: "strike" }]),
          text(" marked", [{ type: "highlight", attrs: { color: RICH_HIGHLIGHTS.yellow } }]),
          text(" portal", [{ type: "link", attrs: { href: "https://example.com", target: "_blank", rel: null, class: null } }]),
          { type: "hardBreak" },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              paragraph(text("ERP")),
              { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("Payment"))] }] },
            ],
          },
        ],
      },
      { type: "orderedList", attrs: { start: 1, type: null }, content: [{ type: "listItem", content: [paragraph(text("First"))] }] },
      { type: "horizontalRule" },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragraph(text("Site"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragraph(text("Uttara"))] }] },
        ],
      },
    ],
  }
  const rich = (doc: unknown) => sectionInputSchema.safeParse({ heading: "Notes", kind: "RICH", content: doc })

  it("accepts every tool the toolbar has", () => {
    expect(rich(EVERYTHING).success).toBe(true)
  })

  it("refuses anything that is not on the list", () => {
    expect(rich({ type: "doc", content: [{ type: "image", attrs: { src: "x.png" } }] }).success).toBe(false)
    expect(rich({ type: "doc", content: [paragraph(text("x", [{ type: "code" }]))] }).success).toBe(false)
    expect(rich({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [text("Big")] }] }).success).toBe(false)
    expect(rich({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "diagonal" } }] }).success).toBe(false)
  })

  it("refuses a link that is not a web or mail address, and a highlight that is not on the palette", () => {
    const link = (href: string) => ({ type: "doc", content: [paragraph(text("x", [{ type: "link", attrs: { href } }]))] })
    expect(rich(link("javascript:alert(1)")).success).toBe(false)
    expect(rich(link("mailto:salim@example.com")).success).toBe(true)
    const highlight = (color: string) => ({ type: "doc", content: [paragraph(text("x", [{ type: "highlight", attrs: { color } }]))] })
    expect(rich(highlight("red")).success).toBe(false)
  })

  it("says whether there is anything to print", () => {
    expect(hasContent("RICH", { type: "doc", content: [{ type: "paragraph" }] } as never)).toBe(false)
    expect(hasContent("RICH", EVERYTHING as never)).toBe(true)
  })

  it("can start with the outcome note, and the template may mark it for that", () => {
    const [section] = sectionsFromTemplate([{ heading: "Outcome", kind: "RICH", startsWithOutcome: true }] as never, "Productive.")
    expect(section.content).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Productive." }] }] })
    expect(sectionsFromTemplate([{ heading: "Outcome", kind: "RICH" }] as never, null)[0].content).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    })
    expect(templateSchema.safeParse({ sections: [{ heading: "Outcome", kind: "RICH", startsWithOutcome: true }] }).success).toBe(true)
  })
})
