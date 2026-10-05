"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { setProjectTeam, updateProject } from "@/lib/api/sales/projects"
import { useSession } from "@/lib/auth/session-context"
import { useSalesPermissions } from "@/components/sales/shared/use-sales-permissions"
import { getSalesAccount } from "@/lib/api/sales/accounts"
import { useQuery } from "@tanstack/react-query"
import type { ProjectSummary } from "@/lib/api/types"
import { DialogActions, Field, FormError, PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { taka } from "@/components/sales/shared/sales-shared"
import { PRIORITY_LABEL } from "@/components/sales/projects/project-shared"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"

const PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const

interface Draft {
  name: string
  managerEmployeeId: string
  startOn: string
  dueOn: string
  priority: (typeof PRIORITIES)[number]
  budget: string
}

function draftOf(p: ProjectSummary): Draft {
  return {
    name: p.name,
    managerEmployeeId: p.manager.employeeId,
    startOn: p.startOn ?? "",
    dueOn: p.dueOn ?? "",
    priority: p.priority,
    budget: p.budget ?? "",
  }
}

function onDate(value: string | null): string {
  if (!value) return "Not set"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

/**
 * The Project's own details and money (spec §1.7). Read-only unless the viewer
 * can manage the Project, and only the fields that actually changed are sent,
 * so History records the change rather than the form.
 */
export function ProjectDetailsTab({ project, onSaved }: { project: ProjectSummary; onSaved: (p: ProjectSummary) => void }) {
  const { accessToken } = useSession()
  // A Sales Admin can switch editing a Project off for Sales Users. For looks
  // only: the server refuses it either way.
  const { can } = useSalesPermissions()
  const mayEdit = project.canManage && can("project.edit")
  const [draft, setDraft] = useState<Draft>(() => draftOf(project))
  const [error, setError] = useState<string | null>(null)
  const [editingTeam, setEditingTeam] = useState(false)

  // The Project Manager can only be somebody on the account: the account's
  // Owner plus its collaborators, exactly the pool the Team is drawn from.
  const accountQuery = useQuery({
    queryKey: ["sales", "accounts", project.salesAccount.id],
    queryFn: () => getSalesAccount(accessToken!, project.salesAccount.id),
    enabled: !!accessToken,
  })
  const people = accountQuery.data
    ? [
        { id: accountQuery.data.ownerEmployeeId, fullName: accountQuery.data.ownerName },
        ...accountQuery.data.assignees.filter((a) => a.id !== accountQuery.data!.ownerEmployeeId),
      ]
    : []

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {}
      const start = draftOf(project)
      if (draft.name.trim() !== start.name) body.name = draft.name.trim()
      if (draft.managerEmployeeId !== start.managerEmployeeId) body.managerEmployeeId = draft.managerEmployeeId
      if (draft.startOn !== start.startOn) body.startOn = draft.startOn || null
      if (draft.dueOn !== start.dueOn) body.dueOn = draft.dueOn || null
      if (draft.priority !== start.priority) body.priority = draft.priority
      const budget = draft.budget.trim()
      if (budget !== start.budget) body.budget = budget === "" ? null : budget
      return updateProject(accessToken!, project.id, body as never)
    },
    onSuccess: (p) => { setError(null); onSaved(p) },
    onError: (err) => setError(toMessage(err)),
  })

  const changed = draft.name.trim() !== project.name
    || draft.managerEmployeeId !== project.manager.employeeId
    || draft.startOn !== (project.startOn ?? "")
    || draft.dueOn !== (project.dueOn ?? "")
    || draft.priority !== project.priority
    || draft.budget.trim() !== (project.budget ?? "")

  return (
    <div className="grid gap-4">
      <Panel>
        <PanelHeading title="Plan" />
        {error ? <PanelAlert>{error}</PanelAlert> : null}

        {mayEdit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="prj-name">
              <Input id="prj-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Project Manager" htmlFor="prj-manager" help="The account's Owner or a collaborator.">
              <select
                id="prj-manager"
                value={draft.managerEmployeeId}
                onChange={(e) => setDraft({ ...draft, managerEmployeeId: e.target.value })}
                className="h-9 w-full rounded-md border border-[#E4E9EF] bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#17191C]/20"
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.fullName}</option>
                ))}
              </select>
            </Field>
            <Field label="Start date" htmlFor="prj-start">
              <Input id="prj-start" type="date" value={draft.startOn} onChange={(e) => setDraft({ ...draft, startOn: e.target.value })} />
            </Field>
            <Field label="Finish date" htmlFor="prj-due">
              <Input id="prj-due" type="date" value={draft.dueOn} onChange={(e) => setDraft({ ...draft, dueOn: e.target.value })} />
            </Field>
            <Field label="Priority" htmlFor="prj-priority">
              <select
                id="prj-priority"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value as Draft["priority"] })}
                className="h-9 w-full rounded-md border border-[#E4E9EF] bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#17191C]/20"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </Field>
            <Field label="Budget" htmlFor="prj-budget" help="Leave it empty for no budget. It is never read as zero.">
              <Input id="prj-budget" value={draft.budget} onChange={(e) => setDraft({ ...draft, budget: e.target.value })} placeholder="No budget" />
            </Field>
            <div className="sm:col-span-2">
              <Button
                type="button"
                disabled={!changed || save.isPending}
                onClick={() => save.mutate()}
                className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-3">
            <div><dt className={TONE.muted}>Name</dt><dd>{project.name}</dd></div>
            <div><dt className={TONE.muted}>Project Manager</dt><dd>{project.manager.fullName}</dd></div>
            <div><dt className={TONE.muted}>Start date</dt><dd>{onDate(project.startOn)}</dd></div>
            <div><dt className={TONE.muted}>Finish date</dt><dd>{onDate(project.dueOn)}</dd></div>
            <div><dt className={TONE.muted}>Priority</dt><dd>{PRIORITY_LABEL[project.priority]}</dd></div>
          </dl>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4">
          <div><dt className={TONE.muted}>Budget</dt><dd>{project.budget ? taka(project.budget) : "No budget"}</dd></div>
          <div><dt className={TONE.muted}>Value</dt><dd>{project.value ? taka(project.value) : "No value yet"}</dd></div>
          <div><dt className={TONE.muted}>Planned cost</dt><dd>{project.plannedCost ? taka(project.plannedCost) : "Not known"}</dd></div>
          {project.canSeeCost ? (
            <div><dt className={TONE.muted}>Spent so far</dt><dd>{project.spentSoFar ? taka(project.spentSoFar) : "Not known"}</dd></div>
          ) : null}
        </dl>
        <p className={`mt-1 text-[11.5px] ${TONE.muted}`}>
          Planned cost is each product&apos;s total price minus its margin. It shows &quot;Not known&quot; if a product has no
          price or no margin.
        </p>
      </Panel>

      <Panel>
        <PanelHeading
          title="Project Team"
          action={
            mayEdit ? (
              <Button type="button" variant="outline" onClick={() => setEditingTeam(true)} className="h-8 text-[12px] font-bold">
                Edit team
              </Button>
            ) : null
          }
        />
        {project.team.length === 0 ? (
          <p className={`text-[12.5px] ${TONE.muted}`}>No one is on the team yet.</p>
        ) : (
          <ul className="divide-y divide-[#E4E9EF]">
            {project.team.map((m) => (
              <li key={m.employeeId} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-[13px] font-semibold">{m.fullName}</span>
                {!m.onAccount ? (
                  <span className="text-[11.5px] font-semibold text-[#8A5E0C]">No longer on this account</span>
                ) : null}
                <span className={`text-[12px] ${TONE.muted}`}>{m.responsibility ?? "No responsibility noted"}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editingTeam ? (
        <TeamDialog project={project} people={people} onClose={() => setEditingTeam(false)} onSaved={(p) => { setEditingTeam(false); onSaved(p) }} />
      ) : null}
    </div>
  )
}

/**
 * The Team is picked only from the account's people, so nobody outside the
 * account can be added and the server's refusal is never reached from here.
 */
function TeamDialog({
  project,
  people,
  onClose,
  onSaved,
}: {
  project: ProjectSummary
  people: { id: string; fullName: string }[]
  onClose: () => void
  onSaved: (p: ProjectSummary) => void
}) {
  const { accessToken } = useSession()
  const [picked, setPicked] = useState<Record<string, { on: boolean; responsibility: string }>>(() => {
    const map: Record<string, { on: boolean; responsibility: string }> = {}
    for (const person of people) map[person.id] = { on: false, responsibility: "" }
    for (const m of project.team) map[m.employeeId] = { on: true, responsibility: m.responsibility ?? "" }
    return map
  })
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      setProjectTeam(
        accessToken!,
        project.id,
        people
          .filter((p) => picked[p.id]?.on)
          .map((p) => ({ employeeId: p.id, responsibility: picked[p.id].responsibility.trim() || null }))
      ),
    onSuccess: onSaved,
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit the Project Team</DialogTitle>
          <DialogDescription>
            {`Only the ${project.salesAccount.name} account's Owner and collaborators can be on the team.`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {people.length === 0 ? (
            <p className={`text-[12.5px] ${TONE.muted}`}>
              This account has no Owner or collaborators yet, so there is nobody to add. A Sales Admin can add them to the
              account first.
            </p>
          ) : null}
          {people.map((person) => (
            <div key={person.id} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2">
              <Checkbox
                id={`team-${person.id}`}
                checked={picked[person.id]?.on ?? false}
                onCheckedChange={(v) =>
                  setPicked((all) => ({ ...all, [person.id]: { on: v === true, responsibility: all[person.id]?.responsibility ?? "" } }))
                }
              />
              <label htmlFor={`team-${person.id}`} className="text-[13px] font-semibold">
                {person.fullName}
              </label>
              <Input
                aria-label={`${person.fullName}'s responsibility`}
                value={picked[person.id]?.responsibility ?? ""}
                onChange={(e) => setPicked((all) => ({ ...all, [person.id]: { on: all[person.id]?.on ?? false, responsibility: e.target.value } }))}
                placeholder="What are they doing?"
                disabled={!picked[person.id]?.on}
              />
            </div>
          ))}
          {error ? <FormError>{error}</FormError> : null}
        </div>
        <DialogFooter>
          <DialogActions
            pending={save.isPending}
            disabled={false}
            submitLabel="Save team"
            onCancel={onClose}
            onSubmit={() => save.mutate()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
