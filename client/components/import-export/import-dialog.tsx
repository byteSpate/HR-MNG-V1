"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { DataTable } from "@/components/dashboard/data-table"
import type { TableCell } from "@/components/dashboard/types"
import { ImportPreviewEmpty, issuesCell, previewRowNumbers } from "@/components/import/import-preview"
import { ImportGuide } from "@/components/import-export/import-guide"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DOCUMENT_MAX_BYTES, FileUpload } from "@/components/ui/file-upload"
import { ApiError } from "@/lib/api/client"
import {
  commitImportFile,
  previewImportFile,
  type ImportPreviewResult,
  type ImportRowIssue,
} from "@/lib/api/import-export"
import { useSession } from "@/lib/auth/session-context"

/** `parseSheet` on the server reads only these two. */
const IMPORT_ACCEPT = ["xlsx", "csv"]

type Step = "upload" | "preview" | "result"

export interface PreviewColumn {
  header: string
  /** The text for this column on one parsed row. */
  cell: (row: Record<string, unknown>) => string
}

/** `1 department`, `3 departments`. */
export const countText = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

function PreviewTable({
  rows,
  issues,
  columns,
  noun,
}: {
  rows: ImportPreviewResult["rows"]
  issues: ImportRowIssue[]
  columns: PreviewColumn[]
  noun: string
}) {
  const rowNumbers = previewRowNumbers(rows, issues)
  if (rowNumbers.length === 0) return <ImportPreviewEmpty noun={`${noun}s`} />

  const tableRows: TableCell[][] = rowNumbers.map((rowNumber) => {
    const row = rows.find((r) => r.rowNumber === rowNumber)
    return [
      { text: String(rowNumber), weight: 600 },
      // A row that failed before it was parsed has nothing to show, and guessing
      // would invent data about a row we could not read.
      ...columns.map((column) => ({ text: row ? column.cell(row) : "" })),
      issuesCell(issues.filter((issue) => issue.rowNumber === rowNumber)),
    ]
  })

  return (
    <DataTable
      title=""
      action=""
      cols={["0.4fr", ...columns.map(() => "1fr"), "1.6fr"].join(" ")}
      headers={["Row", ...columns.map((column) => column.header), "Issues"]}
      rows={tableRows}
    />
  )
}

/**
 * Guide, upload, preview, result. The preview writes nothing, so everything
 * before the last button can be tried again with a different file. If any row
 * has a problem, nothing at all is added.
 */
export function ImportDialog({
  title,
  noun,
  basePath,
  previewColumns,
  summaryText,
  onImported,
  onClose,
}: {
  title: string
  /** Singular, like `department`. */
  noun: string
  basePath: string
  previewColumns: PreviewColumn[]
  /** One sentence about the preview, from the server's summary numbers. */
  summaryText: (summary: Record<string, number>) => string
  onImported: () => void
  onClose: () => void
}) {
  const { accessToken } = useSession()

  const [step, setStep] = useState<Step>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [issues, setIssues] = useState<ImportRowIssue[]>([])
  const [commitError, setCommitError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [created, setCreated] = useState<number | null>(null)

  function reset() {
    setStep("upload")
    setFile(null)
    setPreview(null)
    setIssues([])
    setCommitError(null)
    setUploadError(null)
    setCreated(null)
  }

  const previewMutation = useMutation({
    mutationFn: (selected: File) => previewImportFile(accessToken!, basePath, selected),
    onSuccess: (data, selected) => {
      setFile(selected)
      setPreview(data)
      setIssues(data.issues)
      setCommitError(null)
      setUploadError(null)
      setStep("preview")
    },
    // A file that cannot be read at all (wrong columns, too many rows) is a 400
    // with a plain sentence. Show it where the file was chosen.
    onError: (err) =>
      setUploadError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  const commitMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("No file selected")
      return commitImportFile(accessToken!, basePath, file)
    },
    onSuccess: (data) => {
      setCreated(data.created)
      setCommitError(null)
      setStep("result")
      onImported()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 400 && Array.isArray(err.details?.issues)) {
        // The server checks again when you commit. Something may have changed
        // since the preview, so show the new problems in the same table.
        setIssues(err.details.issues as ImportRowIssue[])
        setCommitError(null)
      } else {
        setCommitError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
      }
    },
  })

  // How many different rows have a problem. One row can have several.
  const problemRows = new Set(issues.map((issue) => issue.rowNumber)).size

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Add many records from an Excel or CSV file. Nothing is saved until you check the preview and confirm.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" ? (
          <div className="space-y-4">
            <ImportGuide basePath={basePath} />
            <div className="rounded-md border border-dashed p-6 text-center">
              <p className="mb-3 text-sm text-muted-foreground">Choose your Excel (.xlsx) or CSV file.</p>
              <div className="flex justify-center">
                <FileUpload
                  accept={IMPORT_ACCEPT}
                  maxBytes={DOCUMENT_MAX_BYTES}
                  label="Choose file"
                  onSelect={(selected) => {
                    setUploadError(null)
                    return previewMutation.mutateAsync(selected).then(() => undefined, () => undefined)
                  }}
                />
              </div>
              {uploadError ? (
                <p role="alert" className="mt-3 text-[13px] font-semibold text-destructive">
                  {uploadError}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "preview" && preview ? (
          <div className="space-y-4">
            <p className="text-[13px] font-semibold">
              {issues.length > 0
                ? `${countText(problemRows, "row")} ${problemRows === 1 ? "has" : "have"} a problem, so nothing can be added yet.`
                : summaryText(preview.summary)}
            </p>

            <PreviewTable rows={preview.rows} issues={issues} columns={previewColumns} noun={noun} />

            <p className="text-[12.5px] font-semibold text-muted-foreground">
              If any row has a problem, nothing at all is added. Fix the file and choose it again.
            </p>

            {commitError ? <p className="text-[13px] font-semibold text-destructive">{commitError}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={reset} disabled={commitMutation.isPending}>
                Choose a different file
              </Button>
              <Button
                type="button"
                disabled={issues.length > 0 || preview.rows.length === 0 || commitMutation.isPending}
                onClick={() => commitMutation.mutate()}
              >
                {commitMutation.isPending ? "Adding…" : "Add these rows"}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "result" && created !== null ? (
          <div className="space-y-4">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-[13px] font-semibold text-emerald-800">Done.</p>
              <p className="mt-0.5 text-[12.5px] text-emerald-700">{countText(created, noun)} added.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={reset}>
                Import another file
              </Button>
              <Button type="button" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
