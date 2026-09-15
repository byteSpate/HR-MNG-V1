import { describe, expect, it } from "vitest"

import { WAITING_DAYS, waitingForMinutesWhere } from "./minutes.waiting"

/** 10:00 on Tuesday 15 Sep in Dhaka. */
const NOW = new Date("2026-09-15T04:00:00.000Z")

describe("meetings waiting for minutes", () => {
  it("are completed meetings with no minutes, held in the last 7 office days, that these people attended on our side", () => {
    expect(WAITING_DAYS).toBe(7)
    expect(waitingForMinutesWhere(["emp-1"], NOW)).toEqual({
      status: "COMPLETED",
      minutes: { is: null },
      // The start of Wednesday 9 Sep in Dhaka: today and the six days before it.
      scheduledAt: { gte: new Date("2026-09-08T18:00:00.000Z") },
      attendees: { some: { side: "OURS", employeeId: { in: ["emp-1"] } } },
    })
  })

  it("are everybody's for the team view", () => {
    expect(waitingForMinutesWhere(null, NOW)).not.toHaveProperty("attendees")
  })
})
