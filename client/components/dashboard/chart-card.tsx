import type { ChartBar } from "@/components/dashboard/types"

export function ChartCard({ title, sub, bars }: { title: string; sub: string; bars: ChartBar[] }) {
  return (
    // `min-w-75`, not `min-w-0`: this sits in `flex flex-wrap` rows of up to
    // five (ProfileInsights). Without a floor, flex items shrink past their
    // content's natural width instead of the row wrapping, and a three-word
    // title like "Attendance rate" breaks into "Atten/rate" one letter-grid
    // at a time. `flex-1` matches the loading skeleton's basis, so cards
    // still stretch evenly to fill whatever row they land on.
    <div className="@container flex min-w-75 flex-1 flex-col rounded-md border border-line bg-white px-4 py-4 sm:px-5.5 sm:py-5">
      <div className="text-lead font-bold">{title}</div>
      <div className="mt-0.5 mb-4.5 text-xs text-ink-muted">{sub}</div>
      <div className="mt-auto flex h-30 items-end gap-3.5 @[400px]:h-37.5">
        {bars.map((bar, i) => (
          <div key={bar.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <div className="text-caption font-bold text-ink-soft">{bar.display}</div>
            <div
              className="w-full max-w-8.5 rounded-t-sm rounded-b-[2px]"
              style={{ height: `${bar.height}%`, background: i === bars.length - 1 ? "#17191C" : "#C6CCD3" }}
            />
            <div className="text-caption font-semibold text-ink-muted">{bar.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
