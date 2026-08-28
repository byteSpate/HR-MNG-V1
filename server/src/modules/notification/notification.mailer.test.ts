import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../utils/mailer", () => ({ notify: vi.fn(() => Promise.resolve()) }))
vi.mock("../../config/env", () => ({
  env: { COMPANY_NAME: "Byte Spate", CLIENT_ORIGIN: "https://app.example.com" },
}))

import { notify } from "../../utils/mailer"
import {
  sendAssetRequestDecidedEmail,
  sendExpenseRejectedEmail,
  sendExpensesApprovedEmail,
  sendLeaveDecidedEmail,
  sendLeaveRequestedEmail,
  sendPasswordChangedEmail,
  sendPayrollSubmittedEmail,
  sendSettlementStatementEmail,
} from "./notification.mailer"

beforeEach(() => vi.clearAllMocks())

describe("sendLeaveDecidedEmail", () => {
  it("says approved and carries the entity pair", async () => {
    await sendLeaveDecidedEmail({
      to: "a@b.com",
      requestId: "lr1",
      leaveType: "Casual Leave",
      startDate: "10 Sep 2026",
      endDate: "12 Sep 2026",
      approved: true,
      reason: null,
    })

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@b.com",
        kind: "LEAVE_DECIDED",
        subject: "Your leave request was approved",
        entity: "LEAVE_REQUEST",
        entityId: "lr1",
      })
    )
  })

  it("includes the rejection reason in the body when there is one", async () => {
    await sendLeaveDecidedEmail({
      to: "a@b.com",
      requestId: "lr1",
      leaveType: "Casual Leave",
      startDate: "10 Sep 2026",
      endDate: "12 Sep 2026",
      approved: false,
      reason: "Two people already off that week",
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.subject).toBe("Your leave request was declined")
    expect(arg.text).toContain("Two people already off that week")
    expect(arg.html).toContain("Two people already off that week")
  })
})

