/**
 * The day counts the Sales Hub uses to decide what needs attention. One place,
 * so the dashboard's action rows and the Before Quotation counters can never
 * disagree about what "quiet" or "stuck" means.
 */

/** An Opportunity quiet for this long needs chasing. */
export const QUIET_DAYS = 30

/** An Opportunity that has not moved stage in this long is stuck: the reason Stage exists. */
export const STUCK_DAYS = 21

/** "Quote due soon" in Before Quotation: an expected quote date in the next this many days. */
export const QUOTE_DUE_DAYS = 14
