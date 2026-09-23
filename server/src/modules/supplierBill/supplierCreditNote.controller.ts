import type { NextFunction, Request, Response } from "express"
import { approveSupplierCreditNote } from "./supplierCreditNote.posting"
import { createSupplierCreditNote, getSupplierCreditNote, listSupplierCreditNotes } from "./supplierCreditNote.service"
import { createSupplierCreditNoteSchema } from "./supplierCreditNote.validators"

type RequestWithId = Request<{ id: string }>

export async function listSupplierCreditNotesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listSupplierCreditNotes())
  } catch (err) {
    return next(err)
  }
}

export async function getSupplierCreditNoteHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getSupplierCreditNote(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createSupplierCreditNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSupplierCreditNoteSchema.parse(req.body)
    return res.status(201).json(await createSupplierCreditNote(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function approveSupplierCreditNoteHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.json(await approveSupplierCreditNote(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
