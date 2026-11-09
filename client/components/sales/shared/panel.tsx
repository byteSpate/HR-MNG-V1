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
        "rounded-md border border-line bg-white px-4 py-4 sm:px-5.5 sm:py-5"
      }
    >
      {children}
    </div>
  )
}

export function PanelHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-body-sm font-bold">{title}</div>
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
        <span className="flex size-8 items-center justify-center rounded-md bg-danger-tint text-danger">
          <RiErrorWarningLine className="size-4" aria-hidden />
        </span>
        <div className="text-caption font-semibold text-ink-muted">This could not be loaded</div>
        <Button
          onClick={onRetry}
          className="h-auto rounded-md bg-ink px-3 py-1.5 text-caption font-bold text-white hover:bg-ink-strong"
        >
          <RiRefreshLine className="size-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    </Panel>
  )
}

/**
 * A small inline answer for a dropdown or list inside a form whose data did not
 * load. It names the problem and offers the way out, so the form never shows a
 * picker with nothing in it as if nothing existed (loading, empty and broken
 * are three different screens).
 */
export function RetryNote({ children, onRetry }: { children: React.ReactNode; onRetry: () => void }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption font-semibold text-danger">
      <span>{children}</span>
      <button
        type="button"
        onClick={onRetry}
        className="font-bold underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none"
      >
        Try again
      </button>
    </p>
  )
}
