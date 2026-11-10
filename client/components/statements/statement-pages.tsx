"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { RiDownloadLine, RiErrorWarningLine } from "@remixicon/react"

import {
  downloadStatementsPdf,
  getChangesInEquity,
  getFinancialPosition,
  getProfitOrLoss,
} from "@/lib/api/statements"
import { ApiError } from "@/lib/api/client"
import { sides } from "@/lib/accounting/side-style"
import type { UnbalancedDetails } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, toMessage } from "@/components/dashboard/record-kit"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EquityTable } from "@/components/statements/equity-table"
import { PeriodControl } from "@/components/statements/period-control"
import { StatementTable } from "@/components/statements/statement-table"
import type { Range } from "@/components/statements/statements-shared"
import { useAccountingBase, useStatementPeriod } from "@/components/statements/use-statement-period"
import { Heading } from "@/components/ds/heading"
import { Text } from "@/components/ds/text"

/**
 * The three core statements, one page each. They were three tabs on one
 * "Financial statements" page; the owner asked for separate pages with the
 * everyday names (2026-11-09). The formal names stay in each page's subtitle
 * and in the PDF, which is what the auditor files.
 */

/**
 * Spec Decision 8. An unbalanced trial balance blocks every statement: no
 * figures at all, because a statement that silently does not add up is worse
 * than none, and someone will screenshot it.
 */
function BlockedPanel({ details, range }: { details: UnbalancedDetails; range: Range }) {
  const base = useAccountingBase()
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <RiErrorWarningLine className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="space-y-3">
          <div>
            <Heading level="section">The trial balance does not agree</Heading>
            <Text variant="muted">
              The statements cannot be shown until it does. Open the trial balance to find the difference.
            </Text>
          </div>
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className={sides.sideText("debit")}>Debit</dt>
              <dd className="tabular-nums">{details.debitTotal}</dd>
            </div>
            <div>
              <dt className={sides.sideText("credit")}>Credit</dt>
              <dd className="tabular-nums">{details.creditTotal}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Difference</dt>
              <dd className="font-medium tabular-nums">{details.difference}</dd>
            </div>
          </dl>
          <Button
            nativeButton={false}
            variant="outline"
            size="sm"
            render={<Link href={`${base}/trial-balance?from=${range.from}&to=${range.to}`} />}
          >
            Open the trial balance
          </Button>
        </div>
      </div>
    </div>
  )
}

function unbalanced(error: unknown): UnbalancedDetails | null {
  if (error instanceof ApiError && error.status === 409 && error.details?.difference) {
    return sides.totals(error.details as unknown as UnbalancedDetails)
  }
  return null
}

/** The header, the period, the PDF button and the four states, the same on all three pages. */
function StatementShell<T>({
  title,
  sub,
  query,
  comparativeLabel,
  skeletonClass = "h-96",
  children,
}: {
  title: string
  sub: string
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined }
  comparativeLabel: string | null
  skeletonClass?: string
  children: (data: T) => ReactNode
}) {
  const { accessToken, range, ready, control } = useStatementPeriod()
  const block = unbalanced(query.error)

  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  async function download() {
    setDownloadError(null)
    setDownloading(true)
    try {
      const blob = await downloadStatementsPdf(accessToken!, range)
      // Shared with the payslip download rather than hand-rolled again: the
      // anchor has to be in the document for Firefox to honour the click, and
      // the object URL cannot be revoked in the same task as the click.
      downloadBlob(blob, `financial-statements-${range.to}.pdf`)
    } catch (error) {
      setDownloadError(toMessage(error))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Statements"
        title={title}
        sub={sub}
        aside={
          <Button
            size="sm"
            variant="outline"
            onClick={download}
            // An unbalanced trial balance already refuses the PDF on the server,
            // so offering it here would only be offering an error.
            disabled={!ready || downloading || block !== null}
          >
            <RiDownloadLine className="size-4" />
            {downloading ? "Preparing…" : "Download PDF"}
          </Button>
        }
      />

      <PeriodControl {...control} comparativeLabel={comparativeLabel} />

      {downloadError ? <PanelAlert onDismiss={() => setDownloadError(null)}>{downloadError}</PanelAlert> : null}

      {!ready || query.isPending ? (
        <Skeleton className={`${skeletonClass} w-full`} />
      ) : block ? (
        <BlockedPanel details={block} range={range} />
      ) : query.isError ? (
        <PanelAlert>
          {query.error instanceof ApiError ? query.error.message : "This statement did not load. Please try again."}
        </PanelAlert>
      ) : (
        children(query.data as T)
      )}
    </div>
  )
}

export function IncomeStatementPage() {
  const { accessToken, range, ready } = useStatementPeriod()
  const pnl = useQuery({
    queryKey: ["statements", range.from, range.to, "pnl"],
    queryFn: () => getProfitOrLoss(accessToken!, range),
    enabled: ready,
    retry: false,
  })

  return (
    <StatementShell
      title="Income statement"
      sub="Money earned, less costs, for the period. Its formal name is the Statement of Profit or Loss. The grey column is the same period a year earlier."
      query={pnl}
      comparativeLabel={pnl.data?.comparative.label ?? null}
    >
      {(data) => (
        <StatementTable
          currentLabel={data.period.label}
          comparativeLabel={data.comparative.label}
          range={range}
          groups={[{ heading: null, lines: data.lines }]}
        />
      )}
    </StatementShell>
  )
}

export function BalanceSheetPage() {
  const { accessToken, range, ready } = useStatementPeriod()
  const position = useQuery({
    queryKey: ["statements", range.from, range.to, "position"],
    queryFn: () => getFinancialPosition(accessToken!, range),
    enabled: ready,
    retry: false,
  })

  return (
    <StatementShell
      title="Balance sheet"
      sub="What the company owns and owes on the last day of the period. Its formal name is the Statement of Financial Position. The two totals must be the same."
      query={position}
      comparativeLabel={position.data?.comparative.label ?? null}
    >
      {(data) => (
        <StatementTable
          currentLabel={data.period.label}
          comparativeLabel={data.comparative.label}
          range={range}
          groups={[
            ...data.assets.map((s) => ({
              heading: s.heading,
              lines: s.lines,
              total: { label: `Total ${s.heading}`, ...s.subtotal },
            })),
            { heading: null, lines: [], total: { label: "Total Assets", ...data.totalAssets } },
            ...data.equityAndLiabilities.map((s) => ({
              heading: s.heading,
              lines: s.lines,
              total: { label: `Total ${s.heading}`, ...s.subtotal },
            })),
            {
              heading: null,
              lines: [],
              total: { label: "Total Shareholders' Equity & Liabilities", ...data.totalEquityAndLiabilities },
            },
          ]}
        />
      )}
    </StatementShell>
  )
}

export function ChangesInEquityPage() {
  const { accessToken, range, ready } = useStatementPeriod()
  const equity = useQuery({
    queryKey: ["statements", range.from, range.to, "equity"],
    queryFn: () => getChangesInEquity(accessToken!, range),
    enabled: ready,
    retry: false,
  })

  return (
    <StatementShell
      title="Changes in equity"
      sub="How the owners' share of the company moved during the period: new share money, profit or loss, and retained earnings."
      query={equity}
      comparativeLabel={null}
      skeletonClass="h-64"
    >
      {(data) => <EquityTable result={data} />}
    </StatementShell>
  )
}
