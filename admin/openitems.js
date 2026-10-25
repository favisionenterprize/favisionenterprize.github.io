// 🤖 Open items (admin dash button, deep link #openitems; data/open-items.json). Every open item the admin can detect,
// in one list (source · what's wrong · the fix), and ONE button "✨ AI Fix" that fixes everything it may, with no setup:
//  - detected: Fix all counts (FB/IG/X descriptions + hashtags), empty TikTok descriptions, Marketplace not-listed /
//    price differences / duplicates, profile link + pinned-post issues, products due for Seek, unconfirmed "What's in
//    the box", stale go-viral checks, brands with accounts to create, leads not contacted, SEO issues with a ready fix,
//    plus the project's open items (MANUAL below);
//  - "AI Fix" acts through the existing paths only: social fixes = one fbauto runStep chain (fx:*, ttcaps:all, mklist,
//    profile:<net>:fix: every step still passes its own AI Plan rule), SEO fixes = data/seo-fixes.json (seo-fixes.yml
//    builds them), lead replies = drafts (Code.gs `muse` if the backend has an AI key, else a template) opened in
//    WhatsApp for Alexander to send. Gated by AI Plan rule M9 (`aifix`, Proposed);
//  - it LEARNS from Alexander's own history and says so per row ("learned from: …"): approved AI Plan rules, the
//    Marketplace "Don't list" choices (skip[] → similar products are left off too), his price choices (Marketplace
//    "Use … on the site" clicks are logged here in history.price; rule S4 blocks AI price changes, so prices stay his),
//    approved Seek texts (copy_variants), the caption style he kept (TikTok classy / Boost hooks), SEO fixes he applied,
//    brand routing (only brands whose accounts are live);
//  - NEVER does itself (CLAUDE.md / handover rules): delete anything, passwords / API keys / 2FA, payments or
//    subscriptions (Meta Verified), sending messages to customers (drafts + opens WhatsApp, he taps send), account
//    security settings, creating accounts, confirming facts only he knows (box contents), approving web copy (Seek).
//    Those rows say "Needs you" with a one-tap link to exactly where to do it.
// Every action is logged in data/open-items.json { log[], done{}, history{ price[] } }.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const F = () => window.FAV_FBAUTO;
  const FILE = "data/open-items.json";
  const EMPTY = { updated: null, done: {}, log: [], history: { price: [] } };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, bad) => { if (A().toast) A().toast(m, bad); };
  const today = () => new Date().toLocaleDateString("en-CA");
  const short = p => String(p.name).split(" — ")[0];
  const SITE = "https://favisionenterprize.github.io/";
  let D = null, busy = false, lastRun = null, filter = "all";

  // Project open items (from the FA Vision project's open-items list). `you` = only Alexander can do it.
  const MANUAL = [
    { id: "m-julius", src: "Customers", what: "Julius is waiting for a reply.", fix: "Reply to him on WhatsApp (open Leads to find his chat).", you: "Sending messages to customers is yours", link: "#leads" },
    { id: "m-missing8", src: "Marketplace", what: "8 products are not on Facebook Marketplace yet (FAV-027 … FAV-034).", fix: "List them on Marketplace with photos, price and a description.", steps: ["mklist"], ids: ["FAV-027", "FAV-028", "FAV-029", "FAV-030", "FAV-031", "FAV-032", "FAV-033", "FAV-034"] },
    { id: "m-bios", src: "Profiles", what: "Bio links and the pinned student desk post aren't set on every network.", fix: "Set the link and pin the student desk post (Facebook, X here; Instagram/TikTok pinning may be app-only).", steps: ["profile:fb:fix", "profile:x:fix", "profile:ig:fix", "profile:tiktok:fix"] },
    { id: "m-prices", src: "Prices", what: "Price decisions are waiting (website vs Marketplace).", fix: "Decide each price yourself in Marketplace → Price differences.", you: "Rule S4: only you change prices", link: "#fbauto", tab: "market" },
    { id: "m-metaverified", src: "Meta Verified", what: "Meta Verified free trial not decided.", fix: "Start or skip the trial in Meta Verified (it becomes a paid subscription).", you: "Payments and subscriptions are yours", url: "https://www.facebook.com/meta-verified" },
    { id: "m-2fa", src: "Security", what: "Two-factor sign-in (2FA) not confirmed on every account.", fix: "Turn on 2FA in Accounts Center → Password and security (and on X, TikTok).", you: "Account security settings are yours", url: "https://accountscenter.facebook.com/password_and_security" },
    { id: "m-apikeys", src: "Backend", what: "AI / Pexels API keys not confirmed in the backend.", fix: "Apps Script → Project Settings → Script properties: GEMINI_API_KEY or ANTHROPIC_API_KEY, PEXELS_API_KEY.", you: "API keys are yours to enter", url: "https://script.google.com/home" }
  ];

  function norm(d) {
    d = d && typeof d === "object" ? d : JSON.parse(JSON.stringify(EMPTY));
    d.done = d.done || {}; d.log = Array.isArray(d.log) ? d.log : []; d.history = Object.assign({ price: [] }, d.history || {});
    return d;
  }
  async function load(force) { if (!D || force) { try { D = norm(await A().readJsonFile(FILE, EMPTY)); } catch (e) { D = D || norm(null); } } return D; }

  // ---------------------------------------------------------------- what Alexander's history says
  function learn() {
    const L = {};
    const AP = window.FAV_AIPLAN && window.FAV_AIPLAN._test ? window.FAV_AIPLAN._test.state() : null;
    const rules = AP ? AP.rules : [];
    L.rule = id => rules.find(r => r.id === id) || null;
    L.approved = rules.filter(r => r.status === "approved").map(r => r.id);
    const MK = window.FAV_MKAUTO && window.FAV_MKAUTO.state();
    L.skip = MK ? MK.skip || [] : [];
    const prods = (A().products && A().products()) || [];
    L.skipCats = [...new Set(L.skip.map(id => (prods.find(p => p.id === id) || {}).category).filter(Boolean))];
    const ph = (D && D.history.price) || [];
    L.price = { site: ph.filter(x => x.use === "marketplace").length, kept: ph.filter(x => x.use === "site").length };
    L.seek = prods.filter(p => (p.copy_variants || []).length).length;
    const so = window.FAV_SOCAUTO && window.FAV_SOCAUTO.state();
    L.classy = !!(so && so.settings && so.settings.tiktok && so.settings.tiktok.classy);
    L.hooks = !!(window.FAV_BOOST && window.FAV_BOOST.hooks && window.FAV_BOOST.hooks());
    L.liveBrands = ((window.FAV_BRANDS && window.FAV_BRANDS.list()) || []).filter(b => Object.values(b.accounts || {}).some(a => a && a.status === "live")).map(b => b.short || b.name);
    return L;
  }
  const ruleNote = (L, id) => { const r = L.rule(id); return r ? `rule ${id} (${r.status}${r.setting === "block" ? ", blocked" : ""})` : ""; };

  // ---------------------------------------------------------------- detect
  function items() {
    const out = [], L = learn();
    const add = o => out.push(Object.assign({ act: o.you ? "you" : "auto" }, o));
    const FX = window.FAV_FIXALL, TTC = window.FAV_TTCAPS, MK = window.FAV_MKAUTO, PRO = window.FAV_PROFILES, VIR = window.FAV_VIRAL, BR = window.FAV_BRANDS;
    const NET = { fb: "Facebook Page", ig: "Instagram", x: "X" };
    if (FX && FX.state && FX.state()) {
      const c = FX.counts();
      for (const n of ["fb", "ig", "x"]) if (c[n] && (c[n].desc || c[n].tags)) add({ id: "fx-" + n, src: "Fix all · " + NET[n], what: `${c[n].desc} post${c[n].desc === 1 ? "" : "s"} without a description, ${c[n].tags} without hashtags.`, fix: n === "x" ? "Reply under each post with the description (X can't edit)." : "Edit each post: paste a fresh description / hashtags.", steps: ["fx:scan:" + n, "fx:fix:" + n], learned: [L.classy && "the classy caption style you kept", ruleNote(L, "M1")].filter(Boolean) });
      if (c.web) add({ id: "fx-web", src: "Website", what: `${c.web} product${c.web === 1 ? " has" : "s have"} a short description or < 2 highlights.`, fix: "Run Seek, then approve the texts and photos you like.", you: "Web copy goes live only after you approve it (your Seek rule)", link: "#seek", learned: [L.seek ? `${L.seek} products where you approved Seek texts` : "no Seek approvals yet"] });
    }
    if (TTC && TTC.state && TTC.state()) {
      const n = TTC.waiting().length + (TTC.tagsWaiting ? TTC.tagsWaiting().length : 0);
      if (n) add({ id: "ttcaps", src: "TikTok", what: `${n} TikTok post${n === 1 ? "" : "s"} with no description or no hashtags.`, fix: "Write classy captions and paste them in TikTok Studio (posts under 7 days old).", steps: ["ttcaps:all"], learned: [L.classy && "classy captions (your TikTok setting)"].filter(Boolean) });
    }
    if (MK && MK.state && MK.state()) {
      const an = MK.analyse();
      if (an.scanned) {
        const miss = an.missing.filter(p => !L.skipCats.includes(p.category));
        const held = an.missing.length - miss.length;
        if (miss.length) add({ id: "mk-missing", src: "Marketplace", what: `${miss.length} product${miss.length === 1 ? " is" : "s are"} not on Marketplace${held ? ` (${held} more left off like the ones you marked "Don't list")` : ""}.`, fix: "List them: photos, price, description, Odorkor. No groups, no Boost.", steps: ["mklist"], ids: miss.map(p => p.id), learned: [L.skip.length ? `your "Don't list" choices (${L.skip.join(", ")})` : "no \"Don't list\" choices yet"] });
        if (an.mismatch.length) add({ id: "mk-price", src: "Marketplace", what: `${an.mismatch.length} listing price${an.mismatch.length === 1 ? " differs" : "s differ"} from the website.`, fix: "Choose per listing: use the Marketplace price on the site, or edit the listing on Facebook.", you: "Rule S4: only you change prices", link: "#fbauto", tab: "market", learned: [L.price.site + L.price.kept ? `you used the Marketplace price ${L.price.site}× and kept the site price ${L.price.kept}×` : "no price choices logged yet", ruleNote(L, "S4")].filter(Boolean) });
        if (an.dups.length) add({ id: "mk-dups", src: "Marketplace", what: `${an.dups.length} title${an.dups.length === 1 ? " is" : "s are"} listed more than once.`, fix: "Mark the extra ones sold or delete them on Facebook.", you: "Deleting anything is yours", url: "https://www.facebook.com/marketplace/you/selling" });
      } else add({ id: "mk-scan", src: "Marketplace", what: "Marketplace hasn't been scanned yet.", fix: "Read Your listings (read-only).", steps: ["mkscan"] });
    }
    if (PRO && PRO.state && PRO.state()) {
      const st = PRO.state().status || {};
      for (const [net, s] of Object.entries(st)) {
        if (s.linkOk && s.pinOk) continue;
        const app = /in the app|app only|app-only/i.test(s.why || "") && (net === "ig" || net === "tiktok");
        const name = { fb: "Facebook Page", ig: "Instagram", x: "X", tiktok: "TikTok" }[net] || net;
        if (app) add({ id: "pro-" + net, src: "Profile · " + name, what: `${s.linkOk ? "" : "Bio link not set. "}${s.pinOk ? "" : "Student desk post not pinned."}`.trim(), fix: s.why || "Pin it in the app: open the post → ••• → Pin.", you: `${name} only allows this in its phone app`, url: net === "ig" ? "https://www.instagram.com/favisionent/" : "https://www.tiktok.com/@favisionenterprise" });
        else add({ id: "pro-" + net, src: "Profile · " + name, what: `${s.linkOk ? "" : "Bio link not set. "}${s.pinOk ? "" : "Student desk post not pinned."}`.trim(), fix: "Set the website link and pin the post (only the link field and the pin change).", steps: ["profile:" + net + ":fix"] });
      }
    }
    const prods = ((A().products && A().products()) || []).filter(p => !p.placeholder);
    const box = prods.filter(p => (p.in_the_box || []).length && !p.in_the_box_confirmed);
    if (box.length) add({ id: "box", src: "What's in the box", what: `${box.length} product${box.length === 1 ? "'s" : "s'"} box contents are guesses, not confirmed.`, fix: "Check each list against a real carton, fix it, tick ✓ Confirmed.", you: "Only you know what's really in the carton", link: "#boxads" });
    if (VIR && VIR.due) { const n = VIR.due(); if (n) add({ id: "viral", src: "Go-viral settings", what: `${n} account setting check${n === 1 ? " is" : "s are"} due.`, fix: "Open each setting and tick it (shadow-ban check too).", you: "Account settings are yours", link: "#fbauto", tab: "engage" }); }
    if (BR && BR.list) {
      const todo = BR.list().flatMap(b => Object.entries(b.accounts || {}).filter(([, a]) => a && a.status === "to_create").map(([n]) => `${b.short || b.name} ${n}`));
      if (todo.length) add({ id: "brands", src: "Brands", what: `${todo.length} brand account${todo.length === 1 ? "" : "s"} still to create.`, fix: "Each has a setup pack (name, handle, bio, picture, signup link) in 🏷 Brands.", you: "You create accounts yourself", link: "#brands", learned: [L.liveBrands.length ? `brands already live: ${L.liveBrands.join(", ")}` : ""].filter(Boolean) });
    }
    const LE = window.FAV_LEADS && window.FAV_LEADS._test ? window.FAV_LEADS._test.get() : [];
    const newLeads = (LE || []).filter(l => l.status === "New" && l.editable);
    if (newLeads.length) add({ id: "leads", src: "Leads", what: `${newLeads.length} lead${newLeads.length === 1 ? " hasn't" : "s haven't"} been contacted.`, fix: "AI Fix drafts a reply for each and opens WhatsApp; you press send.", you: "Sending messages to customers is yours", link: "#leads", draft: newLeads.slice(0, 20).map(l => ({ k: l.k, name: l.name, phone: l.phone, product: l.product, message: l.message })) });
    const SEO = window.FAV_OI_SEO;
    if (SEO && SEO.issues.length) add({ id: "seo", src: "SEO & AI", what: `${SEO.issues.length} SEO issue${SEO.issues.length === 1 ? " has" : "s have"} a ready fix (${SEO.issues.slice(0, 3).map(i => i.check).join(", ")}…).`, fix: "Apply the ready fixes (built from your own facts); the website updates in ~2 minutes.", seo: SEO.issues.map(i => i.fix), learned: [SEO.applied ? `you applied ${SEO.applied} SEO fixes before` : ""].filter(Boolean) });
    for (const m of MANUAL) if (!(D && D.done[m.id])) add(Object.assign({}, m, { manual: true }));
    // AI Plan: an item whose steps are all blocked/human-only is shown as Needs you.
    for (const it of out) if (it.act === "auto" && it.steps && window.FAV_AIPLAN && window.FAV_AIPLAN.decide) {
      const why = it.steps.map(k => window.FAV_AIPLAN.decide(k)).find(d => d.v === "skip" && d.r && (d.r.setting === "block" || d.r.line === "human"));
      if (why) { it.act = "you"; it.you = why.why; }
    }
    return out;
  }
  // SEO: the latest report's issues that have a fix not applied yet.
  async function loadSeo() {
    try {
      const [rep, fixes] = await Promise.all([A().readJsonFile("data/seo-report.json", null), A().readJsonFile("data/seo-fixes.json", { applied: [] })]);
      const done = new Set(((fixes && fixes.applied) || []).filter(f => !f.removed).map(f => f.id));
      window.FAV_OI_SEO = { issues: ((rep && rep.issues) || []).filter(i => i.fix && i.fix.id && !i.fix.applied && !done.has(i.fix.id)), applied: done.size };
    } catch (e) { window.FAV_OI_SEO = { issues: [], applied: 0 }; }
  }

  // ---------------------------------------------------------------- AI Fix
  const greet = l => `Hello ${String(l.name || "").trim().split(/\s+/)[0] || "there"}, thank you for contacting F.A Vision Enterprise${l.product ? " about the " + l.product : ""}. How can we help you? You can see photos and prices here: ${SITE}`;
  async function drafts(list) {
    // One AI call for all drafts when the backend has a key; otherwise the template (never asks for setup).
    let ai = null;
    try {
      if (A().backendSigned && list.length) {
        const r = await A().backendSigned({ action: "muse", mode: "content", context: list.map((l, i) => `${i + 1}. ${l.name || "Customer"} · ${l.product || "general enquiry"} · said: ${String(l.message || "").slice(0, 200)}`).join("\n"),
          messages: [{ role: "user", text: `Write one short, warm WhatsApp reply (max 50 words, plain text) from F.A Vision Enterprise for each numbered lead above. Never invent prices or stock; invite them to see ${SITE} or visit the Odorkor showroom. Reply with JSON only: {"replies":["…"]}` }] });
        if (r && r.ok && r.text) { const m = String(r.text).match(/\{[\s\S]*\}/); ai = m ? (JSON.parse(m[0]).replies || null) : null; }
      }
    } catch (e) { ai = null; }
    return list.map((l, i) => ({ ...l, text: (ai && ai[i] && String(ai[i]).trim()) || greet(l), by: ai && ai[i] ? "AI" : "template" }));
  }
  async function fixAll(opts) {
    opts = opts || {};
    if (busy) return lastRun;
    const AP = window.FAV_AIPLAN;
    if (AP && AP.paused && AP.paused()) { toast("Paused in 🧭 AI Plan.", true); return { error: "paused" }; }
    if (AP && AP.decide) { const d = AP.decide("aifix"); if (d.v === "skip") { if (!opts.auto) toast(`AI Fix is off: ${d.why}. Approve rule M9 in 🧭 AI Plan.`, true); return { error: d.why }; } }
    if (AP && AP.gate && !AP.gate("aifix", "aifix-" + new Date().toISOString().slice(0, 13))) return { error: "declined" };
    busy = true; render();
    await load(true); await loadSeo();
    const list = items(), log = [], L = learn();
    const note = (it, action, result) => log.push({ t: new Date().toISOString(), id: it.id, src: it.src, action, result, ...(it.learned && it.learned.length ? { learned: it.learned.join("; ") } : {}) });
    try {
      // 1. Website: SEO fixes (data/seo-fixes.json, same entry as "Apply fix").
      const seo = list.find(i => i.id === "seo");
      if (seo) {
        try {
          const add = seo.seo.map(f => ({ id: f.id, kind: f.kind, page: f.page, value: f.value, applied_at: today(), by: "AI Fix" }));
          await A().saveJson("data/seo-fixes.json", d => { d = d && typeof d === "object" ? d : {}; const ids = new Set(add.map(x => x.id)); d.applied = (d.applied || []).filter(x => !ids.has(x.id)).concat(add); return d; }, `AI Fix: ${add.length} SEO fixes`, { applied: [] });
          note(seo, `applied ${add.length} SEO fixes`, "ok"); seo.result = "fixed";
        } catch (e) { note(seo, "SEO fixes", "failed: " + (A().friendly ? A().friendly(e) : e)); seo.result = "failed"; }
      }
      // 2. Lead replies: drafts only, WhatsApp opens for the first one (he taps send; the rest wait in the list).
      const leads = list.find(i => i.id === "leads");
      if (leads) {
        const ds = await drafts(leads.draft);
        try { localStorage.setItem("fa-oi-drafts", JSON.stringify(ds)); } catch (e) { /* storage off: shown once */ }
        leads.drafts = ds; leads.result = "drafted";
        note(leads, `drafted ${ds.length} WhatsApp replies (${ds[0] ? ds[0].by : "template"})`, "waiting for you to send");
      }
      // 3. Social fixes: one runStep chain (each step passes its own AI Plan rule; Prime runs these in its lanes).
      const social = list.filter(i => i.act === "auto" && i.steps);
      if (social.length && !(opts.from === "prime")) {
        const steps = [...new Set(social.flatMap(i => i.steps.flatMap(k => k === "mklist" ? [] : [k])))];
        const ids = [...new Set(social.filter(i => i.steps.includes("mklist")).flatMap(i => i.ids || []))];
        const f = F();
        if (f && f.runStep) {
          if (ids.length && window.FAV_MKAUTO && window.FAV_MKAUTO.startList) window.FAV_MKAUTO.startList(ids, {}, steps);
          else if (steps.length) f.runStep(steps, true);
        }
        social.forEach(i => { i.result = f ? "started" : "needs the Social autopilot"; note(i, `started ${i.steps.join(" → ")}${i.ids ? " for " + i.ids.join(", ") : ""}`, i.result); });
      } else social.forEach(i => { i.result = "in the Prime run"; note(i, "left to the ⚡ Prime lanes", "running"); });
      list.filter(i => i.act === "you").forEach(i => note(i, "needs you: " + i.you, "waiting"));
      D = norm(await A().saveJson(FILE, d => { d = norm(d); d.log = d.log.concat(log).slice(-400); d.updated = new Date().toISOString(); d.learned = { approved_rules: L.approved, skip: L.skip, price: L.price, seek_approved: L.seek, classy: L.classy, live_brands: L.liveBrands }; return d; }, `AI Fix: ${log.length} items`, EMPTY));
      lastRun = { at: Date.now(), items: list, fixed: list.filter(i => i.act === "auto").length, you: list.filter(i => i.act === "you").length };
      if (!opts.auto) toast(`AI Fix: ${lastRun.fixed} fixed or started, ${lastRun.you} need you.`);
      return lastRun;
    } finally { busy = false; render(); }
  }

  // ---------------------------------------------------------------- screen
  let screen = $("#screen-openitems");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-openitems"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>🤖 Open items</h1><p class="muted">Everything still open across the website, Marketplace and your socials. ✨ AI Fix fixes all it may, the way you've been running things, and leaves you only what must be yours.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button></div></div><div id="oi-body"><p class="muted">Loading…</p></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `#oi-body{display:grid;gap:14px}.oi-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.oi-fix{font-size:18px;font-weight:800;padding:14px 22px}
