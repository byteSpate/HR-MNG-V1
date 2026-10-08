/**
 * The plain parts of the minutes' formatted text: the highlight colours, the
 * link rule, the empty document, and the converters from the older kinds.
 *
 * They live apart from `rich-text-editor.tsx` so that reading them does not
 * load Tiptap. The editor itself is large and is loaded only when it is shown.
 *
 * The palette and the link rule are the server's
 * (server/src/modules/sales/minutes.content.ts), copied by hand, as every
 * client and server pair here is.
 */

import type { MinutesBullet, MinutesTopic, RichDoc, RichNode } from "@/lib/api/types"

/** The server's highlight palette (RICH_HIGHLIGHTS). The PDF prints exactly these. */
export const RICH_HIGHLIGHTS = {
  yellow: "#FEF08A",
  green: "#BBF7D0",
  blue: "#BFDBFE",
  pink: "#FBCFE8",
} as const

export const HIGHLIGHT_LABEL: Record<keyof typeof RICH_HIGHLIGHTS, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
}

/** The server's link rule: web and mail addresses only. */
export const SAFE_LINK = /^(https?:\/\/|mailto:)/i

/** The smallest document the editor accepts: one empty paragraph. */
export const EMPTY_RICH: RichDoc = { type: "doc", content: [{ type: "paragraph" }] }

// ── carrying the older kinds across ──────────────────────────────────────────

/** `**word**`, the older kinds' only formatting, as bold marks. */
function boldRuns(value: string): RichNode[] {
  return value
    .split(/(\*\*(?=\S)[^*]+?(?<=\S)\*\*)/g)
    .filter((part) => part !== "")
    .map((part) =>
      /^\*\*(?=\S)[^*]+(?<=\S)\*\*$/.test(part)
        ? { type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] }
        : { type: "text", text: part }
    )
}

/** A paragraph, keeping its line breaks. Empty text is left out: the editor does not allow it. */
function paragraph(value: string): RichNode {
  const content = value
    .split(/\r?\n/)
    .flatMap((line, i) => [...(i > 0 ? [{ type: "hardBreak" }] : []), ...boldRuns(line)])
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" }
}

function bulletList(bullets: MinutesBullet[]): RichNode {
  return {
    type: "bulletList",
    content: bullets.map((bullet) => ({
      type: "listItem",
      content: [
        paragraph(bullet.text),
        ...(bullet.sub.length > 0
          ? [{ type: "bulletList", content: bullet.sub.map((sub) => ({ type: "listItem", content: [paragraph(sub)] })) }]
          : []),
      ],
    })),
  }
}

const doc = (content: RichNode[]): RichDoc => (content.length > 0 ? { type: "doc", content } : structuredClone(EMPTY_RICH))

export function paragraphsToRich(paragraphs: string[]): RichDoc {
  return doc(paragraphs.filter((p) => p.trim() !== "").map(paragraph))
}

export function bulletsToRich(bullets: MinutesBullet[]): RichDoc {
  const kept = bullets.filter((b) => b.text.trim() !== "" || b.sub.length > 0)
  return doc(kept.length > 0 ? [bulletList(kept)] : [])
}

/**
 * Sub-topics become sub-headings that keep their number as text ("2.1
 * Network"), because formatted text does not number headings itself.
 */
export function topicsToRich(topics: MinutesTopic[], sectionNumber: number): RichDoc {
  return doc(
    topics
      .filter((t) => t.title.trim() !== "" || t.text.trim() !== "" || t.bullets.length > 0)
      .flatMap((topic, i) => [
        { type: "heading", attrs: { level: 3 }, content: boldRuns(`${sectionNumber}.${i + 1} ${topic.title}`.trim()) },
        ...(topic.text.trim() ? [paragraph(topic.text)] : []),
        ...(topic.bullets.length > 0 ? [bulletList(topic.bullets)] : []),
      ])
  )
}
