#!/usr/bin/env node
// Admin smoke test: opens every Social autopilot tab and the Leads screen with the REAL data
// files from data/*.json (no network, no sign-in, nothing is posted or saved), on today's date
// and on the first and last day of every dated (seasonal) ad, and fails on any page error,
// failed toast or blank tab. This is the check that catches a blank autopilot screen before
// it goes live.
//
// Run:  node scripts/admin_smoke.js            (needs Playwright: npm i -g playwright)
//       CHROMIUM_PATH=/path/to/chrome node scripts/admin_smoke.js
// Exit code 0 = all good, 1 = something broke (details printed).
const fs = require("fs");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  try { ({ chromium } = require(path.join(require("child_process").execSync("npm root -g").toString().trim(), "playwright"))); } catch (e2) {
    console.error("Playwright is not installed. Run: npm i -g playwright && npx playwright install chromium"); process.exit(2);
  }
}
const ROOT = path.resolve(__dirname, "..") + "/";
const SCRIPTS = ["admin/captions.js", "admin/igauto.js", "admin/socauto.js", "admin/vidauto.js", "admin/engage.js", "admin/fbauto.js"];
const MIN_TEXT = 150; // a tab with less text than this counts as blank

const files = {};
for (const f of fs.readdirSync(ROOT + "data")) if (f.endsWith(".json")) files["data/" + f] = JSON.parse(fs.readFileSync(ROOT + "data/" + f, "utf8"));

// Dates to try: today, plus the first and last day of each seasonal ad in igauto.js.
const today = new Date().toISOString().slice(0, 10);
const dates = new Set([today]);
for (const m of fs.readFileSync(ROOT + "admin/igauto.js", "utf8").matchAll(/from:\s*"(\d{4}-\d\d-\d\d)",\s*to:\s*"(\d{4}-\d\d-\d\d)"/g)) { dates.add(m[1]); dates.add(m[2]); }

const ESC = `s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))`;

async function autopilot(browser, day) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message + " " + String(e.stack || "").split("\n").slice(1, 3).join(" ").trim()));
  if (day !== today) await page.clock.install({ time: new Date(day + "T10:00:00") });
  await page.route("http://smoke.test/**", r => r.fulfill({ status: 200, contentType: "text/html",
    body: `<div id="top-actions"></div><span id="fa-badge"></span><div id="fa-alert"></div><section class="screen" id="screen-fbauto"><div id="fa-body"></div></section>` }));
  await page.goto("http://smoke.test/admin/");
  await page.evaluate(({ files, ESC }) => {
    window.__files = files; window.__toasts = [];
    window.FAV_CONFIG = { escapeHtml: (0, eval)(ESC), localPhone: x => x, formatPrice: n => "GH₵" + Number(n).toLocaleString() };
    window.FAV_ADMIN = {
      readJsonFile: async (f, e) => JSON.parse(JSON.stringify(window.__files[f] || e)),
      saveJson: async (f, m, msg, e) => { window.__files[f] = m(JSON.parse(JSON.stringify(window.__files[f] || e))); return window.__files[f]; },
      commitFiles: async o => o, backendSigned: async () => ({ ok: true }),
      products: () => files["data/products.json"], business: () => files["data/business.json"], productUrl: p => "https://favisionenterprize.github.io/p/" + p.id + ".html",
      signedIn: () => true, toast: (m, bad) => window.__toasts.push((bad ? "✗ " : "") + m), busy: () => {}, friendly: e => String(e && e.message || e), show: () => {}
    };
    window.open = () => null; // never open other sites
  }, { files, ESC });
  for (const f of SCRIPTS) await page.addScriptTag({ content: fs.readFileSync(ROOT + f, "utf8") });
  const res = await page.evaluate(async MIN => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = { tabs: {}, problems: [] };
    try { await window.FAV_FBAUTO.open(); } catch (e) { out.problems.push("open() threw: " + e.message); return out; }
    await wait(300);
    const keys = [...document.querySelectorAll("[data-fa-tab]")].map(b => b.dataset.faTab);
    if (!keys.length) out.problems.push("the screen is blank: no tabs drawn");
    for (const k of keys) {
      try { window.FAV_FBAUTO._test.setTab(k); } catch (e) { out.problems.push(`tab ${k} threw: ${e.message}`); continue; }
      await wait(200);
      const n = document.querySelector("#fa-body").innerText.length;
      out.tabs[k] = n;
      if (n < MIN) out.problems.push(`tab ${k} looks blank (${n} characters)`);
    }
    window.__toasts.filter(t => t.startsWith("✗")).forEach(t => out.problems.push("error toast: " + t));
    return out;
  }, MIN_TEXT);
  await page.close();
  return { tabs: res.tabs, problems: [...problems, ...res.problems] };
}

async function leads(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  const html = fs.readFileSync(ROOT + "admin/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  await page.route("http://smoke.test/admin/", r => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.route("https://backend.smoke.test/**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, customers: [
    { name: "Test Customer", phone: "0240000000", enquiries: [{ row: 2, when: new Date().toISOString(), product: "Student desk", source: "website", status: "New", notes: "" }],
      orders: [{ ref: "FAV-TEST1", when: new Date().toISOString(), product: "Sofa", total: 100, balance: 0, progress: "Delivered" }], invoices: [] }] }) }));
  await page.goto("http://smoke.test/admin/");
  await page.evaluate(({ files, ESC }) => {
    localStorage.setItem("fav-orders-key", "smoke");
    window.FAV_CONFIG = { escapeHtml: (0, eval)(ESC), formatPrice: n => "GH₵" + n };
    window.FAV_ADMIN = { business: () => Object.assign({}, files["data/business.json"], { enquiry_endpoint: "https://backend.smoke.test/exec" }), products: () => files["data/products.json"], toast: () => {} };
  }, { files, ESC });
  await page.addScriptTag({ content: fs.readFileSync(ROOT + "admin/leads.js", "utf8") });
  await page.evaluate(() => document.querySelector("[data-leads]").click());
  await page.waitForTimeout(800);
  await page.evaluate(() => { const b = document.querySelector("[data-lfilter=all]"); if (b) b.click(); });
  const n = await page.evaluate(() => document.querySelectorAll("#leads-body .order.lead").length);
  if (n < 2) problems.push(`Leads shows ${n} leads for a mock backend with 2`);
  await page.close();
  return { leads: n, problems };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let failed = 0;
  for (const day of [...dates].sort()) {
    const r = await autopilot(browser, day);
    const label = `Social autopilot on ${day}${day === today ? " (today)" : ""}`;
    if (r.problems.length) { failed++; console.log(`✗ ${label}`); r.problems.forEach(p => console.log("    " + p)); }
    else console.log(`✓ ${label}: ${Object.entries(r.tabs).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }
  const l = await leads(browser);
  if (l.problems.length) { failed++; console.log("✗ Leads"); l.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ Leads: ${l.leads} leads drawn`);
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll admin checks passed.");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
