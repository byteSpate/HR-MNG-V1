"use client"

import { Fragment, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { RiArrowDownSLine, RiArrowUpSLine } from "@remixicon/react"

import { listPayments } from "@/lib/api/sales/payments"
import { salesKeys } from "@/lib/api/sales/keys"
import type { PaymentRow } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { percentText, STATUS_WORD } from "@/lib/payments"
import { paymentMethodLabel } from "@/lib/receipt-method"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { ExportMenu } from "@/components/import-export/export-menu"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type Filter = { accountId?: string; opportunityId?: string; open?: boolean }
type SortKey = "invoiceNumber" | "dueDate" | "accountName" | "opportunityName" | "invoiceTotal" | "received" | "percentPaid" | "balance" | "status"

/** Exact money, paisa included: a payment figure is never rounded away. */
const money = (v: string) => `৳${Number(v).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

const STATUS_CLASS: Record<PaymentRow["status"], string> = {
  PAID: "bg-[#EEF8F2] text-[#17673A]",
  PART_PAID: "bg-[#FFF6E5] text-[#8A5E0C]",
  UNPAID: "bg-[#F1F4F8] text-[#5F6B7C]",
  OVERDUE: "bg-[#FCEFEF] text-[#B03A3A]",
}

const NUMERIC: SortKey[] = ["invoiceTotal", "received", "percentPaid", "balance"]

function sortRows(rows: PaymentRow[], key: SortKey, dir: "asc" | "desc"): PaymentRow[] {
  const sign = dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = a[key]
    const y = b[key]
    if (NUMERIC.includes(key)) return sign * ((x === null ? -1 : Number(x)) - (y === null ? -1 : Number(y)))
    return sign * String(x).localeCompare(String(y))
  })
}

/**
 * A Payments table (owner, 2026-10-18), for Sales Admins and Super Admins:
 * one row per approved invoice, how much was received, the % paid and what
 * is still owed. A click on a row opens its receipts, for customers who pay
 * in parts. Sort by a column name, and download as CSV or PDF.
 */
export function PaymentsTable({
  filter,
  showAccount = false,
  showOpportunity = false,
  emptyText = "No approved invoice yet.",
}: {
  filter: Filter
  showAccount?: boolean
  showOpportunity?: boolean
  emptyText?: string
}) {
  const { accessToken } = useSession()
  const [sort, setSort] = useState<SortKey>("dueDate")
  const [dir, setDir] = useState<"asc" | "desc">("asc")
  const [openId, setOpenId] = useState<string | null>(null)
  const query = useQuery({
    queryKey: salesKeys.payments(filter),
    queryFn: () => listPayments(accessToken!, filter),
    enabled: !!accessToken,
  })

  const columns: { key: SortKey; label: string; right?: boolean }[] = [
    { key: "invoiceNumber", label: "Invoice" },
    { key: "dueDate", label: "Due date" },
    ...(showAccount ? [{ key: "accountName" as const, label: "Account" }] : []),
    ...(showOpportunity ? [{ key: "opportunityName" as const, label: "Opportunity" }] : []),
    { key: "invoiceTotal", label: "Invoice total", right: true },
    { key: "received", label: "Received", right: true },
    { key: "percentPaid", label: "% paid", right: true },
    { key: "balance", label: "Balance", right: true },
    { key: "status", label: "Status" },
  ]
  const sortBy = (key: SortKey) => {
    if (key === sort) setDir(dir === "asc" ? "desc" : "asc")
    else {
      setSort(key)
      setDir("asc")
    }
  }

  if (query.isPending) return <Skeleton className="h-32 w-full" />
  if (query.isError) {
    return (
      <div className="grid gap-2">
        <PanelAlert>{toMessage(query.error)}</PanelAlert>
        <div>
          <Button type="button" onClick={() => query.refetch()} className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]">
            Try again
          </Button>
        </div>
      </div>
    )
  }
  const { rows, totals } = query.data
  if (rows.length === 0) {
    return <p className={`rounded-md border border-[#E4E9EF] bg-white px-4 py-4 text-[12.5px] ${TONE.muted}`}>{emptyText}</p>
  }
  const sorted = sortRows(rows, sort, dir)
  const cell = "border-b border-r border-[#EEF1F5] px-3 py-2 last:border-r-0"

  return (
    <div className="grid gap-2">
      <div className="flex justify-end">
        <ExportMenu
          basePath="/api/sales/payments"
          fileName="payments"
          params={{ accountId: filter.accountId, opportunityId: filter.opportunityId, open: filter.open ? "true" : undefined }}
          formats={["csv", "pdf"]}
        />
      </div>
      <div className="overflow-x-auto rounded-md border border-[#E4E9EF] bg-white">
        <table className="w-full min-w-[46rem] border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#F7F9FB] text-left text-[11px] font-bold tracking-wide text-[#5F6B7C] uppercase">
              {columns.map((c) => {
                const active = c.key === sort
                const Arrow = active && dir === "desc" ? RiArrowDownSLine : RiArrowUpSLine
                return (
                  <th key={c.key} className={cn(cell, "font-bold", c.right && "text-right")}>
                    <button type="button" onClick={() => sortBy(c.key)} className={cn("inline-flex items-center gap-0.5 uppercase hover:text-[#17191C]", active && "text-[#17191C]")}>
                      {c.label}
                      <Arrow className={cn("size-3.5", !active && "opacity-30")} aria-hidden />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const open = openId === r.invoiceId
              return (
                <Fragment key={r.invoiceId}>
                  <tr
                    onClick={() => setOpenId(open ? null : r.invoiceId)}
                    aria-expanded={open}
                    className="cursor-pointer hover:bg-[#F7F9FB]"
                  >
                    <td className={cn(cell, "font-semibold")}>
                      <span className="inline-flex items-center gap-1">
                        <RiArrowDownSLine className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
                        {r.invoiceNumber}
                      </span>
                    </td>
                    <td className={cell}>{day(r.dueDate)}</td>
                    {showAccount ? (
                      <td className={cell}>
                        <Link href={`/sales/accounts/${r.accountId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.accountName}</Link>
                      </td>
                    ) : null}
                    {showOpportunity ? (
                      <td className={cell}>
                        <Link href={`/sales/opportunities/${r.opportunityId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{r.opportunityName}</Link>
                      </td>
                    ) : null}
                    <td className={cn(cell, "text-right tabular-nums")}>{money(r.invoiceTotal)}</td>
                    <td className={cn(cell, "text-right tabular-nums")}>{money(r.received)}</td>
                    <td className={cn(cell, "text-right tabular-nums")}>{percentText(r.percentPaid)}</td>
                    <td className={cn(cell, "text-right font-semibold tabular-nums")}>{money(r.balance)}</td>
                    <td className={cell}>
                      <span className={cn("rounded px-1.5 py-0.5 text-[11.5px] font-bold", STATUS_CLASS[r.status])}>{STATUS_WORD[r.status]}</span>
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={columns.length} className="border-b border-[#EEF1F5] bg-[#FBFCFD] px-4 py-2.5">
                        <div className={`mb-1 text-[11.5px] ${TONE.muted}`}>Invoice date {day(r.date)}</div>
                        {r.receipts.length === 0 ? (
                          <p className={`text-[12px] ${TONE.muted}`}>No payment received yet.</p>
                        ) : (
                          <ul className="grid gap-0.5 text-[12px]">
                            {r.receipts.map((p) => (
                              <li key={`${p.number}-${p.date}`} className="flex flex-wrap gap-x-3">
                                <span className="font-semibold">{p.number}</span>
                                <span>{day(p.date)}</span>
                                <span className={TONE.muted}>{paymentMethodLabel(p.method as never)}</span>
                                <span className="tabular-nums">{money(p.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-[#F7F9FB] font-bold">
              <td className={cell} colSpan={2 + (showAccount ? 1 : 0) + (showOpportunity ? 1 : 0)}>Total ({rows.length})</td>
              <td className={cn(cell, "text-right tabular-nums")}>{money(totals.invoiceTotal)}</td>
              <td className={cn(cell, "text-right tabular-nums")}>{money(totals.received)}</td>
              <td className={cell} />
              <td className={cn(cell, "text-right tabular-nums")}>{money(totals.balance)}</td>
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
