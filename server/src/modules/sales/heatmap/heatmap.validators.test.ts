import { describe, expect, it } from "vitest"

import { heatmapItemSchema, setNeedSchema } from "./heatmap.validators"

const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message

describe("setting the need on a card", () => {
  it("takes Need it, No need with a reason, or Not asked yet", () => {
    expect(setNeedSchema.parse({ need: "NEED" })).toEqual({ need: "NEED", reason: null })
    expect(setNeedSchema.parse({ need: "NO_NEED", reason: " All in the cloud " })).toEqual({ need: "NO_NEED", reason: "All in the cloud" })
    expect(setNeedSchema.parse({ need: "NOT_ASKED" })).toEqual({ need: "NOT_ASKED", reason: null })
  })

  it("asks for a reason with No need", () => {
    expect(firstError(setNeedSchema.safeParse({ need: "NO_NEED", reason: "  " }))).toBe("Write why they do not need it.")
    expect(firstError(setNeedSchema.safeParse({ need: "NO_NEED" }))).toBe("Write why they do not need it.")
  })

  it("drops a reason sent with anything but No need", () => {
    expect(setNeedSchema.parse({ need: "NEED", reason: "x" })).toEqual({ need: "NEED", reason: null })
  })

  it("refuses an unknown need in plain words", () => {
    expect(firstError(setNeedSchema.safeParse({ need: "MAYBE" }))).toBe("Pick Need it, No need, or Not asked yet.")
  })
})

describe("an item on a card", () => {
  const good = { brand: " Cisco ", quantity: 24 }

  it("needs only a brand and how many, and turns blanks into nothing", () => {
    expect(heatmapItemSchema.parse({ ...good, model: " ", site: "", supportEndsOn: null })).toEqual({
      brand: "Cisco", model: null, quantity: 24, site: null, boughtFrom: null, boughtOn: null,
      supportEndsOn: null, endOfLifeOn: null, supportBy: null, notes: null, details: {},
    })
  })

  it("asks for the brand", () => {
    expect(firstError(heatmapItemSchema.safeParse({ quantity: 1, brand: "  " }))).toBe("Write the brand.")
  })

  it("takes a whole number of at least 1 for how many", () => {
    expect(firstError(heatmapItemSchema.safeParse({ brand: "HP", quantity: 0 }))).toBe("How many must be at least 1.")
    expect(firstError(heatmapItemSchema.safeParse({ brand: "HP", quantity: 2.5 }))).toBe("How many must be a whole number.")
    expect(firstError(heatmapItemSchema.safeParse({ brand: "HP" }))).toBe("Write how many they have.")
  })

  it("takes real dates only", () => {
    expect(heatmapItemSchema.parse({ ...good, supportEndsOn: "2027-03-03" }).supportEndsOn).toBe("2027-03-03")
    expect(firstError(heatmapItemSchema.safeParse({ ...good, boughtOn: "2027-02-30" }))).toBe("Pick a real date.")
    expect(firstError(heatmapItemSchema.safeParse({ ...good, boughtOn: "03/03/2027" }))).toBe("Pick a real date.")
  })

  it("keeps the notes short", () => {
    expect(firstError(heatmapItemSchema.safeParse({ ...good, notes: "x".repeat(501) }))).toBe("Keep the notes under 500 characters.")
  })

  it("takes the extra fields as words, and leaves the card to check them", () => {
    expect(heatmapItemSchema.parse({ ...good, details: { ports: "24" } }).details).toEqual({ ports: "24" })
    expect(firstError(heatmapItemSchema.safeParse({ ...good, details: { ports: "x".repeat(201) } }))).toBe(
      "Keep each field under 200 characters.",
    )
  })
})
