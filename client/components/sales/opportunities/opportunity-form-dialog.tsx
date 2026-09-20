"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  getSalesAccount,
  listSalesEligibleEmployees,
} from "@/lib/api/sales/accounts"
import {
  createOpportunity,
  updateOpportunity,
} from "@/lib/api/sales/opportunities"
import { opportunityWriteKeys, salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type {
  CreateOpportunityBody,
  OpportunitySummary,
  SalesAccountSummary,
  SalesEligibleEmployee,
  UpdateOpportunityBody,
} from "@/lib/api/types"
import {
  CheckboxField,
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

/** The server's own rule, checked here too so the answer arrives before a round trip. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/

const NOBODY_ON_ACCOUNT =
  "Nobody on this account can run a deal right now. A Sales Admin can give the account a new owner or add a collaborator."

/**
 * Creating a deal, and editing one.
 *
 * The spec assumed both — "the form pre-fills it that way" — and Phase 2
 * shipped the endpoints without either form, so a deal could only be made
 * with curl. One component serves both, because the fields and the owner
 * rule are the same, and two copies of that rule is how one of them ends up
 * wrong.
 *
 * The owner rule: whoever runs a deal must already be able to open its
 * account. Choosing somebody who cannot offers to add them to the account in
 * the same action, rather than letting the server refuse with a sentence
 * about a request field.
 */
export function OpportunityFormDialog({
  accountId,
  deal,
  open,
  onOpenChange,
  fromMeeting,
  onCreated,
}: {
  /** The deal's account. Its owner pre-fills the form and its collaborators
      decide whether the chosen owner needs adding. */
  accountId: string
  /** Present to edit this deal; absent to create a new one. */
  deal?: OpportunitySummary
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A new deal made from a meeting's minutes (revision §25.6): the name
      starts as the meeting's title, and the meeting is its origin. */
  fromMeeting?: { id: string; title: string }
  /** Called with the new deal instead of going to it, so an editor with its
      own unsaved work is not left behind. */
  onCreated?: (deal: OpportunitySummary) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deal ? `Edit ${deal.serial}` : "New opportunity"}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open and keyed by what it edits, so every field
            starts from what is stored and a cancelled draft never comes back. */}
        {open ? (
          <OpportunityForm
            key={deal?.id ?? accountId}
            accountId={accountId}
            deal={deal}
            fromMeeting={fromMeeting}
            onCreated={onCreated}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** Loads what the fields start from, so the fields never start from nothing. */
function OpportunityForm({
  accountId,
  deal,
  fromMeeting,
  onCreated,
  onDone,
}: {
  accountId: string
  deal?: OpportunitySummary
  fromMeeting?: { id: string; title: string }
  onCreated?: (deal: OpportunitySummary) => void
  onDone: () => void
}) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  // Only a Sales Admin may list everybody who could own a deal. A Sales User
  // chooses among the people already on the account.
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  const accountQuery = useQuery({
    queryKey: salesKeys.account(accountId),
    queryFn: () => getSalesAccount(accessToken!, accountId),
    enabled: isAuthed,
  })
  // The same list the account form offers: Sales Users who still hold access.
  // Sales Admin only on the server, so it is not asked for on anybody else's behalf.
  const eligibleQuery = useQuery({
    queryKey: ["sales", "eligible-employees"],
    queryFn: () => listSalesEligibleEmployees(accessToken!),
    enabled: isAuthed && isSalesAdmin,
  })

  if (accountQuery.isError) {
    return (
      <PanelAlert>
        <span className="flex flex-wrap items-center gap-2">
          <span>{toMessage(accountQuery.error)}</span>
          <Button
            type="button"
            variant="link"
            onClick={() => accountQuery.refetch()}
            className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
          >
            Try again
          </Button>
        </span>
      </PanelAlert>
    )
  }

  // A switched-off query stays pending for ever, so a Sales User must not wait
  // on a list they are never sent.
  if (!accountQuery.data || (isSalesAdmin && eligibleQuery.isPending)) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    )
  }

  return (
    <OpportunityFields
      account={accountQuery.data}
      deal={deal}
      canAddPeople={isSalesAdmin}
      employees={isSalesAdmin ? (eligibleQuery.data ?? []) : peopleOnAccount(accountQuery.data)}
      eligibleError={isSalesAdmin && eligibleQuery.isError ? toMessage(eligibleQuery.error) : null}
      onRetryEligible={() => eligibleQuery.refetch()}
      fromMeeting={fromMeeting}
      onCreated={onCreated}
      onDone={onDone}
    />
  )
}

/**
 * Who a Sales User may hand a deal to: the people already on the account.
 * The owner leads, unless they can no longer work it, because the server
 * would refuse them. Labelled by their part in the account rather than their
 * job title, since that is what the choice turns on here.
 */
function peopleOnAccount(account: SalesAccountSummary): SalesEligibleEmployee[] {
  const owner = account.ownerActive
    ? [{ id: account.ownerEmployeeId, fullName: account.ownerName, designation: "Account owner" }]
    : []
  const collaborators = account.assignees
    .filter((a) => a.id !== account.ownerEmployeeId)
    .map((a) => ({ id: a.id, fullName: a.fullName, designation: "Collaborator" }))
  return [...owner, ...collaborators]
}

function OpportunityFields({
  account,
  deal,
  canAddPeople,
  employees,
  eligibleError,
  onRetryEligible,
  fromMeeting,
  onCreated,
  onDone,
}: {
  account: SalesAccountSummary
  deal?: OpportunitySummary
  /** A Sales Admin, who may add somebody to the account along the way. */
  canAddPeople: boolean
  employees: SalesEligibleEmployee[]
  eligibleError: string | null
  onRetryEligible: () => void
  fromMeeting?: { id: string; title: string }
  onCreated?: (deal: OpportunitySummary) => void
  onDone: () => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()

  // The account's owner can have lost access or left since the account was
  // made, and the server refuses them as an owner. Pre-filling somebody who
  // will be refused is worse than asking, so they are offered only while they
  // are still in the list.
  const accountOwnerCanRun = employees.some((e) => e.id === account.ownerEmployeeId)

  const [name, setName] = useState(deal?.name ?? fromMeeting?.title ?? "")
  const [amount, setAmount] = useState(deal?.amount ?? "")
  const [closeDate, setCloseDate] = useState(deal?.expectedCloseDate?.slice(0, 10) ?? "")
  const [oemContact, setOemContact] = useState(deal?.oemAccountManager ?? "")
  const [ownerId, setOwnerId] = useState(
    deal ? deal.ownerEmployeeId : accountOwnerCanRun ? account.ownerEmployeeId : ""
  )
  const [addAssignment, setAddAssignment] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = employees.find((e) => e.id === ownerId)
  const chosenName =
    chosen?.fullName ??
    (deal && ownerId === deal.ownerEmployeeId
      ? deal.ownerName
      : ownerId === account.ownerEmployeeId
        ? account.ownerName
        : null)
  const ownerChanged = deal ? ownerId !== deal.ownerEmployeeId : true
  const onAccount =
    ownerId === account.ownerEmployeeId || account.assignees.some((a) => a.id === ownerId)
  const needsAssignment = !!ownerId && ownerChanged && !onAccount

  function invalidate() {
    if (deal) {
      for (const key of opportunityWriteKeys(deal.id)) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    }
    // Every deal list, including the account page's own.
    queryClient.invalidateQueries({ queryKey: ["sales", "opportunities"] })
    queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] })
    if (needsAssignment) {
      // The account gained a collaborator, which its page and both lists name.
      queryClient.invalidateQueries({ queryKey: ["sales", "accounts"] })
    }
  }

  const create = useMutation({
    mutationFn: (body: CreateOpportunityBody) => createOpportunity(accessToken!, body),
    onSuccess: (created) => {
      invalidate()
      onDone()
      // Straight to the deal: its lines, stage and next step are what anybody
      // does next. Unless the caller asked to be told instead: the minutes
      // editor may be holding unsaved work.
      if (onCreated) onCreated(created)
      else router.push(`/sales/opportunities/${created.id}`)
    },
    // Verbatim: the refusal names the person and which rule they fail.
    onError: (err) => setError(toMessage(err)),
  })

  const save = useMutation({
    mutationFn: (body: UpdateOpportunityBody) => updateOpportunity(accessToken!, deal!.id, body),
    onSuccess: () => {
      invalidate()
      onDone()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const pending = create.isPending || save.isPending

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (trimmedName.length < 2) {
      setError("An opportunity needs a name of at least two characters — what is being sold, like “Firewall upgrade”.")
      return
    }
    // Commas are how people write taka; the server wants digits.
    const cleanAmount = amount.replace(/[,\s]/g, "")
    if (cleanAmount !== "" && !MONEY.test(cleanAmount)) {
      setError("Enter the value in taka with up to two decimal places, for example 450000 or 450000.50.")
      return
    }
    if (!ownerId && employees.length > 0) {
      setError("Choose who will run this deal.")
      return
    }
    // Nobody to hand it to and no way to add anybody: the server would refuse,
    // so say so here rather than send a request that cannot succeed.
    if (!deal && !canAddPeople && employees.length === 0) {
      setError(NOBODY_ON_ACCOUNT)
      return
    }
    if (needsAssignment && !addAssignment) {
      setError(
        `${chosenName ?? "That person"} is not on ${account.name} yet. Tick “Also add them to this account” to make them the owner, or choose somebody already on it.`
      )
      return
    }

    if (!deal) {
      create.mutate({
        salesAccountId: account.id,
        name: trimmedName,
        // The only track there is. No selector: a control with one option cannot do anything.
        track: "NETWORKING",
        ...(cleanAmount ? { amount: cleanAmount } : {}),
        ...(closeDate ? { expectedCloseDate: closeDate } : {}),
        ...(oemContact.trim() ? { oemAccountManager: oemContact.trim() } : {}),
        ...(ownerId ? { ownerEmployeeId: ownerId } : {}),
        ...(needsAssignment ? { addAssignment: true } : {}),
        ...(fromMeeting ? { meetingId: fromMeeting.id } : {}),
      })
      return
    }

    // Only what changed. Absent leaves a field alone and null clears it, so
    // posting the whole form would clear what nobody touched.
    const body: UpdateOpportunityBody = {}
    if (trimmedName !== deal.name) body.name = trimmedName
    const nextAmount = cleanAmount === "" ? null : cleanAmount
    const amountChanged =
      nextAmount === null
        ? deal.amount !== null
        : deal.amount === null || Number(nextAmount) !== Number(deal.amount)
    if (amountChanged) body.amount = nextAmount
    const nextClose = closeDate || null
    if (nextClose !== (deal.expectedCloseDate?.slice(0, 10) ?? null)) body.expectedCloseDate = nextClose
    const nextOem = oemContact.trim() || null
    if (nextOem !== (deal.oemAccountManager ?? null)) body.oemAccountManager = nextOem
    if (ownerChanged && ownerId) {
      body.ownerEmployeeId = ownerId
      if (needsAssignment) body.addAssignment = true
    }

    if (Object.keys(body).length === 0) {
      setError("Nothing was changed.")
      return
    }
    save.mutate(body)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!deal ? (
        <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>
          A deal on {account.name}. It starts at Requirement received and Ongoing — stage, products and
          next step are set on the deal itself.
          {fromMeeting ? ` It comes out of the meeting “${fromMeeting.title}”.` : ""}
        </p>
      ) : null}

      <Field label="Name" htmlFor="opp-name" help="What is being sold, like “Firewall upgrade” or “Core switch refresh”.">
        <Input id="opp-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Value (৳)"
          htmlFor="opp-amount"
          hint={deal ? undefined : "Optional."}
          help={
            deal
              ? "The deal value. Clear it if there is no price yet. The products list never changes it."
              : "Leave it empty if there is no price yet — it shows as No price yet, never ৳0."
          }
        >
          <Input
            id="opp-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Expected close" htmlFor="opp-close" hint="Optional." help="The day you expect a decision.">
          <Input id="opp-close" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </Field>
      </div>

      <Field label="OEM contact" htmlFor="opp-oem" hint="Optional." help="The person at the OEM handling this deal.">
        <Input id="opp-oem" value={oemContact} onChange={(e) => setOemContact(e.target.value)} />
      </Field>

      {eligibleError ? (
        <PanelAlert>
          <span className="flex flex-wrap items-center gap-2">
            <span>{eligibleError}</span>
            <Button
              type="button"
              variant="link"
              onClick={onRetryEligible}
              className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
            >
              Try again
            </Button>
          </span>
        </PanelAlert>
      ) : null}

      <Field
        label="Owner"
        help={
          canAddPeople
            ? "Runs this deal. Usually the account's owner, so it starts with them. Sales Users only."
            : "Runs this deal. Anybody already on this account can. To hand it to somebody else, a Sales Admin adds them to the account first."
        }
        hint={
          eligibleError
            ? deal
              ? "This list could not be loaded, so the owner cannot be changed yet."
              : `This list could not be loaded, so the deal will go to ${account.ownerName}, the account's owner.`
            : employees.length === 0
              ? canAddPeople
                ? "No Sales User is available. Hub access is granted from an employee's record."
                : NOBODY_ON_ACCOUNT
              : !deal && !accountOwnerCanRun
                ? `${account.ownerName} can no longer run deals, so choose who will.`
                : undefined
        }
      >
        <Select
          value={ownerId}
          onValueChange={(v) => {
            setOwnerId(v ?? "")
            setAddAssignment(false)
          }}
          disabled={!!eligibleError || employees.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{() => chosenName ?? "Select an owner"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.fullName} — {e.designation}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Offered, not assumed: a collaborator gets the whole account, which
          is a bigger thing than running one deal. */}
      {needsAssignment ? (
        <div className="space-y-1.5 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-[#8A5E0C]">
            {chosenName ?? "This person"} is not on {account.name} yet, so they could not open this
            deal. Adding them as a collaborator gives them the account as well.
          </p>
          <CheckboxField
            label="Also add them to this account"
            checked={addAssignment}
            onChange={setAddAssignment}
          />
        </div>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}

      <DialogFooter>
        <DialogActions
          pending={pending}
          submitLabel={deal ? "Save changes" : "Create opportunity"}
          disabled={false}
          onCancel={onDone}
          onSubmit={() => handleSubmit()}
        />
      </DialogFooter>
    </form>
  )
}
