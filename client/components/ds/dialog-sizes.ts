export const DIALOG_SIZES = ["sm", "md", "lg", "xl"] as const
export type DialogSize = (typeof DIALOG_SIZES)[number]

// Desktop widths: about 384, 512, 768 and 1024 px. On a phone every size fills the
// width with a 16 px gutter (that part lives in components/ui/dialog.tsx).
const WIDTH: Record<DialogSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-5xl",
}

export const dialogWidthClass = (size: DialogSize): string => WIDTH[size]

/** The body scrolls, not the page. The cap leaves room for header, footer and keyboard. */
export const DIALOG_BODY_CLASS = "max-h-[calc(100dvh-12rem)] overflow-y-auto"
