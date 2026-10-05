"use client"

import { useCallback, useRef } from "react"
import { RiAddLine, RiDeleteBinLine } from "@remixicon/react"

import { sides } from "@/lib/accounting/side-style"
import type { Account } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AccountPicker } from "@/components/accounting/account-picker"
import { fromPaisa, sumPaisa, toPaisa } from "@/components/accounting/accounting-shared"
import { cn } from "@/lib/utils"

export interface DraftLine {
  /** Stable across reorders and deletes, so React never reuses a row's DOM. */
  key: string
  accountId: string | null
  debit: string
  credit: string
  narration: string
}

export function emptyLine(): DraftLine {
  return { key: crypto.randomUUID(), accountId: null, debit: "", credit: "", narration: "" }
}

/** Two blank rows, because the smallest possible journal has two legs. */
export function initialLines(): DraftLine[] {
  return [emptyLine(), emptyLine()]
}

export interface BalanceState {
  debitPaisa: number
  creditPaisa: number
  differencePaisa: number
  isBalanced: boolean
  hasInvalidAmount: boolean
}

export function computeBalance(lines: DraftLine[]): BalanceState {
  const debitPaisa = sumPaisa(lines.map((l) => l.debit))
  const creditPaisa = sumPaisa(lines.map((l) => l.credit))
  const hasInvalidAmount = Number.isNaN(debitPaisa) || Number.isNaN(creditPaisa)
  const differencePaisa = hasInvalidAmount ? 0 : debitPaisa - creditPaisa

  return {
    debitPaisa,
    creditPaisa,
    differencePaisa,
    isBalanced: !hasInvalidAmount && differencePaisa === 0 && debitPaisa > 0,
    hasInvalidAmount,
  }
}

/**
 * Whether the set of lines is submittable, and why not if it isn't. The
 * message is shown beside the disabled button — a disabled control with no
 * explanation is the single most common way a form wastes someone's time.
 */
export function validationMessage(lines: DraftLine[]): string | null {
  // Carrying `row` through the filter, because the row number in the message
  // has to be the one on screen. Numbering the filtered subset instead points
  // "Line 1" at the second row whenever the first is still blank.
  const filled = lines
    .map((line, index) => ({ line, row: index + 1 }))
    .filter(({ line }) => line.accountId || line.debit || line.credit)

  if (filled.length < 2) return "A journal needs at least two lines"
  if (filled.some(({ line }) => !line.accountId)) return "Every line needs an account"

  for (const { line, row } of filled) {
    const d = toPaisa(line.debit)
    const c = toPaisa(line.credit)
    if (Number.isNaN(d) || Number.isNaN(c)) return `Line ${row}: that is not an amount`
    if (d > 0 && c > 0) return `Line ${row}: enter a debit or a credit, not both`
    if (d === 0 && c === 0) return `Line ${row}: enter an amount`
  }

  const balance = computeBalance(filled.map(({ line }) => line))
  if (balance.debitPaisa === 0) return "A journal total must be greater than zero"
  if (!balance.isBalanced) {
    return `Out by ${fromPaisa(Math.abs(balance.differencePaisa))}`
  }
  return null
}

