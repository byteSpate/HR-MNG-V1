/**
 * Meeting minutes as the PDF the customer receives (revision §25.10 to §25.19).
 *
 * Every choice copies the four documents the team wrote in Word in August
 * 2026: a centred title, a list of bold labels for the header, attendees
 * grouped by side, numbered sections, a Prepared by block, and no logo and no
 * seal, because none of the four has either.
 *
 * The same split as every renderer here: `renderMinutesHtml` is pure and is
 * what the tests read, and `renderMinutesPdf` only drives the browser.
 */

import { env } from "../../config/env"
import { escapeHtml, renderPdf } from "../../utils/pdf"
import {
  hasContent,
  inlineHtml,
  type Bullet,
  type BulletsContent,
  type MinutesKind,
  type ParagraphsContent,
  type SectionContent,
  type SubtopicsContent,
  type TableContent,
} from "./minutes.content"

export interface MinutesDocument {
  accountName: string
  meetingTitle: string
  scheduledAt: Date
  endsAt: Date | null
  mode: "CUSTOMER_SITE" | "OUR_OFFICE" | "ONLINE"
  location: string | null
  meetingWithNote: string | null
  /** Whoever scheduled the meeting, by name. */
  arrangedBy: string | null
  purpose: string | null
  attendees: { side: "OURS" | "THEIRS"; name: string; designation: string | null }[]
  sections: { heading: string; kind: MinutesKind; content: SectionContent | unknown }[]
  preparers: { name: string; title: string | null; extra: string | null }[]
}

export interface MinutesRenderOptions {
  /** A preview: "DRAFT" across every page. The copy for sending has none. */
  draft: boolean
  companyName: string
  timeZone: string
}

/**
 * Month names written out rather than asked of the locale: newer ICU prints
 * September as "Sept" in en-GB and puts a narrow no-break space before AM,
 * and a stored file name must not change with the server's ICU.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function officeParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(at)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour") % 24, minute: part("minute") }
}

/** "24 Aug 2026", in office time. */
export function dayLabel(at: Date, timeZone: string): string {
  const { year, month, day } = officeParts(at, timeZone)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/** "11:00 AM", in office time. */
function clockLabel(at: Date, timeZone: string): string {
  const { hour, minute } = officeParts(at, timeZone)
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`
}

/** *Meeting Minutes – APS Group – 24 Aug 2026.pdf* (§25.16), with nothing a file name cannot hold. */
export function minutesFileName(accountName: string, scheduledAt: Date, timeZone: string): string {
  const safe = accountName.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim()
  return `Meeting Minutes – ${safe} – ${dayLabel(scheduledAt, timeZone)}.pdf`
}

const text = (value: string) => escapeHtml(value)
/** Typed text with its line breaks, and bold. */
const prose = (value: string) => inlineHtml(value).replace(/\r?\n/g, "<br>")

function bulletList(bullets: Bullet[]): string {
  if (bullets.length === 0) return ""
  const items = bullets
    .map((bullet) => {
      const sub = bullet.sub.length > 0 ? `<ul class="sub">${bullet.sub.map((s) => `<li>${prose(s)}</li>`).join("")}</ul>` : ""
      return `<li>${prose(bullet.text)}${sub}</li>`
    })
    .join("")
  return `<ul>${items}</ul>`
}

const paragraphs = (list: string[]) => list.map((p) => `<p>${prose(p)}</p>`).join("")

function sectionBody(kind: MinutesKind, content: SectionContent, number: number): string {
  switch (kind) {
    case "PARAGRAPHS":
      return paragraphs((content as ParagraphsContent).paragraphs)
    case "BULLETS":
      return bulletList((content as BulletsContent).bullets)
    case "SUBTOPICS":
      return (content as SubtopicsContent).topics
        .map(
          (topic, i) =>
            `<h3>${number}.${i + 1} ${prose(topic.title)}</h3>${topic.text ? paragraphs([topic.text]) : ""}${bulletList(topic.bullets)}`
        )
        .join("")
    default: {
      const rows = (content as TableContent).rows
        .map(
          (row, i) =>
            `<tr><td>${i + 1}</td><td>${prose(row.actionItem)}</td><td>${prose(row.responsible)}</td><td>${prose(row.status)}</td></tr>`
        )
        .join("")
      return `<table><colgroup><col style="width:8%"><col style="width:46%"><col style="width:28%"><col style="width:18%"></colgroup><thead><tr><th>SL</th><th>Action Item</th><th>Responsible Person/Team</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
    }
  }
}

function attendeeBlock(doc: MinutesDocument, companyName: string): string {
  const named = (a: MinutesDocument["attendees"][number]) =>
    `<li>${text(a.designation ? `${a.name} (${a.designation})` : a.name)}</li>`
  const group = (label: string, side: "OURS" | "THEIRS") => {
    const people = doc.attendees.filter((a) => a.side === side)
    return people.length > 0 ? `<p class="group">From ${text(label)}:</p><ul>${people.map(named).join("")}</ul>` : ""
  }
  // Their side first, as every one of the documents does.
  const body = group(doc.accountName, "THEIRS") + group(companyName, "OURS")
  return body ? `<h2>Attendees</h2>${body}` : ""
}

