import { describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

import { composeFunnel, summariseLines } from "./funnel.rows"
import type { FunnelCloseChange, FunnelCommentInput, FunnelDealInput, FunnelLineInput } from "./funnel.types"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)

const line = (over: Partial<FunnelLineInput> = {}): FunnelLineInput => ({
  product: "Switch",
  oemBrand: "Cisco",
  model: "C9300",
  quantity: 4,
  order: 0,
  ...over,
})

const deal = (over: Partial<FunnelDealInput> = {}): FunnelDealInput => ({
  id: "opp-1",
  serial: "BS-OPP-00001",
  salesAccountId: "acc-1",
  accountName: "Example Bank",
  name: "Campus core refresh",
  useCase: "Campus core switching",
  offeredOn: day("2026-09-05"),
  amount: "35536.00",
  status: "ONGOING",
  stage: "QUOTATION_SUBMITTED",
  expectedCloseDate: day("2026-10-15"),
  lostToPartner: null,
  lostToAmount: null,
  lostToProduct: null,
  nextStep: "Chase the CFO",
  lines: [line()],
  ...over,
})

const grid = (
  over: {
    deals?: FunnelDealInput[]
    comments?: FunnelCommentInput[]
    closeChanges?: FunnelCloseChange[]
  } = {}
) =>
  composeFunnel({
    employeeId: "emp-1",
    employeeName: "Rahim Uddin",
    deals: over.deals ?? [deal()],
    comments: over.comments ?? [],
    closeChanges: over.closeChanges ?? [],
  })

describe("summariseLines", () => {
  it("shows the value when there is one line", () => {
    expect(summariseLines([line()], "oemBrand")).toBe("Cisco")
  })

  it("shows the first and a count when there are several", () => {
    const lines = [line(), line({ oemBrand: "Juniper", order: 1 }), line({ oemBrand: "HPE", order: 2 })]
    expect(summariseLines(lines, "oemBrand")).toBe("Cisco +2 more")
  })

  it("is empty when there are no lines at all", () => {
    // Not a dash and not "n/a": the sheet leaves the cell blank, so this does.
    expect(summariseLines([], "oemBrand")).toBe("")
  })

  it("is empty when the only line leaves the field blank", () => {
    expect(summariseLines([line({ oemBrand: null })], "oemBrand")).toBe("")
  })

  it("still counts the others when the first line's field is blank", () => {
    // The count is about how many lines exist, not how many carry a value.
    // Saying "+1 more" beside a blank first cell is honest; hiding it is not.
    const lines = [line({ oemBrand: null }), line({ oemBrand: "Juniper", order: 1 })]
    expect(summariseLines(lines, "oemBrand")).toBe("+1 more")
  })

  it("reads lines in their stored order, not the order they arrive", () => {
    const lines = [line({ oemBrand: "Juniper", order: 2 }), line({ oemBrand: "Cisco", order: 0 })]
    expect(summariseLines(lines, "oemBrand")).toBe("Cisco +1 more")
  })

  it("prints a quantity as a number and a missing one as blank", () => {
    expect(summariseLines([line({ quantity: 4 })], "quantity")).toBe("4")
    expect(summariseLines([line({ quantity: null })], "quantity")).toBe("")
  })
})

describe("composeFunnel: the grid", () => {
  it("numbers rows by screen position, newest offer first", () => {
    const result = grid({
      deals: [
        deal({ id: "old", serial: "BS-OPP-00001", offeredOn: day("2026-08-01") }),
        deal({ id: "new", serial: "BS-OPP-00002", offeredOn: day("2026-09-05") }),
      ],
    })
    expect(result.rows.map((r) => r.opportunityId)).toEqual(["new", "old"])
    // S/N is position, so it reads 1 then 2 whatever the deals' own serials say.
    expect(result.rows.map((r) => r.serialNo)).toEqual([1, 2])
    expect(result.rows.map((r) => r.serial)).toEqual(["BS-OPP-00002", "BS-OPP-00001"])
  })

  it("keeps the business heading but carries the real field", () => {
    expect(grid().rows[0].projectName).toBe("Campus core refresh")
  })

  it("prints a closing date as month and year, and keeps the raw value to edit", () => {
    const row = grid().rows[0]
    expect(row.closingDateLabel).toBe("Oct 2026")
    expect(row.closingDate).toBe("2026-10-15")
  })

  it("leaves the closing cell blank when there is no date", () => {
    const row = grid({ deals: [deal({ expectedCloseDate: null })] }).rows[0]
    expect(row.closingDateLabel).toBe("")
    expect(row.closingDate).toBeNull()
  })

  it("carries the lost-to block through as strings", () => {
    const row = grid({
      deals: [
        deal({
          status: "LOST",
          lostToPartner: "Example Partner Ltd",
          lostToAmount: "31000.00",
          lostToProduct: "Competitor model X",
        }),
      ],
    }).rows[0]
    expect(row.lostTo).toEqual({
      partner: "Example Partner Ltd",
      amount: "31000.00",
      product: "Competitor model X",
    })
  })

  it("leaves the lost-to block empty on a deal nobody lost", () => {
    expect(grid().rows[0].lostTo).toEqual({ partner: null, amount: null, product: null })
  })
})

describe("composeFunnel: the derived offer line", () => {
  it("names the product and the offer date", () => {
    expect(grid().rows[0].offerLine).toBe("We have offered Switch on Sep 5, 2026")
  })

  it("counts the other products rather than listing them all", () => {
    const row = grid({
      deals: [deal({ lines: [line(), line({ product: "Firewall", order: 1 })] })],
    }).rows[0]
    expect(row.offerLine).toBe("We have offered Switch +1 more on Sep 5, 2026")
  })

  it("says nothing when there is no offer date", () => {
    // A deal with no offer date is not in the funnel at all, but the composer
    // must not invent a sentence if one ever reaches it.
    expect(grid({ deals: [deal({ offeredOn: null })] }).rows[0].offerLine).toBeNull()
  })

  it("says nothing when there is no product to name", () => {
    expect(grid({ deals: [deal({ lines: [] })] }).rows[0].offerLine).toBeNull()
  })
})

