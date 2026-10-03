"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  createJournal,
  listAccountsFlat,
  listFinancialYears,
  listJournals,
  submitJournal,
  approveJournal,
  updateJournal,
} from "@/lib/api/accounting"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { Account, FinancialYear, Journal } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  formatLedgerDate,
  fromPaisa,
  JOURNAL_STATUS_LABEL,
  sumPaisa,
  toDateInput,
  toPaisa,
} from "@/components/accounting/accounting-shared"
import { cn } from "@/lib/utils"

/** Per-account entry, keyed by account id. */
type Amounts = Record<string, { debit: string; credit: string }>

function toAmounts(rows: Account[], journal: Journal | null): Amounts {
  const next: Amounts = {}
  for (const account of rows) next[account.id] = { debit: "", credit: "" }
  if (journal) {
    for (const line of journal.lines) {
      next[line.accountId] = {
        debit: Number(line.debit) === 0 ? "" : line.debit,
        credit: Number(line.credit) === 0 ? "" : line.credit,
      }
    }
  }
  return next
}

/**
 * Every postable account, plus any account the existing journal already uses.
 *
 * The second half matters: an account deactivated *after* the opening journal
 * was written drops out of `postable`, so its row would not render and the
 * next save would silently drop its figure — turning a balanced entry into an
 * unbalanced one for a reason nothing on screen explains. It is shown, and
 * kept, so the person can deal with it deliberately.
 */
