import type { SalesTrack } from "@/lib/api/types"

/**
 * What the Money screens say and start with, for each department.
 *
 * An Opportunity already knows its department (`track`). The accounts do not
 * change: a Service line posts to Service Revenue and a Goods line is held as
 * stock until it is invoiced. This only changes what the screens offer first,
 * so a Software job does not open with a firewall as its example.
 */
export interface MoneyProfile {
  /** The kind a new line starts as. The other kind stays one click away. */
  firstLineKind: "GOODS" | "SERVICE"
  /** The order of the two kinds in the list, first one on top. */
  kindOrder: ("GOODS" | "SERVICE")[]
  lineExample: string
  copyLabel: string
  deliveryNote: string
  linesHint: string | null
}

export const MONEY_PROFILE: Record<SalesTrack, MoneyProfile> = {
  NETWORKING: {
    firstLineKind: "GOODS",
    kindOrder: ["GOODS", "SERVICE"],
    lineExample: "Fortinet FortiGate 100F",
    copyLabel: "Copy products from the Opportunity",
    deliveryNote:
      "This PO is counted as delivered when it is invoiced. There is no separate delivery tracking.",
    linesHint: null,
  },
  SOFTWARE_DEVELOPMENT: {
    firstLineKind: "SERVICE",
    kindOrder: ["SERVICE", "GOODS"],
    lineExample: "Milestone 1: Design and setup",
    copyLabel: "Copy modules from the Opportunity",
    deliveryNote:
      "Software work is counted as delivered when it is invoiced. There is no separate delivery tracking.",
    linesHint:
      "Add one line for the whole project, one line for each milestone, or one line for each month of support. Invoice each line when it is due.",
  },
}
