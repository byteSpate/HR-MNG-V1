"use client"

/**
 * The Formatted text box in the minutes (the owner's change, 2026-09-15): a
 * Word-style toolbar over Tiptap.
 *
 * It saves Tiptap's JSON, which the server checks against the same fixed list
 * of tools this toolbar offers (server/src/modules/sales/minutes.content.ts)
 * and turns into the PDF itself. The palette and the link rule below are that
 * file's, copied by hand, as every client and server pair here is.
 */

import { useState } from "react"
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import TextAlign from "@tiptap/extension-text-align"
import { Highlight } from "@tiptap/extension-highlight"
import { TableKit } from "@tiptap/extension-table"
import {
  RiAlignCenter,
  RiAlignJustify,
  RiAlignLeft,
  RiAlignRight,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiBold,
  RiDeleteColumn,
  RiDeleteRow,
  RiFormatClear,
  RiH3,
  RiH4,
  RiIndentDecrease,
  RiIndentIncrease,
  RiInsertColumnRight,
  RiInsertRowBottom,
  RiItalic,
  RiLink,
  RiLinkUnlink,
  RiListOrdered,
  RiListUnordered,
  RiMarkPenLine,
  RiSeparator,
  RiStrikethrough,
  RiTable2,
  RiUnderline,
} from "@remixicon/react"

import type { MinutesBullet, MinutesTopic, RichDoc, RichNode } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** The server's highlight palette (RICH_HIGHLIGHTS). The PDF prints exactly these. */
export const RICH_HIGHLIGHTS = {
  yellow: "#FEF08A",
  green: "#BBF7D0",
  blue: "#BFDBFE",
  pink: "#FBCFE8",
} as const
const HIGHLIGHT_LABEL: Record<keyof typeof RICH_HIGHLIGHTS, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
}

/** The server's link rule: web and mail addresses only. */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i

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

// ── the editor ───────────────────────────────────────────────────────────────

/**
 * How the text looks while typing, close to the PDF. Tailwind's reset takes
 * list markers away, so they are put back here.
 */
const CONTENT =
  "min-h-28 px-3 py-2.5 text-[13px] leading-relaxed text-[#1C2733] outline-none " +
  "[&_p]:my-1 [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-[14px] [&_h3]:font-bold [&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-bold " +
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul_ul]:list-[circle] [&_ol_ol]:list-[lower-alpha] [&_li_p]:my-0 " +
  "[&_a]:text-[#1F4D8F] [&_a]:underline [&_hr]:my-3 [&_hr]:border-[#C9D1DB] [&_mark]:rounded-sm [&_mark]:px-0.5 " +
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#C9D1DB] [&_td]:px-2 [&_td]:py-1 [&_td]:align-top " +
  "[&_th]:border [&_th]:border-[#C9D1DB] [&_th]:bg-[#F2F4F7] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:align-top [&_td_p]:my-0 [&_th_p]:my-0 " +
  "[&_.selectedCell]:bg-[#E8EEF7]"

type Panel = "link" | "highlight" | null