describe("sendLeaveRequestedEmail", () => {
  it("links the approver to the page they have to act on", async () => {
    await sendLeaveRequestedEmail({
      to: "mgr@b.com",
      requestId: "lr1",
      employeeName: "A Person",
      leaveType: "Casual Leave",
      startDate: "10 Sep 2026",
      endDate: "12 Sep 2026",
      days: "3",
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.kind).toBe("LEAVE_REQUESTED")
    expect(arg.subject).toBe("A Person requested Casual Leave")
    expect(arg.text).toContain("https://app.example.com")
    expect(arg.entity).toBe("LEAVE_REQUEST")
  })
})

const claimLine = (over: Record<string, unknown> = {}) => ({
  claimId: "c1",
  claimRef: "Travel on 03 Jul 2026",
  amount: "1,200.00",
  currency: "BDT",
  ...over,
})

describe("sendExpensesApprovedEmail", () => {
  it("names the claim and the amount for a batch of one", async () => {
    await sendExpensesApprovedEmail({
      to: "a@b.com",
      claims: [claimLine()],
      totals: [{ currency: "BDT", amount: "1,200.00" }],
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.kind).toBe("EXPENSE_APPROVED")
    expect(arg.subject).toBe("Expense claim for Travel on 03 Jul 2026 was approved")
    expect(arg.text).toContain("BDT 1,200.00")
    expect(arg.entity).toBe("EXPENSE_CLAIM")
    expect(arg.entityId).toBe("c1")
  })

  it("counts the claims in the subject once there is more than one", async () => {
    await sendExpensesApprovedEmail({
      to: "a@b.com",
      claims: [claimLine(), claimLine({ claimId: "c2", claimRef: "Meals on 04 Jul 2026" })],
      totals: [{ currency: "BDT", amount: "2,400.00" }],
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.subject).toBe("2 expense claims were approved")
    expect(arg.text).toContain("Meals on 04 Jul 2026")
  })

  /**
   * The one that cannot be got wrong. A sweep can approve a BDT claim and a
   * USD claim together; one blended total would be a number nobody can spot
   * and nobody can use.
   */
  it("keeps a mixed-currency sweep as two totals and never adds them", async () => {
    await sendExpensesApprovedEmail({
      to: "a@b.com",
      claims: [claimLine(), claimLine({ claimId: "c2", currency: "USD", amount: "80.00" })],
      totals: [
        { currency: "BDT", amount: "1,200.00" },
        { currency: "USD", amount: "80.00" },
      ],
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.text).toContain("Total BDT: 1,200.00")
    expect(arg.text).toContain("Total USD: 80.00")
    expect(arg.html).toContain("Total BDT")
    expect(arg.html).toContain("Total USD")
  })

  // "Total BDT 1,200.00" under a lone "BDT 1,200.00" is the same number twice.
  it("leaves the total off a single claim", async () => {
    await sendExpensesApprovedEmail({
      to: "a@b.com",
      claims: [claimLine()],
      totals: [{ currency: "BDT", amount: "1,200.00" }],
    })

    expect(vi.mocked(notify).mock.calls[0]![0].html).not.toContain("Total BDT")
  })
})

describe("sendExpenseRejectedEmail", () => {
  it("carries the reason, which is the point of a rejection", async () => {
    await sendExpenseRejectedEmail({
      to: "a@b.com",
      claimId: "c1",
      claimRef: "Travel on 03 Jul 2026",
      amount: "1,200.00",
      currency: "BDT",
      reason: "No receipt attached",
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.kind).toBe("EXPENSE_REJECTED")
    expect(arg.subject).toBe("Expense claim for Travel on 03 Jul 2026 was declined")
    expect(arg.text).toContain("No receipt attached")
    expect(arg.html).toContain("No receipt attached")
    expect(arg.entityId).toBe("c1")
  })
})

describe("sendPayrollSubmittedEmail", () => {
  it("names the period and links the approver to the run", async () => {
    await sendPayrollSubmittedEmail({
      to: "sa@b.com",
      runId: "r1",
      month: 9,
      year: 2026,
      employeeCount: 42,
      totalNet: "1,000,000.00",
      currency: "BDT",
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.kind).toBe("PAYROLL_SUBMITTED")
    expect(arg.subject).toBe("Payroll for September 2026 is waiting for approval")
    expect(arg.text).toContain("42")
    expect(arg.text).toContain("https://app.example.com")
    expect(arg.entity).toBe("PAYROLL_RUN")
  })
})

describe("sendAssetRequestDecidedEmail", () => {
  it("names the item and carries the reason on a refusal", async () => {
    await sendAssetRequestDecidedEmail({
      to: "a@b.com",
      requestId: "ar1",
      itemName: "Laptop",
      approved: false,
      reason: "None left in stock",
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.kind).toBe("ASSET_REQUEST_DECIDED")
    expect(arg.subject).toBe("Your request for Laptop was declined")
    expect(arg.text).toContain("None left in stock")
    expect(arg.entity).toBe("ASSET_REQUEST")
  })
})

describe("sendSettlementStatementEmail", () => {
  it("puts every line and the net into the body, since there is no PDF", async () => {
    await sendSettlementStatementEmail({
      to: "leaver@b.com",
      settlementId: "s1",
      fullName: "A Person",
      currency: "BDT",
      lines: [
        { label: "Gratuity", amount: "50,000.00" },
        { label: "Unused leave", amount: "8,000.00" },
      ],
      netPayable: "58,000.00",
    })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.text).toContain("Gratuity")
    expect(arg.text).toContain("50,000.00")
    expect(arg.text).toContain("58,000.00")
    expect(arg.entity).toBe("SETTLEMENT")
  })
})

describe("sendPasswordChangedEmail", () => {
  it("tells the reader what to do if it was not them", async () => {
    await sendPasswordChangedEmail({ to: "a@b.com", userId: "u1" })

    const arg = vi.mocked(notify).mock.calls[0]![0]
    expect(arg.kind).toBe("PASSWORD_CHANGED")
    expect(arg.text.toLowerCase()).toContain("if this wasn't you")
  })
})
