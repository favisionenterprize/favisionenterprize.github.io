// Boost (Social autopilot → "Boost" tab): more views and engagement on every network, within what the
// platforms allow.
//   Trending sounds  – the add-on (extension/boost.js, job "sounds") reads TikTok Creative Center's trending
//                      songs approved for business use in Ghana (Commercial Music Library) and Instagram
//                      Reels' audio. Names only → data/sounds.json (+ a manual list). No music file is ever
//                      downloaded or put in our own videos (they keep our own Afrobeats beats).
//   Auto-sound       – TikTok posts (socauto) and Instagram Reels pick a sound from that list inside the
//                      platform's own picker; the same sound isn't reused within `rotate_days`.
//   Refresh pinned   – a sound can't be added to a published post, so this re-posts the pinned product as a
//                      new post (TikTok photo post with a sound, Instagram Reel, Facebook Page video from our
//                      Short with our beat), pins the new one and unpins the old one. Never deletes.
//   View boosters    – best-time posting (Ghana peak slots), daily Facebook story (+ IG/TikTok story kit),
//                      first-hour replies (reply mode on the newest posts at +15/+30/+60 min), daily Reels /
//                      Shorts from our Shorts, comment-inviting hooks (classy captions on IG too).
//   What's working   – top 3 posts from the Engagement stats; their products go first in the daily plans.
// Logs: data/sounds.json, data/boost.json. Timers and the best-time queue live in this browser (localStorage).
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const SFILE = "data/sounds.json", BFILE = "data/boost.json";
  const SITE = "https://favisionenterprize.github.io/";
  const EMPTY_S = { d: null, t: null, sounds: [], manual: [], used: [], notes: [] };
  const EMPTY_B = {
    settings: { auto_sound: true, rotate_days: 3, best_time: false, stories: true, first_hour: true, reels: true, hooks: true },
    pinned: [], stories: [], reels: [], runs: []
  };
  const NETS = { tiktok: "TikTok", ig: "Instagram", fb: "Facebook Page", yt: "YouTube Shorts", x: "X" };
  const F = () => window.FAV_FBAUTO, SOC = () => window.FAV_SOCAUTO, IG = () => window.FAV_IGAUTO, VID = () => window.FAV_VIDAUTO, PRO = () => window.FAV_PROFILES, ENG = () => window.FAV_ENGAGE;
  const today = () => new Date().toLocaleDateString("en-CA");
  const daysAgo = n => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const shortName = p => String(p.name).split(" — ")[0];
  const ls = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };
  const shellAtLeast = (a, b) => { const v = String(document.documentElement.dataset.favautoShell || "0").split(".").map(Number); return v[0] > a || (v[0] === a && (v[1] || 0) >= b); };
  let SS = null, B = null;

  function normS(s) { s = { ...EMPTY_S, ...(s || {}) }; ["sounds", "manual", "used", "notes"].forEach(k => { s[k] = Array.isArray(s[k]) ? s[k] : []; }); return s; }
  function normB(s) { s = s || JSON.parse(JSON.stringify(EMPTY_B)); s.settings = { ...EMPTY_B.settings, ...(s.settings || {}) }; ["pinned", "stories", "reels", "runs"].forEach(k => { s[k] = s[k] || []; }); return s; }
  async function load(force) {
    if (!SS || !B || force) { const [a, b] = await Promise.all([A.readJsonFile(SFILE, EMPTY_S), A.readJsonFile(BFILE, EMPTY_B)]); SS = normS(a); B = normB(b); }
    return B;
  }
  const saveS = async (m, msg) => { SS = normS(await A.saveJson(SFILE, s => m(normS(s)), msg, EMPTY_S)); };
  const saveB = async (m, msg) => { B = normB(await A.saveJson(BFILE, s => m(normB(s)), msg, EMPTY_B)); };

  // ------------------------------------------------------------------ sounds
  function soundList(platform) {
    const man = SS.manual.filter(x => !x.platform || x.platform === platform || x.platform === "any").map((x, i) => ({ ...x, rank: i + 1, manual: true }));
    return man.concat(SS.sounds.filter(x => x.platform === platform).sort((a, b) => a.rank - b.rank));
  }
  // Next sound for a post: not used on that network in the last rotate_days, nor already taken in this run.
  function soundFor(platform, taken) {
    if (!SS || !B || !B.settings.auto_sound) return null;
    const cut = daysAgo(B.settings.rotate_days);
    const recent = new Set(SS.used.filter(u => u.platform === platform && u.d >= cut).map(u => u.name.toLowerCase()).concat((taken || []).map(x => String(x).toLowerCase())));
    const s = soundList(platform).find(x => !recent.has(String(x.name).toLowerCase()));
    return s ? { name: s.name, artist: s.artist || "" } : null;
  }
  async function noteSounds(res, platform) {
    const used = (res || []).filter(r => r.ok && r.sound).map(r => ({ name: String(r.sound).slice(0, 80), platform, d: today() }));
    const missed = (res || []).filter(r => /no sound/.test(r.why || "")).length;
    if (!used.length && !missed) return;
    await saveS(s => { s.used = s.used.concat(used).slice(-400); if (missed) s.notes = s.notes.concat([{ d: today(), platform, text: `${missed} post${missed === 1 ? "" : "s"} went out without a sound` }]).slice(-50); return s; }, `Boost: sounds used on ${NETS[platform]}`);
  }
  const soundsWaiting = () => !!SS && B && B.settings.auto_sound && SS.d !== today();

  // ------------------------------------------------------------------ jobs (tagged by job id, so the result can be logged)
  function tag(job, t) { const p = ls("fa-boost-pending") || {}; p[job.id] = { ...t, at: Date.now() }; Object.keys(p).forEach(k => { if (Date.now() - p[k].at > 864e5) delete p[k]; }); ls("fa-boost-pending", p); }
  function ready(then) {
    const f = F();
    if (!f || f.needExt()) return false;
    if (!f.liveAddon()) { A.toast("Boost needs the add-on's automatic updates switched on (Today tab, top).", true); if (then && then.length) setTimeout(() => f.runStep(then, true), 1500); return false; }
    return true;
  }
  const skip = (then, msg, bad) => { if (msg) A.toast(msg, bad); if (then && then.length && F()) setTimeout(() => F().runStep(then, true), 1200); };
  function startSounds(then) {
    if (!ready(then)) return;
    const cc = shellAtLeast(5, 4);
    if (!cc) A.toast("Instagram sounds only: reload the add-on once (edge://extensions → ↻) so it can read TikTok Creative Center.");
    F().launch(cc ? "https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en?countryCode=GH&period=7" : "https://www.instagram.com/reels/", { kind: "sounds", stage: cc ? "cc" : "ig", cc, then: then && then.length ? then : null });
  }

  // The pinned product (Profile check card) and its Short video (made by scripts/make_shorts.py, with our beat).
  const pinnedPid = () => (PRO() && PRO().state() && PRO().state().settings.pin.p) || "FAV-014";
  const pinnedText = () => (PRO() && PRO().state() && PRO().state().settings.pin.text) || "Fresh stock, just arrived";
  const product = pid => A.products().find(p => p.id === pid);
  function shortOf(pid) {
    const v = VID() && VID().state();
    const gone = new Set(((v && v.removed) || []).map(String));
    return v ? (v.videos || []).find(x => x.product === pid && x.file && /\.mp4$/.test(x.file) && !gone.has(x.id)) : null;
  }
  const probeOf = text => String(text || "").replace(/\s+/g, " ").trim().slice(0, 60);
  function pagePost(text, img, then, t) {
    const page = "https://www.facebook.com/FaVisionEnterprise";
    const job = { kind: "post", mode: "now", q: [{ g: "page", name: "F.A Vision Enterprise (Page)", url: page, p: t.p || null, text, img }], min: 5, max: 5, then: then && then.length ? then : null };
    F().launch(page, job);
    tag(job, t);
  }
  // Refresh pinned: new post with sound → pin it → unpin the old one (never deleted).
  function refresh(net, then) {
    if (!ready(then)) return;
    const p = product(pinnedPid());
    if (!p) return skip(then, "Pick the pinned product in Engagement → Profile check first.", true);
    let job, url, text;
    if (net === "tiktok") {
      const j = SOC() && SOC().job("tiktok", { products: [p.id], limit: 1 });
      if (!j) return skip(then, "That product has no photo for TikTok.", true);
      job = j.job; url = j.url; text = job.q[0].text;
    } else if (net === "ig") {
      const j = IG() && IG().job({ products: [p.id], limit: 1 });
      if (!j) return skip(then, "That product has no photo for Instagram.", true);
      const v = shortOf(p.id);
      if (v) Object.assign(j.job.q[0], { img: location.origin + "/" + v.file, video: true, sound: soundFor("ig") });
      job = j.job; url = j.url; text = job.q[0].text;
    } else if (net === "fb") {
      const v = shortOf(p.id);
      text = window.FAV_CAPTIONS ? window.FAV_CAPTIONS.write(p, { net: "fb" }) : `${shortName(p)} ${C.formatPrice(p.price_ghs)} ${SITE}p/${p.id}.html`;
      ls("fa-boost-pin", { ...(ls("fa-boost-pin") || {}), fb: { pin: probeOf(text), unpin: pinnedText() } });
      return pagePost(text, location.origin + "/" + (v ? v.file : p.images[0]), ["pinswap:fb"].concat(then || []), { what: "refresh", net: "fb", p: p.id });
    } else return;
    ls("fa-boost-pin", { ...(ls("fa-boost-pin") || {}), [net]: { pin: probeOf(text), unpin: pinnedText() } });
    job.then = ["pinswap:" + net].concat(then || []);
    F().launch(url, job);
    tag(job, { what: "refresh", net, p: p.id });
  }
  function pinswap(net, then) {
    const s = (ls("fa-boost-pin") || {})[net];
    if (!s || !PRO()) return skip(then);
    PRO().start(net, "pinswap", then, { pin: s.pin, unpin: s.unpin });
  }

  // Stories: Facebook story every day (pinned product one day, the newest posted product the next).
  function storyProduct() {
    const so = SOC() && SOC().state(), ig = IG() && IG().state();
    const recent = [].concat((so && so.posts) || [], (ig && ig.posts) || []).filter(x => x.ok && x.p).sort((a, b) => String(b.t || b.d).localeCompare(String(a.t || a.d)))[0];
    const odd = new Date().getDate() % 2;
    return product(odd && recent ? recent.p : pinnedPid()) || product(pinnedPid());
  }
  const storyWaiting = () => !!B && B.settings.stories && !B.stories.some(x => x.d === today() && x.net === "fb" && x.ok);
  function startStory(then, dry) {
    if (!ready(then)) return;
    const p = storyProduct();
    if (!p) return skip(then, "No product for today's story.");
    const ad = ((A.business().promos || {}).ads || []).find(a => a.product === p.id && !/-arrived$/.test(a.id));
    const job = { kind: "story", dry: !!dry, img: location.origin + "/" + (ad ? `assets/images/ads/${ad.id}.jpg` : p.images[0]), text: `${shortName(p)} · ${C.formatPrice(p.price_ghs)}\nfavisionenterprize.github.io/p/${p.id}.html`, then: then && then.length ? then : null };
    F().launch("https://www.facebook.com/stories/create", job);
    tag(job, { what: "story", net: "fb", p: p.id });
  }

  // Reels / Shorts from our own Shorts (12 s, our Afrobeats beat): one a day per network, least recently used first.
  function pickReel(net) {
    const v = VID() && VID().state();
    if (!v) return null;
    const gone = new Set((v.removed || []).map(String));
    const fav = new Set(favour());
    const last = id => (B.reels.filter(r => r.v === id && r.net === net).map(r => r.d).sort().pop() || "");
    const list = (v.videos || []).filter(x => x.file && /\.mp4$/.test(x.file) && x.kind === "short" && !gone.has(x.id) && (!x.product || (product(x.product) && product(x.product).in_stock !== false)));
    return list.sort((a, b) => last(a.id).localeCompare(last(b.id)) || (fav.has(b.product) - fav.has(a.product)))[0] || null;
  }
  const reelWaiting = net => !!B && B.settings.reels && !B.reels.some(r => r.d === today() && r.net === net && r.ok) && !!pickReel(net) && (net !== "yt" || shellAtLeast(5, 1));
  function startReel(net, then) {
    if (!ready(then)) return;
    const v = pickReel(net);
    if (!v) return skip(then, "No Short video to post.");
    const p = v.product && product(v.product);
    const file = location.origin + "/" + v.file;
    if (net === "fb") {
      const text = window.FAV_CAPTIONS ? window.FAV_CAPTIONS.write(p || null, { net: "fb" }) : v.description;
      return pagePost(text, file, then, { what: "reel", net: "fb", v: v.id, p: v.product || null });
    }
    if (net === "ig") {
      const j = p ? IG() && IG().job({ products: [p.id], limit: 1 }) : null;
      if (!j) return skip(then, "No Instagram post for that video.");
      Object.assign(j.job.q[0], { img: file, video: true, sound: soundFor("ig") });
      j.job.then = then && then.length ? then : null;
      F().launch(j.url, j.job);
      return tag(j.job, { what: "reel", net: "ig", v: v.id, p: v.product || null });
    }
    if (net === "yt") {
      const job = { kind: "youtube", q: [{ k: v.id, file, title: VID().titleFor ? VID().titleFor(v, "youtube") : v.title, description: VID().textFor ? VID().textFor(v, "youtube") : v.description }], then: then && then.length ? then : null };
      F().launch("https://www.youtube.com/upload", job);
      return tag(job, { what: "reel", net: "yt", v: v.id, p: v.product || null });
    }
  }

  // ------------------------------------------------------------------ best-time posting (Ghana = GMT)
  const SLOTS = [[12, 13], [19, 22]];
  const inSlot = d => { d = d || new Date(); const h = d.getUTCHours(); return SLOTS.some(([a, b]) => h >= a && h < b); };
  function nextSlot(from) {
    const d = new Date(from || Date.now());
    if (inSlot(d)) return d;
    for (let i = 0; i < 48; i++) { const t = new Date(d); t.setUTCMinutes(0, 0, 0); t.setUTCHours(t.getUTCHours() + i + 1); if (inSlot(t)) { t.setUTCMinutes(2); return t; } }
    return d;
  }
  const POSTING = /^(post|ig|x|tiktok|story:|reel:)/;
  function deferSteps(steps) {
    if (!B || !B.settings.best_time || inSlot()) return steps;
    const later = steps.filter(k => POSTING.test(k)), now = steps.filter(k => !POSTING.test(k));
    if (!later.length) return steps;
    const at = nextSlot();
    ls("fa-boost-queue", { at: at.toISOString(), steps: later });
    A.toast(`Best-time posting: the posts wait for the next Ghana peak slot (${at.toUTCString().slice(17, 22)} GMT). Keep this admin open in Edge.`);
    return now;
  }
  // First-hour replies: reply mode on the newest posts at +15, +30 and +60 minutes.
  function afterPost(net) {
    if (!B || !B.settings.first_hour || !/^(fb|ig|x|tiktok)$/.test(net)) return;
    const t = (ls("fa-boost-timers") || []).filter(x => Date.parse(x.at) > Date.now() - 6 * 36e5);
    for (const m of [15, 30, 60]) {
      const at = Date.now() + m * 6e4;
      if (!t.some(x => x.net === net && Math.abs(Date.parse(x.at) - at) < 5 * 6e4)) t.push({ net, at: new Date(at).toISOString() });
    }
    ls("fa-boost-timers", t);
  }
  // Runs when the admin is open: due best-time queue first, then due reply timers (one launch per tick).
  function tick() {
    const f = F();
    const scr = document.querySelector("#screen-fbauto");
    if (!f || !B || document.hidden || !f.liveAddon() || !scr || scr.hidden) return;   // only while the Social autopilot is open
    if (document.querySelector("#favautobox")) return;
    const q = ls("fa-boost-queue");
    if (q && Date.parse(q.at) <= Date.now()) { ls("fa-boost-queue", null); A.toast("Peak time: posting now…"); return f.runStep(q.steps.concat("report"), true); }
    const timers = ls("fa-boost-timers") || [];
    const due = timers.filter(x => Date.parse(x.at) <= Date.now());
    if (!due.length) return;
    const nets = [...new Set(due.map(x => x.net))];
    ls("fa-boost-timers", timers.filter(x => Date.parse(x.at) > Date.now()));
    if (Date.now() - Date.parse(due[0].at) > 3 * 36e5) return;   // too late to matter
    A.toast("First-hour replies: answering new comments…");
    f.runStep(nets.map(n => "reply3:" + n), true);
  }
  setInterval(tick, 60000);

  // ------------------------------------------------------------------ results
  async function receive(out) {
    const d = today();
    if (out.kind === "sounds") {
      const res = (out.res || []).slice(0, 60).map(r => ({ name: String(r.name || "").slice(0, 80), artist: String(r.artist || "").slice(0, 60), platform: r.platform === "ig" ? "ig" : "tiktok", rank: Number(r.rank) || 99, d, ...(r.commercial ? { commercial: true } : {}), ...(r.trending ? { trending: true } : {}) })).filter(r => r.name);
      await saveS(s => {
        const keep = p => res.some(r => r.platform === p) ? [] : s.sounds.filter(x => x.platform === p);   // keep yesterday's list for a network that couldn't be read
        s.sounds = res.concat(keep("tiktok"), keep("ig"));
        s.d = d; s.t = new Date().toISOString();
        s.notes = s.notes.concat((out.notes || []).map(t => ({ d, text: String(t).slice(0, 200) }))).slice(-50);
        return s;
      }, `Boost: ${res.length} trending sounds`);
      return { text: `Trending sounds: ${res.filter(r => r.platform === "tiktok").length} TikTok (business), ${res.filter(r => r.platform === "ig").length} Instagram.${(out.notes || []).length ? " " + out.notes.join(" · ") : ""}${out.stopped ? " " + out.stopped : ""}`, bad: !res.length };
    }
    if (out.kind === "story") {
      const r = (out.res || [])[0] || { ok: false, why: out.stopped || "not shared" };
      const t = (ls("fa-boost-pending") || {})[out.id] || {};
      if (!out.dry) await saveB(s => { s.stories = s.stories.concat([{ d, net: "fb", p: t.p || null, ok: !!r.ok, ...(r.why ? { why: r.why } : {}) }]).slice(-200); return s; }, "Boost: Facebook story");
      return { text: r.ok ? `Facebook story ${r.why || "shared ✓"}${(out.notes || []).length ? " · " + out.notes.join(" · ") : ""}` : "Facebook story: " + (r.why || out.stopped), bad: !r.ok };
    }
    return { text: "", bad: false };
  }
  // Called by fbauto after every run: logs tagged Boost jobs, sounds used, and starts first-hour timers.
  async function afterRun(out) {
    if (!B) return;
    const pend = ls("fa-boost-pending") || {}, t = pend[out.id];
    const res = out.res || [];
    const ok = res.some(r => r.ok) && !out.dry;
    try {
      if (out.kind === "tiktok") await noteSounds(res, "tiktok");
      if (out.kind === "ig") await noteSounds(res, "ig");
      if (t && t.what === "reel") await saveB(s => { s.reels = s.reels.concat([{ d: today(), net: t.net, v: t.v, p: t.p, ok, ...(ok ? {} : { why: (res[0] && res[0].why) || out.stopped || "" }) }]).slice(-300); return s; }, `Boost: ${NETS[t.net]} reel`);
      if (t && t.what === "refresh") await saveB(s => { s.pinned = s.pinned.concat([{ d: today(), net: t.net, p: t.p, ok, ...(ok ? {} : { why: (res[0] && res[0].why) || out.stopped || "" }) }]).slice(-100); return s; }, `Boost: refreshed the pinned post on ${NETS[t.net]}`);
    } catch (e) { /* logging never blocks the run */ }
    if (t) { delete pend[out.id]; ls("fa-boost-pending", pend); }
    if (ok) {
      if (out.kind === "ig" || out.kind === "x" || out.kind === "tiktok") afterPost(out.kind);
      if (out.kind === "post" && res.some(r => r.g === "page" && r.ok)) afterPost("fb");
    }
  }

  // ------------------------------------------------------------------ what's working
  const words = s => new Set(String(s || "").toLowerCase().replace(/dinn?ing/g, "dining").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 3 && !/^(with|from|this|that|your|available|ghana|accra|vision|enterprise|furniture)$/.test(w)).map(w => w.replace(/s$/, "")));
  function productInText(text) {
    const have = words(text);
    let best = null;
    for (const p of A.products()) {
      if (p.placeholder) continue;
      const w = words(shortName(p));
      let hit = 0; w.forEach(x => { if (have.has(x)) hit++; });
      if (hit >= Math.min(2, w.size) && (!best || hit > best.hit)) best = { p, hit };
    }
    return best ? best.p : null;
  }
  function top() {
    const e = ENG() && ENG().state();
    if (!e) return [];
    return Object.values(e.posts || {}).map(p => ({ ...p, score: (p.likes || 0) + 2 * (p.comments || 0) + 3 * (p.shares || 0) + Math.round((p.views || 0) / 100) }))
      .filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(p => ({ ...p, product: productInText(p.title) }));
  }
  const favour = () => [...new Set(top().map(p => p.product && p.product.id).filter(Boolean))];
  // Daily plans: products of the top posts go first (when they haven't been posted in the last 2 days).
  function prefer(list, pidOf, lastOf) {
    const fav = new Set(favour());
    if (!fav.size) return list;
    const cut = daysAgo(2);
    const up = list.filter(x => fav.has(pidOf(x)) && String((lastOf && lastOf(x)) || "").slice(0, 10) < cut);
    return up.concat(list.filter(x => !up.includes(x)));
  }
  const hooks = () => !!B && B.settings.hooks;

  // ------------------------------------------------------------------ steps for the Today run
  function steps() {
    const out = [];
    if (!B || !F() || !F().liveAddon()) return out;
    if (soundsWaiting()) out.push("sounds");
    if (storyWaiting()) out.push("story:fb");
    for (const n of ["fb", "ig", "yt"]) if (reelWaiting(n)) out.push("reel:" + n);
    return out;
  }

  // ------------------------------------------------------------------ tab
  function renderTab() {
    if (!B || !SS) return `<p class="muted">Loading…</p>`;
    const st = B.settings, p = product(pinnedPid());
    const q = ls("fa-boost-queue"), timers = (ls("fa-boost-timers") || []).filter(x => Date.parse(x.at) > Date.now());
    const tp = top();
    const row = s => `<li><span>${s.rank ? `#${s.rank} ` : ""}${esc(s.name)}${s.artist ? ` <small class="muted">· ${esc(s.artist)}</small>` : ""}${s.manual ? ` <small class="muted">(your list)</small>` : ""}</span><small>${SS.used.some(u => u.name.toLowerCase() === String(s.name).toLowerCase() && u.d >= daysAgo(st.rotate_days)) ? "used lately" : ""}</small></li>`;
    const lastOf = (arr, net) => arr.filter(x => x.net === net).slice(-1)[0];
    return `<section class="fa-card">
        <header><h2>Trending sounds</h2><span class="muted fa-small">${SS.d ? (SS.d === today() ? "checked today" : "last checked " + esc(SS.d)) : "not checked yet"}</span></header>
        <p class="muted">Business accounts may only use each platform's own licensed music (TikTok's Commercial Music Library, Meta's library). So the sounds are <b>picked inside TikTok's and Instagram's own sound picker</b> when posting: no song is ever downloaded or added to our own videos (those keep our Afrobeats beats). The list is read once a day in the Today run.</p>
        <div class="boost-cols"><div><b>TikTok (approved for business, Ghana)</b><ul class="fa-list">${soundList("tiktok").slice(0, 10).map(row).join("") || `<li><span class="muted">none yet</span></li>`}</ul></div>
          <div><b>Instagram Reels audio</b><ul class="fa-list">${soundList("ig").slice(0, 10).map(row).join("") || `<li><span class="muted">none yet</span></li>`}</ul></div></div>
        <div class="fa-actions"><button class="btn btn-ghost btn-sm" data-boost="sounds">↻ Check sounds now</button></div>
        ${shellAtLeast(5, 4) ? "" : `<p class="fa-small" style="color:var(--err)">Reading TikTok Creative Center needs add-on 5.4: reload it once in edge://extensions (FA Vision Autopilot → ↻ Reload). Instagram sounds work now.</p>`}
        <details><summary>Your own list (used first)</summary>
          <form class="fa-settings" id="boost-manual"><label>One per line: <code>tiktok | Song name | Artist</code> (or <code>ig |</code> / <code>any |</code>)
            <textarea name="manual" rows="5" maxlength="4000">${esc(SS.manual.map(m => `${m.platform || "any"} | ${m.name} | ${m.artist || ""}`).join("\n"))}</textarea></label>
            <button class="btn btn-ghost btn-sm" type="submit">Save my list</button></form></details>
        ${SS.notes.length ? `<p class="muted fa-small">${esc(SS.notes.slice(-2).map(n => n.text).join(" · "))}</p>` : ""}
      </section>

      <section class="fa-card" id="boost-pinned">
        <header><h2>Refresh pinned with a trending sound</h2></header>
        <p class="muted">A sound can't be added to a post that's already published. This posts your pinned product again as a <b>new</b> post (TikTok photo post with today's trending business sound, Instagram Reel from our Short, Facebook Page video from our Short with our own beat), pins the new one and unpins the old one. The old post is never deleted.</p>
        <p class="fa-small">Pinned product: <b>${p ? esc(shortName(p)) : "none"}</b> · old post found by “${esc(pinnedText())}” (change both in Engagement → Profile check).</p>
        <div class="fa-actions">${["tiktok", "ig", "fb"].map(n => `<button class="btn btn-sell btn-sm" data-boost-refresh="${n}">Refresh on ${NETS[n]}</button>`).join("")}</div>
        ${B.pinned.length ? `<ul class="fa-list">${B.pinned.slice(-6).reverse().map(x => `<li class="${x.ok ? "" : "bad"}"><span>${x.ok ? "✓" : "✗"} ${esc(NETS[x.net] || x.net)}</span><small>${esc(x.d)}${x.why ? " · " + esc(x.why) : ""}</small></li>`).join("")}</ul>` : ""}
        <p class="muted fa-small">Pinning is done on the profile after posting. X and the Facebook Page work on the web; Instagram and TikTok may only allow pinning in their apps: the result then says so. Not yet checked live.</p>
      </section>

      <section class="fa-card">
        <header><h2>View boosters</h2></header>
        <form class="fa-settings" id="boost-settings">
          <label class="fa-check"><input type="checkbox" name="auto_sound" ${st.auto_sound ? "checked" : ""}> Auto-sound: TikTok posts and Instagram Reels get a trending sound (not the same one within <input type="number" name="rotate_days" min="1" max="14" value="${st.rotate_days}" class="now-num" aria-label="days"> days)</label>
          <label class="fa-check"><input type="checkbox" name="best_time" ${st.best_time ? "checked" : ""}> Best-time posting: the daily posts wait for Ghana peak times (12:00–13:00 and 19:00–22:00 GMT). The admin must be open in Edge then.</label>
          <label class="fa-check"><input type="checkbox" name="stories" ${st.stories ? "checked" : ""}> Daily story: pinned product one day, newest post the next (Facebook automatically; Instagram/TikTok with the kit below)</label>
          <label class="fa-check"><input type="checkbox" name="first_hour" ${st.first_hour ? "checked" : ""}> First-hour replies: answer comments on new posts at +15, +30 and +60 minutes</label>
          <label class="fa-check"><input type="checkbox" name="reels" ${st.reels ? "checked" : ""}> Daily Reels / Shorts from our Shorts (Facebook Page, Instagram, YouTube)</label>
          <label class="fa-check"><input type="checkbox" name="hooks" ${st.hooks ? "checked" : ""}> Comment hooks: Instagram captions use the classy style too (a question that invites comments)</label>
          <button class="btn btn-ghost btn-sm" type="submit">Save</button>
        </form>
        <p class="muted fa-small">${st.best_time ? (q ? `Waiting to post at ${esc(new Date(q.at).toUTCString().slice(17, 22))} GMT: ${esc(q.steps.join(", "))}.` : `Next peak slot: ${esc(nextSlot().toUTCString().slice(0, 22))} GMT.`) : "Best-time posting is off: posts go out when you press Run."}${timers.length ? ` ${plural(timers.length, "first-hour reply check")} waiting (next ${esc(new Date(timers.map(x => x.at).sort()[0]).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}).` : ""}</p>
      </section>

      <section class="fa-card">
        <header><h2>Stories and Reels today</h2></header>
        <ul class="fa-list">
          <li><span>Facebook story</span><small>${storyWaiting() ? "waiting" : lastOf(B.stories, "fb") ? (lastOf(B.stories, "fb").ok ? "✓ " : "✗ ") + esc(lastOf(B.stories, "fb").d) : st.stories ? "–" : "off"}</small></li>
          ${["fb", "ig", "yt"].map(n => { const l = lastOf(B.reels, n); return `<li><span>${NETS[n]} Reel/Short</span><small>${reelWaiting(n) ? "waiting" : l ? (l.ok ? "✓ " : "✗ ") + esc(l.d) + (l.v ? " · " + esc(l.v) : "") : st.reels ? "–" : "off"}</small></li>`; }).join("")}
        </ul>
        <div class="fa-actions"><button class="btn btn-ghost btn-sm" data-boost="story">Post today's Facebook story</button>${["fb", "ig", "yt"].map(n => `<button class="btn btn-ghost btn-sm" data-boost-reel="${n}">${NETS[n]} Reel now</button>`).join("")}</div>
        ${(() => { const sp = storyProduct(); return sp ? `<p class="muted fa-small"><b>Instagram / TikTok story kit</b> (their web sites can't post stories): <a href="../${esc(sp.images[0])}" download>download the photo</a>, then in the app add it to your story with a Link sticker: <button type="button" class="btn btn-ghost btn-sm" data-boost-copy="${esc(SITE + "p/" + sp.id + ".html")}">Copy product link</button> <button type="button" class="btn btn-ghost btn-sm" data-boost-copy="${esc(SITE + "tiktok/")}">Copy TikTok page link</button></p>` : ""; })()}
      </section>

      <section class="fa-card">
        <header><h2>What's working</h2></header>
        ${tp.length ? `<div class="eng-table-wrap"><table class="eng-table"><thead><tr><th>Post</th><th>Views</th><th>Likes</th><th>Comments</th><th>Product</th></tr></thead><tbody>
          ${tp.map((x, i) => `<tr><td>${i + 1}. <a href="${esc(/^https:\/\//.test(x.url) ? x.url : "#")}" target="_blank" rel="noopener">${esc(NETS[x.net] || x.net)} · ${esc(String(x.title || "").slice(0, 50))}</a></td><td>${x.views == null ? "–" : esc(String(x.views))}</td><td>${esc(String(x.likes || 0))}</td><td>${esc(String(x.comments || 0))}</td><td>${x.product ? esc(shortName(x.product)) : "–"}</td></tr>`).join("")}</tbody></table></div>
          <p class="muted fa-small">${favour().length ? `These products now go first in the daily Instagram, X and TikTok plans (unless posted in the last 2 days): ${esc(favour().join(", "))}.` : "No product recognised in the top posts yet."} Numbers come from Engagement → “Check stats only”.</p>` : `<p class="fa-empty">No numbers yet. Run Engagement → “Check stats only” once.</p>`}
      </section>`;
  }
  const rerender = () => { if (F()) F().render(); };
  document.addEventListener("click", async e => {
    if (!B || !e.target.closest) return;
    const b = e.target.closest("[data-boost],[data-boost-refresh],[data-boost-reel],[data-boost-copy]");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.boost === "sounds") return startSounds();
    if (b.dataset.boost === "story") return startStory();
    if (b.dataset.boostReel) return startReel(b.dataset.boostReel);
    if (b.dataset.boostCopy) { try { await navigator.clipboard.writeText(b.dataset.boostCopy); } catch (err) { /* ignore */ } return A.toast("Link copied ✓"); }
    if (b.dataset.boostRefresh) {
      const n = b.dataset.boostRefresh, p = product(pinnedPid());
      if (!window.confirm(`Post ${p ? shortName(p) : "the pinned product"} again on ${NETS[n]} with a trending sound, pin the new post and unpin the old one?\n\nThe old post is NOT deleted.`)) return;
      return refresh(n);
    }
  });
  document.addEventListener("submit", async e => {
    const f = e.target;
    if (!f || !B || (f.id !== "boost-settings" && f.id !== "boost-manual")) return;
    e.preventDefault();
    A.busy("Saving…");
    try {
      if (f.id === "boost-manual") {
        const manual = f.elements.manual.value.split("\n").map(l => l.split("|").map(x => x.trim())).filter(a => a.length >= 2 && a[1])
          .map(([pl, name, artist]) => ({ platform: /^(tiktok|ig|any)$/i.test(pl) ? pl.toLowerCase() : "any", name: name.slice(0, 80), artist: (artist || "").slice(0, 60) })).slice(0, 40);
        await saveS(s => { s.manual = manual; return s; }, "Boost: my sounds list");
      } else {
        const el = f.elements;
        const next = { ...B.settings, auto_sound: el.auto_sound.checked, rotate_days: Math.min(14, Math.max(1, parseInt(el.rotate_days.value, 10) || 3)), best_time: el.best_time.checked, stories: el.stories.checked, first_hour: el.first_hour.checked, reels: el.reels.checked, hooks: el.hooks.checked };
        await saveB(s => { s.settings = next; return s; }, "Boost: settings");
        if (!next.best_time) ls("fa-boost-queue", null);
      }
      A.toast("Saved ✓"); rerender();
    } catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); }
  });

  window.FAV_BOOST = { load, state: () => B, sounds: () => SS, renderTab, receive, afterRun, steps, deferSteps, startSounds, startStory, startReel, refresh, pinswap, soundFor, prefer, favour, hooks, nextSlot, inSlot, tick,
    _test: { set: (b, s) => { B = normB(b); SS = normS(s); }, top, productInText, afterPost } };
})();
