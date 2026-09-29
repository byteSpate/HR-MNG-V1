import { describe, expect, it } from "vitest"

import { CHART } from "./accounting.seed"

describe("the seeded chart of accounts", () => {
  it("names account 1214 with Opportunity, not deal", () => {
    expect(CHART.find((entry) => entry.code === "1214")?.name).toBe("Goods Bought for Won Opportunities")
  })

  it("has no account name that says deal", () => {
    // Existing databases are renamed by a migration; this keeps new ones clean.
    expect(CHART.filter((entry) => /\bdeals?\b/i.test(entry.name)).map((entry) => entry.name)).toEqual([])
  })
})
