"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiAlertLine,
  RiArrowRightLine,
  RiEyeLine,
  RiErrorWarningLine,
  RiGlobalLine,
  RiGroupLine,
  RiMailLine,
  RiMapPinLine,
  RiPhoneLine,
  RiRefreshLine,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react"

import {
  addContact,
  getAccountHistory,
  getAccountMargin,
  getAccountTimeline,
  getSalesAccount,
  listContacts,
  listOpportunities,
  logCommunication,
  setContactStatus,
  setPrimaryContact,
} from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type {
  AccountHistoryEntry,
  CreateSalesContactBody,
  HistoryChange,
  LogCommunicationBody,
  SalesAccountSummary,
  SalesChannel,
  SalesContactSummary,
  TimelineItem,
} from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import { DialogActions, Field, FormError, RowActions, toMessage } from "@/components/dashboard/record-kit"
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_TONE,
  CHANNEL_ICON,
  CHANNEL_LABEL,
  channelForMeta,
  CONTACT_STATUS_LABEL,
  CONTACT_STATUS_TONE,
  EVENT_ICON,
  HISTORY_ENTITY_ICON,
  MEETING_ICON,
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_STATUS_TONE,
  TASK_ICON,
  stageSentence,
  taka,
} from "@/components/sales/sales-shared"
import { MeetingsPanel, TasksPanel } from "@/components/sales/plan-panels"
import { Button } from "@/components/ui/button"
import { AccountEditDialog } from "@/components/sales/accounts/account-edit-dialog"
import { CommentPanel } from "@/components/sales/comment-panel"
import { OpportunityFormDialog } from "@/components/sales/opportunities/opportunity-form-dialog"
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
  canManage,
  delayMs,
}: {
  contact: SalesContactSummary
  onMakePrimary: () => void
  onVerify: () => void
  pending: boolean
  canManage: boolean
  delayMs: number
}) {
  const actions = canManage
    ? [
        ...(contact.isPrimary
          ? []
          : [{ kind: "custom" as const, label: "Make primary", icon: <RiStarLine className="size-3.5" aria-hidden />, onClick: onMakePrimary }]),
        ...(contact.status === "VERIFIED"
          ? []
          : [{ kind: "custom" as const, label: "Verify", icon: <RiPhoneLine className="size-3.5" aria-hidden />, onClick: onVerify }]),
      ]
    : []

  return (
    <li className="rise-in border-b border-[#EEF1F5] py-3 last:border-b-0" style={{ animationDelay: `${delayMs}ms` }}>
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

function ContactsPanel({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingContactId, setPendingContactId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
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
    queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] })
  }

  const addMutation = useMutation({
    mutationFn: (body: CreateSalesContactBody) => addContact(accessToken!, accountId, body),
    onSuccess: () => {
      setAddOpen(false)
      invalidate()
    },
    onError: (err) => setFormError(toMessage(err)),
  })

  // Both row actions report failure the same way, in the panel rather than
  // the dialog: they are fired from a row, not a form, so there is no open
  // surface to put a message on. Without this a server refusal — a contact
  // deleted underneath you, access revoked mid-session — simply left the row
  // unchanged, which is indistinguishable from nothing having happened.
  const rowMutationOptions = {
    onMutate: (contactId: string) => {
      setRowError(null)
      setPendingContactId(contactId)
    },
    onSettled: () => setPendingContactId(null),
    onSuccess: () => {
      invalidate()
    },
    onError: (err: unknown) => setRowError(toMessage(err)),
  }

  const primaryMutation = useMutation({
    mutationFn: (contactId: string) => setPrimaryContact(accessToken!, contactId),
    ...rowMutationOptions,
  })

  const verifyMutation = useMutation({
    mutationFn: (contactId: string) => setContactStatus(accessToken!, contactId, { status: "VERIFIED" }),
    ...rowMutationOptions,
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
    // Mirrors the server's refine on createSalesContactSchema. A contact
    // nobody can contact is just a name in a list — if there is genuinely no
    // number or address yet, that belongs in the account's note.
    if (!phone.trim() && !email.trim()) {
      setFormError("Add a phone number or an email — a contact needs at least one way to reach them.")
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
          canManage ? (
            <Button
              onClick={() => {
                resetForm()
                setAddOpen(true)
              }}
              className="h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              Add
            </Button>
          ) : undefined
        }
      />

      {/* The server's own sentence, shown as written — its refusals carry
          counts and names the client does not have. */}
      {rowError ? (
        <p
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-[#F0D2D2] bg-[#FDF6F6] px-3 py-2 text-[12px] leading-relaxed font-semibold text-[#B03A3A]"
        >
          <RiErrorWarningLine className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{rowError}</span>
        </p>
      ) : null}

      {noneVerified ? (
        <p className="mb-3 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3 py-2 text-[12px] leading-relaxed text-[#8A5E0C]">
          Nobody on this account has been reached yet.
        </p>
      ) : null}

      {contacts.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-[#5F6B7C]">
          {canManage ? "No contacts yet. Add the first person here." : "No contacts yet."}
        </p>
      ) : (
        <ul>
          {contacts.map((c, i) => (
            <ContactRow
              key={c.id}
              contact={c}
              pending={pendingContactId === c.id}
              canManage={canManage}
              delayMs={Math.min(i, 8) * 24}
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
            <Field label="Designation" htmlFor="contact-designation" hint="Optional." help="Their job title, like Procurement Manager.">
              <Input id="contact-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone" htmlFor="contact-phone">
                <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="contact-email">
                <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
            {/* One hint under the pair rather than "Optional." under each:
                either will do, but one of them is required, and that is a
                fact about the pair. */}
            <p className="-mt-2 text-[11.5px] leading-relaxed text-[#5F6B7C]">
              Give at least one — a phone number or an email. Without one there is no way to
              reach this person.
            </p>
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

function TimelinePanel({
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

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

/** CREATE / UPDATE / DELETE, said the way a person would say it. */
const ACTION_LABEL: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
}

/**
 * One changed field, as a labelled row rather than a fragment of JSON.
 *
 * A change with no `before` was set for the first time, so it shows a single
 * value — an arrow from nothing reads as though something was lost.
 */
function ChangeRow({ change }: { change: HistoryChange }) {
  return (
    <div className="grid grid-cols-[minmax(88px,auto)_1fr] gap-x-3 gap-y-0.5 py-1 text-[12px]">
      <dt className="truncate text-[#6B7789]">{change.label}</dt>
      <dd className="m-0 min-w-0 text-[#1C2733]">
        {change.before === null ? (
          <span className="font-medium">{change.after}</span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-[#8A94A2] line-through decoration-[#C9D2DE]">{change.before}</span>
            <RiArrowRightLine className="size-3 shrink-0 text-[#8A94A2]" aria-hidden />
            <span className="font-medium">{change.after}</span>
          </span>
        )}
      </dd>
    </div>
  )
}

function HistoryRow({ entry, delayMs }: { entry: AccountHistoryEntry; delayMs: number }) {
  const Icon = HISTORY_ENTITY_ICON[entry.entity]
  return (
    <li
      className="rise-in border-b border-[#EEF1F5] py-3 last:border-b-0"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
        <Tag label={entry.entity === "SALES_ACCOUNT" ? "Account" : "Contact"} tone="neutral" />
        <span className="text-[12.5px] font-semibold text-[#1C2733]">
          {ACTION_LABEL[entry.action] ?? entry.action}
        </span>
        <span className="text-[11.5px] text-[#6B7789]">
          {formatMoment(entry.changedAt)}
          {entry.changedByName ? ` · ${entry.changedByName}` : ""}
        </span>
      </div>

      {entry.changes.length > 0 ? (
        <dl className="mt-1.5 divide-y divide-[#F2F5F8] rounded-md bg-[#F7F9FB] px-3 py-1">
          {entry.changes.map((change) => (
            <ChangeRow key={change.field} change={change} />
          ))}
        </dl>
      ) : null}

      {entry.note ? (
        <div className="mt-1.5 text-[12px] text-[#3D4756] italic">{entry.note}</div>
      ) : null}
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

  const entries = historyQuery.data?.items ?? []
  const truncated = historyQuery.data?.truncated ?? false

  return (
    <Panel>
      <PanelHeading title="History" />
      {entries.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-[#5F6B7C]">No changes recorded yet.</p>
      ) : (
        <>
          <ul>
            {entries.map((entry, i) => (
              <HistoryRow key={entry.id} entry={entry} delayMs={Math.min(i, 8) * 24} />
            ))}
          </ul>
          {/* Said rather than hidden: a capped list that does not admit it is
              capped reads as the whole story. Paging arrives with Phase 2. */}
          {truncated ? (
            <p className="mt-3 border-t border-[#EEF1F5] pt-3 text-center text-[11.5px] text-[#6B7789]">
              Showing the {historyQuery.data?.limit} most recent changes. Older ones are kept but
              not shown here yet.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

/**
 * "Margin won": the profit on the account's won deals, added up by the
 * server. Loading, broken and "nothing won yet" each get their own line, so a
 * failed read never passes for an account that has made nothing.
 */
function MarginWon({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const marginQuery = useQuery({
    queryKey: salesKeys.accountMargin(accountId),
    queryFn: () => getAccountMargin(accessToken!, accountId),
    enabled: !!accessToken,
  })

  if (marginQuery.isPending) return <Skeleton className="mb-3 h-4 w-48" />
  if (marginQuery.isError) {
    return (
      <p className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-[#B03A3A]">
        Margin won could not be loaded.
        <button type="button" onClick={() => marginQuery.refetch()} className="font-bold underline">
          Try again
        </button>
      </p>
    )
  }

  const { value, counted, missing, dealsWithoutProducts } = marginQuery.data
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const amount = Number(value) < 0 ? `a loss of ${taka(String(-Number(value)))}` : taka(value)
  // What could not be counted, named rather than folded in as zero.
  const gaps = [
    missing > 0 ? `${count(missing, "product")} with no margin yet` : null,
    dealsWithoutProducts > 0 ? `${count(dealsWithoutProducts, "won deal")} with no products` : null,
  ]
    .filter(Boolean)
    .join(", and ")
  const nothingWon = counted === 0 && missing === 0 && dealsWithoutProducts === 0
  return (
    <p className="mb-3 text-[12.5px] leading-relaxed text-[#5F6B7C]">
      <span className="font-semibold text-[#1C2733]">Margin won: </span>
      {nothingWon
        ? "no deals won on this account yet."
        : counted === 0
          ? `no margin yet — ${gaps}.`
          : `${amount} from ${count(counted, "product")} on won deals${gaps ? `, not counting ${gaps}` : ""}.`}
    </p>
  )
}

/**
 * The account's deals, and the one place a new deal is started from.
 *
 * Deals are open only to the people who work the account. Asking the server
 * on behalf of anybody else returns an empty list, which would read as "this
 * account has no deals" — a claim nobody checked — so the list is not
 * requested for a read-only viewer at all, and the panel says why instead.
 */
function OpportunitiesPanel({ account }: { account: SalesAccountSummary }) {
  const { accessToken } = useSession()
  const [createOpen, setCreateOpen] = useState(false)

  const dealsQuery = useQuery({
    queryKey: salesKeys.opportunities({ salesAccountId: account.id }),
    queryFn: () => listOpportunities(accessToken!, { salesAccountId: account.id }),
    enabled: !!accessToken && account.canManage,
  })

  if (!account.canManage) {
    return (
      <Panel>
        <PanelHeading title="Opportunities" />
        <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
          Deals on this account are open only to its owner, its collaborators and Sales Admins.
        </p>
      </Panel>
    )
  }
  if (dealsQuery.isPending) return <PanelSkeleton />
  if (dealsQuery.isError) return <PanelError onRetry={() => dealsQuery.refetch()} />

  const deals = dealsQuery.data.items

  return (
    <Panel>
      <PanelHeading
        title="Opportunities"
        action={
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            New opportunity
          </Button>
        }
      />
      {deals.length > 0 ? <MarginWon accountId={account.id} /> : null}
      {deals.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
          No deals on this account yet. A deal is one thing being sold here — a firewall upgrade, a
          switching refresh — with its own stage, value and next step.
        </p>
      ) : (
        <ul className="-mx-2 divide-y divide-[#EEF1F5]">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Link
                href={`/sales/opportunities/${deal.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-[#F7F9FB] focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-[11.5px] text-[#5F6B7C]">{deal.serial}</span>
                    <span className="truncate text-[13px] font-semibold">{deal.name}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-[#5F6B7C]">
                    {stageSentence(deal.status, deal.stage)} · {deal.ownerName}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {/* No price yet, never ৳0. */}
                  <span className={deal.amount === null ? "text-[12.5px] text-[#5F6B7C]" : "text-[12.5px] font-semibold"}>
                    {taka(deal.amount)}
                  </span>
                  <Tag label={OPPORTUNITY_STATUS_LABEL[deal.status]} tone={OPPORTUNITY_STATUS_TONE[deal.status]} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {/* The list is one page. Said rather than implied, so a long-running
          account does not look like it has exactly fifty deals. */}
      {dealsQuery.data.nextCursor ? (
        <p className="mt-2 text-[11.5px] text-[#5F6B7C]">Showing the 50 newest deals on this account.</p>
      ) : null}
      <OpportunityFormDialog accountId={account.id} open={createOpen} onOpenChange={setCreateOpen} />
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function AccountDetail({ accountId }: { accountId: string }) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken

  const [editOpen, setEditOpen] = useState(false)
  // Opening from the flag rather than the Edit button changes the dialog's
  // title and leads with the owner, because the reason is already known.
  const [editFocusOwner, setEditFocusOwner] = useState(false)

  // Management notes are admin-only to write. The server refuses either way;
  // hiding the option keeps a control that cannot act off the screen.
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  const accountQuery = useQuery({
    queryKey: ["sales", "accounts", accountId],
    queryFn: () => getSalesAccount(accessToken!, accountId),
    enabled: isAuthed,
  })

  function openEdit(focusOwner: boolean) {
    setEditFocusOwner(focusOwner)
    setEditOpen(true)
  }

  return (
    <>
      <div className="pt-7 pb-4">
        {/* All Accounts, not My Accounts: the latter can genuinely not list an
            account this viewer only has read access to, so it is not a safe
            "back" destination for every visitor of this page. */}
        {/* #5F6B7C, not #7A8698: the latter is 3.7:1 on white and is recorded
            in the UI standard as failing AA at this size. */}
        <Link href="/sales/accounts" className="text-[12.5px] font-semibold text-[#5F6B7C] hover:underline">
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
            {!accountQuery.data.canManage ? <Tag label="View only" tone="neutral" /> : null}
            {accountQuery.data.canManage ? (
              <Button
                type="button"
                onClick={() => openEdit(false)}
                className="ml-auto h-8 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
              >
                Edit
              </Button>
            ) : null}
          </div>

          {/* The reason lives beside the status it explains. Without it a
              Do Not Contact badge is a decision with no record of why. */}
          {accountQuery.data.statusReason ? (
            <p className="mt-2 text-[12.5px] text-[#5F6B7C]">{accountQuery.data.statusReason}</p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-[#5F6B7C]">
            <span>Owner: {accountQuery.data.ownerName}</span>
            {accountQuery.data.assignees.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <RiGroupLine className="size-3.5 text-[#8A94A2]" aria-hidden />
                {accountQuery.data.assignees.map((a) => a.fullName).join(", ")}
              </span>
            ) : null}
            {accountQuery.data.industry ? <span>{accountQuery.data.industry}</span> : null}
          </div>

          {accountQuery.data.website || accountQuery.data.address ? (
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[#6B7789]">
              {accountQuery.data.website ? (
                <span className="inline-flex items-center gap-1">
                  <RiGlobalLine className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
                  {accountQuery.data.website}
                </span>
              ) : null}
              {accountQuery.data.address ? (
                <span className="inline-flex items-center gap-1">
                  <RiMapPinLine className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
                  {accountQuery.data.address}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Louder than the read-only note, and shown to everyone: an
              account whose owner cannot work it is a gap in coverage, not a
              fact about the viewer's permissions. */}
          {!accountQuery.data.ownerActive ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3 py-2 text-[12px] leading-relaxed text-[#8A5E0C]">
              <RiAlertLine className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                {accountQuery.data.ownerName} can no longer work this account — their Techno Sales
                Hub access has been removed or they have left. It needs a new owner.
                {/* The flag used to state a problem the interface could not
                    solve. It now leads to the one action that clears it. */}
                {accountQuery.data.canManage ? (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => openEdit(true)}
                    className="ml-1.5 h-auto p-0 text-[12px] font-bold text-[#8A5E0C] underline"
                  >
                    Choose a new owner
                  </Button>
                ) : null}
              </span>
            </p>
          ) : null}

          {!accountQuery.data.canManage ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-2 text-[12px] leading-relaxed text-[#5F6B7C]">
              <RiEyeLine className="mt-px size-3.5 shrink-0" aria-hidden />
              You can see this account because it is shared in All Accounts, but only its owner,
              its collaborators, or a Sales Admin can add contacts or log activity on it.
            </p>
          ) : null}
        </div>
      )}

      {accountQuery.data ? (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
          {/* Contacts and deals together on the left: the two things somebody
              opening an account comes to act on. The right column is the
              record of what happened. */}
          <div className="grid gap-4">
            <ContactsPanel accountId={accountId} canManage={accountQuery.data.canManage} />
            <OpportunitiesPanel account={accountQuery.data} />
            {/* Meetings and tasks are things you act on too, so they join the
                left column (revision §23, page layout). */}
            <MeetingsPanel accountId={accountId} canManage={accountQuery.data.canManage} />
            <TasksPanel accountId={accountId} canManage={accountQuery.data.canManage} />
          </div>
          <div className="grid gap-4">
            <TimelinePanel
              accountId={accountId}
              canManage={accountQuery.data.canManage}
              canLog={accountQuery.data.canLogActivity}
            />
            {/* "Remarks" here and "Comments" on a deal, from one component.
                That is the business's own vocabulary and the two must not be
                made consistent with each other. */}
            <CommentPanel
              entity="SALES_ACCOUNT"
              entityId={accountId}
              label="Remarks"
              // Customer feedback is offered on a deal only: feedback is
              // always about a specific deal, and the server no longer
              // refuses the row, so the restriction lives here.
              kinds={isSalesAdmin ? ["GENERAL", "MANAGEMENT_NOTE"] : ["GENERAL"]}
              canWrite={accountQuery.data.canManage}
            />
            <HistoryPanel accountId={accountId} />
          </div>
        </div>
      ) : null}

      {accountQuery.data && accountQuery.data.canManage ? (
        <AccountEditDialog
          account={accountQuery.data}
          open={editOpen}
          onOpenChange={setEditOpen}
          focusOwner={editFocusOwner}
        />
      ) : null}
    </>
  )
}
