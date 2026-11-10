"use client"

import { useEffect, useState } from "react"
import { RiSearchLine } from "@remixicon/react"

import { Input } from "@/components/ui/input"

/**
 * The search box on the Sales list pages (owner, 2026-11-10), the same box the
 * Contacts page has had since October.
 *
 * `typed` is what is in the box. `q` follows it after a pause in typing, so
 * each letter is not a request. Only `q` goes to the server, and every list
 * but Accounts is searched there: they are capped, and searching only the
 * rows on screen would miss the rest.
 */
export function useSearch(onChange?: () => void): {
  typed: string
  setTyped: (v: string) => void
  q: string
  /** Empties the box and the search at once, for a Clear button. */
  clear: () => void
} {
  const [typed, setTyped] = useState("")
  const [q, setQ] = useState("")

  useEffect(() => {
    const id = setTimeout(() => {
      const next = typed.trim()
      if (next !== q) {
        setQ(next)
        onChange?.()
      }
    }, 300)
    return () => clearTimeout(id)
    // Only typing restarts the pause. `q` and `onChange` are read when it ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])

  const clear = () => {
    setTyped("")
    setQ("")
  }

  return { typed, setTyped, q, clear }
}

export function SearchBox({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  /** Read by screen readers, like "Search Opportunities". */
  label: string
  /** Names what is searched, like "Number, name, account or owner". */
  placeholder: string
}) {
  return (
    <div className="relative w-full max-w-sm">
      <RiSearchLine
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="pl-8 text-body-sm"
      />
    </div>
  )
}
