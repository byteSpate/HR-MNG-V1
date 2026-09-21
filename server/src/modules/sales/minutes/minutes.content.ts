/**
 * What a section of meeting minutes may hold, and the template new minutes
 * start from (revision §25.17 to §25.21).
 *
 * Four kinds, because the four real documents use four: paragraphs, bullets
 * two levels deep (• and o), numbered sub-topics, and the Next Steps table.
 * Formatting is bold and nothing else (§25.18): `**words**`, turned into
 * <strong> when printed, with everything else escaped.
 *
 * Pure, with no database, so the editor's rules and the PDF's can be tested
 * without either.
 */

import { z } from "zod"

import { escapeHtml } from "../../../utils/pdf"

export const MINUTES_KINDS = ["PARAGRAPHS", "BULLETS", "SUBTOPICS", "TABLE", "RICH"] as const
export type MinutesKind = (typeof MINUTES_KINDS)[number]

/** Empty is allowed while typing; `cleanContent` drops it on save. */
const typed = (max: number) => z.string().trim().max(max)
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")

/** A bullet and the second level under it. No third level: the documents have none. */
const bulletSchema = z.object({
  text: typed(1000),
  sub: z.array(typed(1000)).max(30).default([]),
})

const paragraphsSchema = z.object({ paragraphs: z.array(typed(4000)).max(40) })
const bulletsSchema = z.object({ bullets: z.array(bulletSchema).max(80) })
const subtopicsSchema = z.object({
  topics: z
    .array(
      z.object({
        title: typed(200),
        text: typed(4000).default(""),
        bullets: z.array(bulletSchema).max(40).default([]),
      })
    )
    .max(30),
})

/**
 * A Next Steps row. The columns are fixed (§25.21) because the task tick reads
 * them, so any other key is dropped rather than kept.
 *
 * `taskId` is the task this row made, which the server alone sets. `newTask`
 * is the tick itself, sent once: make a task for me, due on this day.
 */
const tableRowSchema = z.object({
  actionItem: typed(500),
  responsible: typed(200).default(""),
  status: typed(120).default(""),
  taskId: z.string().nullable().default(null),
  newTask: z.object({ dueOn: dateOnly }).optional(),
})
const tableSchema = z.object({ rows: z.array(tableRowSchema).max(60) })

// ── formatted text (the owner's change, 2026-09-15) ──────────────────────────
//
// The Word-style toolbar's document, as Tiptap saves it. Checked here node by
// node against a fixed list, so what reaches the database, and the PDF's
// browser, is only what the toolbar can make.

/** The highlight colours the toolbar offers. Named, so the PDF prints exactly these. */
export const RICH_HIGHLIGHTS = {
  yellow: "#FEF08A",
  green: "#BBF7D0",
  blue: "#BFDBFE",
  pink: "#FBCFE8",
} as const
const HIGHLIGHT_VALUES: string[] = Object.values(RICH_HIGHLIGHTS)

export const RICH_ALIGNMENTS = ["left", "center", "right", "justify"] as const
export type RichAlign = (typeof RICH_ALIGNMENTS)[number]

/** Web and mail addresses only: a `javascript:` link would run in the browser that prints the PDF. */
export const SAFE_LINK = /^(https?:\/\/|mailto:)/i

export type RichMark =
  | { type: "bold" | "italic" | "underline" | "strike" }
  | { type: "link"; attrs: { href: string; target?: string | null; rel?: string | null; class?: string | null } }
  | { type: "highlight"; attrs: { color: string } }
