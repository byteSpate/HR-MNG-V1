/** Which ends of a sideways-scrolling strip have more to show. */
export interface EdgeFades {
  start: boolean
  end: boolean
}

/** Under one pixel is rounding, not hidden content. */
const SLACK = 1

export function edgeFades(scrollLeft: number, clientWidth: number, scrollWidth: number): EdgeFades {
  return {
    start: scrollLeft > SLACK,
    end: scrollWidth - clientWidth - scrollLeft > SLACK,
  }
}

const FADE = "28px"

/** A CSS mask that softens only the ends that are cut off, or nothing at all. */
export function fadeMask({ start, end }: EdgeFades): string | undefined {
  if (!start && !end) return undefined
  return `linear-gradient(to right, ${start ? `transparent 0, #000 ${FADE}` : "#000 0"}, ${end ? `#000 calc(100% - ${FADE}), transparent 100%` : "#000 100%"})`
}
