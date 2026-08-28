/**
 * The one visual world every email this system sends shares: the Advice Form.
 *
 * THESIS: an email from the employer is an official record, not a marketing
 * notification — serial number, subject line, facts in ruled rows, and a
 * state stamp; it refuses the SaaS logo-header-plus-button arrangement.
 * OWN-WORLD: white paper card on a quiet desk, hairline ink rules, one ink
 * (#1c2430), one state color confined to the stamp (green approved, red
 * declined, amber action), tabular numerals, letterspaced-caps wordmark.
 * STORY: "this is official; here is the state, the facts, the number, and
 * the one thing to do if anything."
 * FIRST VIEWPORT: ruled masthead (wordmark left, serial right), double rule,
 * bold Subject: line, stamp overlapping the rule.
 * FORM: grounded candidate 7 of 7 (prescription pad → official directive
 * form), seed key 36d1a78b, mode operate.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with
 * the finish review, the verdict, and DESIGN.md.
 *
 * Email-client reality this file obeys: table layout at 600px, inline light
 * styles with a `<style>` dark-mode override (`prefers-color-scheme`), no
 * webfonts, no images, every dynamic string escaped. The stamp's rotation
 * degrades to a straight box where transforms are ignored — the double
 * border and ink carry it either way.
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
  /** Reference number, top-right of the masthead. Traceable or dated. */
  serial: string
  subject: string
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
  /** Why the reader got this. Small, muted, under the signature. */
  footer: string
}

const INK = "#1c2430"
const MUTED = "#5b6470"
const HAIR = "#d9d6cd"
const DESK = "#eceae4"
const PAPER = "#ffffff"

const TONE_INK: Record<StampTone, string> = {
  approved: "#1a7f4b",
  declined: "#b3261e",
  action: "#9a6b00",
  notice: "#b3261e",
  issued: INK,
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
  MISSING_CHECKOUT: "MC",
  PAYSLIP: "PS",
  LEAVE_REQUESTED: "LV",
  LEAVE_DECIDED: "LV",
  EXPENSE_DECIDED: "EX",
  PAYROLL_SUBMITTED: "PY",
  ASSET_REQUEST_DECIDED: "AS",
  SETTLEMENT_STATEMENT: "ST",
}

/**
 * The masthead reference: `PC-LV-3F2A81B4` when the email is about a record
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

function stampHtml(stamp: Stamp): string {
  const ink = TONE_INK[stamp.tone]
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr><td class="stamp stamp-${stamp.tone}" style="border:3px double ${ink};padding:6px 14px;transform:rotate(-2deg);border-radius:2px;">
        <span style="display:inline-block;white-space:nowrap;font-size:12px;font-weight:700;letter-spacing:0.14em;color:${ink};">${esc(stamp.label)}</span>
      </td></tr></table>`
}

function factsHtml(facts: FactRow[]): string {
  const rows = facts
    .map(
      (f) => `<tr>
          <td class="muted" style="padding:9px 0;border-bottom:1px solid ${HAIR};font-size:14px;color:${MUTED};width:42%;">${esc(f.label)}</td>
          <td class="ink" style="padding:9px 0;border-bottom:1px solid ${HAIR};font-size:14px;font-weight:600;color:${INK};text-align:right;font-variant-numeric:tabular-nums;">${esc(f.value)}</td>
        </tr>`
    )
    .join("\n")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0 0;">${rows}</table>`
}

function moneyHtml(money: MoneyTable): string {
  const rows = money.rows
    .map(
      (r) => `<tr>
          <td class="muted" style="padding:8px 0;border-bottom:1px solid ${HAIR};font-size:14px;color:${MUTED};">${esc(r.label)}</td>
          <td class="ink" style="padding:8px 0;border-bottom:1px solid ${HAIR};font-size:14px;color:${INK};text-align:right;font-variant-numeric:tabular-nums;">${esc(r.value)}</td>
        </tr>`
    )
    .join("\n")
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0 0;">${rows}
        <tr>
          <td class="ink" style="padding:12px 0 0 0;border-top:2px solid ${INK};font-size:14px;font-weight:700;color:${INK};">${esc(money.netLabel)}</td>
          <td class="ink" style="padding:12px 0 0 0;border-top:2px solid ${INK};font-size:16px;font-weight:700;color:${INK};text-align:right;font-variant-numeric:tabular-nums;">${esc(money.netValue)}</td>
        </tr>
      </table>`
}

function actionHtml(action: EmailAction): string {
  const note = action.note
    ? `<p class="muted" style="margin:10px 0 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${esc(action.note)}</p>`
    : ""
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0 0;border:1px solid ${HAIR};border-radius:6px;">
      <tr><td style="padding:18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="btn" bgcolor="${INK}" style="border-radius:6px;">
            <a href="${esc(action.href)}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(action.label)}</a>
          </td>
        </tr></table>
        ${note}
      </td></tr>
    </table>`
}

/**
 * Render the full document. The returned string is the email's `html` —
 * nothing else should hand-build markup for a send.
 */
