"use client"

/**
 * One editable cell of the funnel grid (revision §27.7).
 *
 * Click it, type, and it saves when you click away. A cell that is saving
 * stays readable and stays put — swapping it for a spinner moves every column
 * beside it, and a fifteen-column grid that jumps while you work down it is
 * worse than one that waits.
 */

import { useEffect, useRef, useState } from "react"

import { TONE, toMessage } from "@/components/dashboard/record-kit"
import { cn } from "@/lib/utils"

interface FunnelCellProps {
  value: string | null
  /** What the cell shows when it is not being edited. Defaults to `value`. */
  display?: string
  /** False for a viewer who may read the row but not change it. */
  editable: boolean
  onSave: (next: string | null) => Promise<void>
  type?: "text" | "date" | "money"
  placeholder?: string
  align?: "left" | "right"
  className?: string
}

export function FunnelCell({
  value,
  display,
  editable,
  onSave,
  type = "text",
  placeholder,
  align = "left",
  className,
}: FunnelCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * The server is the source of truth: when the row is refetched, a cell that
   * is not being edited takes the new value.
   *
   * Adjusted during render rather than in an effect — React's own pattern for
   * state that follows a prop. An effect here would render once with the stale
   * value and then again with the new one, and the linter rightly refuses it.
   *
   * Guarding on `editing` is the load-bearing half: without it, a background
   * refetch would wipe out what somebody is halfway through typing.
   */
  const [syncedTo, setSyncedTo] = useState(value)
  if (!editing && value !== syncedTo) {
    setSyncedTo(value)
    setDraft(value ?? "")
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const shown = display ?? value ?? ""

  async function commit(next: string | null) {
    setEditing(false)
    if (next === value) return

    setSaving(true)
    setError(null)
    try {
      await onSave(next)
    } catch (err) {
      // The cell goes back to what the server still holds, and says why.
      // Leaving the typed value on screen would show a figure that is not
      // stored anywhere.
      setDraft(value ?? "")
      setError(toMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!editable) {
    return (
      <span className={cn("block truncate", align === "right" && "text-right", className)}>
        {shown || <span className={TONE.muted}>—</span>}
      </span>
    )
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type === "date" ? "date" : "text"}
        inputMode={type === "money" ? "decimal" : undefined}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit(draft.trim() === "" ? null : draft.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            void commit(draft.trim() === "" ? null : draft.trim())
          }
          // Escape abandons the edit and restores what the server holds.
          if (e.key === "Escape") {
            setDraft(value ?? "")
            setEditing(false)
          }
        }}
        className={cn(
          "w-full rounded-sm border border-[#2D6CB5] bg-white px-1.5 py-0.5 text-sm outline-none",
          align === "right" && "text-right",
          className
        )}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={error ?? (shown || placeholder)}
      className={cn(
        "block w-full truncate rounded-sm px-1.5 py-0.5 text-left text-sm",
        "hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#2D6CB5]",
        align === "right" && "text-right",
        saving && "opacity-60",
        error && "ring-1 ring-red-400",
        className
      )}
    >
      {shown || <span className={TONE.muted}>{placeholder ?? "—"}</span>}
    </button>
  )
}