describe("composeFunnel: remarks are the deal's own comments", () => {
  const comment = (over: Partial<FunnelCommentInput> = {}): FunnelCommentInput => ({
    id: "c-1",
    entityId: "opp-1",
    kind: "GENERAL",
    body: "Customer asked for a revised price",
    authorName: "Rahim Uddin",
    createdAt: new Date("2026-09-08T10:00:00.000Z"),
    funnelMeetingId: null,
    ...over,
  })

  it("attaches a deal's comments to its own row, newest first", () => {
    const row = grid({
      comments: [
        comment({ id: "older", createdAt: new Date("2026-09-06T10:00:00.000Z") }),
        comment({ id: "newer", createdAt: new Date("2026-09-09T10:00:00.000Z") }),
      ],
    }).rows[0]
    expect(row.remarks.map((r) => r.id)).toEqual(["newer", "older"])
  })

  it("does not put one deal's comments on another deal's row", () => {
    const result = grid({
      deals: [deal({ id: "opp-1" }), deal({ id: "opp-2", serial: "BS-OPP-00002" })],
      comments: [comment({ entityId: "opp-2" })],
    })
    const byId = Object.fromEntries(result.rows.map((r) => [r.opportunityId, r]))
    expect(byId["opp-2"].remarks).toHaveLength(1)
    expect(byId["opp-1"].remarks).toHaveLength(0)
  })

  it("keeps which meeting a management note was written in", () => {
    const row = grid({
      comments: [comment({ kind: "MANAGEMENT_NOTE", funnelMeetingId: "fm-1" })],
    }).rows[0]
    expect(row.remarks[0].kind).toBe("MANAGEMENT_NOTE")
    expect(row.remarks[0].funnelMeetingId).toBe("fm-1")
  })
})

describe("composeFunnel: the slipped closing date", () => {
  const slip = (over: Partial<FunnelCloseChange> = {}): FunnelCloseChange => ({
    entityId: "opp-1",
    from: day("2026-09-30"),
    to: day("2026-10-15"),
    changedAt: new Date("2026-09-10T10:00:00.000Z"),
    ...over,
  })

  it("marks a deal whose closing date was pushed later", () => {
    const row = grid({ closeChanges: [slip()] }).rows[0]
    expect(row.closingDateSlipped).toBe(true)
    expect(row.previousClosingDate).toBe("2026-09-30")
  })

  it("does not mark a date that was brought forward", () => {
    // Closing early is good news. Marking it would teach people the mark
    // means nothing.
    const row = grid({
      closeChanges: [slip({ from: day("2026-11-30"), to: day("2026-10-15") })],
    }).rows[0]
    expect(row.closingDateSlipped).toBe(false)
  })

  it("does not mark the first time a date is set", () => {
    // Null to a date is filling a blank, not slipping.
    expect(grid({ closeChanges: [slip({ from: null })] }).rows[0].closingDateSlipped).toBe(false)
  })

  it("judges on the latest change, not the first", () => {
    const row = grid({
      closeChanges: [
        slip({ changedAt: new Date("2026-09-01T10:00:00.000Z") }),
        slip({
          from: day("2026-10-15"),
          to: day("2026-10-01"),
          changedAt: new Date("2026-09-12T10:00:00.000Z"),
        }),
      ],
    }).rows[0]
    // The most recent move brought it forward, so the row is not marked.
    expect(row.closingDateSlipped).toBe(false)
  })

  it("is quiet when the audit log says nothing about this deal", () => {
    const row = grid({ closeChanges: [slip({ entityId: "someone-else" })] }).rows[0]
    expect(row.closingDateSlipped).toBe(false)
    expect(row.previousClosingDate).toBeNull()
  })
})

describe("composeFunnel: two totals, both labelled", () => {
  it("counts every row in Quoted and only the live ones in Still open", () => {
    const result = grid({
      deals: [
        deal({ id: "a", amount: "100.00", status: "ONGOING" }),
        deal({ id: "b", amount: "50.00", status: "WON" }),
        deal({ id: "c", amount: "25.00", status: "LOST" }),
        deal({ id: "d", amount: "10.00", status: "CANCELLED" }),
      ],
    })
    expect(result.totals.quoted).toBe("185.00")
    expect(result.totals.quotedCount).toBe(4)
    // Only Lost and Cancelled drop out of Still open.
    expect(result.totals.stillOpen).toBe("150.00")
    expect(result.totals.stillOpenCount).toBe(2)
  })

  it("says how many deals carry no price rather than treating them as zero", () => {
    const result = grid({
      deals: [deal({ id: "a", amount: "100.00" }), deal({ id: "b", amount: null })],
    })
    expect(result.totals.quoted).toBe("100.00")
    expect(result.totals.unpricedCount).toBe(1)
  })

  it("totals an empty funnel to zero rather than to nothing", () => {
    const result = grid({ deals: [] })
    expect(result.totals.quoted).toBe("0.00")
    expect(result.totals.stillOpen).toBe("0.00")
    expect(result.totals.quotedCount).toBe(0)
    expect(result.rows).toEqual([])
  })

  it("carries the person the grid belongs to", () => {
    const result = grid()
    expect(result.employeeId).toBe("emp-1")
    expect(result.employeeName).toBe("Rahim Uddin")
  })
})