export function renderEmail(parts: EmailParts): string {
  const preheader = parts.preheader
    ? `<span style="display:none;max-height:0;overflow:hidden;">${esc(parts.preheader)}</span>`
    : ""

  const intro = parts.intro
    ? `<p class="ink" style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:${INK};">${esc(parts.intro)}</p>`
    : ""

  const prose = (parts.prose ?? [])
    .map(
      (p) =>
        `<p class="ink" style="margin:14px 0 12px 0;font-size:14px;line-height:1.6;color:${INK};">${esc(p)}</p>`
    )
    .join("\n")

  const notice = parts.notice
    ? `<div class="muted" style="margin:20px 0 0 0;padding-top:2px;"><span style="display:block;width:28px;border-top:2px solid ${MUTED};margin-bottom:8px;font-size:0;">&nbsp;</span><p style="margin:0;font-size:13px;line-height:1.55;color:${MUTED};">${esc(parts.notice)}</p></div>`
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
    @media (prefers-color-scheme: dark) {
      .desk { background: #14161a !important; }
      .bodybg { background: #14161a !important; }
      .card { background: #1d2026 !important; }
      .ink  { color: #e8e6df !important; }
      .muted{ color: #9aa0aa !important; }
      .hair { border-color: #3a3f47 !important; }
      .footstrip { background: #1a1d22 !important; }
      .stamp-approved { border-color: #4cc38a !important; }
      .stamp-approved span { color: #4cc38a !important; }
      .stamp-declined, .stamp-notice { border-color: #ff8a80 !important; }
      .stamp-declined span, .stamp-notice span { color: #ff8a80 !important; }
      .stamp-action { border-color: #e5b567 !important; }
      .stamp-action span { color: #e5b567 !important; }
      .stamp-issued { border-color: #e8e6df !important; }
      .stamp-issued span { color: #e8e6df !important; }
      .btn td, td.btn { background: #e8e6df !important; }
      .btn a { color: #1d2026 !important; }
    }
  </style>
</head>
<body class="bodybg" style="margin:0;padding:0;background:${DESK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="desk" bgcolor="${DESK}" style="background:${DESK};">
  <tr><td align="center" style="padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="card" bgcolor="${PAPER}" style="width:600px;max-width:600px;background:${PAPER};border:1px solid ${HAIR};border-radius:4px;">
      <tr><td style="padding:30px 36px 34px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td class="ink" style="padding-bottom:14px;border-bottom:3px double ${INK};font-size:13px;font-weight:700;letter-spacing:0.22em;color:${INK};">${esc(env.COMPANY_NAME.toUpperCase())}</td>
            <td class="muted" style="padding-bottom:14px;border-bottom:3px double ${INK};font-size:12px;color:${MUTED};text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;">Ref ${esc(parts.serial)}</td>
          </tr>
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-top:18px;">
              <p class="ink" style="margin:0;font-size:20px;font-weight:700;line-height:1.35;color:${INK};">Subject: ${esc(parts.subject)}</p>
            </td>
            <td align="right" valign="top" style="padding-top:14px;">
              ${stampHtml(parts.stamp)}
            </td>
          </tr>
        </table>

        <div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>

        ${intro}
        ${parts.facts ? factsHtml(parts.facts) : ""}
        ${parts.money ? moneyHtml(parts.money) : ""}
        ${prose}
        ${action}
        ${notice}

        <p class="ink" style="margin:26px 0 0 0;font-size:14px;color:${INK};">${esc(env.COMPANY_NAME)}</p>
        <p class="muted" style="margin:4px 0 0 0;font-size:12px;color:${MUTED};">HR &amp; payroll</p>

      </td></tr>
      <tr><td class="hair footstrip" style="padding:14px 36px;border-top:1px solid ${HAIR};background:#faf9f6;">
        <p class="muted" style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">${esc(parts.footer)}</p>
      </td></tr>
    </table>

  </td></tr>
</table>
</body>
</html>`
}