export function RichTextEditor({
  value,
  onChange,
  label,
}: {
  value: RichDoc
  onChange: (next: RichDoc) => void
  /** What a screen reader calls the box. */
  label: string
}) {
  const editor = useEditor({
    // The page renders on the server first; the editor must wait for the browser.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
        // Not on the toolbar, so not in the document: the server would refuse them.
        code: false,
        codeBlock: false,
        blockquote: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: value,
    editorProps: { attributes: { "aria-label": label, class: CONTENT } },
    onUpdate: ({ editor: next }) => onChange(next.getJSON() as RichDoc),
  })

  return (
    <div className="rounded-md border border-[#D9DFE7] bg-white focus-within:border-[#17191C]/40 focus-within:ring-2 focus-within:ring-[#17191C]/10">
      {editor ? <Toolbar editor={editor} /> : <div className="h-9 border-b border-[#EEF1F5] bg-[#F7F9FB]" />}
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const [panel, setPanel] = useState<Panel>(null)
  const [href, setHref] = useState("")
  const [linkError, setLinkError] = useState<string | null>(null)

  // Re-read on every change of selection, so each button shows what is under the cursor.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      h3: e.isActive("heading", { level: 3 }),
      h4: e.isActive("heading", { level: 4 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      inList: e.isActive("listItem"),
      table: e.isActive("table"),
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()

  function openLink() {
    setHref(s.href)
    setLinkError(null)
    setPanel(panel === "link" ? null : "link")
  }

  function applyLink() {
    const typed = href.trim()
    if (!typed) return
    // "www.example.com" means the website; anything with a scheme must be a web or mail address.
    const next = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : typed.includes("@") ? `mailto:${typed}` : `https://${typed}`
    if (!SAFE_LINK.test(next)) {
      setLinkError("A link must be a web address or an email address.")
      return
    }
    chain().extendMarkRange("link").setLink({ href: next }).run()
    setPanel(null)
  }

  return (
    <div className="border-b border-[#EEF1F5] bg-[#F7F9FB]">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 px-1.5 py-1">
        <Tool label="Undo" disabled={!s.canUndo} onClick={() => chain().undo().run()}>
          <RiArrowGoBackLine />
        </Tool>
        <Tool label="Redo" disabled={!s.canRedo} onClick={() => chain().redo().run()}>
          <RiArrowGoForwardLine />
        </Tool>
        <Divider />
        <Tool label="Bold" active={s.bold} onClick={() => chain().toggleBold().run()}>
          <RiBold />
        </Tool>
        <Tool label="Italic" active={s.italic} onClick={() => chain().toggleItalic().run()}>
          <RiItalic />
        </Tool>
        <Tool label="Underline" active={s.underline} onClick={() => chain().toggleUnderline().run()}>
          <RiUnderline />
        </Tool>
        <Tool label="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}>
          <RiStrikethrough />
        </Tool>
        <Tool label="Highlight" active={s.highlight || panel === "highlight"} onClick={() => setPanel(panel === "highlight" ? null : "highlight")}>
          <RiMarkPenLine />
        </Tool>
        <Tool label="Link" active={s.link || panel === "link"} onClick={openLink}>
          <RiLink />
        </Tool>
        <Divider />
        <Tool label="Sub-heading" active={s.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
          <RiH3 />
        </Tool>
        <Tool label="Smaller sub-heading" active={s.h4} onClick={() => chain().toggleHeading({ level: 4 }).run()}>
          <RiH4 />
        </Tool>
        <Tool label="Bullet list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}>
          <RiListUnordered />
        </Tool>
        <Tool label="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
          <RiListOrdered />
        </Tool>
        <Tool label="Make it a sub-point" disabled={!s.inList} onClick={() => chain().sinkListItem("listItem").run()}>
          <RiIndentIncrease />
        </Tool>
        <Tool label="Move it back a level" disabled={!s.inList} onClick={() => chain().liftListItem("listItem").run()}>
          <RiIndentDecrease />
        </Tool>
        <Divider />
        <Tool label="Align left" active={s.align === "left"} onClick={() => chain().setTextAlign("left").run()}>
          <RiAlignLeft />
        </Tool>
        <Tool label="Centre" active={s.align === "center"} onClick={() => chain().setTextAlign("center").run()}>
          <RiAlignCenter />
        </Tool>
        <Tool label="Align right" active={s.align === "right"} onClick={() => chain().setTextAlign("right").run()}>
          <RiAlignRight />
        </Tool>
        <Tool label="Justify" active={s.align === "justify"} onClick={() => chain().setTextAlign("justify").run()}>
          <RiAlignJustify />
        </Tool>
        <Divider />
        <Tool label="Horizontal line" onClick={() => chain().setHorizontalRule().run()}>
          <RiSeparator />
        </Tool>
        <Tool
          label="Insert a table"
          disabled={s.table}
          onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <RiTable2 />
        </Tool>
        <Tool label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
          <RiFormatClear />
        </Tool>
      </div>

      {/* Table tools, only while the cursor is in a table: elsewhere they could do nothing. */}
      {s.table ? (
        <div className="flex flex-wrap items-center gap-0.5 border-t border-[#EEF1F5] px-1.5 py-1">
          <span className="px-1.5 text-[11.5px] font-semibold text-[#5F6B7C]">Table</span>
          <Tool label="Add a row below" onClick={() => chain().addRowAfter().run()}>
            <RiInsertRowBottom />
          </Tool>
          <Tool label="Add a column to the right" onClick={() => chain().addColumnAfter().run()}>
            <RiInsertColumnRight />
          </Tool>
          <Tool label="Delete this row" onClick={() => chain().deleteRow().run()}>
            <RiDeleteRow />
          </Tool>
          <Tool label="Delete this column" onClick={() => chain().deleteColumn().run()}>
            <RiDeleteColumn />
          </Tool>
          <Button
            type="button"
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => chain().deleteTable().run()}
            className="h-7 rounded px-2 text-[12px] font-bold text-[#5F6B7C] hover:bg-[#FDF1F1] hover:text-[#B03A3A]"
          >
            Delete the table
          </Button>
        </div>
      ) : null}

      {panel === "highlight" ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[#EEF1F5] px-2 py-1.5">
          {(Object.keys(RICH_HIGHLIGHTS) as (keyof typeof RICH_HIGHLIGHTS)[]).map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                chain().toggleHighlight({ color: RICH_HIGHLIGHTS[name] }).run()
                setPanel(null)
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-[#D9DFE7] bg-white px-2 text-[12px] font-semibold text-[#1C2733] hover:bg-[#F1F4F8]"
            >
              <span className="size-3.5 rounded-sm border border-black/10" style={{ background: RICH_HIGHLIGHTS[name] }} aria-hidden />
              {HIGHLIGHT_LABEL[name]}
            </button>
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              chain().unsetHighlight().run()
              setPanel(null)
            }}
            className="inline-flex h-7 items-center rounded px-2 text-[12px] font-semibold text-[#5F6B7C] hover:bg-[#F1F4F8]"
          >
            No highlight
          </button>
        </div>
      ) : null}

      {panel === "link" ? (
        <div className="grid gap-1 border-t border-[#EEF1F5] px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              aria-label="Link address"
              placeholder="https://… or name@example.com"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  applyLink()
                }
              }}
              className="h-8 min-w-[14rem] flex-1 bg-white"
            />
            <Button
              type="button"
              onClick={applyLink}
              disabled={!href.trim()}
              className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              {s.link ? "Change the link" : "Add the link"}
            </Button>
            {s.link ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  chain().extendMarkRange("link").unsetLink().run()
                  setPanel(null)
                }}
                className="h-8 rounded-md px-2 text-[12px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8]"
              >
                <RiLinkUnlink className="size-4" aria-hidden />
                Remove the link
              </Button>
            ) : null}
          </div>
          <p className="text-[11.5px] text-[#5F6B7C]">
            {linkError ?? "Select the words first. The link stays clickable in the PDF."}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function Tool({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // Keeps the selection in the text while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded text-[#3D4756] transition-colors hover:bg-[#E8ECF1] disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4",
        active && "bg-[#17191C] text-white hover:bg-[#0E1012]"
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-[#D9DFE7]" aria-hidden />
}
