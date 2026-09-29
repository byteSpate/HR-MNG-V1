"use client"

import { useState, type ReactNode } from "react"
import type { RemixiconComponentType } from "@remixicon/react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export interface RecordTab<T extends string> {
  value: T
  label: string
  content: ReactNode
  /** A small picture before the label. Optional: a tab without one reads as before. */
  icon?: RemixiconComponentType
}

/** The tab named in `?tab=`, or the first tab when it is missing or unknown. */
export function pickTab<T extends string>(tabs: readonly { value: T }[], wanted: string | null): T {
  return tabs.find((t) => t.value === wanted)?.value ?? tabs[0].value
}

/**
 * Full-width tabs for one record's page (spec 2026-09-28 §1.3). The open tab
 * lives in `?tab=`, so a link, a refresh or Back opens the same tab, and a
 * link with no `?tab` still opens the first one. `replaceState`, not a
 * navigation: switching tabs must not refetch the page or add history steps.
 */
export function RecordTabs<T extends string>({ tabs, initialTab }: { tabs: RecordTab<T>[]; initialTab: string | null }) {
  const [tab, setTab] = useState<string | null>(initialTab)
  // A tab can disappear (Money only shows once Won). Fall back rather than show nothing.
  const current = pickTab(tabs, tab)

  const choose = (value: T) => {
    setTab(value)
    const url = new URL(window.location.href)
    if (value === tabs[0].value) url.searchParams.delete("tab")
    else url.searchParams.set("tab", value)
    window.history.replaceState(window.history.state, "", url)
  }

  return (
    <Tabs value={current} onValueChange={(v) => choose(v as T)} className="mt-4 gap-3">
      <TabsList variant="line" className="w-full justify-start overflow-y-hidden border-b border-[#E4E9EF] pb-0">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="gap-1.5 text-[12.5px] font-bold">
            {t.icon ? <t.icon className="size-3.5 shrink-0" aria-hidden /> : null}
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {/* A soft 200ms fade when a tab opens, so the switch is seen. It
              plays once per mount and is reduced to a plain fade for anyone
              who asks for less motion (globals.css). */}
          <div className="fade-in">{t.content}</div>
        </TabsContent>
      ))}
    </Tabs>
  )
}
