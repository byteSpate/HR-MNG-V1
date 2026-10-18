"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { RiArrowDownSLine } from "@remixicon/react"

import { getHeatmapOverview } from "@/lib/api/sales/dashboard"
import { salesKeys } from "@/lib/api/sales/keys"
import type { HeatmapOverviewAccount, HeatmapOverviewProduct } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { barShares, checkedLine, COLOUR } from "@/lib/heatmap"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

function AccountList({ colour, accounts }: { colour: "GREEN" | "RED"; accounts: HeatmapOverviewAccount[] }) {
  const tone = COLOUR[colour]
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 flex items-center gap-2 text-[12px] font-bold">
        <span className={cn("size-2.5 rounded-full", tone.dot)} aria-hidden />
        <span className={tone.text}>{tone.lane}</span>
        <span className={`font-semibold ${TONE.muted}`}>{accounts.length}</span>
      </h4>
      {accounts.length === 0 ? (
        <p className={`text-[12px] ${TONE.muted}`}>No accounts.</p>
      ) : (
        <ul className="grid gap-0.5 text-[12.5px]">
          {accounts.map((a) => (
            <li key={a.id}>
              <Link href={`/sales/accounts/${a.id}`} className="font-semibold [overflow-wrap:anywhere] hover:underline">
                {a.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProductLine({ product, accounts }: { product: HeatmapOverviewProduct; accounts: number }) {
  const [open, setOpen] = useState(false)
  const shares = barShares(product, accounts)
  const summary = `${product.green} Green, ${product.red} Red, ${product.notChecked} not checked`
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="grid w-full min-w-0 items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-left hover:bg-[#F7F9FB] focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto_auto]"
      >
        <span className="min-w-0">
          <span className="block text-[13px] font-bold [overflow-wrap:anywhere]">{product.title}</span>
          <span className={`block text-[11.5px] ${TONE.muted}`}>{product.groupTitle}</span>
        </span>
        {shares ? (
          <span role="img" aria-label={summary} className="flex h-2.5 min-w-0 overflow-hidden rounded-full bg-[#E4E9EF]">
            <span className={COLOUR.GREEN.stripe} style={{ width: `${shares.green}%` }} />
            <span className={COLOUR.RED.stripe} style={{ width: `${shares.red}%` }} />
          </span>
        ) : (
          <span className={`text-[12px] ${TONE.muted}`}>No accounts</span>
        )}
        <span className="text-[12px] whitespace-nowrap">
          <span className={cn("font-bold", COLOUR.GREEN.text)}>{product.green}</span> Green{" "}
          <span className={cn("font-bold", COLOUR.RED.text)}>{product.red}</span> Red{" "}
          <span className={cn("font-bold", COLOUR.GREY.text)}>{product.notChecked}</span> not checked
        </span>
        <RiArrowDownSLine
          className={cn("size-5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-[#E4E9EF] bg-white px-4 py-3 animate-in fade-in-0 slide-in-from-top-1 fill-mode-backwards duration-300 motion-reduce:animate-none sm:grid-cols-2">
          <AccountList colour="GREEN" accounts={product.greenAccounts} />
          <AccountList colour="RED" accounts={product.redAccounts} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * The Heatmap band on the Sales dashboard (owner, 2026-10-18): each product,
 * and how many accounts are Green, Red or not checked. It follows the same
 * scope picker as the rest of the page. A click on a product lists the Green
 * and Red accounts, each a link to the account.
 */
export function HeatmapBand({ employeeId }: { employeeId?: string }) {
  const { accessToken } = useSession()
  const query = useQuery({
    queryKey: salesKeys.heatmapOverview(employeeId),
    queryFn: () => getHeatmapOverview(accessToken!, employeeId),
    enabled: !!accessToken,
  })
  const data = query.data

  return (
    <section className="mt-5">
      <div className="mb-2.5">
        <h2 className="font-heading text-[15px] font-bold tracking-tight">Heatmap</h2>
        <p className={`mt-0.5 text-[12.5px] ${TONE.muted}`}>
          {data ? checkedLine(data) : "Where we can offer each product."}
        </p>
      </div>

      {query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError ? (
        <div className="grid gap-2">
          <PanelAlert>{toMessage(query.error)}</PanelAlert>
          <div>
            <Button
              type="button"
              onClick={() => query.refetch()}
              className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              Try again
            </Button>
          </div>
        </div>
      ) : query.data.products.length === 0 ? (
        <p className={`rounded-md border border-[#E4E9EF] bg-white px-4 py-4 text-[12.5px] ${TONE.muted}`}>
          The heatmap list is empty. A Sales Admin can add products in Sales Settings.
        </p>
      ) : (
        <ul className="divide-y divide-[#E4E9EF] overflow-hidden rounded-md border border-[#E4E9EF] bg-white">
          {query.data.products.map((product) => (
            <ProductLine key={product.id} product={product} accounts={query.data.accounts} />
          ))}
        </ul>
      )}
    </section>
  )
}
