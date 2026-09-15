"use client"

/**
 * Scheduling, editing and ending a meeting (revision §24, meetings 1-4).
 *
 * The form is mounted only while its dialog is open, so every opening starts
 * from the meeting being edited, or from blank, never from a half-typed
 * leftover.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  changeMeetingStatus,
  createMeeting,
  getSalesAccount,
  listAllSalesAccounts,
  listContacts,
  listMeetingAttendeeOptions,
  listOpportunities,
  updateMeeting,
} from "@/lib/api/sales"
import { planWriteKeys, salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type {
  ChangeMeetingStatusBody,
  MeetingAttendeeBody,
  SalesMeetingMode,
  SalesMeetingSummary,
  UpdateMeetingBody,
} from "@/lib/api/types"
import { CheckboxField, DialogActions, Field, FormError, PanelAlert, toMessage } from "@/components/dashboard/record-kit"
import { MEETING_MODE_LABEL, toDatetimeLocal } from "@/components/sales/sales-shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

const MODES = Object.keys(MEETING_MODE_LABEL) as SalesMeetingMode[]
/** The deal select's "none", since an empty value reads as nothing chosen at all. */
const NO_DEAL = "none"

/** Refreshes every list, panel, Timeline and count a meeting or task write can touch. */
export function usePlanRefresh() {
  const queryClient = useQueryClient()
  return () => {
    for (const key of planWriteKeys()) queryClient.invalidateQueries({ queryKey: key })
  }
}

/** A status change that needs no form: putting a cancelled meeting back on. */
export function useMeetingStatus() {
  const { accessToken } = useSession()
  const refresh = usePlanRefresh()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeMeetingStatusBody }) =>
      changeMeetingStatus(accessToken!, id, body),
    onSuccess: refresh,
  })
}

/**
 * The accounts the caller works, for a form opened outside any one account.
 * Read from the shared directory and narrowed to `canManage`, which is the
 * same rule the server applies when the form is sent.
 */
export function AccountPicker({ id, value, onChange }: { id: string; value: string; onChange: (id: string) => void }) {
  const { accessToken } = useSession()
  const query = useQuery({
    queryKey: ["sales", "account-picker"],
    queryFn: () => listAllSalesAccounts(accessToken!),
    enabled: !!accessToken,
  })
  // Loading, empty and broken are three different answers (the UI rules), so a
  // list that failed to load is never shown as a picker with nothing in it.
  if (query.isError) {
    return (
      <PanelAlert>
        <span className="flex flex-wrap items-center gap-2">
          <span>Your accounts could not be loaded.</span>
          <Button
            type="button"
            variant="link"
            onClick={() => query.refetch()}
            className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
          >
            Try again
          </Button>
        </span>
      </PanelAlert>
    )
  }
  const accounts = (query.data ?? []).filter((account) => account.canManage)
  if (query.isSuccess && accounts.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-[#5F6B7C]">
        You do not work any account yet. A meeting or a task always sits on an account you own or collaborate on.
      </p>
    )
  }
  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? "")} disabled={query.isPending}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(v: string | null) =>
            accounts.find((account) => account.id === v)?.name ??
            (query.isPending ? "Loading your accounts…" : "Choose an account")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type AttendeeLike = {
  side: string
  employeeId?: string | null
  contactId?: string | null
  name?: string | null
  designation?: string | null
}

/** Whether the list about to be sent is the list the meeting already has. */
function sameAttendees(meeting: SalesMeetingSummary, next: MeetingAttendeeBody[]): boolean {
  const keyOf = (a: AttendeeLike) =>
    [
      a.side,
      a.employeeId ?? "",
      a.contactId ?? "",
      a.employeeId || a.contactId ? "" : (a.name ?? ""),
      a.employeeId ? "" : (a.designation ?? ""),
    ].join("|")
  const before = meeting.attendees.map(keyOf).sort()
  const after = next.map(keyOf).sort()
  return before.length === after.length && before.every((key, i) => key === after[i])
}

