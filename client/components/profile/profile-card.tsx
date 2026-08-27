import type { ReactNode } from "react"

export interface ProfileRow {
  label: string
  value: string | null
  /** Shown under the value in small muted text, e.g. "visible to colleagues". */
  hint?: string
}

/**
 * A titled card of label/value rows.
 *
 * Takes data, never a role. That is what lets the details page in the
 * employee-details spec render exactly the same card for a viewer at a
 * different tier without either page learning a visibility rule.
 */
export function ProfileCard({
  title,
  rows,
  lockedHint,
  action,
}: {
  title: string
  rows: ProfileRow[]
  /** e.g. "Employment details are maintained by HR". */
  lockedHint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-[15px] font-bold">{title}</div>
        {action}
      </div>
      <dl className="space-y-3.5">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,140px)_1fr] gap-3">
            <dt className="text-[12.5px] font-semibold text-[#7A8698]">{row.label}</dt>
            <dd className="min-w-0">
              {/* An em dash, not an empty cell. A blank space reads as a
                  rendering bug; a dash reads as "not recorded". */}
              <div className="text-[13.5px] break-words">{row.value ?? "—"}</div>
              {row.hint ? (
                <div className="mt-0.5 text-[11.5px] text-[#A5AFBE]">{row.hint}</div>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {lockedHint ? (
        <p className="mt-4 border-t border-[#EFF2F6] pt-3 text-[12px] text-[#A5AFBE]">
          {lockedHint}
        </p>
      ) : null}
    </div>
  )
}

/** `YYYY-MM-DD` → `6 Jan 2025`. Null passes through so callers stay simple. */
export function formatDateValue(iso: string | null): string | null {
  if (iso === null) return null
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}
