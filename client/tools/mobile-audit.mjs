// Phone-view audit (390 px, touch). Usage:
//   node mobile-audit.mjs <role> count            -> prints how many static routes the role has
//   node mobile-audit.mjs <role> <start> <end>    -> audits static routes [start, end)
//   node mobile-audit.mjs <role> dyn              -> audits the detail pages found by the static runs
// Roles: admin hr finance manager employee. Results: .playwright-mcp/mobile/<role>.ndjson
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import path from "node:path"

// Needs playwright-core. Install it anywhere and point PLAYWRIGHT_CORE at its index.mjs,
// or install it in client/ (npm i -D playwright-core). See tools/README.txt.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core")
const BASE = process.env.AUDIT_BASE ?? "http://localhost:3100"
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const DESKTOP = process.env.DESKTOP === "1" // 1366 px sweep, no touch; results go to sweep/
const VP = DESKTOP ? { width: 1366, height: 900 } : { width: Number(process.env.AUDIT_WIDTH ?? 390), height: 844 }
const OUT = `${ROOT}/.playwright-mcp/${DESKTOP ? "sweep" : "mobile"}`
const CHROME = process.env.AUDIT_CHROME // optional path to a Chrome binary
const PW = process.env.AUDIT_PASSWORD ?? "Demo@12345" // the demo password of the dev database

const ROLES = {
  admin: { prefix: "/admin", login: { kind: "email", id: "admin@demo.com" }, extra: ["/sales"] },
  hr: { prefix: "/hr", login: { kind: "email", id: "hr@demo.com" }, extra: [] },
  finance: { prefix: "/finance", login: { kind: "email", id: "finance@demo.com" }, extra: [] },
  manager: { prefix: "/manager", login: { kind: "staff", id: "BS-MNG-00002" }, extra: ["/sales"] },
  employee: { prefix: "/employee", login: { kind: "staff", id: "BS-EMP-00010" }, extra: ["/sales"] },
}

const role = process.argv[2]
const ARG = process.argv[3]
const cfg = ROLES[role]
if (!cfg) throw new Error("role must be one of " + Object.keys(ROLES).join(", "))
fs.mkdirSync(`${OUT}/${role}`, { recursive: true })
const resultFile = `${OUT}/${role}.ndjson`
const dynFile = `${OUT}/${role}.dyn.txt`

// ---- routes from the app folder -------------------------------------------
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name === "page.tsx") acc.push(p)
  }
  return acc
}
const allRoutes = walk(`${ROOT}/client/app`).map((p) => {
  const rel = path.relative(`${ROOT}/client/app`, path.dirname(p)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s))
  return "/" + rel.join("/")
})
const prefixes = [cfg.prefix, ...cfg.extra]
const staticRoutes = allRoutes
  .filter((r) => prefixes.some((pre) => r === pre || r.startsWith(pre + "/")))
  .filter((r) => !r.includes("["))
  .sort()

