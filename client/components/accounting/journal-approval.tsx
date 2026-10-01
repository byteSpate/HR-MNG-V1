"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RiCheckLine, RiCloseLine } from "@remixicon/react"
import { toast } from "sonner"

import { approveJournal, rejectJournal } from "@/lib/api/accounting"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { Journal } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { canApprove } from "@/components/accounting/accounting-shared"

/**
 * Approve and send-back, for a journal awaiting approval.
 *
 * Shared because a journal awaiting approval renders two different ways: a
 * typed one stays a form, so the Finance Officer can still correct it, while
 * a generated one (a reversal, a year-end closing entry) renders as a
 * read-only document. The approver's actions are the same in both, and when
 * they lived only in the document a typed journal had no approval path at
 * all — the Super Admin opened it and found nothing but Save.
 */

/** Whether this viewer is the one who can act on this journal right now. */
export function useApprovalState(journal: Journal | null) {
  const { user } = useSession()
  const pending = journal?.status === "PENDING_APPROVAL"
  return {
    /** Show the actions at all. Hidden, not disabled, for a Finance Officer. */
    show: Boolean(pending && canApprove(user?.role)),
  }
}

export function JournalApprovalActions({
  journal,
  /**
   * Set when the surrounding form holds edits that are not saved. Approving
   * posts what the server holds, not what is on screen, so the two must not
   * be allowed to differ silently.
   */
  blocked,
}: {
  journal: Journal
  blocked?: boolean
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const { show } = useApprovalState(journal)

  const [rejectOpen, setRejectOpen] = useState(false)
  const [note, setNote] = useState("")

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["accounting"] })

  const approve = useMutation({
    mutationFn: () => approveJournal(accessToken!, journal.id),
    onSuccess: () => {
      refresh()
      toast.success(`${journal.journalNo} posted`)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not approve it"),
  })

  const reject = useMutation({
    mutationFn: () => rejectJournal(accessToken!, journal.id, note),
    onSuccess: () => {
      refresh()
      setRejectOpen(false)
      toast.success("Sent back to draft")
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not send it back"),
  })

  if (!show) return null

  return (
    <>
      <Button variant="outline" onClick={() => setRejectOpen(true)}>
        <RiCloseLine className="size-4" /> Send back
      </Button>
      <Button
        onClick={() => approve.mutate()}
        disabled={approve.isPending || Boolean(blocked)}
      >
        <RiCheckLine className="size-4" />
        {approve.isPending ? "Posting…" : "Approve and post"}
      </Button>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {journal.journalNo} back?</DialogTitle>
            <DialogDescription>
              It returns to draft with your note attached, so the author knows what to change.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Rent belongs in 5206, not 5207"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => reject.mutate()} disabled={!note.trim() || reject.isPending}>
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Why the Approve button is there but refuses. A disabled control with no
 * stated reason reads as a broken one — and the server's reason
 * ("you created it") never reaches the screen, because the disabled button
 * never sends the request that would return it.
 */
export function ApprovalNotice({ journal, dirty }: { journal: Journal; dirty?: boolean }) {
  const { show } = useApprovalState(journal)
  if (!show) return null

  if (dirty) {
    return (
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        You have unsaved edits. Approving posts the journal as it is saved, not as it is on
        screen — save your changes first, or reload to discard them.
      </p>
    )
  }
  return null
}
