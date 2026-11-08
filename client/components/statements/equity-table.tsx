"use client"

import type { EquityResult } from "@/lib/api/types"
import { takaTotal } from "@/components/statements/statements-shared"
import { cn } from "@/lib/utils"

/**
 * A matrix rather than a list — columns are equity accounts, rows are the
 * movement between opening and closing. No comparative column: the statement
 * carries its own opening balance, which is what makes it self-comparative.
 */
export function EquityTable({ result }: { result: EquityResult }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-160 text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs font-medium text-muted-foreground">
            <th className="px-4 py-2 text-left">Particulars</th>
            {result.columns.map((c) => (
              <th key={c.accountId} className="px-4 py-2 text-right">{c.name}</th>
            ))}
            <th className="px-4 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => {
            const emphasis = row.kind === "OPENING" || row.kind === "CLOSING"
            return (
              <tr
                key={`${row.kind}-${row.label}-${i}`}
                className={cn("border-b last:border-0", emphasis && "bg-muted/30 font-medium")}
              >
                <td className="px-4 py-2">{row.label}</td>
                {result.columns.map((c) => (
                  <td key={c.accountId} className="px-4 py-2 text-right tabular-nums">
                    {takaTotal(row.values[c.accountId] ?? "0.00")}
                  </td>
                ))}
                <td className="px-4 py-2 text-right tabular-nums">{takaTotal(row.total)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
