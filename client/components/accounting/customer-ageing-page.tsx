"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { RiFileDownloadLine } from "@remixicon/react"

import { downloadCustomerStatementPdf, getCustomerAgeing, getCustomerStatement, getCustomerTieOut } from "@/lib/api/receivables"
import { useSession } from "@/lib/auth/session-context"
import type { AgeingBucket, CustomerAgeingRow, CustomerStatement } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { PageHeader } from "@/components/dashboard/page-header"
import { Field, PanelAlert, PanelTable, TONE } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { Tone } from "@/components/dashboard/types"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const BUCKET_TONE: Record<AgeingBucket, Tone> = {
  "Not due": "neutral",
  "1-30": "yellow",
  "31-60": "yellow",
  "61-90": "red",
  "Over 90": "red",
}
const BUCKETS: AgeingBucket[] = ["Not due", "1-30", "31-60", "61-90", "Over 90"]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
function bucketLabel(b: AgeingBucket): string {
  return b === "Not due" || b === "Over 90" ? b : `${b} days`
}
function firstOfMonth(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10)
}
function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export function CustomerAgeingPage() {
  const { accessToken } = useSession()
  const [statementFor, setStatementFor] = useState<{ id: string; legalName: string } | null>(null)

  const ageing = useQuery({
    queryKey: ["customer-ageing"],
    queryFn: () => getCustomerAgeing(accessToken!),
    enabled: Boolean(accessToken),
  })
  const tieOut = useQuery({
    queryKey: ["customer-tie-out"],
    queryFn: () => getCustomerTieOut(accessToken!),
    enabled: Boolean(accessToken),
  })

  const data: CustomerAgeingRow[] = ageing.data ?? []
  const totals = BUCKETS.map((bucket) => ({
    bucket,
    amount: data.filter((r) => r.bucket === bucket).reduce((s, r) => s + Number(r.outstanding), 0),
  }))

  const rows: TableCell[][] = data.map((r) => [
    { text: r.customerName, weight: 600 },
    { text: r.label },
    { text: r.dealSerial ?? "—" },
    { text: formatDate(r.dueDate) },
    { text: formatMoney(r.outstanding, "BDT") },
    { node: <Tag label={bucketLabel(r.bucket)} tone={BUCKET_TONE[r.bucket]} /> },
    {
      node: (
        <Button
          type="button"
          variant="ghost"
          className="h-auto rounded-md px-2 py-1 text-[12px] font-semibold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
          onClick={() => setStatementFor({ id: r.customerId, legalName: r.customerName })}
        >
          <RiFileDownloadLine className="size-3.5" aria-hidden />
          Statement
        </Button>
      ),
    },
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Customer ageing"
        sub="What customers still owe us, by how far past the due date each one is."
      />

      {tieOut.data && !tieOut.data.ties ? (
        <PanelAlert>
          Customer balances do not agree with the ledger: the invoices add up to {formatMoney(tieOut.data.subledgerTotal, "BDT")},
          but account 1220 Trade Receivables, Customers reads {formatMoney(tieOut.data.glBalance, "BDT")}. One of them is wrong,
          and it needs finding before these figures are relied on.
        </PanelAlert>
      ) : null}
      {tieOut.data?.ties ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>
          The invoices below add up to {formatMoney(tieOut.data.subledgerTotal, "BDT")}, the same as account 1220 in the ledger.
        </p>
      ) : null}
      {tieOut.data && Number(tieOut.data.advancesHeld) !== 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>
          Customers have also paid {formatMoney(tieOut.data.advancesHeld, "BDT")} in advance, not yet matched to an invoice.
          That sits in Customer Advances (2160), not in the figures above.
        </p>
      ) : null}

      {ageing.isSuccess && data.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {totals.map((t) => (
            <div key={t.bucket} className="rounded-md border border-[#E4E9EF] bg-white px-4 py-3">
              <div className={`text-[11px] font-bold tracking-wide uppercase ${TONE.muted}`}>{bucketLabel(t.bucket)}</div>
              <div className="font-heading mt-1 text-[15px] font-bold tabular-nums">
                {t.amount > 0 ? formatMoney(t.amount.toFixed(2), "BDT") : "—"}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <PanelTable
        cols="1.4fr 1.3fr 0.9fr 0.9fr 1fr 0.9fr 0.9fr"
        headers={["Customer", "What", "Deal", "Due", "Owed", "Overdue", ""]}
        rows={rows}
        isLoading={ageing.isPending}
        isError={ageing.isError}
        onRetry={() => ageing.refetch()}
        emptyTitle="Nothing is owed by customers"
        emptyBody="Every approved invoice has been paid or credited in full. Draft invoices and draft receipts do not appear here until they are approved."
        onEmptyAction={() => ageing.refetch()}
      />

      {statementFor ? (
        <StatementDialog customer={statementFor} onClose={() => setStatementFor(null)} />
      ) : null}
    </div>
  )
}

function StatementDialog({
  customer,
  onClose,
}: {
  customer: { id: string; legalName: string }
  onClose: () => void
}) {
  const { accessToken } = useSession()
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(today())
  const [error, setError] = useState<string | null>(null)

  const statement = useQuery({
    queryKey: ["customer-statement", customer.id, from, to],
    queryFn: () => getCustomerStatement(accessToken!, customer.id, { from, to }),
    enabled: Boolean(accessToken) && Boolean(from) && Boolean(to),
  })

  const download = useMutation({
    mutationFn: () => downloadCustomerStatementPdf(accessToken!, customer.id, { from, to }),
    onSuccess: (blob) => downloadBlob(blob, `statement-${slugify(customer.legalName)}-${to}.pdf`),
    onError: () => setError("Could not download the statement. Please try again."),
  })

  const s: CustomerStatement | undefined = statement.data

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Statement · {customer.legalName}</DialogTitle>
          <DialogDescription>Everything owed and paid in the period, with a running balance.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="stmt-from">
              <Input id="stmt-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="stmt-to">
              <Input id="stmt-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>

          {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

          {statement.isPending ? (
            <p className={`text-[12.5px] ${TONE.muted}`}>Loading…</p>
          ) : statement.isError ? (
            <PanelAlert>This statement could not be loaded.</PanelAlert>
          ) : s ? (
            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-[#E4E9EF]">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#E4E9EF] text-left text-[11px] font-bold tracking-wide text-[#5F6B7C] uppercase">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">What</th>
                    <th className="px-3 py-2 text-right">Owed</th>
                    <th className="px-3 py-2 text-right">Paid</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#EEF1F5]">
                    <td className="px-3 py-2" colSpan={4}>Opening balance</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(s.openingBalance, "BDT")}</td>
                  </tr>
                  {s.entries.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-[12px]" colSpan={5} style={{ color: "#5F6B7C" }}>
                        No invoices, receipts or credit notes in this period.
                      </td>
                    </tr>
                  ) : (
                    s.entries.map((e, i) => (
                      <tr key={i} className="border-b border-[#EEF1F5] last:border-b-0">
                        <td className="px-3 py-2">{formatDate(e.date)}</td>
                        <td className="px-3 py-2">{e.reference}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.debit ? formatMoney(e.debit, "BDT") : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.credit ? formatMoney(e.credit, "BDT") : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(e.balance, "BDT")}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#17191C]">
                    <td className="px-3 py-2 font-bold" colSpan={4}>Closing balance</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{formatMoney(s.closingBalance, "BDT")}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} className="h-auto rounded-md px-3.5 py-2 text-[12.5px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]">
            Close
          </Button>
          <Button
            type="button"
            disabled={download.isPending}
            onClick={() => download.mutate()}
            className="h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
          >
            {download.isPending ? "Preparing…" : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
