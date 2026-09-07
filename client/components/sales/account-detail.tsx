"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiErrorWarningLine,
  RiMailLine,
  RiPhoneLine,
  RiRefreshLine,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react"

import {
  addContact,
  getAccountHistory,
  getAccountTimeline,
  getSalesAccount,
  listContacts,
  logCommunication,
  setContactStatus,
  setPrimaryContact,
} from "@/lib/api/sales"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type {
  AccountHistoryEntry,
  CreateSalesContactBody,
  LogCommunicationBody,
  SalesChannel,
  SalesContactSummary,
  TimelineItem,
} from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import { DialogActions, Field, FormError, RowActions, toMessage } from "@/components/dashboard/record-kit"
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, CHANNEL_LABEL, CONTACT_STATUS_LABEL, CONTACT_STATUS_TONE } from "@/components/sales/sales-shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

/** The white bordered card every panel on this page is drawn on — the same
    surface DataTable and PanelTable already use, kept local since none of
    the three panels here are a table. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">{children}</div>
  )
}

function PanelHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-[13.5px] font-bold">{title}</div>
      {action}
    </div>
  )
}

function PanelSkeleton() {
  return (
    <Panel>
      <Skeleton className="h-4 w-24" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </Panel>
  )
}

function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel>
      <div className="flex flex-col items-center gap-2.5 py-6 text-center">
        <span className="flex size-8 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
          <RiErrorWarningLine className="size-4" aria-hidden />
        </span>
        <div className="text-[12.5px] font-semibold text-[#5F6B7C]">This could not be loaded</div>
        <Button
          onClick={onRetry}
          className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
        >
          <RiRefreshLine className="size-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

function ContactRow({
  contact,
  onMakePrimary,
  onVerify,
  pending,
}: {
  contact: SalesContactSummary
  onMakePrimary: () => void
  onVerify: () => void
  pending: boolean
}) {
  const actions = [
    ...(contact.isPrimary
      ? []
      : [{ kind: "custom" as const, label: "Make primary", icon: <RiStarLine className="size-3.5" aria-hidden />, onClick: onMakePrimary }]),
    ...(contact.status === "VERIFIED"
      ? []
      : [{ kind: "custom" as const, label: "Verify", icon: <RiPhoneLine className="size-3.5" aria-hidden />, onClick: onVerify }]),
  ]

  return (
    <li className="border-b border-[#EEF1F5] py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {contact.isPrimary ? (
              <RiStarFill className="size-3.5 shrink-0 text-[#C79A2E]" aria-hidden />
            ) : null}
            <span className="truncate text-[13px] font-semibold">{contact.name}</span>
          </div>
          {contact.designation ? (
            <div className="truncate text-[11.5px] text-[#6B7789]">{contact.designation}</div>
          ) : null}
          <div className="mt-1 space-y-0.5">
            {contact.phone ? (
              <div className="flex items-center gap-1.5 text-[12px] text-[#3D4756]">
                <RiPhoneLine className="size-3 shrink-0 text-[#8A94A2]" aria-hidden />
                {contact.phone}
              </div>
            ) : null}
            {contact.email ? (
              <div className="flex items-center gap-1.5 text-[12px] text-[#3D4756]">
                <RiMailLine className="size-3 shrink-0 text-[#8A94A2]" aria-hidden />
                {contact.email}
              </div>
            ) : null}
          </div>
        </div>
        <Tag label={CONTACT_STATUS_LABEL[contact.status]} tone={CONTACT_STATUS_TONE[contact.status]} />
      </div>
      {actions.length > 0 ? (
        <div className="mt-1.5">
          <RowActions actions={pending ? [] : actions} />
        </div>
      ) : null}
    </li>
  )
}

function ContactsPanel({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingContactId, setPendingContactId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [designation, setDesignation] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")

  const contactsQuery = useQuery({
    queryKey: ["sales", "accounts", accountId, "contacts"],
    queryFn: () => listContacts(accessToken!, accountId),
    enabled: !!accessToken,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["sales", "accounts", accountId, "contacts"] })
    queryClient.invalidateQueries({ queryKey: ["sales", "accounts", accountId, "history"] })
  }

  const addMutation = useMutation({
    mutationFn: (body: CreateSalesContactBody) => addContact(accessToken!, accountId, body),
    onSuccess: () => {
      setAddOpen(false)
      invalidate()
    },
    onError: (err) => setFormError(toMessage(err)),
  })

  const primaryMutation = useMutation({
    mutationFn: (contactId: string) => setPrimaryContact(accessToken!, contactId),
    onMutate: (contactId) => setPendingContactId(contactId),
    onSettled: () => setPendingContactId(null),
    onSuccess: invalidate,
  })

  const verifyMutation = useMutation({
    mutationFn: (contactId: string) => setContactStatus(accessToken!, contactId, { status: "VERIFIED" }),
    onMutate: (contactId) => setPendingContactId(contactId),
    onSettled: () => setPendingContactId(null),
    onSuccess: invalidate,
  })

  function resetForm() {
    setName("")
    setDesignation("")
    setPhone("")
    setEmail("")
    setFormError(null)
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setFormError(null)
    if (!name.trim()) {
      setFormError("A contact needs a name.")
      return
    }
    addMutation.mutate({
      name: name.trim(),
      designation: designation.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    })
  }

  if (contactsQuery.isPending) return <PanelSkeleton />
  if (contactsQuery.isError) return <PanelError onRetry={() => contactsQuery.refetch()} />

  const contacts = contactsQuery.data ?? []
  const noneVerified = contacts.length > 0 && !contacts.some((c) => c.status === "VERIFIED")

  return (
    <Panel>
      <PanelHeading
        title="Contacts"
        action={
          <Button
            onClick={() => {
              resetForm()
              setAddOpen(true)
            }}
            className="h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            Add
          </Button>
        }
      />

      {noneVerified ? (
        <p className="mb-3 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3 py-2 text-[12px] leading-relaxed text-[#8A5E0C]">
          Nobody on this account has been reached yet.
        </p>
      ) : null}

      {contacts.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-[#5F6B7C]">
          No contacts yet. Add the first person here.
        </p>
      ) : (
        <ul>
          {contacts.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              pending={pendingContactId === c.id}
              onMakePrimary={() => primaryMutation.mutate(c.id)}
              onVerify={() => verifyMutation.mutate(c.id)}
            />
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a contact</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Name" htmlFor="contact-name">
              <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Designation" htmlFor="contact-designation" hint="Optional.">
              <Input id="contact-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone" htmlFor="contact-phone" hint="Optional.">
                <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="contact-email" hint="Optional.">
                <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogActions
                pending={addMutation.isPending}
                submitLabel="Add contact"
                disabled={false}
                onCancel={() => setAddOpen(false)}
                onSubmit={() => handleSubmit()}
              />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

function formatMoment(iso: string): string {
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

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <li className="border-b border-[#EEF1F5] py-3 last:border-b-0">
      <div className="text-[13px] font-semibold text-[#1C2733]">{item.title}</div>
      <div className="mt-0.5 text-[11.5px] text-[#6B7789]">
        {formatMoment(item.at)}
        {item.by ? ` · ${item.by}` : ""}
      </div>
      {item.meta ? <div className="mt-1 text-[12px] text-[#3D4756]">{item.meta}</div> : null}
    </li>
  )
}

function TimelinePanel({ accountId }: { accountId: string }) {
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
    logMutation.mutate({
      channel,
      occurredAt: new Date(occurredAt).toISOString(),
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
          <Button
            onClick={() => {
              resetForm()
              setLogOpen(true)
            }}
            className="h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            Log a call
          </Button>
        }
      />

      {items.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-[#5F6B7C]">
          Nothing has happened on this account yet.
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <TimelineRow key={item.id} item={item} />
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
              <Field label="Channel">
                <Select value={channel} onValueChange={(v) => v && setChannel(v as SalesChannel)}>
                  <SelectTrigger className="w-full">
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
            <Field label="Detail" htmlFor="log-detail" hint="Optional.">
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

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

/** `before`/`after` are only ever the changed fields — see writeAudit's own
    contract — so this reads as "isPrimary: false → true", not a full dump. */
