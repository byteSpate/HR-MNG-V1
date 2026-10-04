/**
 * The header look of the report PDFs, the same one the emails use: a thin red,
 * blue and green stripe, the logo on white, then a navy panel with the title
 * and a short mint bar. Colours come from `templates/email.ts`.
 *
 * Shared by the attendance and expense reports. Both keep the same header
 * markup (`<header>` with the logo block first and `.meta` second), so only
 * the style changes, plus the stripe above it.
 */

export const BRAND_STRIPE_HTML = '<div class="stripe"></div>'

export const BRAND_HEADER_CSS = `
  .stripe { height: 6px; background: linear-gradient(90deg, #E23B2E 33.3%, #3B63B8 33.3% 66.6%, #3FAE5A 66.6%); }
  header { display: block; margin-bottom: 14px; }
  header > div:first-child { background: #FFFFFF; padding: 10px 14px; }
  .logo { height: 38px; width: auto; display: block; }
  .company { font-size: 13pt; font-weight: 700; letter-spacing: 0.01em; color: #1B3A82; }
  .tagline { margin-top: 5px; font-size: 9pt; font-weight: 600; color: #4F5B73; letter-spacing: 0.01em; }
  .meta { text-align: left; padding: 14px 14px 16px; background: #1B3A82; background-image: linear-gradient(135deg, #1B3A82 0%, #142C66 100%); }
  .meta::after { content: ""; display: block; width: 40px; height: 3px; border-radius: 2px; background: #7AE3C8; margin-top: 10px; }
  .metatitle { margin-bottom: 4px; font-size: 11.5pt; font-weight: 700; color: #FFFFFF; }
  .v { font-size: 8.5pt; font-weight: 600; color: #C9D6F5; }
  .v + .v { margin-top: 2px; }
  .vmuted { font-weight: 500; }
`
