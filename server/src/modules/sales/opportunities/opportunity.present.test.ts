import { describe, expect, it } from "vitest"

import { presentOpportunity } from "./opportunity.present"

const NOW = new Date("2026-09-09T10:00:00.000Z")
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "opp-1", serial: "BS-OPP-00001", salesAccountId: "acc-1", meetingId: null, track: "NETWORKING", name: "Core refresh",
  oemAccountManager: null, amount: null, currency: "BDT", expectedCloseDate: null, offeredOn: null, status: "ONGOING",
  statusReason: null, closedAt: null, stage: "REQUIREMENT_RECEIVED", stageChangedAt: NOW, nextStep: null,
  nextStepDueOn: null, ownerEmployeeId: "emp-1", wonByEmployeeId: null, lastActivityAt: NOW, createdBy: "user-1",
  createdAt: NOW, updatedAt: NOW, owner: { id: "emp-1", fullName: "Rahim" }, salesAccount: { name: "Rising Group" },
  lines: [], ...overrides,
})

describe("presentOpportunity: the offer date", () => {
  it("is null before the quotation or proposal has gone out", () => {
    expect(presentOpportunity(row()).offeredOn).toBeNull()
  })

  it("is the plain day once it has, so a page can tell the Opportunity is in the funnel", () => {
    expect(presentOpportunity(row({ offeredOn: new Date("2026-09-01T00:00:00.000Z") })).offeredOn).toBe("2026-09-01")
  })
})
