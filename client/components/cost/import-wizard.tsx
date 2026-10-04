"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { commitCostImport, previewCostImport } from "@/lib/api/costs"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { CostCategory, CostImportCommitResult, CostImportIssue, CostImportPreview } from "@/lib/api/types"
import { DataTable } from "@/components/dashboard/data-table"
import type { TableCell } from "@/components/dashboard/types"
import { ImportPreviewEmpty, issuesCell, previewRowNumbers } from "@/components/import/import-preview"
import { ImportGuide } from "@/components/import-export/import-guide"
import { Button } from "@/components/ui/button"
import { DOCUMENT_MAX_BYTES, FileUpload } from "@/components/ui/file-upload"

/** `parseSheet` (server/src/utils/import/import.parse.ts) reads only these
 *  two — a third format is a second parser to keep consistent with it. */
const IMPORT_ACCEPT = ["xlsx", "csv"]

type Step = "upload" | "preview" | "result"

/**
 * One row as the server's preview reports it — `CostImportRow`
 * (server/src/modules/cost/cost.import.ts) with the file's `categoryCode`
 * already resolved to `categoryId`. `CostImportPreview.rows` is typed
 * `unknown[]` in `lib/api/types.ts` on purpose: the shared import kernel has
 * two other consumers (the asset register, historical expenses) whose rows
 * look nothing like this, so a single shared row type would be a lie for
 * either.
 */
interface ImportRow {
  rowNumber: number
  categoryId?: string
  label?: string
  payee?: string
  periodMonth?: number
  periodYear?: number
  amount?: number
  paidAt?: string
}

function issuesForRow(rowNumber: number, issues: CostImportIssue[]): CostImportIssue[] {
  return issues.filter((issue) => issue.rowNumber === rowNumber)
}

const PREVIEW_HEADERS = ["Row", "Category", "Label", "Payee", "Period", "Amount", "Status", "Issues"]
const PREVIEW_COLS = "0.4fr 0.9fr 1.3fr 1fr 0.7fr 0.8fr 0.7fr 1.6fr"

/**
 * Every parsed row, its issues inline. Reused verbatim for a commit-time 400:
 * the server re-validates at commit and can find something the preview did
 * not (another user's import landing in between, a category deleted in the
 * meantime), and `error.details.issues` slots into the same `issues` prop
 * rather than a bare string.
 *
 * On `DataTable` rather than the raw `ui/table` it was hand-rolled on. This is
 * a validation report and not a record list, which is why it stayed behind
 * when the register moved, but the argument does not survive a phone: a raw
 * table put eight columns of import errors into a sideways scroll, and the
 * errors are the whole point of the screen. `DataTable` turns each row into a
 * card below md.
 */
function PreviewTable({
  rows,
  issues,
  categories,
}: {
  rows: ImportRow[]
  issues: CostImportIssue[]
  categories: CostCategory[]
}) {
  const rowNumbers = previewRowNumbers(rows, issues)

  if (rowNumbers.length === 0) return <ImportPreviewEmpty noun="bills" />

  const tableRows: TableCell[][] = rowNumbers.map((rowNumber) => {
    const row = rows.find((r) => r.rowNumber === rowNumber)
    const category = categories.find((c) => c.id === row?.categoryId)
    return [
      { text: String(rowNumber), weight: 600 },
      { text: category?.name ?? "" },
      { text: row?.label ?? "" },
      { text: row?.payee ?? "" },
      {
        text:
          row?.periodMonth && row?.periodYear ? `${row.periodMonth}/${row.periodYear}` : "",
      },
      { text: row?.amount === undefined ? "" : String(row.amount) },
      // A row that failed before parsing has no status to report, and
      // guessing one would be inventing data about a row we could not read.
      row ? { tag: row.paidAt ? "Paid" : "Pending", tone: row.paidAt ? "green" : "neutral" } : {},
      issuesCell(issuesForRow(rowNumber, issues)),
    ]
  })

  return (
    <DataTable title="" action="" cols={PREVIEW_COLS} headers={PREVIEW_HEADERS} rows={tableRows} />
  )
}