export function JournalLinesEditor({
  lines,
  onChange,
  accounts,
  disabled,
}: {
  lines: DraftLine[]
  onChange: (lines: DraftLine[]) => void
  accounts: Account[]
  disabled?: boolean
}) {
  // Focus moves to the amount field of a row added by Enter, so the flow is
  // Enter → type → Tab without ever reaching for the mouse.
  const debitRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const patch = useCallback(
    (key: string, changes: Partial<DraftLine>) => {
      onChange(lines.map((l) => (l.key === key ? { ...l, ...changes } : l)))
    },
    [lines, onChange]
  )

  const addAfter = useCallback(
    (key: string) => {
      const next = emptyLine()
      const index = lines.findIndex((l) => l.key === key)
      onChange([...lines.slice(0, index + 1), next, ...lines.slice(index + 1)])
      // The row does not exist in the DOM until after paint.
      requestAnimationFrame(() => debitRefs.current[next.key]?.focus())
    },
    [lines, onChange]
  )

  const remove = useCallback(
    (key: string) => {
      // Never below two rows; clear the last two rather than delete them, so
      // the grid does not collapse into something you cannot type into.
      if (lines.length <= 2) {
        onChange(lines.map((l) => (l.key === key ? { ...emptyLine(), key: l.key } : l)))
        return
      }
      onChange(lines.filter((l) => l.key !== key))
    },
    [lines, onChange]
  )

  const balance = computeBalance(lines)

  /** Typing in one column clears the other — a line has one side, not two. */
  const setAmount = (key: string, column: "debit" | "credit", raw: string) => {
    const value = raw.replace(/[^\d.]/g, "")
    patch(key, column === "debit" ? { debit: value, credit: "" } : { credit: value, debit: "" })
  }

  return (
    <div className="rounded-lg border">
      <div className="grid grid-cols-[1fr_1fr_160px_160px_40px] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>Account</span>
        <span>Line note</span>
        <span className={cn("text-right", sides.sideText("debit"))}>Debit</span>
        <span className={cn("text-right", sides.sideText("credit"))}>Credit</span>
        <span />
      </div>

      {lines.map((line, index) => (
        <div
          key={line.key}
          className="grid grid-cols-[1fr_1fr_160px_160px_40px] items-center gap-2 border-b px-3 py-1.5 last:border-0"
        >
          <AccountPicker
            accounts={accounts}
            value={line.accountId}
            onChange={(accountId) => patch(line.key, { accountId })}
            disabled={disabled}
          />

          <Input
            value={line.narration}
            onChange={(e) => patch(line.key, { narration: e.target.value })}
            placeholder="Optional"
            disabled={disabled}
            className="h-9"
          />

          <Input
            ref={(el) => {
              debitRefs.current[line.key] = el
            }}
            value={line.debit}
            onChange={(e) => setAmount(line.key, "debit", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addAfter(line.key)
              }
            }}
            inputMode="decimal"
            placeholder="0.00"
            disabled={disabled}
            aria-label={`Debit, line ${index + 1}`}
            className={cn(
              "h-9 text-right tabular-nums",
              Number.isNaN(toPaisa(line.debit)) && "border-destructive"
            )}
          />

          <Input
            value={line.credit}
            onChange={(e) => setAmount(line.key, "credit", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addAfter(line.key)
              }
            }}
            inputMode="decimal"
            placeholder="0.00"
            disabled={disabled}
            aria-label={`Credit, line ${index + 1}`}
            className={cn(
              "h-9 text-right tabular-nums",
              Number.isNaN(toPaisa(line.credit)) && "border-destructive"
            )}
          />

          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => remove(line.key)}
            disabled={disabled}
            aria-label={`Remove line ${index + 1}`}
          >
            <RiDeleteBinLine className="size-4" />
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-2 border-t px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => addAfter(lines[lines.length - 1].key)}
          disabled={disabled}
        >
          <RiAddLine className="size-4" /> Add line
        </Button>
        <span className="text-xs text-muted-foreground">or press Enter in an amount</span>
      </div>

      {/*
        The balance footer. Persistent, live, and the reason this screen
        works: the rule that decides whether the entry can be submitted is
        visible while you type rather than delivered as an error after you
        submit.
      */}
      <div
        className={cn(
          "grid grid-cols-[1fr_1fr_160px_160px_40px] items-center gap-2 border-t px-3 py-2.5 text-sm font-medium tabular-nums",
          balance.isBalanced ? "bg-muted/40" : "bg-destructive/5"
        )}
      >
        <span className="col-span-2 text-muted-foreground">
          {balance.hasInvalidAmount ? (
            <span className="text-destructive">Check the highlighted amounts</span>
          ) : balance.isBalanced ? (
            "Balanced"
          ) : (
            <span className="text-destructive">
              Out by {fromPaisa(Math.abs(balance.differencePaisa))}
            </span>
          )}
        </span>
        <span className="text-right">{fromPaisa(balance.debitPaisa || 0)}</span>
        <span className="text-right">{fromPaisa(balance.creditPaisa || 0)}</span>
        <span />
      </div>
    </div>
  )
}
