"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { PanelAlert, PanelNotice, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { getPayrollSettings, updatePayrollSettings } from "@/lib/api/payroll"
import type { PayrollSettings } from "@/lib/api/payroll-types"

interface Rule {
  key: keyof PayrollSettings
  title: string
  body: string
  /** Shown only while the box is off. */
  whenOff?: string
}

const RULES: Rule[] = [
  {
    key: "deductLossOfPay",
    title: "Take pay away for absent days and unpaid leave",
    body: "When this is on, each absent day and each unpaid leave day lowers the salary by one day of the month. When this is off, everyone gets the full salary. The payslip still shows the absent days.",
    whenOff: "With this off, attendance does not need to be approved before you process payroll.",
  },
  {
    key: "recoverAssetsFromSalary",
    title: "Take money from salary for lost or damaged assets",
    body: "When this is on, HR can take the cost of a lost or damaged asset from an employee's salary. When this is off, nothing is taken. HR can still record the loss, and can waive it.",
    whenOff: "A recovery that is already waiting is skipped. It stays on the list.",
  },
]

export function PayrollSettingsPanel({ accessToken }: { accessToken: string }) {
  const queryClient = useQueryClient()
  // What the person has ticked but not saved yet.
  const [draft, setDraft] = useState<Partial<PayrollSettings>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["payroll-settings"],
    queryFn: () => getPayrollSettings(accessToken),
  })

  const saveMutation = useMutation({
    mutationFn: (input: Partial<PayrollSettings>) => updatePayrollSettings(accessToken, input),
    onSuccess: () => {
      setDraft({})
      setError(null)
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ["payroll-settings"] })
    },
    onError: (err) => {
      setSaved(false)
      setError(toMessage(err))
    },
  })

  const valueOf = (key: keyof PayrollSettings) => draft[key] ?? data?.[key] ?? true
  // Only what really differs from what is saved.
  const changes: Partial<PayrollSettings> = {}
  if (data) {
    for (const { key } of RULES) {
      if (draft[key] !== undefined && draft[key] !== data[key]) changes[key] = draft[key]
    }
  }
  const changed = Object.keys(changes).length > 0

  return (
    <section className="space-y-4">
      <header>
        <h2 className="font-heading text-[16px] font-bold tracking-tight">Payroll rules</h2>
        <p className="mt-1 text-[12.5px] text-[#5F6B7C]">Rules that change how pay is worked out.</p>
      </header>

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}
      {saved ? <PanelNotice onDismiss={() => setSaved(false)}>Saved.</PanelNotice> : null}

      {isLoading ? (
        <Skeleton className="h-40 w-full max-w-2xl" />
      ) : isError ? (
        <PanelAlert>
          Payroll rules did not load.{" "}
          <button type="button" onClick={() => refetch()} className="underline">
            Try again
          </button>
        </PanelAlert>
      ) : (
        <div className="max-w-2xl divide-y divide-[#E4E9EF] rounded-md border border-[#E4E9EF] bg-white">
          {RULES.map((rule) => {
            const on = valueOf(rule.key)
            return (
              <div key={rule.key} className="px-5 py-4.5">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(checked) => {
                      setSaved(false)
                      setDraft((d) => ({ ...d, [rule.key]: checked === true }))
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-bold text-[#1C2733]">{rule.title}</span>
                    <span className="mt-1 block text-[12.5px] leading-relaxed text-[#5F6B7C]">
                      {rule.body}
                    </span>
                  </span>
                </label>
                {!on && rule.whenOff ? (
                  <p className="mt-3 pl-7 text-[12.5px] leading-relaxed text-[#5F6B7C]">
                    {rule.whenOff}
                  </p>
                ) : null}
              </div>
            )
          })}

          <div className="px-5 py-4.5">
            <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
              A change is used when you process a run. A draft run must be processed again. A run
              that is already approved does not change.
            </p>
            <div className="mt-4">
              <Button
                type="button"
                size="sm"
                disabled={!changed || saveMutation.isPending}
                onClick={() => saveMutation.mutate(changes)}
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
