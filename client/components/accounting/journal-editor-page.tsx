"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiArrowLeftLine, RiDeleteBinLine } from "@remixicon/react"
import { toast } from "sonner"

import {
  createJournal,
  deleteJournal,
  getJournal,
  listAccountsFlat,
  submitJournal,
  approveJournal,
  updateJournal,
} from "@/lib/api/accounting"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { CreateJournalInput, Journal } from "@/lib/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { JournalDocument } from "@/components/accounting/journal-document"
import { JournalAttachments } from "@/components/accounting/journal-attachments"
import {
  ApprovalNotice,
  JournalApprovalActions,
} from "@/components/accounting/journal-approval"
import {
  computeBalance,
  initialLines,
  JournalLinesEditor,
  validationMessage,
  type DraftLine,
} from "@/components/accounting/journal-lines-editor"
import {
  canApprove,
  JOURNAL_STATUS_LABEL,
  JOURNAL_TYPE_LABEL,
  toDateInput,
} from "@/components/accounting/accounting-shared"

function toDraftLines(journal: Journal): DraftLine[] {
  return journal.lines.map((l) => ({
    key: l.id,
    accountId: l.accountId,
    // Zero renders blank so the unused column reads as empty, not as 0.00.
    debit: Number(l.debit) === 0 ? "" : l.debit,
    credit: Number(l.credit) === 0 ? "" : l.credit,
    narration: l.narration ?? "",
  }))
}

function toApiLines(lines: DraftLine[]): CreateJournalInput["lines"] {
  return lines
    .filter((l) => l.accountId && (l.debit || l.credit))
    .map((l) => ({
      accountId: l.accountId!,
      debit: l.debit || "0",
      credit: l.credit || "0",
      narration: l.narration || null,
    }))
}

/**
 * The editable form. Mounted keyed by `journalId` (see JournalEditorPage),
 * so every field initializes from the fetched journal on mount — there is
 * no effect stamping state, and a refetch after a save cannot overwrite
 * what the user is typing.
 */
