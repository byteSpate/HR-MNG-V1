import { z } from "zod"

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")

const componentBody = z
  .object({
    code: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(["EARNING", "DEDUCTION"]),
    calc: z.enum(["FIXED", "PERCENT_OF_BASIC"]),
    value: z.coerce.number(),
    sortOrder: z.coerce.number().int().default(0),
    countsAsWages: z.coerce.boolean().default(true),
  })
  .refine(
    (c) => (c.calc === "PERCENT_OF_BASIC" ? c.value > 0 && c.value <= 100 : c.value >= 0),
    {
      message:
        "A PERCENT_OF_BASIC component must be greater than 0 and at most 100; a FIXED component cannot be negative",
      path: ["value"],
    }
  )

export const salaryStructureBody = z
  .object({
    name: z.string().min(1),
    currency: z.enum(["BDT", "USD"]),
    basic: z.coerce.number().positive("basic must be greater than 0"),
    isActive: z.coerce.boolean().default(true),
    /**
     * Optional, and empty is the ordinary case.
     *
     * A private-sector salary in Bangladesh is normally one negotiated
     * monthly figure: Finance defines the bands, HR puts people on them, and
     * nothing is split into allowances. A structure with no components pays
     * `basic` and is a complete, valid structure — `computePayslip` already
     * treats gross as basic plus zero earnings, so this needed no change to
     * the engine, only the removal of a rule that forbade the simple case.
     *
     * Components remain for the workplaces that do split pay; they are an
     * opt-in, not a tax every structure has to pay.
     */
    components: z.array(componentBody).default([]),
  })
  .refine((s) => new Set(s.components.map((c) => c.code)).size === s.components.length, {
    message: "Component codes must be unique within a structure",
    path: ["components"],
  })

export type SalaryStructureBody = z.infer<typeof salaryStructureBody>

/**
 * Structure updates go through the same shape. `currency` is accepted here
 * only so the service can detect and reject an attempted change with a 409 —
 * it is immutable after creation because changing it silently re-denominates
 * every figure already on the structure.
 */
export const salaryStructureUpdateBody = salaryStructureBody

export const exchangeRateBody = z
  .object({
    base: z.enum(["BDT", "USD"]),
    quote: z.enum(["BDT", "USD"]),
    rate: z.coerce.number().positive("rate must be greater than 0"),
    effectiveFrom: dateOnly,
  })
  .refine((r) => r.base !== r.quote, {
    message: "base and quote must be different currencies",
    path: ["quote"],
  })

export type ExchangeRateBody = z.infer<typeof exchangeRateBody>

/** A rate edit may touch any field; the row's identity is not privileged. */
export const exchangeRateUpdateBody = exchangeRateBody

export type ExchangeRateUpdateBody = z.infer<typeof exchangeRateUpdateBody>

export const createRunBody = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  notes: z.string().max(2000).optional(),
})
export type CreateRunBody = z.infer<typeof createRunBody>

/** Reused for a run rejection. A note is required — "why did this come back?" must always have an answer. */
export const rejectRunBody = z.object({
  note: z.string().min(1, "A note is required").max(1000),
})
export type RejectRunBody = z.infer<typeof rejectRunBody>

export const adjustmentBody = z.object({
  employeeId: z.string().min(1),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  kind: z.enum(["EARNING", "DEDUCTION"]),
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  currency: z.enum(["BDT", "USD"]).default("BDT"),
  amount: z.coerce.number().positive("amount must be greater than 0"),
  // Required. An unexplained line on someone's pay is a dispute waiting.
  reason: z.string().min(1, "A reason is required").max(500),
})
export type AdjustmentBody = z.infer<typeof adjustmentBody>

export const adjustmentQuery = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  employeeId: z.string().optional(),
})
export type AdjustmentQuery = z.infer<typeof adjustmentQuery>

export const payrollSettingsBody = z
  .object({
    deductLossOfPay: z.boolean(),
    recoverAssetsFromSalary: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "Send at least one setting to change." })
export type PayrollSettingsBody = z.infer<typeof payrollSettingsBody>
