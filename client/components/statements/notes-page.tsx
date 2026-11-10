"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { RiAddLine, RiDeleteBinLine, RiEditLine } from "@remixicon/react"

import {
  createPolicyNote,
  deletePolicyNote,
  getNotes,
  listPolicyNotes,
  updatePolicyNote,
  type PolicyNoteInput,
} from "@/lib/api/statements"
import { ApiError } from "@/lib/api/client"
import type { PolicyNote, StatementNoteView } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { ConfirmDialog, PanelAlert } from "@/components/dashboard/record-kit"
import { Amount } from "@/components/ds/amount"
import { Heading } from "@/components/ds/heading"
import { Text } from "@/components/ds/text"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { PeriodControl } from "@/components/statements/period-control"
import { useStatementPeriod } from "@/components/statements/use-statement-period"

/**
 * Notes to the financial statements, in one place.
 *
 * This was two pages: "Notes" (read only, text and tables together) and
 * "Policy notes" (where the text was written). The owner found two pages
 * confusing (2026-11-09), so the writing moved here. A note can have written
 * text, a table of accounts from the ledger, or both. They are joined by the
 * note number, the same way the server joins them.
 *
 * Only Finance and Super Admin reach this page, and both may edit, so no
 * role check is needed for the buttons.
 */

const BLANK: PolicyNoteInput = { ref: "", title: "", body: "" }

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

