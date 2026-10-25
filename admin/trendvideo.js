// 🎬 Trend video card (Social autopilot → Boost tab, top card; data/trend-videos.json).
// The "miniature me cleans my profile" AI-video trend: one ready prompt per brand (templates[]: brand, product,
// title, prompt, caption_hint), Copy prompt, a link to the AI video tool Alexander picks (tools[]; choice kept
// in localStorage "fa-trendvid-tool"), then "Add video" puts the finished file into the existing videos library
// (FAV_VIDAUTO.addFiles, source "upload", kind "trend") where it waits like every other video: nothing is posted.
// made[] logs {id, d, video} per added trend video so the card can warn: max ~1 a week (max_per_week), because
// heavy AI-only content risks demonetisation and reach limits.
(function () {
  "use strict";
  const A = () => window.FAV_ADMIN || {};
  const FILE = "data/trend-videos.json";
  const EMPTY = { trend: { name: "Miniature me cleans my profile", max_per_week: 1 }, tools: [], templates: [], made: [] };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, bad) => { if (A().toast) A().toast(m, bad); };
  const F = () => window.FAV_FBAUTO, VID = () => window.FAV_VIDAUTO;
  const rerender = () => { if (F() && F().render) F().render(); };
  let T = null, open = null, pending = null;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage off */ } };
  function norm(t) {
    t = t && typeof t === "object" ? t : JSON.parse(JSON.stringify(EMPTY));
    t.trend = Object.assign({ max_per_week: 1 }, t.trend || {});
    for (const k of ["tools", "templates", "made"]) t[k] = Array.isArray(t[k]) ? t[k] : [];
    return t;
  }
  async function load(force) { if (!T || force) { try { T = norm(await A().readJsonFile(FILE, EMPTY)); } catch (e) { T = T || norm(null); } } return T; }
  const weekAgo = () => new Date(Date.now() - 7 * 864e5).toLocaleDateString("en-CA");
  const thisWeek = () => (T ? T.made : []).filter(m => m.d >= weekAgo());
  const brandName = id => { const b = window.FAV_BRANDS && window.FAV_BRANDS.list ? window.FAV_BRANDS.list().find(x => x.id === id) : null; return b ? b.name : id; };
  const tool = () => (T.tools.find(x => x.id === lsGet("fa-trendvid-tool", "")) || T.tools[0] || null);

  function renderCard() {
    if (!T) { load().then(rerender).catch(() => {}); return `<section class="fa-card" id="trendvid-card"><header><h2>🎬 Trend video</h2></header><p class="muted">Loading…</p></section>`; }
    const wk = thisWeek(), max = Number(T.trend.max_per_week) || 1, t = tool();
    return `<section class="fa-card" id="trendvid-card">
      <header><h2>🎬 Trend video: ${esc(T.trend.name || "")}</h2><span class="fa-big ${wk.length >= max ? "hot" : ""}">${wk.length}/${max}</span></header>
      <p class="muted">${esc(T.trend.note || "")} Pick a brand's prompt, copy it, make the video in your AI video tool with a photo of yourself, then add the video here. It waits in Videos &amp; YouTube like every other video: nothing is posted for you.</p>
      <p class="fa-small" style="color:var(--err)">⚠ Max about 1 trend video a week. Heavy AI-only content can get an account's reach limited or demonetised: keep most posts real photos and videos of real products.${wk.length >= max ? ` You've added ${wk.length} this week already.` : ""}</p>
      <form class="fa-settings"><label>AI video tool <select data-tv-tool>${T.tools.map(x => `<option value="${esc(x.id)}" ${t && x.id === t.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
        ${t ? `<a class="btn btn-ghost btn-sm" href="${esc(t.url)}" target="_blank" rel="noopener">Open ${esc(t.name)} ↗</a>` : ""}</label></form>
      <ul class="fa-list">${T.templates.map(x => { const last = T.made.filter(m => m.id === x.id).slice(-1)[0]; return `<li class="share-li" data-tv="${esc(x.id)}" style="display:grid;gap:6px">
        <span style="white-space:normal"><b>${esc(x.title)}</b> <small class="muted">· ${esc(x.profile || brandName(x.brand))}${x.product ? " · " + esc(x.product) : ""}${last ? " · last made " + esc(last.d) : ""}</small></span>
        ${open === x.id ? `<textarea readonly rows="6" style="width:100%;font:inherit;font-size:13px;padding:8px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box">${esc(x.prompt)}</textarea>
          ${x.caption_hint ? `<small class="muted" style="white-space:normal;max-width:none;text-align:left">Caption idea: ${esc(x.caption_hint)}</small>` : ""}` : ""}
        <span class="fa-actions" style="margin:0;overflow:visible"><button type="button" class="btn btn-primary btn-sm" data-tv-copy>Copy prompt</button>
          <button type="button" class="btn btn-ghost btn-sm" data-tv-show>${open === x.id ? "Hide" : "Show"} prompt</button>
          ${t ? `<a class="btn btn-ghost btn-sm" href="${esc(t.url)}" target="_blank" rel="noopener" data-tv-make>Make it in ${esc(t.name)} ↗</a>` : ""}
          <label class="btn btn-sell btn-sm">Add video <input type="file" accept="video/*" data-tv-file hidden></label></span></li>`; }).join("")}</ul>
      <p class="muted fa-small">Use a clear photo of yourself as the reference image. Check the result: the product must look like the real one (colours, shape) before you post it.</p>
    </section>`;
  }
  const tplOf = el => { const li = el.closest("[data-tv]"); return li && T ? T.templates.find(x => x.id === li.dataset.tv) : null; };
  document.addEventListener("click", async e => {
    if (!T) return;
    const x = e.target.closest("[data-tv]") && tplOf(e.target);
    if (!x) return;
    if (e.target.closest("[data-tv-copy]")) { try { await navigator.clipboard.writeText(x.prompt); toast("Prompt copied ✓ Paste it in your AI video tool."); } catch (err) { window.prompt("Copy this prompt:", x.prompt); } return; }
    if (e.target.closest("[data-tv-show]")) { open = open === x.id ? null : x.id; return rerender(); }
    if (e.target.closest("[data-tv-file]") && thisWeek().length >= (Number(T.trend.max_per_week) || 1)) {
      if (!window.confirm(`You've already added ${thisWeek().length} trend video(s) this week. Heavy AI-only content risks demonetisation. Add another anyway?`)) e.preventDefault();
    }
  });
  document.addEventListener("change", async e => {
    if (!T) return;
    if (e.target.matches && e.target.matches("[data-tv-tool]")) { lsSet("fa-trendvid-tool", e.target.value); return rerender(); }
    if (!(e.target.matches && e.target.matches("[data-tv-file]")) || !e.target.files.length) return;
    const x = tplOf(e.target), files = e.target.files;
    if (!x || pending) return;
    if (!VID() || !VID().addFiles) return toast("The videos library isn't loaded: open Videos & YouTube once, then try again.", true);
    pending = x.id;
    try {
      const before = (VID().state() || { videos: [] }).videos.length;
      await VID().addFiles(files, { source: "upload", product: x.product || "", kind: "trend", title: x.title, description: x.caption_hint || "", trend: x.id });
      const S = VID().state() || { videos: [] };
      if (S.videos.length > before) {
        const v = S.videos[S.videos.length - 1];
        T = norm(await A().saveJson(FILE, c => { c = norm(c); c.made.push({ id: x.id, d: new Date().toLocaleDateString("en-CA"), video: v.id }); c.made = c.made.slice(-60); return c; }, `Trend video: ${x.id} added`, EMPTY));
        toast("Trend video added ✓ It's waiting in Videos & YouTube.");
      }
    } catch (err) { toast(A().friendly ? A().friendly(err) : String(err), true); }
    finally { pending = null; rerender(); }
  });

  // Dash button "🎬 Trend video" + deep link #trendvideo: opens the Social autopilot on the Boost tab at this card.
  if (!document.querySelector("[data-trendvideo]")) {
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-trendvideo>🎬 Trend video</button>`);
  }
  async function show() {
    if (!F() || !F().open) return toast("The Social autopilot isn't loaded.", true);
    await load().catch(() => null);
    await F().open("boost");
    const c = document.getElementById("trendvid-card");
    if (c && c.scrollIntoView) c.scrollIntoView({ block: "start" });
  }
  document.addEventListener("click", e => { if (e.target.closest("[data-trendvideo]")) { e.preventDefault(); show(); } });

  window.FAV_TRENDVID = { open: show, load, renderCard, state: () => T, thisWeek, _set: t => { T = norm(t); } };
  (function warm(n) { if (A().readJsonFile) load().catch(() => {}); else if (n < 40) setTimeout(() => warm(n + 1), 500); })(0);
})();