function JournalForm({
  journal,
  onSaved,
}: {
  /** The fetched journal, or null for a brand-new one. */
  journal: Journal | null
  onSaved: (id: string) => void
}) {
  const { accessToken, user } = useSession()
  // A Super Admin has no one to send a journal to, so they post it in one step.
  const canPostNow = canApprove(user?.role)
  const queryClient = useQueryClient()

  const [date, setDate] = useState(() =>
    journal ? toDateInput(journal.date) : new Date().toISOString().slice(0, 10)
  )
  const [narration, setNarration] = useState(journal?.narration ?? "")
  const [reference, setReference] = useState(journal?.reference ?? "")
  const [lines, setLines] = useState<DraftLine[]>(journal ? toDraftLines(journal) : initialLines())

  const accounts = useQuery({
    queryKey: ["accounting", "accounts", "flat"],
    queryFn: () => listAccountsFlat(accessToken!),
    enabled: Boolean(accessToken),
  })

  const problem = useMemo(() => validationMessage(lines), [lines])
  const balance = useMemo(() => computeBalance(lines), [lines])
  const isDraft = !journal || journal.status === "DRAFT"

  // Whether what is on screen still matches what the server holds. It matters
  // only to an approver: Approve posts the saved journal, so approving with
  // edits on screen would post something the approver did not read.
  const dirty = useMemo(() => {
    if (!journal) return false
    const same =
      date === toDateInput(journal.date) &&
      narration === journal.narration &&
      reference === (journal.reference ?? "") &&
      JSON.stringify(toApiLines(lines)) === JSON.stringify(toApiLines(toDraftLines(journal)))
    return !same
  }, [journal, date, narration, reference, lines])

  const save = useMutation({
    mutationFn: async (): Promise<Journal> => {
      const payload = { date, narration, reference: reference || null, lines: toApiLines(lines) }
      if (journal) return updateJournal(accessToken!, journal.id, payload)
      return createJournal(accessToken!, payload)
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["accounting"] })
      toast.success(journal ? "Draft saved" : `${saved.journalNo} created`)
      onSaved(saved.id)
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not save the journal"),
  })

  const submit = useMutation({
    mutationFn: async () => {
      // Always save first. Submitting a stale draft is the classic way to
      // send something for approval that is not what is on screen.
      const payload = { date, narration, reference: reference || null, lines: toApiLines(lines) }
      const saved = journal
        ? await updateJournal(accessToken!, journal.id, payload)
        : await createJournal(accessToken!, payload)
      return submitJournal(accessToken!, saved.id)
    },
    onSuccess: (sent) => {
      queryClient.invalidateQueries({ queryKey: ["accounting"] })
      toast.success(`${sent.journalNo} sent for approval`)
      onSaved(sent.id)
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not submit the journal"),
  })

  const post = useMutation({
    mutationFn: async () => {
      // Save first, then post what was saved. Posting reads the saved journal,
      // so a stale draft would post something that is not on screen.
      const payload = { date, narration, reference: reference || null, lines: toApiLines(lines) }
      const saved = journal
        ? await updateJournal(accessToken!, journal.id, payload)
        : await createJournal(accessToken!, payload)
      return approveJournal(accessToken!, saved.id)
    },
    onSuccess: (posted) => {
      queryClient.invalidateQueries({ queryKey: ["accounting"] })
      toast.success(`${posted.journalNo} posted`)
      onSaved(posted.id)
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not post the journal"),
  })

  const discard = useMutation({
    mutationFn: () => deleteJournal(accessToken!, journal!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounting"] })
      toast.success("Draft deleted")
      onSaved("")
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not delete the draft"),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => onSaved("")}>
            <RiArrowLeftLine className="size-4" /> Register
          </Button>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {journal ? journal.journalNo : "New journal"}
          </h1>
          {journal && (
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{JOURNAL_STATUS_LABEL[journal.status]}</Badge>
              <span>{JOURNAL_TYPE_LABEL[journal.type]}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isDraft && (
            <Button variant="ghost" onClick={() => discard.mutate()} disabled={discard.isPending}>
              <RiDeleteBinLine className="size-4" /> Discard
            </Button>
          )}
          <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : isDraft ? "Save draft" : "Save changes"}
          </Button>
          {/*
            Only a draft can be submitted. An already-pending journal stays
            editable — that is the design, a Finance Officer may correct it
            before it is approved — but submitting it again is a state the
            server refuses, so the button is absent rather than offered and
            then rejected.
          */}
          {isDraft && canPostNow && (
            <Button
              onClick={() => post.mutate()}
              disabled={Boolean(problem) || post.isPending || !narration.trim()}
            >
              {post.isPending ? "Posting…" : "Post journal"}
            </Button>
          )}
          {isDraft && !canPostNow && (
            <Button
              onClick={() => submit.mutate()}
              disabled={Boolean(problem) || submit.isPending || !narration.trim()}
            >
              {submit.isPending ? "Submitting…" : "Submit for approval"}
            </Button>
          )}
          {/*
            A typed journal stays a form while it awaits approval, so the
            approver meets it here rather than in the read-only document. Both
            surfaces render the same two actions; without this one, a Super
            Admin opening a journal the Finance Officer submitted found no way
            to approve it at all.
          */}
          {journal && <JournalApprovalActions journal={journal} blocked={dirty} />}
        </div>
      </div>

      {journal?.status === "PENDING_APPROVAL" && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          Awaiting approval. Edits you save here are recorded and go to the approver as they
          stand.
        </p>
      )}

      {journal && <ApprovalNotice journal={journal} dirty={dirty} />}

      {journal?.rejectionNote && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="font-medium">Sent back:</span> {journal.rejectionNote}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[180px_1fr_220px]">
        <div className="grid gap-2">
          <Label htmlFor="j-date">Date</Label>
          <Input id="j-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="j-narration">Narration</Label>
          <Textarea
            id="j-narration"
            rows={1}
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Office rent for July 2026"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="j-reference">Reference</Label>
          <Input
            id="j-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Cheque or invoice no."
          />
        </div>
      </div>

      <JournalLinesEditor lines={lines} onChange={setLines} accounts={accounts.data ?? []} />

      {/* The disabled Submit always says why. */}
      {problem && !balance.isBalanced && (
        <p className="text-sm text-destructive" role="status">
          {problem}
        </p>
      )}
      {problem && balance.isBalanced && (
        <p className="text-sm text-muted-foreground" role="status">
          {problem}
        </p>
      )}

      {journal && (
        <JournalAttachments journalId={journal.id} attachments={journal.attachments} />
      )}
    </div>
  )
}

export function JournalEditorPage({ journalId }: { journalId?: string }) {
  const { accessToken } = useSession()
  const router = useRouter()

  const journal = useQuery({
    queryKey: ["accounting", "journal", journalId],
    queryFn: () => getJournal(accessToken!, journalId!),
    enabled: Boolean(accessToken && journalId),
  })

  // "Register" back-navigation and post-save routing.
  const go = (target: string) => {
    if (target === "") router.push("../journals")
    else router.replace(`${target}`)
  }

  if (journalId && journal.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (journalId && journal.isError) {
    return (
      <div className="rounded-lg border p-10 text-center text-sm">
        <p className="text-muted-foreground">This journal could not be loaded.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => journal.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const data = journal.data ?? null

  // A posted journal is a different kind of object from a draft, and it
  // renders as one — a read-only document with a Reverse action, not a form
  // with greyed-out inputs.
  const isSettled = data !== null && data.status !== "DRAFT" && data.status !== "PENDING_APPROVAL"

  // A reversal and a year-end entry are generated, not typed: their lines are
  // the exact inverse of another journal and the exact contra of a year's
  // profit and loss. The server refuses to retype either, so they render as
  // documents even while they are still drafts — a form whose fields cannot
  // be saved is worse than no form.
  const isGenerated = data !== null && (data.type === "REVERSAL" || data.type === "CLOSING")

  if (data && (isSettled || isGenerated)) {
    return <JournalDocument journal={data} />
  }

  // Keyed by journal id so a brand-new journal and each different existing
  // journal get their own form state, initialized from the fetched row.
  return <JournalForm key={journalId ?? "new"} journal={data} onSaved={go} />
}
