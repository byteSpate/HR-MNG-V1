"use client"

import { useState } from "react"
import { RiUpload2Line } from "@remixicon/react"

import { ExportMenu } from "@/components/import-export/export-menu"
import { ImportDialog, type PreviewColumn } from "@/components/import-export/import-dialog"
import { Button } from "@/components/ui/button"
import type { QueryValue } from "@/lib/api/import-export"
import type { Role } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"

/** Same roles as the server routes (spec decision 7). The server is the real gate. */
export const HR_ROLES: Role[] = ["HR_ADMIN", "SUPER_ADMIN"]
export const FINANCE_ROLES: Role[] = ["FINANCE_OFFICER", "SUPER_ADMIN"]

/**
 * The Export menu and, where the list can be imported, the Import button and
 * window. Shown only to the roles that may use them. A button the server would
 * refuse is a bug, so the roles here mirror the routes.
 */
export function ImportExportTools({
  basePath,
  fileName,
  roles,
  exportParams,
  exportDisabled,
  exportNote,
  onError,
  importer,
}: {
  basePath: string
  fileName: string
  roles: Role[]
  exportParams?: Record<string, QueryValue>
  exportDisabled?: boolean
  exportNote?: string
  onError?: (message: string) => void
  /** Leave out for a list that can be exported but not imported. */
  importer?: {
    title: string
    /** Singular, like `supplier`. */
    noun: string
    previewColumns: PreviewColumn[]
    summaryText: (summary: Record<string, number>) => string
    onImported: () => void
  }
}) {
  const { user } = useSession()
  const [importOpen, setImportOpen] = useState(false)

  if (!user || !roles.includes(user.role)) return null

  return (
    <div className="flex flex-wrap items-start gap-2">
      {importer ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <RiUpload2Line className="size-4" aria-hidden />
          Import
        </Button>
      ) : null}
      <ExportMenu
        basePath={basePath}
        fileName={fileName}
        params={exportParams}
        disabled={exportDisabled}
        note={exportNote}
        onError={onError}
      />
      {importer && importOpen ? (
        <ImportDialog
          title={importer.title}
          noun={importer.noun}
          basePath={basePath}
          previewColumns={importer.previewColumns}
          summaryText={importer.summaryText}
          onImported={importer.onImported}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
    </div>
  )
}
