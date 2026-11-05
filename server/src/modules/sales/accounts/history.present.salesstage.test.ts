import { describe, expect, it } from "vitest"

import { presentChanges } from "./history.present"

describe("History for the sales stage", () => {
  it("calls the field Sales stage and writes the value in plain words, as it does for the work stage", () => {
    const [change] = presentChanges({ salesStage: "AWARENESS" }, { salesStage: "PURCHASE_ORDER_RECEIVED" }, new Map())
    expect(change.label).toBe("Sales stage")
    expect(change.before).toBe("Awareness")
    expect(change.after).toBe("Purchase order received")
  })

  it("shows a stage that was not set before as a dash, never as the word null", () => {
    const [change] = presentChanges({ salesStage: null }, { salesStage: "PENDING_INITIAL_MEETING" }, new Map())
    expect(change.before).toBe("—")
    expect(change.after).toBe("Pending initial meeting")
  })
})