function rowsFor(postable: Account[], journal: Journal | null): Account[] {
  if (!journal) return postable

  const known = new Set(postable.map((a) => a.id))
  const extras = journal.lines
    .filter((l) => !known.has(l.accountId))
    .map((l) => ({ ...l.account, isGroup: false, isActive: false }) as Account)

  return [...postable, ...extras].sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * The per-account grid for one financial year. Mounted keyed by the year's
 * journal id (see OpeningBalancesGrid), so the amounts initialize from the
 * existing OPENING journal on mount — no effect stamping state, and a
 * refetch after a save cannot overwrite what the user is typing.
 */
function AmountGrid({
  year,
  journal,
  postable,
  isEditable,
}: {
  year: FinancialYear
  journal: Journal | null
  postable: Account[]
  isEditable: boolean
}) {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  // A Super Admin has no one to send it to, so they post it in one step.
  const canPostNow = user?.role === "SUPER_ADMIN"

  const rows = useMemo(() => rowsFor(postable, journal), [postable, journal])
  const [amounts, setAmounts] = useState<Amounts>(() => toAmounts(rows, journal))

  const debitPaisa = sumPaisa(Object.values(amounts).map((a) => a.debit))
  const creditPaisa = sumPaisa(Object.values(amounts).map((a) => a.credit))
  const difference = debitPaisa - creditPaisa
  const isBalanced = difference === 0 && debitPaisa > 0

  const lines = () =>
    rows
      .filter((a) => {
        const v = amounts[a.id]
        return v && (toPaisa(v.debit) > 0 || toPaisa(v.credit) > 0)
      })
      .map((a) => ({
        accountId: a.id,
        debit: amounts[a.id].debit || "0",
        credit: amounts[a.id].credit || "0",
      }))

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        date: toDateInput(year.startDate),
        narration: `Opening balances for ${year.name}`,
        lines: lines(),
      }
      if (journal) return updateJournal(accessToken!, journal.id, payload)
      return createJournal(accessToken!, { ...payload, type: "OPENING" as const })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounting"] })
      toast.success("Opening balances saved")
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save"),
  })

  const submit = useMutation({
    mutationFn: async () => {
      const saved = await save.mutateAsync()
      return submitJournal(accessToken!, saved.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounting"] })
      toast.success("Sent for approval")
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not submit"),
  })

  const post = useMutation({
    mutationFn: async () => {
      const saved = await save.mutateAsync()
      return approveJournal(accessToken!, saved.id)
    },
    onSuccess: (posted) => {
      queryClient.invalidateQueries({ queryKey: ["accounting"] })
      toast.success(`${posted.journalNo} posted`)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not post"),
  })

  const setAmount = (accountId: string, column: "debit" | "credit", raw: string) => {
    const value = raw.replace(/[^\d.]/g, "")
    setAmounts((prev) => ({
      ...prev,
      [accountId]:
        column === "debit"
          ? { debit: value, credit: "" }
          : { debit: "", credit: value },
    }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <p className="pb-2 text-sm text-muted-foreground">
          Dated {formatLedgerDate(year.startDate)}
        </p>
        {journal && (
          <div className="pb-2">
            <Badge variant="secondary">{JOURNAL_STATUS_LABEL[journal.status]}</Badge>{" "}
            <Link href={`journals/${journal.id}`} className="text-sm underline">
              {journal.journalNo}
            </Link>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <Button variant="outline" onClick={() => save.mutate()} disabled={!isEditable || save.isPending}>
            Save draft
          </Button>
          {canPostNow ? (
            <Button onClick={() => post.mutate()} disabled={!isEditable || !isBalanced || post.isPending}>
              {post.isPending ? "Posting…" : "Post opening balances"}
            </Button>
          ) : (
            <Button onClick={() => submit.mutate()} disabled={!isEditable || !isBalanced || submit.isPending}>
              Submit for approval
            </Button>
          )}
        </div>
      </div>

      {!isEditable && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          These opening balances are posted and can no longer be changed here. A correction goes
          through a reversal on the journal itself.
        </p>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="w-40 text-right">Debit</TableHead>
              <TableHead className="w-40 text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-muted-foreground tabular-nums">{a.code}</TableCell>
                <TableCell>
                  {a.name}
                  {!a.isActive && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      retired — carried here because this journal already uses it
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    value={amounts[a.id]?.debit ?? ""}
                    onChange={(e) => setAmount(a.id, "debit", e.target.value)}
                    disabled={!isEditable}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`Opening debit for ${a.code} ${a.name}`}
                    className="h-8 text-right tabular-nums"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    value={amounts[a.id]?.credit ?? ""}
                    onChange={(e) => setAmount(a.id, "credit", e.target.value)}
                    disabled={!isEditable}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`Opening credit for ${a.code} ${a.name}`}
                    className="h-8 text-right tabular-nums"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Sticky, because this grid is longer than a screen. */}
        <div
          className={cn(
            "sticky bottom-0 grid grid-cols-[1fr_160px_160px] items-center gap-2 border-t px-4 py-3 text-sm font-medium tabular-nums",
            isBalanced ? "bg-muted" : "bg-destructive/10"
          )}
        >
          <span>
            {isBalanced ? (
              "Balanced"
            ) : (
              <span className="text-destructive">
                Out by {fromPaisa(Math.abs(difference))} — opening balances must agree before
                they can be posted
              </span>
            )}
          </span>
          <span className="text-right">{fromPaisa(debitPaisa || 0)}</span>
          <span className="text-right">{fromPaisa(creditPaisa || 0)}</span>
        </div>
      </div>
    </div>
  )
}

/** Fetches the year's OPENING journal, then renders the grid keyed by it. */
function OpeningBalancesGrid({
  year,
  postable,
}: {
  year: FinancialYear
  postable: Account[]
}) {
  const { accessToken } = useSession()

  // The existing OPENING journal for this year, if there is one. Fetched as
  // a one-row register query rather than a bespoke endpoint.
  const existing = useQuery({
    queryKey: ["accounting", "opening", year.id],
    queryFn: async () => {
      const page = await listJournals(accessToken!, {
        type: "OPENING",
        from: toDateInput(year.startDate),
        to: toDateInput(year.endDate),
        pageSize: 1,
      })
      return page.rows[0] ?? null
    },
    enabled: Boolean(accessToken),
  })

  if (existing.isLoading) return <Skeleton className="h-96 w-full" />

  const journal: Journal | null = existing.data ?? null
  const isEditable = !journal || journal.status === "DRAFT" || journal.status === "PENDING_APPROVAL"

  // Keyed by the journal id so a new journal and each existing one get a
  // grid initialized from its lines.
  return (
    <AmountGrid
      key={journal?.id ?? "new"}
      year={year}
      journal={journal}
      postable={postable}
      isEditable={isEditable}
    />
  )
}

export function OpeningBalancesPage() {
  const { accessToken } = useSession()

  const [financialYearId, setFinancialYearId] = useState<string>("")

  const years = useQuery({
    queryKey: ["accounting", "financial-years"],
    queryFn: () => listFinancialYears(accessToken!),
    enabled: Boolean(accessToken),
  })

  const accounts = useQuery({
    queryKey: ["accounting", "accounts", "flat"],
    queryFn: () => listAccountsFlat(accessToken!),
    enabled: Boolean(accessToken),
  })

  // Default to the earliest year — opening balances belong to the first one,
  // and that is the one someone lands here to enter. Derived, so no effect.
  const earliestId = years.data?.length
    ? [...years.data].sort((a, b) => a.startDate.localeCompare(b.startDate))[0].id
    : ""
  const effectiveYearId = financialYearId || earliestId
  const year = years.data?.find((y) => y.id === effectiveYearId)

  // Without `items`, Base UI's Select shows the raw value on the trigger —
  // the year's uuid rather than "FY 2025-26".
  const yearItems = useMemo(
    () => Object.fromEntries((years.data ?? []).map((y) => [y.id, y.name])),
    [years.data]
  )

  const postable = useMemo(
    () => (accounts.data ?? []).filter((a: Account) => !a.isGroup && a.isActive),
    [accounts.data]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Accounting"
        title="Opening balances"
        sub="The figures the books start with. One journal per financial year, and it must balance like any other."
      />

      {years.isLoading || accounts.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (years.data ?? []).length === 0 ? (
        <p className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          Create a financial year first — opening balances are entered against the first one.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Financial year</label>
              <Select
                items={yearItems}
                value={effectiveYearId}
                onValueChange={(v) => setFinancialYearId(v ?? "")}
              >
                <SelectTrigger className="w-56"><SelectValue placeholder="Choose a year" /></SelectTrigger>
                <SelectContent>
                  {(years.data ?? []).map((y) => (
                    <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {year && <OpeningBalancesGrid key={year.id} year={year} postable={postable} />}
        </div>
      )}
    </div>
  )
}
