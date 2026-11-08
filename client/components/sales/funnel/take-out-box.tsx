"use client"

/**
 * The box an admin writes a take-out in (owner, 2026-11-02): a short line for
 * one person, optionally about one Opportunity. It shows who wrote it and the
 * day, wherever it appears afterwards. Left without a day, it is due the next
 * Saturday, so it is there for the next review.
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { createTakeOut } from "@/lib/api/sales/funnel"
import { funnelWriteKeys } from "@/lib/api/sales/funnel-keys"
import { useSession } from "@/lib/auth/session-context"
import { PanelAlert, PanelNotice, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function TakeOutBox({
  employeeId,
  employeeName,
  opportunityId,
}: {
  employeeId: string
  employeeName: string
  /** Set when written on a funnel row: the take-out is about that Opportunity. */
  opportunityId?: string
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState("")
  const [dueOn, setDueOn] = useState("")
  const [given, setGiven] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      createTakeOut(
        {
          assignedToEmployeeId: employeeId,
          title: title.trim(),
          ...(dueOn ? { dueOn } : {}),
          ...(opportunityId ? { opportunityId } : {}),
        },
        accessToken!
      ),
    onSuccess: () => {
      setTitle("")
      setDueOn("")
      setGiven(true)
      // The week, the grid and the person's tasks all show it, so refresh them together.
      for (const key of funnelWriteKeys) void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ["sales", "tasks"] })
    },
  })

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (title.trim().length < 1 || save.isPending) return
        setGiven(false)
        save.mutate()
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value)
            setGiven(false)
          }}
          aria-label={`Take-out for ${employeeName}`}
          placeholder={`A take-out for ${employeeName}`}
          className="min-w-0 flex-1 basis-60 text-caption"
        />
        <Input
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
          aria-label="Due day, or leave empty for next Saturday"
          title="Due day. Left empty, it is due next Saturday."
          className="w-40 text-caption"
        />
        <Button
          type="submit"
          disabled={title.trim().length < 1 || save.isPending}
          className="h-auto rounded-md bg-ink px-3 py-1.5 text-caption font-bold text-white hover:bg-ink-strong"
        >
          {save.isPending ? "Saving…" : "Give take-out"}
        </Button>
      </div>
      {save.isError ? <PanelAlert>{toMessage(save.error)}</PanelAlert> : null}
      {given ? <PanelNotice>Take-out given to {employeeName}. It shows who wrote it and the day it was written.</PanelNotice> : null}
    </form>
  )
}
