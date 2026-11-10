"use client"

/**
 * Preview log on the Logs tab (owner, 2026-11-10). The team used to write their
 * day by hand and show management a screenshot. This shows the day (or the
 * week) as one picture made by the server, and Download saves that same
 * picture, so what is seen is exactly what is sent.
 *
 * Always the person's own log. The owner asked for no admin view here.
 */

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiDownloadLine } from "@remixicon/react"

import { getDayLogImage } from "@/lib/api/sales/tasks"
import { useSession } from "@/lib/auth/session-context"
import { PanelAlert, toMessage } from "@/components/dashboard/record-kit"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { AppDialog } from "@/components/ds/app-dialog"
import { Img } from "@/components/ds/img"
import { Text } from "@/components/ds/text"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { dayChoices, WHOLE_WEEK } from "@/components/sales/tasks/logs-days"

export function DayLogPreview({
  open,
  onOpenChange,
  weekStart,
  today,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekStart: string
  /** YYYY-MM-DD, so the preview opens on today when today is in the week shown. */
  today: string
}) {
  const { accessToken } = useSession()
  const choices = dayChoices(weekStart)
  const [picked, setPicked] = useState<string | null>(null)
  // Today when it is one of the days on offer, otherwise the whole week.
  const value = picked ?? (choices.some((c) => c.value === today) ? today : WHOLE_WEEK)
  const range = choices.find((c) => c.value === value)?.range ?? choices[0].range

  const image = useQuery({
    queryKey: ["sales", "day-log-image", range.from, range.to],
    queryFn: () => getDayLogImage(accessToken!, range),
    enabled: open && Boolean(accessToken),
    // Always fresh: one more task marked done must show on the next preview.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  // A link to the picture in memory, let go when the picture changes or the dialog closes.
  const url = useMemo(() => (image.data ? URL.createObjectURL(image.data) : null), [image.data])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  const fileName = range.from === range.to ? `work-log-${range.from}.png` : `work-log-${range.from}-to-${range.to}.png`

  const close = (next: boolean) => {
    if (!next) setPicked(null)
    onOpenChange(next)
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={close}
      size="lg"
      title="Preview log"
      description="Your finished tasks, the meetings you went to, and the Opportunities you closed. Download saves this picture so you can send it."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Close
          </Button>
          <Button type="button" disabled={!image.data} onClick={() => image.data && downloadBlob(image.data, fileName)}>
            <RiDownloadLine className="size-4" aria-hidden />
            Download picture
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select value={value} onValueChange={(v) => v && setPicked(v)}>
          <SelectTrigger aria-label="Which day" className="h-9 w-full sm:w-64">
            <SelectValue>{(v: string | null) => choices.find((c) => c.value === v)?.label ?? "Choose a day"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {image.isError ? (
          <div className="grid gap-2">
            <PanelAlert>{toMessage(image.error)}</PanelAlert>
            <div>
              <Button type="button" variant="outline" onClick={() => image.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : image.isPending || !url ? (
          <div className="space-y-2">
            <Skeleton className="h-96 w-full" />
            <Text variant="muted">Making the picture. This takes a few seconds.</Text>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-line">
            <Img src={url} alt={`Work log, ${choices.find((c) => c.value === value)?.label ?? ""}`} width={820} height={1200} className="h-auto w-full" />
          </div>
        )}
      </div>
    </AppDialog>
  )
}