/**
 * The header's labelled lines, in the documents' order (§25.12), leaving out
 * any the meeting has nothing for. Exported so the editor shows exactly the
 * lines the PDF will print.
 */
export function headerLines(
  doc: Omit<MinutesDocument, "attendees" | "sections" | "preparers">,
  options: Pick<MinutesRenderOptions, "timeZone" | "companyName">
): { label: string; value: string }[] {
  const { timeZone, companyName } = options
  const time = doc.endsAt
    ? `${clockLabel(doc.scheduledAt, timeZone)} – ${clockLabel(doc.endsAt, timeZone)}`
    : clockLabel(doc.scheduledAt, timeZone)
  // An online meeting's place is its link, which is ours and not the customer's business.
  const location = doc.mode === "ONLINE" ? "Online" : doc.location
  const lines: [string, string | null][] = [
    ["Date", dayLabel(doc.scheduledAt, timeZone)],
    ["Time", time],
    ["Location", location],
    ["Meeting With", doc.meetingWithNote ? `${doc.accountName}, ${doc.meetingWithNote}` : doc.accountName],
    ["On Behalf Of", companyName],
    ["Arranged by", doc.arrangedBy],
    ["Purpose", doc.purpose],
  ]
  return lines.flatMap(([label, value]) => (value !== null && value.trim() !== "" ? [{ label, value }] : []))
}

function headerFacts(doc: MinutesDocument, options: MinutesRenderOptions): string {
  return headerLines(doc, options)
    .map(({ label, value }) => `<div><b>${label}:</b> ${text(value)}</div>`)
    .join("")
}

function preparedBy(doc: MinutesDocument, companyName: string): string {
  if (doc.preparers.length === 0) return ""
  const people = doc.preparers
    .map((person) =>
      [`<b>${text(person.name)}</b>`, person.title, person.extra, companyName]
        .filter((line): line is string => !!line && line.trim() !== "")
        .map((line, i) => (i === 0 ? line : text(line)))
        .join("<br>")
    )
    .map((lines) => `<div class="person">${lines}</div>`)
    .join("")
  return `<section class="prepared"><h2>Prepared by</h2>${people}</section>`
}

const STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #111; background: #fff;
    font-family: "Times New Roman", Tinos, "Liberation Serif", "DejaVu Serif", serif;
    font-size: 11pt; line-height: 1.4; -webkit-print-color-adjust: exact;
  }
  h1 { margin: 0; text-align: center; font-size: 16pt; font-weight: 700; }
  .subtitle { margin: 3px 0 12px; text-align: center; font-size: 11.5pt; }
  .facts div { margin: 2px 0; }
  h2 { margin: 14px 0 5px; font-size: 12.5pt; font-weight: 700; page-break-after: avoid; }
  h3 { margin: 9px 0 3px; font-size: 11pt; font-weight: 700; page-break-after: avoid; }
  p { margin: 0 0 6px; }
  p.group { margin: 6px 0 2px; font-weight: 700; }
  ul { margin: 2px 0 6px; padding-left: 22px; }
  ul.sub { list-style: circle; margin: 2px 0; }
  li { margin: 1px 0; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
  th, td { border: 0.75pt solid #444; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { font-weight: 700; background: #F2F2F2; }
  td:first-child, th:first-child { text-align: center; }
  tr { page-break-inside: avoid; }
  .prepared .person { margin: 4px 0 8px; }
  .draft {
    position: fixed; top: 40%; left: 0; right: 0; text-align: center;
    font-family: Arial, Helvetica, sans-serif; font-size: 110pt; font-weight: 700;
    letter-spacing: 0.08em; color: rgba(176, 58, 58, 0.13); transform: rotate(-30deg);
  }
`

export function renderMinutesHtml(doc: MinutesDocument, options: MinutesRenderOptions): string {
  const title = `Meeting Minutes – ${doc.accountName}`
  // Numbered by printed position, so skipping an empty section leaves no gap.
  const printed = doc.sections.filter((section) => hasContent(section.kind, section.content as SectionContent))
  const sections = printed
    .map(
      (section, i) =>
        `<section><h2>${i + 1}. ${text(section.heading)}</h2>${sectionBody(section.kind, section.content as SectionContent, i + 1)}</section>`
    )
    .join("")

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${text(title)}</title><style>${STYLES}</style></head>
<body>
  ${options.draft ? '<div class="draft">DRAFT</div>' : ""}
  <h1>${text(title)}</h1>
  <p class="subtitle">${text(doc.meetingTitle)}</p>
  <div class="facts">${headerFacts(doc, options)}</div>
  ${attendeeBlock(doc, options.companyName)}
  ${sections}
  ${preparedBy(doc, options.companyName)}
</body></html>`
}

export async function renderMinutesPdf(doc: MinutesDocument, draft: boolean): Promise<Buffer> {
  const html = renderMinutesHtml(doc, { draft, companyName: env.COMPANY_NAME, timeZone: env.APP_TIMEZONE })
  return renderPdf(html, {
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="width:100%;font-size:8pt;color:#666;padding:0 18mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: "16mm", bottom: "18mm", left: "18mm", right: "18mm" },
  })
}