export interface RichText {
  type: "text"
  text: string
  marks?: RichMark[]
}
export type RichInline = RichText | { type: "hardBreak" }
interface AlignAttrs {
  textAlign?: RichAlign | null
}
export interface RichListItem {
  type: "listItem"
  content: RichBlock[]
}
export interface RichCell {
  type: "tableHeader" | "tableCell"
  attrs?: { colspan?: number; rowspan?: number; colwidth?: number[] | null }
  content: RichBlock[]
}
export interface RichRow {
  type: "tableRow"
  content: RichCell[]
}
export type RichBlock =
  | { type: "paragraph"; attrs?: AlignAttrs; content?: RichInline[] }
  | { type: "heading"; attrs: AlignAttrs & { level: 3 | 4 }; content?: RichInline[] }
  | { type: "bulletList"; content: RichListItem[] }
  | { type: "orderedList"; attrs?: { start?: number | null; type?: string | null }; content: RichListItem[] }
  | { type: "horizontalRule" }
  | { type: "table"; content: RichRow[] }
export interface RichDoc {
  type: "doc"
  content: RichBlock[]
}

const markSchema = z.union([
  z.object({ type: z.enum(["bold", "italic", "underline", "strike"]) }),
  z.object({
    type: z.literal("link"),
    attrs: z.object({
      href: z.string().max(2000).regex(SAFE_LINK, "A link must start with http://, https:// or mailto:"),
      target: z.string().max(20).nullable().optional(),
      rel: z.string().max(100).nullable().optional(),
      class: z.string().max(100).nullable().optional(),
    }),
  }),
  z.object({
    type: z.literal("highlight"),
    attrs: z.object({
      color: z.string().refine((value) => HIGHLIGHT_VALUES.includes(value), "Pick one of the highlight colours"),
    }),
  }),
])

const inlineSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string().max(10_000), marks: z.array(markSchema).max(10).optional() }),
  z.object({ type: z.literal("hardBreak") }),
])

const alignAttrs = z.object({ textAlign: z.enum(RICH_ALIGNMENTS).nullable().optional() })

const blockSchema: z.ZodType<RichBlock> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("paragraph"), attrs: alignAttrs.optional(), content: z.array(inlineSchema).max(500).optional() }),
    z.object({
      type: z.literal("heading"),
      attrs: alignAttrs.extend({ level: z.union([z.literal(3), z.literal(4)]) }),
      content: z.array(inlineSchema).max(500).optional(),
    }),
    z.object({ type: z.literal("bulletList"), content: z.array(listItemSchema).max(200) }),
    z.object({
      type: z.literal("orderedList"),
      attrs: z
        .object({
          start: z.number().int().min(0).max(10_000).nullable().optional(),
          type: z.string().max(10).nullable().optional(),
        })
        .optional(),
      content: z.array(listItemSchema).max(200),
    }),
    z.object({ type: z.literal("horizontalRule") }),
    z.object({ type: z.literal("table"), content: z.array(rowSchema).max(100) }),
  ])
)

const listItemSchema = z.object({ type: z.literal("listItem"), content: z.array(blockSchema).max(50) })

const cellSchema = z.object({
  type: z.enum(["tableHeader", "tableCell"]),
  attrs: z
    .object({
      colspan: z.number().int().min(1).max(20).optional(),
      rowspan: z.number().int().min(1).max(20).optional(),
      colwidth: z.array(z.number()).max(20).nullable().optional(),
    })
    .optional(),
  content: z.array(blockSchema).max(50),
})

const rowSchema = z.object({ type: z.literal("tableRow"), content: z.array(cellSchema).max(20) })

/** A size cap on top of the node list, so one section cannot fill the database. */
const RICH_MAX_CHARS = 200_000

export const richDocSchema = z
  .object({ type: z.literal("doc"), content: z.array(blockSchema).max(1000) })
  .refine((doc) => JSON.stringify(doc).length <= RICH_MAX_CHARS, {
    message: "This section is too long to save. Split it into two sections.",
  })

/** Whether a formatted document has any words in it. Structure alone prints nothing. */
function richHasText(node: unknown): boolean {
  if (!node || typeof node !== "object") return false
  const { type, text, content } = node as { type?: string; text?: string; content?: unknown[] }
  if (type === "text") return !!text?.trim()
  return Array.isArray(content) && content.some(richHasText)
}

const heading = z.string().trim().min(1, "Give every section a heading").max(120)

