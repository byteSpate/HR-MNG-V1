import { describe, expect, it } from "vitest"

import { CARD_BY_KEY } from "./heatmap.cards"
import { cardColour, colourDateOf, longDate, monthsBefore } from "./heatmap.colour"

const TODAY = "2026-10-07"
const colour = (need: "NEED" | "NO_NEED" | null, dates: (string | null)[], needReason: string | null = null) =>
  cardColour({ need, needReason, dates }, TODAY)

describe("the colour of a card", () => {
  it("is grey when nobody asked and nothing is recorded", () => {
    expect(colour(null, [])).toEqual({ colour: "GREY", reason: "Not checked yet. Ask if they need it.", chanceFrom: null })
  })

  it("is red only when a person marked No need, and shows their reason", () => {
    expect(colour("NO_NEED", [], "Everything is in the cloud")).toEqual({
      colour: "RED", reason: "No need: Everything is in the cloud", chanceFrom: null,
    })
  })

  it("stays red with items, because a person said there is no need", () => {
    expect(colour("NO_NEED", ["2026-11-01"], "Just bought new ones").colour).toBe("RED")
  })

  it("is green when they need it and have none", () => {
    expect(colour("NEED", [])).toEqual({ colour: "GREEN", reason: "They need it and have none yet.", chanceFrom: null })
  })

  it("is green when support has ended", () => {
    expect(colour(null, ["2026-03-03"])).toEqual({ colour: "GREEN", reason: "Ended on 3 March 2026.", chanceFrom: "2025-03-03" })
  })

  it("is green when support ends within 12 months, today counted", () => {
    expect(colour("NEED", ["2027-10-07"])).toEqual({ colour: "GREEN", reason: "Ends on 7 October 2027.", chanceFrom: "2026-10-07" })
  })

  it("is yellow when support has more than 12 months left, and says when the chance opens", () => {
    expect(colour(null, ["2027-10-08"])).toEqual({ colour: "YELLOW", reason: "Chance from October 2026.", chanceFrom: "2026-10-08" })
  })

  it("follows the earliest date on the card", () => {
    expect(colour(null, ["2030-01-01", "2027-01-15", null]).colour).toBe("GREEN")
  })

  it("says how many items have no end date when the card is yellow", () => {
    expect(colour(null, ["2029-05-01", null]).reason).toBe("Chance from May 2028. 1 item has no end date.")
    expect(colour(null, ["2029-05-01", null, null]).reason).toBe("Chance from May 2028. 2 items have no end date.")
  })

  it("is grey when they have it but no end date is recorded, because the chance is not known", () => {
    expect(colour("NEED", [null])).toEqual({
      colour: "GREY", reason: "They have it, but no end date is recorded. Add one to see the chance.", chanceFrom: null,
    })
  })
})

describe("the date that sets an item's colour", () => {
  const firewall = CARD_BY_KEY.get("firewall")!
  const sw = CARD_BY_KEY.get("switch")!

  it("is the support end date", () => {
    expect(colourDateOf(sw, { supportEndsOn: "2027-01-01", details: {} })).toBe("2027-01-01")
  })

  it("is the earlier of support and licence for a firewall", () => {
    expect(colourDateOf(firewall, { supportEndsOn: "2028-01-01", details: { licenceEndsOn: "2027-06-30" } })).toBe("2027-06-30")
    expect(colourDateOf(firewall, { supportEndsOn: null, details: { licenceEndsOn: "2027-06-30" } })).toBe("2027-06-30")
  })

  it("is null when no date is recorded", () => {
    expect(colourDateOf(firewall, { supportEndsOn: null, details: {} })).toBeNull()
  })
})

describe("date helpers", () => {
  it("go back whole months, and keep the end of February real", () => {
    expect(monthsBefore("2027-10-07", 12)).toBe("2026-10-07")
    expect(monthsBefore("2028-02-29", 12)).toBe("2027-02-28")
    expect(monthsBefore("2027-03-31", 1)).toBe("2027-02-28")
  })

  it("write a date the long way", () => {
    expect(longDate("2027-03-03")).toBe("3 March 2027")
  })
})
