// TikTok captions (Social autopilot → its own tab "TikTok captions", key "ttcap").
//   ONE button, "✨ Fix all TikTok descriptions":
//     1. checks the add-on (forces it to download the latest live scripts, live mode, same version as
//        extension/live.json); any problem shows a red message saying what to do;
//     2. job "ttscan" (extension/ttcaptions.js + page-world helper ttids.js) reads TikTok Studio → Posts;
//     3. runStep "ttcaps:fixall" fixes the UNION of every `prepared` post id (captions written 15 Oct from
//        each post's photos) and any other empty post the scan found (under 15 chars of non-hashtag text,
//        "No description" counts as empty), minus done ones (fixed[id].ok / .skip), app-only ones and ones
//        over 7 days old (id >> 32 = Unix seconds), oldest first. It runs even if the scan fails or finds
//        nothing. Job "ttfix" opens each post's edit URL, skips it if it has a description by then, pastes the
//        caption, presses Save only, 20–40 s apart, stops on any warning, and hands back every 5 posts so
//        the log is committed (then "ttcaps:fixall" starts the next batch).
//   "Review captions" (collapsed, optional): change a post's product / text, or fix just one.
// Log: data/tiktok-captions.json { settings, prepared, app_only, scan: { d, n, posts: [{ id, url, desc, thumb, alt, kind }] },
//   fixed: { id: { d, ok, why?, skip? } }, runs }.
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
  // What's left without hashtags, mentions and spaces; TikTok's grey "No description" placeholder is empty.
  const meaningful = t => { const m = String(t || "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim(); return /^no description\.?$/i.test(m) ? "" : m; };
  const isDone = id => { const f = S.fixed[id]; return !!f && (f.ok || f.skip); };
  // Quality gate (Fix all): a post WITH a description but no hashtags gets the hashtag mix added at the end
  // (TikTok's own limits apply: within 7 days of posting, one edit a day). fixed[id].tags marks those done.
  const tagged = t => /(^|\s)#[\p{L}\p{N}_]{2,}/u.test(String(t || ""));
  function tagsWaiting() {
    if (!S || !S.scan) return [];
    return S.scan.posts.filter(p => p.id && meaningful(p.desc).length >= S.settings.min_chars && !tagged(p.desc) && !(S.fixed[p.id] && (S.fixed[p.id].tags_ok || S.fixed[p.id].skip_tags)) && !(S.fixed[p.id] && S.fixed[p.id].ok));
  }
  // Every post that needs a description: each prepared id + every empty post the scan found.
  function candidates() {
    if (!S) return [];
    const out = new Map();
    for (const p of (S.scan && S.scan.posts) || []) if (p.id && meaningful(p.desc).length < S.settings.min_chars) out.set(p.id, p);
    for (const id of Object.keys(S.prepared)) {
      const seen = S.scan && S.scan.posts.find(p => p.id === id);
      if (seen && meaningful(seen.desc).length >= S.settings.min_chars) continue;      // the scan saw it has one now
      if (!out.has(id)) out.set(id, { id, url: "", desc: "", thumb: "", alt: "", kind: "" });
    }
    return [...out.values()];
  }
  function waiting() { return candidates().filter(p => !isDone(p.id)); }
  // TikTok limits (seen live 15 Oct 2026): a caption can be edited once a day per post, and only within
  // 7 days of posting; "commercial content" posts can only be edited in the app. A TikTok post id starts
  // with its posting time (id >> 32 = Unix seconds).
  const postedAt = id => { try { const t = Number(BigInt(String(id)) >> 32n) * 1000; return t > 1.4e12 && t < Date.now() + 864e5 ? t : null; } catch (e) { return null; } };
  const tooOld = post => { const t = postedAt(post.id); return t != null && Date.now() - t > S.settings.edit_days * 864e5; };
  const appOnly = post => S.app_only.includes(post.id);
  const triedToday = post => { const f = S.fixed[post.id]; return !!f && f.d === today() && /won't allow|edited today/i.test(f.why || ""); };
  const triedThisRun = post => { const r = getRun(); return !!r && Array.isArray(r.tried) && r.tried.includes(post.id); };
  const byAge = (a, b) => { try { const x = BigInt(a.id), y = BigInt(b.id); return x < y ? -1 : x > y ? 1 : 0; } catch (e) { return 0; } };
  // What one press fixes now: oldest first, so posts about to pass 7 days are done first.
  function fixable() { return waiting().concat(tagsWaiting().map(p => ({ ...p, need: "tags" }))).filter(p => !appOnly(p) && !tooOld(p) && !triedToday(p) && !triedThisRun(p)).sort(byAge); }

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
      if (prep && prep.text && !picked) drafts[post.id] = gated(post, prep.text);    // written from the post's own images (browser run 15 Oct)
      else { const p = productOf(post); drafts[post.id] = gated(post, p ? captionFor(p) : genericCaption()); }
    }
    return drafts[post.id];
  }

  // ------------------------------------------------------------------ jobs
  // One button: check the add-on → scan every post (job "ttscan") → back in the admin, runStep
  // "ttcaps:fixall" queues every post that needs a description → job "ttfix" in batches of 5.
  const RUN = "fa-ttcaps-run";       // { stage: "scan" | "fix", t, n, tried: [ids], done } while a run is going (this browser only)
  function getRun() { try { const r = JSON.parse(localStorage.getItem(RUN) || "null"); return r && Date.now() - r.t < 3 * 3600e3 ? r : null; } catch (e) { return null; } }
  const setRun = r => { try { if (r) localStorage.setItem(RUN, JSON.stringify({ ...r, t: Date.now() })); else localStorage.removeItem(RUN); } catch (e) { /* storage blocked */ } };
  let scanProblem = null;
  // Red message on the card (what went wrong and what to press).
  let alertMsg = null;
  const alarm = m => alarmTT(m);
  function alarmTT(msg) {
    alertMsg = msg;
    A.toast(msg, true);
    const el = document.getElementById("ttc-alert");
    if (el) { el.textContent = msg; el.hidden = false; } else rerender();
    const b = document.getElementById("ttc-go");
    if (b) { b.disabled = false; b.textContent = "✨ Fix all TikTok descriptions"; }
  }
  // The add-on: make it download the latest live scripts now (admin.js "favauto-recheck" → install(force)),
  // then check it's in live mode with the same live.json version as the website.
  let STATUS_MS = 10000;
  function addonStatus(ms) {
    return new Promise(resolve => {
      const on = e => { if (e.source === window && e.data && e.data.type === "favauto-status") { window.removeEventListener("message", on); clearTimeout(tm); resolve(e.data.status || null); } };
      const tm = setTimeout(() => { window.removeEventListener("message", on); resolve(null); }, ms);
      window.addEventListener("message", on);
      window.postMessage({ type: "favauto-recheck" }, location.origin);
    });
  }
  async function siteVersion(need) {
    try { const r = await fetch("/extension/live.json?t=" + Date.now(), { cache: "no-store" }); const j = await r.json(); return { version: String(j.version || ""), ok: need ? need.every(n => (j.scripts || []).some(x => x.file === n)) : (j.scripts || []).some(x => x.file === "ttcaptions.js" && (x.matches || []).some(m => /tiktok\.com/.test(m))) && (j.scripts || []).some(x => x.file === "ttids.js") }; } catch (e) { return null; }
  }
  // Also used by the other networks on the Fix all tab (admin/fixall.js): opts.alarm shows the red message
  // there, opts.need lists the live scripts that must be in extension/live.json.
  async function preflight(opts) {
    opts = opts || {};
    const alarm = opts.alarm || alarmTT;
    const f = F();
    if (!f || f.needExt()) { alarm("The FA Vision add-on isn't installed in this browser: install it (steps at the bottom of the Today tab), then press the button again."); return false; }
    const st = await addonStatus(STATUS_MS);
    if (!st) { alarm("The FA Vision add-on didn't answer. Open edge://extensions, make sure FA Vision Autopilot is switched on and press ↻ Reload, then press Ctrl+F5 on this page and try again."); return false; }
    if (st.mode !== "live" || !st.userScripts) { alarm(`The add-on isn't in automatic-update (live) mode, so it can't run ${opts.what || "TikTok captions"}. Open edge://extensions → FA Vision Autopilot → Details, switch on "Allow user scripts", press ↻ Reload, then Ctrl+F5 here.`); return false; }
    const site = await siteVersion(opts.need);
    if (site && !site.ok) { alarm(`extension/live.json on the website doesn't list the ${opts.what || "TikTok captions"} scripts. Tell Claude: the add-on can't run them.`); return false; }
    if (site && site.version && st.version !== site.version) {
      const st2 = await addonStatus(STATUS_MS);          // the website may have just updated: one more try
      if (!st2 || st2.version !== site.version) { alarm(`The add-on still has old scripts (${(st2 || st).version || "unknown"}; the website has ${site.version}). ${(st2 || st).error ? "Its last update failed: " + (st2 || st).error + ". " : ""}Open edge://extensions and press ↻ Reload on FA Vision Autopilot, then Ctrl+F5 here and try again.`); return false; }
    }
    return true;
  }
  // The add-on swaps this tab to TikTok. If it hasn't within 60 s, the job never started.
  let watchdog = null;
  function launchJob(url, job) {
    clearTimeout(watchdog);
    F().launch(url, job);
    watchdog = setTimeout(() => { setRun(null); alarm("The add-on didn't open TikTok within 60 seconds, so nothing ran. Open edge://extensions, press ↻ Reload on FA Vision Autopilot, press Ctrl+F5 here, then press the button again."); }, 60000);
  }
  window.addEventListener("message", e => {
    if (e.source === window && e.data && e.data.type === "favauto-start-failed" && getRun()) { clearTimeout(watchdog); setRun(null); alarm("The add-on refused to start the TikTok job. Open edge://extensions, press ↻ Reload on FA Vision Autopilot, press Ctrl+F5 here, then try again."); }
  });
  function ready(then) {
    const f = F();
    if (!f || f.needExt()) return false;
    if (!f.liveAddon()) { alarm("TikTok captions need the add-on's automatic updates switched on (Today tab, top)."); if (then && then.length) setTimeout(() => f.runStep(then, true), 1500); return false; }
    return true;
  }
  // The big button. `then`: steps to carry on with afterwards (from a one-button run).
  async function startAll(then) {
    alertMsg = null;
    if (!(await preflight())) { if (then && then.length) setTimeout(() => F().runStep(then, true), 1500); return; }
    setRun({ stage: "scan", tried: [], done: 0 });
    launchJob("https://www.tiktok.com/tiktokstudio/content", { kind: "ttscan", max: 500, then: ["ttcaps:fixall"].concat(then || []) });
  }
  function startScan(then) {
    if (!ready(then)) return;
    launchJob("https://www.tiktok.com/tiktokstudio/content", { kind: "ttscan", max: 500, then: then && then.length ? then : null });
  }
  // Each caption goes through the quality gate (admin/captions.js ensure: description, hashtags, call to action).
  // need "tags": the post keeps its own text; the add-on only adds `tags` at the end.
  function gated(post, text) {
    const W = window.FAV_CAPTIONS;
    return W && W.ensure ? W.ensure(text, productOf(post), { net: "tiktok" }) : text;
  }
  function tagLine(post) {
    const W = window.FAV_CAPTIONS;
    let t = "";
    try { t = W ? W.tags(productOf(post), "tiktok") : ""; } catch (e) { t = ""; }
    return t || "#furniture #accra #ghana #homedecor #FAVisionEnterprise";
  }
  function queueFor(posts) {
    return posts.map(p => p.need === "tags"
      ? { id: p.id, url: p.url || "", kind: p.kind || "", mode: "tags", tags: tagLine(p), text: tagLine(p) }
      : { id: p.id, url: p.url || "", kind: p.kind || "", text: gated(p, String(drafts[p.id] != null && drafts[p.id].trim() ? drafts[p.id] : draft(p)).trim()).slice(0, 2200) }).filter(x => x.text);
  }
  const BATCH = 5;
  function launchFix(q, then, run) {
    if (!ready(then)) return false;
    const r = run || { tried: [], done: 0 };
    setRun({ ...r, stage: "fix", n: q.length });
    launchJob("https://www.tiktok.com/tiktokstudio/content", { kind: "ttfix", q, min: S.settings.min, max: S.settings.max, maxHops: 10 + q.length * 5,
      ...(run ? { batch: BATCH, cont: ["ttcaps:fixall"], wait_first: r.done > 0 } : {}), then: then && then.length ? then : null });
    return true;
  }
  function startFix(ids) {
    const posts = waiting().concat(tagsWaiting().map(p => ({ ...p, need: "tags" }))).filter(p => ids.includes(p.id));
    const blocked = posts.find(p => appOnly(p) || tooOld(p));
    if (blocked && posts.length === 1) return A.toast(appOnly(blocked) ? "TikTok only lets you edit this post in the app (commercial content)." : `TikTok only allows caption edits within ${S.settings.edit_days} days of posting.`, true);
    const q = queueFor(posts.filter(p => !appOnly(p) && !tooOld(p)).sort(byAge));
    if (!q.length) return A.toast("Nothing to fix.", true);
    launchFix(q);
  }
  // Chained after the scan (and after each batch of 5): fix every post that needs a description.
  // Runs even when the scan failed or found nothing: the prepared ids are enough.
  async function fixAll(then) {
    await load();
    if (scanProblem) { A.toast(`TikTok captions: the read of your posts didn't work (${scanProblem}). Fixing the ${plural(fixable().length, "prepared post")} anyway.`, true); scanProblem = null; }
    const run = getRun() || { tried: [], done: 0 };
    const posts = fixable();
    if (!posts.length) {
      setRun(null);
      const w = waiting().length;
      A.toast(run.done ? `TikTok captions: finished ✓ (${plural(run.done, "post")} handled this run).` : w ? `Nothing TikTok lets us edit right now: ${w} without a description are app-only, over ${S.settings.edit_days} days old or already tried today.` : "All your TikTok posts already have a description ✓", !run.done && !!w);
      if (F()) F().render();
      if (then && then.length) setTimeout(() => F().runStep(then, true), 1500);
      return;
    }
    if (!launchFix(queueFor(posts), then, run)) setRun(null);
  }

  async function receive(out) {
    clearTimeout(watchdog);
    const d = today(), res = out.res || [];
    const old = !out.v ? " The add-on ran an OLD copy of the TikTok script (no version): open edge://extensions, press ↻ Reload on FA Vision Autopilot, Ctrl+F5 here and press the button again." : "";
    if (old) alertMsg = old.trim();
    if (out.kind === "ttscan") {
      scanProblem = out.stopped && out.stopped !== "Stopped by you." ? out.stopped : !res.length ? "no posts read" : null;
      if (out.noid && !out.helper) alertMsg = "The add-on's TikTok id helper (ttids.js) didn't run, so posts showing \"No description\" couldn't be read. Open edge://extensions, press ↻ Reload on FA Vision Autopilot, then Ctrl+F5 here. (Fix all still fixes the prepared posts.)";
      const posts = res.slice(0, 1000).filter(r => /^\d{6,}$/.test(String(r.id))).map(r => ({ id: String(r.id), url: /^https:\/\/www\.tiktok\.com\//.test(r.url) ? r.url : "", desc: String(r.desc || "").slice(0, 300), thumb: /^https:\/\//.test(r.thumb || "") ? String(r.thumb).slice(0, 600) : "", alt: String(r.alt || "").slice(0, 200), kind: r.kind === "video" || r.kind === "photo" ? r.kind : "" }));
      if (posts.length) {
        await save(s => {
          s.scan = { d, t: new Date().toISOString(), n: posts.length, posts, v: String(out.v || ""), ...(out.stopped ? { stopped: out.stopped } : {}) };
          s.runs = s.runs.concat([{ d, kind: "scan", n: posts.length, v: String(out.v || ""), ...(out.noid ? { noid: out.noid } : {}), ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
          return s;
        }, `TikTok captions: read ${posts.length} posts`);
      }
      const need = fixable().length;
      return { text: `${posts.length ? `Read ${plural(posts.length, "TikTok post")}` : "Couldn't read your TikTok posts" + (out.stopped ? ` (${out.stopped})` : "")}: ${need} to fix now${getRun() ? ", fixing them now…" : "."}${old}`, bad: !posts.length || !!old };
    }
    if (out.kind === "ttfix") {
      const ok = res.filter(r => r.ok), had = res.filter(r => !r.ok && (r.skip || /already has/.test(r.why || "")));
      await save(s => {
        for (const r of res) s.fixed[r.id] = r.mode === "tags"
          ? { ...(s.fixed[r.id] || {}), d, ...(r.why ? { why: r.why } : {}), ...(r.ok ? { tags_ok: true } : {}), ...(!r.ok && r.skip ? { skip_tags: true } : {}) }
          : { d, ok: !!r.ok, ...(r.why ? { why: r.why } : {}), ...(!r.ok && (r.skip || /already has/.test(r.why || "")) ? { skip: true } : {}) };
        s.runs = s.runs.concat([{ d, kind: "fix", queued: Number(out.n) || res.length, tried: res.length, ok: ok.length, had: had.length, v: String(out.v || ""), ...(out.more ? { more: out.more } : {}), ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
        return s;
      }, `TikTok captions: added ${ok.length} of ${res.length}`);
      ok.forEach(r => { delete drafts[r.id]; setPick(r.id, null); });
      const run = getRun();
      if (run && out.more && !out.stopped) setRun({ ...run, tried: (run.tried || []).concat(res.map(r => r.id)), done: (run.done || 0) + res.length });
      else setRun(null);
      const bad = res.filter(r => !r.ok && !(r.skip || /already has/.test(r.why || "")));
      return { text: `TikTok: ${plural(ok.length, "description")} added${had.length ? `, ${had.length} already had one` : ""}${bad.length ? `, ${bad.length} not (${bad.map(r => r.why).filter(Boolean).slice(0, 2).join("; ")})` : " ✓"}.${out.more && !out.stopped ? ` Saved; ${out.more} more to go…` : ""}${out.stopped ? " Stopped: " + out.stopped : ""}${old}`, bad: !!out.stopped || !!bad.length || !!old };
    }
    return { text: "", bad: false };
  }

  // ------------------------------------------------------------------ card
  // The last day's fix runs added up (a run is saved in batches of 5).
  function lastFix() {
    const last = S.runs.slice().reverse().find(r => r.kind === "fix");
    if (!last) return null;
    const day = S.runs.filter(r => r.kind === "fix" && r.d === last.d);
    const sum = k => day.reduce((n, r) => n + (Number(r[k]) || 0), 0);
    return { d: last.d, ok: sum("ok"), had: sum("had"), tried: sum("tried"), queued: sum("tried"), stopped: last.stopped };
  }
  function renderCard() {
    if (!S) return "";
    const list = waiting(), noTags = tagsWaiting(), prods = A.products().filter(p => !p.placeholder), sc = S.scan, run = getRun(), lf = lastFix();
    const fx = fixable(), old = list.filter(p => !appOnly(p) && tooOld(p)), app = list.filter(appOnly), today_ = list.filter(p => !appOnly(p) && !tooOld(p) && triedToday(p));
    const general = fx.filter(p => !(S.prepared[p.id] && S.prepared[p.id].text) && !productOf(p)).length;
    return `<section class="fa-card" id="ttc-card">
      <header><h2>TikTok captions</h2><span class="fa-big ${list.length ? "hot" : ""}">${list.length}</span></header>
      <p class="muted">One press reads <b>every</b> post in TikTok Studio, finds the ones with no description (or only hashtags), writes each a short, classy caption (the matching product's real details and price, or a general F.A Vision caption with no price when the product isn't clear) and saves it on TikTok, one post at a time. Posts are never deleted or re-posted.</p>
      <p class="fa-small down ttc-alert" id="ttc-alert" role="alert" style="color:var(--err);font-weight:600" ${alertMsg ? "" : "hidden"}>${esc(alertMsg || "")}</p>
      <div class="fa-actions ttc-go"><button class="btn btn-sell btn-lg" data-ttc="go" id="ttc-go">✨ Fix all TikTok descriptions</button></div>
      <p class="muted fa-small" id="ttc-status">${run ? (run.stage === "fix" ? `<b>Fixing ${plural(run.n || 0, "post")}…</b> The TikTok tab shows “Fixing 1 of ${run.n || "N"}…” as it goes; the summary appears here when it's done.` : "<b>Step 1 of 2: reading all your posts in TikTok Studio…</b> then it fixes each one.")
        : sc ? `Last read ${esc(sc.d)}: ${plural(sc.n, "post")}, ${list.length} without a description${noTags.length ? `, ${noTags.length} without hashtags` : ""}.${sc.stopped ? " (Stopped early: " + esc(sc.stopped) + ")" : ""}` : `${plural(list.length, "post")} waiting for a description (captions already written). Press the button.`}</p>
      ${list.length ? `<ul class="fa-small ttc-split" id="ttc-split"><li><b>${fx.length}</b> fixed by the button now (oldest first: TikTok allows caption edits only within ${S.settings.edit_days} days of posting, once a day)</li>${old.length ? `<li class="muted">${plural(old.length, "post")} over ${S.settings.edit_days} days old: too old to edit</li>` : ""}${today_.length ? `<li class="muted">${today_.length} already edited today: tomorrow</li>` : ""}${app.length ? `<li class="muted">App only (commercial content, edit in the TikTok app): ${app.map(p => okUrl(p.url) ? `<a href="${esc(okUrl(p.url))}" target="_blank" rel="noopener">${esc(p.id)}</a>` : esc(p.id)).join(", ")}</li>` : ""}</ul>` : ""}
      ${lf && !run ? `<p class="fa-small ${lf.ok + (lf.had || 0) === lf.tried && !lf.stopped ? "up" : "down"}" id="ttc-summary">Last fix ${esc(lf.d)}: ${lf.ok} of ${lf.queued || lf.tried} descriptions added${lf.had ? `, ${lf.had} already had one` : ""}${lf.tried - lf.ok - (lf.had || 0) > 0 ? `, ${lf.tried - lf.ok - (lf.had || 0)} failed` : ""}${lf.stopped ? ". Stopped: " + esc(lf.stopped) : ""}.</p>` : ""}
      ${fx.length ? `<details class="ttc-review"><summary>Review captions (${fx.length}${general ? `, ${general} general` : ""}): optional</summary>
      <p class="muted fa-small">Nothing here is needed: the button uses these captions as they are. Change the product or the text first if you want.</p>
      ${fx.map(post => { const p = productOf(post), f = S.fixed[post.id], pk = picks()[post.id];
        if (post.need === "tags") return `<div class="ttc-post ttc-tags"><b>${okUrl(post.url) ? `<a href="${esc(okUrl(post.url))}" target="_blank" rel="noopener">Post ${esc(post.id)}</a>` : "Post " + esc(post.id)}</b> <small class="muted">has a description, no hashtags: the button adds today's hashtag mix at the end (its text stays).</small> <small>${esc(String(post.desc || "").slice(0, 90))}</small></div>`;
        return `<div class="ttc-post">
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

  window.FAV_TTCAPS = { load, state: () => S, renderCard, receive, startAll, startScan, startFix, fixAll, waiting, tagsWaiting, fixable: () => (S ? fixable() : []), preflight, meaningful, _test: { guess, meaningful, genericCaption, queueFor, setRun, getRun, fixable, candidates, postedAt, preflight, alert: () => alertMsg, statusMs: ms => { STATUS_MS = ms; }, set: s => { S = normalise(s); } } };
})();
