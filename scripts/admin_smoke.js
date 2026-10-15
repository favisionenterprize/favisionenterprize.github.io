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
const SCRIPTS = ["admin/captions.js", "admin/igauto.js", "admin/ttshop.js", "admin/socauto.js", "admin/vidauto.js", "admin/engage.js", "admin/mkauto.js", "admin/profiles.js", "admin/ttcaptions.js", "admin/boost.js", "admin/fixall.js", "admin/fbauto.js"];
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

async function catalog(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  const html = fs.readFileSync(ROOT + "admin/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  await page.route("http://smoke.test/admin/", r => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto("http://smoke.test/admin/");
  await page.evaluate(({ files, ESC }) => {
    window.__commits = [];
    window.FAV_CONFIG = { escapeHtml: (0, eval)(ESC), formatPrice: n => "GH₵" + n };
    let list = files["data/products.json"];
    window.FAV_ADMIN = { products: () => list, signedIn: () => true, show: () => {}, toast: () => {}, friendly: String, refreshDash: () => {}, edit: id => { window.__edit = id; },
      commit: async o => { list = o.mutate(list); window.__commits.push(o.message); return list; } };
  }, { files, ESC });
  await page.addScriptTag({ content: fs.readFileSync(ROOT + "admin/catalog.js", "utf8") });
  await page.evaluate(() => document.querySelector("[data-catalog]").click());
  await page.waitForTimeout(300);
  await page.evaluate(() => { const t = document.querySelector('#screen-catalog [data-tab="products"]'); if (t) t.click(); }); // the hub opens on Overview
  await page.waitForTimeout(200);
  const rows = await page.evaluate(() => document.querySelectorAll(".cat-row").length);
  const want = files["data/products.json"].filter(p => !p.placeholder).length;
  if (rows !== want) problems.push(`catalog shows ${rows} products, expected ${want}`);
  await page.fill('.cat-row [data-cat-price]', "999"); await page.dispatchEvent('.cat-row [data-cat-price]', "change"); await page.waitForTimeout(200);
  const commits = await page.evaluate(() => window.__commits);
  if (!commits.length || !/price GH₵999/.test(commits[0])) problems.push("changing a price didn't save: " + JSON.stringify(commits));
  await page.close();
  return { rows, problems };
}

// TikTok shop card (admin/ttshop.js, top of the X & TikTok tab): draws the picked products in
// order, and moving / hiding / adding one and pressing Save commits the new "tiktok" positions.
async function ttshop(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  await page.route("http://smoke.test/**", r => r.fulfill({ status: 200, contentType: "text/html", body: `<div id="fa-body"></div>` }));
  await page.goto("http://smoke.test/admin/");
  await page.evaluate(({ files, ESC }) => {
    window.__commits = []; window.__toasts = [];
    let list = JSON.parse(JSON.stringify(files["data/products.json"]));
    window.__list = () => list;
    window.FAV_CONFIG = { escapeHtml: (0, eval)(ESC), formatPrice: n => "GH₵" + n };
    window.FAV_ADMIN = { products: () => list, business: () => files["data/business.json"], toast: (m, bad) => window.__toasts.push((bad ? "✗ " : "") + m), busy: () => {}, friendly: String, refreshDash: () => {},
      commit: async o => { list = o.mutate(list); window.__commits.push(o.message); return list; } };
  }, { files, ESC });
  await page.addScriptTag({ content: fs.readFileSync(ROOT + "admin/ttshop.js", "utf8") });
  await page.evaluate(() => { document.querySelector("#fa-body").innerHTML = window.FAV_TTSHOP.renderCard(); });
  const want = files["data/products.json"].filter(p => p.tiktok > 0).sort((a, b) => a.tiktok - b.tiktok).map(p => p.id);
  const ids = () => page.evaluate(() => [...document.querySelectorAll("#tts-card .tts-row")].map(r => r.dataset.id));
  const before = await ids();
  if (!before.length) problems.push("the TikTok shop card lists no products");
  if (want.length && before.join() !== want.join()) problems.push("card order doesn't match data/products.json tiktok positions");
  await page.click(`#tts-card .tts-row:nth-child(2) [data-tts=up]`);
  await page.click(`#tts-card .tts-row:nth-child(3) [data-tts=remove]`);
  const extra = await page.evaluate(() => { const o = document.querySelector("#tts-add option[value^='FAV']"); return o ? o.value : ""; });
  if (extra) await page.selectOption("#tts-add", extra);
  const expect = await ids();
  await page.click("#tts-card [data-tts=save]");
  await page.waitForTimeout(200);
  const res = await page.evaluate(() => ({ commits: window.__commits, toasts: window.__toasts,
    saved: window.__list().filter(p => p.tiktok > 0).sort((a, b) => a.tiktok - b.tiktok).map(p => p.id), btn: document.querySelector("#tts-card [data-tts=save]").textContent }));
  if (res.commits.length !== 1) problems.push("Save didn't commit once: " + JSON.stringify(res.commits));
  if (res.saved.join() !== expect.join()) problems.push(`saved order ${res.saved.join()} != shown ${expect.join()}`);
  if (expect[0] !== before[1] || expect.slice(0, extra ? -1 : undefined).includes(before[2]) || (extra && expect[expect.length - 1] !== extra)) problems.push("move up / hide / add didn't change the list as expected: " + before.slice(0, 4).join() + " -> " + expect.join() + " +" + extra);
  res.toasts.filter(t => t.startsWith("✗")).forEach(t => problems.push("error toast: " + t));
  await page.close();
  return { n: res.saved.length, problems };
}

// Marketplace tab (admin/mkauto.js) + profile card (admin/profiles.js): with a mock scan and mock buyer
// threads, checks the matching (missing / price differences / duplicates / not linked), that buyer text
// is escaped, that "Use … on the site" commits the price, and that the add-on jobs carry the right data.
async function marketplace(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  const LIVE = fs.readFileSync(path.join(ROOT, "extension/live.json"), "utf8");
  await page.route("http://smoke.test/**", r => /\/extension\/live\.json/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: "application/json", body: LIVE }) : r.fulfill({ status: 200, contentType: "text/html",
    body: `<div id="top-actions"></div><span id="fa-badge"></span><div id="fa-alert"></div><section class="screen" id="screen-fbauto"><div id="fa-body"></div></section>` }));
  await page.goto("http://smoke.test/admin/");
  const liveVersion = JSON.parse(LIVE).version;
  const prods = files["data/products.json"];
  const f1 = prods.find(p => p.id === "FAV-001").facebook_listings;
  const scan = { d: today, t: today + "T08:00:00Z", n: 5, listings: [
    { t: f1[0].title, price: 12000, status: "Active", listed: "2026-09-01", id: f1[0].id, renew: "ready" },
    { t: "Dinning Set with Chairs", price: 12600, status: "Active", listed: "2026-09-02", id: f1[1].id, renew: "wait", next: "2026-10-20" },
    { t: "Dinning Set with Chairs", price: 12600, status: "Active", listed: "2026-09-03", id: f1[2].id, renew: "ready" },
    { t: "Student Desk and Chair Set", price: 650, status: "Active", listed: "2026-10-01" },
    { t: "Kitchen blender", price: 300, status: "Active", listed: "2026-10-01", id: "999000111" },
    { t: "Old sofa", price: 100, status: "Sold", listed: "2026-01-01", id: "999000112" }
  ] };
  await page.evaluate(({ files, ESC, scan, liveVersion }) => {
    window.__files = files; window.__toasts = []; window.__commits = []; window.__jobs = [];
    window.__files["data/marketplace-scan.json"] = { settings: {}, scan, listed: [], runs: [], skip: [] };
    const d0 = new Date().toLocaleDateString("en-CA");
    window.__files["data/sounds.json"] = { d: "2026-01-01", sounds: [
      { name: "Afro Vibes Commercial", artist: "CML", platform: "tiktok", rank: 1 }, { name: "Highlife Groove", artist: "CML", platform: "tiktok", rank: 2 },
      { name: "<img src=x onerror=window.__xss=4>Evil", artist: "x", platform: "tiktok", rank: 3 }, { name: "Reel Tune", artist: "Meta", platform: "ig", rank: 1 } ],
      manual: [], used: [{ name: "Afro Vibes Commercial", platform: "tiktok", d: d0 }], notes: [] };
    window.__files["data/boost.json"] = { settings: { best_time: false }, pinned: [], stories: [], reels: [], runs: [] };
    window.__files["data/engagement.json"] = Object.assign({}, files["data/engagement.json"], { posts: { "https://www.tiktok.com/@fav/video/1": { net: "tiktok", url: "https://www.tiktok.com/@fav/video/1", title: "Luxury Leather Sofa Set in Accra", likes: 900, comments: 80, shares: 40, views: 30000 } } });
    // TikTok post ids start with the posting time (id >> 32 = Unix seconds): make them recent / old.
    const ttId = (agoH, k) => String((BigInt(Math.floor(Date.now() / 1000) - agoH * 3600) << 32n) + BigInt(k));
    const TT = { has: ttId(30, 1), desk: ttId(48, 2), tags: ttId(1, 3), old: ttId(9 * 24, 4), app: ttId(24, 5), prep: ttId(5 * 24, 6) };
    window.__files["data/tiktok-captions.json"] = { settings: { min: 20, max: 40, min_chars: 15, edit_days: 7 },
      prepared: { [TT.prep]: { p: "FAV-004", text: "Bold colour, warm welcomes.\nRed Glass Dining Set: GH₵12,600.\nComment 'MINE' 👇" } }, app_only: [TT.app],
      scan: { d: "2026-10-15", n: 6, posts: [
      { id: TT.has, url: "https://www.tiktok.com/@favision/video/" + TT.has, desc: "Luxury leather sofa set now in stock at our Odorkor showroom", thumb: "", alt: "" },
      { id: TT.desk, url: "https://www.tiktok.com/@favision/photo/" + TT.desk, desc: "", thumb: "https://p16.tiktokcdn.com/x.jpg", alt: "<img src=x onerror=window.__xss=3>student desk chair in a classroom" },
      { id: TT.tags, url: "javascript:alert(1)", desc: "#fyp #accra", thumb: "javascript:x", alt: "" },
      { id: TT.old, url: "https://www.tiktok.com/@favision/photo/" + TT.old, desc: "", thumb: "", alt: "dining set" },
      { id: TT.app, url: "https://www.tiktok.com/@favision/video/" + TT.app, desc: "", thumb: "", alt: "" },
      { id: TT.prep, url: "https://www.tiktok.com/@favision/photo/" + TT.prep, desc: "", thumb: "", alt: "" } ] }, fixed: {}, runs: [] };
    let list = JSON.parse(JSON.stringify(files["data/products.json"]));
    window.__list = () => list;
    document.documentElement.dataset.favautoExt = "5"; document.documentElement.dataset.favautoMode = "live";
    window.addEventListener("message", e => { if (e.data && e.data.type === "favauto-start") window.__jobs.push(e.data); });
    // The add-on's answer to "favauto-recheck" (extension/admin.js → background install(force) → status).
    window.__addon = { mode: "live", userScripts: true, version: liveVersion };
    window.addEventListener("message", e => { if (e.data && e.data.type === "favauto-recheck" && window.__addon) setTimeout(() => window.postMessage({ type: "favauto-status", status: window.__addon }, location.origin), 20); });
    window.confirm = () => true;
    window.FAV_CONFIG = { escapeHtml: (0, eval)(ESC), localPhone: x => String(x).replace(/^\+233/, "0"), formatPrice: n => "GH₵" + Number(n).toLocaleString() };
    window.FAV_ADMIN = {
      readJsonFile: async (f, e) => JSON.parse(JSON.stringify(window.__files[f] || e)),
      saveJson: async (f, m, msg, e) => { window.__files[f] = m(JSON.parse(JSON.stringify(window.__files[f] || e))); return window.__files[f]; },
      commit: async o => { list = o.mutate(list); window.__commits.push(o.message); return list; },
      commitFiles: async o => o, backendSigned: async () => ({ ok: true, text: "AI draft text" }),
      products: () => list, business: () => files["data/business.json"], productUrl: p => "https://favisionenterprize.github.io/p/" + p.id + ".html",
      signedIn: () => true, toast: (m, bad) => window.__toasts.push((bad ? "✗ " : "") + m), busy: () => {}, friendly: e => String(e && e.message || e), show: () => {}, refreshDash: () => {}
    };
    window.open = () => null;
  }, { files, ESC, scan, liveVersion });
  for (const f of SCRIPTS) await page.addScriptTag({ content: fs.readFileSync(ROOT + f, "utf8") });
  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    await window.FAV_FBAUTO.open(); await wait(200);
    window.FAV_MKAUTO._test.setInbox({ t: new Date().toISOString(), locked: 1, threads: [
      { url: "https://www.facebook.com/messages/t/1/", name: "<img src=x onerror=\"window.__xss=1\">Ama", listing: "Student Desk and Chair Set", snippet: "Is it available?", msgs: [{ me: false, text: "<script>window.__xss=2</script>Is this still available? Do you deliver to Kasoa?" }] },
      { url: "javascript:alert(1)", name: "Kojo", listing: "Dinning Set with Chairs", snippet: "How much", msgs: [] }
    ] });
    window.FAV_FBAUTO._test.setTab("market"); await wait(200);
    const an = window.FAV_MKAUTO.analyse();
    out.missing = an.missing.map(p => p.id); out.mismatch = an.mismatch.map(r => r.t); out.dups = an.dups.map(g => g.length);
    out.unmatched = an.unmatched.map(r => r.t); out.ready = an.ready.length; out.deskMatch = (an.rows[3].m || {}).p && an.rows[3].m.p.id;
    out.text = document.querySelector("#fa-body").innerText.length;
    out.imgs = document.querySelectorAll("#mk-inbox .mk-thread-head img, #mk-inbox .mk-msgs script").length;
    out.xss = window.__xss || 0;
    out.links = [...document.querySelectorAll("#mk-inbox a")].map(a => a.getAttribute("href"));
    out.draft = (document.querySelector("[data-mk-draft='0']") || {}).value || "";
    out.lockedNote = /PIN/.test(document.querySelector("#mk-inbox").innerText);
    // Use the Marketplace price on the site
    document.querySelector("[data-mk-price]").click(); await wait(200);
    out.price = window.__list().find(p => p.id === "FAV-001").price_ghs;
    // List one missing product → job payload
    const btn = document.querySelector("[data-mk-list]"); out.listPid = btn && btn.dataset.mkList; if (btn) btn.click(); await wait(200);
    document.querySelector("[data-mk=scan]").click(); await wait(100);
    document.querySelector("[data-mk=inbox]").click(); await wait(100);
    out.jobs = window.__jobs.map(j => ({ url: j.url, kind: j.job.kind, q: j.job.q }));
    // Profile card on the Engagement tab, Check button → first job
    window.FAV_FBAUTO._test.setTab("engage"); await wait(200);
    out.profCard = !!document.querySelector("#prof-card");
    window.__jobs = [];
    document.querySelector("#prof-form [data-prof=check]").click(); await wait(300);
    out.profJob = window.__jobs[0] && window.__jobs[0].job;
    // TikTok captions: its own tab (key "ttcap"), not on X & TikTok
    window.FAV_FBAUTO._test.setTab("social"); await wait(200);
    out.ttcOnSocial = !!document.querySelector("#ttc-card");
    const TC = window.FAV_TTCAPS, ttcSaved = JSON.parse(JSON.stringify(TC.state()));
    const TT = (([has, desk, tags, old, app, prep]) => ({ has, desk, tags, old, app, prep }))(ttcSaved.scan.posts.map(p => p.id));
    out.tt = TT;
    const card = () => { const c = document.querySelector("#ttc-card"), b = c && c.querySelector("[data-ttc='go']");
      return { buttons: c ? [...c.querySelectorAll(".fa-actions button")].filter(x => !x.closest(".ttc-review")).map(x => x.textContent.trim()) : [], go: !!b, disabled: b ? b.disabled : null, label: b ? b.textContent.trim() : "",
        review: !!(c && c.querySelector("details.ttc-review")), reviewOpen: !!(c && c.querySelector("details.ttc-review[open]")), split: ((c && c.querySelector("#ttc-split")) || {}).innerText || "", summary: ((c && c.querySelector("#ttc-summary")) || {}).innerText || "" }; };
    TC._test.set({ scan: null, fixed: {}, runs: [] });
    window.FAV_FBAUTO._test.setTab("ttcap"); await wait(200);
    out.ttcNoScan = card();
    // One press: scan job, chained to "ttcaps:fixall"
    window.__jobs = [];
    document.querySelector("#ttc-card [data-ttc='go']").click(); await wait(1000);
    out.ttcScanJob = window.__jobs[0] && window.__jobs[0].job;
    TC._test.setRun(null);
    TC._test.set(ttcSaved);
    window.FAV_FBAUTO._test.setTab("ttcap"); await wait(200);
    out.ttcTabs = [...document.querySelectorAll("[data-fa-tab]")].map(b => b.dataset.faTab);
    out.ttcMock = card();
    out.ttcLast = ((document.querySelector("#ttc-card") || {}).innerText || "").match(/Last read[^\n]*/) ;
    out.ttcLast = out.ttcLast ? out.ttcLast[0] : "";
    const tc = document.querySelector("#ttc-card");
    out.ttc = tc ? { posts: tc.querySelectorAll(".ttc-post").length, imgs: [...tc.querySelectorAll("img")].map(i => i.getAttribute("src")), links: [...tc.querySelectorAll("a")].map(a => a.getAttribute("href")),
      pick: (tc.querySelector(`[data-ttc-pick='${TT.desk}']`) || {}).value, text: (tc.querySelector(`[data-ttc-text='${TT.desk}']`) || {}).value || "",
      general: (tc.querySelector(`[data-ttc-text='${TT.tags}']`) || {}).value || "", prep: (tc.querySelector(`[data-ttc-text='${TT.prep}']`) || {}).value || "" } : null;
    out.xss2 = window.__xss || 0;
    // After the scan comes back: fix all, no review needed
    window.__jobs = [];
    await TC.fixAll([]); await wait(200);
    out.ttcFixJob = window.__jobs[0] && window.__jobs[0].job;
    TC._test.setRun(null);
    // Optional review: edit one caption and fix just that one
    const ta = document.querySelector(`[data-ttc-text='${TT.desk}']`);
    if (ta) { ta.value = out.ttc.text + "\nEdited."; ta.dispatchEvent(new Event("input", { bubbles: true })); }
    window.__jobs = [];
    const fx = document.querySelector(`[data-ttc-fix='${TT.desk}']`); if (fx) fx.click(); await wait(200);
    out.ttJob = window.__jobs[0] && window.__jobs[0].job;
    TC._test.setRun(null);
    // Summary after a fix run
    await TC.receive({ kind: "ttfix", n: 3, res: [{ id: TT.prep, ok: true }, { id: TT.desk, ok: true }, { id: TT.tags, ok: false, why: "TikTok didn't confirm the save" }] });
    window.FAV_FBAUTO._test.setTab("ttcap"); await wait(200);
    out.ttcAfter = card();
    // The add-on doesn't answer / has old scripts: a red message, no job.
    TC._test.statusMs(300);
    const goTry = async () => { window.__jobs = []; document.querySelector("#ttc-card [data-ttc='go']").click(); await wait(1200); TC._test.setRun(null);
      const el = document.querySelector("#ttc-alert"); return { jobs: window.__jobs.length, alert: el && !el.hidden ? el.textContent : "", toast: (window.__toasts || []).slice(-1)[0] || "" }; };
    const savedAddon = window.__addon;
    window.__addon = null; out.ttcNoAddon = await goTry();
    window.__addon = { ...savedAddon, version: "2026-01-01.1" }; out.ttcOldAddon = await goTry();
    window.__addon = { ...savedAddon, mode: "bundled" }; out.ttcBundled = await goTry();
    window.__addon = savedAddon; out.ttcOkAddon = await goTry();
    // The scan finds nothing (helper missing / page changed): Fix all still fixes the prepared ids, in batches.
    const now = BigInt(Math.floor(Date.now() / 1000));
    const pid = (agoH, k) => String(((now - BigInt(agoH * 3600)) << 32n) + BigInt(k));
    const P = { a: pid(100, 11), b: pid(50, 12), c: pid(10, 13), old: pid(24 * 8, 14), app: pid(20, 15), done: pid(30, 16) };
    const prepState = { settings: { min: 20, max: 40, min_chars: 15, edit_days: 7 }, scan: null, fixed: { [P.done]: { d: "2026-10-14", ok: true } }, runs: [], app_only: [P.app],
      prepared: Object.fromEntries(Object.values(P).map((id, i) => [id, { p: "FAV-014", text: "Prepared caption number " + i + " for this post.\nComment 'MINE' 👇" }])) };
    window.__files["data/tiktok-captions.json"] = JSON.parse(JSON.stringify(prepState));
    TC._test.set(prepState);
    TC._test.setRun({ stage: "scan", tried: [], done: 0 });
    out.ttcEmptyScan = await TC.receive({ kind: "ttscan", v: "x", res: [], noid: 7, helper: "", stopped: "No posts found in TikTok Studio → Posts." });
    out.ttcEmptyAlert = TC._test.alert();
    window.__jobs = [];
    await TC.fixAll([]); await wait(200);
    out.ttcPrepJob = window.__jobs[0] && window.__jobs[0].job;
    // First batch comes back (5 per batch; here 2 done and 1 more queued): saved, and the next fixAll skips them.
    out.ttcBatch = await TC.receive({ kind: "ttfix", v: "x", n: 3, more: 1, res: [{ id: P.a, ok: true }, { id: P.b, ok: false, why: "already has a description now, left as it is", skip: true }] });
    out.ttcFixedAfterBatch = [TC.state().fixed[P.a], TC.state().fixed[P.b]];
    out.ttcRunAfterBatch = TC._test.getRun();
    window.__jobs = [];
    await TC.fixAll([]); await wait(200);
    out.ttcNextJob = window.__jobs[0] && window.__jobs[0].job;
    TC._test.setRun(null);
    window.__toasts = (window.__toasts || []).filter(t => !/add-on|live\.json|read of your posts|ttids|old copy/i.test(t));   // the red messages above were on purpose
    TC._test.set(ttcSaved);
    window.__files["data/tiktok-captions.json"] = JSON.parse(JSON.stringify(ttcSaved));
    // ---------------- Quality gate (admin/captions.js ensure + fbauto launch) and the Fix all tab (admin/fixall.js)
    const CAP = window.FAV_CAPTIONS, FBA = window.FAV_FBAUTO._test;
    const d14 = window.__list().find(p => p.id === "FAV-014");
    out.gate = {
      blank: CAP.ensure("", d14, { net: "fb" }), tagsOnly: CAP.ensure("#fyp #accra", d14, { net: "tiktok" }),
      noTags: CAP.ensure("Luxury leather sofa set now in stock at our Odorkor showroom", d14, { net: "ig" }),
      xLong: CAP.ensure("A very long caption about our student desks ".repeat(10), d14, { net: "x" }),
      mk: CAP.ensure("Student desk and chair set, sturdy steel frame.\n\nOrder or see more: https://favisionenterprize.github.io/p/FAV-014.html", d14, { net: "mk" }),
      keep: CAP.ensure("Student desk and chair set in stock now. WhatsApp 0572646176 to order. #AccraFurniture", d14, { net: "fb" }),
      writes: Array.from({ length: 30 }, (_, i) => ["fb", "ig", "x", "tiktok", "youtube", "share"][i % 6]).map(net => ({ net, c: CAP.check(CAP.write(d14, { net }), { net }) })),
      jobs: [FBA.gateJob({ kind: "post", q: [{ g: "page", p: null, text: "" }, { g: "1", p: "FAV-014", text: "Desk set in stock now at Odorkor" }] }),
        FBA.gateJob({ kind: "x", q: [{ p: "FAV-014", text: "" }] }), FBA.gateJob({ kind: "youtube", q: [{ k: "v", description: "" }] }),
        FBA.gateJob({ kind: "mklist", q: [{ p: "FAV-014", text: "Short." }] }), FBA.gateJob({ kind: "story", p: "FAV-014", text: "Student Desk · GH₵650\nfavisionenterprize.github.io/p/FAV-014.html" })]
    };
    const FX = window.FAV_FIXALL;
    const fbPost = (id, text, kind) => ({ id, url: "https://www.facebook.com/FaVisionEnterprise/posts/" + id, text, kind: kind || "post" });
    const fxState = { settings: { min: 20, max: 40, scan_max: 100, mk_min: 60, web_min: 80 },
      fb: { scan: { d: "2026-10-15", n: 4, posts: [fbPost("111", ""), fbPost("112", "Luxury leather sofa set now in stock at our Odorkor showroom"), fbPost("113", "Great sofa deals this week at Odorkor #AccraFurniture"), fbPost("114", "", "shared"), fbPost("115", "<img src=x onerror=window.__xss=9>new")] }, fixed: {} },
      ig: { scan: { d: "2026-10-15", n: 2, posts: [{ id: "Cabc1", url: "https://www.instagram.com/p/Cabc1/", text: "#fyp", kind: "post" }, { id: "Cabc2", url: "https://www.instagram.com/p/Cabc2/", text: "Red glass dining set, six chairs, in stock now", kind: "post" }] }, fixed: {} },
      x: { scan: { d: "2026-10-15", n: 1, posts: [{ id: "1800000000000000001", url: "https://x.com/FaVisionEnt/status/1800000000000000001", text: "New sofas!", kind: "post" }] }, replied: {} }, mk: { fixed: {} }, runs: [] };
    window.__files["data/fix-all.json"] = JSON.parse(JSON.stringify(fxState));
    FX._test.set(JSON.parse(JSON.stringify(fxState)));
    window.FAV_FBAUTO._test.setTab("ttcap"); await wait(200);
    const fxc = document.querySelector("#fx-card");
    out.fx = { card: !!fxc, go: ((fxc && fxc.querySelector("[data-fx=all]")) || {}).textContent || "", ttInside: !!document.querySelector("#fa-body #ttc-card"),
      label: ((document.querySelector("[data-fa-tab=ttcap]") || {}).textContent || "").trim(), counts: FX.counts(), rows: fxc ? fxc.querySelectorAll(".fx-table tbody tr").length : 0,
      hot: document.querySelectorAll("#fx-fb .fx-pill.hot").length, xCant: /can't edit on X/.test((document.querySelector("#fx-x") || {}).innerText || ""), seek: document.querySelectorAll("#fx-web [data-fx-seek]").length,
      web: FX._test.webNeed().length, xss: window.__xss || 0, text: document.querySelector("#fa-body").innerText.length };
    const fq2 = FX._test.fixQueue("fb");
    out.fxQueue = fq2.map(x => ({ id: x.id, mode: x.mode, ok: CAP.check(x.text, { net: "fb" }).ok, tags: /#/.test(x.tags) }));
    out.mkQ = FX._test.mkQueue({ tried: [] }).map(x => ({ id: x.id, url: x.url, end: /Order or see more: https:\/\/favisionenterprize\.github\.io\/p\/FAV-\d+\.html$/.test(x.text), ask: /where are you (seeing|watching)/i.test(x.text) }));
    // One network: Fix Facebook Page → check add-on → scan job → (scan returns) → fix job in batches of 5
    window.__jobs = [];
    document.querySelector("#fx-fb [data-fx='net:fb']").click(); await wait(1200);
    out.fxScanJob = window.__jobs[0] && window.__jobs[0].job;
    out.fxScanRes = await FX.receive({ kind: "fxscan", net: "fb", v: "x", res: fxState.fb.scan.posts.concat([fbPost("116", ""), fbPost("117", ""), fbPost("118", ""), fbPost("119", ""), { id: "bad id!", url: "javascript:x", text: "" }]) });
    window.__jobs = [];
    FX.step("fx:fix:fb", ["report"]); await wait(200);
    out.fxFixJob = window.__jobs[0] && window.__jobs[0].job;
    out.fxBatch = await FX.receive({ kind: "fxfix", net: "fb", v: "x", n: 7, more: 2, res: [{ id: "111", ok: true, mode: "set" }, { id: "112", ok: true, mode: "tags" }, { id: "115", ok: false, skip: true, why: "already has a description and hashtags, left as it is" }, { id: "116", ok: true }, { id: "117", ok: false, why: "no “Edit post” in the post's menu" }] });
    window.__jobs = [];
    FX.step("fx:fix:fb", ["report"]); await wait(200);
    out.fxNextJob = window.__jobs[0] && window.__jobs[0].job;
    FX._test.setRun(null);
    // X: report only; reply needs a confirm
    window.FAV_FBAUTO._test.setTab("ttcap"); await wait(200);
    const xp = document.querySelector("[data-fx-xpick]"); if (xp) xp.checked = true;
    window.__jobs = [];
    document.querySelector("#fx-x [data-fx=xreply]").click(); await wait(200);
    out.fxReply = window.__jobs[0] && window.__jobs[0].job;
    FX._test.setRun(null);
    // The big button: add-on check, then the Facebook Page scan first
    window.__jobs = [];
    document.querySelector("#fx-card [data-fx=all]").click(); await wait(1200);
    out.fxAll = window.__jobs[0] && window.__jobs[0].job;
    FX._test.setRun(null);
    const keepAddon = window.__addon;
    window.__addon = null; window.__jobs = [];
    document.querySelector("#fx-card [data-fx=all]").click(); await wait(1200);
    out.fxSilent = { jobs: window.__jobs.length, alert: (document.querySelector("#fx-alert") || {}).hidden === false ? document.querySelector("#fx-alert").textContent : "" };
    window.__addon = keepAddon;
    window.__toasts = (window.__toasts || []).filter(t => !/add-on|Fix all|Facebook Page:/i.test(t));
    const soc = window.FAV_SOCAUTO.job("tiktok", { products: ["FAV-014"], limit: 1 });
    out.socText = soc && soc.job.q[0] && soc.job.q[0].text;
    window.FAV_FBAUTO._test.setTab("market"); await wait(100);
    // Boost tab
    const BS = window.FAV_BOOST;
    window.FAV_FBAUTO._test.setTab("boost"); await wait(200);
    out.boost = { text: document.querySelector("#fa-body").innerText.length, xss: window.__xss || 0, imgs: document.querySelectorAll("#fa-body .fa-card img").length };
    out.sound1 = BS.soundFor("tiktok"); out.sound2 = BS.soundFor("tiktok", [out.sound1 && out.sound1.name]);
    const tj = window.FAV_SOCAUTO.job("tiktok", { products: ["FAV-014", "FAV-016"], limit: 2 });
    out.ttSounds = tj ? tj.job.q.map(x => x.sound && x.sound.name) : [];
    out.favour = BS.favour();
    out.inSlot = BS.inSlot();
    BS.state().settings.best_time = true;
    out.defer = BS.deferSteps(["renew", "post", "ig", "tiktok", "mkscan"]);
    out.queue = JSON.parse(localStorage.getItem("fa-boost-queue") || "null");
    BS.state().settings.best_time = false; localStorage.removeItem("fa-boost-queue");
    window.__jobs = [];
    document.querySelector("[data-boost-refresh=tiktok]").click(); await wait(200);
    out.refreshTT = window.__jobs[0] && window.__jobs[0].job;
    window.__jobs = [];
    document.querySelector("[data-boost-refresh=ig]").click(); await wait(200);
    out.refreshIG = window.__jobs[0] && window.__jobs[0].job;
    out.pinStore = JSON.parse(localStorage.getItem("fa-boost-pin") || "null");
    await BS.afterRun({ kind: "tiktok", id: "zz", res: [{ ok: true, sound: "Highlife Groove", k: "x" }] });
    out.timers = (JSON.parse(localStorage.getItem("fa-boost-timers") || "[]")).length;
    out.used = window.__files["data/sounds.json"].used.map(u => u.name);
    // Favourite artists: default list, round-robin per post, found / not available counted and shown, add / remove
    out.artistsDefault = BS.sounds().settings.artists.slice();
    const tj2 = window.FAV_SOCAUTO.job("tiktok", { products: ["FAV-014", "FAV-016"], limit: 2 });
    out.favs = tj2 ? tj2.job.q.map(x => x.sound && x.sound.fav) : [];
    await BS.afterRun({ kind: "tiktok", id: "zz2", res: [{ ok: true, sound: "Fall", fav: "Davido", fav_found: true, k: "a" }, { ok: true, sound: "Highlife Groove", fav: "Kojo Blak", fav_tried: true, why: "artist not available in picker: Kojo Blak", k: "b" }] });
    out.favNext = BS.soundFor("tiktok");
    out.stats = BS.artistStats();
    window.FAV_FBAUTO._test.setTab("boost"); await wait(200);
    const ac = document.querySelector("#boost-artists-card");
    out.artistCard = ac ? ac.innerText : "";
    const fm = document.querySelector("#boost-artists");
    fm.elements.add.value = "Sarkodie"; fm.requestSubmit(); await wait(300);
    out.afterAdd = window.__files["data/sounds.json"].settings.artists.slice();
    document.querySelector("[data-boost-artist-del='1']").click(); await wait(300);
    out.afterDel = window.__files["data/sounds.json"].settings.artists.slice();
    // Today tab shows the Marketplace step and the run plan includes the scan only (listing defaults off)
    out.steps = window.FAV_FBAUTO._test.stepsToday();
    out.toasts = window.__toasts;
    return out;
  });
  const want = (c, msg) => { if (!c) problems.push(msg); };
  want(r.mismatch.length === 1 && r.mismatch[0] === f1[0].title, "price differences should be just the FAV-001 listing at 12000: " + JSON.stringify(r.mismatch));
  want(r.dups.length === 1 && r.dups[0] === 3, "expected one duplicate group of 3 (\"Dinning Sets with Chairs\" = \"Dinning Set with Chairs\"): " + JSON.stringify(r.dups));
  want(r.unmatched.length === 1 && r.unmatched[0] === "Kitchen blender", "expected only the blender unlinked: " + JSON.stringify(r.unmatched));
  want(r.deskMatch === "FAV-014", "the student desk listing should match FAV-014 by title, got " + r.deskMatch);
  want(!r.missing.includes("FAV-001") && !r.missing.includes("FAV-014") && r.missing.includes("FAV-002"), "missing list wrong: " + r.missing.join());
  want(r.ready === 2, "expected 2 listings ready to renew, got " + r.ready);
  want(r.imgs === 0 && !r.xss, "buyer text was not escaped (" + r.imgs + " elements, xss " + r.xss + ")");
  want(r.links.every(h => /^https:\/\/www\.facebook\.com\//.test(h)), "a thread link isn't a facebook.com link: " + r.links.join());
  want(/FAV-014\.html/.test(r.draft) && /available/i.test(r.draft) && /Odorkor/.test(r.draft) && /Kasoa|deliver/i.test(r.draft), "template draft missing facts: " + r.draft);
  want(r.lockedNote, "PIN-locked chats aren't mentioned");
  want(r.price === 12000, "Use price on site didn't commit 12000 (got " + r.price + ")");
  const lj = r.jobs.find(j => j.kind === "mklist"), it = lj && lj.q && lj.q[0];
  want(it && it.p === r.listPid && it.text.trim().endsWith(`Order or see more: https://favisionenterprize.github.io/p/${it.p}.html`) && it.imgs.length && it.imgs.every(u => u.startsWith("https://favisionenterprize.github.io/assets/")) && it.cond === "New" && it.cats.length, "mklist job is wrong: " + JSON.stringify(it).slice(0, 400));
  want(it && !/where are you (seeing|watching)/i.test(it.text), "Marketplace description still has the comment ask");
  want(r.jobs.some(j => j.kind === "mkscan" && /marketplace\/you\/selling/.test(j.url)) && r.jobs.some(j => j.kind === "mkinbox"), "scan / inbox jobs not launched: " + JSON.stringify(r.jobs.map(j => j.kind)));
  want(r.profCard && r.profJob && r.profJob.kind === "profile" && r.profJob.net === "fb" && r.profJob.mode === "check" && /favisionenterprize/.test(r.profJob.link) && /Fresh stock/.test(r.profJob.pin), "profile check job wrong: " + JSON.stringify(r.profJob));
  want(!r.ttcOnSocial, "TikTok captions card should no longer be on the X & TikTok tab");
  want((r.ttcTabs || []).join() .includes("social,ttcap,"), "TikTok captions tab should come right after X & TikTok: " + (r.ttcTabs || []).join());
  const T = r.tt || {};
  want(r.ttcNoScan && r.ttcNoScan.go && r.ttcNoScan.buttons.length === 1 && r.ttcNoScan.label === "✨ Fix all TikTok descriptions" && r.ttcNoScan.disabled === false, "before any scan there is ONE enabled button, Fix all TikTok descriptions: " + JSON.stringify(r.ttcNoScan));
  want(r.ttcScanJob && r.ttcScanJob.kind === "ttscan" && r.ttcScanJob.max === 500 && (r.ttcScanJob.then || [])[0] === "ttcaps:fixall", "the button reads all posts (max 500) then chains Fix all: " + JSON.stringify(r.ttcScanJob));
  want(r.ttcMock && r.ttcMock.buttons.length === 1 && r.ttcMock.go && r.ttcMock.review && !r.ttcMock.reviewOpen, "with a scan: still one button, Review captions collapsed: " + JSON.stringify(r.ttcMock));
  want(/^Last read 2026-10-15: 6 posts, 5 without a description, 1 without hashtags\.$/.test(r.ttcLast || ""), "Last read line wording: " + r.ttcLast);
  want(/4 fixed by the button now/.test(r.ttcMock.split) && /1 post over 7 days old/.test(r.ttcMock.split) && /App only/.test(r.ttcMock.split) && r.ttcMock.split.includes(T.app), "split: 3 now, 1 too old, 1 app-only: " + r.ttcMock.split);
  const tt = r.ttc || {};
  want(tt.posts === 4, "Review captions lists the 4 posts the button will fix (3 captions + 1 hashtags only), got " + tt.posts);
  want(tt.pick === "FAV-014" && /Comment/i.test(tt.text) && /favisionenterprize\.github\.io\/tiktok\//.test(tt.text) && /GH₵650/.test(tt.text) && !/where are you seeing/i.test(tt.text), "classy caption for the student desk post: " + tt.text);
  want(/favisionenterprize\.github\.io\/tiktok\//.test(tt.general) && /statement/.test(tt.general) && !/GH₵|GHS|₵/.test(tt.general), "no confident product → general caption, no price: " + tt.general);
  want(/^Bold colour, warm welcomes\./.test(tt.prep), "a prepared caption (from the post's photos) is used as is: " + tt.prep);
  want(!r.xss2 && (tt.imgs || []).every(u => /^https:/.test(u)) && (tt.links || []).every(h => /^https:\/\//.test(h)), "TikTok card escapes text and only shows https thumbnails/links: " + JSON.stringify([tt.imgs, tt.links]));
  const fq = (r.ttcFixJob && r.ttcFixJob.q) || [];
  want(r.ttcFixJob && r.ttcFixJob.kind === "ttfix" && fq.map(x => x.id).join() === [T.prep, T.desk, T.has, T.tags].join() && /^Bold colour/.test(fq[0].text) && fq.filter(x => x.mode !== "tags").every(x => x.text.length > 20 && /#\w/.test(x.text)) && fq[2].mode === "tags" && /^#/.test(fq[2].tags), "Fix all queues every editable post, oldest first, prepared caption first, none too old / app-only: " + JSON.stringify(fq.map(x => [x.id, x.text.slice(0, 30)])));
  want(r.ttJob && r.ttJob.kind === "ttfix" && r.ttJob.q.length === 1 && r.ttJob.q[0].id === T.desk && /\nEdited\.$/.test(r.ttJob.q[0].text), "Fix just this one sends the edited caption: " + String(JSON.stringify(r.ttJob)).slice(0, 300));
  want(/Last fix .*: 2 of 3 descriptions added, 1 failed/.test(r.ttcAfter && r.ttcAfter.summary), "final summary on the card: " + JSON.stringify(r.ttcAfter));
  want(r.ttcNoAddon && !r.ttcNoAddon.jobs && /didn't answer/.test(r.ttcNoAddon.alert) && /edge:\/\/extensions/.test(r.ttcNoAddon.alert), "add-on silent → red message, no job: " + JSON.stringify(r.ttcNoAddon));
  want(r.ttcOldAddon && !r.ttcOldAddon.jobs && /old scripts/.test(r.ttcOldAddon.alert), "add-on with old scripts → red message, no job: " + JSON.stringify(r.ttcOldAddon));
  want(r.ttcBundled && !r.ttcBundled.jobs && /live/.test(r.ttcBundled.alert), "add-on not in live mode → red message, no job: " + JSON.stringify(r.ttcBundled));
  want(r.ttcOkAddon && r.ttcOkAddon.jobs === 1 && !r.ttcOkAddon.alert, "add-on up to date → the scan starts, no red message: " + JSON.stringify(r.ttcOkAddon));
  const PJ = r.ttcPrepJob || {}, PQ = (PJ.q || []).map(x => x.id), NQ = ((r.ttcNextJob || {}).q || []).map(x => x.id);
  want(r.ttcEmptyScan && r.ttcEmptyScan.bad && /ttids\.js/.test(r.ttcEmptyAlert || ""), "empty scan with unread rows: says the helper didn't run: " + JSON.stringify([r.ttcEmptyScan, r.ttcEmptyAlert]));
  want(PJ.kind === "ttfix" && PQ.length === 3 && PQ.every((id, i) => !i || BigInt(PQ[i - 1]) < BigInt(id)) && PJ.batch === 5 && (PJ.cont || [])[0] === "ttcaps:fixall" && PJ.q.every(x => /^Prepared caption/.test(x.text)), "scan found nothing → Fix all still queues the prepared ids (not done, not app-only, not over 7 days), oldest first, batches of 5: " + JSON.stringify([PQ, PJ.batch, PJ.cont]));
  want(r.ttcFixedAfterBatch && r.ttcFixedAfterBatch[0] && r.ttcFixedAfterBatch[0].ok && r.ttcFixedAfterBatch[1] && r.ttcFixedAfterBatch[1].skip, "each batch is saved to the log (ok / skipped): " + JSON.stringify(r.ttcFixedAfterBatch));
  want(r.ttcRunAfterBatch && r.ttcRunAfterBatch.done === 2 && NQ.length === 1 && !NQ.includes(PQ[0]) && !NQ.includes(PQ[1]) && r.ttcNextJob.wait_first, "next batch continues with the rest, waiting 20–40 s first: " + JSON.stringify([NQ, r.ttcRunAfterBatch]));
  want(/favisionenterprize\.github\.io\/tiktok\//.test(r.socText || "") && /Comment|Tell us below/i.test(r.socText || ""), "new TikTok autopilot posts use the classy caption by default: " + r.socText);
  const g = r.gate || {}, CK = t => ({ desc: t.replace(/https?:\/\/\S+/g, "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").trim().length >= 15, tags: /#[\p{L}\p{N}_]{2,}/u.test(t) });
  want(CK(g.blank).desc && CK(g.blank).tags && /FAV-014|Student|desk/i.test(g.blank), "gate: a blank caption becomes a full one for the product: " + g.blank);
  want(CK(g.tagsOnly).desc && CK(g.tagsOnly).tags && /tiktok\//.test(g.tagsOnly), "gate: hashtags-only TikTok text becomes a classy caption: " + g.tagsOnly);
  want(/^Luxury leather sofa set/.test(g.noTags) && CK(g.noTags).tags, "gate: text without hashtags keeps its words and gets the hashtag mix: " + g.noTags);
  want(g.xLong.length <= 280 && CK(g.xLong).tags, "gate: X stays within 280 with hashtags: " + g.xLong.length);
  want(!/#\w/.test(g.mk) && /Order or see more/.test(g.mk), "gate: Marketplace needs no hashtags: " + g.mk);
  want(g.keep === "Student desk and chair set in stock now. WhatsApp 0572646176 to order. #AccraFurniture", "gate: a complete caption is left exactly as it is: " + g.keep);
  want((g.writes || []).every(w => w.c.ok), "gate: every written caption has a description, hashtags and a call to action: " + JSON.stringify((g.writes || []).filter(w => !w.c.ok)));
  const [gj1, gj2, gj3, gj4, gj5] = g.jobs || [];
  want(gj1 && gj1.q.every(x => CK(x.text).desc && CK(x.text).tags) && /^Desk set in stock now at Odorkor/.test(gj1.q[1].text), "gate in launch: Facebook Page / group posts always leave with a description and hashtags: " + JSON.stringify(gj1 && gj1.q.map(x => x.text.slice(0, 60))));
  want(gj2 && gj2.q[0].text.length <= 280 && CK(gj2.q[0].text).desc && CK(gj2.q[0].text).tags, "gate in launch: X: " + (gj2 && gj2.q[0].text));
  want(gj3 && CK(gj3.q[0].description).desc && /#Shorts|#\w/.test(gj3.q[0].description), "gate in launch: YouTube description: " + (gj3 && gj3.q[0].description.slice(0, 80)));
  want(gj4 && CK(gj4.q[0].text).desc, "gate in launch: Marketplace listing text: " + (gj4 && gj4.q[0].text.slice(0, 80)));
  want(gj5 && /FAV-014\.html/.test(gj5.text) && /WhatsApp|order/i.test(gj5.text) && /#\w/.test(gj5.text), "gate in launch: story text has the link, a call to action and a hashtag: " + (gj5 && gj5.text));
  const fx = r.fx || {}, fc = fx.counts || {};
  want(fx.card && fx.label === "Fix all" && /Fix all everywhere/.test(fx.go) && fx.ttInside && fx.rows === 8 && fx.text > 1500, "Fix all tab: one big button, the table of 8 rows and the TikTok card inside: " + JSON.stringify(fx).slice(0, 300));
  want(fc.fb && fc.fb.desc === 1 && fc.fb.tags === 2 && fc.ig.desc === 1 && fc.ig.tags === 1 && fc.x.desc === 1 && fc.tt.desc === 5 && fc.tt.tags === 1 && fx.hot >= 1 && fx.xCant, "Fix all counts per network (shared posts left out), highlighted: " + JSON.stringify(fc));
  want(!fx.xss, "Fix all escapes post text");
  want(fx.seek === Math.min(40, fx.web) && fx.web > 0, "Website / shop lists products needing text, each with a Seek button: " + JSON.stringify([fx.seek, fx.web]));
  want((r.fxQueue || []).length === 3 && r.fxQueue.every(x => x.ok && x.tags) && r.fxQueue.find(x => x.id === "112").mode === "tags" && r.fxQueue.find(x => x.id === "111").mode === "set", "Facebook fix queue: fresh gated captions, hashtags-only for the post with text: " + JSON.stringify(r.fxQueue));
  want((r.mkQ || []).length > 0 && r.mkQ.every(x => x.end && !x.ask && /^https:\/\/www\.facebook\.com\/marketplace\/edit\/\?listing_id=/.test(x.url)), "Marketplace fix queue: linked listings, edit URL, description ending with the product link: " + JSON.stringify(r.mkQ));
  const sj = r.fxScanJob || {}, fj = r.fxFixJob || {}, nj = r.fxNextJob || {};
  want(sj.kind === "fxscan" && sj.net === "fb" && sj.max === 100 && (sj.then || [])[0] === "fx:fix:fb", "Fix Facebook Page: add-on check, then the scan, chained to the fix: " + JSON.stringify(sj).slice(0, 200));
  want(r.fxScanRes && /without a description/.test(r.fxScanRes.text), "scan result saved and summed up: " + JSON.stringify(r.fxScanRes));
  want(fj.kind === "fxfix" && fj.net === "fb" && fj.q.length === 7 && fj.batch === 5 && (fj.cont || [])[0] === "fx:fix:fb" && (fj.then || []).join() === "report" && fj.q.every(x => /^https:\/\/www\.facebook\.com\//.test(x.url)) && !fj.q.some(x => x.id === "113" || x.id === "114"), "fix job: the 7 posts that need it (not the fine one, not the shared one), batches of 5: " + JSON.stringify(fj.q && fj.q.map(x => [x.id, x.mode])));
  want(nj.kind === "fxfix" && nj.wait_first && nj.q.map(x => x.id).join() === "118,119", "next batch: only the posts not tried yet, waiting 20–40 s first: " + JSON.stringify(nj.q && nj.q.map(x => x.id)));
  const rp = r.fxReply || {};
  want(rp.kind === "fxreply" && rp.q.length === 1 && rp.q[0].text.length <= 280 && /#\w/.test(rp.q[0].text) && /\/status\/1800000000000000001$/.test(rp.q[0].url), "X: reply with a description (after confirm), ≤ 280 with hashtags: " + JSON.stringify(rp).slice(0, 300));
  want(r.fxAll && r.fxAll.kind === "fxscan" && r.fxAll.net === "fb" && (r.fxAll.then || []).join().startsWith("fx:fix:fb,fx:scan:ig,fx:fix:ig,fx:scan:x,mkscan,fx:fix:mk,ttcaps:all,fx:done"), "Fix all everywhere: Facebook Page → Instagram → X → Marketplace → TikTok: " + JSON.stringify(r.fxAll && r.fxAll.then));
  want(r.fxSilent && !r.fxSilent.jobs && /didn't answer/.test(r.fxSilent.alert), "Fix all: add-on silent → red message, no job: " + JSON.stringify(r.fxSilent));
  const b = r.boost || {};
  want(b.text > 500 && !b.xss && !b.imgs, "Boost tab draws and escapes sound names: " + JSON.stringify(b));
  want(r.sound1 && r.sound1.name === "Highlife Groove" && r.sound2 && r.sound2.name !== "Highlife Groove" && r.sound2.name !== "Afro Vibes Commercial", "sound rotation skips sounds used in the last 3 days: " + JSON.stringify([r.sound1, r.sound2]));
  want(r.ttSounds.length === 2 && r.ttSounds[0] && r.ttSounds[0] !== r.ttSounds[1], "each TikTok post gets a different trending sound: " + JSON.stringify(r.ttSounds));
  want(r.favour.includes("FAV-016"), "What's working picks the top post's product (FAV-016): " + JSON.stringify(r.favour));
  want(r.inSlot ? r.defer.length === 5 : (r.defer.join() === "renew,mkscan" && r.queue && r.queue.steps.join() === "post,ig,tiktok"), "best-time posting holds the posting steps until the next slot: " + JSON.stringify([r.inSlot, r.defer, r.queue]));
  want(r.refreshTT && r.refreshTT.kind === "tiktok" && r.refreshTT.q.length === 1 && r.refreshTT.q[0].p === "FAV-014" && r.refreshTT.q[0].sound && (r.refreshTT.then || [])[0] === "pinswap:tiktok", "Refresh pinned on TikTok posts FAV-014 with a sound, then pins: " + JSON.stringify(r.refreshTT).slice(0, 300));
  want(r.refreshIG && r.refreshIG.q[0].video && /\.mp4$/.test(r.refreshIG.q[0].img) && (r.refreshIG.then || [])[0] === "pinswap:ig", "Refresh pinned on Instagram posts our Short as a Reel: " + JSON.stringify(r.refreshIG && r.refreshIG.q[0]).slice(0, 300));
  want(r.pinStore && r.pinStore.tiktok && r.pinStore.tiktok.pin && /Fresh stock/.test(r.pinStore.tiktok.unpin), "new post to pin and old one to unpin are remembered: " + JSON.stringify(r.pinStore));
  want(r.artistsDefault.join() === "Davido,Kojo Blak,Hillsong Worship" && r.favs.length === 2 && r.favs[0] && r.favs[0] !== r.favs[1], "favourite artists: default list, a different artist each post: " + JSON.stringify([r.artistsDefault, r.favs]));
  want(r.favNext && r.favNext.fav === "Hillsong Worship" && r.favNext.avoid.includes("Fall") && r.favNext.name, "next post tries the artist tried longest ago, avoids the track used lately, keeps a trending fallback: " + JSON.stringify(r.favNext));
  want(r.stats.find(x => x.a === "Davido").found === 1 && r.stats.find(x => x.a === "Kojo Blak").missing === 1 && /found 1/.test(r.artistCard) && /not available 1/.test(r.artistCard), "Boost tab shows found / not available per artist: " + JSON.stringify(r.stats) + " " + r.artistCard.slice(0, 200));
  want(r.afterAdd.join() === "Davido,Kojo Blak,Hillsong Worship,Sarkodie" && r.afterDel.join() === "Davido,Hillsong Worship,Sarkodie", "artists can be added and removed (data/sounds.json settings.artists): " + JSON.stringify([r.afterAdd, r.afterDel]));
  want(r.timers === 3 && r.used.includes("Highlife Groove"), "after a TikTok post: 3 first-hour reply checks and the sound noted: " + JSON.stringify([r.timers, r.used]));
  want(!r.steps.includes("mklist"), "listing must be off in the daily run by default: " + r.steps.join());
  (r.toasts || []).filter(t => t.startsWith("✗")).forEach(t => problems.push("error toast: " + t));
  await page.close();
  return { problems, n: r.missing.length };
}

// SEO & AI screen (admin/seo.js): draws the real data/seo-report.json, "Apply fix" previews and
// saves into data/seo-fixes.json only after a confirm, "Run check now" starts the workflow, and
// when GitHub refuses it runs the quick in-browser check against the site's own files.
async function seo(browser, shot) {
  const page = await browser.newPage({ viewport: { width: shot ? 1280 : 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  const html = fs.readFileSync(ROOT + "admin/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  await page.route("http://smoke.test/**", r => {
    const u = new URL(r.request().url());
    if (u.pathname === "/admin/") return r.fulfill({ status: 200, contentType: "text/html", body: html });
    let f = decodeURIComponent(u.pathname).replace(/^\//, ""); if (!f || f.endsWith("/")) f += "index.html";
    if (!fs.existsSync(ROOT + f)) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({ status: 200, body: fs.readFileSync(ROOT + f), contentType: f.endsWith(".html") ? "text/html" : f.endsWith(".json") ? "application/json" : "text/plain" });
  });
  await page.goto("http://smoke.test/admin/");
  await page.addStyleTag({ content: fs.readFileSync(ROOT + "admin/admin.css", "utf8") });
  await page.evaluate(({ files }) => {
    window.__saves = []; window.__gh = []; window.__ghFail = false; window.confirm = () => true;
    let fx = files["data/seo-fixes.json"] || { applied: [] };
    window.FAV_ADMIN = { signedIn: () => true, toast: () => {}, busy: () => {}, friendly: e => e.message,
      readJsonFile: async (p, fb) => p === "data/seo-fixes.json" ? fx : (files[p] || fb),
      saveJson: async (p, m, msg, fb) => { fx = m(JSON.parse(JSON.stringify(fx || fb))); window.__saves.push({ p, msg, fx }); return fx; },
      gh: async (path, o) => { window.__gh.push([path, o && o.method]); if (window.__ghFail) throw Object.assign(new Error("Resource not accessible"), { status: 403 }); return null; } };
  }, { files });
  await page.addScriptTag({ content: fs.readFileSync(ROOT + "admin/seo.js", "utf8") });
  await page.evaluate(() => document.querySelector("[data-seo]").click());
  await page.waitForTimeout(400);
  const r = files["data/seo-report.json"];
  const st = await page.evaluate(() => ({ text: (document.querySelector("#seo-body") || {}).innerText || "", issues: document.querySelectorAll("#seo-body .seo-issue").length,
    fixBtns: document.querySelectorAll("[data-seo-fix]").length, kw: document.querySelectorAll(".seo-table tr").length }));
  if (st.text.length < MIN_TEXT) problems.push("SEO screen is blank");
  if (!st.text.includes(String(r.score))) problems.push("score " + r.score + " not shown");
  if (st.issues < Math.min(3, r.issues.length)) problems.push(`only ${st.issues} issues drawn of ${r.issues.length}`);
  if (shot) { await page.screenshot({ path: shot, fullPage: true }); }
  let applied = null;
  if (st.fixBtns) {
    await page.click("[data-seo-fix]"); await page.waitForTimeout(100);
    const pv = await page.evaluate(() => (document.querySelector(".seo-prev") || {}).innerText || "");
    if (!/Confirm/.test(pv)) problems.push("Apply fix shows no preview");
    if ((await page.evaluate(() => window.__saves.length))) problems.push("a fix was saved before Confirm");
    await page.click("[data-seo-apply]"); await page.waitForTimeout(200);
    applied = await page.evaluate(() => window.__saves[0]);
    if (!applied || applied.p !== "data/seo-fixes.json" || !applied.fx.applied.length) problems.push("Confirm & apply didn't save data/seo-fixes.json: " + JSON.stringify(applied));
    if (!(await page.evaluate(() => /Applied ✓/.test(document.querySelector("#seo-body").innerText)))) problems.push("applied fix not marked Applied");
  } else problems.push("no Apply fix buttons");
  await page.click("#seo-run"); await page.waitForTimeout(200);
  const run = await page.evaluate(() => ({ gh: window.__gh, status: (document.querySelector("#seo-status") || {}).innerText || "" }));
  if (!run.gh.length || !/actions\/workflows\/seo-watch\.yml\/dispatches/.test(run.gh[0][0]) || run.gh[0][1] !== "POST") problems.push("Run check now didn't dispatch the workflow: " + JSON.stringify(run.gh));
  if (!/Running/.test(run.status)) problems.push("no Running… status: " + run.status);
  await page.evaluate(() => { window.__ghFail = true; localStorage.removeItem("fa-seo-run"); });
  await page.click("#seo-run"); await page.waitForTimeout(2500);
  const q = await page.evaluate(() => ({ status: (document.querySelector("#seo-status") || {}).innerText || "", issues: document.querySelectorAll("#seo-body .seo-issue").length }));
  if (!/Quick check/.test(q.status) || !q.issues) problems.push("refused dispatch didn't fall back to the quick check: " + q.status.slice(0, 200));
  await page.close();
  return { problems, score: r.score, issues: st.issues, applied: applied && applied.fx.applied[0].kind };
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
  const c = await catalog(browser);
  if (c.problems.length) { failed++; console.log("✗ Facebook catalog"); c.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ Facebook catalog: ${c.rows} products, price edit saves`);
  const t = await ttshop(browser);
  if (t.problems.length) { failed++; console.log("✗ TikTok shop card"); t.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ TikTok shop card: reorder, hide, add and save work (${t.n} products saved)`);
  const m = await marketplace(browser);
  if (m.problems.length) { failed++; console.log("✗ Marketplace tab / profile card"); m.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ Marketplace tab: matching, duplicates, escaping, price commit and add-on jobs work (${m.n} products not listed in the mock scan); profile card launches its check; Fix all tab: counts per network, gated captions, scan → fix in batches, X reply, Marketplace queue, red alert; quality gate on every posting job; TikTok captions card lists empty posts, writes classy captions and launches the fix; Boost: sounds rotate, best-time queue, refresh pinned, first-hour timers, What's working`);
  const so = await seo(browser, process.env.SEO_SHOT || "");
  if (so.problems.length) { failed++; console.log("✗ SEO & AI screen"); so.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ SEO & AI screen: score ${so.score}, ${so.issues} issues drawn, Apply fix (${so.applied}) saves after preview + confirm, Run check now dispatches seo-watch.yml, quick check fallback works`);
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll admin checks passed.");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
