"use client"

/**
 * Where a team member writes their Daily Log line (owner, 2026-11-02). It used
 * to be written inside the Weekly Report, which is retired, so the line is
 * written here, on the Project's own Daily Log tab: one day, what they did, or
 * that they did no work on this Project that day.
 *
 * The server decides who may write: a Sales User on the Project's team, for
 * any day up to today. Anyone else gets its plain sentence back.
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { saveProjectLog } from "@/lib/api/sales/projects"
import { useSession } from "@/lib/auth/session-context"
import { projectLogBody } from "@/lib/project-log-payload"
import { PanelAlert, PanelNotice, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const todayInput = () => new Date().toLocaleDateString("en-CA")

export function ProjectLogForm({ projectId }: { projectId: string }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [day, setDay] = useState(todayInput())
  const [text, setText] = useState("")
  const [noWork, setNoWork] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: () => saveProjectLog(accessToken!, projectLogBody(day, projectId, { text, noWork })),
    onSuccess: () => {
      setSaved(true)
      setText("")
      // The grid above shows the line, and the Project's own numbers move too.
      void queryClient.invalidateQueries({ queryKey: ["sales", "projects"] })
    },
  })

  const canSave = day !== "" && day <= todayInput() && (noWork || text.trim().length > 0) && !save.isPending

  return (
    <form
      className="grid gap-2 rounded-md border border-[#E4E9EF] bg-white p-3 sm:p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSave) return
        setSaved(false)
        save.mutate()
      }}
    >
      <h3 className="font-heading text-[14px] font-bold tracking-tight">Write your line</h3>
      <p className="text-[12px] text-[#5F6B7C]">
        One line for one day: what you did on this Project. Only people on the Project team can write one.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={day}
          max={todayInput()}
          aria-label="Day"
          onChange={(e) => {
            setDay(e.target.value)
            setSaved(false)
          }}
          className="w-40 text-[12.5px]"
        />
        <Input
          value={text}
          maxLength={2000}
          disabled={noWork}
          aria-label="What you did on this Project"
          placeholder="What did you do on this Project?"
          onChange={(e) => {
            setText(e.target.value)
            setSaved(false)
          }}
          className="min-w-0 flex-1 basis-60 text-[12.5px]"
        />
        <label className="flex items-center gap-1.5 text-[12.5px]">
          <input
            type="checkbox"
            checked={noWork}
            onChange={(e) => {
              setNoWork(e.target.checked)
              setSaved(false)
            }}
            className="size-4 rounded border-[#C9D2DC]"
          />
          No work on this Project that day
        </label>
        <Button
          type="submit"
          disabled={!canSave}
          className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      {save.isError ? <PanelAlert>{toMessage(save.error)}</PanelAlert> : null}
      {saved ? <PanelNotice>Saved. Your line is in the table above.</PanelNotice> : null}
    </form>
  )
}
