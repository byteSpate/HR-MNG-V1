import { describe, expect, it } from "vitest"

import { markText, productColour, productText } from "./heatmap.colour"

describe("productColour", () => {
  it("is Grey until somebody has ticked or crossed a part", () => {
    expect(productColour([null, null, null])).toBe("GREY")
  })

  it("is Green when at least one part has a tick, whatever the others are", () => {
    expect(productColour(["GREEN"])).toBe("GREEN")
    expect(productColour(["GREEN", "RED", null])).toBe("GREEN")
    expect(productColour(["RED", "RED", "GREEN"])).toBe("GREEN")
  })

  it("is Red only when every part has a cross", () => {
    expect(productColour(["RED"])).toBe("RED")
    expect(productColour(["RED", "RED", "RED"])).toBe("RED")
  })

  it("stays Grey when some parts are crossed and the rest are not checked", () => {
    expect(productColour(["RED", null])).toBe("GREY")
    expect(productColour(["RED", "RED", null])).toBe("GREY")
  })

  it("is Grey for a product with no parts, never Red", () => {
    expect(productColour([])).toBe("GREY")
  })
})

describe("History words", () => {
  it("names a part's mark", () => {
    expect(markText("GREEN")).toBe("Tick")
    expect(markText("RED")).toBe("Cross")
    expect(markText(null)).toBe("Not checked")
  })

  it("counts a product's marks", () => {
    expect(productText(["GREEN", "RED", null, null])).toBe("1 ticked, 1 crossed, 2 not checked")
    expect(productText([])).toBe("0 ticked, 0 crossed, 0 not checked")
  })
})