/**
 * Upload → preview → result. `preview` writes nothing — the server's
 * `runPreview` guarantees that — so everything before the commit click is
 * free to retry with a different file.
 *
 * A row carrying `paidAt` lands as `PAID`, one without lands `PENDING`; the
 * status column above exists so a year of already-settled bills does not
 * look like it needs sixty follow-up clicks.
 */
export function ImportWizard({
  categories,
  onImported,
}: {
  categories: CostCategory[]
  onImported: () => void
}) {
  const { accessToken } = useSession()

  const [step, setStep] = useState<Step>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CostImportPreview | null>(null)
  const [issues, setIssues] = useState<CostImportIssue[]>([])
  const [commitError, setCommitError] = useState<string | null>(null)
  const [result, setResult] = useState<CostImportCommitResult | null>(null)

  function reset() {
    setStep("upload")
    setFile(null)
    setPreview(null)
    setIssues([])
    setCommitError(null)
    setResult(null)
  }

  const previewMutation = useMutation({
    mutationFn: (f: File) => previewCostImport(accessToken!, f),
    onSuccess: (data, f) => {
      setFile(f)
      setPreview(data)
      setIssues(data.issues)
      setCommitError(null)
      setStep("preview")
    },
  })

  const commitMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("No file selected")
      return commitCostImport(accessToken!, file)
    },
    onSuccess: (data) => {
      setResult(data)
      setCommitError(null)
      setStep("result")
      onImported()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 400 && Array.isArray(err.details?.issues)) {
        // A row failed a check the preview could not see (typically a race —
        // someone else's import landed in between). Same table, fresher
        // issues, never a bare string.
        setIssues(err.details.issues as CostImportIssue[])
        setCommitError(null)
      } else {
        setCommitError(
          err instanceof ApiError ? err.message : "Something went wrong. Please try again."
        )
      }
    },
  })

  const previewRows = (preview?.rows ?? []) as ImportRow[]

  return (
    <div className="space-y-4">
      {step === "upload" ? (
        <div className="space-y-4">
        <ImportGuide basePath="/api/costs" />
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="mb-3 text-sm text-muted-foreground">
            Upload an Excel (.xlsx) or CSV file of historical bills to import. Nothing is written
            until you review and commit it.
          </p>
          <div className="flex justify-center">
            <FileUpload
              accept={IMPORT_ACCEPT}
              maxBytes={DOCUMENT_MAX_BYTES}
              label="Choose file"
              onSelect={(f) => previewMutation.mutateAsync(f).then(() => undefined)}
            />
          </div>
        </div>
        </div>
      ) : null}

      {step === "preview" && preview ? (
        <div className="space-y-4">
          <p className="text-[13px]">
            <span className="font-semibold">{preview.summary.costs ?? 0}</span> bill
            {(preview.summary.costs ?? 0) === 1 ? "" : "s"},{" "}
            <span className="font-semibold">{preview.summary.paid ?? 0}</span> already paid,{" "}
            <span className="font-semibold">{preview.summary.pending ?? 0}</span> pending.
          </p>

          <PreviewTable rows={previewRows} issues={issues} categories={categories} />

          <p className="text-[12.5px] font-semibold text-muted-foreground">
            If any row fails, nothing at all is imported.
          </p>

          {commitError ? (
            <p className="text-[13px] font-semibold text-destructive">{commitError}</p>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={reset} disabled={commitMutation.isPending}>
              Choose a different file
            </Button>
            <Button
              type="button"
              disabled={issues.length > 0 || commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
            >
              {commitMutation.isPending ? "Importing…" : "Commit import"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "result" && result ? (
        <div className="space-y-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-900 dark:bg-emerald-950">
            <p className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-200">
              Import complete.
            </p>
            <p className="mt-0.5 text-[12.5px] text-emerald-700 dark:text-emerald-300">
              {result.costCount} bill{result.costCount === 1 ? "" : "s"} created,{" "}
              {result.paidCount} already marked paid.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={reset}>
            Import another file
          </Button>
        </div>
      ) : null}
    </div>
  )
}
