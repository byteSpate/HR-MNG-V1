import { z } from "zod"

const positiveMoney = z.string().refine((v) => Number(v) > 0, "Must be greater than zero")
const nonNegativeMoney = z.string().refine((v) => Number(v) >= 0, "Cannot be negative")
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

export const createReceiptSchema = z.object({
  // The one deal this receipt belongs to (spec: every document belongs to
  // one deal). No customerId: it is derived from the deal's customer, never
  // taken from the caller.
  opportunityId: z.string().uuid(),
  date: dateString,
  // Cash that reached the bank. > 0: a receipt with no cash and no
  // withheld tax is not a receipt.
  amount: positiveMoney,
  vdsAmount: nonNegativeMoney.default("0"),
  vdsCertificateRef: z.string().trim().min(1).optional(),
  vdsCertificateDate: dateString.optional(),
  aitAmount: nonNegativeMoney.default("0"),
  aitCertificateRef: z.string().trim().min(1).optional(),
  aitCertificateDate: dateString.optional(),
  reference: z.string().trim().max(200).optional(),
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: positiveMoney })).min(1, "A receipt must be allocated to at least one invoice"),
})

export const certificatesSchema = z.object({
  vdsCertificateRef: z.string().trim().min(1).nullable().optional(),
  vdsCertificateDate: dateString.nullable().optional(),
  aitCertificateRef: z.string().trim().min(1).nullable().optional(),
  aitCertificateDate: dateString.nullable().optional(),
})

export const reverseReceiptSchema = z.object({
  reason: z.string().trim().min(1, "Write why this is being reversed."),
})

export type CreateReceiptInput = z.infer<typeof createReceiptSchema>
export type CertificatesInput = z.infer<typeof certificatesSchema>
export type ReverseReceiptInput = z.infer<typeof reverseReceiptSchema>
