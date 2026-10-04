/**
 * The one visual world every email this system sends shares: the brochure.
 *
 * THESIS: an email from byteSpate looks like the cover of the byteSpate
 * brochure. A thin red, blue and green stripe, the logo on white, then a deep
 * navy panel that carries the subject. It refuses the old "paper on a desk"
 * form with its rotated stamp.
 * OWN-WORLD: stripe red #E23B2E / blue #3B63B8 / green #3FAE5A, navy #1B3A82
 * panel with white type and a mint #7AE3C8 accent, white body card, ink
 * #16233F, hairline rows. State is a small tinted pill, never a large colour.
 * STORY: "this is from byteSpate, here is what happened, here are the facts,
 * here is the one thing to do."
 *
 * Email-client reality this file obeys: table layout at 600px, inline light
 * styles with a `<style>` dark-mode override (`prefers-color-scheme`), no
 * webfonts, every dynamic string escaped. The logo is a PNG sent as an inline
 * attachment and referenced by content id: Gmail strips `data:` images, so the
 * mailer attaches `brand/logo.png` whenever an email carries `cid:LOGO_CID`.
 * The logo strip stays white in dark clients, because the logo is drawn on
 * white.
 */

import { env } from "../config/env"

export type StampTone = "approved" | "declined" | "action" | "notice" | "issued"

export interface Stamp {
  label: string
  tone: StampTone
}

export interface FactRow {
  label: string
  value: string
}

export interface MoneyTable {
  rows: FactRow[]
  netLabel: string
  netValue: string
}

export interface EmailAction {
  label: string
  href: string
  /** Shown under the button — e.g. why, or the conditional around it. */
  note?: string
}

export interface EmailParts {
  /** Hidden preheader text — the inbox list's second line. */
  preheader?: string
  /** Reference number, shown in the footer. Traceable or dated. */
  serial: string
  subject: string
  /** The state of the email, shown as a pill beside the logo. */
  stamp: Stamp
  /** Lead paragraph — greeting or one-sentence statement of what happened. */
  intro?: string
  facts?: FactRow[]
  money?: MoneyTable
  /** Ordinary paragraphs between facts and the action. */
  prose?: string[]
  action?: EmailAction
  /** Security or correction note inside the card, above the signature. */
  notice?: string
  /** Why the reader got this. Small, muted, in the footer. */
  footer: string
}

/** The content id the mailer attaches `brand/logo.png` under. */
export const LOGO_CID = "brand-logo"

