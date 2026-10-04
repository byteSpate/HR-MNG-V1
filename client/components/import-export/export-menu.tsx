"use client"

import { useState } from "react"
import { RiArrowDownSLine, RiDownload2Line } from "@remixicon/react"

import { toMessage } from "@/components/dashboard/record-kit"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { downloadExport, type ExportFormat, type QueryValue } from "@/lib/api/import-export"
import { useSession } from "@/lib/auth/session-context"

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "csv", label: "CSV" },
  { format: "pdf", label: "PDF" },
]

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Downloads the list as Excel, CSV or PDF. The server decides what is in the
 * file, so a refusal ("too many rows") is shown word for word.
 */
export function ExportMenu({
  basePath,
  fileName,
  params = {},
  disabled = false,
  note,
  onError,
}: {
  /** The module path, like `/api/suppliers`. The file comes from `${basePath}/export`. */
  basePath: string
  /** `suppliers` gives `suppliers-2026-10-04.xlsx`. */
  fileName: string
  /** The filters the page is showing. Empty values are left out. */
  params?: Record<string, QueryValue>
  /** Set while the list is loading or broken, so nobody exports an error. */
  disabled?: boolean
  /** A short line under the button, for a filter the file does not apply. */
  note?: string
  /** Where to show a refusal. Without it the message shows under the button. */
  onError?: (message: string) => void
}) {
  const { accessToken } = useSession()
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  async function run(format: ExportFormat) {
    if (!accessToken || busy) return
    setBusy(format)
    setLocalError(null)
    try {
      const blob = await downloadExport(accessToken, basePath, params, format)
      downloadBlob(blob, `${fileName}-${today()}.${format}`)
    } catch (err) {
      const message = toMessage(err)
      if (onError) onError(message)
      else setLocalError(message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled || busy !== null}
          aria-label="Export this list"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D7DDE6] bg-white px-3 text-[12.5px] font-bold text-[#17191C] outline-none hover:bg-[#F4F6F9] focus-visible:ring-2 focus-visible:ring-[#17191C]/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RiDownload2Line className="size-4" aria-hidden />
          {busy ? "Preparing…" : "Export"}
          <RiArrowDownSLine className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {FORMATS.map(({ format, label }) => (
            <DropdownMenuItem key={format} onClick={() => run(format)}>
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {note ? <p className="max-w-64 text-right text-[11.5px] text-[#5F6B7C]">{note}</p> : null}
      {localError ? (
        <p role="alert" className="max-w-64 text-right text-[12px] font-semibold text-[#B03A3A]">
          {localError}
        </p>
      ) : null}
    </div>
  )
}
