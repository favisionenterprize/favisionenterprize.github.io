// SEO & AI screen (dashboard button "📈 SEO & AI", deep link #seo).
// Shows data/seo-report.json from the nightly SEO watch (scripts/seo_watch.py, workflow
// seo-watch.yml): score, top issues, keyword coverage, competitor gaps and AI-visibility.
// "▶ Run check now" starts the workflow through the admin's GitHub access (Apps Script proxy)
// and polls the report until it updates; if that isn't allowed it runs a quick own-site
// check right here in the browser. "Apply fix" shows a preview and, after a confirm, saves the
// fix in data/seo-fixes.json; seo-fixes.yml (scripts/seo_build.py) then writes it into the
// pages. Nothing is ever applied automatically.
(function () {
  "use strict";
  const REPORT = "data/seo-report.json", FIXES = "data/seo-fixes.json", RUN_KEY = "fa-seo-run";
  const WF = "seo-watch.yml";
  const WF_URL = "https://github.com/favisionenterprize/favisionenterprize.github.io/actions/workflows/" + WF;
  const COST = { high: 8, medium: 4, low: 1.5 };
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = m => { if (A().toast) A().toast(m); };
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } } };
  const hhmm = iso => { if (!iso) return "never"; const d = new Date(iso); return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };

  let report = null, fixes = { applied: [] }, quick = null, pollTimer = null, open_ = {}, status = "";

  // ---------------------------------------------------------------- screen
  let screen = $("#screen-seo");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-seo"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>SEO &amp; AI</h1>
      <p class="muted">Checked every night at 2 am: your pages, your keywords, your competitors and what AI search says about you. Nothing changes on your site until you press Apply.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button></div></div>
      <div id="seo-body"><p class="muted">Loading…</p></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `#seo-body{display:grid;gap:14px}.seo-top{display:flex;flex-wrap:wrap;gap:18px;align-items:center}
.seo-ring{--p:0;width:112px;height:112px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--c,#1f9d55) calc(var(--p)*1%),#e8eaed 0)}
.seo-ring b{display:grid;place-items:center;width:88px;height:88px;border-radius:50%;background:#fff;font-size:30px}
.seo-ring small{display:block;font-size:12px;color:#5f6368;font-weight:400;margin-top:-6px}.seo-meta{flex:1;min-width:220px}
.seo-meta p{margin:4px 0}.seo-chips{display:flex;gap:6px;flex-wrap:wrap}.seo-chip{font-size:12px;padding:2px 8px;border-radius:99px;background:#eef2f8;white-space:nowrap}
.seo-chip.high{background:#fde7e7;color:#b3261e}.seo-chip.medium{background:#fff2dc;color:#8a5300}.seo-chip.low{background:#eef2f8;color:#3c4a5c}.seo-chip.ok{background:#e3f4ea;color:#1f7a45}
.seo-issue{border-top:1px solid #eceff3;padding:10px 0;display:grid;gap:6px}.seo-issue:first-of-type{border-top:0}.seo-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.seo-row>div{flex:1;min-width:200px}.seo-prev{background:#f6f8fc;border:1px solid #dadce0;border-radius:10px;padding:10px;display:grid;gap:8px}
.seo-prev textarea{width:100%;min-height:64px;font:inherit;padding:8px;border:1px solid #dadce0;border-radius:8px;box-sizing:border-box}
.seo-prev pre{max-height:240px;overflow:auto;background:#fff;border:1px solid #eceff3;border-radius:8px;padding:8px;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0}
.seo-old{color:#5f6368;text-decoration:line-through}.seo-table{width:100%;border-collapse:collapse;font-size:14px}.seo-table th,.seo-table td{text-align:left;padding:7px 6px;border-top:1px solid #eceff3;vertical-align:top}
.seo-wrap{overflow-x:auto}.seo-gap{display:grid;gap:6px;margin:0;padding-left:18px}.seo-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.seo-banner{padding:10px 12px;border-radius:10px;background:#e8f0fe;color:#0d3c7a}.seo-banner.warn{background:#fff2dc;color:#6b4100}.seo-ans{font-size:13px;color:#3c4043;white-space:pre-wrap}
.seo-spark{display:flex;align-items:flex-end;gap:2px;height:28px}.seo-spark i{display:block;width:6px;background:#0d55af;border-radius:2px 2px 0 0;opacity:.75}`;
    document.head.appendChild(st);
  }
  if (!document.querySelector("[data-seo]")) {   // dashboard button (admin/index.html normally has it)
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-seo>📈 SEO &amp; AI</button>`);
  }

  function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#seo") history.replaceState(null, "", "#seo");
    load();
  }

  // ---------------------------------------------------------------- data
  async function readRepo(path, fallback) {
    if (A().readJsonFile && (!A().signedIn || A().signedIn())) {
      try { return await A().readJsonFile(path, fallback); } catch (e) { /* fall back to the published copy */ }
    }
    try { const r = await fetch("../" + path + "?t=" + Date.now(), { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) { /* offline */ }
    return fallback;
  }

  async function load() {
    [report, fixes] = await Promise.all([readRepo(REPORT, null), readRepo(FIXES, { applied: [] })]);
    fixes = fixes || { applied: [] };
    render();
    const run = store.get(RUN_KEY);
    if (run && Date.now() - run.at < 25 * 60e3) poll(); else store.set(RUN_KEY, null);
  }

  const appliedIds = () => new Set((fixes.applied || []).filter(f => !f.removed).map(f => f.id));

  // ---------------------------------------------------------------- run now
  async function runNow() {
    const btn = $("#seo-run"); if (btn) btn.disabled = true;
    status = "Starting the check…"; paintStatus();
    try {
      if (!A().gh) throw Object.assign(new Error("no GitHub access in this admin"), { status: 0 });
      await A().gh(`/actions/workflows/${WF}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
      store.set(RUN_KEY, { at: Date.now(), was: report && report.generated });
      toast("SEO check started. Results in about 3–6 minutes.");
      poll();
    } catch (err) {
      store.set(RUN_KEY, null);
      const why = err.status === 403 || err.status === 404 || err.status === 401
        ? "Your GitHub token can't start workflows. Add <b>Actions: Read and write</b> to it on GitHub (Settings → Developer settings → Fine-grained tokens), or press <b>Run workflow</b> on GitHub."
        : "Couldn't start the nightly check from here (" + esc(err.message || "error") + ").";
      status = `${why} <a href="${WF_URL}" target="_blank" rel="noopener">Open on GitHub →</a> Running a quick check of your own pages in the browser instead…`;
      paintStatus(true);
      await quickCheck();
    } finally { if (btn) btn.disabled = false; }
  }

  function poll() {
    clearTimeout(pollTimer);
    const run = store.get(RUN_KEY);
    if (!run) return;
    const started = new Date(run.at);
    status = `⏳ Running… started ${started.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. This page refreshes by itself when the report is ready.`;
    paintStatus();
    pollTimer = setTimeout(async () => {
      if (screen.hidden) { pollTimer = setTimeout(poll, 30e3); return; }
      const r = await readRepo(REPORT, null);
      if (r && r.generated && r.generated !== run.was && new Date(r.generated).getTime() > run.at - 60e3) {
        report = r; quick = null; store.set(RUN_KEY, null); status = "";
        render(); toast(`SEO check done: ${r.score}/100`);
      } else if (Date.now() - run.at > 25 * 60e3) {
        store.set(RUN_KEY, null);
        status = `The check is taking longer than usual. <a href="${WF_URL}" target="_blank" rel="noopener">See it on GitHub →</a>`;
        paintStatus(true);
      } else poll();
    }, 30e3);
  }

  function paintStatus(warn) {
    const el = $("#seo-status"); if (!el) return;
    el.hidden = !status; el.className = "seo-banner" + (warn ? " warn" : ""); el.innerHTML = status;
  }

  // ---------------------------------------------------------------- quick check (in the browser)
  async function quickCheck() {
    const root = new URL("../", location.href);
    const get = async u => { const r = await fetch(new URL(u, root), { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return r.text(); };
    let locs = [];
    try { locs = [...(await get("sitemap.xml")).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(/^https:\/\/favisionenterprize\.github\.io\//, "")); } catch (e) { locs = [""]; }
    const pages = [...new Set([...locs.filter(l => !/^p\//.test(l)), "products/", "tiktok/", "studio/", "videos/"])];
    const issues = [], prevFix = {};
    ((report && report.issues) || []).forEach(i => { if (i.fix) prevFix[i.id] = i.fix; });
    const add = (sev, page, check, msg) => { const id = check + ":" + page; issues.push({ id, sev, page, check, msg, fix: prevFix[id] }); };
    for (const rel of pages) {
      let html;
      try { html = await get(rel); } catch (e) { continue; }
      const d = new DOMParser().parseFromString(html, "text/html");
      const file = (rel === "" || rel.endsWith("/")) ? rel + "index.html" : rel;
      const label = file === "index.html" ? "Home page" : "/" + file.replace("index.html", "");
      if (d.querySelector('meta[http-equiv="refresh"]')) continue;
      const t = (d.querySelector("title") || {}).textContent || "";
      if (!t) add("high", file, "title", `${label} has no <title>.`);
      else if (t.length < 30 || t.length > 65) add(t.length > 80 || t.length < 20 ? "medium" : "low", file, "title", `${label} title is ${t.length} characters (aim for 30–65).`);
      const desc = (d.querySelector('meta[name="description"]') || {}).content || "";
      if (!desc) add("high", file, "description", `${label} has no meta description.`);
      else if (desc.length < 70 || desc.length > 160) add(desc.length < 200 ? "low" : "medium", file, "description", `${label} meta description is ${desc.length} characters (aim for 70–160).`);
      const can = (d.querySelector('link[rel="canonical"]') || {}).href || "";
      if (!can) add("medium", file, "canonical", `${label} has no canonical link.`);
      if (!d.querySelector('meta[name="viewport"]')) add("high", file, "viewport", `${label} has no mobile viewport tag.`);
      const h1 = d.querySelectorAll("h1").length;
      if (!h1) add("medium", file, "h1", `${label} has no H1 heading.`);
      const noAlt = [...d.querySelectorAll("img")].filter(i => !(i.getAttribute("alt") || "").trim()).length;
      if (noAlt) add(noAlt > 2 ? "medium" : "low", file, "alt", `${label}: ${noAlt} image(s) without alt text.`);
      const types = new Set();
      d.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { JSON.stringify(JSON.parse(s.textContent), (k, v) => { if (k === "@type") [].concat(v).forEach(x => types.add(x)); return v; }); } catch (e) { types.add("INVALID_JSON"); } });
      if (types.has("INVALID_JSON")) add("high", file, "jsonld-invalid", `${label} has a JSON-LD block that isn't valid JSON.`);
      if (file === "index.html" && !["FurnitureStore", "LocalBusiness", "Store"].some(x => types.has(x))) add("high", file, "jsonld-business", "Home page has no LocalBusiness / FurnitureStore JSON-LD.");
      if (file === "index.html" && !types.has("FAQPage")) add("medium", file, "faq", "Home page has no FAQ.");
      if (file === "products/index.html" && !types.has("ItemList")) add("medium", file, "jsonld-itemlist", "Products page has no ItemList schema listing the products.");
    }
    // product pages + site files: one sample product page is enough to tell
    try {
      const sample = await get("p/FAV-014.html");
      if (/http-equiv="refresh"|location\.replace\(/.test(sample)) add("high", "p/", "product-pages", "Product pages (p/FAV-xxx.html) redirect straight to the home page, so Google can't index them.");
      if (!/"@type":\s*"Product"/.test(sample)) add("medium", "p/", "jsonld-product", "Product pages have no Product schema.");
    } catch (e) { /* no sample */ }
    try { await get("llms.txt"); } catch (e) { add("low", "llms.txt", "llms", "No /llms.txt fact sheet for AI search tools."); }
    if (locs.length < 10) add("medium", "sitemap.xml", "sitemap", `sitemap.xml lists only ${locs.length} URLs.`);
    const cost = {};
    issues.forEach(i => { cost[i.check] = Math.min((cost[i.check] || 0) + COST[i.sev], 3 * COST[i.sev]); });
    const ord = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => ord[a.sev] - ord[b.sev]);
    quick = { at: new Date().toISOString(), score: Math.max(0, Math.round(100 - Object.values(cost).reduce((a, b) => a + b, 0))), issues };
    status = `⚡ Quick check of your own pages done at ${hhmm(quick.at)} (in this browser). Competitors and AI answers below are from the last nightly check.`;
    render();
  }

  // ---------------------------------------------------------------- apply a fix
  function preview(fix) {
    const v = fix.value;
    if (["title", "description", "intro"].includes(fix.kind)) {
      const lim = { title: "30–65", description: "70–160", intro: "1–2 sentences" }[fix.kind];
      return `<label class="small muted">New ${fix.kind === "intro" ? "intro line (shown under the page heading)" : fix.kind} · ${lim}</label>
        <textarea data-seo-edit maxlength="400">${esc(v)}</textarea><span class="small muted" data-seo-count>${String(v).length} characters</span>`;
    }
    if (fix.kind === "alt") return `<p class="small muted">Alt text for each image (helps Google Images and blind visitors):</p><pre>${esc(Object.entries(v).map(([s, a]) => `${s}\n  → ${a}`).join("\n"))}</pre>`;
    if (fix.kind === "faq") return `<p class="small muted">Visible Q&amp;A block at the bottom of the page + FAQ schema:</p><pre>${esc(v.map(x => `Q: ${x.q}\nA: ${x.a}`).join("\n\n"))}</pre>`;
    if (fix.kind === "jsonld") return `<p class="small muted">Structured data added to the page (invisible to visitors, read by Google and AI):</p><pre>${esc(JSON.stringify(v, null, 1))}</pre>`;
    return `<p>${esc(v)}</p>`;
  }

  async function apply(fix, row) {
    const ta = row.querySelector("[data-seo-edit]");
    const value = ta ? ta.value.trim() : fix.value;
    if (!value) return toast("✗ The text is empty.");
    if (!confirm(`Apply this fix to ${fix.page}?\n\nIt is saved in data/seo-fixes.json and the website updates in about 2 minutes.`)) return;
    const entry = { id: fix.id, kind: fix.kind, page: fix.page, value, applied_at: new Date().toISOString().slice(0, 10) };
    try {
      if (A().busy) A().busy("Saving the fix…");
      fixes = await A().saveJson(FIXES, d => {
        d = d && typeof d === "object" ? d : {};
        d.applied = (d.applied || []).filter(x => x.id !== entry.id).concat(entry);
        return d;
      }, `SEO fix: ${fix.label || fix.kind} (${fix.page})`, { applied: [] });
      toast("Fix saved ✓ The website updates in about 2 minutes.");
      open_[fix.id] = false;
      render();
    } catch (err) {
      toast("✗ " + (A().friendly ? A().friendly(err) : err.message));
    } finally { if (A().busy) A().busy(null); }
  }

  // ---------------------------------------------------------------- render
  function fixButton(fix, done) {
    if (!fix) return "";
    if (done.has(fix.id)) return `<span class="seo-chip ok">Applied ✓</span>`;
    return `<button class="btn btn-sm ${open_[fix.id] ? "btn-ghost" : "btn-primary"}" data-seo-fix="${esc(fix.id)}">${open_[fix.id] ? "Close" : "Apply fix"}</button>`;
  }
  function fixPanel(fix) {
    if (!fix || !open_[fix.id]) return "";
    return `<div class="seo-prev" data-seo-panel="${esc(fix.id)}"><b>${esc(fix.label || "Fix")}</b> <span class="small muted">· ${esc(fix.page)}</span>
      ${preview(fix)}<div><button class="btn btn-sm btn-ok" data-seo-apply="${esc(fix.id)}">Confirm &amp; apply</button>
      <span class="small muted"> Built only from your own products and business details. Nothing changes until you confirm.</span></div></div>`;
  }

  const allFixes = {};
  function render() {
    const body = $("#seo-body"); if (!body) return;
    if (!report && !quick) {
      body.innerHTML = `<div class="card"><h2>No report yet</h2><p class="muted">The first nightly check hasn't run. Press Run check now.</p>
        <button class="btn btn-primary" id="seo-run">▶ Run check now</button><div id="seo-status" hidden></div></div>`;
      paintStatus(/Couldn|can't/.test(status));
      return;
    }
    const r = report || {};
    const done = appliedIds();
    const issues = (quick ? quick.issues : r.issues) || [];
    const score = quick ? quick.score : r.score;
    const color = score >= 80 ? "#1f9d55" : score >= 60 ? "#e08a00" : "#d32f2f";
    const delta = !quick && r.prev_score != null && r.prev_score !== r.score ? ` <span class="small ${r.score > r.prev_score ? "" : "muted"}">(${r.score > r.prev_score ? "+" : ""}${r.score - r.prev_score} since last check)</span>` : "";
    const hist = (r.history || []).slice(-30);
    const counts = { high: 0, medium: 0, low: 0 }; issues.forEach(i => counts[i.sev]++);
    Object.keys(allFixes).forEach(k => delete allFixes[k]);
    issues.forEach(i => { if (i.fix) allFixes[i.fix.id] = i.fix; });
    (r.keywords || []).forEach(k => { if (k.fix) allFixes[k.fix.id] = k.fix; });
    const ai = r.ai || {}, comp = r.competitors || {};
    const fixable = issues.filter(i => i.fix && !done.has(i.fix.id)).length;

    body.innerHTML = `
    <div class="card"><div class="seo-top">
      <div class="seo-ring" style="--p:${score};--c:${color}"><b>${score}<small>/100</small></b></div>
      <div class="seo-meta"><p><b>SEO score</b>${delta}</p>
        <div class="seo-chips"><span class="seo-chip high">${counts.high} urgent</span><span class="seo-chip medium">${counts.medium} important</span><span class="seo-chip low">${counts.low} small</span>${fixable ? `<span class="seo-chip ok">${fixable} one-tap fixes</span>` : ""}</div>
        <p class="small muted">Last nightly check: <b>${hhmm(r.generated)}</b>${r.mode === "local" ? " (own pages only)" : ""}${quick ? ` · quick check ${hhmm(quick.at)}` : ""} · AI mentions: <b>${ai.status === "ok" ? ai.share + "%" : "—"}</b></p>
        ${hist.length > 1 ? `<div class="seo-spark" title="Score, last ${hist.length} checks">${hist.map(h => `<i style="height:${Math.max(3, h.score * 0.28)}px" title="${esc(h.d)}: ${h.score}"></i>`).join("")}</div>` : ""}
      </div>
      <div><button class="btn btn-primary" id="seo-run">▶ Run check now</button><br><button class="btn btn-ghost btn-sm" id="seo-quick" style="margin-top:6px">⚡ Quick check in browser</button></div>
    </div><div id="seo-status" hidden style="margin-top:10px"></div></div>

    <div class="card"><h2>Top issues</h2>
      ${issues.length ? issues.map(i => `<div class="seo-issue"><div class="seo-row"><div><span class="seo-chip ${i.sev}">${{ high: "Urgent", medium: "Important", low: "Small" }[i.sev]}</span> ${esc(i.msg)}</div>${fixButton(i.fix, done)}</div>${fixPanel(i.fix)}</div>`).join("") : `<p class="muted">No issues found. 🎉</p>`}
    </div>

    <div class="card"><h2>Keywords</h2><p class="small muted">Which page targets each search. A page “owns” a keyword when it is in the title and heading.</p>
      <div class="seo-wrap"><table class="seo-table"><tr><th>Search</th><th>Status</th><th>Best page</th><th></th></tr>
      ${(r.keywords || []).map(k => `<tr><td><b>${esc(k.keyword)}</b></td><td>${k.covered ? `<span class="seo-chip ok">Targeted</span>` : k.score ? `<span class="seo-chip medium">Weak</span>` : `<span class="seo-chip high">Missing</span>`}</td>
        <td class="small">${k.best_page ? esc(k.best_page) + (k.where && k.where.length ? ` <span class="muted">(${esc(k.where.join(", "))})</span>` : "") : "—"}</td><td>${fixButton(k.fix, done)}</td></tr>
        ${k.fix && open_[k.fix.id] ? `<tr><td colspan="4">${fixPanel(k.fix)}</td></tr>` : ""}`).join("")}</table></div></div>

    <div class="seo-cols">
    <div class="card"><h2>Competitors: what they do that we don't</h2>
      ${comp.status === "pending" || !comp.list ? `<p class="muted">Waiting for the first nightly competitor check.</p>` :
        (comp.gaps && comp.gaps.they_do || []).length ? `<ul class="seo-gap">${comp.gaps.they_do.map(g => `<li><b>${esc(g.what)}</b> <span class="small muted">(${esc(g.who.join(", "))})</span><br><span class="small">→ ${esc(g.fix)}</span></li>`).join("")}</ul>` : `<p class="muted">Nothing they do better right now.</p>`}
    </div>
    <div class="card"><h2>Where we can beat them</h2>
      ${(comp.gaps && comp.gaps.we_beat || []).length ? `<ul class="seo-gap">${comp.gaps.we_beat.map(g => `<li><b>${esc(g.who)}</b>: ${esc(g.weak.join("; "))}</li>`).join("")}</ul>` : `<p class="muted">Waiting for the competitor check.</p>`}
    </div></div>

    <div class="card"><h2>Competitors checked</h2><div class="seo-wrap"><table class="seo-table"><tr><th>Business</th><th>Pages read</th><th>Schema</th><th>Meta desc.</th><th>Home size</th><th>Our keywords</th></tr>
      ${(comp.list || []).map(c => { const h = (c.pages || [])[0]; return `<tr><td><b>${esc(c.name)}</b><br><span class="small muted">${esc((c.url || "").replace(/^https?:\/\//, ""))}</span></td>
        ${h ? `<td>${c.pages.length}</td><td class="small">${esc(h.schema.filter(t => !/ListItem|EntryPoint|PropertyValue|ImageObject|ReadAction/.test(t)).join(", ") || "none")}</td><td>${h.description ? "✓" : "✗"}</td><td class="small">${h.kb} KB · ${h.requests} files</td><td class="small">${esc(h.keywords.join(", ") || "none")}</td>`
          : `<td colspan="5" class="small muted">${esc(c.status)}</td>`}</tr>`; }).join("")}</table></div>
      <p class="small muted">Only public pages are read, slowly, following each site's robots.txt. Nothing of theirs is copied.</p></div>

    <div class="card"><h2>AI search: who gets recommended?</h2>
      ${ai.status === "no_key" || !ai.status ? `<div class="seo-banner warn"><b>Add an AI key to switch this on.</b> On GitHub open your repository → <b>Settings → Secrets and variables → Actions → New repository secret</b>. Name: <code>GEMINI_API_KEY</code> (free from aistudio.google.com) or <code>ANTHROPIC_API_KEY</code>; paste the key; Save. The next nightly check (or Run check now) asks AI search your questions and shows here whether F.A Vision is named.</div>`
        : ai.status === "pending" ? `<p class="muted">Runs with the next nightly check.</p>`
        : `<p class="small muted">Asked ${esc(ai.provider || "AI")} with live web search. F.A Vision named in <b>${ai.share}%</b> of answers.</p>
          ${(ai.results || []).map(x => `<details class="seo-issue"><summary>${x.error ? "⚠️" : x.us ? "✅" : "❌"} ${esc(x.q)} ${x.competitors && x.competitors.length ? `<span class="small muted">· names ${esc(x.competitors.join(", "))}</span>` : ""}</summary>
            ${x.error ? `<p class="error small">${esc(x.error)}</p>` : `<p class="seo-ans">${esc(x.answer)}</p>`}</details>`).join("")}`}
    </div>`;
    paintStatus(/can't|Couldn|longer/.test(status));
  }

  // ---------------------------------------------------------------- events
  document.addEventListener("click", e => {
    if (e.target.closest("[data-seo]")) { e.preventDefault(); show(); return; }
    if (screen.hidden) return;
    if (e.target.closest("#seo-run")) return void runNow();
    if (e.target.closest("#seo-quick")) { status = "⚡ Checking your pages…"; paintStatus(); return void quickCheck(); }
    const f = e.target.closest("[data-seo-fix]");
    if (f) { const id = f.dataset.seoFix; open_[id] = !open_[id]; render(); const p = document.querySelector(`[data-seo-panel="${CSS.escape(id)}"]`); if (p) p.scrollIntoView({ block: "nearest" }); return; }
    const a = e.target.closest("[data-seo-apply]");
    if (a) { const fix = allFixes[a.dataset.seoApply]; if (fix) apply(fix, a.closest(".seo-prev")); }
  });
  document.addEventListener("input", e => {
    const t = e.target.closest && e.target.closest("[data-seo-edit]");
    if (t) { const c = t.parentNode.querySelector("[data-seo-count]"); if (c) c.textContent = t.value.length + " characters"; }
  });
  if (location.hash === "#seo") setTimeout(() => { if (A().signedIn && A().signedIn()) show(); }, 1500);
  window.FAV_SEO = { show, load, quickCheck, runNow };
})();
