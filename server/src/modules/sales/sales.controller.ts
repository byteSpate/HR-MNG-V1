import type { NextFunction, Request, Response } from "express"

import {
  createSalesAccount,
  getAccountHistory,
  getSalesAccount,
  listAllSalesAccounts,
  listSalesAccounts,
  listSalesEligibleEmployees,
} from "./account.service"
import { addContact, listContacts, setContactStatus, setPrimaryContact } from "./contact.service"
import { getAccountTimeline, logCommunication } from "./communication.service"
import {
  createSalesAccountSchema,
  createSalesContactSchema,
  logCommunicationSchema,
  setContactStatusSchema,
} from "./sales.validators"

export async function listSalesAccountsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // ?scope=all is "All Accounts" — the shared, read-only directory. Its
    // default (no query, or anything else) is "My Accounts" — owner,
    // assignee, or admin — the behaviour this route always had.
    const items =
      req.query.scope === "all"
        ? await listAllSalesAccounts(req.user!)
        : await listSalesAccounts(req.user!)
    return res.status(200).json(items)
  } catch (err) {
    return next(err)
  }
}

export async function getSalesAccountHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getSalesAccount(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listSalesEligibleEmployeesHandler(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await listSalesEligibleEmployees())
  } catch (err) {
    return next(err)
  }
}

export async function createSalesAccountHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = createSalesAccountSchema.parse(req.body)
    return res.status(201).json(await createSalesAccount(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listContactsHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await listContacts(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function addContactHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = createSalesContactSchema.parse(req.body)
    return res.status(201).json(await addContact(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setPrimaryContactHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await setPrimaryContact(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setContactStatusHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = setContactStatusSchema.parse(req.body)
    return res.status(200).json(await setContactStatus(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function logCommunicationHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = logCommunicationSchema.parse(req.body)
    return res.status(201).json(await logCommunication(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getAccountHistoryHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getAccountHistory(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getAccountTimelineHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getAccountTimeline(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
