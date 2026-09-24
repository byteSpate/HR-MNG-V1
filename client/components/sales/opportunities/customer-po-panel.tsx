"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine } from "@remixicon/react"

import { listCustomerPos } from "@/lib/api/customerPo"
import { listEarningEvents } from "@/lib/api/earningEvent"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, CustomerPoStatus, EarningEvent, OpportunityStatus, ReceivableDocStatus } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { CustomerPoDialog } from "@/components/accounting/customer-po-dialog"
import { EarningEventDialog } from "@/components/accounting/earning-event-dialog"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { Tone } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">{children}</div>
}

function PanelHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-[13.5px] font-bold">{title}</div>
      {action}
    </div>
  )
}

function poNet(po: CustomerPo): string {
  return po.lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2)
}

// No "blue" tone exists in this design system (Tone is green/yellow/red/neutral).
const STATUS_TONE: Record<CustomerPoStatus, Tone> = { OPEN: "neutral", COMPLETE: "green", CANCELLED: "red" }
const STATUS_LABEL: Record<CustomerPoStatus, string> = { OPEN: "Open", COMPLETE: "Complete", CANCELLED: "Cancelled" }
const DOC_TONE: Record<ReceivableDocStatus, Tone> = { DRAFT: "neutral", APPROVED: "green" }
const DOC_LABEL: Record<ReceivableDocStatus, string> = { DRAFT: "Draft", APPROVED: "Approved" }
const EVENT_KIND_LABEL: Record<EarningEvent["kind"], string> = { DELIVERY: "Delivery", ACCEPTANCE: "Acceptance" }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Spec §6 Roles: the deal's sales person records the Customer PO. The Sales
 * Hub is where they work, so the PO is recorded there — never invoice,
 * receipt or money-owed figures, which are Finance's pages and which a
 * sales user's token cannot reach anyway.
 */
export function CustomerPoPanel({ opportunity }: { opportunity: { id: string; serial: string; name: string; status: OpportunityStatus } }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [recording, setRecording] = useState(false)
  const [recordingEvent, setRecordingEvent] = useState<{ po: CustomerPo; kind: "DELIVERY" | "ACCEPTANCE" } | null>(null)

  const pos = useQuery({
    queryKey: ["customer-pos", { opportunityId: opportunity.id }],
    queryFn: () => listCustomerPos(accessToken!, { opportunityId: opportunity.id }),
    enabled: Boolean(accessToken) && opportunity.status === "WON",
  })
  const events = useQuery({
    queryKey: ["earning-events", { opportunityId: opportunity.id }],
    queryFn: () => listEarningEvents(accessToken!, { opportunityId: opportunity.id }),
    enabled: Boolean(accessToken) && opportunity.status === "WON",
  })

  const refreshEvents = () => {
    setRecordingEvent(null)
    queryClient.invalidateQueries({ queryKey: ["earning-events"] })
    queryClient.invalidateQueries({ queryKey: ["customer-pos"] })
  }

  if (opportunity.status !== "WON") return null

  return (
    <Panel>
      <PanelHeading
        title="Customer PO"
        action={
          <Button
            type="button"
            onClick={() => setRecording(true)}
            className="h-8 gap-1 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
          >
            <RiAddLine className="size-3.5" aria-hidden />
            Record customer PO
          </Button>
        }
      />

      {pos.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ) : pos.isError ? (
        <PanelAlert>{pos.error instanceof ApiError ? pos.error.message : toMessage(pos.error)}</PanelAlert>
      ) : (pos.data ?? []).length === 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>
          No customer PO recorded yet. Record it when the customer&apos;s purchase order arrives, so Finance can invoice it.
        </p>
      ) : (
        <ul>
          {(pos.data ?? []).map((po) => {
            const canRecordDelivery = po.trackDelivery && po.status === "OPEN" && po.lines.some((l) => l.earnKind === "DELIVERY")
            const canRecordAcceptance = po.trackDelivery && po.status === "OPEN" && po.lines.some((l) => l.earnKind === "ACCEPTANCE")
            const poEvents = (events.data ?? []).filter((e) => e.po.id === po.id)
            return (
              <li key={po.id} className="border-b border-[#EEF1F5] py-2.5 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{po.serial}</div>
                    <div className={`text-[11.5px] ${TONE.muted}`}>{po.customerPoNumber} · {formatDate(po.date)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[13px] font-bold">{formatMoney(poNet(po), "BDT")}</span>
                    <Tag label={STATUS_LABEL[po.status]} tone={STATUS_TONE[po.status]} />
                  </div>
                </div>

                {canRecordDelivery || canRecordAcceptance ? (
                  <div className="mt-2 flex gap-2">
                    {canRecordDelivery ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRecordingEvent({ po, kind: "DELIVERY" })}
                      >
                        Record delivery
                      </Button>
                    ) : null}
                    {canRecordAcceptance ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRecordingEvent({ po, kind: "ACCEPTANCE" })}
                      >
                        Record acceptance
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {poEvents.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {poEvents.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                        <span className={TONE.muted}>
                          {EVENT_KIND_LABEL[e.kind]} · {e.evidenceRef} · {formatDate(e.date)}
                        </span>
                        <Tag label={DOC_LABEL[e.status]} tone={DOC_TONE[e.status]} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {recording ? (
        <CustomerPoDialog
          open
          onOpenChange={(open) => !open && setRecording(false)}
          opportunity={{ id: opportunity.id, serial: opportunity.serial, name: opportunity.name }}
          onSaved={() => {
            setRecording(false)
            queryClient.invalidateQueries({ queryKey: ["customer-pos"] })
          }}
        />
      ) : null}

      {recordingEvent ? (
        <EarningEventDialog
          po={recordingEvent.po}
          kind={recordingEvent.kind}
          open
          onOpenChange={(open) => !open && setRecordingEvent(null)}
          onSaved={refreshEvents}
        />
      ) : null}
    </Panel>
  )
}
