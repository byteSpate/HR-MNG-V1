import type { NextFunction, Request, Response } from "express"

import prisma from "../../config/prisma"
import { changeEmployeeEmail } from "./employee.email"
import { emailChangeRequestBody } from "../auth/auth.validators"
import { AppError } from "../../middleware/errorHandler"
import type { AccessTokenPayload } from "../auth/auth.types"
import { exitDetailsBody } from "../settlement/settlement.validators"
import {
  clearAvatar,
  deleteDocument,
  getDocumentUrl,
  listDocuments,
  uploadAvatar,
  uploadDocument,
} from "./employee.media"
import {
  createStaffAccount,
  employeeIdForUser,
  getEmployee,
  getMyProfile,
  listEmployees,
  setExitDetails,
  setSalaryStructure,
} from "./employee.service"
import { updateEmployee } from "./employee.update"
import { getEmployeeInsights } from "./employee.insights"
import {
  cancelNationalIdChangeRequest,
  decideNationalIdChangeRequest,
  requestNationalIdChange,
} from "./employee.changerequest"
import { visibilityTierFor } from "./employee.access"
import {
  createStaffAccountSchema,
  decideNationalIdChangeSchema,
  documentTypeSchema,
  requestNationalIdChangeSchema,
  setAccountActiveSchema,
  setSalesRoleSchema,
  setSalaryStructureSchema,
  updateEmployeeSchema,
} from "./employee.validators"
import { setAccountActive, setSalesRole } from "./employee.account"

type RequestWithId = Request<{ id: string }>
type RequestWithDoc = Request<{ id: string; docId: string }>

export async function createStaffAccountHandler(req: Request, res: Response, next: NextFunction) {
  const parsed = createStaffAccountSchema.safeParse(req.body)
  if (!parsed.success) {
    // Same reasoning as updateEmployeeHandler. The creation schema now rejects
    // a malformed joining date, a whitespace-only name and an impossible
    // calendar date with distinct messages; collapsing all of them into one
    // opaque string leaves the form with nothing to point the user at.
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" })
  }
  try {
    const result = await createStaffAccount(parsed.data, req.user!.sub)
    return res.status(201).json(result)
  } catch (err) {
    return next(err)
  }
}

export async function listEmployeesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listEmployees(req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getEmployeeHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getEmployee(req.user!, req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function getMyProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getMyProfile(req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getEmployeeInsightsHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getEmployeeInsights(req.user!, req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function setSalaryStructureHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  const parsed = setSalaryStructureSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" })
  }
  try {
    return res.status(200).json(await setSalaryStructure(req.params.id, req.user!.sub, parsed.data))
  } catch (err) {
    return next(err)
  }
}

/**
 * Enabling/disabling the login behind an employee record.
 *
 * Keyed on the employee id rather than the user id, because that is the only
 * identifier the client holds — see employee.account.ts.
 */
export async function setAccountActiveHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  const parsed = setAccountActiveSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" })
  }
  try {
    return res.status(200).json(await setAccountActive(req.params.id, parsed.data.isActive))
  } catch (err) {
    return next(err)
  }
}

export async function setSalesRoleHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = setSalesRoleSchema.parse(req.body)
    return res.status(200).json(await setSalesRole(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateEmployeeHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  const parsed = updateEmployeeSchema.safeParse(req.body)
  if (!parsed.success) {
    // Surfaces the actual Zod message rather than a generic one. This endpoint
    // names every field a caller may not write rather than dropping it
    // silently; a 400 that hides "No fields to update" behind "Invalid request
    // body" gives back the vagueness the 403 was designed to avoid.
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" })
  }
  try {
    return res.status(200).json(await updateEmployee(req.user!, req.params.id, parsed.data))
  } catch (err) {
    return next(err)
  }
}

export async function setExitDetailsHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = exitDetailsBody.parse(req.body)
    return res.status(200).json(await setExitDetails(req.params.id, req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

function isHrOrAdmin(user: AccessTokenPayload): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN"
}

async function assertSelfOrHr(user: AccessTokenPayload, employeeId: string): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true, reportingManagerId: true },
  })
  if (!employee) throw new AppError(404, "Employee not found")
  const tier = visibilityTierFor(user, employee, await employeeIdForUser(user.sub))
  if (tier !== "SELF" && tier !== "FULL") {
    throw new AppError(403, "You do not have access to this employee's records")
  }
}

function assertHrOnly(user: AccessTokenPayload): void {
  if (!isHrOrAdmin(user)) throw new AppError(403, "Only HR can change employee documents")
}

/** multer puts the parsed file here; the type comes from @types/multer. */
function requireFile(req: Request): Express.Multer.File {
  if (!req.file) throw new AppError(400, "Attach a file in a `file` field")
  return req.file
}

export async function listDocumentsHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    await assertSelfOrHr(req.user!, req.params.id)
    return res.status(200).json(await listDocuments(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function uploadDocumentHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    assertHrOnly(req.user!)
    const parsed = documentTypeSchema.safeParse(req.body?.type)
    if (!parsed.success) throw new AppError(400, "Choose a valid document type")
    const file = requireFile(req)
    return res
      .status(201)
      .json(await uploadDocument(req.params.id, req.user!.sub, file, parsed.data))
  } catch (err) {
    return next(err)
  }
}

export async function getDocumentUrlHandler(
  req: RequestWithDoc,
  res: Response,
  next: NextFunction
) {
  try {
    await assertSelfOrHr(req.user!, req.params.id)
    return res.status(200).json(await getDocumentUrl(req.params.id, req.params.docId))
  } catch (err) {
    return next(err)
  }
}

export async function deleteDocumentHandler(
  req: RequestWithDoc,
  res: Response,
  next: NextFunction
) {
  try {
    assertHrOnly(req.user!)
    await deleteDocument(req.params.id, req.params.docId, req.user!.sub)
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
}

export async function uploadAvatarHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    await assertSelfOrHr(req.user!, req.params.id)
    const file = requireFile(req)
    return res.status(200).json(await uploadAvatar(req.params.id, req.user!.sub, file))
  } catch (err) {
    return next(err)
  }
}

export async function clearAvatarHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    await assertSelfOrHr(req.user!, req.params.id)
    return res.status(200).json(await clearAvatar(req.params.id, req.user!.sub))
  } catch (err) {
    return next(err)
  }
}

/**
 * HR changing an employee's sign-in address. Applies immediately — see the
 * reasoning in `employee.email.ts`.
 */
export async function changeEmployeeEmailHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const { newEmail } = emailChangeRequestBody.parse(req.body)
    return res.status(200).json(await changeEmployeeEmail(req.params.id, newEmail, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function requestNationalIdChangeHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { newValue } = requestNationalIdChangeSchema.parse(req.body)
    const requestRow = await requestNationalIdChange(req.user!, newValue)
    return res.status(201).json(requestRow)
  } catch (err) {
    return next(err)
  }
}

export async function cancelNationalIdChangeHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    const requestRow = await cancelNationalIdChangeRequest(req.user!, req.params.id)
    return res.status(200).json(requestRow)
  } catch (err) {
    return next(err)
  }
}

export async function approveNationalIdChangeHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    const requestRow = await decideNationalIdChangeRequest(req.user!, req.params.id, "APPROVE")
    return res.status(200).json(requestRow)
  } catch (err) {
    return next(err)
  }
}

export async function rejectNationalIdChangeHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    const { note } = decideNationalIdChangeSchema.parse(req.body)
    const requestRow = await decideNationalIdChangeRequest(req.user!, req.params.id, "REJECT", note)
    return res.status(200).json(requestRow)
  } catch (err) {
    return next(err)
  }
}