/** "2", "2.0" and "2.00" are the same note number, as on the server (statements.refs.ts). */
function sameRef(a: string, b: string): boolean {
  const left = a.split(".").map(Number)
  const right = b.split(".").map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return false
  }
  return true
}

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
  hasTable,
}: {
  value: PolicyNoteInput
  onChange: (next: PolicyNoteInput) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  hasTable: boolean
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
      {hasTable ? (
        <Text variant="muted">
          The number joins this text to its table of accounts. If you change the number, the text moves away from the table.
        </Text>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="note-body">Text</Label>
        <Textarea
          id="note-body"
          rows={8}
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
        />
        <Text variant="muted">Leave a blank line between paragraphs. The PDF keeps no other formatting.</Text>
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

function NoteTable({ note }: { note: StatementNoteView }) {
  return (
    <div className="mt-3 space-y-2 text-body-sm md:space-y-1">
      {note.rows.map((r) => (
        <div
          key={r.accountId}
          className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-b border-line pb-2 last:border-0 md:grid-cols-[1fr_140px_140px] md:gap-3 md:border-0 md:pb-0"
        >
          <span className="col-span-2 min-w-0 md:col-span-1">
            {r.code} {r.name}
          </span>
          <Amount value={r.current} mode="signed" className="max-md:text-left" />
          <Amount value={r.comparative} mode="signed" tone="muted" />
        </div>
      ))}
    </div>
  )
}

/** What is open in the editor: a new note, new text for a table-only note, or an existing text. */
type Editing = { kind: "new" } | { kind: "add-text"; ref: string } | { kind: "edit"; id: string }

export function NotesPage() {
  const queryClient = useQueryClient()
  const { accessToken, range, ready, control } = useStatementPeriod()

  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState<PolicyNoteInput>(BLANK)
  const [confirmDelete, setConfirmDelete] = useState<{ written: PolicyNote; hasTable: boolean } | null>(null)

  const notes = useQuery({
    queryKey: ["statements", "notes", range],
    queryFn: () => getNotes(accessToken!, range),
    enabled: ready,
    retry: false,
  })
  const written = useQuery({
    queryKey: ["statements", "policy-notes"],
    queryFn: () => listPolicyNotes(accessToken!),
    enabled: Boolean(accessToken),
  })

  const close = () => {
    setEditing(null)
    setDraft(BLANK)
  }

  const done = (text: string) => {
    queryClient.invalidateQueries({ queryKey: ["statements", "policy-notes"] })
    queryClient.invalidateQueries({ queryKey: ["statements", "notes"] })
    toast.success(text)
    close()
  }

  const create = useMutation({
    mutationFn: () => createPolicyNote(accessToken!, draft),
    onSuccess: () => done("Note saved"),
    onError: (err) => toast.error(message(err, "The note was not saved. Please try again.")),
  })

  const update = useMutation({
    mutationFn: (id: string) => updatePolicyNote(accessToken!, id, draft),
    onSuccess: () => done("Note saved"),
    onError: (err) => toast.error(message(err, "The note was not saved. Please try again.")),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deletePolicyNote(accessToken!, id),
    onSuccess: () => {
      setConfirmDelete(null)
      done("Text deleted")
    },
    onError: (err) => toast.error(message(err, "The text was not deleted. Please try again.")),
  })

  const saving = create.isPending || update.isPending
  const save = () => (editing?.kind === "edit" ? update.mutate(editing.id) : create.mutate())

  const writtenFor = (note: StatementNoteView) => written.data?.find((w) => sameRef(w.ref, note.ref)) ?? null

  const loading = !ready || notes.isPending || written.isPending

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Statements"
        title="Notes"
        sub="The notes printed after the statements. A note can have written text, a table of accounts from the ledger, or both."
        aside={
          loading ? null : (
            <Button
              size="sm"
              onClick={() => {
                setEditing({ kind: "new" })
                setDraft(BLANK)
              }}
              disabled={editing?.kind === "new"}
            >
              <RiAddLine className="size-4" />
              Add note
            </Button>
          )
        }
      />

      <PeriodControl {...control} comparativeLabel={notes.data?.comparativePeriod.label ?? null} />

      {editing?.kind === "new" ? (
        <article className="rounded-lg border border-dashed p-4">
          <Heading level="section" className="mb-3">
            New note
          </Heading>
          <NoteForm value={draft} onChange={setDraft} onSave={save} onCancel={close} saving={saving} hasTable={false} />
        </article>
      ) : null}

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : notes.isError || written.isError ? (
        <PanelAlert>{message(notes.error ?? written.error, "The notes did not load. Please try again.")}</PanelAlert>
      ) : notes.data.notes.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          There are no notes yet. Press <strong>Add note</strong> to write the first one.
        </p>
      ) : (
        <div className="space-y-4">
          {notes.data.notes.map((note) => {
            const text = writtenFor(note)
            const hasTable = note.rows.length > 0
            const isOpen =
              (editing?.kind === "edit" && text?.id === editing.id) ||
              (editing?.kind === "add-text" && sameRef(editing.ref, note.ref))

            return (
              <section key={note.ref} className="rounded-lg border p-4">
                {isOpen ? (
                  <NoteForm
                    value={draft}
                    onChange={setDraft}
                    onSave={save}
                    onCancel={close}
                    saving={saving}
                    hasTable={hasTable}
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <Heading level="card">
                        {note.ref} {note.title}
                      </Heading>
                      <div className="flex shrink-0 gap-1">
                        {text ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditing({ kind: "edit", id: text.id })
                                setDraft({ ref: text.ref, title: text.title, body: text.body })
                              }}
                            >
                              <RiEditLine className="size-4" />
                              Edit text
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete({ written: text, hasTable })}>
                              <RiDeleteBinLine className="size-4" />
                              Delete text
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing({ kind: "add-text", ref: note.ref })
                              setDraft({ ref: note.ref, title: note.title, body: "" })
                            }}
                          >
                            <RiAddLine className="size-4" />
                            Add text
                          </Button>
                        )}
                      </div>
                    </div>
                    {note.body ? (
                      <Text variant="muted" className="mt-2 whitespace-pre-line">
                        {note.body}
                      </Text>
                    ) : null}
                  </>
                )}
                {hasTable ? <NoteTable note={note} /> : null}
              </section>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete the text of note ${confirmDelete?.written.ref ?? ""} ${confirmDelete?.written.title ?? ""}?`}
        body={
          confirmDelete?.hasTable
            ? "The written text goes from this page and from the PDF. The table of accounts stays, because it comes from the ledger. The change is saved in the audit trail."
            : "The note goes from this page and from the PDF. The change is saved in the audit trail."
        }
        confirmLabel="Delete"
        pending={remove.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove.mutate(confirmDelete.written.id)}
      />
    </div>
  )
}
