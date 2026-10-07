"use client"

import { useMutation } from "@tanstack/react-query"

import { downloadSupplierPaymentPdf } from "@/lib/api/supplierPayment"
import { useSession } from "@/lib/auth/session-context"
import { downloadBlob } from "@/components/payroll/payroll-shared"

/**
 * Download the payment voucher PDF of one supplier payment. Only Finance and
 * Super Admin see supplier money, and the server checks that again.
 */
export function useSupplierPaymentPdf(onError: (message: string) => void) {
  const { accessToken } = useSession()
  return useMutation({
    mutationFn: async (payment: { id: string; number: string }) => ({
      blob: await downloadSupplierPaymentPdf(accessToken!, payment.id),
      number: payment.number,
    }),
    onSuccess: ({ blob, number }) => downloadBlob(blob, `${number}.pdf`),
    onError: () => onError("Could not download the payment voucher. Please try again."),
  })
}
