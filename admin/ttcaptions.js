// TikTok captions (Social autopilot → its own tab "TikTok captions", key "ttcap").
//   Find posts without a description – the add-on (extension/ttcaptions.js, job "ttscan") reads every
//     post in TikTok Studio → Posts. Posts whose description has under 15 characters of real text (or
//     only hashtags) are listed here.
//   Each one is matched to a product (from its old text or the thumbnail's alt text; change it in the
//     drop-down) and gets a fresh "classy" caption (captions.js style "classy") to edit.
//   Fix this one / Fix all – job "ttfix": opens each post's Edit in TikTok Studio, types the caption into
//     the description and presses Save, one post at a time, 20–40 s apart; stops on any warning. It never
//     deletes or re-posts, and skips a post that has a description by then.
// Log: data/tiktok-captions.json { settings, scan: { d, posts: [{ id, url, desc, thumb, alt }] }, fixed: { id: {...} }, runs }.
// The product picked per post is kept in this browser (localStorage "fa-ttcaps-picks").
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/tiktok-captions.json";
  const PICKS = "fa-ttcaps-picks";
  const EMPTY = { settings: { min: 20, max: 40, min_chars: 15 }, scan: null, fixed: {}, runs: [] };
  const F = () => window.FAV_FBAUTO;
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const shortName = p => String(p.name).split(" — ")[0];
  let S = null;
  const drafts = {};   // post id → caption being edited (this visit only)

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    s.settings = { ...EMPTY.settings, ...(s.settings || {}) };
    s.fixed = s.fixed || {}; s.runs = s.runs || [];
    return s;
  }
  async function load(force) { if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY)); return S; }
  async function save(mutate, message) { S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY)); }
  const picks = () => { try { return JSON.parse(localStorage.getItem(PICKS) || "{}") || {}; } catch (e) { return {}; } };
  const setPick = (id, pid) => { const p = picks(); if (pid) p[id] = pid; else delete p[id]; try { localStorage.setItem(PICKS, JSON.stringify(p)); } catch (e) { /* storage blocked */ } };

  const okUrl = u => /^https:\/\/www\.tiktok\.com\//.test(String(u || "")) ? String(u) : "";
  const okImg = u => /^https:\/\/[\w.-]+\/\S*$/.test(String(u || "")) ? String(u) : "";
  const meaningful = t => String(t || "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim();
  const needsCaption = post => meaningful(post.desc).length < S.settings.min_chars && !(S.fixed[post.id] && S.fixed[post.id].ok);
  function waiting() { return S && S.scan ? S.scan.posts.filter(needsCaption) : []; }

  // Product for a post: the one picked here, else the best word match on its old text / thumbnail alt text.
  const words = t => new Set(String(t || "").toLowerCase().replace(/dinn?ing/g, "dining").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 2 && !/^(the|and|for|with|our|new|now|this|that|you|your|from|fyp|foryou|ghana|accra)$/.test(w)).map(w => w.replace(/s$/, "")));
  function guess(post) {
    const have = words(post.desc + " " + post.alt);
    if (!have.size) return null;
    let best = null;
    for (const p of A.products()) {
      if (p.placeholder) continue;
      const w = words(shortName(p) + " " + (p.category || ""));
      let hit = 0; w.forEach(x => { if (have.has(x)) hit++; });
      if (hit && (!best || hit > best.hit)) best = { p, hit };
    }
    return best ? best.p : null;
  }
  function productOf(post) {
    const id = picks()[post.id];
    return (id && A.products().find(p => p.id === id)) || guess(post);
  }
  function captionFor(p) {
    const W = window.FAV_CAPTIONS;
    return W ? W.write(p, { net: "tiktok", style: "classy" }) : `${shortName(p)}. ${C.formatPrice(p.price_ghs)}. Comment 'MINE' 👇\nfavisionenterprize.github.io/tiktok/`;
  }
  function draft(post) {
    if (drafts[post.id] == null) { const p = productOf(post); drafts[post.id] = p ? captionFor(p) : ""; }
    return drafts[post.id];
  }

  // ------------------------------------------------------------------ jobs
  function ready(then) {
    const f = F();
    if (!f || f.needExt()) return false;
    if (!f.liveAddon()) { A.toast("TikTok captions need the add-on's automatic updates switched on (Today tab, top).", true); if (then && then.length) setTimeout(() => f.runStep(then, true), 1500); return false; }
    return true;
  }
  function startScan(then) {
    if (!ready(then)) return;
    F().launch("https://www.tiktok.com/tiktokstudio/content", { kind: "ttscan", then: then && then.length ? then : null });
  }
  function startFix(ids) {
    const posts = waiting().filter(p => ids.includes(p.id));
    const q = posts.map(p => ({ id: p.id, url: p.url, text: String(drafts[p.id] != null ? drafts[p.id] : draft(p)).trim().slice(0, 2200) })).filter(x => x.text);
    if (!q.length) return A.toast("Pick a product (or type a caption) for the post first.", true);
    if (q.length < posts.length) A.toast(`${posts.length - q.length} post${posts.length - q.length === 1 ? " has" : "s have"} no caption yet and will be skipped.`);
    if (!ready()) return;
    F().launch("https://www.tiktok.com/tiktokstudio/content", { kind: "ttfix", q, min: S.settings.min, max: S.settings.max, maxHops: 10 + q.length * 4 });
  }

  async function receive(out) {
    const d = today(), res = out.res || [];
    if (out.kind === "ttscan") {
      if (!res.length) return { text: "TikTok captions: " + (out.stopped || "no posts read."), bad: true };
      const posts = res.slice(0, 1000).map(r => ({ id: String(r.id), url: /^https:\/\/www\.tiktok\.com\//.test(r.url) ? r.url : "", desc: String(r.desc || "").slice(0, 300), thumb: /^https:\/\//.test(r.thumb || "") ? String(r.thumb).slice(0, 600) : "", alt: String(r.alt || "").slice(0, 200) }));
      await save(s => {
        s.scan = { d, t: new Date().toISOString(), n: posts.length, posts };
        s.runs = s.runs.concat([{ d, kind: "scan", n: posts.length, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
        return s;
      }, `TikTok captions: read ${posts.length} posts`);
      return { text: `Read ${plural(posts.length, "TikTok post")}: ${plural(waiting().length, "post")} without a description.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped };
    }
    if (out.kind === "ttfix") {
      const ok = res.filter(r => r.ok);
      await save(s => {
        for (const r of res) s.fixed[r.id] = { d, ok: !!r.ok, ...(r.why ? { why: r.why } : {}) };
        s.runs = s.runs.concat([{ d, kind: "fix", tried: res.length, ok: ok.length, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
        return s;
      }, `TikTok captions: added ${ok.length} of ${res.length}`);
      ok.forEach(r => { delete drafts[r.id]; setPick(r.id, null); });
      const bad = res.filter(r => !r.ok);
      return { text: `TikTok: ${plural(ok.length, "caption")} added${bad.length ? `, ${bad.length} not (${bad.map(r => r.why).filter(Boolean).slice(0, 2).join("; ")})` : " ✓"}.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped || !!bad.length };
    }
    return { text: "", bad: false };
  }

  // ------------------------------------------------------------------ card
  function renderCard() {
    if (!S) return "";
    const list = waiting(), prods = A.products().filter(p => !p.placeholder), sc = S.scan;
    return `<section class="fa-card" id="ttc-card">
      <header><h2>TikTok captions</h2><span class="fa-big ${list.length ? "hot" : ""}">${sc ? list.length : "?"}</span></header>
      <p class="muted">Finds your TikTok posts with no description (or only hashtags) and gives each a short, classy caption that makes people stop and comment to buy: a hook, real details, the price, delivery, a “Comment ‘MINE’” ask and your /tiktok/ page. Edit it, then fix one or all. Posts are never deleted or re-posted.</p>
      ${sc ? `<p class="muted fa-small">Last read ${esc(sc.d)}: ${plural(sc.n, "post")}, ${list.length} without a description.</p>` : ""}
      <div class="fa-actions"><button class="btn btn-primary" data-ttc="scan">🔎 Find posts without a description</button><button class="btn btn-sell" data-ttc="all" ${list.length ? "" : "disabled"}>✨ Fix all${list.length ? " " + list.length : ""}</button></div>
      ${list.length ? "" : `<p class="muted fa-small" id="ttc-hint">Press Find first: it lists your TikTok posts with no description, then Fix all adds captions to every one.</p>`}
      ${list.map(post => { const p = productOf(post), f = S.fixed[post.id]; return `<div class="ttc-post">
        <div class="ttc-head">${okImg(post.thumb) ? `<img src="${esc(okImg(post.thumb))}" alt="" width="54" height="72" loading="lazy" referrerpolicy="no-referrer">` : ""}
          <div><b>${okUrl(post.url) ? `<a href="${esc(okUrl(post.url))}" target="_blank" rel="noopener">Post ${esc(post.id)}</a>` : "Post " + esc(post.id)}</b>
          <small class="muted">${post.desc ? "Now: " + esc(post.desc) : "No description"}${post.alt ? " · shows: " + esc(post.alt) : ""}</small>
          ${f && !f.ok ? `<small class="down">Last try: ${esc(f.why || "failed")}</small>` : ""}
          <label>Product <select data-ttc-pick="${esc(post.id)}"><option value="">Pick the product…</option>${prods.map(x => `<option value="${esc(x.id)}" ${p && p.id === x.id ? "selected" : ""}>${esc(x.id)} · ${esc(shortName(x))}</option>`).join("")}</select></label></div></div>
        <textarea rows="7" maxlength="2200" data-ttc-text="${esc(post.id)}" aria-label="Caption for post ${esc(post.id)}">${esc(draft(post))}</textarea>
        <div class="fa-actions"><button type="button" class="btn btn-sell btn-sm" data-ttc-fix="${esc(post.id)}">Fix this one</button><button type="button" class="btn btn-ghost btn-sm" data-ttc-new="${esc(post.id)}">↻ New caption</button></div>
      </div>`; }).join("")}
      <p class="muted fa-small">Runs in this Edge tab, one post at a time, ${S.settings.min}–${S.settings.max} s apart, and stops on any TikTok warning. People who comment “MINE”, “PRICE” and so on get the WhatsApp reply from Engagement → Reply to all commenters. Not yet checked on the live TikTok Studio.</p>
    </section>`;
  }
  const rerender = () => { if (F()) F().render(); };
  document.addEventListener("click", e => {
    if (!S || !e.target.closest) return;
    const b = e.target.closest("[data-ttc],[data-ttc-fix],[data-ttc-new]");
    if (!b || !b.closest("#ttc-card")) return;
    e.preventDefault();
    if (b.dataset.ttc === "scan") return startScan();
    if (b.dataset.ttc === "all") return b.disabled ? null : startFix(waiting().map(p => p.id));
    if (b.dataset.ttcFix) return startFix([b.dataset.ttcFix]);
    if (b.dataset.ttcNew) {
      const post = waiting().find(x => x.id === b.dataset.ttcNew), p = post && productOf(post);
      if (!p) return A.toast("Pick the product first.", true);
      drafts[post.id] = captionFor(p); rerender();
    }
  });
  document.addEventListener("input", e => { const t = e.target.closest && e.target.closest("[data-ttc-text]"); if (t) drafts[t.dataset.ttcText] = t.value; });
  document.addEventListener("change", e => {
    const s = e.target.closest && e.target.closest("[data-ttc-pick]");
    if (!s) return;
    const id = s.dataset.ttcPick, p = A.products().find(x => x.id === s.value);
    setPick(id, s.value || null);
    drafts[id] = p ? captionFor(p) : "";
    rerender();
  });

  window.FAV_TTCAPS = { load, state: () => S, renderCard, receive, startScan, startFix, waiting, _test: { guess, meaningful, set: s => { S = normalise(s); } } };
})();
