"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiArrowDownSLine, RiArrowUpSLine, RiContactsBook2Line, RiSearchLine } from "@remixicon/react"

import { listAllContacts, type ContactSort } from "@/lib/api/sales/contacts"
import { salesKeys } from "@/lib/api/sales/keys"
import type { ContactDirectoryRow } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable, TONE } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { ExportMenu } from "@/components/import-export/export-menu"
import { CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE } from "@/components/sales/shared/sales-shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const HEADERS = ["Name", "Job title", "Phone", "Email", "Account", "Status"]
/** The columns the server can sort by, in header order. Phone and email cannot be sorted. */
const SORT_OF: (ContactSort | null)[] = ["name", "designation", null, null, "account", "status"]

function cellsOf(c: ContactDirectoryRow): TableCell[] {
  const plain = (v: string | null) => (v ? { text: v } : { node: <span className={TONE.muted}>-</span> })
  return [
    { text: c.name, weight: 600, sub: c.isPrimary ? "Main contact" : undefined },
    plain(c.designation),
    plain(c.phone),
    plain(c.email),
    { text: c.accountName },
    { tag: CONTACT_STATUS_LABEL[c.status], tone: CONTACT_STATUS_TONE[c.status] },
  ]
}

/**
 * Every contact of every account the viewer may see (owner, 2026-10-18), as a
 * sheet: sort by a column name, search once, download as CSV or PDF. A click
 * anywhere on a row opens the account's Contacts tab.
 */
export function ContactsPage() {
  const { accessToken } = useSession()
  const [typed, setTyped] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<ContactSort>("name")
  const [dir, setDir] = useState<"asc" | "desc">("asc")

  // Waits for a pause in typing, so each letter is not a request.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(typed.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [typed])

  const query = useQuery({
    queryKey: salesKeys.contactDirectory(q, page, sort, dir),
    queryFn: () => listAllContacts(accessToken!, { q, page, sort, dir }),
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
        className={cn("inline-flex items-center gap-0.5 uppercase hover:text-[#17191C]", active && "text-[#17191C]")}
      >
        {label}
        <Arrow className={cn("size-3.5", !active && "opacity-30")} aria-hidden />
      </button>
    )
  })

  const empty = q
    ? { title: "Nothing matches your search", body: `No contact matches "${q}". Check the spelling, or search for less.`, action: "Clear the search" }
    : { title: "No contacts yet", body: "Contacts are added on each account's Contacts tab.", action: undefined }

  return (
    <>
      <PageHeader kicker="Sales" title="Contacts" sub="Every contact of the accounts you can see. Click a row to open its account." />

      {/* Hidden until the first page arrives: a search box beside a skeleton reads as an answer. */}
      {data ? (
        <div className="mt-5 mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <RiSearchLine className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[#8A94A2]" aria-hidden />
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Search contacts"
              placeholder="Name, job title, phone, email or account"
              className="pl-8 text-[13px]"
            />
          </div>
          <ExportMenu
            basePath="/api/sales/contacts"
            fileName="contacts"
            params={{ q: q || undefined, sort, dir }}
            formats={["csv", "pdf"]}
            disabled={query.isError}
          />
        </div>
      ) : (
        <div className="mt-5" />
      )}

      <PanelTable
        emptyIcon={RiContactsBook2Line}
        cols="minmax(0,1.4fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.4fr) minmax(0,1.3fr) minmax(0,0.8fr)"
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
        onEmptyAction={() => setTyped("")}
      />

      {data && data.total > data.pageSize ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
          <span className={TONE.muted}>
            {(data.page - 1) * data.pageSize + 1} to {Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 text-[12px] font-bold">
              Previous
            </Button>
            <Button type="button" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} className="h-8 text-[12px] font-bold">
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </>
  )
}
