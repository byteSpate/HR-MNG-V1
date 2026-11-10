"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiArrowDownSLine, RiArrowUpSLine, RiContactsBook2Line, RiSearchLine } from "@remixicon/react"

import { listAllContacts, type ContactSort } from "@/lib/api/sales/contacts"
import { salesKeys } from "@/lib/api/sales/keys"
import type { ContactDirectoryRow, SalesContactStatus } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable, TONE } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { ExportMenu } from "@/components/import-export/export-menu"
import { CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE } from "@/components/sales/shared/sales-shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const HEADERS = ["Name", "Job title", "Phone", "Email", "Account", "Industry", "Status"]
/** The columns the server can sort by, in header order. Phone and email cannot be sorted. */
const SORT_OF: (ContactSort | null)[] = ["name", "designation", null, null, "account", "industry", "status"]

function cellsOf(c: ContactDirectoryRow): TableCell[] {
  const plain = (v: string | null) => (v ? { text: v } : { node: <span className={TONE.muted}>-</span> })
  return [
    { text: c.name, weight: 600, sub: c.isPrimary ? "Main contact" : undefined },
    plain(c.designation),
    plain(c.phone),
    plain(c.email),
    { text: c.accountName },
    plain(c.accountIndustry),
    { tag: CONTACT_STATUS_LABEL[c.status], tone: CONTACT_STATUS_TONE[c.status] },
  ]
}

const STATUSES = Object.keys(CONTACT_STATUS_LABEL) as SalesContactStatus[]
const selectClass =
  "h-9 rounded-md border border-line bg-white px-2 text-body-sm focus:outline-none focus:ring-2 focus:ring-ink/20"

/**
 * Every contact of every account the viewer may see (owner, 2026-10-18), as a
 * sheet: sort by a column name, search once, filter by industry or status, download as CSV or PDF. A click
 * anywhere on a row opens the account's Contacts tab.
 */
export function ContactsPage() {
  const { accessToken } = useSession()
  const [typed, setTyped] = useState("")
  const [q, setQ] = useState("")
  const [industry, setIndustry] = useState("")
  const [status, setStatus] = useState<SalesContactStatus | "">("")
  const [page, setPage] = useState(1)
  // Newest first until a column header is clicked (owner, 2026-11-10).
  const [sort, setSort] = useState<ContactSort>("added")
  const [dir, setDir] = useState<"asc" | "desc">("desc")

  // Waits for a pause in typing, so each letter is not a request.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(typed.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [typed])

  const query = useQuery({
    queryKey: salesKeys.contactDirectory(q, industry, status, page, sort, dir),
    queryFn: () => listAllContacts(accessToken!, { q, industry, status, page, sort, dir }),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  })
  const data = query.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const sortBy = (next: ContactSort) => {
    if (next === sort) setDir(dir === "asc" ? "desc" : "asc")
    else {
      setSort(next)
      setDir("asc")
    }
    setPage(1)
  }
  const headerNodes = HEADERS.map((label, i) => {
    const key = SORT_OF[i]
    if (!key) return label
    const active = key === sort
    const Arrow = active && dir === "desc" ? RiArrowDownSLine : RiArrowUpSLine
    return (
      <button
        key={key}
        type="button"
        onClick={() => sortBy(key)}
        aria-label={`Sort by ${label.toLowerCase()}`}
        className={cn("inline-flex items-center gap-0.5 uppercase hover:text-ink", active && "text-ink")}
      >
        {label}
        <Arrow className={cn("size-3.5", !active && "opacity-30")} aria-hidden />
      </button>
    )
  })

  const filtered = !!(q || industry || status)
  const clearAll = () => {
    setTyped("")
    setQ("")
    setIndustry("")
    setStatus("")
    setPage(1)
  }
  const empty = filtered
    ? { title: "No contact matches", body: "Try a shorter search, or take off a filter.", action: "Clear search and filters" }
    : { title: "No contacts yet", body: "Contacts are added on each account's Contacts tab.", action: undefined }

  return (
    <>
      <PageHeader kicker="Sales" title="Contacts" sub="Every contact of the accounts you can see. Click a row to open its account." />

      {/* Hidden until the first page arrives: a search box beside a skeleton reads as an answer. */}
      {data ? (
        <div className="mt-5 mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <RiSearchLine className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Search contacts"
              placeholder="Name, job title, phone, email, account or industry"
              className="pl-8 text-body-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="contact-industry" className={`text-caption font-semibold ${TONE.muted}`}>
              Industry
            </label>
            <select
              id="contact-industry"
              value={industry}
              onChange={(e) => {
                setIndustry(e.target.value)
                setPage(1)
              }}
              className={selectClass}
            >
              <option value="">All</option>
              {/* A chosen industry stays in the list even if no account has it any more. */}
              {(industry && !data.industries.includes(industry) ? [industry, ...data.industries] : data.industries).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <label htmlFor="contact-status" className={`ml-1 text-caption font-semibold ${TONE.muted}`}>
              Status
            </label>
            <select
              id="contact-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as SalesContactStatus | "")
                setPage(1)
              }}
              className={selectClass}
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONTACT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {filtered ? (
              <Button type="button" variant="outline" onClick={clearAll} className="h-9 text-caption font-bold">
                Clear
              </Button>
            ) : null}
          </div>
          <ExportMenu
            basePath="/api/sales/contacts"
            fileName="contacts"
            params={{ q: q || undefined, industry: industry || undefined, status: status || undefined, sort, dir }}
            formats={["csv", "pdf"]}
            disabled={query.isError}
          />
        </div>
      ) : (
        <div className="mt-5" />
      )}

      <PanelTable
        emptyIcon={RiContactsBook2Line}
        cols="minmax(0,1.3fr) minmax(0,1fr) minmax(0,0.9fr) minmax(0,1.3fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,0.8fr)"
        headers={HEADERS}
        headerNodes={headerNodes}
        rows={(data?.rows ?? []).map(cellsOf)}
        rowHrefs={(data?.rows ?? []).map((c) => `/sales/accounts/${c.accountId}?tab=contacts`)}
        isLoading={query.isPending}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={empty.title}
        emptyBody={empty.body}
        emptyAction={empty.action}
        onEmptyAction={clearAll}
      />

      {data && data.total > data.pageSize ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption">
          <span className={TONE.muted}>
            {(data.page - 1) * data.pageSize + 1} to {Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 text-caption font-bold">
              Previous
            </Button>
            <Button type="button" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} className="h-8 text-caption font-bold">
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </>
  )
}
