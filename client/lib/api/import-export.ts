import { apiFetch, apiFetchBlob } from "./client"

export type ExportFormat = "xlsx" | "csv" | "pdf"
export type ExampleFormat = "xlsx" | "csv"
export type QueryValue = string | number | boolean | null | undefined

/** `?a=1&b=2`, leaving out empty values. An empty string means "no filter". */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ""
}

/** The list as a file. `basePath` is the module path, like `/api/suppliers`. */
export async function downloadExport(
  accessToken: string,
  basePath: string,
  params: Record<string, QueryValue>,
  format: ExportFormat
): Promise<Blob> {
  const { blob } = await apiFetchBlob(`${basePath}/export${buildQuery({ ...params, format })}`, { accessToken })
  return blob
}

/** The example file for an import. */
export async function downloadExample(accessToken: string, basePath: string, format: ExampleFormat): Promise<Blob> {
  const { blob } = await apiFetchBlob(`${basePath}/import/template${buildQuery({ format })}`, { accessToken })
  return blob
}

export interface ImportGuideColumn {
  header: string
  type: string
  typeLabel: string
  required: boolean
  description: string
  example: string
  allowed: string[]
}

export interface ImportGuide {
  columns: ImportGuideColumn[]
  maxRows: number
}

export function fetchImportGuide(accessToken: string, basePath: string): Promise<ImportGuide> {
  return apiFetch<ImportGuide>(`${basePath}/import/guide`, { accessToken })
}

export interface ImportRowIssue {
  rowNumber: number
  column: string | null
  message: string
}

export interface ImportPreviewResult {
  rows: Array<{ rowNumber: number } & Record<string, unknown>>
  issues: ImportRowIssue[]
  summary: Record<string, number>
}

export function previewImportFile(accessToken: string, basePath: string, file: File): Promise<ImportPreviewResult> {
  const body = new FormData()
  body.append("file", file)
  return apiFetch<ImportPreviewResult>(`${basePath}/import/preview`, { method: "POST", accessToken, body })
}

export function commitImportFile(accessToken: string, basePath: string, file: File): Promise<{ created: number }> {
  const body = new FormData()
  body.append("file", file)
  return apiFetch<{ created: number }>(`${basePath}/import/commit`, { method: "POST", accessToken, body })
}
