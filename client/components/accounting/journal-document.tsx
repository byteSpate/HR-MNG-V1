"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RiArrowGoBackLine, RiArrowLeftLine, RiDeleteBinLine } from "@remixicon/react"
import { toast } from "sonner"

import { sides } from "@/lib/accounting/side-style"
import { deleteJournal, reverseJournal, submitJournal } from "@/lib/api/accounting"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { Journal } from "@/lib/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { JournalAttachments } from "@/components/accounting/journal-attachments"
import {
  ApprovalNotice,
  JournalApprovalActions,
} from "@/components/accounting/journal-approval"
import {
  actorLabel,
  formatAmount,
  formatLedgerDate,
  formatTotal,
  fromPaisa,
  JOURNAL_STATUS_LABEL,
  JOURNAL_TYPE_LABEL,
  sumPaisa,
} from "@/components/accounting/accounting-shared"

/**
 * A journal rendered as a document rather than as a form.
 *
 * The distinction is the point: an entry you cannot retype should not look
 * like an entry you might. That covers two cases — a journal that has already
 * posted, and a *generated* draft, meaning a reversal or a year-end closing
 * entry, whose lines are derived from the ledger and which the server refuses
 * to accept edits to. A generated draft still needs to be sent for approval
 * or thrown away, so those two actions live here as well.
 */
export function JournalDocument({ journal }: { journal: Journal }) {
  const { accessToken } = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()

  const [reverseOpen, setReverseOpen] = useState(false)
  const [reverseReason, setReverseReason] = useState("")

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["accounting"] })

  const reverse = useMutation({
    mutationFn: () => reverseJournal(accessToken!, journal.id, reverseReason),
    onSuccess: (created) => {
      refresh()
      setReverseOpen(false)
      toast.success(`${created.journalNo} drafted as the reversal`)
      router.push(`${created.id}`)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not reverse it"),
  })

  const submit = useMutation({
    mutationFn: () => submitJournal(accessToken!, journal.id),
    onSuccess: () => {
      refresh()
      toast.success(`${journal.journalNo} sent for approval`)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not submit it"),
  })

  const discard = useMutation({
    mutationFn: () => deleteJournal(accessToken!, journal.id),
    onSuccess: () => {
      refresh()
      toast.success(`${journal.journalNo} deleted`)
      router.push("../journals")
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not delete it"),
  })

  const debit = fromPaisa(sumPaisa(journal.lines.map((l) => l.debit)))
  const credit = fromPaisa(sumPaisa(journal.lines.map((l) => l.credit)))

  const isGeneratedDraft = journal.status === "DRAFT"

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push("../journals")}>
            <RiArrowLeftLine className="size-4" /> Register
          </Button>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {journal.journalNo}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={journal.status === "POSTED" ? "default" : "secondary"}>
              {JOURNAL_STATUS_LABEL[journal.status]}
            </Badge>
            <span>{JOURNAL_TYPE_LABEL[journal.type]}</span>
            <span>·</span>
            <span>{formatLedgerDate(journal.date)}</span>
            {journal.reference && <span>· Ref {journal.reference}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isGeneratedDraft && (
            <>
              <Button variant="ghost" onClick={() => discard.mutate()} disabled={discard.isPending}>
                <RiDeleteBinLine className="size-4" /> Discard
              </Button>
              <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                {submit.isPending ? "Submitting…" : "Submit for approval"}
              </Button>
            </>
          )}
          <JournalApprovalActions journal={journal} />
          {journal.status === "POSTED" && (
            <Button variant="outline" onClick={() => setReverseOpen(true)}>
              <RiArrowGoBackLine className="size-4" /> Reverse
            </Button>
          )}
        </div>
      </div>

      <ApprovalNotice journal={journal} />

      {isGeneratedDraft && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          {journal.type === "CLOSING"
            ? "This closing entry was derived from the year's profit and loss. It is not editable — if it is wrong, discard it and run year-end again."
            : "This reversal was derived from the journal it reverses. It is not editable — if it is wrong, discard it and the original returns to posted."}
        </p>
      )}

      {journal.reversesId && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          This reverses{" "}
          <Link href={`${journal.reversesId}`} className="font-medium underline">
            the original journal
          </Link>
          {journal.reversalReason && <> — {journal.reversalReason}</>}
        </p>
      )}

      <p className="text-base">{journal.narration}</p>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Line note</TableHead>
              <TableHead className={`w-36 text-right ${sides.sideText("debit")}`}>Debit</TableHead>
              <TableHead className={`w-36 text-right ${sides.sideText("credit")}`}>Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {journal.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-muted-foreground tabular-nums">{l.account.code}</TableCell>
                <TableCell>{l.account.name}</TableCell>
                <TableCell className="text-muted-foreground">{l.narration ?? ""}</TableCell>
                <TableCell className={`text-right tabular-nums ${sides.sideText("debit")}`}>{formatAmount(l.debit)}</TableCell>
                <TableCell className={`text-right tabular-nums ${sides.sideText("credit")}`}>{formatAmount(l.credit)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 font-medium">
              <TableCell colSpan={3} className="text-right">Total</TableCell>
              <TableCell className={`text-right tabular-nums ${sides.sideText("debit")}`}>{formatTotal(debit)}</TableCell>
              <TableCell className={`text-right tabular-nums ${sides.sideText("credit")}`}>{formatTotal(credit)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <dl className="grid gap-x-8 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Created by</dt>
          <dd>{actorLabel(journal.createdByUser, journal.createdBy)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Submitted</dt>
          <dd>{journal.submittedAt ? formatLedgerDate(journal.submittedAt) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Approved by</dt>
          <dd>{actorLabel(journal.approvedByUser, journal.approvedBy)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Posted</dt>
          <dd>{journal.postedAt ? formatLedgerDate(journal.postedAt) : "—"}</dd>
        </div>
      </dl>

      <JournalAttachments journalId={journal.id} attachments={journal.attachments} />

      <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse {journal.journalNo}?</DialogTitle>
            <DialogDescription>
              A posted journal is never edited. This creates a new draft with every debit and
              credit swapped, dated in this journal&apos;s period if it is still open and in the
              next open period if it is not. It then follows the ordinary approval path.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="Posted to the wrong account"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseOpen(false)}>Cancel</Button>
            <Button onClick={() => reverse.mutate()} disabled={!reverseReason.trim() || reverse.isPending}>
              Create the reversal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
