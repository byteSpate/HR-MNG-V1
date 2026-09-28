"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { listFinancialYears } from "@/lib/api/accounting"
import { getVatSummary } from "@/lib/api/dealMoney"
import { useSession } from "@/lib/auth/session-context"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { PeriodControl } from "@/components/statements/period-control"
import { presetRange, type Preset, type Range } from "@/components/statements/statements-shared"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** A bordered card with a big number, matching `money-numbers.tsx`'s `Tile` —
 *  not imported from there since that one is private to its own file. */
/** total less typed, to the paisa. Never negative: a typed line's VAT is
 *  inside its document's total, so the remainder cannot go below zero. */
function less(total: string, typed: string): string {
  const value = Number(total) - Number(typed)
  return (Number.isFinite(value) && value > 0 ? value : 0).toFixed(2)
}

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
      <div className="text-[11.5px] font-bold tracking-wide text-[#5F6B7C] uppercase">{label}</div>
      <div
        className={cn(
          "font-heading mt-1.5 text-[20px] font-bold tracking-tight tabular-nums sm:text-[22px]",
          danger ? "text-[#B03A3A]" : "text-[#17191C]"
        )}
      >
        {value}
      </div>
    </div>
  )
}

function VatSummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2.5 h-6 w-24" />
        </div>
      ))}
    </div>
  )
}

/**
 * VAT on invoices and supplier bills for a period. Not a VAT return — the
 * app records VAT, it does not file it (`dealMoney.vatSummary.ts`).
 */
export function VatSummaryPage() {
  const { accessToken } = useSession()

  const [financialYearId, setFinancialYearId] = useState("")
  const [preset, setPreset] = useState<Preset>("YEAR")
  const [index, setIndex] = useState(0)
  const [customRange, setCustomRange] = useState<Range>({ from: "", to: "" })

  const years = useQuery({
    queryKey: ["accounting", "financial-years"],
    queryFn: () => listFinancialYears(accessToken!),
    enabled: Boolean(accessToken),
  })

  // Default to the most recent year, the one someone opening this page
  // almost always wants. Derived, so there is no effect to sync.
  const latestId = years.data?.length
    ? [...years.data].sort((a, b) => b.startDate.localeCompare(a.startDate))[0].id
    : ""
  const effectiveFinancialYearId = financialYearId || latestId
  const fy = years.data?.find((y) => y.id === effectiveFinancialYearId)

  // The preset drives the range, except in CUSTOM where the user does.
  const range = preset === "CUSTOM" ? customRange : fy ? presetRange(preset, fy, index) : { from: "", to: "" }

  const ready = Boolean(accessToken && range.from && range.to)

  const summary = useQuery({
    queryKey: ["deal-money", "vat-summary", range.from, range.to],
    queryFn: () => getVatSummary(accessToken!, range.from, range.to),
    enabled: ready,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Accounting"
        title="VAT summary"
        sub="VAT on invoices and supplier bills for a period."
      />

      <PeriodControl
        years={years.data ?? []}
        financialYearId={effectiveFinancialYearId}
        onFinancialYearChange={setFinancialYearId}
        preset={preset}
        onPresetChange={(p) => {
          setPreset(p)
          setIndex(0)
        }}
        index={index}
        onIndexChange={setIndex}
        range={range}
        onRangeChange={setCustomRange}
        comparativeLabel={null}
      />

      {summary.isPending ? (
        <VatSummarySkeleton />
      ) : summary.isError ? (
        <PanelAlert>{toMessage(summary.error)}</PanelAlert>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="VAT on invoices" value={formatMoney(summary.data.onInvoices, "BDT")} />
            <Tile label="VAT on supplier bills" value={formatMoney(summary.data.onBills, "BDT")} />
            {/* No danger styling here: a negative difference means more VAT
                was paid on bills than collected on invoices this period,
                which is a fact about the mix of activity, not a loss the
                way a negative profit is. Styling it red would imply
                something the number does not say. */}
            <Tile label="Difference" value={formatMoney(summary.data.difference, "BDT")} />
            <Tile label="Withheld by customers" value={formatMoney(summary.data.withheldByCustomers, "BDT")} />
          </div>
          {/* The two rows are the total above, split by where the rate came
              from (spec 2026-09-28 §1.6). "From a VAT code" is the total less
              the typed part, worked out here rather than asked for separately:
              two queries for one subtraction would let the two halves drift
              apart, and then neither would be the total. */}
          <div className="mt-4 rounded-md border border-[#E4E9EF] bg-white p-4">
            <h3 className="text-[12.5px] font-bold">Where the VAT came from</h3>
            <table className="mt-2 w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px]">
                  <th scope="col" className={`py-1 font-semibold ${TONE.muted}`}>Source</th>
                  <th scope="col" className={`py-1 text-right font-semibold ${TONE.muted}`}>On invoices</th>
                  <th scope="col" className={`py-1 text-right font-semibold ${TONE.muted}`}>On supplier bills</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[#EEF1F5]">
                  <th scope="row" className="py-1.5 text-left font-semibold">From a VAT code</th>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatMoney(less(summary.data.onInvoices, summary.data.typedOnInvoices), "BDT")}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatMoney(less(summary.data.onBills, summary.data.typedOnBills), "BDT")}
                  </td>
                </tr>
                <tr className="border-t border-[#EEF1F5]">
                  <th scope="row" className="py-1.5 text-left font-semibold text-[#8A5E0C]">Typed by hand</th>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(summary.data.typedOnInvoices, "BDT")}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(summary.data.typedOnBills, "BDT")}</td>
                </tr>
                <tr className="border-t border-[#E4E9EF] font-bold">
                  <th scope="row" className="py-1.5 text-left">Total</th>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(summary.data.onInvoices, "BDT")}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(summary.data.onBills, "BDT")}</td>
                </tr>
              </tbody>
            </table>
            <p className={cn("mt-2 text-[12px]", TONE.muted)}>
              These amounts are already inside the totals above, not extra. &quot;Typed by hand&quot; is the VAT % someone
              typed on a line rather than taking from a VAT code in Settings.
            </p>
          </div>
          <p className={cn("text-[12px]", TONE.muted)}>
            This is not a VAT return. The app records VAT; it does not file it.
          </p>
        </div>
      )}
    </div>
  )
}
