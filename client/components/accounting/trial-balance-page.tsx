"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { RiCheckboxCircleLine, RiErrorWarningLine } from "@remixicon/react"

import { signedBalance, toInOut } from "@/lib/accounting/side-style"
import { getTrialBalance } from "@/lib/api/accounting"
import { useSession } from "@/lib/auth/session-context"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  currentMonthRange,
  formatAmount,
  formatSigned,
  formatTotal,
} from "@/components/accounting/accounting-shared"
import { HelpLink } from "@/components/help/help-link"

/**
 * Opening, In, Out and Closing for every account, laid out like the bank's own
 * daily statement (owner request, 2026-10-05). In and Out are the stored Debit
 * and Credit movement, named without either word, so this table reads the same
 * whichever way the other screens call the sides. Each balance is one number:
 * Opening plus In minus Out.
 */
export function TrialBalancePage() {
  const { accessToken } = useSession()
  const initial = currentMonthRange()

  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  const tb = useQuery({
    queryKey: ["accounting", "trial-balance", from, to],
    queryFn: () => getTrialBalance(accessToken!, from, to),
    enabled: Boolean(accessToken),
  })

  const rows = tb.data?.rows.map(toInOut) ?? []
  // Every balance added up. On a balanced book both are zero.
  const openingGap = tb.data ? signedBalance(tb.data.totals.openingDebit, tb.data.totals.openingCredit) : "0.00"
  const closingGap = tb.data ? signedBalance(tb.data.totals.closingDebit, tb.data.totals.closingCredit) : "0.00"

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Accounting"
        title="Trial balance"
        sub="Opening balance, money In and Out in the period, and closing balance for every account."
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="tb-from">From</label>
          <Input id="tb-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="tb-to">To</label>
          <Input id="tb-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      {tb.isPending ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : tb.isError ? (
        <div className="rounded-lg border p-10 text-center text-sm">
          <p className="text-muted-foreground">The trial balance could not be loaded.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => tb.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/*
            Stated plainly at the top, because an out-of-balance trial
            balance is the one fact that invalidates everything below it —
            and in slice 2, blocks the financial statements entirely.
          */}
          <div
            className={
              tb.data!.isBalanced
                ? "flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
                : "flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            }
          >
            {tb.data!.isBalanced ? (
              <>
                <RiCheckboxCircleLine className="size-4" />
                <span>
                  Balanced. In and Out both total{" "}
                  <span className="font-medium tabular-nums">
                    {formatTotal(tb.data!.totals.periodDebit)}
                  </span>
                  .
                </span>
              </>
            ) : (
              <>
                <RiErrorWarningLine className="size-4 text-destructive" />
                <span>
                  <span className="font-medium">Not balanced.</span> The closing balances should add up to
                  zero. They are off by{" "}
                  <span className="tabular-nums">{formatTotal(closingGap)}</span>. Financial statements
                  cannot be produced until this agrees.
                </span>
              </>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="w-36 text-right">Opening</TableHead>
                  <TableHead className="w-36 text-right text-emerald-700">In (+)</TableHead>
                  <TableHead className="w-36 text-right text-red-700">Out (-)</TableHead>
                  <TableHead className="w-36 text-right">Closing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tb.data!.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      Nothing has been posted in or before this period.{" "}
                      <HelpLink>How does this work?</HelpLink>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.accountId}>
                      <TableCell className="text-muted-foreground tabular-nums">{r.code}</TableCell>
                      <TableCell>
                        {/* Drill-down: trial balance → ledger → journal. */}
                        <Link
                          href={`../ledger?accountId=${r.accountId}&from=${from}&to=${to}`}
                          className="hover:underline"
                        >
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatSigned(r.opening)}</TableCell>
                      <TableCell className="text-right text-emerald-700 tabular-nums">{formatAmount(r.in)}</TableCell>
                      <TableCell className="text-right text-red-700 tabular-nums">{formatAmount(r.out)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatSigned(r.closing)}</TableCell>
                    </TableRow>
                  ))
                )}

                <TableRow className="border-t-2 font-medium">
                  <TableCell colSpan={2} className="text-right">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSigned(openingGap)}</TableCell>
                  <TableCell className="text-right text-emerald-700 tabular-nums">{formatTotal(tb.data!.totals.periodDebit)}</TableCell>
                  <TableCell className="text-right text-red-700 tabular-nums">{formatTotal(tb.data!.totals.periodCredit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSigned(closingGap)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            A balance in brackets means the account has had more Out than In.
          </p>
        </>
      )}
    </div>
  )
}
