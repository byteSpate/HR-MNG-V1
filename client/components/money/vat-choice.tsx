"use client"

import type { VatCode, VatMethod } from "@/lib/api/types"
import { Input } from "@/components/ui/input"
import { TONE } from "@/components/dashboard/record-kit"

export interface VatDraft {
  vatCodeId: string
  vatMethod: VatMethod
  vatRatePercent: string
}

const SELECT =
  "h-9 w-full rounded-md border border-[#E4E9EF] bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#17191C]/20"

/**
 * A line's VAT: a VAT code from Settings (the default), or a typed %
 * (spec 2026-09-28 §1.6). A typed line still keeps its code, so the choice
 * never touches the VAT summary's accounts.
 */
export function VatChoice({
  index,
  value,
  codes,
  onChange,
}: {
  index: number
  value: VatDraft
  codes: VatCode[]
  onChange: (patch: Partial<VatDraft>) => void
}) {
  const typed = value.vatMethod === "MANUAL"
  return (
    <div className="flex flex-col gap-1.5">
      <select
        aria-label={`Line ${index + 1} VAT`}
        className={SELECT}
        value={typed ? "__typed" : value.vatCodeId || codes[0]?.id || ""}
        onChange={(e) =>
          e.target.value === "__typed"
            ? onChange({ vatMethod: "MANUAL", vatCodeId: value.vatCodeId || codes[0]?.id || "" })
            : onChange({ vatMethod: "CODE", vatCodeId: e.target.value, vatRatePercent: "" })
        }
      >
        {codes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="__typed">Type a VAT %</option>
      </select>
      {typed ? (
        <div className="flex items-center gap-1.5">
          <Input
            aria-label={`Line ${index + 1} VAT %`}
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={value.vatRatePercent}
            onChange={(e) => onChange({ vatRatePercent: e.target.value })}
            placeholder="7.5"
          />
          <span className={`text-[12px] ${TONE.muted}`}>%</span>
        </div>
      ) : null}
    </div>
  )
}

/** A line's rate as a person reads it: "15.00% (STD15)" or "7.50% (typed)". */
export function vatLabel(line: {
  vatMethod: VatMethod
  vatRatePercent: string | null
  vatCode?: { code: string } | null
}): string {
  const rate = line.vatRatePercent ?? "0"
  return line.vatMethod === "MANUAL"
    ? `${rate}% (typed)`
    : `${rate}% (${line.vatCode?.code ?? "VAT code"})`
}

/** True when a typed line has no usable rate yet. */
export function vatIncomplete(v: VatDraft): boolean {
  if (v.vatMethod !== "MANUAL") return false
  const n = Number(v.vatRatePercent)
  return v.vatRatePercent.trim() === "" || Number.isNaN(n) || n < 0 || n > 100
}
