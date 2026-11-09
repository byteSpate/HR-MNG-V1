"use client"

import type { ReactNode } from "react"
import { RiCloseLine, RiSearchLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

/**
 * Search and filters for a list of records.
 *
 * Every list page in this app renders its whole result set at once. That is
 * fine for the endpoints as written, since each returns the full set in one
 * response, but it means the only way to find one row among two hundred is to
 * read all two hundred. Filtering happens here, on data already in memory: no
 * request, no debounce, no loading state to design around.
 *
 * The count is not decoration. Once a filter is on, the difference between
 * "nobody matches" and "the list failed to load" is the only thing the reader
 * needs, and a bare empty table says neither.
 */
export function FilterBar({
  search,
  onSearch,
  placeholder,
  children,
  shown,
  total,
  noun,
  active,
  onClear,
}: {
  search: string
  onSearch: (next: string) => void
  placeholder: string
  /** The `FilterSelect`s for this page, in the order they should read. */
  children?: ReactNode
  shown: number
  total: number
  /** Plural, lowercase: "employees", "assets". */
  noun: string
  /** Whether anything is filtering right now, search included. */
  active: boolean
  onClear: () => void
}) {
  return (
    // One row, not two. The count used to sit on its own line underneath,
    // which put a small grey string alone on the page background between the
    // controls and the table, touching neither. Here it reads as part of the
    // toolbar that produces it, and it fills space that was empty anyway.
    <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:max-w-75">
        {/* `z-10` for the same reason as the login fields: the input paints
            its own background over anything positioned earlier in the DOM. */}
        <RiSearchLine
          className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 w-full rounded-md border-line pl-9 text-body-sm placeholder:text-ink-muted"
        />
      </div>

      {children}

      {/* `ml-auto` only from sm up. Below that the toolbar is a column, and
          pushing this to the right would strand it opposite nothing. */}
      <div className="flex items-center gap-x-2 text-caption text-ink-muted sm:ml-auto">
        {/* Announced on change, so a filter that removes every row is not a
            silent event for anyone reading by ear. */}
        <span aria-live="polite">
          <span className="font-semibold text-ink-body">{active ? shown : total}</span>
          {active ? ` of ${total} ${noun}` : ` ${noun}`}
        </span>
        {active ? (
          <Button
            variant="ghost"
            onClick={onClear}
            className="h-auto rounded-md px-2 py-1 text-caption font-semibold text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-body"
          >
            <RiCloseLine className="size-3.5" aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One dropdown filter. `ALL` is a real option rather than an empty value,
 * because Base UI's Select treats `null` as "nothing chosen" and would render
 * the placeholder where this wants to say "Every department".
 */
export const ALL = "__all__"

export function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  /** Names the control for screen readers; the trigger shows the value. */
  label: string
  value: string
  onChange: (next: string) => void
  allLabel: string
  options: { value: string; label: string }[]
}) {
  const text = value === ALL ? allLabel : (options.find((o) => o.value === value)?.label ?? allLabel)

  return (
    <Select value={value} onValueChange={(v) => onChange((v as string) ?? ALL)}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-9 w-full rounded-md border-line text-body-sm sm:w-auto sm:min-w-37.5",
          value === ALL ? "text-ink-muted" : "font-semibold text-ink-body"
        )}
      >
        <SelectValue>{() => text}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
