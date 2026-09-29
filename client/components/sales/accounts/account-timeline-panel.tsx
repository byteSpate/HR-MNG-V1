"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { getAccountTimeline, logCommunication } from "@/lib/api/sales/accounts"
import { useSession } from "@/lib/auth/session-context"
import type { LogCommunicationBody, SalesChannel, TimelineItem } from "@/lib/api/types"
import { CHANNEL_ICON, CHANNEL_LABEL, channelForMeta, EVENT_ICON, MEETING_ICON, TASK_ICON } from "@/components/sales/shared/sales-shared"
import { DialogActions, Field, FormError, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Panel, PanelError, PanelHeading, PanelSkeleton } from "@/components/sales/shared/panel"

export function formatMoment(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

/** `datetime-local` has no timezone of its own — read as local wall-clock
    time, same as every other date the client picks for the server. */
function nowForDatetimeLocal(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

function TimelineRow({ item, delayMs }: { item: TimelineItem; delayMs: number }) {
  const Icon =
    item.kind === "communication"
      ? CHANNEL_ICON[channelForMeta(item.meta)]
      : item.kind === "meeting"
        ? MEETING_ICON
        : item.kind === "task"
          ? TASK_ICON
          : EVENT_ICON
  return (
    <li className="rise-in border-b border-[#EEF1F5] py-3 last:border-b-0" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="flex items-start gap-2">
        <span
          className={
            item.kind === "communication"
              ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#EEF3FC] text-[#3B67C4]"
              : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#F1F4F8] text-[#6B7789]"
          }
        >
          <Icon className="size-3" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#1C2733]">{item.title}</div>
          <div className="mt-0.5 text-[11.5px] text-[#6B7789]">
            {formatMoment(item.at)}
            {item.by ? ` · ${item.by}` : ""}
          </div>
          {item.meta ? <div className="mt-1 text-[12px] text-[#3D4756]">{item.meta}</div> : null}
          {/* The bug this fixes: the long-form note a caller typed into "Log a
              call" was saved but never shown back to them. */}
          {item.detail ? (
            <div className="mt-1.5 rounded-md bg-[#F7F9FB] px-2.5 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-[#3D4756]">
              {item.detail}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export function AccountTimelinePanel({
  accountId,
  canManage,
  canLog,
}: {
  accountId: string
  canManage: boolean
  canLog: boolean
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [logOpen, setLogOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [channel, setChannel] = useState<SalesChannel>("CALL")
  const [occurredAt, setOccurredAt] = useState(nowForDatetimeLocal())
  const [summary, setSummary] = useState("")
  const [detail, setDetail] = useState("")

  const timelineQuery = useQuery({
    queryKey: ["sales", "accounts", accountId, "timeline"],
    queryFn: () => getAccountTimeline(accessToken!, accountId),
    enabled: !!accessToken,
  })

  const logMutation = useMutation({
    mutationFn: (body: LogCommunicationBody) => logCommunication(accessToken!, accountId, body),
    onSuccess: () => {
      setLogOpen(false)
      queryClient.invalidateQueries({ queryKey: ["sales", "accounts", accountId, "timeline"] })
      queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] })
    },
    onError: (err) => setFormError(toMessage(err)),
  })

  function resetForm() {
    setChannel("CALL")
    setOccurredAt(nowForDatetimeLocal())
    setSummary("")
    setDetail("")
    setFormError(null)
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setFormError(null)
    if (!summary.trim()) {
      setFormError("Say what happened.")
      return
    }
    // `datetime-local` hands back "" when cleared, and an unparseable value
    // gives an Invalid Date. Either one used to reach toISOString(), which
    // throws a RangeError before the mutation runs — so the dialog's own
    // error UI never got the chance to say anything.
    const when = new Date(occurredAt)
    if (!occurredAt || Number.isNaN(when.getTime())) {
      setFormError("Pick when this happened.")
      return
    }
    logMutation.mutate({
      channel,
      occurredAt: when.toISOString(),
      summary: summary.trim(),
      detail: detail.trim() || undefined,
    })
  }

  if (timelineQuery.isPending) return <PanelSkeleton />
  if (timelineQuery.isError) return <PanelError onRetry={() => timelineQuery.refetch()} />

  const items = timelineQuery.data?.items ?? []

  return (
    <Panel>
      <PanelHeading
        title="Timeline"
        action={
          canLog ? (
            <Button
              onClick={() => {
                resetForm()
                setLogOpen(true)
              }}
              className="h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              Log a call
            </Button>
          ) : undefined
        }
      />

      {/* Only for someone who *can* manage this account and still cannot log
          on it — an admin login with no employee record. A read-only viewer
          is already told why by the notice in the page header, and this
          sentence would be the wrong reason for them. */}
      {canManage && !canLog ? (
        <p className="mb-3 rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-2 text-[12px] leading-relaxed text-[#5F6B7C]">
          Logging a call records who made it, so it needs an employee record.
          Your account is an administrative login and has none.
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-[#5F6B7C]">
          Nothing has happened on this account yet.
        </p>
      ) : (
        <ul>
          {items.map((item, i) => (
            <TimelineRow key={item.id} item={item} delayMs={Math.min(i, 8) * 24} />
          ))}
        </ul>
      )}

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log a call or message</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {/* `id` on the trigger, wired by `htmlFor`: the control is a
                  button rather than a native <select>, so without this the
                  label is only visually adjacent and a screen reader reads
                  the trigger unlabelled. */}
              <Field label="Channel" htmlFor="log-channel">
                <Select value={channel} onValueChange={(v) => v && setChannel(v as SalesChannel)}>
                  <SelectTrigger id="log-channel" className="w-full">
                    <SelectValue>{(v: string | null) => CHANNEL_LABEL[(v as SalesChannel) ?? "CALL"]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CHANNEL_LABEL) as SalesChannel[]).map((c) => (
                      <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="When" htmlFor="log-when">
                <Input
                  id="log-when"
                  type="datetime-local"
                  value={occurredAt}
                  max={nowForDatetimeLocal()}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              </Field>
            </div>
            <Field label="What happened" htmlFor="log-summary">
              <Input id="log-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
            <Field label="Detail" htmlFor="log-detail" hint="Optional." help="Anything from the conversation worth keeping. It shows on the Timeline with the call.">
              <Textarea id="log-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
            </Field>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogActions
                pending={logMutation.isPending}
                submitLabel="Log it"
                disabled={false}
                onCancel={() => setLogOpen(false)}
                onSubmit={() => handleSubmit()}
              />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
