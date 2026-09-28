"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { RiAddLine } from "@remixicon/react"

import { addMilestone, changeProjectStatus, removeMilestone, updateMilestone } from "@/lib/api/sales/projects"
import { useSession } from "@/lib/auth/session-context"
import type { ProjectStatus, ProjectSummary } from "@/lib/api/types"
import {
  ConfirmDeleteDialog, ConfirmDialog, DialogActions, Field, FormError, PanelAlert, TONE, toMessage,
} from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import {
  PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, PROJECT_STATUSES, REASON_NEEDED,
} from "@/components/sales/projects/project-shared"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

function onDate(value: string | null): string {
  if (!value) return "No date"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

/**
 * The Project's own status, and the milestones that make it progress
 * (spec §1.7). A status with a reason behind it asks for one first, and
 * Completing warns about the milestones still open rather than refusing.
 */
export function ProjectStatusTab({ project, onSaved }: { project: ProjectSummary; onSaved: (p: ProjectSummary) => void }) {
  const { accessToken } = useSession()
  const [chosen, setChosen] = useState<ProjectStatus>(project.status)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [milestoneError, setMilestoneError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [newDueOn, setNewDueOn] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; title: string; dueOn: string } | null>(null)

  const open = project.milestones.filter((m) => m.doneAt === null).length
  const needsReason = REASON_NEEDED[chosen]

  const saveStatus = useMutation({
    mutationFn: () => changeProjectStatus(accessToken!, project.id, { status: chosen, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
    onSuccess: (p) => { setError(null); setReason(""); setConfirming(false); onSaved(p) },
    onError: (err) => { setConfirming(false); setError(toMessage(err)) },
  })

  const add = useMutation({
    mutationFn: () => addMilestone(accessToken!, project.id, { title: newTitle.trim(), dueOn: newDueOn || null }),
    onSuccess: (p) => { setMilestoneError(null); setNewTitle(""); setNewDueOn(""); onSaved(p) },
    onError: (err) => setMilestoneError(toMessage(err)),
  })

  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => updateMilestone(accessToken!, id, { done }),
    onSuccess: (p) => { setMilestoneError(null); onSaved(p) },
    onError: (err) => setMilestoneError(toMessage(err)),
  })

  const edit = useMutation({
    mutationFn: () => updateMilestone(accessToken!, editing!.id, { title: editing!.title.trim(), dueOn: editing!.dueOn || null }),
    onSuccess: (p) => { setEditing(null); setMilestoneError(null); onSaved(p) },
    onError: (err) => setMilestoneError(toMessage(err)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => removeMilestone(accessToken!, id),
    onSuccess: (p) => { setRemoving(null); setMilestoneError(null); onSaved(p) },
    onError: (err) => { setRemoving(null); setMilestoneError(toMessage(err)) },
  })

  const submitStatus = () => {
    // Completing with milestones still open is allowed, but never silently.
    if (chosen === "COMPLETED" && open > 0) setConfirming(true)
    else saveStatus.mutate()
  }

  return (
    <div className="grid gap-4">
      <Panel>
        <PanelHeading title="Status" />
        {error ? <PanelAlert>{error}</PanelAlert> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Tag label={PROJECT_STATUS_LABEL[project.status]} tone={PROJECT_STATUS_TONE[project.status]} />
          {project.statusReason ? <span className="text-[12.5px] text-[#5F6B7C]">{project.statusReason}</span> : null}
          {project.completedAt ? (
            <span className={`text-[12.5px] ${TONE.muted}`}>
              Completed on {new Date(project.completedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          ) : null}
        </div>

        {project.canManage ? (
          <div className="mt-3 grid gap-2 sm:max-w-md">
            <Field label="Status" htmlFor="prj-status">
              <select
                id="prj-status"
                value={chosen}
                onChange={(e) => { setChosen(e.target.value as ProjectStatus); setError(null) }}
                className="h-9 w-full rounded-md border border-[#E4E9EF] bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#17191C]/20"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </Field>
            {needsReason ? (
              <Field label="Reason" htmlFor="prj-reason" help={needsReason}>
                <Input id="prj-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            ) : null}
            <div>
              <Button
                type="button"
                disabled={(!!needsReason && !reason.trim()) || saveStatus.isPending}
                onClick={submitStatus}
                className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
              >
                {saveStatus.isPending ? "Saving…" : "Save status"}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeading title="Milestones" />
        {milestoneError ? <PanelAlert>{milestoneError}</PanelAlert> : null}

        {project.milestones.length === 0 ? (
          <p className={`text-[12.5px] ${TONE.muted}`}>No milestones yet. Add the main steps of the work, with a target date.</p>
        ) : (
          <ol className="divide-y divide-[#E4E9EF]">
            {project.milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 py-2.5">
                {project.canManage ? (
                  <Checkbox
                    aria-label={`${m.title} reached`}
                    checked={m.doneAt !== null}
                    disabled={toggle.isPending}
                    onCheckedChange={(v) => toggle.mutate({ id: m.id, done: v === true })}
                  />
                ) : null}
                <span className={`text-[13px] ${m.doneAt ? TONE.muted : "font-semibold"}`}>{m.title}</span>
                <span className={`text-[12px] ${TONE.muted}`}>{onDate(m.dueOn)}</span>
                {project.canManage ? (
                  <span className="ml-auto flex items-center gap-1">
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => setEditing({ id: m.id, title: m.title, dueOn: m.dueOn ?? "" })}
                      className="h-auto p-0 text-[12px] font-bold text-[#5F6B7C]"
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => setRemoving(m.id)}
                      className="h-auto p-0 text-[12px] font-bold text-[#B03A3A]"
                    >
                      Remove
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        {project.canManage ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Milestone" htmlFor="ms-title">
              <Input id="ms-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Delivery" />
            </Field>
            <Field label="Target date" htmlFor="ms-due">
              <Input id="ms-due" type="date" value={newDueOn} onChange={(e) => setNewDueOn(e.target.value)} />
            </Field>
            <Button
              type="button"
              variant="outline"
              disabled={!newTitle.trim() || add.isPending}
              onClick={() => add.mutate()}
              className="h-9 text-[12px] font-bold"
            >
              <RiAddLine className="size-4" aria-hidden /> Add milestone
            </Button>
          </div>
        ) : null}
      </Panel>

      {/* Known gap (spec §1.9): the Project's own activity list needs a history
          endpoint Phase 1 does not build. The Opportunity's Timeline History
          is the record until then, and saying so beats a silent absence. */}
      <p className={`text-[11.5px] ${TONE.muted}`}>
        To see what happened,{" "}
        <Link href={`/sales/opportunities/${project.opportunity.id}?tab=timeline`} className="font-semibold text-[#17191C] underline">
          open the Opportunity&apos;s Timeline History tab
        </Link>
        .
      </p>

      <ConfirmDialog
        open={confirming}
        title="Complete this Project?"
        body={`${open} milestone${open === 1 ? " is" : "s are"} not ticked yet. Complete anyway?`}
        confirmLabel="Complete"
        pending={saveStatus.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => saveStatus.mutate()}
      />

      <ConfirmDeleteDialog
        open={removing !== null}
        what="this milestone"
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
      />

      {editing ? (
        <EditMilestone
          value={editing}
          pending={edit.isPending}
          error={milestoneError}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => edit.mutate()}
        />
      ) : null}
    </div>
  )
}

function EditMilestone({
  value,
  pending,
  error,
  onChange,
  onClose,
  onSave,
}: {
  value: { id: string; title: string; dueOn: string }
  pending: boolean
  error: string | null
  onChange: (v: { id: string; title: string; dueOn: string }) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-[#F7F9FB] p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Milestone" htmlFor="ms-edit-title">
          <Input id="ms-edit-title" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
        </Field>
        <Field label="Target date" htmlFor="ms-edit-due">
          <Input id="ms-edit-due" type="date" value={value.dueOn} onChange={(e) => onChange({ ...value, dueOn: e.target.value })} />
        </Field>
      </div>
      {error ? <FormError>{error}</FormError> : null}
      <div className="mt-2">
        <DialogActions
          pending={pending}
          disabled={!value.title.trim()}
          submitLabel="Save milestone"
          onCancel={onClose}
          onSubmit={onSave}
        />
      </div>
    </div>
  )
}
