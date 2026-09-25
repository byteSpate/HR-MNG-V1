import type { NextFunction, Request, Response } from "express"
import { AppError } from "../../middleware/errorHandler"
import { getDealMoney } from "./dealMoney.service"
import { listDealMoney } from "./dealMoney.list"
import { listWaitingForApproval } from "./dealMoney.approvals"
import { sendBack, type ApprovalKind } from "./dealMoney.sendBack"
import { getVatSummary } from "./dealMoney.vatSummary"
import { APPROVAL_KINDS, SEND_BACK_KINDS, dealMoneyListQuerySchema, sendBackBodySchema, vatSummaryQuerySchema } from "./dealMoney.validators"

function isApprovalKind(value: string): value is ApprovalKind {
  return (APPROVAL_KINDS as readonly string[]).includes(value)
}

type SendBackKind = (typeof SEND_BACK_KINDS)[number]

function isSendBackKind(value: string): value is SendBackKind {
  return (SEND_BACK_KINDS as readonly string[]).includes(value)
}

export async function listDealsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = dealMoneyListQuerySchema.parse(req.query)
    return res.status(200).json(await listDealMoney(query))
  } catch (err) {
    return next(err)
  }
}

export async function getDealHandler(req: Request<{ opportunityId: string }>, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getDealMoney(req.params.opportunityId, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listApprovalsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listWaitingForApproval())
  } catch (err) {
    return next(err)
  }
}

export async function sendBackHandler(req: Request<{ kind: string; id: string }>, res: Response, next: NextFunction) {
  try {
    const kind = req.params.kind.toUpperCase()
    if (!isSendBackKind(kind)) {
      throw new AppError(
        400,
        isApprovalKind(kind)
          ? "Credit notes cannot be sent back yet. Talk to whoever recorded it, so it can be fixed before you approve it."
          : "Unknown document type."
      )
    }
    const body = sendBackBodySchema.parse(req.body)
    await sendBack(kind, req.params.id, body, req.user!)
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
}

export async function vatSummaryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = vatSummaryQuerySchema.parse(req.query)
    return res.status(200).json(await getVatSummary(query.from, query.to))
  } catch (err) {
    return next(err)
  }
}
