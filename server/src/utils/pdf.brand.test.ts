import { describe, expect, it } from "vitest"

import { BRAND_DOC_CSS, BRAND_HEADER_CSS, BRAND_STRIPE_HTML, brandDocHeaderHtml } from "./pdf.brand"

describe("brandDocHeaderHtml", () => {
  const base = { logo: "data:image/png;base64,AAAA", company: "byteSpate", title: "Payslip" }

  it("builds the stripe, the logo strip and the title panel", () => {
    const out = brandDocHeaderHtml({ ...base, lines: ["October 2026"], stamp: "4 October 2026" })

    expect(out).toContain('<div class="bd-stripe"></div>')
    expect(out).toContain('<img class="bd-logo" src="data:image/png;base64,AAAA" alt="byteSpate" />')
    expect(out).toContain('<h1 class="bd-title">Payslip</h1>')
    expect(out).toContain('<p class="bd-sub">October 2026</p>')
    expect(out).toContain('<div class="bd-mint"></div>')
    expect(out).toContain('<p class="bd-stamp">4 October 2026</p>')
    expect(out.indexOf("bd-stripe")).toBeLessThan(out.indexOf("bd-logo"))
    expect(out.indexOf("bd-logo")).toBeLessThan(out.indexOf("bd-title"))
  })

  it("prints the company name when there is no logo", () => {
    const out = brandDocHeaderHtml({ ...base, logo: null })
    expect(out).toContain('<span class="bd-word">byteSpate</span>')
    expect(out).not.toContain("<img")
  })

  it("leaves out the sub lines and the stamp when there are none", () => {
    const out = brandDocHeaderHtml(base)
    expect(out).not.toContain("bd-sub")
    expect(out).not.toContain("bd-stamp")
  })

  it("escapes what it is given", () => {
    const out = brandDocHeaderHtml({ ...base, title: "<b>x</b>", lines: ["A & B"], company: '"Q"' , logo: null })
    expect(out).not.toContain("<b>x</b>")
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(out).toContain("A &amp; B")
    expect(out).toContain("&quot;Q&quot;")
  })
})

describe("BRAND_DOC_CSS", () => {
  it("uses the brochure colours and a prefix that cannot clash with a document's own rules", () => {
    for (const colour of ["#E23B2E", "#3B63B8", "#3FAE5A"]) {
      expect(BRAND_DOC_CSS).toContain(colour)
    }
    expect(BRAND_DOC_CSS).toMatch(/\.bd-title \{[^}]*font-size: 14pt/)
    // Every selector starts with .bd-, so a document's own h1, .meta or .logo rules are never touched.
    const selectors = [...BRAND_DOC_CSS.matchAll(/^\s*([^{}\n]+)\{/gm)].map((m) => m[1].trim())
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) expect(selector.startsWith(".bd-")).toBe(true)
  })
})

describe("the report header look", () => {
  it("has a stripe element for the red, blue and green bar", () => {
    expect(BRAND_STRIPE_HTML).toBe('<div class="stripe"></div>')
  })

  it("draws the stripe in the brochure colours", () => {
    expect(BRAND_HEADER_CSS).toContain("#E23B2E")
    expect(BRAND_HEADER_CSS).toContain("#3B63B8")
    expect(BRAND_HEADER_CSS).toContain("#3FAE5A")
  })

  it("puts the logo and the title on white, with a black rule and a black bar", () => {
    expect(BRAND_HEADER_CSS).toMatch(/header > div:first-child \{[^}]*background: #FFFFFF/)
    expect(BRAND_HEADER_CSS).toMatch(/\.meta \{[^}]*background: #FFFFFF/)
    expect(BRAND_HEADER_CSS).toMatch(/\.meta \{[^}]*border-bottom: 1\.5pt solid #17191C/)
    expect(BRAND_HEADER_CSS).toMatch(/\.meta::after \{[^}]*background: #17191C/)
  })

  it("has no blue and no mint anywhere but the stripe", () => {
    for (const css of [BRAND_HEADER_CSS, BRAND_DOC_CSS]) {
      for (const colour of ["#1B3A82", "#142C66", "#7AE3C8", "#C9D6F5", "#E1E9FB", "#4F5B73"]) {
        expect(css).not.toContain(colour)
      }
    }
  })

  it("prints the document title and the sub lines in black on white", () => {
    expect(BRAND_DOC_CSS).toMatch(/\.bd-panel \{[^}]*background: #FFFFFF/)
    expect(BRAND_DOC_CSS).toMatch(/\.bd-title \{[^}]*color: #17191C/)
    expect(BRAND_DOC_CSS).toMatch(/\.bd-sub \{[^}]*color: #17191C/)
    expect(BRAND_DOC_CSS).toMatch(/\.bd-stamp \{[^}]*color: #17191C/)
    expect(BRAND_DOC_CSS).toMatch(/\.bd-mint \{[^}]*background: #17191C/)
  })

  it("prints the title and the lines in black", () => {
    expect(BRAND_HEADER_CSS).toMatch(/\.metatitle \{[^}]*color: #17191C/)
    expect(BRAND_HEADER_CSS).toMatch(/\.v \{[^}]*color: #17191C/)
  })
})
