// Fix all (Social autopilot → tab "Fix all", key "ttcap"): finds posts, listings and products that went out
// without a description, hashtags or a sound, highlights them per network, and fixes what each site allows.
//   ✨ Fix all everywhere = add-on check (ttcaptions.js preflight) → Facebook Page (scan + fix) → Instagram
//   (scan + fix) → X (scan, report only) → Marketplace (fresh scan + fix) → TikTok (the existing Fix all).
//   Facebook Page / Instagram: job "fxscan" reads up to 100 recent posts; job "fxfix" opens each post that has an
//     empty / very short caption or no hashtags, uses ONLY "Edit post" / "Edit", pastes a fresh caption (or adds the
//     hashtag mix at the end, keeping the text), Save / Done, 20–40 s apart, hands back every 5 so the log is saved.
//   X: posts can't be edited (Premium: 1 hour only) → listed as "can't edit on X"; optional "Reply with a
//     description" (job "fxreply", Alexander confirms) adds a self-reply with the caption and hashtags.
//   Marketplace: job "mkedit" opens each linked listing's edit form and rewrites a short description / one without
//     the website link (same text as new listings: mkauto description()), Update.
//   Website / shop: products with a short description or < 2 highlights → "🔎 Seek" (approval-gated, never automatic).
//   Stories / statuses and sound on old posts: can't be changed once posted → shown as info; new ones go through
//   the quality gate (admin/captions.js ensure) and Boost's sound picker.
// Log: data/fix-all.json { settings, fb: { scan, fixed }, ig: { scan, fixed }, x: { scan, replied }, mk: { fixed }, runs }.
// Extension side: extension/fixall.js (live script). Selectors NOT checked live (only on local mock pages).
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/fix-all.json";
  const EMPTY = { settings: { min: 20, max: 40, scan_max: 100, mk_min: 60, web_min: 80 }, fb: { scan: null, fixed: {} }, ig: { scan: null, fixed: {} }, x: { scan: null, replied: {} }, mk: { fixed: {} }, runs: [] };
  const F = () => window.FAV_FBAUTO, W = () => window.FAV_CAPTIONS, TTC = () => window.FAV_TTCAPS, MK = () => window.FAV_MKAUTO, SOC = () => window.FAV_SOCAUTO, IG = () => window.FAV_IGAUTO, BST = () => window.FAV_BOOST;
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const shortName = p => String(p.name).split(" — ")[0];
  const NAMES = { fb: "Facebook Page", ig: "Instagram", x: "X", mk: "Marketplace", tt: "TikTok", web: "Website / shop" };
  const PAGE = "https://www.facebook.com/FaVisionEnterprise";
  const BATCH = 5;
  let S = null;

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    s.settings = { ...EMPTY.settings, ...(s.settings || {}) };
    for (const k of ["fb", "ig"]) { s[k] = s[k] || { scan: null, fixed: {} }; s[k].fixed = s[k].fixed || {}; }
    s.x = s.x || { scan: null, replied: {} }; s.x.replied = s.x.replied || {};
    s.mk = s.mk || { fixed: {} }; s.mk.fixed = s.mk.fixed || {};
    s.runs = s.runs || [];
    return s;
  }
  async function load(force) { if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY)); return S; }
  async function save(mutate, message) { S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY)); }

  // ------------------------------------------------------------------ what needs fixing
  const meaningful = t => (W() && W().meaningful ? W().meaningful(t) : String(t || "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").trim());
  const tagged = t => /(^|\s)#[\p{L}\p{N}_]{2,}/u.test(String(t || ""));
  const MIN = 15;
  const issue = (text, net) => meaningful(text).length < MIN ? "desc" : net !== "mk" && !tagged(text) ? "tags" : "";
  // Posts on one network that miss a description or hashtags, not fixed / skipped yet.
  function need(net) {
    const st = S && S[net];
    if (!st || !st.scan) return [];
    const done = net === "x" ? st.replied : st.fixed;
    return st.scan.posts.filter(p => p.kind !== "shared" && issue(p.text, net) && !(done[p.id] && (done[p.id].ok || done[p.id].skip))).map(p => ({ ...p, need: issue(p.text, net) }));
  }
  // Marketplace: every active listing linked to a product that hasn't been checked yet (the add-on reads the
  // description on the listing's edit form; ones that are fine are only marked "checked").
  function mkNeed() {
    if (!S || !MK() || !MK().state()) return [];
    const an = MK().analyse();
    return an.active.filter(r => r.id && r.m && r.m.p && !(S.mk.fixed[r.id] && (S.mk.fixed[r.id].ok || S.mk.fixed[r.id].skip)));
  }
  function mkUnlinked() { if (!MK() || !MK().state()) return []; return MK().analyse().active.filter(r => !r.m || !r.id); }
  // Website / shop: a short description or fewer than 2 highlights.
  function webNeed() {
    return A.products().filter(p => !p.placeholder).map(p => ({ p, short: meaningful(p.description).length < S.settings.web_min, hl: (p.highlights || []).length < 2 })).filter(x => x.short || x.hl);
  }
  function ttCounts() {
    const t = TTC();
    if (!t || !t.state()) return { desc: 0, tags: 0, now: 0 };
    return { desc: t.waiting().length, tags: t.tagsWaiting ? t.tagsWaiting().length : 0, now: t.fixable ? t.fixable().length : 0 };
  }
  // Sound: recent autopilot posts that went out without one (platforms don't allow adding music afterwards).
  function noSound() {
    const so = SOC() && SOC().state(), ig = IG() && IG().state();
    const since = new Date(Date.now() - 30 * 864e5).toLocaleDateString("en-CA");
    const tt = ((so && so.posts) || []).filter(x => x.net === "tiktok" && x.ok && x.d >= since && /no sound/i.test(x.why || "")).length;
    const igr = ((ig && ig.posts) || []).filter(x => x.ok && x.d >= since && /no sound/i.test(x.why || "")).length;
    return { tt, ig: igr };
  }
  function counts() {
    const c = {};
    for (const net of ["fb", "ig", "x"]) { const l = need(net); c[net] = { desc: l.filter(p => p.need === "desc").length, tags: l.filter(p => p.need === "tags").length, scanned: !!(S[net] && S[net].scan) }; }
    c.mk = { check: mkNeed().length, scanned: !!(MK() && MK().state() && MK().state().scan) };
    c.tt = ttCounts();
    c.web = webNeed().length;
    c.sound = noSound();
    return c;
  }

  // ------------------------------------------------------------------ captions for the fixes
  const STOP = /^(the|and|for|with|our|new|now|this|that|you|your|from|fyp|ghana|accra|set|sets|quality|order|call|whatsapp|price|delivery|available|stock|furniture|vision|enterprise|favision|best|shop|more|all|get|in|at|on)$/;
  const words = t => new Set(String(t || "").toLowerCase().replace(/dinn?ing/g, "dining").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.test(w)).map(w => w.replace(/s$/, "")));
  function guess(text) {
    const have = words(text);
    if (!have.size) return null;
    const scored = [];
    for (const p of A.products()) {
      if (p.placeholder) continue;
      let hit = 0; words(shortName(p) + " " + (p.category || "")).forEach(x => { if (have.has(x)) hit++; });
      if (hit) scored.push({ p, hit });
    }
    scored.sort((a, b) => b.hit - a.hit);
    if (!scored.length || (scored[1] && scored[1].hit === scored[0].hit)) return null;    // not confident: general caption
    return scored[0].p;
  }
  function captionFor(post, net) {
    const p = guess(post.text + " " + (post.alt || ""));
    const w = W();
    const text = w ? w.write(p, { net }) : `${p ? shortName(p) + ". " : ""}Quality furniture in Accra. WhatsApp 0572646176 to order. #FAVisionEnterprise`;
    let tags = "";
    try { tags = w ? w.tags(p, net, null, true) : ""; } catch (e) { tags = ""; }
    return { p, text, tags: tags || "#FAVisionEnterprise #AccraFurniture #FurnitureGhana" };
  }

  // ------------------------------------------------------------------ jobs
  const RUN = "fa-fixall-run";   // { net, tried: [ids], done } while a fix run is going (this browser only)
  function getRun() { try { const r = JSON.parse(localStorage.getItem(RUN) || "null"); return r && Date.now() - r.t < 3 * 3600e3 ? r : null; } catch (e) { return null; } }
  const setRun = r => { try { if (r) localStorage.setItem(RUN, JSON.stringify({ ...r, t: Date.now() })); else localStorage.removeItem(RUN); } catch (e) { /* storage blocked */ } };
  let alertMsg = null;
  function alarm(msg) {
    alertMsg = msg;
    A.toast(msg, true);
    const el = document.getElementById("fx-alert");
    if (el) { el.textContent = msg; el.hidden = false; } else rerender();
    document.querySelectorAll("#fx-card [data-fx]").forEach(b => { b.disabled = false; });
  }
  const carry = then => { if (then && then.length) setTimeout(() => F().runStep(then, true), 1500); };
  // Same check as TikTok captions: the add-on answers, is in live mode and has the website's scripts (incl. fixall.js).
  async function preflight() {
    if (!TTC() || !TTC().preflight) return !!(F() && !F().needExt() && F().liveAddon());
    return TTC().preflight({ alarm, need: ["fixall.js"], what: "Fix all" });
  }
  let watchdog = null;
  function launchJob(url, job) {
    clearTimeout(watchdog);
    F().launch(url, job);
    watchdog = setTimeout(() => { setRun(null); alarm("The add-on didn't open the page within 60 seconds, so nothing ran. Open edge://extensions, press ↻ Reload on FA Vision Autopilot, press Ctrl+F5 here, then press the button again."); }, 60000);
  }
  window.addEventListener("message", e => {
    if (e.source === window && e.data && e.data.type === "favauto-start-failed" && getRun()) { clearTimeout(watchdog); setRun(null); alarm("The add-on refused to start the Fix all job. Open edge://extensions, press ↻ Reload on FA Vision Autopilot, press Ctrl+F5 here, then try again."); }
  });
  function ready(then) {
    const f = F();
    if (!f || f.needExt()) { carry(then); return false; }
    if (!f.liveAddon()) { alarm("Fix all needs the add-on's automatic updates switched on (Today tab, top)."); carry(then); return false; }
    return true;
  }
  const URLS = { fb: PAGE, ig: () => `https://www.instagram.com/${(IG() && IG().state() && IG().state().settings.account) || "favisionent"}/`, x: () => `https://x.com/${(SOC() && SOC().state() && SOC().state().settings.x.account) || "FaVisionEnt"}` };
  const urlOf = net => typeof URLS[net] === "function" ? URLS[net]() : URLS[net];
  function startScan(net, then) {
    if (!ready(then)) return;
    const acct = net === "ig" ? urlOf("ig").split("/")[3] : net === "x" ? urlOf("x").split("/")[3] : "";
    launchJob(urlOf(net), { kind: "fxscan", net, max: S.settings.scan_max, page: PAGE, account: acct, then: then && then.length ? then : null });
  }
  function fixQueue(net) {
    const r = getRun(), tried = new Set((r && r.net === net && r.tried) || []);
    return need(net).filter(p => p.kind !== "shared" && !tried.has(p.id)).map(p => {
      const c = captionFor(p, net);
      return { id: p.id, url: p.url, p: c.p ? c.p.id : null, text: c.text, tags: c.tags, mode: p.need === "tags" ? "tags" : "set" };
    });
  }
  // Fix one network's posts in batches of 5 (the add-on hands back after each batch; "fx:fix:<net>" carries on).
  function fixNet(net, then, fresh) {
    if (!ready(then)) return;
    const run = (!fresh && getRun() && getRun().net === net) ? getRun() : { net, tried: [], done: 0 };
    const q = net === "mk" ? mkQueue(run) : fixQueue(net);
    if (!q.length) {
      setRun(null);
      A.toast(run.done ? `${NAMES[net]}: finished ✓ (${plural(run.done, "item")} handled).` : `${NAMES[net]}: nothing to fix ✓`);
      rerender(); carry(then); return;
    }
    setRun({ ...run, net, n: q.length });
    const job = { kind: net === "mk" ? "mkedit" : "fxfix", net, q, min: S.settings.min, max: S.settings.max, batch: BATCH, cont: ["fx:fix:" + net], wait_first: run.done > 0, maxHops: 20 + q.length * 6, min_len: S.settings.mk_min, then: then && then.length ? then : null };
    launchJob(q[0].url, job);
  }
  function mkQueue(run) {
    const tried = new Set((run && run.tried) || []);
    const desc = MK() && (MK().description || (MK()._test && MK()._test.description));
    return mkNeed().filter(r => !tried.has(r.id)).map(r => ({ id: r.id, p: r.m.p.id, title: r.t, url: `https://www.facebook.com/marketplace/edit/?listing_id=${encodeURIComponent(r.id)}`, text: desc ? desc(r.m.p) : `${shortName(r.m.p)}\n\nOrder or see more: ${location.origin}/p/${r.m.p.id}.html` }));
  }
  // X: a self-reply with a fresh caption under each post Alexander picks (confirm first).
  function replyX(ids, then) {
    if (!ready(then)) return;
    const posts = need("x").filter(p => ids.includes(p.id));
    if (!posts.length) return A.toast("Nothing to reply to.", true);
    if (!window.confirm(`Reply under ${plural(posts.length, "X post")} with a description and hashtags? (X doesn't allow editing old posts.)`)) return;
    const q = posts.map(p => { const c = captionFor(p, "x"); return { id: p.id, url: p.url, p: c.p ? c.p.id : null, text: c.text }; });
    setRun({ net: "x", tried: [], done: 0, n: q.length });
    launchJob(q[0].url, { kind: "fxreply", net: "x", q, min: S.settings.min, max: S.settings.max, batch: BATCH, maxHops: 20 + q.length * 6, then: then && then.length ? then : null });
  }
  // One network, scan then fix (per-network buttons).
  async function startNet(net, then) {
    alertMsg = null;
    if (!(await preflight())) { carry(then); return; }
    if (net === "tt") return TTC().startAll(then);
    if (net === "mk") return MK() && MK().state() ? F().runStep(["mkscan", "fx:fix:mk"].concat(then || []), true) : fixNet("mk", then, true);
    setRun(null);
    startScan(net, (net === "x" ? [] : ["fx:fix:" + net]).concat(then || []));
  }
  // The big button.
  async function startEverything() {
    alertMsg = null;
    if (!(await preflight())) return;
    setRun(null);
    const steps = ["fx:scan:fb", "fx:fix:fb", "fx:scan:ig", "fx:fix:ig", "fx:scan:x"].concat(MK() && MK().state() ? ["mkscan"] : [], ["fx:fix:mk"], TTC() && TTC().state() ? ["ttcaps:all"] : [], ["fx:done"]);
    F().runStep(steps, true);
  }
  // Steps for fbauto runStep: fx:scan:<net>, fx:fix:<net>, fx:done.
  function step(k, then) {
    const [, what, net] = k.split(":");
    if (what === "scan") return startScan(net, then);
    if (what === "fix") return fixNet(net, then);
    if (what === "done") { setRun(null); A.toast("Fix all: done everywhere ✓ (see the Fix all tab for what's left)."); rerender(); carry(then); }
  }

  async function receive(out) {
    clearTimeout(watchdog);
    const d = today(), res = out.res || [], net = out.net;
    const old = !out.v ? " The add-on ran an OLD copy of the Fix all script: open edge://extensions, press ↻ Reload on FA Vision Autopilot, Ctrl+F5 here and try again." : "";
    if (old) alertMsg = old.trim();
    if (out.kind === "fxscan") {
      const posts = res.slice(0, 300).filter(r => r && r.id && /^[\w-]{3,40}$/.test(String(r.id))).map(r => ({ id: String(r.id), url: /^https:\/\/(www\.facebook\.com|www\.instagram\.com|x\.com)\//.test(r.url || "") ? String(r.url).slice(0, 300) : "", text: String(r.text || "").slice(0, 600), kind: /^(post|video|shared)$/.test(r.kind) ? r.kind : "post", alt: String(r.alt || "").slice(0, 200) })).filter(p => p.url);
      if (posts.length || !out.stopped) {
        await save(s => {
          s[net].scan = { d, t: new Date().toISOString(), n: posts.length, posts, ...(out.stopped ? { stopped: out.stopped } : {}) };
          s.runs = s.runs.concat([{ d, kind: "scan", net, n: posts.length, v: String(out.v || ""), ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-200);
          return s;
        }, `Fix all: read ${posts.length} ${NAMES[net]} posts`);
      }
      const l = need(net);
      return { text: `${NAMES[net]}: read ${plural(posts.length, "post")}, ${l.filter(p => p.need === "desc").length} without a description, ${l.filter(p => p.need === "tags").length} without hashtags.${net === "x" && l.length ? " X can't edit posts: see the Fix all tab." : ""}${out.stopped ? " Stopped: " + out.stopped : ""}${old}`, bad: !!out.stopped || !!old };
    }
    if (/^(fxfix|fxreply|mkedit)$/.test(out.kind)) {
      const ok = res.filter(r => r.ok), skip = res.filter(r => !r.ok && r.skip);
      const key = out.kind === "mkedit" ? "mk" : net;
      await save(s => {
        const book = key === "x" ? s.x.replied : s[key].fixed;
        for (const r of res) book[r.id] = { d, ok: !!r.ok, ...(r.why ? { why: String(r.why).slice(0, 200) } : {}), ...(r.skip ? { skip: true } : {}), ...(r.mode ? { mode: r.mode } : {}) };
        s.runs = s.runs.concat([{ d, kind: out.kind, net: key, tried: res.length, ok: ok.length, skip: skip.length, v: String(out.v || ""), ...(out.more ? { more: out.more } : {}), ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-200);
        return s;
      }, `Fix all: ${NAMES[key]} ${ok.length} of ${res.length} fixed`);
      const run = getRun();
      if (run && out.more && !out.stopped) setRun({ ...run, tried: (run.tried || []).concat(res.map(r => r.id)), done: (run.done || 0) + res.length });
      else setRun(null);
      const bad = res.filter(r => !r.ok && !r.skip);
      return { text: `${NAMES[key]}: ${plural(ok.length, out.kind === "fxreply" ? "reply" : "post")} fixed${skip.length ? `, ${skip.length} already fine` : ""}${bad.length ? `, ${bad.length} not (${bad.map(r => r.why).filter(Boolean).slice(0, 2).join("; ")})` : " ✓"}.${out.more && !out.stopped ? ` Saved; ${out.more} more to go…` : ""}${out.stopped ? " Stopped: " + out.stopped : ""}${old}`, bad: !!out.stopped || !!bad.length || !!old };
    }
    return { text: "", bad: false };
  }

  // ------------------------------------------------------------------ tab
  const okUrl = u => /^https:\/\/(www\.facebook\.com|www\.instagram\.com|x\.com|www\.tiktok\.com)\//.test(String(u || "")) ? String(u) : "";
  const badge = (n, word, hot) => `<span class="fx-pill ${n ? (hot ? "hot" : "warn") : "ok"}">${n ? `${n} ${word}` : `✓ ${word}`}</span>`;
  function postList(list, net) {
    if (!list.length) return "";
    return `<details class="fx-list"><summary>Show ${plural(list.length, "post")}</summary><ul>${list.slice(0, 60).map(p => `<li class="${p.need === "desc" ? "hot" : "warn"}">${okUrl(p.url) ? `<a href="${esc(okUrl(p.url))}" target="_blank" rel="noopener">${esc(p.id)}</a>` : esc(p.id)} · <b>${p.need === "desc" ? "no description" : "no hashtags"}</b>${p.text ? ` · <small>${esc(String(p.text).slice(0, 90))}</small>` : ""}${net === "x" ? ` <label class="fa-check"><input type="checkbox" data-fx-xpick="${esc(p.id)}"> reply</label>` : ""}</li>`).join("")}</ul></details>`;
  }
  function scanLine(net) {
    const sc = S[net] && S[net].scan;
    return sc ? `Last read ${esc(sc.d)}: ${plural(sc.n, "post")}.${sc.stopped ? " (Stopped: " + esc(sc.stopped) + ")" : ""}` : "Not read yet: press the button.";
  }
  function netCard(net, c) {
    const l = need(net);
    const what = { fb: "Opens each post on facebook.com/FaVisionEnterprise (Facebook switched to the Page), Actions → <b>Edit post</b> only, pastes a fresh caption (or adds hashtags at the end), Save.", ig: "Opens each post on @favisionent, More options → <b>Edit</b> only, pastes a fresh caption (or adds hashtags at the end), Done.", x: "<b>X can't edit posts</b> (Premium only, within 1 hour), so these are reported only. Tick posts and press “Reply with a description” to add a reply under each with the caption and hashtags (you confirm first)." }[net];
    return `<section class="fa-card fx-net" id="fx-${net}">
      <header><h2>${NAMES[net]}</h2><span>${badge(c.desc, "no description", true)} ${badge(c.tags, "no hashtags")}${net === "x" && l.length ? ' <span class="fx-pill warn">can\'t edit on X</span>' : ""}</span></header>
      <p class="muted fa-small">${what}</p>
      <p class="muted fa-small">${scanLine(net)}</p>
      ${postList(l, net)}
      <div class="fa-actions"><button class="btn ${net === "x" ? "btn-ghost" : "btn-sell"}" data-fx="net:${net}">${net === "x" ? "🔍 Check X posts" : `✨ Fix ${NAMES[net]}`}</button>${net === "x" && l.length ? `<button class="btn btn-ghost" data-fx="xreply">💬 Reply with a description</button>` : ""}</div>
    </section>`;
  }
  function renderTab() {
    if (!S) return `<p class="muted">Loading…</p>`;
    const c = counts(), run = getRun();
    const web = webNeed(), mkl = mkNeed(), unl = mkUnlinked();
    const total = c.fb.desc + c.fb.tags + c.ig.desc + c.ig.tags + c.x.desc + c.x.tags + c.tt.desc + c.tt.tags + c.mk.check + c.web;
    const row = (k, a, b) => `<tr><th scope="row">${NAMES[k] || k}</th><td>${a}</td><td>${b}</td></tr>`;
    const lastRun = S.runs.slice(-1)[0];
    const head = `<section class="fa-card" id="fx-card">
      <header><h2>Fix all everywhere</h2><span class="fa-big ${total ? "hot" : ""}">${total}</span></header>
      <p class="muted">Finds the posts, listings and products that went out without a description, hashtags or a sound, highlights them below, and fixes them one by one where each site allows it. Captions are fresh every time and end with a call to action. Nothing is ever deleted or re-posted.</p>
      <p class="fa-small down fx-alert" id="fx-alert" role="alert" style="color:var(--err);font-weight:600" ${alertMsg ? "" : "hidden"}>${esc(alertMsg || "")}</p>
      <div class="fa-actions ttc-go"><button class="btn btn-sell btn-lg" data-fx="all" id="fx-go">✨ Fix all everywhere</button></div>
      ${run ? `<p class="fa-small"><b>Fixing ${esc(NAMES[run.net] || run.net)}…</b> ${run.done ? `${run.done} done so far. ` : ""}The other tab shows each step; the summary appears here.</p>` : ""}
      <table class="fx-table"><thead><tr><th>Where</th><th>Missing</th><th>What happens</th></tr></thead><tbody>
        ${row("tt", `${badge(c.tt.desc, "no description", true)} ${badge(c.tt.tags, "no hashtags")}`, "Fixed (within 7 days of posting, once a day)")}
        ${row("fb", c.fb.scanned ? `${badge(c.fb.desc, "no description", true)} ${badge(c.fb.tags, "no hashtags")}` : '<span class="fx-pill">not read yet</span>', "Fixed (Edit post)")}
        ${row("ig", c.ig.scanned ? `${badge(c.ig.desc, "no description", true)} ${badge(c.ig.tags, "no hashtags")}` : '<span class="fx-pill">not read yet</span>', "Fixed (Edit)")}
        ${row("x", c.x.scanned ? `${badge(c.x.desc, "no description", true)} ${badge(c.x.tags, "no hashtags")}` : '<span class="fx-pill">not read yet</span>', "Report only: can't edit on X (optional reply)")}
        ${row("mk", c.mk.scanned ? badge(c.mk.check, "to check", true) : '<span class="fx-pill">scan Marketplace first</span>', "Short descriptions / no website link rewritten")}
        ${row("web", badge(c.web, "short or no highlights", true), "Listed with a Seek shortcut (you approve)")}
        <tr><th scope="row">Stories / statuses</th><td><span class="fx-pill">can't edit</span></td><td>Can't be changed once posted; new ones pass the quality gate</td></tr>
        <tr><th scope="row">Sound</th><td>${c.sound.tt + c.sound.ig ? badge(c.sound.tt + c.sound.ig, "posted without sound") : '<span class="fx-pill ok">✓ none lately</span>'}</td><td>Info only: music can't be added after posting</td></tr>
      </tbody></table>
      <p class="muted fa-small"><b>New posts:</b> every posting path (Facebook groups and Page, Instagram, X, TikTok, YouTube, Marketplace, stories, reels, share buttons) goes through the quality gate first: a real description, hashtags (not needed on Marketplace), a call to action, X within 280 characters, and the add-on re-reads the box right before Post and never posts a blank one. TikTok and Instagram Reels pick a sound in the app's own picker (favourite artists, then trending); when none is available the post still goes out and the log says “no sound”.</p>
      ${lastRun ? `<p class="fa-small muted" id="fx-last">Last step ${esc(lastRun.d)}: ${esc(NAMES[lastRun.net] || lastRun.net)} ${lastRun.kind === "scan" ? `read ${lastRun.n}` : `${lastRun.ok} of ${lastRun.tried} fixed${lastRun.skip ? `, ${lastRun.skip} already fine` : ""}`}${lastRun.stopped ? ". Stopped: " + esc(lastRun.stopped) : ""}.</p>` : ""}
    </section>`;
    const tt = TTC() ? `<div class="fx-tt">${TTC().renderCard()}</div>` : "";
    const mk = `<section class="fa-card fx-net" id="fx-mk">
      <header><h2>Facebook Marketplace</h2><span>${c.mk.scanned ? badge(mkl.length, "to check", true) : '<span class="fx-pill">not scanned</span>'}</span></header>
      <p class="muted fa-small">Opens each listing linked to a product (Edit listing), reads its description and, if it's short (under ${S.settings.mk_min} characters) or doesn't have the website link, writes a fresh one ending “Order or see more: …/p/ID.html”, then Update. Only the description changes. Needs Facebook on your personal profile.</p>
      ${unl.length ? `<p class="muted fa-small">${plural(unl.length, "listing")} not linked to a product (link them on the Marketplace tab first): ${unl.slice(0, 6).map(r => esc(r.t)).join(", ")}${unl.length > 6 ? "…" : ""}</p>` : ""}
      <div class="fa-actions"><button class="btn btn-sell" data-fx="net:mk">✨ Fix Marketplace descriptions</button></div>
    </section>`;
    const webCard = `<section class="fa-card fx-net" id="fx-web">
      <header><h2>Website / shop</h2><span>${badge(web.length, "need more text", true)}</span></header>
      <p class="muted fa-small">Products with a description under ${S.settings.web_min} characters or fewer than 2 highlights. 🔎 Seek finds fresh text and photos; nothing changes until you approve it.</p>
      ${web.length ? `<ul class="fx-web">${web.slice(0, 40).map(x => `<li><b>${esc(x.p.id)}</b> ${esc(shortName(x.p))} · ${[x.short && "short description", x.hl && "no highlights"].filter(Boolean).join(", ")} <button type="button" class="btn btn-ghost btn-sm" data-fx-seek="${esc(x.p.id)}">🔎 Seek</button></li>`).join("")}</ul>` : `<p class="up fa-small">Every product has a full description and highlights ✓</p>`}
    </section>`;
    const info = `<section class="fa-card fx-net" id="fx-info">
      <header><h2>Stories, statuses and sound</h2></header>
      <p class="muted fa-small"><b>Stories / WhatsApp Status:</b> Facebook, Instagram and WhatsApp don't allow editing a story once it's up (they disappear after 24 hours anyway). New stories from Boost always carry the product, price, WhatsApp number and link.</p>
      <p class="muted fa-small"><b>Sound on old posts:</b> TikTok, Instagram and Facebook don't let you add music after posting. ${c.sound.tt + c.sound.ig ? `${plural(c.sound.tt + c.sound.ig, "recent post")} went out without a sound (info only).` : "No recent autopilot post went out without a sound."} For the pinned post, refresh it with a new post that has a trending sound:</p>
      <div class="fa-actions"><button class="btn btn-ghost" data-fx="refresh:tiktok">🎵 Refresh pinned with a trending sound (TikTok)</button><button class="btn btn-ghost" data-fx="refresh:ig">🎵 Refresh pinned (Instagram Reel)</button></div>
    </section>`;
    return head + tt + netCard("fb", c.fb) + netCard("ig", c.ig) + netCard("x", c.x) + mk + webCard + info +
      `<p class="muted fa-small">Runs in this Edge tab, one post at a time, ${S.settings.min}–${S.settings.max} s apart, stops on any warning and saves the log every 5 posts. Facebook Page, Instagram, X and Marketplace selectors were not checked live yet (only on test pages): the first run is worth watching.</p>`;
  }
  const rerender = () => { if (F()) F().render(); };
  document.addEventListener("click", e => {
    if (!S || !e.target.closest) return;
    const s = e.target.closest("[data-fx-seek]");
    if (s) { e.preventDefault(); if (window.FAV_SEEK) window.FAV_SEEK.open(s.dataset.fxSeek); else A.toast("Seek isn't loaded on this page.", true); return; }
    const b = e.target.closest("[data-fx]");
    if (!b || !b.closest(".fx-net, #fx-card")) return;
    e.preventDefault();
    const k = b.dataset.fx;
    if (k === "all") { if (b.disabled) return; b.disabled = true; b.textContent = "Checking the add-on…"; return startEverything().finally(() => { b.disabled = false; b.textContent = "✨ Fix all everywhere"; }); }
    if (k.startsWith("net:")) return startNet(k.slice(4));
    if (k === "xreply") { const ids = [...document.querySelectorAll("[data-fx-xpick]:checked")].map(x => x.dataset.fxXpick); if (!ids.length) return A.toast("Tick the X posts to reply under first.", true); return replyX(ids); }
    if (k.startsWith("refresh:") && BST()) return BST().refresh(k.slice(8));
  });

  window.FAV_FIXALL = { load, state: () => S, renderTab, receive, step, startEverything, startNet, startScan, fixNet, replyX, counts, need, _test: { set: s => { S = normalise(s); }, captionFor, fixQueue, mkQueue, webNeed, getRun, setRun, alert: () => alertMsg, guess } };
})();
