"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { toMessage } from "@/components/dashboard/record-kit"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { Button } from "@/components/ui/button"
import {
  downloadExample,
  fetchImportGuide,
  type ExampleFormat,
  type ImportGuideColumn,
} from "@/lib/api/import-export"
import { useSession } from "@/lib/auth/session-context"

function notes(column: ImportGuideColumn): string {
  const parts: string[] = []
  if (column.description) parts.push(column.description)
  if (column.allowed.length > 0) parts.push(`Choose one: ${column.allowed.join(", ")}.`)
  return parts.join(" ")
}

/**
 * The column guide for an import, and the example files. It reads the same
 * column list the server checks every row with, so the guide cannot say one
 * thing while the importer does another.
 */
export function ImportGuide({ basePath }: { basePath: string }) {
  const { accessToken } = useSession()
  const [busy, setBusy] = useState<ExampleFormat | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const guide = useQuery({
    queryKey: ["import-guide", basePath],
    queryFn: () => fetchImportGuide(accessToken!, basePath),
    enabled: Boolean(accessToken),
  })

  async function download(format: ExampleFormat) {
    if (!accessToken || busy) return
    setBusy(format)
    setDownloadError(null)
    try {
      const blob = await downloadExample(accessToken, basePath, format)
      downloadBlob(blob, `example.${format}`)
    } catch (err) {
      setDownloadError(toMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-[#E4E9EF] bg-white px-4 py-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13.5px] font-bold">What your file needs</div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => download("xlsx")}>
            {busy === "xlsx" ? "Preparing…" : "Download Excel example"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => download("csv")}>
            {busy === "csv" ? "Preparing…" : "Download CSV example"}
          </Button>
        </div>
      </div>
      {downloadError ? (
        <p role="alert" className="text-[12.5px] font-semibold text-[#B03A3A]">
          {downloadError}
        </p>
      ) : null}

      {guide.isPending ? <p className="text-[12.5px] text-[#5F6B7C]">Loading the column guide…</p> : null}

      {guide.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-[12.5px] font-semibold text-[#B03A3A]">
            We could not load the column guide. You can still download the example file.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => guide.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {guide.data ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
            The first row of your file must hold the column names, written as shown here. Write dates as
            YYYY-MM-DD. One file can hold up to {guide.data.maxRows.toLocaleString("en-US")} rows. The Excel example has
            the same list on its Guide sheet.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-[#E4E9EF] text-[#5F6B7C]">
                  <th className="py-1.5 pr-3 font-semibold">Column</th>
                  <th className="py-1.5 pr-3 font-semibold">Type</th>
                  <th className="py-1.5 pr-3 font-semibold">Needed</th>
                  <th className="py-1.5 pr-3 font-semibold">Example</th>
                  <th className="py-1.5 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {guide.data.columns.map((column) => (
                  <tr key={column.header} className="border-b border-[#EEF1F5] align-top">
                    <td className="py-1.5 pr-3 font-mono font-semibold">{column.header}</td>
                    <td className="py-1.5 pr-3">{column.typeLabel}</td>
                    <td className="py-1.5 pr-3">{column.required ? "Yes" : "No"}</td>
                    <td className="py-1.5 pr-3 font-mono">{column.example}</td>
                    <td className="py-1.5 leading-snug">{notes(column)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}