function fieldDiff(before: unknown, after: unknown): string | null {
  if (!before && !after) return null
  const keys = new Set([
    ...Object.keys((before as Record<string, unknown>) ?? {}),
    ...Object.keys((after as Record<string, unknown>) ?? {}),
  ])
  if (keys.size === 0) return null
  return Array.from(keys)
    .map((key) => {
      const b = (before as Record<string, unknown> | null)?.[key]
      const a = (after as Record<string, unknown> | null)?.[key]
      if (b === undefined) return `${key}: ${JSON.stringify(a)}`
      return `${key}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`
    })
    .join(", ")
}

function HistoryRow({ entry }: { entry: AccountHistoryEntry }) {
  const diff = fieldDiff(entry.before, entry.after)
  return (
    <li className="border-b border-[#EEF1F5] py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <Tag label={entry.entity === "SALES_ACCOUNT" ? "Account" : "Contact"} tone="neutral" />
        <span className="text-[12.5px] font-semibold text-[#1C2733]">{entry.action}</span>
      </div>
      <div className="mt-0.5 text-[11.5px] text-[#6B7789]">{formatMoment(entry.changedAt)}</div>
      {diff ? <div className="mt-1 text-[12px] text-[#3D4756]">{diff}</div> : null}
      {entry.note ? <div className="mt-1 text-[12px] text-[#3D4756] italic">{entry.note}</div> : null}
    </li>
  )
}

