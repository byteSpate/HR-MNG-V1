import { AppError } from "../../middleware/errorHandler"

/**
 * Only a deal that is Won, and was Won on or after go-live, can have money
 * recorded against it (spec: "Only deals Won on or after SALES_GO_LIVE").
 * A deal Won earlier has no PO, invoice or bill history in this app — its
 * money lives wherever it was tracked before this system existed.
 */
export function assertMoneyAllowed(
  deal: { serial: string; status: string; closedAt: Date | null },
  goLiveDate: string
): void {
  if (deal.status !== "WON") {
    throw new AppError(400, `${deal.serial} is not won yet. Money can be recorded only on a won deal.`)
  }

  const goLive = new Date(`${goLiveDate}T00:00:00.000Z`)
  if (!deal.closedAt || deal.closedAt < goLive) {
    throw new AppError(
      400,
      `${deal.serial} was won before this app started (${goLiveDate}), so its money is not recorded here.`
    )
  }
}
