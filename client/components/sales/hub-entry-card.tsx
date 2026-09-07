import Link from "next/link"
import { RiArrowRightLine, RiBuilding2Line } from "@remixicon/react"

/**
 * The door to the Sales Hub, shown on a role dashboard rather than as a nav
 * item — a nav item is easy to miss the first time, and this is a second
 * permission axis most signed-in people do not hold.
 *
 * Purely presentational: the caller decides whether to render it. A card
 * that renders itself and returns null half the time would make an item in
 * `dashboard-page.tsx`'s panel arrays that is sometimes empty, which throws
 * off the narrow/wide column split — the same reason every other panel there
 * is pushed conditionally rather than gated internally.
 */
export function HubEntryCard() {
  return (
    <Link
      href="/sales"
      className="group flex min-w-0 flex-col gap-2.5 rounded-md border border-[#E4E9EF] bg-white p-4 transition-[transform,box-shadow] duration-180 ease-out hover:-translate-y-0.5 hover:shadow-[0_6px_16px_-8px_rgba(23,25,28,0.25)] focus-visible:ring-2 focus-visible:ring-[#17191C]/40 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-5"
    >
      <span className="grid size-9 place-items-center rounded-md bg-[#17191C] text-white">
        <RiBuilding2Line className="size-4.5" aria-hidden />
      </span>
      <div>
        <div className="text-[13.5px] font-bold">Sales Hub</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#5F6B7C]">
          Accounts, contacts and the communication log — a separate workspace,
          entered with its own access.
        </p>
      </div>
      <span className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-bold text-[#17191C]">
        Open Sales Hub
        <RiArrowRightLine
          className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden
        />
      </span>
    </Link>
  )
}
