import type { OpportunityStage, OpportunityStatus } from "@/lib/api/types"
import { tones } from "@/components/dashboard/types"
import { cn } from "@/lib/utils"
import { OPPORTUNITY_STATUS_LABEL, STAGE_LABEL } from "@/components/sales/shared/sales-shared"

/** The six stages in funnel order, the order `STAGE_LABEL` declares them in. */
const STAGE_ORDER = Object.keys(STAGE_LABEL) as OpportunityStage[]

/**
 * How far along the funnel a deal is: six segments, filled up to its stage.
 *
 * Colour carries the outcome and nothing else. An open deal fills in the
 * page's ink; a won deal in green, a lost one in red, a cancelled one in grey.
 * A closed deal keeps the stage it ended at, the same rule `stageSentence`
 * follows, so "lost at negotiation" still shows how far it got.
 */
export function StageBar({
  status,
  stage,
  className,
}: {
  status: OpportunityStatus
  stage: OpportunityStage
  className?: string
}) {
  const reached = STAGE_ORDER.indexOf(stage) + 1
  const fill =
    status === "WON"
      ? tones.green.color
      : status === "LOST"
        ? tones.red.color
        : status === "CANCELLED"
          ? "#8A94A2"
          : "#17191C"
  const label =
    status === "ONGOING"
      ? `Stage ${reached} of ${STAGE_ORDER.length}: ${STAGE_LABEL[stage]}`
      : `${OPPORTUNITY_STATUS_LABEL[status]} at stage ${reached} of ${STAGE_ORDER.length}: ${STAGE_LABEL[stage]}`

  return (
    <div role="img" aria-label={label} title={label} className={cn("flex gap-0.5", className)}>
      {STAGE_ORDER.map((s, i) => (
        <span
          key={s}
          className="h-1.5 flex-1 rounded-full"
          style={{ background: i < reached ? fill : "#E4E9EF" }}
        />
      ))}
    </div>
  )
}
