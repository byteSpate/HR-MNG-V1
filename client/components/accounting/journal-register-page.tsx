"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { RiAddLine, RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react"

import { sides } from "@/lib/accounting/side-style"
import { listAccountsFlat, listJournals } from "@/lib/api/accounting"
import { useSession } from "@/lib/auth/session-context"
import type { JournalStatus, JournalType } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AccountPicker } from "@/components/accounting/account-picker"
import {
  currentMonthRange,
  formatLedgerDate,
  formatTotal,
  JOURNAL_STATUS_LABEL,
  JOURNAL_STATUS_TONE,
  JOURNAL_TYPE_LABEL,
  sumPaisa,
  fromPaisa,
} from "@/components/accounting/accounting-shared"

const PAGE_SIZE = 50
const ALL = "ALL"

// Base UI's Select renders the raw value on the closed trigger unless the
// root is given `items`, which showed the enum key — "PENDING_APPROVAL"
// where the open list read "Awaiting approval".
const STATUS_ITEMS = { [ALL]: "All statuses", ...JOURNAL_STATUS_LABEL }
const TYPE_ITEMS = { [ALL]: "All types", ...JOURNAL_TYPE_LABEL }

const TONE_VARIANT = {
  neutral: "secondary",
  warning: "outline",
  success: "default",
  danger: "destructive",
} as const

/**
 * The register is a rooted table, not a dashboard. Its job is to find one
 * journal among thousands, so every control here is a filter and the row
 * itself is the link.
 */
export function JournalRegisterPage() {
  const { accessToken } = useSession()
  const initial = currentMonthRange()

  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [status, setStatus] = useState<string>(ALL)
  const [type, setType] = useState<string>(ALL)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)

  const accounts = useQuery({
    queryKey: ["accounting", "accounts", "flat"],
    queryFn: () => listAccountsFlat(accessToken!),
    enabled: Boolean(accessToken),
  })

  const journals = useQuery({
    queryKey: ["accounting", "journals", { from, to, status, type, accountId, q, page }],
    queryFn: () =>
      listJournals(accessToken!, {
        from,
        to,
        status: status === ALL ? undefined : (status as JournalStatus),
        type: type === ALL ? undefined : (type as JournalType),
        accountId: accountId ?? undefined,
        q: q || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: Boolean(accessToken),
  })

  const total = journals.data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Filters change what the page numbers mean, so any change resets to 1.
  const reset = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Accounting"
        title="Journal register"
        sub="Every entry, in every state, with the account and period it touches."
        aside={
          <Button nativeButton={false} render={<Link href="journals/new" />}>
            <RiAddLine className="size-4" /> New journal
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="reg-from">From</label>
          <Input id="reg-from" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="reg-to">To</label>
          <Input id="reg-to" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select items={STATUS_ITEMS} value={status} onValueChange={(v) => reset(setStatus)(v ?? ALL)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {(Object.keys(JOURNAL_STATUS_LABEL) as JournalStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{JOURNAL_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select items={TYPE_ITEMS} value={type} onValueChange={(v) => reset(setType)(v ?? ALL)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {(Object.keys(JOURNAL_TYPE_LABEL) as JournalType[]).map((t) => (
                <SelectItem key={t} value={t}>{JOURNAL_TYPE_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid w-56 gap-1">
          <label className="text-xs text-muted-foreground">Account</label>
          <AccountPicker
            accounts={accounts.data ?? []}
            value={accountId}
            onChange={reset(setAccountId)}
            placeholder="Any account"
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="reg-q">Search</label>
          <Input
            id="reg-q"
            value={q}
            onChange={(e) => reset(setQ)(e.target.value)}
            placeholder="Number, narration, reference"
            className="w-56"
          />
        </div>
        {accountId && (
          <Button variant="ghost" size="sm" onClick={() => reset(setAccountId)(null)}>
            Clear account
          </Button>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Number</TableHead>
              <TableHead className="w-28">Date</TableHead>
              <TableHead>Narration</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-36">Status</TableHead>
              <TableHead className={`w-32 text-right ${sides.sideText("debit")}`}>Debit</TableHead>
              <TableHead className={`w-32 text-right ${sides.sideText("credit")}`}>Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {journals.isPending ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                </TableRow>
              ))
            ) : journals.isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm">
                  <p className="text-muted-foreground">The register could not be loaded.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => journals.refetch()}>
                    Try again
                  </Button>
                </TableCell>
              </TableRow>
            ) : (journals.data?.rows ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No journal matches these filters.
                </TableCell>
              </TableRow>
            ) : (
              journals.data!.rows.map((j) => {
                const debit = fromPaisa(sumPaisa(j.lines.map((l) => l.debit)))
                const credit = fromPaisa(sumPaisa(j.lines.map((l) => l.credit)))
                return (
                  <TableRow key={j.id} className="cursor-pointer">
                    <TableCell className="font-medium tabular-nums">
                      <Link href={`journals/${j.id}`} className="hover:underline">
                        {j.journalNo}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatLedgerDate(j.date)}</TableCell>
                    <TableCell className="max-w-md truncate">
                      {j.narration}
                      {j.sourceModule && (
                        <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                          {j.sourceModule.toLowerCase()}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{JOURNAL_TYPE_LABEL[j.type]}</TableCell>
                    <TableCell>
                      <Badge variant={TONE_VARIANT[JOURNAL_STATUS_TONE[j.status]]}>
                        {JOURNAL_STATUS_LABEL[j.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${sides.sideText("debit")}`}>{formatTotal(debit)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${sides.sideText("credit")}`}>{formatTotal(credit)}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total === 0
            ? "No journals"
            : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            <RiArrowLeftSLine className="size-4" />
          </Button>
          <span className="tabular-nums">{page} / {lastPage}</span>
          <Button variant="outline" size="icon" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            <RiArrowRightSLine className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
