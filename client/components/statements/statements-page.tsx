"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { RiDownloadLine, RiErrorWarningLine } from "@remixicon/react"

import { listFinancialYears } from "@/lib/api/accounting"
import {
  downloadStatementsPdf,
  getChangesInEquity,
  getFinancialPosition,
  getProfitOrLoss,
} from "@/lib/api/statements"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { UnbalancedDetails } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EquityTable } from "@/components/statements/equity-table"
import { PeriodControl } from "@/components/statements/period-control"
import { StatementTable } from "@/components/statements/statement-table"
import { presetRange, type Preset, type Range } from "@/components/statements/statements-shared"

/**
 * Spec Decision 8. An unbalanced trial balance blocks every statement — no
 * figures at all, because a statement that silently does not add up is worse
 * than none, and someone will screenshot it.
 */
function BlockedPanel({ details, range }: { details: UnbalancedDetails; range: Range }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <RiErrorWarningLine className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="space-y-3">
          <div>
            <h2 className="font-medium">The trial balance does not agree</h2>
            <p className="text-sm text-muted-foreground">
              Financial statements cannot be produced until it does.
            </p>
          </div>
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Debit</dt>
              <dd className="tabular-nums">{details.debitTotal}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Credit</dt>
              <dd className="tabular-nums">{details.creditTotal}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Difference</dt>
              <dd className="font-medium tabular-nums">{details.difference}</dd>
            </div>
          </dl>
          <Button nativeButton={false} variant="outline" size="sm" render={<Link href={`../trial-balance?from=${range.from}&to=${range.to}`} />}>
            Open the trial balance
          </Button>
        </div>
      </div>
    </div>
  )
}

function unbalanced(error: unknown): UnbalancedDetails | null {
  if (error instanceof ApiError && error.status === 409 && error.details?.difference) {
    return error.details as unknown as UnbalancedDetails
  }
  return null
}

type Tab = "pnl" | "position" | "equity"

export function StatementsPage() {
  const { accessToken } = useSession()

  const [tab, setTab] = useState<Tab>("pnl")
  const [financialYearId, setFinancialYearId] = useState("")
  const [preset, setPreset] = useState<Preset>("YEAR")
  const [index, setIndex] = useState(0)
  const [customRange, setCustomRange] = useState<Range>({ from: "", to: "" })

  const years = useQuery({
    queryKey: ["accounting", "financial-years"],
    queryFn: () => listFinancialYears(accessToken!),
    enabled: Boolean(accessToken),
  })

  // Default to the most recent year, which is the one someone opening this
  // page almost always wants. Derived, so there is no effect to sync.
  const latestId = years.data?.length
    ? [...years.data].sort((a, b) => b.startDate.localeCompare(a.startDate))[0].id
    : ""
  const effectiveFinancialYearId = financialYearId || latestId
  const fy = years.data?.find((y) => y.id === effectiveFinancialYearId)

  // The preset drives the range, except in CUSTOM where the user does.
  const range = preset === "CUSTOM" ? customRange : (fy ? presetRange(preset, fy, index) : { from: "", to: "" })

  const ready = Boolean(accessToken && range.from && range.to)
  const key = ["statements", range.from, range.to] as const

  const pnl = useQuery({
    queryKey: [...key, "pnl"],
    queryFn: () => getProfitOrLoss(accessToken!, range),
    enabled: ready,
    retry: false,
  })
  const position = useQuery({
    queryKey: [...key, "position"],
    queryFn: () => getFinancialPosition(accessToken!, range),
    enabled: ready,
    retry: false,
  })
  const equity = useQuery({
    queryKey: [...key, "equity"],
    queryFn: () => getChangesInEquity(accessToken!, range),
    enabled: ready,
    retry: false,
  })

  const block = useMemo(
    () => unbalanced(pnl.error) ?? unbalanced(position.error) ?? unbalanced(equity.error),
    [pnl.error, position.error, equity.error]
  )

  const currentLabel = pnl.data?.period.label ?? position.data?.period.label ?? "Current"
  const comparativeLabel = pnl.data?.comparative.label ?? position.data?.comparative.label ?? ""

  const [downloading, setDownloading] = useState(false)

  async function download() {
    setDownloading(true)
    try {
      const blob = await downloadStatementsPdf(accessToken!, range)
      // Shared with the payslip download rather than hand-rolled again: the
      // anchor has to be in the document for Firefox to honour the click, and
      // the object URL cannot be revoked in the same task as the click.
      downloadBlob(blob, `financial-statements-${range.to}.pdf`)
    } catch {
      toast.error("Could not generate the PDF")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Accounting"
        title="Financial statements"
        sub="Profit or loss, financial position and changes in equity, against the same period a year earlier."
        aside={
          <Button
            size="sm"
            variant="outline"
            onClick={download}
            // An unbalanced trial balance already refuses the PDF server-side,
            // so offering it here would only be offering an error.
            disabled={!ready || downloading || block !== null}
          >
            <RiDownloadLine className="size-4" />
            {downloading ? "Preparing…" : "Download PDF"}
          </Button>
        }
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
        comparativeLabel={comparativeLabel || null}
      />

      {block ? (
        <BlockedPanel details={block} range={range} />
      ) : (
        <Tabs value={tab} onValueChange={(next) => next && setTab(next as Tab)}>
          <TabsList>
            <TabsTrigger value="pnl">Profit or Loss</TabsTrigger>
            <TabsTrigger value="position">Financial Position</TabsTrigger>
            <TabsTrigger value="equity">Changes in Equity</TabsTrigger>
          </TabsList>

          <TabsContent value="pnl" className="mt-4">
            {pnl.isPending ? (
              <Skeleton className="h-96 w-full" />
            ) : pnl.isError ? (
              <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                {pnl.error instanceof ApiError ? pnl.error.message : "Could not load this statement."}
              </p>
            ) : (
              <StatementTable
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                range={range}
                groups={[{ heading: null, lines: pnl.data!.lines }]}
              />
            )}
          </TabsContent>

          <TabsContent value="position" className="mt-4">
            {position.isPending ? (
              <Skeleton className="h-96 w-full" />
            ) : position.isError ? (
              <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                {position.error instanceof ApiError
                  ? position.error.message
                  : "Could not load this statement."}
              </p>
            ) : (
              <StatementTable
                currentLabel={currentLabel}
                comparativeLabel={comparativeLabel}
                range={range}
                groups={[
                  ...position.data!.assets.map((s) => ({
                    heading: s.heading,
                    lines: s.lines,
                    total: { label: `Total ${s.heading}`, ...s.subtotal },
                  })),
                  {
                    heading: null,
                    lines: [],
                    total: { label: "Total Assets", ...position.data!.totalAssets },
                  },
                  ...position.data!.equityAndLiabilities.map((s) => ({
                    heading: s.heading,
                    lines: s.lines,
                    total: { label: `Total ${s.heading}`, ...s.subtotal },
                  })),
                  {
                    heading: null,
                    lines: [],
                    total: {
                      label: "Total Shareholders' Equity & Liabilities",
                      ...position.data!.totalEquityAndLiabilities,
                    },
                  },
                ]}
              />
            )}
          </TabsContent>

          <TabsContent value="equity" className="mt-4">
            {equity.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : equity.isError ? (
              <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                {equity.error instanceof ApiError
                  ? equity.error.message
                  : "Could not load this statement."}
              </p>
            ) : (
              <EquityTable result={equity.data!} />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
