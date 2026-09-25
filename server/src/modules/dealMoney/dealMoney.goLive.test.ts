import { describe, expect, it } from "vitest"
import { assertMoneyAllowed, moneyNotRecordedReason } from "./dealMoney.goLive"

describe("assertMoneyAllowed", () => {
  it("refuses a deal Won before go-live", () => {
    expect(() =>
      assertMoneyAllowed({ serial: "BS-OPP-00004", status: "WON", closedAt: new Date("2026-10-20T00:00:00Z") }, "2026-11-01")
    ).toThrow("BS-OPP-00004 was won before this app started (2026-11-01), so its money is not recorded here.")
  })

  it("refuses a deal that is not Won", () => {
    expect(() =>
      assertMoneyAllowed({ serial: "BS-OPP-00005", status: "ONGOING", closedAt: null }, "2026-11-01")
    ).toThrow("BS-OPP-00005 is not won yet. Money can be recorded only on a won deal.")
  })

  it("allows a deal Won on go-live day", () => {
    expect(() =>
      assertMoneyAllowed({ serial: "X", status: "WON", closedAt: new Date("2026-11-01T00:00:00Z") }, "2026-11-01")
    ).not.toThrow()
  })
})

describe("moneyNotRecordedReason", () => {
  it("says why a deal has no money recorded, or null when it can have some", () => {
    expect(moneyNotRecordedReason({ status: "ONGOING", closedAt: null }, "2026-11-01")).toBe("NOT_WON")
    expect(moneyNotRecordedReason({ status: "WON", closedAt: new Date("2026-10-31T23:59:59Z") }, "2026-11-01")).toBe("WON_BEFORE_GO_LIVE")
    expect(moneyNotRecordedReason({ status: "WON", closedAt: null }, "2026-11-01")).toBe("WON_BEFORE_GO_LIVE")
    expect(moneyNotRecordedReason({ status: "WON", closedAt: new Date("2026-11-01T00:00:00Z") }, "2026-11-01")).toBeNull()
  })
})
