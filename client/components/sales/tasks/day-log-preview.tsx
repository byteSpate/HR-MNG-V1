"use client"

/**
 * Preview log on the Logs tab (owner, 2026-11-10). The team used to write their
 * day by hand and show management a screenshot. This shows the day (or the
 * week) as pictures made by the server, and Download saves those same
 * pictures, so what is seen is exactly what is sent.
 *
 * A long log is split into several pictures of up to 8 entries each (owner,
 * same day), so each one stays readable on a phone.
 *
 * Always the person's own log. The owner asked for no admin view here.
 */

import { useEffect, useMemo, useState } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { RiDownloadLine } from "@remixicon/react"

import { getDayLogCount, getDayLogImage } from "@/lib/api/sales/tasks"
import { useSession } from "@/lib/auth/session-context"
import { PanelAlert, toMessage } from "@/components/dashboard/record-kit"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { AppDialog } from "@/components/ds/app-dialog"
import { Heading } from "@/components/ds/heading"
import { Img } from "@/components/ds/img"
import { Text } from "@/components/ds/text"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { dayChoices, WHOLE_WEEK } from "@/components/sales/tasks/logs-days"

/** Browsers block a burst of downloads, so they go one after another. */
const DOWNLOAD_GAP_MS = 400

function Picture({ blob, label }: { blob: Blob; label: string }) {
  // A link to the picture in memory, let go when the picture changes or closes.
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <Img src={url} alt={label} width={820} height={1200} className="h-auto w-full" />
}

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
  const choice = choices.find((c) => c.value === value) ?? choices[0]
  const range = choice.range

  // Always fresh: one more task marked done must show on the next preview.
  const fresh = { staleTime: 0, gcTime: 0, retry: false } as const

  const count = useQuery({
    queryKey: ["sales", "day-log-count", range.from, range.to],
    queryFn: () => getDayLogCount(accessToken!, range),
    enabled: open && Boolean(accessToken),
    ...fresh,
  })
  const total = count.data?.pictures ?? 0

  const images = useQueries({
    queries: Array.from({ length: total }, (_, i) => ({
      queryKey: ["sales", "day-log-image", range.from, range.to, i + 1],
      queryFn: () => getDayLogImage(accessToken!, range, i + 1),
      enabled: open && Boolean(accessToken),
      ...fresh,
    })),
  })

  const failed = count.error ?? images.find((q) => q.isError)?.error
  const ready = total > 0 && images.every((q) => q.data)

  const base = range.from === range.to ? `work-log-${range.from}` : `work-log-${range.from}-to-${range.to}`
  const fileName = (i: number) => (total > 1 ? `${base}-${i + 1}-of-${total}.png` : `${base}.png`)

  const [downloading, setDownloading] = useState(false)
  const downloadAll = async () => {
    setDownloading(true)
    try {
      for (const [i, q] of images.entries()) {
        if (!q.data) continue
        downloadBlob(q.data, fileName(i))
        if (i < images.length - 1) await new Promise((r) => setTimeout(r, DOWNLOAD_GAP_MS))
      }
    } finally {
      setDownloading(false)
    }
  }

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
      description="Your finished tasks, the meetings you went to, and the Opportunities you closed. A long log is split into several pictures. Download saves them so you can send them."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Close
          </Button>
          <Button type="button" disabled={!ready || downloading} onClick={downloadAll}>
            <RiDownloadLine className="size-4" aria-hidden />
            {total > 1 ? `Download all ${total} pictures` : "Download picture"}
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

        {failed ? (
          <div className="grid gap-2">
            <PanelAlert>{toMessage(failed)}</PanelAlert>
            <div>
              <Button type="button" variant="outline" onClick={() => count.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : count.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div className="space-y-4">
            {total > 1 ? <Text variant="muted">This log is long, so it is in {total} pictures.</Text> : null}
            {images.map((q, i) => (
              <figure key={i} className="space-y-2">
                {total > 1 ? (
                  <figcaption className="flex items-center justify-between gap-2">
                    <Heading level="card">
                      Picture {i + 1} of {total}
                    </Heading>
                    <Button type="button" variant="outline" size="sm" disabled={!q.data} onClick={() => q.data && downloadBlob(q.data, fileName(i))}>
                      <RiDownloadLine className="size-4" aria-hidden />
                      Download
                    </Button>
                  </figcaption>
                ) : null}
                {q.data ? (
                  <div className="overflow-hidden rounded-md border border-line">
                    <Picture blob={q.data} label={`Work log, ${choice.label}, picture ${i + 1} of ${total}`} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Skeleton className="h-96 w-full" />
                    <Text variant="muted">Making the picture. This takes a few seconds.</Text>
                  </div>
                )}
              </figure>
            ))}
          </div>
        )}
      </div>
    </AppDialog>
  )
}
