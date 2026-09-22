"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { FLOW, HELP, helpKeyFor } from "@/lib/help/accounting-help"

const ROLE_SEGMENTS = new Set(["admin", "finance", "hr", "manager", "employee"])

function roleRootOf(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0]
  return ROLE_SEGMENTS.has(first) ? `/${first}` : ""
}

/**
 * An inline "How does this work?" opener for empty states.
 *
 * The highest-value placement in the whole feature: somebody reading "No
 * journals yet" is at the exact moment of needing the explanation, and the
 * `?` in the top-right corner is nowhere near where they are looking.
 *
 * Links straight to the guide page's matching section, same as the header
 * trigger — one destination, reached two ways. Renders nothing where the
 * current page has no guide section, rather than a link to a page that
 * cannot say anything about where it was clicked from.
 */
export function HelpLink({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname() ?? ""
  const key = helpKeyFor(pathname)
  if (!key) return null

  const entry = HELP[key]
  const step = FLOW.find((s) => s.id === entry.step)
  const href = `${roleRootOf(pathname)}/accounting/guide#${step?.id ?? "setup"}`

  return (
    <Link
      href={href}
      className="h-auto p-0 text-[12.5px] font-bold text-[#1C2733] underline decoration-[#B8C1CE] underline-offset-2 hover:text-[#0E1012]"
    >
      {children ?? "How does this work?"}
    </Link>
  )
}