export interface RenderOptions {
  /** Replaces `cid:` for a browser preview, where nothing is attached. */
  logoSrc?: string
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

const NAVY = "#1B3A82"
const NAVY_DEEP = "#142C66"
const MINT = "#7AE3C8"
const INK = "#16233F"
const MUTED = "#4F5B73"
const HAIR = "#E3E7EF"
const PAGE = "#EEF1F7"
const PAPER = "#FFFFFF"
const WASH = "#F4F6FB"

const STRIPE = ["#E23B2E", "#3B63B8", "#3FAE5A"] as const

/** Pill colours. Light fills with dark text, so they read on the white strip. */
const PILL: Record<StampTone, { bg: string; ink: string }> = {
  approved: { bg: "#DDF5E6", ink: "#14663B" },
  declined: { bg: "#FDE4E1", ink: "#9B1C14" },
  action: { bg: "#FFEFC7", ink: "#7A5200" },
  notice: { bg: "#FDE4E1", ink: "#9B1C14" },
  issued: { bg: "#E1E9FB", ink: NAVY },
}

/** Escape a value for safe interpolation into HTML text or an attribute. */
export function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const KIND_CODES: Record<string, string> = {
  PASSWORD_RESET: "PR",
  PASSWORD_CHANGED: "PW",
  CREDENTIALS: "CR",
  EMAIL_CHANGE_CONFIRM: "EC",
  EMAIL_CHANGED: "EM",
  EMAIL_CHANGE_WARNING: "EW",
  ATTENDANCE_DIGEST: "AT",
  ATTENDANCE_REPORT_DAILY: "AD",
  ATTENDANCE_REPORT_MONTHLY: "AM",
  MISSING_CHECKOUT: "MC",
  PAYSLIP: "PS",
  LEAVE_REQUESTED: "LV",
  LEAVE_DECIDED: "LV",
  EXPENSE_DECIDED: "EX",
  PAYROLL_SUBMITTED: "PY",
  ASSET_REQUEST_DECIDED: "AS",
  SETTLEMENT_STATEMENT: "ST",
  SALES_DAILY_EMAIL: "SD",
  SALES_MEETING_CHANGED: "SM",
}

/**
 * The reference number: `PC-LV-3F2A81B4` when the email is about a record
 * (traceable back through the dispatch log), `PC-LV-20260824` when it is
 * about a person or an event with no entity of its own.
 */
export function serialFor(kind: string, entityId?: string): string {
  const code = KIND_CODES[kind] ?? kind.slice(0, 2).toUpperCase()
  const suffix = entityId
    ? entityId.replaceAll("-", "").slice(0, 8).toUpperCase()
    : new Date().toISOString().slice(0, 10).replaceAll("-", "")
  return `PC-${code}-${suffix}`
}

function stripeHtml(): string {
  const cells = STRIPE.map(
    (colour) =>
      `<td width="33.33%" height="6" bgcolor="${colour}" style="height:6px;line-height:6px;font-size:0;background:${colour};">&nbsp;</td>`
  ).join("")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`
}

function pillHtml(stamp: Stamp): string {
  const { bg, ink } = PILL[stamp.tone]
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr><td bgcolor="${bg}" style="background:${bg};border-radius:999px;padding:5px 13px;font-family:${FONT};font-size:12px;font-weight:700;line-height:16px;color:${ink};white-space:nowrap;">${esc(stamp.label)}</td></tr></table>`
}

function factsHtml(facts: FactRow[]): string {
  const rows = facts
    .map(
      (f) => `<tr>
          <td class="muted hair" style="padding:11px 0;border-bottom:1px solid ${HAIR};font-size:14px;line-height:1.45;color:${MUTED};width:42%;">${esc(f.label)}</td>
          <td class="ink hair" style="padding:11px 0;border-bottom:1px solid ${HAIR};font-size:14px;line-height:1.45;font-weight:700;color:${INK};text-align:right;font-variant-numeric:tabular-nums;">${esc(f.value)}</td>
        </tr>`
    )
    .join("\n")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;">${rows}</table>`
}

function moneyHtml(money: MoneyTable): string {
  const rows = money.rows
    .map(
      (r) => `<tr>
          <td class="muted hair" style="padding:10px 0;border-bottom:1px solid ${HAIR};font-size:14px;color:${MUTED};">${esc(r.label)}</td>
          <td class="ink hair" style="padding:10px 0;border-bottom:1px solid ${HAIR};font-size:14px;color:${INK};text-align:right;font-variant-numeric:tabular-nums;">${esc(r.value)}</td>
        </tr>`
    )
    .join("\n")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;">${rows}
        <tr>
          <td class="ink net" style="padding:14px 0 0 0;border-top:2px solid ${NAVY};font-size:14px;font-weight:700;color:${INK};">${esc(money.netLabel)}</td>
          <td class="ink net" style="padding:14px 0 0 0;border-top:2px solid ${NAVY};font-size:18px;font-weight:700;color:${NAVY};text-align:right;font-variant-numeric:tabular-nums;">${esc(money.netValue)}</td>
        </tr>
      </table>`
}

function actionHtml(action: EmailAction): string {
  const note = action.note
    ? `<p class="muted" style="margin:12px 0 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${esc(action.note)}</p>`
    : ""
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0 0;"><tr>
          <td class="btn" bgcolor="${NAVY}" style="background:${NAVY};border-radius:6px;">
            <a href="${esc(action.href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.2;color:#FFFFFF;text-decoration:none;">${esc(action.label)}</a>
          </td>
        </tr></table>${note}`
}

/**
 * Render the full document. The returned string is the email's `html` —
 * nothing else should hand-build markup for a send.
 */
export function renderEmail(parts: EmailParts, options: RenderOptions = {}): string {
  const logoSrc = options.logoSrc ?? `cid:${LOGO_CID}`
  const company = env.COMPANY_NAME

  const preheader = parts.preheader
    ? `<span style="display:none;max-height:0;overflow:hidden;">${esc(parts.preheader)}</span>`
    : ""

  const intro = parts.intro
    ? `<p class="ink" style="margin:0;font-size:16px;line-height:1.6;color:${INK};">${esc(parts.intro)}</p>`
    : ""

  const prose = (parts.prose ?? [])
    .map(
      (p) =>
        `<p class="ink" style="margin:16px 0 0 0;font-size:15px;line-height:1.6;color:${INK};">${esc(p)}</p>`
    )
    .join("\n")

  const notice = parts.notice
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;"><tr><td class="wash muted" bgcolor="${WASH}" style="background:${WASH};border-radius:6px;padding:13px 16px;font-size:13px;line-height:1.55;color:${MUTED};">${esc(parts.notice)}</td></tr></table>`
    : ""

  const action = parts.action ? actionHtml(parts.action) : ""

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${esc(parts.subject)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .pad { padding-left: 20px !important; padding-right: 20px !important; }
      .subject { font-size: 22px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .page, .pagebg { background: #0D1322 !important; }
      .card { background: #172033 !important; }
      .ink { color: #EAF0FF !important; }
      .muted { color: #A9B6D0 !important; }
      .hair { border-color: #2A3550 !important; }
      .net { border-color: #7AE3C8 !important; color: #7AE3C8 !important; }
      .wash { background: #1F2A44 !important; }
      .foot { background: #121A2B !important; }
      .btn, .btn td { background: ${MINT} !important; }
      .btn a { color: ${NAVY_DEEP} !important; }
    }
  </style>
</head>
<body class="pagebg" style="margin:0;padding:0;background:${PAGE};font-family:${FONT};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" bgcolor="${PAGE}" style="background:${PAGE};">
  <tr><td align="center" style="padding:24px 12px;font-family:${FONT};">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="card" bgcolor="${PAPER}" style="width:100%;max-width:600px;background:${PAPER};border-radius:8px;overflow:hidden;">
      <tr><td style="font-size:0;line-height:0;">${stripeHtml()}</td></tr>

      <tr><td class="pad" bgcolor="#FFFFFF" style="padding:18px 32px;background:#FFFFFF;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle"><img src="${esc(logoSrc)}" alt="${esc(company)}" width="150" height="35" style="display:block;border:0;width:150px;height:35px;" /></td>
          <td valign="middle" align="right">${pillHtml(parts.stamp)}</td>
        </tr></table>
      </td></tr>

      <tr><td class="pad" bgcolor="${NAVY}" style="padding:30px 32px 32px 32px;background:${NAVY};background-image:linear-gradient(135deg,${NAVY} 0%,${NAVY_DEEP} 100%);">
        <h1 class="subject" style="margin:0;font-family:${FONT};font-size:26px;font-weight:700;line-height:1.3;letter-spacing:-0.01em;color:#FFFFFF;">${esc(parts.subject)}</h1>
        <table role="presentation" width="40" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;"><tr><td width="40" height="3" bgcolor="${MINT}" style="height:3px;line-height:3px;font-size:0;background:${MINT};border-radius:2px;">&nbsp;</td></tr></table>
      </td></tr>

      <tr><td class="pad" style="padding:28px 32px 32px 32px;font-family:${FONT};">
        ${intro}
        ${parts.facts ? factsHtml(parts.facts) : ""}
        ${parts.money ? moneyHtml(parts.money) : ""}
        ${prose}
        ${action}
        ${notice}

        <p class="ink" style="margin:30px 0 0 0;font-size:14px;font-weight:700;color:${INK};">${esc(company)}</p>
        <p class="muted" style="margin:3px 0 0 0;font-size:13px;color:${MUTED};">HR &amp; payroll</p>
      </td></tr>

      <tr><td class="pad foot hair" bgcolor="${WASH}" style="padding:18px 32px;background:${WASH};border-top:1px solid ${HAIR};">
        <p class="muted" style="margin:0;font-size:12px;line-height:1.55;color:${MUTED};">${esc(parts.footer)}</p>
        <p class="muted" style="margin:8px 0 0 0;font-size:12px;line-height:1.4;color:${MUTED};font-variant-numeric:tabular-nums;">Ref ${esc(parts.serial)}</p>
      </td></tr>
    </table>

  </td></tr>
</table>
</body>
</html>`
}
