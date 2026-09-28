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
          <div className="mt-4 rounded-md border border-[#E4E9EF] bg-white p-4">
            <h3 className="text-[12.5px] font-bold">VAT typed by hand</h3>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3">
                <dt className={TONE.muted}>On invoices</dt>
                <dd className="tabular-nums">{formatMoney(summary.data.typedOnInvoices, "BDT")}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className={TONE.muted}>On supplier bills</dt>
                <dd className="tabular-nums">{formatMoney(summary.data.typedOnBills, "BDT")}</dd>
              </div>
            </dl>
            <p className={cn("mt-2 text-[12px]", TONE.muted)}>
              These amounts are already inside the totals above. They show how much came from a VAT % typed on a line, not
              from a VAT code.
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
