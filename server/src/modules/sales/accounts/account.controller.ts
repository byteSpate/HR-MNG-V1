import type { NextFunction, Request, Response } from "express"

import { AppError } from "../../../middleware/errorHandler"

import {
  createSalesAccount,
  updateSalesAccount,
  getAccountHistory,
  getAccountMargin,
  getSalesAccount,
  listAllSalesAccounts,
  listSalesAccounts,
  listSalesEligibleEmployees,
} from "./account.service"
import { removeVisitingCard, setVisitingCard } from "./account.card"
import { getAccountProfile, updateAccountProfile } from "./account.profile"
import { updateAccountProfileSchema } from "./account.profile.validators"
import { addContact, listContacts, setContactStatus, setPrimaryContact, updateContact } from "./contact.service"
import { getAccountTimeline, logCommunication } from "./communication.service"
import {
  createSalesAccountSchema,
  createSalesContactSchema,
  logCommunicationSchema,
  setContactStatusSchema,
  updateSalesAccountSchema,
  updateSalesContactSchema,
} from "./account.validators"

export async function listSalesAccountsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // ?scope=all is "All Accounts" — the shared, read-only directory. Its
    // default (no query, or anything else) is "My Accounts" — owner,
    // assignee, or admin — the behaviour this route always had.
    const unverified = req.query.unverified === "true"
    const items =
      req.query.scope === "all"
        ? await listAllSalesAccounts(
            req.user!,
            unverified,
            typeof req.query.ownerEmployeeId === "string" ? req.query.ownerEmployeeId : undefined
          )
        : await listSalesAccounts(req.user!, unverified)
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

export async function getAccountProfileHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getAccountProfile(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateAccountProfileHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    // The refusal is the sentence alone. The shared error handler prefixes a
    // Zod failure with its field path ("custom.add.0.question: ..."), which is
    // not easy English for the person who reads it on this form.
    const parsed = updateAccountProfileSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? "Check the answers and try again.")
    return res.status(200).json(await updateAccountProfile(req.params.id, parsed.data, req.user!))
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

export async function updateContactHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = updateSalesContactSchema.parse(req.body)
    return res.status(200).json(await updateContact(req.params.id, body, req.user!))
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

export async function getAccountMarginHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getAccountMargin(req.params.id, req.user!))
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

export async function updateSalesAccountHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = updateSalesAccountSchema.parse(req.body)
    return res.status(200).json(await updateSalesAccount(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setVisitingCardHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    // `req.file` is undefined when no file part came; the service says so in words.
    return res.status(200).json(await setVisitingCard(req.params.id, req.file, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function removeVisitingCardHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await removeVisitingCard(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
