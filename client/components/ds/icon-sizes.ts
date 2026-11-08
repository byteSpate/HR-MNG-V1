/** Icon sizes in px. Pick a name, not a number. */
export const ICON_SIZE = { xs: 14, sm: 16, md: 20, lg: 24, xl: 36 } as const

export type IconSize = keyof typeof ICON_SIZE

// Full class names, written out so the Tailwind scanner sees them.
const CLASS: Record<IconSize, string> = {
  xs: "size-3.5 shrink-0",
  sm: "size-4 shrink-0",
  md: "size-5 shrink-0",
  lg: "size-6 shrink-0",
  xl: "size-9 shrink-0",
}

export const iconClass = (size: IconSize): string => CLASS[size]
