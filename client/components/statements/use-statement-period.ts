"use client"

import { useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"

import { listFinancialYears } from "@/lib/api/accounting"
import { useSession } from "@/lib/auth/session-context"
import { presetRange, type Preset, type Range } from "@/components/statements/statements-shared"

/**
 * The period every statement page reads: Income statement, Balance sheet,
 * Changes in equity and Notes.
 *
 * These were tabs on one page, sharing one period. They are separate pages
 * now, so the choice lives here, outside any one page, and survives moving
 * between them. Someone who picks "Q2" on the Income statement and opens the
 * Balance sheet sees Q2 there too. It is memory only: a reload starts again
 * at the latest year.
 */
interface PeriodChoice {
  financialYearId: string
  preset: Preset
  index: number
  customRange: Range
}

let choice: PeriodChoice = {
  financialYearId: "",
  preset: "YEAR",
  index: 0,
  customRange: { from: "", to: "" },
}
const listeners = new Set<() => void>()

function setChoice(next: Partial<PeriodChoice>) {
  choice = { ...choice, ...next }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = () => choice

export function useStatementPeriod() {
  const { accessToken } = useSession()
  const current = useSyncExternalStore(subscribe, read, read)

  const years = useQuery({
    queryKey: ["accounting", "financial-years"],
    queryFn: () => listFinancialYears(accessToken!),
    enabled: Boolean(accessToken),
  })

  // Default to the most recent year, the one someone opening a statement
  // almost always wants. Derived, so there is no effect to sync.
  const latestId = years.data?.length
    ? [...years.data].sort((a, b) => b.startDate.localeCompare(a.startDate))[0].id
    : ""
  const financialYearId = current.financialYearId || latestId
  const fy = years.data?.find((y) => y.id === financialYearId)

  // The preset drives the range, except in CUSTOM where the user does.
  const range: Range =
    current.preset === "CUSTOM"
      ? current.customRange
      : fy
        ? presetRange(current.preset, fy, current.index)
        : { from: "", to: "" }

  return {
    accessToken,
    range,
    ready: Boolean(accessToken && range.from && range.to),
    /** Spread onto <PeriodControl>, adding only `comparativeLabel`. */
    control: {
      years: years.data ?? [],
      financialYearId,
      onFinancialYearChange: (id: string) => setChoice({ financialYearId: id }),
      preset: current.preset,
      onPresetChange: (preset: Preset) => setChoice({ preset, index: 0 }),
      index: current.index,
      onIndexChange: (index: number) => setChoice({ index }),
      range,
      onRangeChange: (customRange: Range) => setChoice({ customRange }),
    },
  }
}

/**
 * "/finance/accounting", "/admin/accounting": the base for links into the
 * ledger and the trial balance. The statement pages live under
 * /<role>/statements/, so a relative "./ledger" would land on a page that
 * does not exist.
 */
export function useAccountingBase(): string {
  const pathname = usePathname()
  const role = pathname.split("/").filter(Boolean)[0] ?? "finance"
  return `/${role}/accounting`
}