/** One section as the editor sends it. The kind decides what its content may hold. */
export const sectionInputSchema = z.discriminatedUnion("kind", [
  z.object({ heading, kind: z.literal("PARAGRAPHS"), content: paragraphsSchema }),
  z.object({ heading, kind: z.literal("BULLETS"), content: bulletsSchema }),
  z.object({ heading, kind: z.literal("SUBTOPICS"), content: subtopicsSchema }),
  z.object({ heading, kind: z.literal("TABLE"), content: tableSchema }),
  z.object({ heading, kind: z.literal("RICH"), content: richDocSchema }),
])
export type SectionInput = z.infer<typeof sectionInputSchema>

export type Bullet = z.infer<typeof bulletSchema>
export type ParagraphsContent = z.infer<typeof paragraphsSchema>
export type BulletsContent = z.infer<typeof bulletsSchema>
export type SubtopicsContent = z.infer<typeof subtopicsSchema>
export interface TableRow {
  actionItem: string
  responsible: string
  status: string
  taskId: string | null
}
export interface TableContent {
  rows: TableRow[]
}

export interface ContentByKind {
  PARAGRAPHS: ParagraphsContent
  BULLETS: BulletsContent
  SUBTOPICS: SubtopicsContent
  TABLE: TableContent
  RICH: RichDoc
}
export type SectionContent = ContentByKind[MinutesKind]

const CONTENT_SCHEMA: Record<MinutesKind, z.ZodType> = {
  PARAGRAPHS: paragraphsSchema,
  BULLETS: bulletsSchema,
  SUBTOPICS: subtopicsSchema,
  TABLE: tableSchema,
  RICH: richDocSchema,
}

export function emptyContent<K extends MinutesKind>(kind: K): ContentByKind[K] {
  const empty: ContentByKind = {
    PARAGRAPHS: { paragraphs: [] },
    BULLETS: { bullets: [] },
    SUBTOPICS: { topics: [] },
    TABLE: { rows: [] },
    // One empty paragraph, the smallest document the editor accepts.
    RICH: { type: "doc", content: [{ type: "paragraph" }] },
  }
  return empty[kind]
}

const filled = (value: string) => value.trim() !== ""

function cleanBullets(list: Bullet[]): Bullet[] {
  return list
    .map((bullet) => ({ text: bullet.text.trim(), sub: bullet.sub.map((s) => s.trim()).filter(filled) }))
    .filter((bullet) => filled(bullet.text) || bullet.sub.length > 0)
}

/**
 * What was typed, without the blanks an editor leaves behind: an empty
 * paragraph, a bullet with nothing in it, a row nobody filled in. Order is
 * kept. A row's `newTask` is not content, so it is dropped here too; the
 * service reads it before cleaning.
 */
export function cleanContent<K extends MinutesKind>(kind: K, content: ContentByKind[K]): ContentByKind[K] {
  switch (kind) {
    case "PARAGRAPHS": {
      const { paragraphs } = content as ParagraphsContent
      return { paragraphs: paragraphs.map((p) => p.trim()).filter(filled) } as ContentByKind[K]
    }
    case "BULLETS":
      return { bullets: cleanBullets((content as BulletsContent).bullets) } as ContentByKind[K]
    case "SUBTOPICS": {
      const topics = (content as SubtopicsContent).topics
        .map((topic) => ({ title: topic.title.trim(), text: topic.text.trim(), bullets: cleanBullets(topic.bullets) }))
        .filter((topic) => filled(topic.title) || filled(topic.text) || topic.bullets.length > 0)
      return { topics } as ContentByKind[K]
    }
    case "TABLE": {
      const rows = (content as TableContent).rows
        .map((row) => ({
          actionItem: row.actionItem.trim(),
          responsible: row.responsible.trim(),
          status: row.status.trim(),
          taskId: row.taskId ?? null,
        }))
        .filter((row) => filled(row.actionItem) || filled(row.responsible) || filled(row.status))
      return { rows } as ContentByKind[K]
    }
    // Formatted text is kept exactly as its schema passed it: its blank lines
    // and spacing are what the writer laid out.
    default:
      return content
  }
}

