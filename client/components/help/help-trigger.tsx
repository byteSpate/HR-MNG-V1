"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { RiQuestionLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { FLOW, HELP, helpKeyFor } from "@/lib/help/accounting-help"
import { guideHrefFor } from "@/lib/help/guide-link"

/**
 * The `?` control in the header.
 *
 * Used to open a slide-over panel repeating the current page's help entry.
 * It now links straight to the guide page instead — one page, one URL,
 * scrolled to the section this page's step belongs to. Nothing here holds
 * open/closed state any more; a page navigation needs none.
 *
 * Renders nothing outside the accounting section, same as before: a control
 * pointing at a guide that says nothing about the page you are on is the
 * kind of dead end the rest of this app's UI rules refuse elsewhere.
 */
export function HelpTrigger() {
  const pathname = usePathname() ?? ""
  const key = helpKeyFor(pathname)
  if (!key) return null

  const entry = HELP[key]
  const step = FLOW.find((s) => s.id === entry.step)
  // Only Admin and Finance have the guide page. For anyone else the link would
  // 404 (HR had a `?` on Costs, Expenses, Payroll and Settlements that did).
  const href = guideHrefFor(pathname, step?.id)
  if (!href) return null

  return (
    <Button
      nativeButton={false}
      variant="outline"
      size="icon"
      aria-label={`How ${entry.title} works`}
      title={`How ${entry.title} works`}
      className="size-8.5 rounded border-[#E4E9EF] text-[#55657A] hover:bg-[#F4F6F9]"
      render={<Link href={href} />}
    >
      <RiQuestionLine className="size-4" />
    </Button>
  )
}
