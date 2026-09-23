import type { NextFunction, Request, Response } from "express"
import { createCustomerCreditNote, getCustomerCreditNote, listCustomerCreditNotes } from "./customerCreditNote.service"
import { approveCustomerCreditNote } from "./customerCreditNote.posting"
import { createCustomerCreditNoteSchema } from "./customerCreditNote.validators"

type RequestWithId = Request<{ id: string }>

export async function listCustomerCreditNotesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, invoiceId } = req.query as { status?: "DRAFT" | "APPROVED"; invoiceId?: string }
    return res.status(200).json(await listCustomerCreditNotes({ status, invoiceId }))
  } catch (err) {
    return next(err)
  }
}

export async function getCustomerCreditNoteHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getCustomerCreditNote(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createCustomerCreditNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createCustomerCreditNoteSchema.parse(req.body)
    return res.status(201).json(await createCustomerCreditNote(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function approveCustomerCreditNoteHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await approveCustomerCreditNote(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
