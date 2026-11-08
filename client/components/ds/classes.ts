// Class builders for the design system. Pure, so they can be tested without a browser.
// Pages pass `className` for layout only (margins, flex). Size and color come from here.

export type HeadingLevel = "page" | "section" | "card"
export type TextVariant = "body" | "small" | "caption" | "muted" | "danger" | "notice"

const HEADING: Record<HeadingLevel, string> = {
  page: "font-heading font-bold tracking-tight text-title md:text-heading",
  section: "font-heading font-bold tracking-tight text-title-sm md:text-title",
  card: "font-heading font-bold text-body md:text-title-sm",
}

const TEXT: Record<TextVariant, string> = {
  body: "text-body text-ink",
  small: "text-body-sm text-ink",
  caption: "text-caption text-ink",
  muted: "text-body-sm text-ink-muted",
  danger: "text-body-sm text-danger",
  notice: "text-body-sm text-warning",
}

export const headingClass = (level: HeadingLevel): string => HEADING[level]
export const textClass = (variant: TextVariant): string => TEXT[variant]

/** Joins class strings, skipping empty ones. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ")
