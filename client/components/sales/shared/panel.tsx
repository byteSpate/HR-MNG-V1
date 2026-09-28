"use client"

import { RiErrorWarningLine, RiRefreshLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The white bordered card every panel on a record page is drawn on. One
 * component for the Account and Opportunity pages, because both were drawing
 * the same surface twice and had already started to drift.
 */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={
        className ??
        "rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5"
      }
    >
      {children}
    </div>
  )
}

export function PanelHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-[13.5px] font-bold">{title}</div>
      {action}
    </div>
  )
}

export function PanelSkeleton() {
  return (
    <Panel>
      <Skeleton className="h-4 w-24" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </Panel>
  )
}

export function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel>
      <div className="flex flex-col items-center gap-2.5 py-6 text-center">
        <span className="flex size-8 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
          <RiErrorWarningLine className="size-4" aria-hidden />
        </span>
        <div className="text-[12.5px] font-semibold text-[#5F6B7C]">This could not be loaded</div>
        <Button
          onClick={onRetry}
          className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
        >
          <RiRefreshLine className="size-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    </Panel>
  )
}
