"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"

import {
  getBankBook,
  getCashBook,
  getLedger,
  listAccountsFlat,
  listCashAccounts,
} from "@/lib/api/accounting"
import { useSession } from "@/lib/auth/session-context"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AccountPicker } from "@/components/accounting/account-picker"
import { HelpLink } from "@/components/help/help-link"
import {
  currentMonthRange,
  formatAmount,
  formatLedgerDate,
  formatSigned,
  formatTotal,
} from "@/components/accounting/accounting-shared"

type Mode = "GENERAL" | "CASH" | "BANK"

const COPY: Record<Mode, { title: string; description: string; empty: string }> = {
  GENERAL: {
    title: "General ledger",
    description: "Every posted movement on one account, with a running balance.",
    empty: "Pick an account and a date range.",
  },
  CASH: {
    title: "Cash book",
    description: "Receipts and payments through cash, with opening and closing balance.",
    empty: "Pick a cash account.",
  },
  BANK: {
    title: "Bank book",
    description: "Deposits and withdrawals per bank account, with opening and closing balance.",
    empty: "Pick a bank account.",
  },
}

function LedgerPageInner({ mode }: { mode: Mode }) {
  const { accessToken } = useSession()
  const initial = currentMonthRange()
  const searchParams = useSearchParams()

  // Lazy initialisers, not an effect: reading them once at mount means
  // arriving from the trial balance does not fight with a subsequent change
  // to the filters.
  const [accountId, setAccountId] = useState<string | null>(() => searchParams.get("accountId"))
  const [from, setFrom] = useState(() => searchParams.get("from") ?? initial.from)
  const [to, setTo] = useState(() => searchParams.get("to") ?? initial.to)

  // The general ledger offers every postable account; the books offer only
  // the ones tagged CASH or BANK, because the server refuses the rest.
  const accounts = useQuery({
    queryKey: ["accounting", "accounts", mode],
    queryFn: () =>
      mode === "GENERAL"
        ? listAccountsFlat(accessToken!)
        : listCashAccounts(accessToken!, mode),
    enabled: Boolean(accessToken),
  })

  // A book with exactly one account should not make you pick it — derived
  // rather than set into state, so a refetch never fights the user's choice.
  const onlyAccount =
    mode !== "GENERAL" && accounts.data && accounts.data.length === 1 ? accounts.data[0].id : null
  const effectiveAccountId = accountId ?? onlyAccount

  const ledger = useQuery({
    queryKey: ["accounting", "ledger", mode, effectiveAccountId, from, to],
    queryFn: () => {
      const params = { accountId: effectiveAccountId!, from, to }
      if (mode === "CASH") return getCashBook(accessToken!, params)
      if (mode === "BANK") return getBankBook(accessToken!, params)
      return getLedger(accessToken!, params)
    },
    enabled: Boolean(accessToken && effectiveAccountId),
  })

  const copy = COPY[mode]

  return (
    <div className="space-y-6">
      <PageHeader kicker="Accounting" title={copy.title} sub={copy.description} />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="grid w-72 gap-1">
          <label className="text-xs text-muted-foreground">Account</label>
          <AccountPicker
            accounts={accounts.data ?? []}
            value={effectiveAccountId}
            onChange={setAccountId}
            placeholder={mode === "GENERAL" ? "Choose an account" : `Choose a ${mode.toLowerCase()} account`}
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="led-from">From</label>
          <Input id="led-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="led-to">To</label>
          <Input id="led-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      {!effectiveAccountId ? (
        <p className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          {copy.empty}
        </p>
      ) : ledger.isLoading ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : ledger.isError ? (
        <div className="rounded-lg border p-10 text-center text-sm">
          <p className="text-muted-foreground">This ledger could not be loaded.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => ledger.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
            <h2 className="font-medium">
              <span className="text-muted-foreground tabular-nums">{ledger.data!.account.code}</span>{" "}
              {ledger.data!.account.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              Opening{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatSigned(ledger.data!.openingBalance)}
              </span>{" "}
              · Closing{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatSigned(ledger.data!.closingBalance)}
              </span>
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead className="w-32">Journal</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="w-28">Reference</TableHead>
                <TableHead className="w-32 text-right">Debit</TableHead>
                <TableHead className="w-32 text-right">Credit</TableHead>
                <TableHead className="w-36 text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40">
                <TableCell colSpan={6} className="font-medium">Opening balance</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatSigned(ledger.data!.openingBalance)}
                </TableCell>
              </TableRow>

              {ledger.data!.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No movement in this period.{" "}
                    <HelpLink>How does this work?</HelpLink>
                  </TableCell>
                </TableRow>
              ) : (
                ledger.data!.rows.map((r, i) => (
                  <TableRow key={`${r.journalId}-${i}`}>
                    <TableCell className="tabular-nums">{formatLedgerDate(r.date)}</TableCell>
                    <TableCell className="tabular-nums">
                      {/* Drill-down: every ledger figure reaches its journal. */}
                      <Link href={`journals/${r.journalId}`} className="hover:underline">
                        {r.journalNo}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-md truncate">
                      {r.lineNarration ?? r.narration}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.reference ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(r.debit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(r.credit)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSigned(r.runningBalance)}
                    </TableCell>
                  </TableRow>
                ))
              )}

              <TableRow className="border-t-2 font-medium">
                <TableCell colSpan={4} className="text-right">Period total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTotal(ledger.data!.totalDebit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTotal(ledger.data!.totalCredit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatSigned(ledger.data!.closingBalance)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

export function LedgerPage({ mode }: { mode: Mode }) {
  // useSearchParams forces client rendering up to the nearest Suspense
  // boundary, so the whole page sits behind one.
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <LedgerPageInner mode={mode} />
    </Suspense>
  )
}
