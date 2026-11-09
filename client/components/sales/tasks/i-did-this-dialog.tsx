"use client"

/**
 * "I did this" (owner, 2026-11-02): one line about something already done. It
 * is the fast way into the daily log: a few words, a type, a day, and Save.
 * The account and the Opportunity are optional, because plenty of the week is
 * not about an account (learning, office work).
 *
 * Saved as a Done task, so it shows on the account's Timeline when it has an
 * account, and on the Logs tab when it has none.
 */

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { RiCheckboxCircleLine } from "@remixicon/react"

import { listOpportunities } from "@/lib/api/sales/opportunities"
import { logDoneTask } from "@/lib/api/sales/tasks"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { SalesTaskType } from "@/lib/api/types"
import { DialogActions, Field, FormError, toMessage } from "@/components/dashboard/record-kit"
import { AccountPicker, usePlanRefresh } from "@/components/sales/meetings/meeting-dialogs"
import { RetryNote } from "@/components/sales/shared/panel"
import { onDay } from "@/components/sales/shared/sales-shared"
import { TASK_TYPE_LABEL, TASK_TYPES } from "@/components/sales/shared/task-types"
import { useSalesPermissions } from "@/components/sales/shared/use-sales-permissions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { dialogWidthClass } from "@/components/ds/dialog-sizes"
import { cx } from "@/components/ds/classes"

/** A select's "none", since an empty value reads as nothing chosen at all. */
const NONE = "none"

/** Today as YYYY-MM-DD on this computer's calendar. */
const todayInput = () => new Date().toLocaleDateString("en-CA")

