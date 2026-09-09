"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import {
  RiAddLine,
  RiAlertLine,
  RiArrowRightUpLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiInboxLine,
  RiLockLine,
  RiPencilLine,
  RiRefreshLine,
} from "@remixicon/react"

import { DataTable } from "@/components/dashboard/data-table"
import type { TableCell } from "@/components/dashboard/types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"

/**
 * The kit for any surface that is a table of records plus the dialogs that
 * write to it.
 *
 * This was `settings/settings-shared.tsx`, built for the six reference-data
 * panels. It moved here when the employee directory became its second
 * consumer: the pieces below are the answer to "what does a list of records
 * look like while it is loading, empty, or broken", and that question is not
 * specific to settings. The `Panel*` names are kept from the original rather
 * than renamed, since six working call sites is not worth the churn.
 *
 * One palette for all of it. These are class strings rather than raw hexes so
 * Tailwind's scanner still sees the candidates. Every grey in here clears
 * WCAG AA against white at the sizes it is used at, which `#7A8698` (the
 * app's older secondary grey, 3.7:1) does not.
 */
export const TONE = {
  /** Secondary prose: panel descriptions, field hints, inactive rail items. */
  muted: "text-[#5F6B7C]",
  /** The hairline every settings surface is drawn with. */
  line: "border-[#E4E9EF]",
  /** Refusals from the server, and anything destructive. */
  danger: "text-[#B03A3A]",
  /** A write that already happened and had consequences elsewhere. */
  notice: "text-[#8A5E0C]",
} as const

/**
 * The server's message, verbatim, or a generic sentence for a transport
 * failure.
 *
 * The reference-data endpoints write their refusals to be read by a person:
 * "This department is still in use by 4 employees, 2 announcements and 1
 * asset. Reassign them first." Every count in them is information the client
 * does not have, so restating them here could only lose it.
 */
export function toMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again."
}

/* -------------------------------------------------------------------------- */
/* Frame                                                                       */
/* -------------------------------------------------------------------------- */

export function PanelFrame({
  title,
  sub,
  actionLabel,
  onAction,
  error,
  onDismissError,
  children,
}: {
  title: string
  sub: string
  actionLabel: string
  onAction: () => void
  error: string | null
  /** Omitted where the error is cleared by the next action anyway. */
  onDismissError?: () => void
  children: ReactNode
}) {
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-heading text-[16px] font-bold tracking-tight">{title}</h2>
          <p className={cn("mt-1 max-w-[64ch] text-[12.5px] leading-relaxed", TONE.muted)}>{sub}</p>
        </div>
        <Button
          onClick={onAction}
          className="h-auto shrink-0 rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
        >
          <RiAddLine className="size-4" aria-hidden />
          {actionLabel}
        </Button>
      </header>

      {error ? <PanelAlert onDismiss={onDismissError}>{error}</PanelAlert> : null}

      {children}
    </section>
  )
}

/** A refusal from the server. Always the API's own sentence. */
export function PanelAlert({
  children,
  onDismiss,
}: {
  children: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-md border border-[#F0D2D2] bg-[#FDF6F6] px-3.5 py-3 text-[12.5px] leading-relaxed font-semibold text-[#B03A3A]"
    >
      <RiErrorWarningLine className="mt-px size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss ? (
        <Button
          variant="link"
          onClick={onDismiss}
          className="h-auto shrink-0 p-0 text-[12px] font-bold text-[#B03A3A] underline"
        >
          Dismiss
        </Button>
      ) : null}
    </div>
  )
}

/**
 * A write that has already landed and changed something in another module.
 * Distinct from PanelAlert on purpose: nothing failed, and there is nothing to
 * retry, so it must not read as an error.
 */
