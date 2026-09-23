"use client"

import { useQuery } from "@tanstack/react-query"

import { getSupplierAgeing, getSupplierControlTieOut, listSupplierBills } from "@/lib/api/supplierBill"
import { useSession } from "@/lib/auth/session-context"
import type { AgeingBucket, SupplierAgeingRow } from "@/lib/api/types"
import type { Tone } from "@/components/dashboard/types"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, PanelTable, TONE } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { TableCell } from "@/components/dashboard/types"

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

export function SupplierAgeingPage() {
  const { accessToken } = useSession()

  const ageing = useQuery({
    queryKey: ["supplier-ageing"],
    queryFn: () => getSupplierAgeing(accessToken!),
    enabled: Boolean(accessToken),
  })
  const tieOut = useQuery({
    queryKey: ["supplier-tie-out"],
    queryFn: () => getSupplierControlTieOut(accessToken!),
    enabled: Boolean(accessToken),
  })
  const bills = useQuery({
    queryKey: ["supplier-bills"],
    queryFn: () => listSupplierBills(accessToken!),
    enabled: Boolean(accessToken),
  })

  const billNumber = new Map((bills.data ?? []).map((b) => [b.id, b.billNumber]))
  const data: SupplierAgeingRow[] = ageing.data ?? []

  const totals = BUCKETS.map((bucket) => ({
    bucket,
    amount: data.filter((r) => r.bucket === bucket).reduce((s, r) => s + Number(r.outstanding), 0),
  }))

  const rows: TableCell[][] = data.map((r) => [
    { text: r.supplierName, sub: billNumber.get(r.billId), weight: 600 },
    { text: formatDate(r.dueDate) },
    { text: formatMoney(r.outstanding, "BDT") },
    { node: <Tag label={bucketLabel(r.bucket)} tone={BUCKET_TONE[r.bucket]} /> },
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Supplier ageing"
        sub="What we still owe suppliers on approved bills, by how far past the due date each one is."
      />

      {/* A mismatch is a bug, and it is shown as one (design §4), not
          softened into a warning. */}
      {tieOut.data && !tieOut.data.ties ? (
        <PanelAlert>
          Supplier balances do not agree with the ledger: the bills add up to {formatMoney(tieOut.data.subledgerTotal, "BDT")},
          but account 2111 Trade Payables, Suppliers reads {formatMoney(tieOut.data.glBalance, "BDT")}. One of them is wrong,
          and it needs finding before these figures are relied on.
        </PanelAlert>
      ) : null}
      {tieOut.data?.ties ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>
          The bills below add up to {formatMoney(tieOut.data.subledgerTotal, "BDT")}, the same as account 2111 in the ledger.
        </p>
      ) : null}

      {/* Hidden until the list has loaded: a total beside a skeleton reads
          as an answer. */}
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
        cols="1.6fr 1fr 1fr 0.9fr"
        headers={["Supplier", "Due", "Outstanding", "Overdue"]}
        rows={rows}
        isLoading={ageing.isPending}
        isError={ageing.isError}
        onRetry={() => ageing.refetch()}
        emptyTitle="Nothing is owed to suppliers"
        emptyBody="Every approved supplier bill has been paid or credited in full. Draft bills and draft payments do not appear here until they are approved."
        onEmptyAction={() => ageing.refetch()}
      />
    </div>
  )
}