export function IDidThisDialog({
  open,
  onOpenChange,
  accountId,
  opportunityId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed when opened from an account or an Opportunity. */
  accountId?: string
  opportunityId?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cx(dialogWidthClass("md"), "max-h-[90vh] overflow-y-auto")}>
        <DialogHeader>
          <DialogTitle>I did this</DialogTitle>
        </DialogHeader>
        {open ? (
          <IDidThisForm fixedAccountId={accountId} fixedOpportunityId={opportunityId} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function IDidThisForm({
  fixedAccountId,
  fixedOpportunityId,
  onDone,
}: {
  fixedAccountId?: string
  fixedOpportunityId?: string
  onDone: () => void
}) {
  const { accessToken } = useSession()
  const refresh = usePlanRefresh()

  const [title, setTitle] = useState("")
  const [type, setType] = useState<SalesTaskType>("OTHER")
  const [detail, setDetail] = useState("")
  const [doneOn, setDoneOn] = useState(todayInput())
  const [accountId, setAccountId] = useState(fixedAccountId ?? "")
  const [dealId, setDealId] = useState(fixedOpportunityId ?? "")
  const [error, setError] = useState<string | null>(null)
  // After Save the form says so and offers another, so a person logging a few
  // things in a row never has to reopen it.
  const [savedFor, setSavedFor] = useState<string | null>(null)

  const dealsQuery = useQuery({
    queryKey: salesKeys.opportunities({ salesAccountId: accountId }),
    queryFn: () => listOpportunities(accessToken!, { salesAccountId: accountId }),
    enabled: !!accessToken && !!accountId && !fixedOpportunityId,
  })
  const deals = dealsQuery.data?.items ?? []

  const mutation = useMutation({
    mutationFn: () =>
      logDoneTask(accessToken!, {
        title: title.trim(),
        type,
        doneOn,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
        ...(accountId ? { salesAccountId: accountId } : {}),
        ...(accountId && dealId ? { opportunityId: dealId } : {}),
      }),
    onSuccess: () => {
      refresh()
      setSavedFor(doneOn)
    },
    onError: (err) => setError(toMessage(err)),
  })

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (title.trim().length < 2) return setError("Write what you did, in a few words.")
    if (!doneOn) return setError("Pick the day you did it.")
    if (doneOn > todayInput()) return setError("Choose a day that is today or earlier.")
    mutation.mutate()
  }

  function another() {
    setTitle("")
    setDetail("")
    setSavedFor(null)
    setError(null)
  }

  if (savedFor) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-body-sm leading-relaxed text-ink-body">
          <RiCheckboxCircleLine className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>
            Saved. It is in your log for <span className="font-semibold">{onDay(savedFor)}</span>.
          </span>
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={another}
            className="h-auto rounded-md px-3.5 py-2 text-caption font-bold"
          >
            Add another
          </Button>
          <Button
            type="button"
            onClick={onDone}
            className="h-auto rounded-md bg-ink px-3.5 py-2 text-caption font-bold text-white hover:bg-ink-strong"
          >
            Done
          </Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="What did you do?" htmlFor="did-title">
        <Input
          id="did-title"
          value={title}
          maxLength={180}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sent the BOQ to the customer"
          autoFocus
        />
      </Field>

      <Field label="Details" htmlFor="did-detail" hint="Optional.">
        <Textarea
          id="did-detail"
          value={detail}
          maxLength={2000}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Who you spoke to, what was agreed, what comes next"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="did-type">
          <Select value={type} onValueChange={(v) => v && setType(v as SalesTaskType)}>
            <SelectTrigger id="did-type" className="w-full">
              <SelectValue>{(v: string | null) => TASK_TYPE_LABEL[(v ?? type) as SalesTaskType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TASK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Day" htmlFor="did-day" help="The day you did it. Today or an earlier day.">
          <Input id="did-day" type="date" max={todayInput()} value={doneOn} onChange={(e) => setDoneOn(e.target.value)} />
        </Field>
      </div>

      {!fixedAccountId ? (
        <Field
          label="Account"
          htmlFor="did-account"
          hint="Optional."
          help="Leave it empty for work that is not about an account, like learning or office work."
        >
          <AccountPicker
            id="did-account"
            noneLabel="No account"
            value={accountId}
            onChange={(id) => {
              setAccountId(id)
              setDealId("")
            }}
          />
        </Field>
      ) : null}

      {accountId && !fixedOpportunityId ? (
        <Field label="Opportunity" htmlFor="did-deal" hint={dealsQuery.isPending ? "Loading the Opportunities of this account…" : "Optional."}>
          <Select disabled={dealsQuery.isPending} value={dealId || NONE} onValueChange={(v) => setDealId(!v || v === NONE ? "" : v)}>
            <SelectTrigger id="did-deal" className="w-full">
              <SelectValue>{(v: string | null) => deals.find((d) => d.id === v)?.serial ?? "Not about one Opportunity"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not about one Opportunity</SelectItem>
              {deals.map((deal) => (
                <SelectItem key={deal.id} value={deal.id}>{`${deal.serial} · ${deal.name}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {dealsQuery.isError ? (
            <RetryNote onRetry={() => void dealsQuery.refetch()}>The Opportunities could not be loaded.</RetryNote>
          ) : null}
        </Field>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}
      <DialogFooter>
        <DialogActions
          pending={mutation.isPending}
          submitLabel="Save"
          disabled={false}
          onCancel={onDone}
          onSubmit={() => submit()}
        />
      </DialogFooter>
    </form>
  )
}

/**
 * The button that is on every Sales page (owner, 2026-11-02). A small floating
 * button, so it is one tap away wherever a person is and no page has to make
 * room for it. It follows the same switch as making a task: when an admin turns
 * task creation off for Sales Users, it is not shown.
 */
export function IDidThisButton() {
  const { can } = useSalesPermissions()
  const [open, setOpen] = useState(false)
  if (!can("task.create")) return null
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-30 h-auto gap-1.5 rounded-full bg-ink px-4 py-2.5 text-caption font-bold text-white shadow-lg hover:bg-ink-strong motion-reduce:transition-none sm:right-6 sm:bottom-6"
      >
        <RiCheckboxCircleLine className="size-4" aria-hidden />
        I did this
      </Button>
      <IDidThisDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