export function PanelNotice({
  children,
  onDismiss,
}: {
  children: ReactNode
  /**
   * Optional, like PanelAlert's. Some notices restate live data rather than
   * reporting a one-off write: the attendance leave-conflict banner is
   * recomputed on every poll, so a dismiss button there would either lie or
   * undo itself a minute later.
   */
  onDismiss?: () => void
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#8A5E0C]">
      <RiAlertLine className="mt-px size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss ? (
        <Button
          variant="link"
          onClick={onDismiss}
          className="h-auto shrink-0 p-0 text-[12px] font-bold text-[#8A5E0C] underline"
        >
          Dismiss
        </Button>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Table with its four states                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The table plus the three states it is not.
 *
 * Every panel previously rendered a one-row table reading "Loading…" and
 * nothing at all for an empty or failed list, which made a dead endpoint and
 * an empty reference table look identical. Holding all four states in one
 * place is the only way six panels stay consistent about it.
 */
export function PanelTable({
  cols,
  headers,
  rows,
  isLoading,
  isError,
  onRetry,
  emptyTitle,
  emptyBody,
  emptyAction,
  emptyActionIcon,
  onEmptyAction,
}: {
  cols: string
  headers: string[]
  rows: TableCell[][]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  emptyTitle: string
  emptyBody: string
  /**
   * Omit where the viewer genuinely has nothing to do about it — a Sales User
   * looking at an empty shared directory they cannot add to. A button that
   * navigates to the page it is already on is worse than no button, and the
   * empty copy is what carries the explanation.
   */
  emptyAction?: string
  /**
   * Defaults to a plus, because on the settings panels empty always means
   * "nothing has been created yet". A filtered list is empty for a different
   * reason and its way out is not an add, so it supplies its own glyph.
   */
  emptyActionIcon?: ReactNode
  onEmptyAction: () => void
}) {
  if (isLoading) return <TableLoading cols={cols} headers={headers} />

  if (isError) {
    return (
      <PanelShell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          <div>
            <div className="text-[13.5px] font-bold">This list could not be loaded</div>
            <p className={cn("mt-1 text-[12.5px]", TONE.muted)}>
              Nothing has changed. Check the connection and try again.
            </p>
          </div>
          <Button
            onClick={onRetry}
            className="h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
          >
            <RiRefreshLine className="size-4" aria-hidden />
            Retry
          </Button>
        </div>
      </PanelShell>
    )
  }

  if (rows.length === 0) {
    return (
      <PanelShell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-md bg-[#F1F4F8] text-[#5F6B7C]">
            <RiInboxLine className="size-5" aria-hidden />
          </span>
          <div>
            <div className="text-[13.5px] font-bold">{emptyTitle}</div>
            <p className={cn("mt-1 max-w-[46ch] text-[12.5px] leading-relaxed", TONE.muted)}>
              {emptyBody}
            </p>
          </div>
          {emptyAction ? (
            <Button
              onClick={onEmptyAction}
              className="h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
            >
              {emptyActionIcon ?? <RiAddLine className="size-4" aria-hidden />}
              {emptyAction}
            </Button>
          ) : null}
        </div>
      </PanelShell>
    )
  }

  return <DataTable title="" action="" cols={cols} headers={headers} rows={rows} />
}

/** The bordered white surface every panel state is drawn on. */
function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
      {children}
    </div>
  )
}

/**
 * A skeleton shaped like the table it replaces, using the same grid template,
 * so the row height and column widths do not shift when the data lands.
 */
function TableLoading({ cols, headers }: { cols: string; headers: string[] }) {
  return (
    <PanelShell>
      <div className="hidden items-center gap-x-3.5 md:grid" style={{ gridTemplateColumns: cols }}>
        {headers.map((header, i) => (
          <div
            key={`${header}-${i}`}
            className="border-b border-[#E4E9EF] py-2.5 text-[11px] font-bold tracking-wide text-[#5F6B7C] uppercase"
          >
            {header}
          </div>
        ))}
        {[0, 1, 2, 3].map((row) =>
          headers.map((header, col) => (
            <div key={`${row}-${header}-${col}`} className="border-b border-[#EEF1F5] py-3">
              {col === headers.length - 1 ? null : (
                <Skeleton className={cn("h-3.5", col === 0 ? "w-2/3" : "w-1/2")} />
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2.5 md:hidden">
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-2 rounded-md border border-[#EEF1F5] p-3">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </PanelShell>
  )
}

/* -------------------------------------------------------------------------- */
/* Row actions                                                                 */
/* -------------------------------------------------------------------------- */

export type RowAction =
  | { kind: "edit"; label: string; onClick: () => void }
  | { kind: "delete"; label: string; onClick: () => void }
  /** Navigation to the record's own page. A real anchor, so it opens in a new
      tab on middle-click and shows its target in the status bar. */
  | { kind: "link"; label: string; href: string; icon?: ReactNode }
  /** An action other than edit or delete, with its own glyph. */
  | { kind: "custom"; label: string; icon: ReactNode; onClick: () => void }
  /** A row the server refuses to remove: the default shift, a statutory type. */
  | { kind: "locked"; label: string; hint: string }

/** The quiet-until-hover treatment every row action shares. */
const ROW_ACTION =
  "h-auto rounded-md px-2 py-1 text-[12px] font-semibold transition-colors text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"

/**
 * Actions were previously two underlined links per row, the second of them
 * permanently red. On a table where every row carries a delete, a red word on
 * every line is the loudest thing on the screen and the thing you least want
 * clicked. These stay quiet until the pointer is on them.
 */
export function RowActions({ actions }: { actions: RowAction[] }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      {actions.map((action) => {
        if (action.kind === "link") {
          return (
            <Link
              key={action.label}
              href={action.href}
              className={cn(ROW_ACTION, "inline-flex items-center gap-1")}
            >
              {action.icon ?? <RiArrowRightUpLine className="size-3.5" aria-hidden />}
              {action.label}
            </Link>
          )
        }

        if (action.kind === "custom") {
          return (
            <Button
              key={action.label}
              variant="ghost"
              onClick={action.onClick}
              className={ROW_ACTION}
            >
              {action.icon}
              {action.label}
            </Button>
          )
        }

        if (action.kind === "locked") {
          return (
            <span
              key={action.label}
              title={action.hint}
              className={cn(
                "inline-flex cursor-help items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold",
                TONE.muted
              )}
            >
              <RiLockLine className="size-3.5" aria-hidden />
              {action.label}
            </span>
          )
        }

        const isDelete = action.kind === "delete"
        return (
          <Button
            key={action.label}
            variant="ghost"
            onClick={action.onClick}
            className={cn(
              ROW_ACTION,
              isDelete && "hover:bg-[#FDF1F1] hover:text-[#B03A3A]"
            )}
          >
            {isDelete ? (
              <RiDeleteBinLine className="size-3.5" aria-hidden />
            ) : (
              <RiPencilLine className="size-3.5" aria-hidden />
            )}
            {action.label}
          </Button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Form pieces                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Label above the control, hint below it. The hint slot is where every "this
 * is fixed and here is why" sentence in these dialogs lives, so it is part of
 * the field rather than a paragraph that happens to follow one.
 */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-[12px] font-bold text-[#1C2733]">
        {label}
      </Label>
      {children}
      {hint ? (
        <p className={cn("text-[11.5px] leading-relaxed", TONE.muted)}>{hint}</p>
      ) : null}
    </div>
  )
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 rounded-md py-1 text-[12.5px] transition-colors",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  )
}

/** Inline, below the fields, above the footer. Never a toast: the dialog stays open. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 text-[12.5px] leading-relaxed font-semibold text-[#B03A3A]"
    >
      <RiErrorWarningLine className="mt-px size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/**
 * Cancel plus the primary action. These dialogs previously offered the primary
 * button alone, leaving Escape and the close glyph as the only way out of a
 * half-filled form.
 *
 * Both buttons are explicitly `type="button"`. A button inside a `<form>`
 * defaults to `type="submit"`, which would make Cancel submit the form and
 * would run the primary action twice: once from this `onClick`, once from the
 * form's own `onSubmit`. The settings panels do not use a `<form>` and are
 * unaffected either way; the employee directory does, for Enter-to-submit.
 */
export function DialogActions({
  pending,
  submitLabel,
  disabled,
  onCancel,
  onSubmit,
}: {
  pending: boolean
  submitLabel: string
  disabled: boolean
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={onCancel}
        disabled={pending}
        className="h-auto rounded-md px-3.5 py-2 text-[12.5px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
      >
        Cancel
      </Button>
      <Button
        type="button"
        disabled={pending || disabled}
        onClick={onSubmit}
        className="h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
      >
        {pending ? "Saving…" : submitLabel}
      </Button>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Delete                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A confirm for an action that is consequential but not a delete: withdrawing
 * a request, cancelling a run, releasing a hold. Kept separate from
 * ConfirmDeleteDialog because that one is red, says "cannot be undone", and
 * carries a bin glyph, none of which is true of an action the user could
 * simply do again.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={pending}>
            Keep it
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={onConfirm}
            className="bg-[#17191C] text-white hover:bg-[#0E1012]"
          >
            {pending ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Deleting reference data is irreversible: there is no soft delete and no
 * restore anywhere in the system. The server refuses a row that something
 * still references; it says nothing about a row nothing references yet, and
 * that is exactly the row a mis-aimed click destroys.
 */
export function ConfirmDeleteDialog({
  open,
  what,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean
  what: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <span className="mb-1 flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiDeleteBinLine className="size-5" aria-hidden />
          </span>
          <AlertDialogTitle>Delete {what}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. If anything still references it, the delete is refused and
            nothing changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={onConfirm}
            className="bg-[#B03A3A] text-white hover:bg-[#8F2F2F]"
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