function HistoryPanel({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const historyQuery = useQuery({
    queryKey: ["sales", "accounts", accountId, "history"],
    queryFn: () => getAccountHistory(accessToken!, accountId),
    enabled: !!accessToken,
  })

  if (historyQuery.isPending) return <PanelSkeleton />
  if (historyQuery.isError) return <PanelError onRetry={() => historyQuery.refetch()} />

  const entries = historyQuery.data ?? []

  return (
    <Panel>
      <PanelHeading title="History" />
      {entries.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-[#5F6B7C]">No changes recorded yet.</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function AccountDetail({ accountId }: { accountId: string }) {
  const { accessToken, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken

  const accountQuery = useQuery({
    queryKey: ["sales", "accounts", accountId],
    queryFn: () => getSalesAccount(accessToken!, accountId),
    enabled: isAuthed,
  })

  return (
    <>
      <div className="pt-7 pb-4">
        <Link href="/sales/accounts" className="text-[12.5px] font-semibold text-[#7A8698] hover:underline">
          ← All Accounts
        </Link>
      </div>

      {sessionStatus === "loading" || accountQuery.isPending ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2.5 h-3.5 w-64" />
        </div>
      ) : accountQuery.isError ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-8 text-center">
          <span className="mx-auto mb-2.5 flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          {/* Server refusal, verbatim — "That Sales Account does not exist,
              or is not yours" already says the right thing. */}
          <p className="text-[13px] font-semibold text-[#B03A3A]">
            {accountQuery.error instanceof ApiError
              ? accountQuery.error.message
              : "This account could not be loaded."}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-heading text-[21px] font-bold tracking-tight">{accountQuery.data.name}</h1>
            <Tag
              label={ACCOUNT_STATUS_LABEL[accountQuery.data.status]}
              tone={ACCOUNT_STATUS_TONE[accountQuery.data.status]}
            />
          </div>
          <div className="mt-1 text-[13px] text-[#5F6B7C]">Owner: {accountQuery.data.ownerName}</div>
        </div>
      )}

      {!accountQuery.isError ? (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
          <ContactsPanel accountId={accountId} />
          <div className="grid gap-4">
            <TimelinePanel accountId={accountId} />
            <HistoryPanel accountId={accountId} />
          </div>
        </div>
      ) : null}
    </>
  )
}
