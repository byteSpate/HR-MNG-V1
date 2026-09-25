import { AppError } from "../../middleware/errorHandler"

/** Why a deal's money is not recorded in this app, or null when it is. */
export type MoneyNotRecordedReason = "NOT_WON" | "WON_BEFORE_GO_LIVE"

/**
 * Only a deal that is Won, and was Won on or after go-live, can have money
 * recorded against it (spec: "Only deals Won on or after SALES_GO_LIVE").
 * A deal Won earlier has no PO, invoice or bill history in this app — its
 * money lives wherever it was tracked before this system existed.
 *
 * The one place this rule is worked out: `assertMoneyAllowed` refuses a
 * write with it, and `getDealMoney` uses it to say why a deal shows no
 * money instead of showing zeros (final review Fix 3).
 */
export function moneyNotRecordedReason(
  deal: { status: string; closedAt: Date | null },
  goLiveDate: string
): MoneyNotRecordedReason | null {
  if (deal.status !== "WON") return "NOT_WON"
  const goLive = new Date(`${goLiveDate}T00:00:00.000Z`)
  if (!deal.closedAt || deal.closedAt < goLive) return "WON_BEFORE_GO_LIVE"
  return null
}

export function assertMoneyAllowed(
  deal: { serial: string; status: string; closedAt: Date | null },
  goLiveDate: string
): void {
  const reason = moneyNotRecordedReason(deal, goLiveDate)
  if (reason === "NOT_WON") {
    throw new AppError(400, `${deal.serial} is not won yet. Money can be recorded only on a won deal.`)
  }
  if (reason === "WON_BEFORE_GO_LIVE") {
    throw new AppError(
      400,
      `${deal.serial} was won before this app started (${goLiveDate}), so its money is not recorded here.`
    )
  }
}
