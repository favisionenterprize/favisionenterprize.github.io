// TikTok captions (Social autopilot → its own tab "TikTok captions", key "ttcap").
//   ONE button, "✨ Fix all TikTok descriptions": job "ttscan" (extension/ttcaptions.js) reads EVERY post in
//     TikTok Studio → Posts (scrolls the list's inner scroller / Load more, up to 500) → back here, runStep
//     "ttcaps:fixall" takes every post with under 15 characters of real text (or only hashtags), picks the
//     product it shows (confident word match on its old text / thumbnail alt text; otherwise a general
//     F.A Vision caption with no product and no price) and writes a classy caption (captions.js "classy")
//     → job "ttfix": opens each post's Edit, types the caption and presses Save only, one post at a time,
//     20–40 s apart; stops on any warning; never deletes or re-posts; skips a post that has a description by then.
//   "Review captions" (collapsed, optional): change a post's product / text, or fix just one.
// Log: data/tiktok-captions.json { settings, scan: { d, n, posts: [{ id, url, desc, thumb, alt }] }, fixed: { id: {...} }, runs }.
// Per browser (localStorage): product picks "fa-ttcaps-picks", the run in progress "fa-ttcaps-run".
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/tiktok-captions.json";
  const PICKS = "fa-ttcaps-picks";
  const EMPTY = { settings: { min: 20, max: 40, min_chars: 15, edit_days: 7 }, scan: null, prepared: {}, app_only: [], fixed: {}, runs: [] };
  const F = () => window.FAV_FBAUTO;
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const shortName = p => String(p.name).split(" — ")[0];
  let S = null;
  const drafts = {};   // post id → caption being edited (this visit only)

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    s.settings = { ...EMPTY.settings, ...(s.settings || {}) };
    s.fixed = s.fixed || {}; s.runs = s.runs || []; s.prepared = s.prepared || {}; s.app_only = s.app_only || [];
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
  // TikTok limits (seen live 15 Oct 2026): a caption can be edited once a day per post, and only within
  // 7 days of posting; "commercial content" posts can only be edited in the app. A TikTok post id starts
  // with its posting time (id >> 32 = Unix seconds).
  const postedAt = id => { try { const t = Number(BigInt(String(id)) >> 32n) * 1000; return t > 1.4e12 && t < Date.now() + 864e5 ? t : null; } catch (e) { return null; } };
  const tooOld = post => { const t = postedAt(post.id); return t != null && Date.now() - t > S.settings.edit_days * 864e5; };
  const appOnly = post => S.app_only.includes(post.id);
  const triedToday = post => { const f = S.fixed[post.id]; return !!f && f.d === today() && /won't allow|edited today/i.test(f.why || ""); };
  const byAge = (a, b) => { try { const x = BigInt(a.id), y = BigInt(b.id); return x < y ? -1 : x > y ? 1 : 0; } catch (e) { return 0; } };
  // What one press fixes now: oldest first, so posts about to pass 7 days are done first.
  function fixable() { return waiting().filter(p => !appOnly(p) && !tooOld(p) && !triedToday(p)).sort(byAge); }

  // Product for a post: the one picked in "Review captions", else the best word match on its old text /
  // thumbnail alt text. Only a CONFIDENT match counts (one product clearly ahead); otherwise the post gets
  // the generic caption, which names no product and no price.
  const STOP = /^(the|and|for|with|our|new|now|this|that|you|your|from|fyp|foryou|foryoupage|viral|ghana|accra|set|sets|quality|order|call|whatsapp|price|delivery|available|stock|furniture|vision|enterprise|favision|tiktok|best|shop|more|all|get)$/;
  const words = t => new Set(String(t || "").toLowerCase().replace(/dinn?ing/g, "dining").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.test(w)).map(w => w.replace(/s$/, "")));
  function guess(post) {
    const have = words(post.desc + " " + post.alt);
    if (!have.size) return null;
    const scored = [];
    for (const p of A.products()) {
      if (p.placeholder) continue;
      const w = words(shortName(p) + " " + (p.category || ""));
      let hit = 0; w.forEach(x => { if (have.has(x)) hit++; });
      if (hit) scored.push({ p, hit });
    }
    scored.sort((a, b) => b.hit - a.hit);
    if (!scored.length || (scored[1] && scored[1].hit === scored[0].hit)) return null;   // a tie is not confident
    return scored[0].p;
  }
  function productOf(post) {
    const id = picks()[post.id];
    if (id === "-") return null;                       // "No product (general caption)" picked
    const prep = S.prepared[post.id];                  // product seen in the post's photos (browser run 15 Oct)
    return (id && A.products().find(p => p.id === id)) || (prep && prep.p && A.products().find(p => p.id === prep.p)) || guess(post);
  }
  function captionFor(p) {
    const W = window.FAV_CAPTIONS;
    return W ? W.write(p, { net: "tiktok", style: "classy" }) : `${shortName(p)}. ${C.formatPrice(p.price_ghs)}. Comment 'MINE' 👇\nfavisionenterprize.github.io/tiktok/`;
  }
  // No confident product: a general F.A Vision caption. Never a product name or a price.
  function genericCaption() {
    const W = window.FAV_CAPTIONS;
    let tg = "";
    try { tg = W ? W.tags(null, "tiktok") : ""; } catch (e) { tg = ""; }
    return ["Furniture that makes a statement ✨", "Sofas, dining sets, office and school furniture, delivered across Accra, Tema & Kasoa.",
      "Shop the collection at favisionenterprize.github.io/tiktok/ · Comment 'MINE' 👇", "", tg || "#furniture #accra #ghana #homedecor"].join("\n").trim();
  }
  function draft(post) {
    if (drafts[post.id] == null) {
      const prep = S.prepared[post.id], picked = picks()[post.id];
      if (prep && prep.text && !picked) drafts[post.id] = prep.text;    // written from the post's own images (browser run 15 Oct)
      else { const p = productOf(post); drafts[post.id] = p ? captionFor(p) : genericCaption(); }
    }
    return drafts[post.id];
  }

  // ------------------------------------------------------------------ jobs
  // One button: scan every post (job "ttscan") → back in the admin, runStep "ttcaps:fixall" builds a
  // caption for every post that needs one → job "ttfix" fixes them one by one.
  const RUN = "fa-ttcaps-run";       // { stage: "scan" | "fix", t, n } while a run is going (this browser only)
  const getRun = () => { try { const r = JSON.parse(localStorage.getItem(RUN) || "null"); return r && Date.now() - r.t < 2 * 3600e3 ? r : null; } catch (e) { return null; } };
  const setRun = r => { try { if (r) localStorage.setItem(RUN, JSON.stringify({ ...r, t: Date.now() })); else localStorage.removeItem(RUN); } catch (e) { /* storage blocked */ } };
  let scanStopped = null;
  function ready(then) {
    const f = F();
    if (!f || f.needExt()) return false;
    if (!f.liveAddon()) { A.toast("TikTok captions need the add-on's automatic updates switched on (Today tab, top).", true); if (then && then.length) setTimeout(() => f.runStep(then, true), 1500); return false; }
    return true;
  }
  // The big button. `then`: steps to carry on with afterwards (from a one-button run).
  function startAll(then) {
    if (!ready(then)) return;
    setRun({ stage: "scan" });
    F().launch("https://www.tiktok.com/tiktokstudio/content", { kind: "ttscan", max: 500, then: ["ttcaps:fixall"].concat(then || []) });
  }
  function startScan(then) {
    if (!ready(then)) return;
    F().launch("https://www.tiktok.com/tiktokstudio/content", { kind: "ttscan", max: 500, then: then && then.length ? then : null });
  }
  function queueFor(posts) {
    return posts.map(p => ({ id: p.id, url: p.url, text: String(drafts[p.id] != null && drafts[p.id].trim() ? drafts[p.id] : draft(p)).trim().slice(0, 2200) })).filter(x => x.text);
  }
  function launchFix(q, then) {
    if (!ready(then)) return false;
    setRun({ stage: "fix", n: q.length });
    F().launch("https://www.tiktok.com/tiktokstudio/content", { kind: "ttfix", q, min: S.settings.min, max: S.settings.max, maxHops: 10 + q.length * 5, then: then && then.length ? then : null });
    return true;
  }
  function startFix(ids) {
    const posts = waiting().filter(p => ids.includes(p.id));
    const blocked = posts.find(p => appOnly(p) || tooOld(p));
    if (blocked && posts.length === 1) return A.toast(appOnly(blocked) ? "TikTok only lets you edit this post in the app (commercial content)." : `TikTok only allows caption edits within ${S.settings.edit_days} days of posting.`, true);
    const q = queueFor(posts.filter(p => !appOnly(p) && !tooOld(p)).sort(byAge));
    if (!q.length) return A.toast("Nothing to fix.", true);
    launchFix(q);
  }
  // Chained after the scan: fix every post that needs a description, no review needed.
  async function fixAll(then) {
    await load();
    if (scanStopped) {
      const why = scanStopped; scanStopped = null; setRun(null);
      A.toast(`TikTok captions: the read stopped (${why}), so nothing was changed.`, true);
      if (then && then.length) setTimeout(() => F().runStep(then, true), 1500);
      return;
    }
    const posts = fixable();
    if (!posts.length) {
      setRun(null);
      const w = waiting().length;
      A.toast(w ? `Nothing TikTok lets us edit right now: ${w} without a description are app-only, over ${S.settings.edit_days} days old or already edited today.` : `All ${plural(S.scan ? S.scan.n : 0, "TikTok post")} already have a description ✓`, !!w);
      if (F()) F().render();
      if (then && then.length) setTimeout(() => F().runStep(then, true), 1500);
      return;
    }
    if (!launchFix(queueFor(posts), then)) setRun(null);
  }

  async function receive(out) {
    const d = today(), res = out.res || [];
    if (out.kind === "ttscan") {
      scanStopped = out.stopped && out.stopped !== "Stopped by you." ? out.stopped : null;
      if (!res.length) { setRun(null); scanStopped = out.stopped || "no posts read"; return { text: "TikTok captions: " + (out.stopped || "no posts read."), bad: true }; }
      const posts = res.slice(0, 1000).map(r => ({ id: String(r.id), url: /^https:\/\/www\.tiktok\.com\//.test(r.url) ? r.url : "", desc: String(r.desc || "").slice(0, 300), thumb: /^https:\/\//.test(r.thumb || "") ? String(r.thumb).slice(0, 600) : "", alt: String(r.alt || "").slice(0, 200) }));
      await save(s => {
        s.scan = { d, t: new Date().toISOString(), n: posts.length, posts, ...(out.stopped ? { stopped: out.stopped } : {}) };
        s.runs = s.runs.concat([{ d, kind: "scan", n: posts.length, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
        return s;
      }, `TikTok captions: read ${posts.length} posts`);
      const need = fixable().length;
      if (getRun() && !scanStopped && need) setRun({ stage: "fix", n: need });
      return { text: `Read ${plural(posts.length, "TikTok post")}: ${plural(waiting().length, "post")} without a description, ${need} TikTok lets us edit now.${need && getRun() && !scanStopped ? " Fixing them now…" : ""}${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped };
    }
    if (out.kind === "ttfix") {
      setRun(null);
      const ok = res.filter(r => r.ok), had = res.filter(r => !r.ok && /already has/.test(r.why || ""));
      await save(s => {
        for (const r of res) s.fixed[r.id] = { d, ok: !!r.ok, ...(r.why ? { why: r.why } : {}) };
        s.runs = s.runs.concat([{ d, kind: "fix", queued: Number(out.n) || res.length, tried: res.length, ok: ok.length, had: had.length, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
        return s;
      }, `TikTok captions: added ${ok.length} of ${res.length}`);
      ok.forEach(r => { delete drafts[r.id]; setPick(r.id, null); });
      const bad = res.filter(r => !r.ok && !/already has/.test(r.why || ""));
      return { text: `TikTok: ${plural(ok.length, "description")} added${had.length ? `, ${had.length} already had one` : ""}${bad.length ? `, ${bad.length} not (${bad.map(r => r.why).filter(Boolean).slice(0, 2).join("; ")})` : " ✓"}.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped || !!bad.length };
    }
    return { text: "", bad: false };
  }

  // ------------------------------------------------------------------ card
  function lastFix() { return S.runs.slice().reverse().find(r => r.kind === "fix"); }
  function renderCard() {
    if (!S) return "";
    const list = waiting(), prods = A.products().filter(p => !p.placeholder), sc = S.scan, run = getRun(), lf = lastFix();
    const fx = fixable(), old = list.filter(p => !appOnly(p) && tooOld(p)), app = list.filter(appOnly), today_ = list.filter(p => !appOnly(p) && !tooOld(p) && triedToday(p));
    const general = fx.filter(p => !(S.prepared[p.id] && S.prepared[p.id].text) && !productOf(p)).length;
    return `<section class="fa-card" id="ttc-card">
      <header><h2>TikTok captions</h2><span class="fa-big ${list.length ? "hot" : ""}">${sc ? list.length : "?"}</span></header>
      <p class="muted">One press reads <b>every</b> post in TikTok Studio, finds the ones with no description (or only hashtags), writes each a short, classy caption (the matching product's real details and price, or a general F.A Vision caption with no price when the product isn't clear) and saves it on TikTok, one post at a time. Posts are never deleted or re-posted.</p>
      <div class="fa-actions ttc-go"><button class="btn btn-sell btn-lg" data-ttc="go" id="ttc-go">✨ Fix all TikTok descriptions</button></div>
      <p class="muted fa-small" id="ttc-status">${run ? (run.stage === "fix" ? `<b>Fixing ${plural(run.n || 0, "post")}…</b> The TikTok tab shows “Fixing 1 of ${run.n || "N"}…” as it goes; the summary appears here when it's done.` : "<b>Step 1 of 2: reading all your posts in TikTok Studio…</b> then it fixes each one.")
        : sc ? `Last read ${esc(sc.d)}: ${plural(sc.n, "post")}, ${list.length} without a description.${sc.stopped ? " (Stopped early: " + esc(sc.stopped) + ")" : ""}` : "Not read yet: press the button."}</p>
      ${sc && list.length ? `<ul class="fa-small ttc-split" id="ttc-split"><li><b>${fx.length}</b> fixed by the button now (oldest first: TikTok allows caption edits only within ${S.settings.edit_days} days of posting, once a day)</li>${old.length ? `<li class="muted">${plural(old.length, "post")} over ${S.settings.edit_days} days old: too old to edit</li>` : ""}${today_.length ? `<li class="muted">${today_.length} already edited today: tomorrow</li>` : ""}${app.length ? `<li class="muted">App only (commercial content, edit in the TikTok app): ${app.map(p => okUrl(p.url) ? `<a href="${esc(okUrl(p.url))}" target="_blank" rel="noopener">${esc(p.id)}</a>` : esc(p.id)).join(", ")}</li>` : ""}</ul>` : ""}
      ${lf && !run ? `<p class="fa-small ${lf.ok + (lf.had || 0) === lf.tried && !lf.stopped ? "up" : "down"}" id="ttc-summary">Last fix ${esc(lf.d)}: ${lf.ok} of ${lf.queued || lf.tried} descriptions added${lf.had ? `, ${lf.had} already had one` : ""}${lf.tried - lf.ok - (lf.had || 0) > 0 ? `, ${lf.tried - lf.ok - (lf.had || 0)} failed` : ""}${lf.stopped ? ". Stopped: " + esc(lf.stopped) : ""}.</p>` : ""}
      ${fx.length ? `<details class="ttc-review"><summary>Review captions (${fx.length}${general ? `, ${general} general` : ""}): optional</summary>
      <p class="muted fa-small">Nothing here is needed: the button uses these captions as they are. Change the product or the text first if you want.</p>
      ${fx.map(post => { const p = productOf(post), f = S.fixed[post.id], pk = picks()[post.id]; return `<div class="ttc-post">
        <div class="ttc-head">${okImg(post.thumb) ? `<img src="${esc(okImg(post.thumb))}" alt="" width="54" height="72" loading="lazy" referrerpolicy="no-referrer">` : ""}
          <div><b>${okUrl(post.url) ? `<a href="${esc(okUrl(post.url))}" target="_blank" rel="noopener">Post ${esc(post.id)}</a>` : "Post " + esc(post.id)}</b>
          <small class="muted">${post.desc ? "Now: " + esc(post.desc) : "No description"}${post.alt ? " · shows: " + esc(post.alt) : ""}</small>
          ${f && !f.ok ? `<small class="down">Last try: ${esc(f.why || "failed")}</small>` : ""}
          <label>Product <select data-ttc-pick="${esc(post.id)}"><option value="" ${!p && pk !== "-" ? "selected" : ""}>Auto: ${p ? "" : "general caption"}</option><option value="-" ${pk === "-" ? "selected" : ""}>No product (general caption)</option>${prods.map(x => `<option value="${esc(x.id)}" ${p && p.id === x.id ? "selected" : ""}>${esc(x.id)} · ${esc(shortName(x))}</option>`).join("")}</select></label></div></div>
        <textarea rows="7" maxlength="2200" data-ttc-text="${esc(post.id)}" aria-label="Caption for post ${esc(post.id)}">${esc(draft(post))}</textarea>
        <div class="fa-actions"><button type="button" class="btn btn-ghost btn-sm" data-ttc-fix="${esc(post.id)}">Fix just this one</button><button type="button" class="btn btn-ghost btn-sm" data-ttc-new="${esc(post.id)}">↻ New caption</button></div>
      </div>`; }).join("")}</details>` : ""}
      <p class="muted fa-small">Runs in this Edge tab, one post at a time, ${S.settings.min}–${S.settings.max} s apart, only presses Save, skips a post that has a description by then, and stops on any TikTok warning. People who comment “MINE”, “PRICE” and so on get the WhatsApp reply from Engagement → Reply to all commenters. The edit flow was checked on the live TikTok Studio (15 Oct 2026).</p>
    </section>`;
  }
  const rerender = () => { if (F()) F().render(); };
  document.addEventListener("click", e => {
    if (!S || !e.target.closest) return;
    const b = e.target.closest("[data-ttc],[data-ttc-fix],[data-ttc-new]");
    if (!b || !b.closest("#ttc-card")) return;
    e.preventDefault();
    if (b.dataset.ttc === "go") { if (b.disabled) return; b.disabled = true; b.textContent = "Reading all your TikTok posts…"; return startAll(); }
    if (b.dataset.ttcFix) return startFix([b.dataset.ttcFix]);
    if (b.dataset.ttcNew) {
      const post = waiting().find(x => x.id === b.dataset.ttcNew), p = post && productOf(post);
      if (!post) return;
      drafts[post.id] = p ? captionFor(p) : genericCaption(); rerender();
    }
  });
  document.addEventListener("input", e => { const t = e.target.closest && e.target.closest("[data-ttc-text]"); if (t) drafts[t.dataset.ttcText] = t.value; });
  document.addEventListener("change", e => {
    const s = e.target.closest && e.target.closest("[data-ttc-pick]");
    if (!s) return;
    const id = s.dataset.ttcPick;
    setPick(id, s.value || null);
    delete drafts[id];
    rerender();
  });

  window.FAV_TTCAPS = { load, state: () => S, renderCard, receive, startAll, startScan, startFix, fixAll, waiting, _test: { guess, meaningful, genericCaption, queueFor, setRun, fixable, postedAt, set: s => { S = normalise(s); } } };
})();
