import { describe, expect, it } from "vitest"

import { AppError } from "../../../middleware/errorHandler"
import { CARD_BY_KEY, checkDetails, HEATMAP_CARDS, HEATMAP_GROUPS, itemText } from "./heatmap.cards"

const card = (key: string) => CARD_BY_KEY.get(key)!

describe("the heatmap cards", () => {
  it("are the 14 cards the owner chose, in order", () => {
    expect(HEATMAP_CARDS.map((c) => c.title)).toEqual([
      "Router", "Switch", "Firewall", "Wireless",
      "Server", "Storage and backup", "Data centre or server room",
      "IP phone and PBX", "CCTV", "Access control and attendance", "Video conferencing",
      "Software", "Antivirus and endpoint security", "SSL certificate",
    ])
  })

  it("have unique keys, and every card sits in a group that exists", () => {
    const keys = HEATMAP_CARDS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of HEATMAP_CARDS) expect(HEATMAP_GROUPS.some((g) => g.key === c.group)).toBe(true)
    for (const g of HEATMAP_GROUPS) expect(HEATMAP_CARDS.some((c) => c.group === g.key)).toBe(true)
  })

  it("give every pick list at least two options, and options only to pick lists", () => {
    for (const c of HEATMAP_CARDS) {
      const keys = c.extras.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const f of c.extras) {
        if (f.type === "CHOICE") expect(f.options!.length).toBeGreaterThanOrEqual(2)
        else expect(f.options).toBeUndefined()
        if (f.setsColour) expect(f.type).toBe("DATE")
      }
    }
  })

  it("are written without em-dashes", () => {
    for (const c of HEATMAP_CARDS) {
      const words = [c.title, c.quantityLabel, c.endsLabel, ...c.extras.flatMap((f) => [f.label, ...(f.options ?? [])])]
      expect(words.join(" ")).not.toContain("—")
    }
  })

  it("label the end date the way each card means it", () => {
    expect(card("switch").endsLabel).toBe("Warranty or support ends")
    expect(card("software").endsLabel).toBe("Licence ends")
    expect(card("ssl").endsLabel).toBe("Expires on")
  })

  it("let the firewall licence date set the colour too", () => {
    expect(card("firewall").extras.find((f) => f.key === "licenceEndsOn")).toMatchObject({ type: "DATE", setsColour: true })
  })
})

describe("checking the extra fields of an item", () => {
  it("keeps good values, trimmed, and drops empty ones", () => {
    expect(checkDetails(card("switch"), { ports: " 24 ", speed: "10G", poe: "YES", managed: "" })).toEqual({
      ports: "24", speed: "10G", poe: "YES",
    })
  })

  it("refuses a field the card does not have", () => {
    expect(() => checkDetails(card("router"), { cameras: "4" })).toThrow(AppError)
    expect(() => checkDetails(card("router"), { cameras: "4" })).toThrow(/Router has no field "cameras"/)
  })

  it("takes numbers only for a number field, with up to 2 decimals", () => {
    expect(checkDetails(card("storage"), { sizeTb: "7.5" })).toEqual({ sizeTb: "7.5" })
    for (const bad of ["many", "-2", "1.234", "1e5"]) {
      expect(() => checkDetails(card("storage"), { sizeTb: bad })).toThrow(/Size in TB needs a number, like 24/)
    }
  })

  it("takes only Yes or No for a yes or no field", () => {
    expect(() => checkDetails(card("switch"), { poe: "maybe" })).toThrow(/PoE: pick Yes or No/)
  })

  it("takes only the listed options for a pick list", () => {
    expect(() => checkDetails(card("ssl"), { validation: "XV" })).toThrow(/Validation level: choose one of DV, OV, EV/)
  })

  it("takes a real date for a date field", () => {
    expect(checkDetails(card("firewall"), { licenceEndsOn: "2027-03-03" })).toEqual({ licenceEndsOn: "2027-03-03" })
    expect(() => checkDetails(card("firewall"), { licenceEndsOn: "2027-02-30" })).toThrow(/Licence ends needs a date/)
  })
})

describe("the words for an item, for the account History", () => {
  it("names the brand, model, count and end date", () => {
    expect(itemText(card("switch"), { brand: "Cisco", model: "C9200-24P", quantity: 24, supportEndsOn: "2027-03-03" }))
      .toBe("Cisco C9200-24P, 24, Warranty or support ends 3 March 2027")
  })

  it("leaves out what is not recorded", () => {
    expect(itemText(card("ssl"), { brand: "DigiCert", model: null, quantity: 1, supportEndsOn: null })).toBe("DigiCert, 1")
  })
})
