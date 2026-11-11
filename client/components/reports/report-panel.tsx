"use client"

import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiDownloadLine, RiFileTextLine, RiRefreshLine } from "@remixicon/react"

import type { ExportFormat, QueryValue } from "@/lib/api/import-export"
import { downloadReport, formatReportCell, getReport, screenColumns } from "@/lib/api/reports"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { MiniStat } from "@/components/dashboard/page-header"
import { PanelAlert, PanelTable, TONE, toMessage } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * One report: its filters, three download buttons, the numbers from the
 * server, and the table. The Employee, Leave and Payroll reports each pass
 * their own filters and path. Every number comes from the server.
 */
export function ReportPanel({
  accessToken,
  path,
  name,
  params,
  ready = true,
  notReadyMessage,
  filters,
  emptyTitle,
  emptyBody,
}: {
  accessToken: string
  /** Like `/api/leave/report`. */
  path: string
  /** Used in the query key and the file name, like `leave-report`. */
  name: string
  params: Record<string, QueryValue>
  /** False while the filters ask for something the server would refuse. */
  ready?: boolean
  notReadyMessage?: string
  filters: ReactNode
  emptyTitle: string
  emptyBody: string
}) {
  const [downloading, setDownloading] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ["reports", name, params],
    queryFn: () => getReport(accessToken, path, params),
    enabled: !!accessToken && ready,
  })

  async function download(format: ExportFormat) {
    setDownloading(format)
    setError(null)
    try {
      const blob = await downloadReport(accessToken, path, params, format)
      downloadBlob(blob, `${name}.${format}`)
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setDownloading(null)
    }
  }

  const report = query.data
  const blocked = downloading !== null || !ready || !report || query.isPending
  const columns = report ? screenColumns(report) : []
  const rows: TableCell[][] = (report?.rows ?? []).map((row) =>
    columns.map((c, i) => ({
      text: formatReportCell(row[c.index], c.column) || " ",
      ...(i === 1 ? { weight: 600 } : {}),
    }))
  )

  return (
    <>
      <div className="rounded-md border border-line bg-white px-5 py-4.5">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          {filters}
          {/* Downloading a report that did not load would download an error. */}
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" disabled={blocked} onClick={() => download("pdf")}>
              <RiFileTextLine className="size-3.5" aria-hidden />
              {downloading === "pdf" ? "Preparing…" : "Download PDF"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={blocked} onClick={() => download("xlsx")}>
              <RiDownloadLine className="size-3.5" aria-hidden />
              {downloading === "xlsx" ? "Preparing…" : "Excel"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={blocked} onClick={() => download("csv")}>
              <RiDownloadLine className="size-3.5" aria-hidden />
              {downloading === "csv" ? "Preparing…" : "CSV"}
            </Button>
          </div>
        </div>
      </div>

      {!ready && notReadyMessage ? (
        <div className="mt-3.5">
          <PanelAlert>{notReadyMessage}</PanelAlert>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3.5">
          {/* Shown as the server wrote it: it says what to change. */}
          <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert>
        </div>
      ) : null}

      {report && !query.isPending ? (
        <>
          {report.filterNote ? (
            <p className={`mt-3.5 text-caption ${TONE.muted}`}>Showing: {report.filterNote}</p>
          ) : null}
          <div className="mt-2 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {report.summary.map((s) => (
              <MiniStat key={s.label} label={s.label} value={s.value} sub="in this report" />
            ))}
          </div>
        </>
      ) : null}

      <div className="mt-3.5">
        <PanelTable
          cols={`repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`}
          headers={columns.map((c) => c.label)}
          rows={rows}
          isLoading={query.isPending && ready}
          isError={query.isError}
          onRetry={() => query.refetch()}
          emptyTitle={emptyTitle}
          emptyBody={emptyBody}
          emptyAction="Refresh"
          onEmptyAction={() => query.refetch()}
          emptyActionIcon={<RiRefreshLine className="size-4" aria-hidden />}
        />
      </div>
    </>
  )
}

/** A labelled drop-down, the way every report filter looks. */
export function ReportSelect({
  label,
  value,
  onChange,
  options,
  width = "w-44",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  width?: string
}) {
  const items = Object.fromEntries(options.map((o) => [o.value, o.label]))
  return (
    <div className={width}>
      <Label className="mb-1.5 block text-xs font-bold">{label}</Label>
      <Select items={items} value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