export function MeetingFormDialog({
  open,
  onOpenChange,
  accountId,
  opportunityId,
  meeting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed when opened from an account or a deal; chosen in the form otherwise. */
  accountId?: string
  opportunityId?: string
  /** Present when editing. */
  meeting?: SalesMeetingSummary
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{meeting ? "Edit meeting" : "Schedule a meeting"}</DialogTitle>
        </DialogHeader>
        {open ? (
          <MeetingForm
            fixedAccountId={accountId}
            fixedDealId={opportunityId}
            meeting={meeting}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function MeetingForm({
  fixedAccountId,
  fixedDealId,
  meeting,
  onDone,
}: {
  fixedAccountId?: string
  fixedDealId?: string
  meeting?: SalesMeetingSummary
  onDone: () => void
}) {
  const { accessToken } = useSession()
  const refresh = usePlanRefresh()

  const [accountId, setAccountId] = useState(meeting?.salesAccountId ?? fixedAccountId ?? "")
  const [title, setTitle] = useState(meeting?.title ?? "")
  const [mode, setMode] = useState<SalesMeetingMode>(meeting?.mode ?? "CUSTOMER_SITE")
  const [startsAt, setStartsAt] = useState(meeting ? toDatetimeLocal(meeting.scheduledAt) : "")
  const [endsAt, setEndsAt] = useState(meeting?.endsAt ? toDatetimeLocal(meeting.endsAt) : "")
  const [location, setLocation] = useState(meeting?.location ?? "")
  const [notes, setNotes] = useState(meeting?.notes ?? "")
  const [dealId, setDealId] = useState(meeting?.opportunityId ?? fixedDealId ?? "")
  const [ours, setOurs] = useState<string[]>(
    meeting?.attendees.flatMap((a) => (a.side === "OURS" && a.employeeId ? [a.employeeId] : [])) ?? []
  )
  const [contactIds, setContactIds] = useState<string[]>(
    meeting?.attendees.flatMap((a) => (a.side === "THEIRS" && a.contactId ? [a.contactId] : [])) ?? []
  )
  const [typed, setTyped] = useState(
    meeting?.attendees
      .filter((a) => a.side === "THEIRS" && !a.contactId)
      .map((a) => ({ name: a.name, designation: a.designation ?? "" })) ?? []
  )
  const [newName, setNewName] = useState("")
  const [newDesignation, setNewDesignation] = useState("")
  const [error, setError] = useState<string | null>(null)

  const enabled = !!accessToken && !!accountId
  const accountQuery = useQuery({
    queryKey: salesKeys.account(accountId),
    queryFn: () => getSalesAccount(accessToken!, accountId),
    enabled,
  })
  const contactsQuery = useQuery({
    queryKey: salesKeys.accountContacts(accountId),
    queryFn: () => listContacts(accessToken!, accountId),
    enabled,
  })
  const dealsQuery = useQuery({
    queryKey: salesKeys.opportunities({ salesAccountId: accountId }),
    queryFn: () => listOpportunities(accessToken!, { salesAccountId: accountId }),
    enabled,
  })

  const attendeeQuery = useQuery({
    queryKey: salesKeys.meetingAttendees(),
    queryFn: () => listMeetingAttendeeOptions(accessToken!),
    enabled: !!accessToken,
  })

  const account = accountQuery.data
  // Anyone with Sales Hub access may attend on our side (§24.3), not only the
  // account's team. The team comes first, then everyone else by name; anybody
  // already on the meeting stays listed, so editing never silently drops them.
  const teamIds = new Set(account ? [account.ownerEmployeeId, ...account.assignees.map((a) => a.id)] : [])
  const people = [
    ...(meeting?.attendees.flatMap((a) =>
      a.side === "OURS" && a.employeeId ? [{ id: a.employeeId, fullName: a.name }] : []
    ) ?? []),
    ...(attendeeQuery.data ?? []).map(({ id, fullName }) => ({ id, fullName })),
  ]
    .filter((person, index, all) => all.findIndex((p) => p.id === person.id) === index)
    .sort((a, b) => Number(teamIds.has(b.id)) - Number(teamIds.has(a.id)) || a.fullName.localeCompare(b.fullName))
  const contacts = (contactsQuery.data ?? []).filter((contact) => contact.status !== "INVALID")
  const deals = dealsQuery.data?.items ?? []
  // A completed or cancelled meeting keeps its time; the server refuses a move.
  const timeLocked = !!meeting && meeting.status !== "SCHEDULED"

  const toggle = (list: string[], set: (next: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const mutation = useMutation({
    mutationFn: ({ start, end }: { start: Date; end: Date | null }) => {
      const typedPeople = [
        ...typed,
        ...(newName.trim() ? [{ name: newName.trim(), designation: newDesignation.trim() }] : []),
      ]
      const attendees: MeetingAttendeeBody[] = [
        ...ours.map((employeeId) => ({ side: "OURS" as const, employeeId })),
        ...contactIds.map((contactId) => ({ side: "THEIRS" as const, contactId })),
        ...typedPeople.map((person) => ({
          side: "THEIRS" as const,
          name: person.name,
          ...(person.designation ? { designation: person.designation } : {}),
        })),
      ]
      if (!meeting) {
        return createMeeting(accessToken!, {
          salesAccountId: accountId,
          title: title.trim(),
          mode,
          scheduledAt: start.toISOString(),
          ...(end ? { endsAt: end.toISOString() } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(dealId ? { opportunityId: dealId } : {}),
          attendees,
        })
      }
      const body: UpdateMeetingBody = {
        title: title.trim(),
        mode,
        location: location.trim() || null,
        notes: notes.trim() || null,
        opportunityId: dealId || null,
      }
      // Times go only when they changed: sending an unchanged time for a
      // completed meeting would read to the server as a move.
      if (startsAt !== toDatetimeLocal(meeting.scheduledAt)) body.scheduledAt = start.toISOString()
      if (endsAt !== (meeting.endsAt ? toDatetimeLocal(meeting.endsAt) : "")) {
        body.endsAt = end ? end.toISOString() : null
      }
      if (!sameAttendees(meeting, attendees)) body.attendees = attendees
      return updateMeeting(accessToken!, meeting.id, body)
    },
    onSuccess: () => {
      refresh()
      onDone()
    },
    onError: (err) => setError(toMessage(err)),
  })

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!accountId) return setError("Choose the account the meeting is with.")
    if (title.trim().length < 2) return setError("Give the meeting a title.")
    const start = new Date(startsAt)
    if (!startsAt || Number.isNaN(start.getTime())) return setError("Pick the date and time it starts.")
    const end = endsAt ? new Date(endsAt) : null
    if (end && (Number.isNaN(end.getTime()) || end <= start)) return setError("The end has to be after the start.")
    mutation.mutate({ start, end })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!fixedAccountId && !meeting ? (
        <Field label="Account" htmlFor="meeting-account">
          <AccountPicker
            id="meeting-account"
            value={accountId}
            onChange={(id) => {
              setAccountId(id)
              setDealId("")
              setOurs([])
              setContactIds([])
            }}
          />
        </Field>
      ) : null}

      <Field label="Title" htmlFor="meeting-title">
        <Input
          id="meeting-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Firewall walkthrough"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Where" htmlFor="meeting-mode">
          <Select value={mode} onValueChange={(v) => v && setMode(v as SalesMeetingMode)}>
            <SelectTrigger id="meeting-mode" className="w-full">
              <SelectValue>{(v: string | null) => MEETING_MODE_LABEL[(v ?? mode) as SalesMeetingMode]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MEETING_MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={mode === "ONLINE" ? "Link" : "Place"} htmlFor="meeting-location" hint="Optional.">
          <Input id="meeting-location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Starts"
          htmlFor="meeting-starts"
          hint={timeLocked ? "A meeting that has ended keeps its time." : undefined}
        >
          <Input
            id="meeting-starts"
            type="datetime-local"
            value={startsAt}
            disabled={timeLocked}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>
        <Field label="Ends" htmlFor="meeting-ends" hint="Optional.">
          <Input
            id="meeting-ends"
            type="datetime-local"
            value={endsAt}
            disabled={timeLocked}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </Field>
      </div>

      {accountId ? (
        <Field label="Deal" htmlFor="meeting-deal" hint="Optional.">
          <Select value={dealId || NO_DEAL} onValueChange={(v) => setDealId(!v || v === NO_DEAL ? "" : v)}>
            <SelectTrigger id="meeting-deal" className="w-full">
              <SelectValue>
                {(v: string | null) => {
                  const deal = deals.find((d) => d.id === v)
                  return deal ? `${deal.serial} · ${deal.name}` : "Not about one deal"
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DEAL}>Not about one deal</SelectItem>
              {deals.map((deal) => (
                <SelectItem key={deal.id} value={deal.id}>{`${deal.serial} · ${deal.name}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {accountId ? (
        <Field
          label="From our side"
          hint={meeting ? undefined : "You are added yourself. Everyone ticked gets an email and a notification."}
        >
          {attendeeQuery.isError ? (
            <PanelAlert>
              <span className="flex flex-wrap items-center gap-2">
                <span>The people who can attend could not be loaded.</span>
                <Button
                  type="button"
                  variant="link"
                  onClick={() => attendeeQuery.refetch()}
                  className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
                >
                  Try again
                </Button>
              </span>
            </PanelAlert>
          ) : attendeeQuery.isPending ? (
            <p className="text-[12px] text-[#5F6B7C]">Loading the people who can attend…</p>
          ) : people.length === 0 ? (
            <p className="text-[12px] text-[#5F6B7C]">Nobody else has Sales Hub access yet.</p>
          ) : (
            <div className="grid max-h-56 gap-0.5 overflow-y-auto sm:grid-cols-2">
              {people.map((person) => (
                <CheckboxField
                  key={person.id}
                  label={person.fullName}
                  checked={ours.includes(person.id)}
                  onChange={() => toggle(ours, setOurs, person.id)}
                />
              ))}
            </div>
          )}
        </Field>
      ) : null}

      {accountId ? (
        <Field label="From their side" hint="A saved contact, or type the name of somebody who is not saved.">
          {contacts.length > 0 ? (
            <div className="grid gap-0.5 sm:grid-cols-2">
              {contacts.map((contact) => (
                <CheckboxField
                  key={contact.id}
                  label={contact.designation ? `${contact.name}, ${contact.designation}` : contact.name}
                  checked={contactIds.includes(contact.id)}
                  onChange={() => toggle(contactIds, setContactIds, contact.id)}
                />
              ))}
            </div>
          ) : null}
          {typed.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {typed.map((person, index) => (
                <li key={`${person.name}-${index}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span>{person.designation ? `${person.name}, ${person.designation}` : person.name}</span>
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => setTyped(typed.filter((_, i) => i !== index))}
                    className="h-auto p-0 text-[12px] font-bold text-[#5F6B7C]"
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-1.5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              aria-label="Name of somebody not saved"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              aria-label="Their designation"
              placeholder="Designation"
              value={newDesignation}
              onChange={(e) => setNewDesignation(e.target.value)}
            />
            <Button
              type="button"
              disabled={!newName.trim()}
              onClick={() => {
                setTyped([...typed, { name: newName.trim(), designation: newDesignation.trim() }])
                setNewName("")
                setNewDesignation("")
              }}
              className="h-9 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
            >
              Add
            </Button>
          </div>
        </Field>
      ) : null}

      <Field label="Notes" htmlFor="meeting-notes" hint="Optional.">
        <Textarea id="meeting-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {error ? <FormError>{error}</FormError> : null}
      <DialogFooter>
        <DialogActions
          pending={mutation.isPending}
          submitLabel={meeting ? "Save" : "Schedule"}
          disabled={false}
          onCancel={onDone}
          onSubmit={() => submit()}
        />
      </DialogFooter>
    </form>
  )
}

/** Completed, with an optional outcome, or Cancelled, with a reason (§24.4). */
export function MeetingStatusDialog({
  meeting,
  action,
  onClose,
}: {
  meeting: SalesMeetingSummary | null
  action: "COMPLETED" | "CANCELLED" | null
  onClose: () => void
}) {
  const open = !!meeting && !!action
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === "CANCELLED" ? "Cancel this meeting" : "Mark this meeting completed"}</DialogTitle>
        </DialogHeader>
        {meeting && action ? <MeetingStatusForm meeting={meeting} action={action} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function MeetingStatusForm({
  meeting,
  action,
  onDone,
}: {
  meeting: SalesMeetingSummary
  action: "COMPLETED" | "CANCELLED"
  onDone: () => void
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const status = useMeetingStatus()

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (action === "CANCELLED" && text.trim().length < 2) {
      setError("Say why the meeting is cancelled.")
      return
    }
    const body: ChangeMeetingStatusBody =
      action === "CANCELLED"
        ? { status: "CANCELLED", reason: text.trim() }
        : { status: "COMPLETED", ...(text.trim() ? { outcome: text.trim() } : {}) }
    status.mutate({ id: meeting.id, body }, { onSuccess: onDone, onError: (err) => setError(toMessage(err)) })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[12.5px] font-semibold text-[#1C2733]">{meeting.title}</p>
      {action === "CANCELLED" ? (
        <Field
          label="Why is it cancelled?"
          htmlFor="meeting-reason"
          hint="Everyone on our side is told by email and in their notifications."
        >
          <Input id="meeting-reason" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      ) : (
        <Field
          label="How did it go?"
          htmlFor="meeting-outcome"
          hint="Optional."
          help="A line or two for the record. Full minutes come in a later phase."
        >
          <Textarea id="meeting-outcome" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
      {error ? <FormError>{error}</FormError> : null}
      <DialogFooter>
        <DialogActions
          pending={status.isPending}
          submitLabel={action === "CANCELLED" ? "Cancel the meeting" : "Mark completed"}
          disabled={false}
          onCancel={onDone}
          onSubmit={() => submit()}
        />
      </DialogFooter>
    </form>
  )
}
