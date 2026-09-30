import type { NextFunction, Request, Response } from "express"

import { AppError } from "../../middleware/errorHandler"

import {
  approveRun,
  createExchangeRate,
  createAdjustment,
  createRun,
  createSalaryStructure,
  deleteAdjustment,
  deleteSalaryStructure,
  disburseRun,
  getEmployeePayslips,
  getMyPayslips,
  getPayslip,
  getRun,
  getRunPreflight,
  listAdjustments,
  listExchangeRates,
  listRuns,
  listSalaryStructures,
  processRun,
  rejectRun,
  submitRun,
  updateExchangeRate,
  updateSalaryStructure,
} from "./payroll.service"
import { emailPayslipsForRun, getEmailStatus } from "../../jobs/payslip-email.job"
import { bankFileSummary, buildBankFile } from "./payroll.bankfile"
import { getOrRenderPayslipPdf } from "./payroll.pdf"
import {
  adjustmentBody,
  adjustmentQuery,
  createRunBody,
  exchangeRateBody,
  exchangeRateUpdateBody,
  rejectRunBody,
  salaryStructureBody,
  salaryStructureUpdateBody,
  payrollSettingsBody,
} from "./payroll.validators"
import { getPayrollSettings, updatePayrollSettings } from "./payroll.settings"

type RequestWithId = Request<{ id: string }>

export async function listRatesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listExchangeRates())
  } catch (err) {
    return next(err)
  }
}

export async function createRateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = exchangeRateBody.parse(req.body)
    return res.status(201).json(await createExchangeRate(req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

export async function updateRateHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = exchangeRateUpdateBody.parse(req.body)
    return res.status(200).json(await updateExchangeRate(req.params.id, req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

export async function listStructuresHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listSalaryStructures())
  } catch (err) {
    return next(err)
  }
}

export async function createStructureHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = salaryStructureBody.parse(req.body)
    return res.status(201).json(await createSalaryStructure(req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

export async function updateStructureHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    const body = salaryStructureUpdateBody.parse(req.body)
    return res.status(200).json(await updateSalaryStructure(req.params.id, req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

export async function deleteStructureHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await deleteSalaryStructure(req.params.id, req.user!.sub))
  } catch (err) {
    return next(err)
  }
}

export async function listRunsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listRuns())
  } catch (err) {
    return next(err)
  }
}

export async function getRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getRun(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function getRunPreflightHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getRunPreflight(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createRunBody.parse(req.body)
    return res.status(201).json(await createRun(req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

export async function processRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await processRun(req.params.id, req.user!.sub))
  } catch (err) {
    return next(err)
  }
}

export async function submitRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await submitRun(req.params.id, req.user!.sub))
  } catch (err) {
    return next(err)
  }
}

export async function approveRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await approveRun(req.params.id, req.user!.sub))
  } catch (err) {
    return next(err)
  }
}

export async function rejectRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = rejectRunBody.parse(req.body)
    return res.status(200).json(await rejectRun(req.params.id, req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

export async function disburseRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await disburseRun(req.params.id, req.user!.sub))
  } catch (err) {
    return next(err)
  }
}

export async function getMyPayslipsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getMyPayslips(req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getEmployeePayslipsHandler(
  req: Request<{ employeeId: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getEmployeePayslips(req.user!, req.params.employeeId))
  } catch (err) {
    return next(err)
  }
}

export async function getPayslipHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getPayslip(req.user!, req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function listAdjustmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listAdjustments(adjustmentQuery.parse(req.query)))
  } catch (err) {
    return next(err)
  }
}

export async function createAdjustmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = adjustmentBody.parse(req.body)
    return res.status(201).json(await createAdjustment(req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

export async function deleteAdjustmentHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await deleteAdjustment(req.params.id, req.user!.sub))
  } catch (err) {
    return next(err)
  }
}

const bankFileCurrency = (value: unknown) => {
  const currency = typeof value === "string" ? value.toUpperCase() : "BDT"
  if (currency !== "BDT" && currency !== "USD") {
    throw new AppError(400, `Unknown currency "${currency}" — expected BDT or USD`)
  }
  return currency
}

export async function bankFileHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const currency = bankFileCurrency(req.query.currency)
    const result = await buildBankFile(req.params.id, currency)
    // The manifest travels in headers so a browser download still carries
    // the completeness evidence, and JSON callers can read it too.
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    const filename = `payroll-${result.manifest.year}-${String(result.manifest.month).padStart(2, "0")}-${currency}.csv`
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.setHeader("X-Bankfile-Manifest", JSON.stringify(result.manifest))
    return res.status(200).send(result.csv)
  } catch (err) {
    return next(err)
  }
}

export async function bankFileSummaryHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await bankFileSummary(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function payslipPdfHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    // Reuses the same scoping as the JSON read, so a PDF cannot leak a
    // payslip the caller may not see.
    const payslip = await getPayslip(req.user!, req.params.id)
    const pdf = await getOrRenderPayslipPdf(payslip.id)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `inline; filename="${payslip.payslipNo}.pdf"`)
    return res.status(200).send(pdf)
  } catch (err) {
    return next(err)
  }
}

export async function emailRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const run = await getRun(req.params.id)
    if (run.status !== "APPROVED" && run.status !== "DISBURSED") {
      throw new AppError(409, "Payslips can only be emailed once the run is approved")
    }
    // Queued, not awaited: the response returns immediately and progress is
    // polled via /email-status.
    void emailPayslipsForRun(req.params.id).catch((err) => {
      console.error("[payslip email] run failed", err)
    })
    return res.status(202).json({ queued: true, runId: req.params.id })
  } catch (err) {
    return next(err)
  }
}

export async function emailStatusHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getEmailStatus(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function getSettingsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getPayrollSettings())
  } catch (err) {
    return next(err)
  }
}

export async function updateSettingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = payrollSettingsBody.parse(req.body)
    return res.status(200).json(await updatePayrollSettings(req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}
