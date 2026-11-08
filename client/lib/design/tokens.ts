// Design tokens as TypeScript. The same values live in app/globals.css (@theme).
// tokens.test.ts keeps the two in step.

/** Font sizes in px. Nothing is under 12. */
export const TYPE_SCALE = {
  "caption": 12,
  "body-sm": 13,
  "body": 14,
  "lead": 15,
  "title-sm": 16,
  "title": 18,
  "heading": 22,
  "display": 28,
} as const

export type TypeName = keyof typeof TYPE_SCALE

/** Named colors. Hex is lower case so the test can match it in the CSS. */
export const PALETTE = {
  "ink": "#17191c",
  "ink-strong": "#0e1012",
  "ink-body": "#1c2733",
  "ink-soft": "#3d4756",
  "ink-muted": "#5f6b7c",
  "line": "#e4e9ef",
  "line-strong": "#cfd6e0",
  "surface": "#ffffff",
  "surface-subtle": "#f7f9fb",
  "surface-sunken": "#eef1f5",
  "surface-hover": "#f1f4f8",
  "info": "#2d6cb5",
  "info-ink": "#1f4e79",
  "info-tint": "#eaf2fb",
  "success": "#1e7a3c",
  "success-tint": "#e6f4ea",
  "success-line": "#cde7d4",
  "warning": "#8a5e0c",
  "warning-tint": "#fdf8ee",
  "warning-line": "#f5e0be",
  "danger": "#b03a3a",
  "danger-tint": "#fdf6f6",
  "danger-line": "#f0d9d9",
} as const

export type ColorName = keyof typeof PALETTE

/** Text and background pairs that are used together. Each must pass WCAG AA. */
export const TEXT_ON_SURFACE_PAIRS: ReadonlyArray<readonly [ColorName, ColorName]> = [
  ["ink", "surface"],
  ["ink-body", "surface"],
  ["ink-soft", "surface"],
  ["ink-muted", "surface"],
  ["ink-muted", "surface-subtle"],
  ["ink-muted", "surface-sunken"],
  ["ink-muted", "surface-hover"],
  ["surface", "ink"],
  ["surface", "ink-strong"],
  ["danger", "surface"],
  ["danger", "danger-tint"],
  ["warning", "surface"],
  ["warning", "warning-tint"],
  ["success", "surface"],
  ["success", "success-tint"],
  ["info", "surface"],
  ["info-ink", "info-tint"],
  ["surface", "info"],
]

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
