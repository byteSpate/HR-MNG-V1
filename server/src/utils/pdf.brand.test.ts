import { describe, expect, it } from "vitest"

import { BRAND_HEADER_CSS, BRAND_STRIPE_HTML } from "./pdf.brand"

describe("the report header look", () => {
  it("has a stripe element for the red, blue and green bar", () => {
    expect(BRAND_STRIPE_HTML).toBe('<div class="stripe"></div>')
  })

  it("draws the stripe in the brochure colours", () => {
    expect(BRAND_HEADER_CSS).toContain("#E23B2E")
    expect(BRAND_HEADER_CSS).toContain("#3B63B8")
    expect(BRAND_HEADER_CSS).toContain("#3FAE5A")
  })

  it("puts the logo on white and the title in a navy panel with the mint bar", () => {
    expect(BRAND_HEADER_CSS).toMatch(/header > div:first-child \{[^}]*background: #FFFFFF/)
    expect(BRAND_HEADER_CSS).toMatch(/\.meta \{[^}]*#1B3A82[^}]*#142C66/)
    expect(BRAND_HEADER_CSS).toMatch(/\.meta::after \{[^}]*#7AE3C8/)
  })

  it("keeps the panel text readable: white title, light blue lines", () => {
    expect(BRAND_HEADER_CSS).toMatch(/\.metatitle \{[^}]*color: #FFFFFF/)
    expect(BRAND_HEADER_CSS).toMatch(/\.v \{[^}]*color: #C9D6F5/)
  })
})
