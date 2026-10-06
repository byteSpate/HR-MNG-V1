"use client"

import { useMutation } from "@tanstack/react-query"

import { downloadReceiptPdf } from "@/lib/api/receipt"
import { useSession } from "@/lib/auth/session-context"
import { downloadBlob } from "@/components/payroll/payroll-shared"

/**
 * Download the money receipt PDF of one payment. Used by the Paid part and by
 * the payment list on each invoice, so both save the file the same way and say
 * the same thing when it fails. The server checks access to the Opportunity.
 */
export function useReceiptPdf(onError: (message: string) => void) {
  const { accessToken } = useSession()
  return useMutation({
    mutationFn: async (receipt: { id: string; number: string }) => ({
      blob: await downloadReceiptPdf(accessToken!, receipt.id),
      number: receipt.number,
    }),
    onSuccess: ({ blob, number }) => downloadBlob(blob, `${number}.pdf`),
    onError: () => onError("Could not download the receipt. Please try again."),
  })
}
