"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { RiAddLine, RiDeleteBinLine, RiEditLine } from "@remixicon/react"

import {
  createPolicyNote,
  deletePolicyNote,
  listPolicyNotes,
  updatePolicyNote,
  type PolicyNoteInput,
} from "@/lib/api/statements"
import { ApiError } from "@/lib/api/client"
import type { PolicyNote } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { PageHeader } from "@/components/dashboard/page-header"
import { HelpLink } from "@/components/help/help-link"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Heading } from "@/components/ds/heading"

const BLANK: PolicyNoteInput = { ref: "", title: "", body: "" }

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

/**
 * A plain textarea, deliberately. 2b Decision 14: blank lines separate
 * paragraphs and nothing else is markup. A rich-text editor here means
 * storing markup, which means a sanitiser before it reaches the browser
 * puppeteer renders the PDF in.
 */
function NoteForm({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  value: PolicyNoteInput
  onChange: (next: PolicyNoteInput) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const valid = value.ref.trim() !== "" && value.title.trim() !== ""

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="note-ref">Number</Label>
          <Input
            id="note-ref"
            value={value.ref}
            onChange={(e) => onChange({ ...value, ref: e.target.value })}
            placeholder="2.08"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note-title">Title</Label>
          <Input
            id="note-title"
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            placeholder="Statement of Cash Flows"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="note-body">Text</Label>
        <Textarea
          id="note-body"
          rows={8}
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Leave a blank line between paragraphs. No other formatting is carried into the PDF.
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={!valid || saving}>
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function PolicyNotesPage() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<PolicyNoteInput>(BLANK)
  const [confirmDelete, setConfirmDelete] = useState<PolicyNote | null>(null)

  const notes = useQuery({
    queryKey: ["statements", "policy-notes"],
    queryFn: () => listPolicyNotes(accessToken!),
    enabled: Boolean(accessToken),
  })

  const done = (text: string) => {
    queryClient.invalidateQueries({ queryKey: ["statements", "policy-notes"] })
    toast.success(text)
    setEditingId(null)
    setAdding(false)
    setDraft(BLANK)
  }

  const create = useMutation({
    mutationFn: () => createPolicyNote(accessToken!, draft),
    onSuccess: () => done("Note added"),
    onError: (err) => toast.error(message(err, "Could not add the note")),
  })

  const update = useMutation({
    mutationFn: () => updatePolicyNote(accessToken!, editingId!, draft),
    onSuccess: () => done("Note saved"),
    onError: (err) => toast.error(message(err, "Could not save the note")),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deletePolicyNote(accessToken!, id),
    onSuccess: () => {
      setConfirmDelete(null)
      done("Note deleted")
    },
    onError: (err) => toast.error(message(err, "Could not delete the note")),
  })

  const startEdit = (note: PolicyNote) => {
    setAdding(false)
    setEditingId(note.id)
    setDraft({ ref: note.ref, title: note.title, body: note.body })
  }

  const startAdd = () => {
    setEditingId(null)
    setAdding(true)
    setDraft(BLANK)
  }

  const cancel = () => {
    setEditingId(null)
    setAdding(false)
    setDraft(BLANK)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Statements"
        title="Policy notes"
        sub="Notes 1.00 to 3.00 — the narrative accounting policies, printed above the generated breakdowns."
      />

      <div className="flex justify-end">
        <Button size="sm" onClick={startAdd} disabled={adding}>
          <RiAddLine className="size-4" />
          Add note
        </Button>
      </div>

      {adding && (
        <article className="rounded-lg border border-dashed p-4">
          <Heading level="section" className="mb-3">New note</Heading>
          <NoteForm
            value={draft}
            onChange={setDraft}
            onSave={() => create.mutate()}
            onCancel={cancel}
            saving={create.isPending}
          />
        </article>
      )}

      {notes.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : notes.isError ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          {message(notes.error, "Could not load the policy notes.")}
        </p>
      ) : notes.data.length === 0 && !adding ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No policy notes yet. Seeding the database creates notes 1.00 to 3.00.{" "}
          <HelpLink>How does this work?</HelpLink>
        </p>
      ) : (
        <div className="space-y-4">
          {notes.data.map((note) =>
            editingId === note.id ? (
              <article key={note.id} className="rounded-lg border p-4">
                <NoteForm
                  value={draft}
                  onChange={setDraft}
                  onSave={() => update.mutate()}
                  onCancel={cancel}
                  saving={update.isPending}
                />
              </article>
            ) : (
              <article key={note.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <Heading level="section">
                    {note.ref} {note.title}
                  </Heading>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(note)}>
                      <RiEditLine className="size-4" />
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(note)}>
                      <RiDeleteBinLine className="size-4" />
                      Delete
                    </Button>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{note.body}</p>
              </article>
            )
          )}
        </div>
      )}

      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete note {confirmDelete?.ref} {confirmDelete?.title}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It will stop appearing in the notes and in the PDF. The change is recorded in the
              audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
              disabled={remove.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