/**
 * Content read back from the database. Written only through
 * `sectionInputSchema`, so a failure here means a hand edit; the section then
 * reads as empty rather than breaking the whole document.
 */
export function readContent<K extends MinutesKind>(kind: K, stored: unknown): ContentByKind[K] {
  const parsed = CONTENT_SCHEMA[kind].safeParse(stored)
  return parsed.success ? cleanContent(kind, parsed.data as ContentByKind[K]) : emptyContent(kind)
}

/** Whether a section has anything to print. An empty one is left out of the PDF. */
export function hasContent(kind: MinutesKind, content: SectionContent): boolean {
  switch (kind) {
    case "PARAGRAPHS":
      return (content as ParagraphsContent).paragraphs.length > 0
    case "BULLETS":
      return (content as BulletsContent).bullets.length > 0
    case "SUBTOPICS":
      return (content as SubtopicsContent).topics.length > 0
    case "TABLE":
      return (content as TableContent).rows.length > 0
    default:
      return richHasText(content)
  }
}

// ── the template ─────────────────────────────────────────────────────────────

export interface TemplateSection {
  heading: string
  kind: MinutesKind
  /** New minutes put the meeting's outcome note here (§25.1). One section at most. */
  startsWithOutcome?: boolean
}

/** From the four real documents (§25.17). */
export const DEFAULT_TEMPLATE: TemplateSection[] = [
  { heading: "Meeting Summary", kind: "PARAGRAPHS" },
  { heading: "Key Discussion Points", kind: "SUBTOPICS" },
  { heading: "Next Steps", kind: "TABLE" },
  { heading: "Meeting Outcome", kind: "PARAGRAPHS", startsWithOutcome: true },
]

export const templateSchema = z
  .object({
    sections: z
      .array(
        z.object({
          heading,
          kind: z.enum(MINUTES_KINDS),
          startsWithOutcome: z.boolean().optional(),
        })
      )
      .min(1, "A template needs at least one section")
      .max(20, "A template can have at most 20 sections"),
  })
  .superRefine((body, ctx) => {
    const marked = body.sections.filter((section) => section.startsWithOutcome)
    if (marked.length > 1) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: "Only one section can start with the outcome note" })
    }
    if (marked.some((section) => section.kind !== "PARAGRAPHS" && section.kind !== "RICH")) {
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: "The outcome note starts a section of paragraphs or formatted text, not bullets, sub-topics or a table",
      })
    }
  })
export type TemplateBody = z.infer<typeof templateSchema>

/** The stored template, or the default when there is none or it no longer reads. */
export function readTemplate(stored: unknown): TemplateSection[] {
  if (stored === null || stored === undefined) return DEFAULT_TEMPLATE
  const parsed = templateSchema.safeParse({ sections: stored })
  return parsed.success ? parsed.data.sections : DEFAULT_TEMPLATE
}

/** New minutes' sections: the template's, empty, with the outcome note in the marked one. */
export function sectionsFromTemplate(
  template: TemplateSection[],
  outcome: string | null
): { order: number; heading: string; kind: MinutesKind; content: SectionContent }[] {
  const note = outcome?.trim() ?? ""
  return template.map((section, order) => ({
    order,
    heading: section.heading,
    kind: section.kind,
    content:
      !section.startsWithOutcome || !note
        ? emptyContent(section.kind)
        : section.kind === "PARAGRAPHS"
          ? { paragraphs: [note] }
          : section.kind === "RICH"
            ? { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: note }] }] }
            : emptyContent(section.kind),
  }))
}

// ── bold ─────────────────────────────────────────────────────────────────────

/**
 * Typed text as HTML: escaped, then `**words**` made bold. Stars that do not
 * wrap a word ("5 ** 2") are left as typed. Escaped first, so nothing a
 * person types can become markup.
 */
export function inlineHtml(value: string): string {
  return escapeHtml(value).replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
}
