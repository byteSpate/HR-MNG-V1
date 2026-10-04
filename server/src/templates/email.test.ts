import { describe, expect, it, vi } from "vitest"

vi.mock("../config/env", () => ({
  env: { COMPANY_NAME: "byteSpate" },
}))

import { LOGO_CID, esc, renderEmail, serialFor, type EmailParts } from "./email"

const base: EmailParts = {
  serial: "PC-LV-3F2A81B4",
  subject: "Your leave was approved",
  stamp: { label: "Approved", tone: "approved" },
  footer: "You got this email because you asked for leave.",
}

describe("renderEmail", () => {
  it("shows the logo through the shared content id, with the company name as its text", () => {
    const html = renderEmail(base)
    expect(html).toContain(`src="cid:${LOGO_CID}"`)
    expect(html).toContain('alt="byteSpate"')
  })

  it("lets a preview swap the logo source without touching the markup", () => {
    const html = renderEmail(base, { logoSrc: "data:image/png;base64,AAAA" })
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).not.toContain("cid:")
  })

  it("draws the red, blue and green stripe from the brochure cover", () => {
    const html = renderEmail(base)
    for (const colour of ["#E23B2E", "#3B63B8", "#3FAE5A"]) {
      expect(html).toContain(colour)
    }
  })

  it("puts the subject in the navy panel and the state in a pill", () => {
    const html = renderEmail(base)
    expect(html).toContain("Your leave was approved")
    expect(html).toContain("Approved")
    expect(html).toContain("#1B3A82")
  })

  it("prints the reference number in the footer", () => {
    expect(renderEmail(base)).toContain("Ref PC-LV-3F2A81B4")
  })

  it("renders facts as rows with the value on the right", () => {
    const html = renderEmail({ ...base, facts: [{ label: "Days", value: "3" }] })
    expect(html).toContain("Days")
    expect(html).toMatch(/text-align:right[^>]*>3</)
  })

  it("renders money rows and a net total", () => {
    const html = renderEmail({
      ...base,
      money: {
        rows: [{ label: "Basic", value: "BDT 50,000.00" }],
        netLabel: "Net pay",
        netValue: "BDT 48,000.00",
      },
    })
    expect(html).toContain("BDT 50,000.00")
    expect(html).toContain("Net pay")
    expect(html).toContain("BDT 48,000.00")
  })

  it("renders one button with its link and note, and none when there is no action", () => {
    const withAction = renderEmail({
      ...base,
      action: { label: "Open leave", href: "https://app.example.com/leave", note: "It takes a minute." },
    })
    expect(withAction).toContain('href="https://app.example.com/leave"')
    expect(withAction).toContain("Open leave")
    expect(withAction).toContain("It takes a minute.")
    expect(renderEmail(base)).not.toContain("<a ")
  })

  it("renders the notice and the preheader only when given", () => {
    const html = renderEmail({ ...base, notice: "Not you? Tell HR.", preheader: "Leave approved" })
    expect(html).toContain("Not you? Tell HR.")
    expect(html).toContain("Leave approved")
    expect(renderEmail(base)).not.toContain("Not you?")
  })

  it("escapes every dynamic string, attributes included", () => {
    const html = renderEmail({
      ...base,
      subject: "<script>alert(1)</script>",
      intro: "A & B",
      facts: [{ label: "<b>x</b>", value: '"q"' }],
      action: { label: "Go", href: 'https://x.test/?a="1"&b=2' },
      footer: "<i>f</i>",
    })
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("<b>x</b>")
    expect(html).not.toContain("<i>f</i>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("A &amp; B")
    expect(html).toContain('href="https://x.test/?a=&quot;1&quot;&amp;b=2"')
  })

  it("supports phones and dark mode", () => {
    const html = renderEmail(base)
    expect(html).toContain('name="viewport"')
    expect(html).toContain("prefers-color-scheme: dark")
    expect(html).toContain("max-width")
  })

  it("keeps the old subject line wording out of the page", () => {
    expect(renderEmail(base)).not.toContain("Subject:")
  })
})

describe("esc", () => {
  it("escapes the five HTML characters", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;")
  })
})

describe("serialFor", () => {
  it("uses a short code per kind and the entity id when there is one", () => {
    expect(serialFor("PAYSLIP", "abcd-1234-ef56")).toBe("PC-PS-ABCD1234")
  })
})