.oi-row{background:#fff;border:1px solid #e3e7ee;border-left:4px solid #0d55af;border-radius:10px;padding:10px 12px;display:grid;gap:4px;min-width:0;overflow-wrap:anywhere}
.oi-row.you{border-left-color:#f2a541}.oi-row.done{border-left-color:#1f9d55;opacity:.8}.oi-src{font-size:12px;font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:.04em}
.oi-learn{font-size:12px;color:#1f7a45}.oi-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.oi-chip{font-size:11px;font-weight:700;border-radius:99px;padding:2px 8px;background:#e8f0fe;color:#0d55af}
.oi-row.you .oi-chip{background:#fff2dc;color:#8a5300}.oi-draft{background:#f6f8fc;border-radius:8px;padding:6px 8px;font-size:13px}`;
    document.head.appendChild(st);
  }
  if (!document.querySelector("[data-openitems]")) {
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-openitems>🤖 Open items</button>`);
  }
  async function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#openitems") history.replaceState(null, "", "#openitems");
    await Promise.all([load(true), loadSeo()]);
    render();
  }
  const waLink = d => `https://wa.me/${String(d.phone || "").replace(/\D/g, "").replace(/^0/, "233")}?text=${encodeURIComponent(d.text)}`;
  function row(it) {
    const res = lastRun && (lastRun.items.find(x => x.id === it.id) || {}).result;
    const dr = it.id === "leads" ? (it.drafts || (() => { try { return JSON.parse(localStorage.getItem("fa-oi-drafts") || "null"); } catch (e) { return null; } })()) : null;
    const go = it.url ? `<a class="btn btn-sell btn-sm" href="${esc(it.url)}" target="_blank" rel="noopener">Open ↗</a>` : it.link ? `<a class="btn btn-sell btn-sm" href="${esc(it.link)}" data-oi-go="${esc(it.link)}"${it.tab ? ` data-oi-tab="${esc(it.tab)}"` : ""}>Go there</a>` : "";
    return `<div class="oi-row ${it.act}${res === "fixed" ? " done" : ""}" data-oi="${esc(it.id)}">
      <div class="oi-src">${esc(it.src)} <span class="oi-chip">${it.act === "you" ? "Needs you" : res ? esc(res) : "AI Fix"}</span></div>
      <div><b>${esc(it.what)}</b></div><div class="fa-small">Fix: ${esc(it.fix)}</div>
      ${it.act === "you" ? `<div class="fa-small muted">Why it's yours: ${esc(it.you)}</div>` : ""}
      ${it.learned && it.learned.length ? `<div class="oi-learn">learned from: ${esc(it.learned.join("; "))}</div>` : ""}
      ${dr && dr.length ? dr.slice(0, 5).map(d => `<div class="oi-draft">${esc(d.name || "Customer")}: ${esc(d.text)} ${d.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${esc(waLink(d))}">Open WhatsApp</a>` : ""}</div>`).join("") : ""}
      <div class="oi-acts">${go}${it.manual ? `<button class="btn btn-ghost btn-sm" data-oi-done="${esc(it.id)}">✓ Done</button>` : ""}</div></div>`;
  }
  function render() {
    if (screen.hidden || !D) return;
    const list = items(), auto = list.filter(i => i.act === "auto"), you = list.filter(i => i.act === "you");
    const off = window.FAV_AIPLAN && window.FAV_AIPLAN.decide ? window.FAV_AIPLAN.decide("aifix") : { v: "go" };
    const shown = filter === "you" ? you : filter === "auto" ? auto : list;
    $("#oi-body").innerHTML = `
      <section class="fa-card"><div class="oi-top"><button class="btn btn-sell oi-fix" data-oi-fix ${busy ? "disabled" : ""}>${busy ? "Fixing…" : `✨ AI Fix (${auto.length})`}</button>
        <span class="fa-small"><b>${list.length}</b> open · <b>${auto.length}</b> AI Fix can do · <b>${you.length}</b> need you</span></div>
        ${off.v === "skip" ? `<p class="fa-small" style="color:var(--err)">AI Fix is off: ${esc(off.why)}. Approve rule <b>M9</b> in <a href="#aiplan" data-aiplan>🧭 AI Plan</a>.</p>` : ""}
        <p class="muted fa-small">It never deletes anything, enters passwords, API keys or 2FA, pays or subscribes, messages customers (it drafts and opens WhatsApp) or changes account security. Every action is logged.</p>
        <div class="bx-filters">${[["all", "All"], ["auto", "AI Fix"], ["you", "Needs you"]].map(([k, t]) => `<button class="bx-chip" data-oi-filter="${k}" aria-pressed="${filter === k}">${t}</button>`).join(" ")}</div></section>
      ${shown.map(row).join("") || `<p class="muted">Nothing open here ✓</p>`}
      ${D.log.length ? `<details class="fa-card"><summary>What AI Fix did (last ${Math.min(20, D.log.length)})</summary><ul class="fa-list">${D.log.slice(-20).reverse().map(x => `<li><span>${esc(x.src)}: ${esc(x.action)}</span><small>${esc(x.result)} · ${esc(String(x.t).slice(0, 16).replace("T", " "))}</small></li>`).join("")}</ul></details>` : ""}`;
  }
  document.addEventListener("click", async e => {
    if (e.target.closest("[data-openitems]")) { e.preventDefault(); show(); return; }
    if (screen.hidden) return;
    if (e.target.closest("[data-oi-fix]")) return fixAll();
    const fl = e.target.closest("[data-oi-filter]"); if (fl) { filter = fl.dataset.oiFilter; return render(); }
    const dn = e.target.closest("[data-oi-done]");
    if (dn) { const id = dn.dataset.oiDone; D = norm(await A().saveJson(FILE, d => { d = norm(d); d.done[id] = today(); d.log.push({ t: new Date().toISOString(), id, src: "you", action: "marked done", result: "ok" }); return d; }, `Open items: ${id} done`, EMPTY)); return render(); }
    const go = e.target.closest("[data-oi-go]");
    if (go) {
      e.preventDefault();
      const h = go.dataset.oiGo, sel = { "#leads": "[data-leads]", "#seek": "[data-seek]", "#boxads": "[data-boxads]", "#brands": "[data-brands]", "#fbauto": "[data-fbauto]", "#aiplan": "[data-aiplan]" }[h];
      const b = sel && document.querySelector(sel);
      if (b) b.click(); else location.hash = h;
      if (go.dataset.oiTab && F() && F()._test) setTimeout(() => F()._test.setTab(go.dataset.oiTab), 400);
    }
  });
  // Price choices on the Marketplace tab are remembered (AI Fix learns how Alexander settles price differences).
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-mk-price]");
    if (!b || !A().saveJson) return;
    setTimeout(() => { if (!window.FAV_MKAUTO) return; A().saveJson(FILE, d => { d = norm(d); d.history.price.push({ d: today(), use: "marketplace", row: b.dataset.mkPrice }); d.history.price = d.history.price.slice(-200); return d; }, "Open items: price choice remembered", EMPTY).catch(() => null); }, 3000);
  }, true);

  window.FAV_OPENITEMS = { open: show, load, items, fixAll, learn, MANUAL, _test: { loadSeo, state: () => D, set: d => { D = norm(d); }, last: () => lastRun } };
})();