if (ARG === "count") {
  console.log(staticRoutes.length)
  process.exit(0)
}
const isDyn = ARG === "dyn"
const START = isDyn ? 0 : Number(ARG)
const END = isDyn ? 0 : Number(process.argv[4])
if (!isDyn && START === 0) {
  fs.writeFileSync(resultFile, "")
  fs.writeFileSync(dynFile, "")
}
const UUID = /^(\/[^?#]*?)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|[/?#])/i
const patternOf = (href) => {
  const m = UUID.exec(href || "")
  return m ? m[1] + "/[id]" : null
}
const ONLY = (process.env.AUDIT_ONLY ?? "").split(",").filter(Boolean) // keep routes that contain one of these
const queue0 = isDyn ? fs.readFileSync(dynFile, "utf8").split("\n").filter(Boolean) : staticRoutes.slice(START, END)
const queue = ONLY.length ? queue0.filter((r) => ONLY.some((o) => r.includes(o))) : queue0

// ---- page measurements, run inside the page --------------------------------
const MEASURE = () => {
  const vw = document.documentElement.clientWidth // NOT innerWidth: phone mode stretches innerWidth to fit overflowing content
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const desc = (el) =>
    el.tagName.toLowerCase() +
    (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") +
    ((el.innerText || "").trim() ? ` "${el.innerText.trim().slice(0, 28).replace(/\s+/g, " ")}"` : "")
  // Only a REAL scroll box makes sideways content reachable: overflow auto/scroll, actually
  // scrolling, and narrower than the screen (a table wrapper). A parent with overflow
  // hidden or clip does NOT count: it cuts the content off, and the user can never see it.
  const insideRealScroller = (el) => {
    let p = el.parentElement
    while (p && p !== document.body) {
      const s = getComputedStyle(p)
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1 && p.getBoundingClientRect().width < vw - 1) return true
      p = p.parentElement
    }
    return false
  }
  const all = [...document.querySelectorAll("body *")].filter(visible).filter((el) => !el.closest("nextjs-portal"))
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
  const cands = all.filter((el) => el.matches('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],img,svg,h1,h2,h3,th,td') || hasOwnText(el))
  const off = cands.filter((el) => {
    if (getComputedStyle(el).position === "fixed") return false
    const r = el.getBoundingClientRect()
    if (r.width < 3 || r.height < 3) return false
    return (r.right > vw + 1 || r.left < -1) && !insideRealScroller(el)
  })
  const offSet = new Set(off)
  const offenders = off
    .filter((el) => !offSet.has(el.parentElement))
    .slice(0, 4)
    .map((el) => `${desc(el)} w=${Math.round(el.getBoundingClientRect().width)} right=${Math.round(el.getBoundingClientRect().right)}`)
  const fixedOver = all
    .filter((el) => getComputedStyle(el).position === "fixed" && el.getBoundingClientRect().right > vw + 1)
    .slice(0, 2)
    .map(desc)
  const tapSel = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=combobox]'
  const taps = [...document.querySelectorAll(tapSel)].filter(visible).filter((el) => !el.closest("[aria-hidden=true]") && !el.closest("nextjs-portal"))
  const inlineLink = (el) => el.tagName === "A" && getComputedStyle(el).display === "inline"
  const tiny = taps.filter((el) => {
    const r = el.getBoundingClientRect()
    return !inlineLink(el) && (r.height < 28 || r.width < 28)
  })
  const smallText = all.filter((el) => {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
    return own && parseFloat(getComputedStyle(el).fontSize) < 12
  })
  const zoomInputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea")]
    .filter(visible)
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
  const main = document.querySelector("main")
  const text = document.body.innerText || ""
  const flags = ["Internal server error", "Something went wrong", "Application error", "This page could not be found", "NaN", "undefined", "[object Object]", "Invalid Date"].filter((w) => text.includes(w))
  const menuBtn = [...document.querySelectorAll("button,[role=button]")].some(
    (b) => visible(b) && (/menu|sidebar|navigation/i.test(b.getAttribute("aria-label") || "") || b.getAttribute("data-sidebar") === "trigger" || /toggle sidebar/i.test(b.innerText || ""))
  )
  return {
    url: location.pathname,
    docOverflow: document.documentElement.scrollWidth - vw,
    offenders,
    clippedCount: off.length,
    fixedOver,
    tinyTaps: tiny.length,
    tinySample: tiny.slice(0, 3).map((el) => `${desc(el)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
    smallText: smallText.length,
    smallTextSample: smallText.slice(0, 2).map(desc),
    zoomInputs: zoomInputs.length,
    h1: document.querySelectorAll("h1").length,
    mainRatio: main ? +(main.getBoundingClientRect().width / vw).toFixed(2) : null,
    menuBtn,
    flags,
    skeletons: document.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.innerText.trim().slice(0, 120)).filter(Boolean).slice(0, 2),
    tabs: [...document.querySelectorAll('[role="tab"]')].filter(visible).map((t) => t.innerText.trim()).slice(0, 8),
    links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
  }
}

const slug = (r) => r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_") || "root"
const log = (o) => fs.appendFileSync(resultFile, JSON.stringify(o) + "\n")

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] })
const ctx = await browser.newContext({
  viewport: VP,
  isMobile: !DESKTOP,
  hasTouch: !DESKTOP,
  deviceScaleFactor: 1,
  ...(DESKTOP ? {} : { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }),
})
const page = await ctx.newPage()
const errs = []
page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 140)))
page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e.message).slice(0, 140)))
const bad = []
page.on("response", (r) => {
  const u = r.url()
  if (u.includes(":4100/") && r.status() >= 400) bad.push(`${r.status()} ${u.replace(/^.*:4100/, "").slice(0, 70)}`)
})

// ---- sign in ---------------------------------------------------------------
await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 120000 })
await page.getByText("Welcome back").first().waitFor({ timeout: 90000 })
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {})
if (cfg.login.kind === "email") {
  // The first click can land before the page is interactive, so click until the tab is selected.
  const adminTab = page.getByRole("tab", { name: "Administrator" })
  for (let i = 0; i < 10; i++) {
    await adminTab.click()
    await page.waitForTimeout(500)
    if ((await adminTab.getAttribute("aria-selected")) === "true") break
  }
  await page.getByRole("textbox", { name: "Email" }).fill(cfg.login.id)
} else {
  await page.getByRole("textbox", { name: "Employee ID" }).fill(cfg.login.id)
}
await page.getByRole("textbox", { name: "Password" }).fill(PW)
await page.getByRole("button", { name: "Sign in" }).click()
await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 240000 })

async function settle() {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {})
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length === 0, null, { timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(400)
}

let count = 0
for (const route of queue) {
  count++
  errs.length = 0
  bad.length = 0
  const rec = { role, route, issues: [] }
  const t0 = Date.now()
  try {
    await page.setViewportSize(VP)
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 120000 })
    await settle()
    const m = await page.evaluate(MEASURE)
    Object.assign(rec, m)
    rec.redirected = m.url !== route.split("?")[0] ? m.url : null
    if (!isDyn) {
      // remember one detail page for each pattern (e.g. /admin/employees/[id])
      const known = new Set(fs.readFileSync(dynFile, "utf8").split("\n").filter(Boolean).map(patternOf))
      for (const href of m.links) {
        const pat = patternOf(href)
        if (!pat || known.has(pat)) continue
        if (!prefixes.some((pre) => pat.startsWith(pre + "/"))) continue
        known.add(pat)
        fs.appendFileSync(dynFile, href.split(/[?#]/)[0] + "\n")
      }
    }
    delete rec.links
    if (!DESKTOP) {
      await page.setViewportSize({ width: 360, height: 780 })
      await page.waitForTimeout(300)
      rec.overflow360 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      await page.setViewportSize(VP)
    }
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${OUT}/${role}/${slug(route)}.jpg`, type: "jpeg", quality: 55 })
    rec.tabResults = []
    for (let i = 0; i < Math.min(m.tabs.length, 8); i++) {
      try {
        const tab = page.getByRole("tab").nth(i)
        if (!(await tab.isVisible())) continue
        await tab.click({ timeout: 4000 })
        await settle()
        const tm = await page.evaluate(MEASURE)
        rec.tabResults.push({ tab: m.tabs[i], docOverflow: tm.docOverflow, offenders: tm.offenders.slice(0, 2), tinyTaps: tm.tinyTaps })
        if (tm.docOverflow > 1) await page.screenshot({ path: `${OUT}/${role}/${slug(route)}__tab${i}.jpg`, type: "jpeg", quality: 55 })
      } catch (e) {
        rec.tabResults.push({ tab: m.tabs[i], error: String(e.message).slice(0, 60) })
      }
    }
    // First Add/New button: open its dialog to see if it fits a phone. Never submits.
    const cta = page.locator("main button:visible").filter({ hasText: /^(\+\s*)?(add|new|create|request|apply|invite|record)\b/i }).first()
    if (await cta.count()) {
      try {
        const label = (await cta.innerText()).trim().slice(0, 30)
        await cta.click({ timeout: 4000 })
        await page.waitForTimeout(700)
        const dlg = await page.evaluate(() => {
          const d = document.querySelector('[role="dialog"]')
          if (!d) return null
          const r = d.getBoundingClientRect()
          const vw = document.documentElement.clientWidth, vh = innerHeight
          const scrollable = d.scrollHeight > d.clientHeight || [...d.querySelectorAll("*")].some((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)
          const cut = [...d.querySelectorAll("input,select,textarea,button")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1) }).length
          return { w: Math.round(r.width), h: Math.round(r.height), vw, vh, fitsWidth: r.right <= vw + 1 && r.left >= -1, tallerThanScreen: r.height > vh + 1, scrollable, controlsOutside: cut }
        })
        rec.dialog = { label, ...dlg }
        if (dlg) await page.screenshot({ path: `${OUT}/${role}/${slug(route)}__dialog.jpg`, type: "jpeg", quality: 55 })
        await page.keyboard.press("Escape")
        await page.waitForTimeout(300)
      } catch (e) {
        rec.dialog = { error: String(e.message).slice(0, 60) }
      }
    }
  } catch (e) {
    rec.issues.push("NAV-FAIL " + String(e.message).slice(0, 80))
  }
  rec.secs = Math.round((Date.now() - t0) / 1000)
  rec.console = [...new Set(errs)].slice(0, 3)
  rec.api = [...new Set(bad)].slice(0, 4)
  log(rec)
  process.stdout.write(`${role} ${count}/${queue.length} ${route}\n`)
}

if (isDyn) {
  // the phone menu: open it once and keep a picture
  try {
    await page.goto(BASE + cfg.prefix, { waitUntil: "domcontentloaded" })
    await settle()
    const btn = page.locator('button[aria-label*="menu" i], button[aria-label*="sidebar" i], button[aria-label*="navigation" i], [data-sidebar="trigger"]').first()
    if (await btn.count()) {
      await btn.click({ timeout: 4000 })
      await page.waitForTimeout(700)
      await page.screenshot({ path: `${OUT}/${role}/__menu_open.jpg`, type: "jpeg", quality: 55 })
      log({ role, route: "__menu", menuOpened: true })
    } else {
      await page.screenshot({ path: `${OUT}/${role}/__menu_missing.jpg`, type: "jpeg", quality: 55 })
      log({ role, route: "__menu", menuOpened: false })
    }
  } catch (e) {
    log({ role, route: "__menu", error: String(e.message).slice(0, 80) })
  }
}
await browser.close()
console.log("DONE", role, ARG, count)
