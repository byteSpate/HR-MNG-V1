"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { removeProjectLog, saveProjectLog } from "@/lib/api/sales/weekly"
import { projectLogBody } from "@/lib/project-log-payload"
import { useSession } from "@/lib/auth/session-context"
import type { WeeklyDay } from "@/lib/api/types"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const OUTLINE = "h-9 shrink-0 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"

/**
 * The Daily Log rows of one day of the viewer's own week (spec §2.2).
 *
 * One line per Project in progress: what they did, or "No work on this
 * Project today". A day that is a holiday, a weekly off or leave gets a row
 * only where a line was already written, and it is read-only.
 *
 * A gap is an amber edge and a sentence, never a disabled Submit: a missing
 * line is something to notice, not a rule that blocks the week.
 */
export function ProjectLogRows({
  day,
  date,
  readOnly,
}: {
  day: Pick<WeeklyDay, "projects">
  date: string
  readOnly: boolean
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  // A saved line reads as plain text. The boxes come back only when the person
  // presses Edit, so Edit does something and a saved line is not shown twice.
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    // The week changes, and so does the Project's own numbers.
    await queryClient.invalidateQueries({ queryKey: ["sales", "weekly"] })
    await queryClient.invalidateQueries({ queryKey: ["sales", "projects"] })
  }

  const save = useMutation({
    mutationFn: ({ projectId, text, noWork }: { projectId: string; text: string; noWork: boolean }) =>
      saveProjectLog(accessToken!, projectLogBody(date, projectId, { text, noWork })),
    onSuccess: async (_data, vars) => {
      setError(null)
      setEditing((e) => ({ ...e, [vars.projectId]: false }))
      await refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => removeProjectLog(accessToken!, id),
    onSuccess: async () => { setError(null); await refresh() },
    onError: (err) => setError(toMessage(err)),
  })

  if (day.projects.length === 0) return null

  return (
    <div className="rounded-md border border-dashed border-[#E4E9EF] px-3 py-2">
      <span className={`text-[11.5px] font-bold uppercase tracking-wide ${TONE.muted}`}>
        Project work
      </span>

      {error ? <PanelAlert>{error}</PanelAlert> : null}

      <ul className="mt-1.5 grid gap-2">
        {day.projects.map((project) => {
          const saved = project.logId !== null
          const draft = drafts[project.projectId] ?? project.text ?? ""
          const noWork = ticks[project.projectId] ?? project.noWork
          const canSave = !readOnly && (noWork || draft.trim().length > 0)

          return (
            <li
              key={project.projectId}
              className={`pl-2 ${project.missing ? "border-l-2 border-[#E5A93D]" : "border-l-2 border-transparent"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold">
                  {project.serial} {project.name}
                </span>
                {project.missing && !saved ? (
                  <span className="text-[11.5px] font-semibold text-[#8A5E0C]">
                    No Daily Log for this day
                  </span>
                ) : null}
              </div>

              {saved ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-[12px]">
                    {project.noWork ? <span className={TONE.muted}>No work</span> : project.text}
                  </span>
                  {readOnly || editing[project.projectId] ? null : (
                    <>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-[11.5px] font-bold underline"
                        onClick={() => {
                          setEditing((e) => ({ ...e, [project.projectId]: true }))
                          setDrafts((d) => ({ ...d, [project.projectId]: project.text ?? "" }))
                          setTicks((t) => ({ ...t, [project.projectId]: project.noWork }))
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-[11.5px] font-bold text-[#5F6B7C] underline"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(project.logId!)}
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              ) : null}

              {readOnly || (saved && !editing[project.projectId]) ? null : (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`What did you do on ${project.name}?`}
                    placeholder="What did you do on this Project?"
                    value={draft}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [project.projectId]: e.target.value }))
                    }
                    className="min-w-[12rem] flex-1"
                  />
                  <label className="flex items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox"
                      checked={noWork}
                      onChange={(e) =>
                        setTicks((t) => ({ ...t, [project.projectId]: e.target.checked }))
                      }
                    />
                    No work on this Project today
                  </label>
                  <Button
                    type="button"
                    className={OUTLINE}
                    disabled={!canSave || save.isPending}
                    onClick={() =>
                      save.mutate({
                        projectId: project.projectId,
                        text: draft,
                        noWork,
                      })
                    }
                  >
                    Save
                  </Button>
                  {saved && editing[project.projectId] ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-[11.5px] font-bold text-[#5F6B7C] underline"
                      onClick={() => {
                        setEditing((e) => ({ ...e, [project.projectId]: false }))
                        setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== project.projectId)))
                        setTicks((t) => Object.fromEntries(Object.entries(t).filter(([id]) => id !== project.projectId)))
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
