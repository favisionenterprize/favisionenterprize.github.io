#!/usr/bin/env node
// Admin smoke test: opens every Social autopilot tab, the Leads screen and the What's in the Box ads screen with the REAL data
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
const SCRIPTS = ["admin/captions.js", "admin/igauto.js", "admin/ttshop.js", "admin/socauto.js", "admin/vidauto.js", "admin/trendvideo.js", "admin/engage.js", "admin/mkauto.js", "admin/profiles.js", "admin/viral.js", "admin/ttcaptions.js", "admin/boost.js", "admin/fixall.js", "admin/brands.js", "admin/aiplan.js", "admin/brandstamp.js", "admin/relay.js", "admin/fbauto.js", "admin/openitems.js", "admin/prime.js"];
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
  // ⚡ Prime: every lane starts at once, jobs use the 8–12 s floor (no optional waits), each lane chains to the end, the
  // admin lane finishes in seconds, and the parallel plan's non-posting work fits well inside 6 minutes.
  if (day === today) {
    const pr = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const P = window.FAV_PRIME, F = window.FAV_FBAUTO, AP = window.FAV_AIPLAN;
      const out = { problems: [] };
      P._test.reset();
      document.documentElement.dataset.favautoExt = "5"; document.documentElement.dataset.favautoMode = "live"; document.documentElement.dataset.favautoUs = "1"; document.documentElement.dataset.favautoShell = "5.5.0";
      await AP.load(); const plan = AP._test.state();
      // M8 still Proposed → Prime refuses
      plan.rules.find(r => r.id === "M8").status = "proposed";
      const jobs = [];
      const onMsg = e => { if (e.data && e.data.type === "favauto-start") jobs.push({ at: Date.now(), job: e.data.job }); };
      window.addEventListener("message", onMsg);
      await P.start({ inline: true }); await wait(100);
      out.refused = !P.fast() && jobs.length === 0;
      plan.rules.find(r => r.id === "M8").status = "approved";
      window.confirm = () => true;
      // planned work, estimated at the floor pace
      const lanes = P.plan();
      const nonPost = /^(post|ig|x|tiktok|mklist|grow|prime:relay|yt:all|reel:|story:|engage:.*:(reply|likers))/;
      out.lanes = Object.fromEntries(Object.entries(lanes).map(([l, ks]) => [l, ks.length]));
      out.serial = Object.values(lanes).flat().filter(k => !nonPost.test(k)).reduce((s, k) => s + P.estimate(k), 0);
      out.parallel = Math.max(...Object.values(lanes).map(ks => ks.filter(k => !nonPost.test(k)).reduce((s, k) => s + P.estimate(k), 0)));
      const t0 = Date.now();
      await P.start({ inline: true });
      // the add-on: answer each job at once (nothing posted), with the steps it carried
      const answered = new Set();
      for (let i = 0; i < 400; i++) {
        await wait(60);
        for (const j of jobs.filter(x => !answered.has(x.job.id))) {
          answered.add(j.job.id);
          try { await F._test.receive({ kind: j.job.kind, id: j.job.id, net: j.job.net, mode: j.job.mode, res: [], stopped: null, then: j.job.then || null, v: "mock", groups: [], snapshot: null }); } catch (e) { out.problems.push("receive " + j.job.kind + ": " + e.message); }
        }
        const s = P.summary(); if (s && !s.running.length) break;
      }
      const s = P.summary();
      out.ms = Date.now() - t0;
      out.first = jobs.filter(j => j.at >= t0).slice(0, 6).map(j => j.at - t0);
      out.kinds = [...new Set(jobs.filter(j => j.at >= t0).map(j => j.job.kind))];
      out.slow = jobs.filter(j => j.at >= t0 && /^(post|ig|x|tiktok|engage|fxfix|ttfix|mklist)$/.test(j.job.kind) && (j.job.min !== 8 || j.job.max !== 12 || "wait_first" in j.job)).map(j => j.job.kind + ":" + j.job.min + "-" + j.job.max);
      out.done = s ? s.lanes.map(l => l.lane + ":" + l.status) : [];
      out.admin = s ? (s.lanes.find(l => l.lane === "admin") || {}).status : null;
      F._test.setTab("today"); await wait(100);
      out.panel = (document.querySelector("#fa-body [data-prime-panel]") || {}).innerText || "";
      out.todayBtn = !!document.querySelector("#fa-body [data-prime-go]");
      window.removeEventListener("message", onMsg);
      P._test.reset(); F._test.setTab("today");
      return out;
    });
    pr.problems.forEach(p => problems.push("Prime: " + p));
    if (!pr.refused) problems.push("Prime ran while rule M8 is only Proposed");
    if (pr.parallel >= 360 || pr.parallel >= pr.serial) problems.push(`Prime: parallel non-posting work ${pr.parallel} s (serial ${pr.serial} s) should be well under 6:00 and shorter than one-by-one`);
    if (pr.first.length < 4 || Math.max(...pr.first) > 1500) problems.push("Prime: the lanes didn't start together: " + JSON.stringify(pr.first));
    if (pr.slow.length) problems.push("Prime: jobs not at the 8–12 s floor: " + pr.slow.join(", "));
    if (pr.admin !== "done" || pr.done.some(x => !/:(done|stopped)$/.test(x))) problems.push("Prime: not every lane finished: " + JSON.stringify(pr.done));
    if (pr.ms > 60000) problems.push("Prime mock run took " + pr.ms + " ms");
    if (!pr.todayBtn) problems.push("Prime button missing on the Today tab");
    if (!/Summary|Finished/.test(pr.panel)) problems.push("Prime panel shows no summary: " + pr.panel.slice(0, 120));
    if (!problems.length) console.log(`    ⚡ Prime: ${Object.keys(pr.lanes).length} lanes ${JSON.stringify(pr.lanes)}, ${pr.kinds.length} job kinds started together (first ${Math.max(...pr.first)} ms); non-posting work ${pr.parallel} s side by side vs ${pr.serial} s one by one; mock run ${pr.ms} ms`);
  }
  // 🤖 Open items + AI Fix: M9 gate, every source listed, Needs-you rows never acted on, SEO fixes saved, lead replies only
  // drafted (WhatsApp link, nothing sent), social fixes launched as one runStep chain, every action logged.
  if (day === today) {
    const oi = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const O = window.FAV_OPENITEMS, AP = window.FAV_AIPLAN, out = {};
      await AP.load(); const plan = AP._test.state();
      window.__files["data/seo-report.json"] = { issues: [{ id: "t1", check: "title", msg: "x", fix: { id: "title:test.html", kind: "title", page: "test.html", value: "Test title" } }] };
      window.FAV_LEADS = { _test: { get: () => [{ k: "e:9", status: "New", editable: true, name: "Ama Mensah", phone: "0240000002", product: "Student desk", message: "price for 60?" }] } };
      plan.rules.find(r => r.id === "M9").status = "proposed";
      out.off = (await O.fixAll({ auto: true })).error || "";
      plan.rules.find(r => r.id === "M9").status = "approved";
      window.confirm = () => true;
      const jobs = []; const onMsg = e => { if (e.data && e.data.type === "favauto-start") jobs.push(e.data.job); }; window.addEventListener("message", onMsg);
      document.documentElement.dataset.favautoExt = "5"; document.documentElement.dataset.favautoMode = "live"; document.documentElement.dataset.favautoUs = "1";
      await O.load(true); await O._test.loadSeo();
      const list = O.items();
      out.n = list.length; out.srcs = [...new Set(list.map(i => i.src.split(" · ")[0]))];
      out.you = list.filter(i => i.act === "you").map(i => i.id);
      out.youLinks = list.filter(i => i.act === "you").every(i => i.url || i.link);
      out.learned = list.filter(i => i.learned && i.learned.length).length;
      const r = await O.fixAll({ auto: true });
      await wait(400);
      window.removeEventListener("message", onMsg);
      out.result = r && !r.error;
      out.seo = ((window.__files["data/seo-fixes.json"] || {}).applied || []).some(f => f.id === "title:test.html" && f.by === "AI Fix");
      const lead = r.items.find(i => i.id === "leads");
      out.draft = lead && lead.drafts && lead.drafts[0] ? lead.drafts[0].text : "";
      out.log = (window.__files["data/open-items.json"] || { log: [] }).log.length;
      out.jobs = jobs.map(j => j.kind);
      out.sentToCustomer = jobs.some(j => /message|send|whatsapp/i.test(j.kind));
      out.deleted = JSON.stringify(jobs).match(/"(delete|trash|remove)"/) ? true : false;
      return out;
    });
    if (!/Proposed/.test(oi.off)) problems.push("AI Fix ran while rule M9 is only Proposed: " + oi.off);
    if (!oi.result) problems.push("AI Fix didn't finish");
    for (const want of ["Customers", "Meta Verified", "Security", "Backend", "Prices", "Leads", "What's in the box", "Brands", "SEO & AI"]) if (!oi.srcs.includes(want)) problems.push("Open items missing source " + want + ": " + oi.srcs.join(", "));
    for (const id of ["m-metaverified", "m-2fa", "m-apikeys", "m-julius", "m-prices", "leads", "box"]) if (!oi.you.includes(id)) problems.push("Open items: " + id + " should be Needs you");
    if (!oi.youLinks) problems.push("Open items: a Needs-you row has no link to where to do it");
    if (!oi.seo) problems.push("AI Fix didn't save the SEO fix to data/seo-fixes.json");
    if (!/Ama/.test(oi.draft)) problems.push("AI Fix didn't draft the lead reply: " + oi.draft);
    if (!oi.log) problems.push("AI Fix logged nothing in data/open-items.json");
    if (oi.sentToCustomer || oi.deleted) problems.push("AI Fix launched a send/delete job: " + oi.jobs.join(","));
    if (!oi.jobs.length) problems.push("AI Fix didn't launch the social fixes (Fix all / Marketplace / profiles)");
    if (!problems.length) console.log(`    🤖 Open items: ${oi.n} items from ${oi.srcs.length} sources, ${oi.you.length} need you, ${oi.learned} with "learned from"; AI Fix saved SEO fixes, drafted lead replies, launched ${oi.jobs.length} job(s): ${[...new Set(oi.jobs)].join(", ")}`);
  }
  // 🎬 Trend video card on the Boost tab: one prompt per template, caution line, Copy prompt, Add video → videos library.
  const tv = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    window.__clip = []; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async t => { window.__clip.push(t); } } });
    window.FAV_FBAUTO._test.setTab("boost"); await wait(200);
    const c = document.querySelector("#trendvid-card");
    if (!c) return { card: false };
    const out = { card: true, rows: c.querySelectorAll("[data-tv]").length, caution: /demonetis/i.test(c.innerText), tool: !!c.querySelector("[data-tv-tool]") };
    c.querySelector("[data-tv] [data-tv-copy]").click(); await wait(50);
    out.copied = (window.__clip[0] || "").length;
    // Add video: FAV_VIDAUTO.addFiles gets the trend options; the card logs it in made[]
    const V = window.FAV_VIDAUTO, real = V.addFiles; let got = null;
    V.addFiles = async (files, o) => { got = o; const S = V.state(); S.videos.push({ id: "trend-test", website: {}, youtube: {}, tiktok: {} }); };
    const inp = document.querySelector("#trendvid-card [data-tv] [data-tv-file]");
    const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(10)], "mini.mp4", { type: "video/mp4" })); inp.files = dt.files;
    inp.dispatchEvent(new Event("change", { bubbles: true })); await wait(200);
    V.addFiles = real; V.state().videos = V.state().videos.filter(v => v.id !== "trend-test");
    out.opts = got; out.made = (window.FAV_TRENDVID.state().made || []).slice(-1)[0] || null;
    return out;
  });
  const tvT = files["data/trend-videos.json"].templates.length;
  if (!tv.card) problems.push("🎬 Trend video card missing from the Boost tab");
  else {
    if (tv.rows !== tvT) problems.push(`Trend video card shows ${tv.rows} prompts, expected ${tvT}`);
    if (!tv.caution) problems.push("Trend video card has no demonetisation caution line");
    if (!(tv.copied > 100)) problems.push("Trend video Copy prompt copied nothing");
    if (!tv.opts || tv.opts.kind !== "trend" || tv.opts.source !== "upload" || !tv.opts.trend) problems.push("Add video didn't go into the videos library as a trend video: " + JSON.stringify(tv.opts));
    if (!tv.made || !tv.made.video) problems.push("Add video wasn't logged in data/trend-videos.json made[]");
  }
  for (const b of new Set(files["data/trend-videos.json"].templates.map(t => t.brand))) if (!files["data/brands.json"].brands.some(x => x.id === b)) problems.push("trend-videos.json template for unknown brand " + b);
  // Hourly posting steps from the AI Plan (hr:<net>:<n>, desk:<product>:<groups>) launch real add-on jobs.
  const hrJobs = await page.evaluate(() => {
    const jobs = []; window.addEventListener("message", e => { if (e.data && e.data.type === "favauto-start") jobs.push(e.data.job); });
    document.documentElement.dataset.favautoExt = "5"; document.documentElement.dataset.favautoMode = "live";
    // The real log may have every group posted in within the rest window (or "in the future" on a past test day): start clean.
    const fbS = window.FAV_FBAUTO._test.state(), keepPosts = fbS.posts; fbS.posts = [];
    window.FAV_FBAUTO.runStep(["desk:FAV-014:10"], true); fbS.posts = keepPosts;
    window.FAV_FBAUTO.runStep(["hr:x:2"], true);
    return new Promise(r => setTimeout(() => r(jobs.map(j => ({ kind: j.kind, n: j.q.length, ps: [...new Set(j.q.map(x => x.p))] }))), 300));
  });
  // Brand routing: a post for Oteng Furniture (its name, not F.A Vision's contacts) gets as = its Page and goes last.
  const brandJob = await page.evaluate(brands => {
    const jobs = []; window.addEventListener("message", e => { if (e.data && e.data.type === "favauto-start") jobs.push(e.data); });
    const list = JSON.parse(JSON.stringify(brands.brands)); list.find(b => b.id === "oteng-furniture").accounts.facebook = { handle: "Oteng Furniture", status: "live" };
    window.FAV_BRANDS._test.set({ brands: list });
    window.FAV_FBAUTO.launch("https://www.facebook.com/groups/9/", { kind: "post", mode: "now", q: [
      { g: "9", url: "https://www.facebook.com/groups/9/", p: "FAV-001", text: "Oteng Furniture: 3-seater sofa GH₵5,000. WhatsApp 024 000 0000 to order. #OtengFurniture #FurnitureGhana" },
      { g: "8", url: "https://www.facebook.com/groups/8/", p: "FAV-014", text: "Student desk GH₵650. WhatsApp 057 264 6176 to order. #FAVisionEnterprise #FurnitureGhana" }] });
    return new Promise(r => setTimeout(() => r(jobs.map(j => ({ url: j.url, q: j.job.q.map(x => ({ g: x.g, as: x.as || null })) }))), 200));
  }, JSON.parse(fs.readFileSync(ROOT + "data/brands.json", "utf8")));
  const bj = brandJob[0];
  if (!bj || JSON.stringify(bj.q) !== JSON.stringify([{ g: "8", as: null }, { g: "9", as: "Oteng Furniture" }]) || !/groups\/8\//.test(bj.url)) problems.push("brand routing: Oteng's post should go last as the Oteng Furniture Page, starting at the F.A Vision group: " + JSON.stringify(brandJob));
  // Instagram / X / TikTok: a brand post waits until that brand's own account is Live, then carries its handle.
  const holdJob = await page.evaluate(brands => {
    const seen = []; window.addEventListener("message", e => { if (e.data && e.data.type === "favauto-start") seen.push(e.data.job); });
    const texts = [{ k: "a", p: "FAV-001", text: "Oteng Furniture: 3-seater sofa GH₵5,000. WhatsApp 057 264 6176. #OtengFurniture" },
                   { k: "b", p: "FAV-014", text: "Student desk GH₵650 from F.A Vision. WhatsApp 057 264 6176. #FAVisionEnterprise" }];
    const go = ig => { const list = JSON.parse(JSON.stringify(brands.brands));
      list.find(b => b.id === "oteng-furniture").accounts.instagram = ig;
      window.FAV_BRANDS._test.set({ brands: list });
      window.FAV_FBAUTO.launch("https://www.instagram.com/favisionent/", { kind: "ig", account: "favisionent", q: JSON.parse(JSON.stringify(texts)) }); };
    go({ handle: "otengfurniture", status: "to_create" });                       // no account yet → held back
    go({ handle: "otengfurniture", status: "live" });                            // Live → carries the handle
    return new Promise(r => setTimeout(() => r(seen.map(j => ({ ks: j.q.map(x => x.k + ":" + (x.as || "-")), held: j.held || null }))), 250));
  }, JSON.parse(fs.readFileSync(ROOT + "data/brands.json", "utf8")));
  const want = [{ ks: ["b:-"], held: ["Oteng Furniture"] }, { ks: ["a:otengfurniture", "b:-"], held: null }];
  if (JSON.stringify(holdJob) !== JSON.stringify(want)) problems.push("Instagram brand hold: expected " + JSON.stringify(want) + ", got " + JSON.stringify(holdJob));
  // Rule P1 (admin/brandstamp.js): every picture in every job shows the posting brand; no stamp → dropped.
  // Profile relay (admin/relay.js): card, captions per brand, the join job, posting plans per Page.
  const rel = await page.evaluate(async () => {
    const out = { problems: [] }, jobs = [];
    window.addEventListener("message", e => { if (e.data && e.data.type === "favauto-start") jobs.push(e.data.job); });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ST = window.FAV_STAMP, F = window.FAV_FBAUTO, RL = window.FAV_RELAY, CAP = window.FAV_CAPTIONS;
    await ST.load(true); await window.FAV_BRANDS.load(true);
    const prods = window.FAV_ADMIN.products(), desk = prods.find(p => p.id === "FAV-014"), wc = prods.find(p => p.id === "FAV-024");
    // stamp: FA Vision ad kept; plain photo swapped; Oteng never gets an F.A Vision ad; AGOODMANN gets its own stamp; unknown photo dropped
    const site = location.origin + "/";
    F.launch("https://www.facebook.com/groups/1/", { kind: "post", mode: "now", q: [
      { g: "1", url: "https://www.facebook.com/groups/1/", p: "FAV-014", text: "Student desk GH₵650. WhatsApp 057 264 6176 to order. #FurnitureGhana", img: site + "assets/images/ads/fav-014-arrived.jpg" },
      { g: "2", url: "https://www.facebook.com/groups/2/", p: "FAV-014", text: "Student desk GH₵650. WhatsApp 057 264 6176 to order. #FurnitureGhana", img: site + desk.images[0] },
      { g: "3", url: "https://www.facebook.com/groups/3/", p: "FAV-014", text: "Oteng Furniture: student desk GH₵650. WhatsApp 057 264 6176 to order. #OtengFurniture", img: site + "assets/images/ads/fav-014-arrived.jpg", brand: "oteng-furniture" },
      { g: "4", url: "https://www.facebook.com/groups/4/", p: "FAV-024", text: "TWYFORD water closet GH₵750. WhatsApp 027 747 7752 to order. #Ghana", img: site + "assets/images/ads/fav-024.jpg" },
      { g: "5", url: "https://www.facebook.com/groups/5/", p: null, text: "Quality furniture in Accra. WhatsApp 057 264 6176 to order. #FurnitureGhana", img: site + "assets/images/products/not-ours.jpg" }] });
    await wait(150);
    const sj = jobs.pop() || { q: [] };
    out.stamp = sj.q.map(x => ({ g: x.g, stamp: x.stamp || null, img: String(x.img).replace(site, "") }));
    out.refused = (sj.refused || []).map(x => x.g);
    // relay card renders on the Facebook tab, with the four brands and the eight profiles
    F._test.setTab("facebook"); await wait(150);
    const card = document.querySelector("#relay-card");
    out.card = card ? { text: card.innerText.length, brands: card.querySelectorAll(".rl-brand").length, profs: card.querySelectorAll("[name^=prof_]").length - 1, on: [...card.querySelectorAll("[name^=prof_]:checked")].length, thumbs: card.querySelectorAll("img.rl-thumb").length, agoodWarn: /Add AGOODMANN/.test(card.innerText) } : null;
    out.rulesNote = !!document.querySelector(".pr-note");
    // captions per brand
    const br = id => window.FAV_BRANDS.list().find(b => b.id === id);
    const fav = RL._test.captionFor(desk, br("fa-vision"), "Fa Vision Furnitures"), ot = RL._test.captionFor(desk, br("oteng-furniture"), "Oteng Furniture"), ag = RL._test.captionFor(wc, br("agoodmann-ventures"), "Agoodmann Ventures");
    out.cap = { favSign: fav.includes(RL.SIGNOFF), favOk: CAP.check(fav, { net: "fb" }).ok, otOk: CAP.check(ot, { net: "fb" }).ok, otNoFav: !/F\.?A Vision|favision/i.test(ot), otNum: /057 264 6176|\+233572646176/.test(ot), agOk: CAP.check(ag, { net: "fb" }).ok, agNoFav: !/F\.?A Vision|favision|057 264 6176|020 747 3267|\+233572646176|\+233207473267/i.test(ag), agNum: /027 747 7752|\+233277477752/.test(ag), agName: /AGOODMANN/i.test(ag) };
    const many = Array.from({ length: 12 }, () => RL._test.captionFor(desk, br("fa-vision"), "F.A Vision Enterprise"));
    out.cap.unique = new Set(many).size;
    // the relay job: begin → grow job with relay, profiles ticked by default, membership answers per Page
    document.documentElement.dataset.favautoExt = "5";
    window.confirm = () => true;
    await RL.begin(true, false); await wait(300);
    const gj = jobs.find(j => j.kind === "grow" && j.relay);
    out.grow = gj ? { profiles: gj.profiles, limit: gj.limit, dry: gj.dry, qaKeys: Object.keys(gj.qa || {}).sort(), agoodWhat: ((gj.qa || {})["Agoodmann Ventures"] || {}).what, manyeWa: ((gj.qa || {})["Manye Oye Rehoboth"] || {}).wa, then: gj.then } : null;
    // phase 2: with members read for each Page, each brand's queue is its own groups, as that Page, with its stamp
    const S = F._test.state();
    S.relay.cur.members = { "F.A Vision Enterprise": [{ id: "g1", name: "A" }, { id: "g2", name: "B" }], "Fa Vision Furnitures": [{ id: "g2", name: "B" }, { id: "g3", name: "C" }], "Oteng Furniture": [{ id: "g4", name: "D" }], "Agoodmann Ventures": [{ id: "g5", name: "E" }] };
    out.plans = [0, 1, 2, 3].map(i => { const p = RL._test.buildPost(i); return p && { page: p.page, skip: p.skip || null, q: (p.q || []).map(x => ({ g: x.g, as: x.as, brand: x.brand, img: String(x.img).replace(site, "").replace(location.origin + "/", "") })) }; });
    window.FAV_RELAY.step("relay:done", []); await wait(200);
    return out;
  });
  const st = rel.stamp || [];
  const by = g => st.find(x => x.g === g) || {};
  if (by("1").img !== "assets/images/ads/fav-014-arrived.jpg" || by("1").stamp !== "fa-vision") problems.push("brand stamp: F.A Vision's own ad should be kept as it is: " + JSON.stringify(st));
  if (!/^assets\/images\/stamped\/fa-vision\//.test(by("2").img || "")) problems.push("brand stamp: a plain desk photo should become F.A Vision's stamped copy: " + JSON.stringify(st));
  if (!/^assets\/images\/stamped\/oteng-furniture\//.test(by("3").img || "") || by("3").stamp !== "oteng-furniture") problems.push("brand stamp: an Oteng post must never carry the F.A Vision ad; it gets Oteng's stamped photo: " + JSON.stringify(st));
  if (!/^assets\/images\/stamped\/agoodmann-ventures\//.test(by("4").img || "") || by("4").stamp !== "agoodmann-ventures") problems.push("brand stamp: the TWYFORD post must carry AGOODMANN's own stamp: " + JSON.stringify(st));
  if (by("5").g || !(rel.refused || []).includes("5")) problems.push("brand stamp: a picture with no stamped copy must be dropped (gate): " + JSON.stringify([st, rel.refused]));
  if (!rel.card || rel.card.brands !== 4 || rel.card.profs !== 8 || rel.card.on !== 6 || rel.card.thumbs < 4 || rel.card.agoodWarn) problems.push("Profile relay card: expected 4 brands with stamped previews, 8 profiles (6 ticked), no AGOODMANN warning (its Page is set): " + JSON.stringify(rel.card));
  if (!rel.rulesNote) problems.push("Posting rules note missing on the Facebook tab");
  const cp = rel.cap || {};
  if (!cp.favSign || !cp.favOk || !cp.otOk || !cp.otNoFav || !cp.otNum || !cp.agOk || !cp.agNoFav || !cp.agNum || !cp.agName || cp.unique < 12) problems.push("Profile relay captions: FA Vision sign-off, gate ok, Oteng without F.A Vision's name but with its numbers, AGOODMANN with only its own name and contacts, all different: " + JSON.stringify(cp));
  const gr = rel.grow;
  if (!gr || gr.profiles.join() !== "Alexander Awuku,F.A Vision Enterprise,Fa Vision Furnitures,Oteng Furniture,Agoodmann Ventures,Manye Oye Rehoboth" || gr.limit !== 40 || !gr.dry || !gr.qaKeys.includes("Agoodmann Ventures") || !/TWYFORD/.test(gr.agoodWhat || "") || gr.manyeWa !== "+233535700722") problems.push("Profile relay join job wrong: " + JSON.stringify(gr));
  const pl = rel.plans || [];
  const okPlan = (i, page, brand, groups, stampDir) => pl[i] && pl[i].page === page && !pl[i].skip && pl[i].q.map(x => x.g).join() === groups && pl[i].q.every(x => x.as === page && x.brand === brand && (x.img.startsWith(stampDir) || (brand === "fa-vision" && /ads\//.test(x.img))));
  if (!okPlan(0, "F.A Vision Enterprise", "fa-vision", "g1,g2", "assets/images/stamped/fa-vision/") || !okPlan(1, "Fa Vision Furnitures", "fa-vision", "g2,g3", "assets/images/stamped/fa-vision/") || !okPlan(2, "Oteng Furniture", "oteng-furniture", "g4", "assets/images/stamped/oteng-furniture/") || !okPlan(3, "Agoodmann Ventures", "agoodmann-ventures", "g5", "assets/images/stamped/agoodmann-ventures/"))
    problems.push("Profile relay posting plans wrong (own groups, as each Page, its own stamped picture): " + JSON.stringify(pl));
  // Go-viral settings card (admin/viral.js) on the Engagement tab: live accounts only, ticks saved, shadow check manual.
  const vs = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    try { localStorage.removeItem("fa-viral-acct"); } catch (e) {}
    window.__files["data/viral-settings.json"] = { checked: { "fa-vision:ig:hq": "2026-01-01" }, shadow: {} };
    await window.FAV_BRANDS.load(true); await window.FAV_VIRAL.load(true);
    window.FAV_FBAUTO._test.setTab("engage"); await wait(150);
    const card = document.querySelector("#vs-card"); if (!card) return { card: false };
    const out = { card: true, live: card.querySelectorAll("[data-vs-acct]").length, notYet: ((card.querySelector(".vs-notyet") || {}).innerText || "").split(" · ").length,
      rows: card.querySelectorAll(".vs-row").length, badge: !!card.querySelector("#vs-badge"), stale: /check again/.test(card.innerText), apps: card.querySelectorAll(".vs-row .pill.est").length };
    const box = card.querySelector('[data-vs-tick="fa-vision:ig:reshare"]'); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); await wait(150);
    out.saved = !!(window.__files["data/viral-settings.json"].checked || {})["fa-vision:ig:reshare"];
    out.bar = (document.querySelector("#vs-card .st-progress span") || {}).innerText || "";
    document.querySelector('#vs-card [data-vs-shadow="ok"]').click(); await wait(150);
    const sh = (window.__files["data/viral-settings.json"].shadow || {})["fa-vision:ig"];
    out.shadow = !!(sh && sh.ok) && !!window.__files["data/viral-settings.json"].checked["fa-vision:ig:status"];
    document.querySelector('#vs-card [data-vs-acct="fa-vision:fb"]').click(); await wait(150);
    out.fbRows = document.querySelectorAll("#vs-card .vs-row").length;
    return out;
  });
  if (!vs.card || vs.live !== 5 || vs.notYet !== 5 || vs.rows !== 7 || !vs.badge || !vs.stale || vs.apps !== 1 || !vs.saved || !/^2 of 7 done/.test(vs.bar) || !vs.shadow || vs.fbRows !== 5)
    problems.push("Go-viral settings card: expected 5 live accounts (1 Instagram + 4 Facebook Pages), 5 not created yet, 7 Instagram rows (1 app-only), reminder badge, old tick flagged, tick + manual shadow check saved, 5 Facebook rows: " + JSON.stringify(vs));
  const desk = hrJobs.find(j => j.kind === "post"), hx = hrJobs.find(j => j.kind === "x");
  if (!desk || desk.n < 1 || desk.n > 10 || desk.ps.join() !== "FAV-014") problems.push("desk:FAV-014:10 didn't post the desk into ≤10 groups: " + JSON.stringify(hrJobs));
  if (!hx || hx.n !== 2) problems.push("hr:x:2 didn't build 2 X posts: " + JSON.stringify(hrJobs));
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
  want(tt.pick === "FAV-014" && /Comment|Tell us below/i.test(tt.text) && /favisionenterprize\.github\.io\/tiktok\//.test(tt.text) && /GH₵650/.test(tt.text) && !/where are you seeing/i.test(tt.text), "classy caption for the student desk post: " + tt.text);
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
    let fx = { applied: [] };
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

// "📦 What's in the Box ads" screen (admin/boxads.js, #boxads): one card per product with a box ad image on
// disk, captions pass the quality gate, Edit contents + ✓ Confirmed save through FAV_ADMIN.commit, and the
// Instagram / X / TikTok pool carries a "Box ad" per product.
async function boxads(browser, shot) {
  const page = await browser.newPage({ viewport: shot ? { width: 1280, height: 900 } : { width: 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  const html = fs.readFileSync(ROOT + "admin/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  await page.route("http://smoke.test/**", r => {
    const u = new URL(r.request().url());
    if (u.pathname === "/admin/") return r.fulfill({ status: 200, contentType: "text/html", body: html });
    const f = decodeURIComponent(u.pathname).replace(/^\//, "");
    if (!fs.existsSync(ROOT + f) || fs.statSync(ROOT + f).isDirectory()) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({ status: 200, body: fs.readFileSync(ROOT + f), contentType: f.endsWith(".jpg") ? "image/jpeg" : "text/plain" });
  });
  await page.goto("http://smoke.test/admin/");
  await page.addStyleTag({ content: fs.readFileSync(ROOT + "admin/admin.css", "utf8") });
  await page.evaluate(({ files, ESC }) => {
    window.__commits = []; window.__toasts = []; window.__clip = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async t => { window.__clip.push(t); } } });
    window.open = () => null;
    window.FAV_CONFIG = { escapeHtml: (0, eval)(ESC), localPhone: x => x, formatPrice: n => "GH₵" + Number(n).toLocaleString() };
    let list = JSON.parse(JSON.stringify(files["data/products.json"]));
    window.__list = () => list;
    window.FAV_ADMIN = { products: () => list, business: () => files["data/business.json"], signedIn: () => true, show: () => {}, busy: () => {}, friendly: String, refreshDash: () => {},
      readJsonFile: async (f, e) => JSON.parse(JSON.stringify(files[f] || e)), saveJson: async () => ({}), productUrl: p => "https://favisionenterprize.github.io/p/" + p.id + ".html",
      toast: (m, bad) => window.__toasts.push((bad ? "✗ " : "") + m), commit: async o => { list = o.mutate(list); window.__commits.push(o.message); return list; } };
  }, { files, ESC });
  for (const f of ["admin/captions.js", "admin/igauto.js", "admin/boxads.js"]) await page.addScriptTag({ content: fs.readFileSync(ROOT + f, "utf8") });
  await page.evaluate(() => document.querySelector("[data-boxads]").click());
  await page.waitForTimeout(600);
  const prods = files["data/products.json"].filter(p => !p.placeholder && (p.images || []).length);
  const st = await page.evaluate(() => ({ cards: document.querySelectorAll(".bx-card").length, hash: location.hash,
    broken: [...document.querySelectorAll(".bx-card > a img")].filter(i => i.complete && !i.naturalWidth).map(i => i.closest(".bx-card").dataset.id) }));
  if (st.cards !== prods.length) problems.push(`box ads screen shows ${st.cards} cards, expected ${prods.length}`);
  if (st.hash !== "#boxads") problems.push("deep link #boxads not set");
  if (st.broken.length) problems.push("box ad image missing for " + st.broken.join(", "));
  for (const p of prods) if (!fs.existsSync(ROOT + `assets/images/ads/box/box-${p.id.toLowerCase()}.jpg`)) problems.push(`no assets/images/ads/box/box-${p.id.toLowerCase()}.jpg (run scripts/make_box_ads.py)`);
  if (shot) await page.screenshot({ path: shot, fullPage: false });
  await page.click('.bx-card[data-id="FAV-014"] [data-bx="copy"]'); await page.waitForTimeout(100);
  const cap = await page.evaluate(() => { const t = window.__clip[0] || ""; return { t, ok: window.FAV_CAPTIONS.check(t, { net: "share" }).ok }; });
  if (!/What's in the box|Unboxing/i.test(cap.t) || !/Desk top/.test(cap.t)) problems.push("Copy caption isn't a box caption: " + cap.t.slice(0, 120));
  if (!cap.ok) problems.push("box caption fails the quality gate");
  await page.click('.bx-card[data-id="FAV-014"] [data-bx="edit"]'); await page.waitForTimeout(100);
  await page.fill('.bx-card[data-id="FAV-014"] .bx-it [data-i]', "Desk top (MDF, melamine)");
  await page.click('.bx-card[data-id="FAV-014"] [data-bx="add"]');
  await page.fill('.bx-card[data-id="FAV-014"] .bx-it:last-child [data-i]', "Assembly guide");
  await page.click('.bx-card[data-id="FAV-014"] [data-bx="save"]'); await page.waitForTimeout(200);
  const saved = await page.evaluate(() => { const p = window.__list().find(x => x.id === "FAV-014"); return { box: p.in_the_box, ok: p.in_the_box_confirmed, commits: window.__commits.slice() }; });
  if (saved.commits.length !== 1 || saved.box[0].item !== "Desk top (MDF, melamine)" || saved.box[saved.box.length - 1].item !== "Assembly guide") problems.push("Edit contents didn't save: " + JSON.stringify(saved).slice(0, 300));
  await page.check('.bx-card[data-id="FAV-014"] [data-bx-confirm]'); await page.waitForTimeout(200);
  const conf = await page.evaluate(() => window.__list().find(x => x.id === "FAV-014").in_the_box_confirmed);
  if (conf !== true) problems.push("✓ Confirmed toggle didn't save");
  const pool = await page.evaluate(() => { try { return window.FAV_IGAUTO.pool().filter(i => i.kind === "Box ad").length; } catch (e) { return "error " + e.message; } });
  if (typeof pool !== "number" || pool < 10) problems.push("Instagram/X/TikTok pool has no Box ads: " + pool);
  const bad = await page.evaluate(() => window.__toasts.filter(t => t.startsWith("✗")));
  bad.forEach(t => problems.push("error toast: " + t));
  await page.close();
  return { problems, cards: st.cards, pool };
}

// "🧭 AI Plan" screen (admin/aiplan.js, #aiplan): every rule in data/ai-plan.json drawn, edits + Pause All save
// through FAV_ADMIN.saveJson, and the gate the Social autopilot uses (runStep/launch) obeys Status, Action
// setting, Needs approval (confirm) and Pause All.
async function aiplan(browser, shot) {
  const page = await browser.newPage({ viewport: shot ? { width: 1280, height: 900 } : { width: 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  const html = fs.readFileSync(ROOT + "admin/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  await page.route("http://smoke.test/**", r => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto("http://smoke.test/admin/");
  await page.addStyleTag({ content: fs.readFileSync(ROOT + "admin/admin.css", "utf8") });
  const plan = JSON.parse(fs.readFileSync(ROOT + "data/ai-plan.json", "utf8"));
  await page.evaluate(plan => {
    window.__saves = []; window.__toasts = []; window.__confirms = 0; let disk = JSON.parse(JSON.stringify(plan));
    window.confirm = () => { window.__confirms++; return true; };
    window.__disk = () => disk;
    window.FAV_ADMIN = { busy: () => {}, friendly: String, toast: (m, bad) => window.__toasts.push((bad ? "✗ " : "") + m),
      readJsonFile: async () => JSON.parse(JSON.stringify(disk)),
      saveJson: async (f, mutate, msg) => { disk = mutate(JSON.parse(JSON.stringify(disk))); window.__saves.push(f + ": " + msg); return JSON.parse(JSON.stringify(disk)); } };
  }, plan);
  await page.addScriptTag({ content: fs.readFileSync(ROOT + "admin/aiplan.js", "utf8") });
  await page.evaluate(() => document.querySelector("[data-aiplan]").click());
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({ rules: document.querySelectorAll(".ap-rule[data-rid]").length, hash: location.hash }));
  if (st.rules !== plan.rules.length) problems.push(`AI Plan shows ${st.rules} rules, expected ${plan.rules.length}`);
  if (st.hash !== "#aiplan") problems.push("deep link #aiplan not set");
  if (plan.rules.some(r => !r.id || !r.task || !["ai", "draft", "human"].includes(r.line) || !["allow", "approve", "block"].includes(r.setting))) problems.push("data/ai-plan.json has a rule with a bad id/task/line/setting");
  if (shot) await page.screenshot({ path: shot, fullPage: false });
  const g = await page.evaluate(() => { const G = window.FAV_AIPLAN; return { renew: G.gate("renew", "t"), ig: G.gate("ig", "t"), engage: G.gate("engage:fb", "t"), other: G.gate("nothing-covers-this", "t") }; });
  if (!g.renew || !g.ig || !g.engage || !g.other) problems.push("approved + Always allow steps should run: " + JSON.stringify(g));
  // Alexander retires M1 (posting on all socials) and saves.
  await page.selectOption('.ap-rule[data-rid="M1"] select[data-f="status"]', "retired");
  await page.fill('.ap-rule[data-rid="M1"] textarea', "Post on all socials (test edit)");
  await page.click("[data-ap-save]"); await page.waitForTimeout(200);
  const r1 = await page.evaluate(() => ({ m1: window.__disk().rules.find(r => r.id === "M1"), ig: window.FAV_AIPLAN.gate("ig", "t2"), renew: window.FAV_AIPLAN.gate("renew", "t2") }));
  if (r1.m1.status !== "retired" || r1.m1.task !== "Post on all socials (test edit)") problems.push("rule edit didn't save: " + JSON.stringify(r1.m1));
  if (r1.ig !== false) problems.push("retired M1 still lets the Instagram step run");
  if (r1.renew !== true) problems.push("retiring M1 stopped renewals (M2) too");
  // Needs approval asks once per run.
  await page.selectOption('.ap-rule[data-rid="M2"] select[data-f="setting"]', "approve");
  await page.click("[data-ap-save]"); await page.waitForTimeout(200);
  const r2 = await page.evaluate(() => { const a = window.FAV_AIPLAN.gate("renew", "t3"), b = window.FAV_AIPLAN.gate("post", "t3"); return { a, b, n: window.__confirms }; });
  if (!r2.a || !r2.b || r2.n !== 1) problems.push("Needs approval should ask once per run and then run: " + JSON.stringify(r2));
  // Pause All stops everything; Resume brings it back.
  await page.click("[data-ap-pause]"); await page.waitForTimeout(200);
  const r3 = await page.evaluate(() => ({ p: window.__disk().paused, renew: window.FAV_AIPLAN.gate("renew", "t4"), other: window.FAV_AIPLAN.gate("nothing", "t4"), paused: window.FAV_AIPLAN.paused() }));
  if (!r3.p || r3.renew || r3.other || !r3.paused) problems.push("Pause All didn't stop everything: " + JSON.stringify(r3));
  await page.click("[data-ap-pause]"); await page.waitForTimeout(200);
  if (await page.evaluate(() => window.FAV_AIPLAN.paused())) problems.push("Resume all didn't resume");
  // Hourly posting: card drawn, steps follow the rates, Run this hour now starts them, save keeps the safe caps.
  const hr = await page.evaluate(() => {
    window.__runs = []; window.FAV_FBAUTO = { runStep: s => window.__runs.push(s), liveAddon: () => true };
    try { localStorage.removeItem("fa-hourly"); } catch (e) { /* */ }
    const steps = window.FAV_AIPLAN._test.hourlySteps(Date.now(), {});
    document.querySelector("[data-ap-hr-run]").click();
    return { card: !!document.querySelector("#ap-hourly"), steps, runs: window.__runs.slice() };
  });
  if (!hr.card) problems.push("Hourly posting card missing");
  if (JSON.stringify(hr.steps) !== JSON.stringify(["hr:ig:1", "hr:x:2", "hr:tiktok:1", "desk:FAV-014:10"])) problems.push("hourly steps wrong: " + JSON.stringify(hr.steps));
  if (hr.runs.length !== 1 || hr.runs[0][hr.runs[0].length - 1] !== "report" || !hr.runs[0].includes("desk:FAV-014:10")) problems.push("Run this hour now didn't start the steps: " + JSON.stringify(hr.runs));
  await page.fill('#ap-hourly input[name="x"]', "9"); await page.fill('#ap-hourly input[name="desk_groups"]', "50");
  await page.click("[data-ap-hr-save]"); await page.waitForTimeout(200);
  const hs = await page.evaluate(() => window.__disk().hourly);
  if (!hs || hs.per_hour.x !== 4 || hs.desk.groups !== 20) problems.push("hourly save didn't keep the safe caps (4/h, 20 groups): " + JSON.stringify(hs));
  const c3 = await page.evaluate(() => window.FAV_AIPLAN.decide("x").v + "/" + (window.__disk().rules.find(r => r.id === "C3") || {}).setting);
  if (!/approve$/.test(c3)) problems.push("C3 should need approval: " + c3);
  // A new rule starts as Proposed and saves.
  await page.fill("#ap-new", "Test rule"); await page.click("[data-ap-add]"); await page.click("[data-ap-save]"); await page.waitForTimeout(200);
  const nr = await page.evaluate(() => window.__disk().rules.find(r => r.task === "Test rule"));
  if (!nr || nr.status !== "proposed") problems.push("new rule didn't save as Proposed");
  const bad = await page.evaluate(() => window.__toasts.filter(t => t.startsWith("✗")));
  bad.forEach(t => problems.push("error toast: " + t));
  await page.close();
  return { problems, rules: st.rules };
}

// "🏷 Brands" screen (admin/brands.js, #brands): every brand drawn with its kit and accounts, setup pack opens,
// edits save, and FAV_BRANDS.detect() sends a post to the brand it names unless it carries F.A Vision's contacts.
async function brands(browser, shot) {
  const page = await browser.newPage({ viewport: shot ? { width: 1280, height: 900 } : { width: 390, height: 900 } });
  const problems = [];
  page.on("pageerror", e => problems.push("page error: " + e.message));
  const html = fs.readFileSync(ROOT + "admin/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  await page.route("http://smoke.test/**", r => {
    const u = new URL(r.request().url()), f = decodeURIComponent(u.pathname).replace(/^\//, "");
    if (u.pathname === "/admin/") return r.fulfill({ status: 200, contentType: "text/html", body: html });
    if (!fs.existsSync(ROOT + f) || fs.statSync(ROOT + f).isDirectory()) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({ status: 200, body: fs.readFileSync(ROOT + f), contentType: /\.png$/.test(f) ? "image/png" : "image/jpeg" });
  });
  await page.goto("http://smoke.test/admin/");
  await page.addStyleTag({ content: fs.readFileSync(ROOT + "admin/admin.css", "utf8") });
  const data = JSON.parse(fs.readFileSync(ROOT + "data/brands.json", "utf8"));
  await page.evaluate(data => {
    window.__toasts = []; let disk = JSON.parse(JSON.stringify(data)); window.__disk = () => disk;
    window.FAV_ADMIN = { busy: () => {}, friendly: String, toast: (m, bad) => window.__toasts.push((bad ? "✗ " : "") + m),
      readJsonFile: async () => JSON.parse(JSON.stringify(disk)), saveJson: async (f, mutate) => { disk = mutate(JSON.parse(JSON.stringify(disk))); return JSON.parse(JSON.stringify(disk)); } };
  }, data);
  await page.addScriptTag({ content: fs.readFileSync(ROOT + "admin/brands.js", "utf8") });
  await page.evaluate(() => document.querySelector("[data-brands]").click());
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({ cards: document.querySelectorAll(".br-card").length, hash: location.hash,
    broken: [...document.querySelectorAll(".br-card img")].filter(i => i.complete && !i.naturalWidth).map(i => i.src) }));
  if (st.cards !== data.brands.length) problems.push(`Brands shows ${st.cards} cards, expected ${data.brands.length}`);
  if (st.hash !== "#brands") problems.push("deep link #brands not set");
  if (st.broken.length) problems.push("brand kit image missing: " + st.broken.join(", "));
  const ot = data.brands.findIndex(b => b.id === "oteng-furniture");
  if (ot < 0) problems.push("Oteng Furniture missing from data/brands.json");
  for (const f of ["avatar.png", "logo-light.png", "logo-dark.png", "logo-mark.png", "facebook-cover.jpg", "x-header.jpg", "youtube-banner.jpg", "linkedin-cover.jpg"])
    if (!fs.existsSync(ROOT + "assets/brands/oteng-furniture/" + f)) problems.push("no assets/brands/oteng-furniture/" + f + " (run scripts/make_brand_kit.py)");
  if (shot) await page.screenshot({ path: shot, fullPage: false });
  await page.click(`.br-card[data-bi="${ot}"] [data-net="instagram"] [data-br-pack]`); await page.waitForTimeout(150);
  const pk = await page.evaluate(i => (document.querySelector(`.br-card[data-bi="${i}"] .br-pack`) || {}).innerText || "", ot);
  if (!/Setup pack: Instagram/.test(pk) || !/instagram\.com\/accounts\/emailsignup|Open Instagram signup/.test(pk)) problems.push("Instagram setup pack didn't open: " + pk.slice(0, 120));
  await page.fill(`.br-card[data-bi="${ot}"] input[data-f="whatsapp"]`, "+233240000000");
  await page.fill(`.br-card[data-bi="${ot}"] [data-net="instagram"] input[data-a="handle"]`, "otengfurniture");
  await page.selectOption(`.br-card[data-bi="${ot}"] [data-net="instagram"] select[data-a="status"]`, "live");
  await page.click("[data-br-save]"); await page.waitForTimeout(200);
  const sv = await page.evaluate(() => window.__disk().brands.find(b => b.id === "oteng-furniture"));
  if (sv.whatsapp !== "+233240000000" || sv.accounts.instagram.status !== "live" || sv.accounts.instagram.handle !== "otengfurniture" || "__open" in sv) problems.push("brand edits didn't save: " + JSON.stringify([sv.whatsapp, sv.accounts.instagram]));
  const det = await page.evaluate(() => { const d = t => (window.FAV_BRANDS.detect(t) || {}).id; return {
    ot: d("Oteng Furniture: 3-seater sofa GH₵5,000. WhatsApp 024 000 0000 to order."),
    otNum: d("3-seater sofa GH₵5,000. Order on WhatsApp +233 24 000 0000"),
    fa: d("Student desk GH₵650. WhatsApp 057 264 6176. favisionenterprize.github.io"),
    faWins: d("Oteng Furniture sofa now at F.A Vision. Call 0572646176"),
    anac: d("Kavukçu wheat flour from ANAC Essentials. Call 055 543 4994"),
    plain: d("Sofa for sale, DM to order"),
    // Oteng Furniture shares F.A Vision's phone numbers: the name decides, the shared number doesn't
    shared: (() => { const L = [{ id: "fa-vision", default: true, match: ["F.A Vision"], phones: ["+233572646176"] },
                                { id: "oteng-furniture", match: ["Oteng Furniture"], phones: ["+233572646176"] }];
      return { named: (window.FAV_BRANDS.detect("Oteng Furniture bed frame GH₵3,200. WhatsApp 057 264 6176.", L) || {}).id,
               numOnly: (window.FAV_BRANDS.detect("Bed frame GH₵3,200. WhatsApp 057 264 6176.", L) || {}).id }; })() }; });
  if (det.shared.named !== "oteng-furniture") problems.push(`shared number: a post naming Oteng went to ${det.shared.named}`);
  if (det.shared.numOnly !== "fa-vision") problems.push(`shared number alone: went to ${det.shared.numOnly}, expected fa-vision`);
  const wantDet = { ot: "oteng-furniture", otNum: "oteng-furniture", fa: "fa-vision", faWins: "fa-vision", anac: "anac-essentials", plain: "fa-vision" };
  for (const k in wantDet) if (det[k] !== wantDet[k]) problems.push(`detect ${k}: got ${det[k]}, expected ${wantDet[k]}`);
  const bad = await page.evaluate(() => window.__toasts.filter(t => t.startsWith("✗")));
  bad.forEach(t => problems.push("error toast: " + t));
  await page.close();
  return { problems, cards: st.cards };
}

// Shared setup for the screens added 25 Oct 2026 (prospects, profile kit, sales): admin/index.html without its
// scripts, real data files, FAV_ADMIN stubbed (saveJson writes to window.__files), clipboard + window.open captured.
async function plainPage(browser, problems, extra) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.on("pageerror", e => problems.push("page error: " + e.message));
  const html = fs.readFileSync(ROOT + "admin/index.html", "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  await page.route("http://smoke.test/**", r => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  if (extra) await extra(page);
  await page.goto("http://smoke.test/admin/");
  await page.addStyleTag({ content: fs.readFileSync(ROOT + "admin/admin.css", "utf8") });
  await page.evaluate(({ files, ESC }) => {
    window.__files = JSON.parse(JSON.stringify(files)); window.__toasts = []; window.__clip = []; window.__opened = []; window.__muse = []; window.__saves = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async t => { window.__clip.push(t); } } });
    window.open = (u) => { const doc = { html: "", write(h) { this.html += h; }, close() {} }; window.__opened.push({ u, doc }); return { document: doc }; };
    window.confirm = () => true;
    window.FAV_CONFIG = { escapeHtml: (0, eval)(ESC), localPhone: x => String(x).replace(/^\+233/, "0"), formatPrice: n => "GH₵" + Number(n).toLocaleString() };
    window.FAV_ADMIN = { products: () => window.__files["data/products.json"], business: () => Object.assign({}, window.__files["data/business.json"], { enquiry_endpoint: "https://backend.smoke.test/exec" }),
      signedIn: () => true, show: () => {}, busy: () => {}, friendly: e => String(e && e.message || e), productUrl: p => "https://favisionenterprize.github.io/p/" + p.id + ".html",
      toast: (m, bad) => window.__toasts.push((bad ? "✗ " : "") + m),
      readJsonFile: async (f, e) => JSON.parse(JSON.stringify(window.__files[f] || e)),
      saveJson: async (f, m, msg, e) => { window.__files[f] = m(JSON.parse(JSON.stringify(window.__files[f] || e))); window.__saves.push(f); return JSON.parse(JSON.stringify(window.__files[f])); },
      backendSigned: async payload => { window.__muse.push(payload); return window.__museReply ? window.__museReply(payload) : { ok: false, error: "no_ai_key" }; } };
  }, { files, ESC });
  return page;
}

// "🏢 Bulk buyers" (admin/prospects.js, #prospects): AI suggestions arrive unverified, chains are dropped, keepers
// need a source, drafting STOPS while quantity or price is empty, pitches/quote/WhatsApp/Add to Leads work, only
// public info goes into data/prospects.json, and the AI Plan rule S5 gates the AI.
async function prospects(browser) {
  const problems = [], want = (ok, m) => { if (!ok) problems.push(m); };
  const posts = [];
  const page = await plainPage(browser, problems, async pg => pg.route("https://backend.smoke.test/**", r => { posts.push(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, customers: [] }) }); }));
  for (const f of ["admin/captions.js", "admin/aiplan.js", "admin/leads.js", "admin/prospects.js", "assets/js/invoice.js"]) await page.addScriptTag({ content: fs.readFileSync(ROOT + f, "utf8") });
  await page.evaluate(async () => {
    const plan = await window.FAV_AIPLAN.load(true);
    const rule = plan.rules.find(r => r.id === "S5");
    if (!rule) throw new Error("AI Plan is missing the S5 rule");
    rule.status = "proposed";
  });
  await page.evaluate(() => { window.__files["data/prospects.json"] = { updated: null, prospects: [] }; window.__museReply = p => ({ ok: true, text: JSON.stringify({ prospects: [
    { name: "Bright Future Academy", area: "Kasoa", why: "Private JHS/SHS, growing", source_url: "https://www.google.com/maps/place/bright-future" },
    { name: "Hope Montessori School", area: "Kasoa", why: "Basic school", source_url: "" },
    { name: "KFC Kasoa", area: "Kasoa", why: "restaurant", source_url: "https://kfc.com.gh", chain: false },
    { name: "Big Group School Ltd", area: "Kasoa", why: "chain", source_url: "", chain: true }] }) }); });
  await page.evaluate(() => document.querySelector("[data-prospects]").click());
  await page.waitForTimeout(300);
  want(await page.evaluate(() => location.hash) === "#prospects", "deep link #prospects not set");
  // S5 is Proposed: AI is off, nothing asked
  await page.click("[data-pr=find]"); await page.waitForTimeout(150);
  want(await page.evaluate(() => window.__muse.length) === 0, "AI ran while rule S5 is only Proposed");
  want(await page.evaluate(() => /AI suggestions are off/.test(document.querySelector("#pr-body").innerText)), "no 'AI suggestions are off' notice while S5 is Proposed");
  // approve S5 → suggestions
  await page.evaluate(async () => { const P = window.FAV_AIPLAN._test.state(); P.rules.find(r => r.id === "S5").status = "approved"; });
  await page.evaluate(() => window.FAV_PROSPECTS.open()); await page.waitForTimeout(200);
  await page.click("[data-pr=find]"); await page.waitForTimeout(300);
  const st = await page.evaluate(() => window.FAV_PROSPECTS._test.state().prospects.map(x => ({ n: x.name, src: x.source, ok: x.checked })));
  want(st.length === 2 && st.every(x => !x.ok), "expected 2 unverified prospects (KFC + chain dropped): " + JSON.stringify(st));
  want(!st.some(x => /KFC|Big Group/.test(x.n)), "a chain wasn't filtered out");
  want(await page.evaluate(() => document.querySelectorAll(".pr-card .pill.warn").length) === 2, "suggested prospects aren't marked unverified");
  // keeper without a source refused
  await page.evaluate(() => { const c = [...document.querySelectorAll(".pr-card")].find(x => /Hope Montessori/.test(x.innerText)); c.querySelector("[data-pr=keep]").click(); });
  await page.waitForTimeout(100);
  want(await page.evaluate(() => !window.FAV_PROSPECTS._test.state().prospects.find(x => /Hope/.test(x.name)).keep), "a prospect with no source became a keeper");
  // keeper with source: drafting blocked until qty + price
  const sel = '.pr-card[data-pid*="bright-future"]';
  await page.click(sel + " [data-pr=checked]"); await page.waitForTimeout(80);
  await page.click(sel + " [data-pr=keep]"); await page.waitForTimeout(100);
  const stop = await page.evaluate(s => (document.querySelector(s + " .pr-stop") || {}).innerText || "", sel);
  want(/won't guess/.test(stop) && !(await page.$(sel + " [data-pv=draft]")), "drafting not blocked with empty quantity: " + stop);
  await page.fill(sel + " [data-pv=qty]", "60"); await page.dispatchEvent(sel + " [data-pv=qty]", "change"); await page.waitForTimeout(100);
  const stop2 = await page.evaluate(s => (document.querySelector(s + " .pr-stop") || {}).innerText || "", sel);
  want(/Enter the price — I won't guess/.test(stop2), "price-empty stop message missing: " + stop2);
  await page.click(sel + " [data-pr=catalog]"); await page.waitForTimeout(100);
  const draft = await page.evaluate(s => (document.querySelector(s + " [data-pv=draft]") || {}).value || "", sel);
  want(/60 × Student Desk Chair Set @ GH₵640 = GH₵38,400/.test(draft), "catalogue bulk price (GH₵640 from 50) not in the pitch: " + draft.slice(0, 200));
  want(/we sell/i.test(draft) && !/we make/i.test(draft) && /057 ?264 ?6176/.test(draft), "pitch must say 'we sell' and carry the F.A Vision WhatsApp");
  await page.click(sel + " [data-pr=kind][data-k=email]"); await page.waitForTimeout(80);
  want(/^Subject: /.test(await page.evaluate(s => document.querySelector(s + " [data-pv=draft]").value, sel)), "email pitch has no subject line");
  await page.fill(sel + " [data-pv=phone]", "0240000001"); await page.dispatchEvent(sel + " [data-pv=phone]", "change"); await page.waitForTimeout(80);
  await page.click(sel + " [data-pr=copy]"); await page.waitForTimeout(50);
  want((await page.evaluate(() => window.__clip.slice(-1)[0] || "")).includes("GH₵38,400"), "Copy didn't copy the pitch");
  const wa = await page.evaluate(s => document.querySelector(s + " [data-pr-wa]").getAttribute("href"), sel);
  want(/^https:\/\/wa\.me\/233240000001\?text=/.test(wa), "Open WhatsApp link wrong: " + wa);
  await page.click(sel + " [data-pr=quote]"); await page.waitForTimeout(80);
  want(await page.evaluate(() => /PROFORMA INVOICE/.test((window.__opened.slice(-1)[0] || { doc: { html: "" } }).doc.html) && /Bright Future Academy/.test(window.__opened.slice(-1)[0].doc.html)), "quote page didn't open as a proforma for the prospect");
  await page.click(sel + " [data-pr=lead]"); await page.waitForTimeout(250);
  const lead = posts.map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean).find(x => x.source === "prospect");
  want(lead && lead.organisation === "Bright Future Academy" && lead.phone === "0240000001" && /GH₵38,400/.test(lead.message), "Add to Leads didn't post a prospect lead: " + JSON.stringify(lead));
  want(await page.evaluate(() => document.documentElement.scrollWidth) <= 392, "Bulk buyers screen scrolls sideways on a phone");
  if (process.env.PROSPECTS_SHOT) await page.screenshot({ path: process.env.PROSPECTS_SHOT, fullPage: true });
  // save: only public fields reach the repo
  await page.click("[data-pr=save]"); await page.waitForTimeout(150);
  const saved = await page.evaluate(() => window.__files["data/prospects.json"]);
  const raw = JSON.stringify(saved);
  want(saved.prospects.length === 2 && saved.prospects.some(x => x.keep && x.checked), "shortlist didn't save: " + raw.slice(0, 200));
  want(!/0240000001|38,400|draft|"qty"|"price"/.test(raw), "private data leaked into data/prospects.json: " + raw.slice(0, 300));
  want(await page.evaluate(() => !window.__muse.some(m => m.action !== "muse")), "a backend action other than muse was called");
  const bad = await page.evaluate(() => window.__toasts.filter(t => t.startsWith("✗") && !/AI suggestions are off|source link first/.test(t)));
  bad.forEach(t => problems.push("error toast: " + t));
  await page.close();
  return { problems };
}

// "🪪 Profile kit" (admin/profilekit.js, #profilekit): every prompt card, per-platform limits, brand facts only,
// M6 gate, bio ranking + "Save to brand" writes accounts.<net>.bio in brands.json only on click.
async function profilekit(browser) {
  const problems = [], want = (ok, m) => { if (!ok) problems.push(m); };
  const page = await plainPage(browser, problems);
  for (const f of ["admin/aiplan.js", "admin/brands.js", "admin/profilekit.js"]) await page.addScriptTag({ content: fs.readFileSync(ROOT + f, "utf8") });
  await page.evaluate(async () => {
    const plan = await window.FAV_AIPLAN.load(true);
    const rule = plan.rules.find(r => r.id === "M6");
    if (!rule) throw new Error("AI Plan is missing the M6 rule");
    rule.status = "proposed";
  });
  await page.evaluate(() => document.querySelector("[data-profilekit]").click());
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ hash: location.hash, cards: document.querySelectorAll("[data-pk]").length, brands: document.querySelectorAll("[data-pk-sel=brand] option").length, off: /AI writing is off/.test(document.querySelector("#pk-body").innerText) }));
  want(st.hash === "#profilekit", "deep link #profilekit not set");
  want(st.cards === 8, "expected 8 prompt cards, got " + st.cards);
  want(st.brands === files["data/brands.json"].brands.length + 1, "brand picker should list every brand + Fa Vision Furnitures: " + st.brands);
  want(st.off, "no 'AI writing is off' notice while M6 is Proposed");
  await page.click("[data-pk-run=bio]"); await page.waitForTimeout(100);
  want(await page.evaluate(() => window.__muse.length) === 0, "AI ran while M6 is Proposed");
  // Copy prompt works without AI, carries the limit and only this brand's facts
  await page.evaluate(() => window.FAV_PROFILEKIT._test.sel({ brand: "oteng-furniture", net: "tiktok" }));
  await page.click("[data-pk-prompt=bio]"); await page.waitForTimeout(50);
  const pr = await page.evaluate(() => window.__clip.slice(-1)[0] || "");
  want(/80 characters/.test(pr) && /Oteng Furniture/.test(pr) && !/favisionenterprize|F\.A Vision Enterprise\b(?! \()/.test(pr.replace("do not use F.A Vision's links", "")), "Oteng TikTok prompt wrong (limit 80, own facts only): " + pr.slice(0, 300));
  // approve M6, write bios (one too long), save #1 to brand
  await page.evaluate(() => { window.FAV_AIPLAN._test.state().rules.find(r => r.id === "M6").status = "approved";
    window.__museReply = () => ({ ok: true, text: JSON.stringify({ options: [{ text: "x".repeat(200), why: "too long" }, { text: "Fresh student desks for every classroom 📚 Delivered in Accra. WhatsApp to order", why: "promise + CTA" }, { text: "Furniture you can trust. WhatsApp us", why: "short" }] }) }); });
  await page.evaluate(() => window.FAV_PROFILEKIT._test.sel({ brand: "fa-vision", net: "instagram" }));
  await page.click("[data-pk-run=bio]"); await page.waitForTimeout(200);
  const opts = await page.evaluate(() => [...document.querySelectorAll("[data-pk=bio] .pk-opt")].map(o => ({ t: o.innerText.slice(0, 40), over: !!o.querySelector(".pk-n.over"), save: !!o.querySelector("[data-pk-savebio]") })));
  want(opts.length === 3 && opts[2].over && !opts[2].save && !opts[0].over, "bio over the 150 limit should rank last without Save: " + JSON.stringify(opts));
  want(await page.evaluate(() => window.__saves.length) === 0, "something saved before any click");
  want(await page.evaluate(() => document.documentElement.scrollWidth) <= 392, "Profile kit screen scrolls sideways on a phone");
  if (process.env.PROFILEKIT_SHOT) await page.screenshot({ path: process.env.PROFILEKIT_SHOT, fullPage: true });
  await page.click("[data-pk=bio] [data-pk-savebio='0']"); await page.waitForTimeout(150);
  const b = await page.evaluate(() => window.__files["data/brands.json"].brands.find(x => x.id === "fa-vision").accounts.instagram);
  want(b.bio === "Fresh student desks for every classroom 📚 Delivered in Accra. WhatsApp to order" && b.handle === "favisionent" && b.status === "live", "Save to brand didn't write the Instagram bio: " + JSON.stringify(b));
  await page.click("[data-pk-save]"); await page.waitForTimeout(100);
  want(!!(await page.evaluate(() => (window.__files["data/profile-kits.json"].kits["fa-vision:instagram"] || {}).outputs)), "Save kit didn't store the outputs");
  want(await page.evaluate(() => window.__muse.every(m => m.action === "muse")), "a backend action other than muse was called");
  (await page.evaluate(() => window.__toasts.filter(t => t.startsWith("✗") && !/AI writing is off/.test(t)))).forEach(t => problems.push("error toast: " + t));
  await page.close();
  return { problems };
}

// "📊 Sales" (admin/sales.js, #sales): 4 tiles, 2 charts, 1 table from the orders + customers reads; channels;
// Record a sale posts the existing order + update_order actions.
async function sales(browser) {
  const problems = [], want = (ok, m) => { if (!ok) problems.push(m); };
  const posts = [], gets = [];
  const now = Date.now(), iso = d => new Date(now - d * 864e5).toISOString();
  const ORD = [
    { Timestamp: iso(1), Reference: "FAV-A1", Product: "Student Desk Chair Set — Senior High (FAV-014)", Quantity: 60, TotalGHS: 38400, PaidNowGHS: 19200, BalanceGHS: 19200, PaymentOption: "Pay a deposit", Progress: "Confirmed", Notes: "" },
    { Timestamp: iso(3), Reference: "FAV-A2", Product: "Luxury Leather Sofa Set · via TikTok (FAV-016)", Quantity: 1, TotalGHS: 8500, PaidNowGHS: 8500, BalanceGHS: 0, PaymentOption: "Pay in full", Progress: "Delivered", Notes: "" },
    { Timestamp: iso(5), Reference: "FAV-A3", Product: "Centre Table (FAV-018)", Quantity: 2, TotalGHS: 1600, PaidNowGHS: 0, BalanceGHS: 0, PaymentOption: "Walk-in sale (recorded in admin)", Progress: "Balance paid", Notes: "Channel: walk-in · recorded in admin" },
    { Timestamp: iso(8), Reference: "FAV-A4", Product: "Centre Table (FAV-018)", Quantity: 1, TotalGHS: 800, PaidNowGHS: 0, BalanceGHS: 800, PaymentOption: "Pay on delivery", Progress: "Cancelled", Notes: "" },
    { Timestamp: iso(60), Reference: "FAV-A5", Product: "Office Chair (FAV-017)", Quantity: 1, TotalGHS: 4500, PaidNowGHS: 4500, BalanceGHS: 0, PaymentOption: "Pay in full", Progress: "Delivered", Notes: "Channel: marketplace" }];
  const page = await plainPage(browser, problems, async pg => pg.route("https://backend.smoke.test/**", r => {
    const u = new URL(r.request().url());
    if (r.request().method() === "POST") { posts.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); }
    gets.push(u.searchParams.get("action"));
    if (u.searchParams.get("action") === "orders") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, orders: ORD }) });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, customers: [{ name: "X", enquiries: [{ row: 2, when: iso(2), source: "whatsapp", status: "Won" }] }] }) });
  }));
  await page.evaluate(() => localStorage.setItem("fav-orders-key", "smoke"));
  await page.addScriptTag({ content: fs.readFileSync(ROOT + "admin/sales.js", "utf8") });
  await page.evaluate(() => document.querySelector("[data-sales]").click());
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ hash: location.hash, tiles: [...document.querySelectorAll("#sl-body .stat")].map(s => s.innerText.split("\n")[0]), svgs: document.querySelectorAll("#sl-body svg").length, bars: document.querySelectorAll(".sl-chrow").length, rows: document.querySelectorAll(".sl-table tbody tr").length, ch: [...document.querySelectorAll(".sl-chrow")].map(r => r.innerText.replace(/\s+/g, " ")), w: document.documentElement.scrollWidth }));
  want(st.hash === "#sales", "deep link #sales not set");
  want(st.tiles.length === 4, "expected 4 KPI tiles, got " + st.tiles.length);
  want(JSON.stringify(st.tiles) === JSON.stringify(["GH₵48,500", "3", "GH₵16,167", "GH₵19,200"]), "KPI tiles wrong (30 days, cancelled left out): " + JSON.stringify(st.tiles));
  want(st.svgs === 1 && st.bars === 5, "expected the 30-day SVG chart and 5 channel bars: " + JSON.stringify([st.svgs, st.bars]));
  want(st.rows === 3, "by-product table should have 3 rows for 30 days: " + st.rows);
  want(/TikTok.*8,500/.test(st.ch.join("|")) && /Walk-in.*1,600/.test(st.ch.join("|")) && /WhatsApp.*\+1 won/.test(st.ch.join("|")), "channels wrong: " + JSON.stringify(st.ch));
  want(st.w <= 392, "sales screen scrolls sideways on a phone: " + st.w);
  if (process.env.SALES_SHOT) await page.screenshot({ path: process.env.SALES_SHOT, fullPage: true });
  want(gets.includes("orders") && gets.includes("customers"), "didn't read orders + customers");
  await page.click("[data-sl-period='0']"); await page.waitForTimeout(400);
  want(await page.evaluate(() => document.querySelector("#sl-body .stat b").innerText) === "GH₵53,000", "All time revenue wrong");
  await page.click("[data-sl-rec]"); await page.waitForTimeout(100);
  await page.fill("#sl-rec-form [name=name]", "Walk-in buyer"); await page.selectOption("#sl-rec-form [name=product]", "FAV-014"); await page.fill("#sl-rec-form [name=qty]", "2");
  await page.click("#sl-rec-form [type=submit]"); await page.waitForTimeout(2200);
  const o = posts.find(p => p.action === "order"), u = posts.find(p => p.action === "update_order");
  want(o && o.product_id === "FAV-014" && o.quantity === 2 && o.amount_due === 0 && /^FAV-[A-Z0-9]{6,20}$/.test(o.reference), "Record a sale didn't post a valid order: " + JSON.stringify(o));
  want(u && u.reference === (o || {}).reference && u.progress === "Balance paid" && /Channel: walk-in/.test(u.note), "Record a sale didn't mark it paid with the channel: " + JSON.stringify(u));
  want(await page.evaluate(() => window.FAV_SALES._test.channelOf({ PaymentOption: "WhatsApp sale (recorded in admin)", Notes: "" })) === "whatsapp", "channel fallback from the payment label failed");
  (await page.evaluate(() => window.__toasts.filter(t => t.startsWith("✗")))).forEach(t => problems.push("error toast: " + t));
  await page.close();
  return { problems, tiles: st.tiles };
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
  const bx = await boxads(browser, process.env.BOX_SHOT || "");
  if (bx.problems.length) { failed++; console.log("✗ What's in the Box ads screen"); bx.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ What's in the Box ads screen: ${bx.cards} box ads drawn, caption passes the gate, Edit contents and ✓ Confirmed save, ${bx.pool} Box ads in the posting pool`);
  const ap = await aiplan(browser, process.env.AIPLAN_SHOT || "");
  if (ap.problems.length) { failed++; console.log("✗ AI Plan screen"); ap.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ AI Plan screen: ${ap.rules} rules drawn; edits, Retired, Needs approval, Pause All / Resume and new rules work with the autopilot gate`);
  const pro = await prospects(browser);
  if (pro.problems.length) { failed++; console.log("✗ Bulk buyers screen"); pro.problems.forEach(p => console.log("    " + p)); }
  else console.log("✓ Bulk buyers screen: S5 gate, unverified AI suggestions, chains dropped, keepers need a source, price/quantity stop, pitch + email + quote + WhatsApp + Add to Leads, only public info saved");
  const pk = await profilekit(browser);
  if (pk.problems.length) { failed++; console.log("✗ Profile kit screen"); pk.problems.forEach(p => console.log("    " + p)); }
  else console.log("✓ Profile kit screen: 8 prompt cards per brand × platform, M6 gate, limits, brand facts only, bio ranking, Save to brand on click only");
  const sl = await sales(browser);
  if (sl.problems.length) { failed++; console.log("✗ Sales screen"); sl.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ Sales screen: ${sl.tiles.join(" · ")}; 30-day chart, channels, by product, phone width, Record a sale`);
  const brs = await brands(browser, process.env.BRANDS_SHOT || "");
  if (brs.problems.length) { failed++; console.log("✗ Brands screen"); brs.problems.forEach(p => console.log("    " + p)); }
  else console.log(`✓ Brands screen: ${brs.cards} brands drawn with kits; setup pack, edits and brand detection work`);
  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll admin checks passed.");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
