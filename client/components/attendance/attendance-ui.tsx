import { cn } from "@/lib/utils"
import { Heading } from "@/components/ds/heading"

/**
 * Small presentational pieces shared by the page and its sections. They live
 * here rather than in attendance-page.tsx so a section importing them does
 * not create a cycle back to the page that renders it.
 *
 * `TableSkeleton` and `LoadError` used to live here too: three grey bars and
 * a one-line sentence, repeated at four call sites. Both are now PanelTable's
 * job (components/dashboard/record-kit.tsx), which draws a skeleton shaped
 * like the grid it replaces and gives a failed load somewhere to retry from.
 */

export function SectionHeading({
  title,
  sub,
  className,
}: {
  title: string
  sub?: string
  className?: string
}) {
  return (
    <div className={cn("pt-7 pb-3.5", className)}>
      <Heading level="section">{title}</Heading>
      {sub ? <div className="mt-0.5 max-w-xl text-caption text-ink-muted">{sub}</div> : null}
    </div>
  )
}
