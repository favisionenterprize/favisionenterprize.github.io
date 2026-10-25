// ⚡ PRIME (admin/prime.js, deep link #prime; big button on the dashboard and on top of the Social autopilot Today tab).
// One press runs every tab/feature at once:
//  - network LANES run side by side, each in its own admin tab (add-on 5.5 opens them; older add-ons get ONE extra tab
//    that runs the lanes one after another): fb (renew → group posts → Marketplace scan/list → declines → sync → grow →
//    story → reel → Fix all → profile check → engagement stats/reply/thank → Profile relay), ig, x, tt (sounds first,
//    then posts, TikTok captions, …), yt (waiting videos + reel). Each lane is the normal fbauto runStep chain, so the
//    AI Plan gate, Pause All, the daily caps (20 groups, 60 comments/network/run, daily_posts) and the stop-on-warning
//    rules all work exactly as before;
//  - ADMIN work runs at once in this tab, in parallel: trends, leads, sales, SEO check, ad/box-ad rebuild, Bulk buyers,
//    Profile kit and 🤖 AI Fix (admin/openitems.js);
//  - optional waits are dropped while a Prime run is active (FAV_PRIME.fast()): best-time queue, first-hour reply timers,
//    wait_first, inter-batch idle, alert-email waits. The FLOOR stays: 8–12 s (random) between two posts/comments/joins
//    on the same network + account (job.min/max, pmin/pmax). A platform warning or security check stops that lane only.
// Progress: one row per step, a 6:00 countdown and a summary (done / still running in the background / stopped and why).
// Anything not done at 6:00 keeps going in its lane tab at the floor pace. Gated by AI Plan rule M8 ("prime").
// State: localStorage "fa-prime" (run) + "fa-prime-L-<lane>" (one key per lane, so tabs never overwrite each other);
// sessionStorage "fa-prime-lane" marks a lane tab.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const F = () => window.FAV_FBAUTO;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, bad) => { if (A().toast) A().toast(m, bad); };
  const TARGET = 6 * 60e3, GAP_MIN = 8, GAP_MAX = 12, RUN = "fa-prime", LK = l => "fa-prime-L-" + l, STALL = 25000;
  // fb = everything that posts, comments, joins or edits on Facebook/Marketplace (one at a time, 8–12 s apart);
  // fbr = read-only Facebook work (scans, imports, checks) in its own tab at the same time: it never posts.
  const LANES = { admin: "Admin & website", fb: "Facebook & Marketplace: posting", fbr: "Facebook & Marketplace: reading", ig: "Instagram", x: "X", tt: "TikTok", yt: "YouTube" };
  const FB_READ = /^(mkscan|sync|declines|fx:scan:fb|profile:fb:check|engage:fb:stats)$/;
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } }
  };
  const ss = { get(k) { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } }, set(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch (e) { /* */ } } };
  const run = () => { const r = ls.get(RUN, null); return r && Date.now() - r.at < 3 * 36e5 && !r.over ? r : null; };
  const fast = () => !!run();

  // ---------------------------------------------------------------- which lane a step / result belongs to
  const NET2LANE = { fb: "fb", mk: "fb", ig: "ig", x: "x", tiktok: "tt", tt: "tt", yt: "yt" };
  function laneOf(x) {
    if (x && typeof x === "object") {
      const k = x.kind;
      if ((k === "fxscan" || k === "profile" || (k === "engage" && x.mode === "stats")) && (x.net === "fb" || !x.net)) return "fbr";
      if (/^(mkscan|import|declines)$/.test(k) && !x.relay && !x.rb) return "fbr";
      if (/^(fxscan|fxfix|fxreply|engage|profile)$/.test(k)) return NET2LANE[x.net] || "fb";
      if (k === "ig") return "ig";
      if (k === "x") return "x";
      if (/^(tiktok|sounds|ttscan|ttfix)$/.test(k)) return "tt";
      if (k === "youtube") return "yt";
      return "fb";   // post, renew, import, declines, grow, mk*, mkedit, story
    }
    const k = String(x || ""), p = k.split(":");
    if (FB_READ.test(k)) return "fbr";
    if (/^(fx|profile|engage)$/.test(p[0])) return NET2LANE[p[0] === "fx" ? p[2] : p[1]] || "fb";
    if (/^(ig|ignow|igs|reel:ig)$/.test(k) || /^(igs:|hr:ig)/.test(k) || k === "reel:ig") return "ig";
    if (/^(x|xnow)$/.test(k) || /^(xs:|hr:x)/.test(k)) return "x";
    if (/^(tiktok|ttnow|sounds)$/.test(k) || /^(tts:|tt1:|ttcaps:|hr:tiktok)/.test(k)) return "tt";
    if (k === "yt:all" || k === "reel:yt") return "yt";
    return "fb";
  }

  // ---------------------------------------------------------------- the plan
  function plan() {
    const f = F(), lanes = { fb: [], fbr: [], ig: [], x: [], tt: [], yt: [] };
    const today = f && f._test && f._test.stepsToday ? f._test.stepsToday() : [];
    for (const k of today) if (k !== "report") lanes[laneOf(k)].push(k);
    const add = (l, ...ks) => ks.forEach(k => { if (!lanes[l].includes(k)) lanes[l].push(k); });
    // Facebook: posts first (the most valuable), then the reading/cleaning work, then engagement, then the relay.
    add("fb", "renew", "post", "mkscan", "mklist", "declines", "sync", "grow", "story:fb", "reel:fb", "fx:scan:fb", "fx:fix:fb", "fx:fix:mk",
      "profile:fb:check", "engage:fb:stats", "engage:fb:reply", "engage:fb:likers", "prime:relay");
    lanes.fbr = lanes.fbr.concat(lanes.fb.filter(k => FB_READ.test(k))).filter((k, i, a) => a.indexOf(k) === i);
    lanes.fb = lanes.fb.filter(k => !FB_READ.test(k));
    lanes.fb.sort((a, b) => ORDER_FB.indexOf(a) - ORDER_FB.indexOf(b));
    lanes.fbr.sort((a, b) => ORDER_FB.indexOf(a) - ORDER_FB.indexOf(b));
    add("ig", "ig", "reel:ig", "fx:scan:ig", "fx:fix:ig", "profile:ig:check", "engage:ig:stats", "engage:ig:reply", "engage:ig:likers");
    add("x", "x", "fx:scan:x", "profile:x:check", "engage:x:stats", "engage:x:reply", "engage:x:likers");
    add("tt", "sounds", "tiktok", "ttcaps:all", "profile:tiktok:check", "engage:tiktok:stats", "engage:tiktok:reply", "engage:tiktok:likers");
    lanes.tt.sort((a, b) => (a === "sounds" ? -1 : 0) - (b === "sounds" ? -1 : 0));
    add("yt", "yt:all", "reel:yt");
    return lanes;
  }
  const ORDER_FB = ["renew", "post", "mkscan", "mklist", "declines", "sync", "grow", "story:fb", "reel:fb", "fx:scan:fb", "fx:fix:fb", "fx:fix:mk", "profile:fb:check", "engage:fb:stats", "engage:fb:reply", "engage:fb:likers", "prime:relay"];
  // Rough seconds per step at the floor pace (10 s average per post/comment + page loads), for the panel and the test.
  function estimate(k) {
    const f = F(), S = f && f._test && f._test.state ? f._test.state() : null;
    const perItem = 10 + 6;   // floor gap + typing/upload
    if (k === "post" && S && f._test.plan) return 20 + f._test.plan().groups.length * perItem;
    if (/^(ig|x|tiktok)$/.test(k)) { const so = k === "ig" ? window.FAV_IGAUTO : window.FAV_SOCAUTO; try { const n = k === "ig" ? so.summary().waiting : so.summary(k).waiting; return 20 + n * (perItem + 10); } catch (e) { return 60; } }
    if (/^engage:.*:(reply|likers)$/.test(k)) return 120;
    if (/^engage:/.test(k)) return 60;
    if (/^(fx:scan|profile:|mkscan|sounds|declines|sync|renew)/.test(k)) return 45;
    if (/^(fx:fix|ttcaps:)/.test(k)) return 90;
    if (k === "grow") return 20 * perItem;
    if (k === "prime:relay") return 300;
    return 30;
  }

  // ---------------------------------------------------------------- lane state (one localStorage key per lane)
  const L = lane => ls.get(LK(lane), null);
  const setL = (lane, m) => { const l = L(lane); if (!l) return; m(l); l.u = Date.now(); ls.set(LK(lane), l); paint(); };
  function current(l) { return l.steps.find(s => s.st === "run"); }
  function onStep(k, rest) {
    if (!fast()) return;
    const lane = laneOf(k);
    setL(lane, l => {
      if (l.status === "stopped") return;
      const cur = current(l); if (cur) { cur.st = cur.st === "run" ? "ok" : cur.st; }
      let s = l.steps.find(x => x.k === k && x.st === "wait");
      if (!s) { s = { k, st: "wait" }; l.steps.push(s); }
      s.st = "run"; s.t = Date.now(); l.status = "running";
    });
    watch(k, rest);
  }
  function onSkip(k, why) {
    if (!fast()) return;
    setL(laneOf(k), l => { const s = l.steps.find(x => x.k === k && (x.st === "run" || x.st === "wait")); if (s) { s.st = "skip"; s.why = why; } });
  }
  function onResult(out, then) {
    if (!fast() || !out) return;
    unwatch(laneOf(out));
    const lane = laneOf(out);
    const res = Array.isArray(out.res) ? out.res : [];
    const ok = res.filter(r => r && r.ok).length;
    setL(lane, l => {
      const s = current(l) || l.steps.slice().reverse().find(x => x.st !== "wait");
      if (s) { s.n = (s.n || 0) + ok; s.of = (s.of || 0) + res.length; s.st = out.stopped && out.stopped !== "Stopped by you." && !out.more ? "fail" : "ok"; if (out.stopped) s.why = out.stopped; }
      if (ok && /^(post|ig|x|tiktok|engage|youtube|story|mklist|fxfix|ttfix)$/.test(out.kind)) l.lastAct = Date.now();
      // A platform warning / security check stops THIS lane (same network + account): nothing more is posted there.
      if (out.stopped && out.stopped !== "Stopped by you." && /blocked|restricted|limit|suspicious|identity|verify|try again later|security|checkpoint|captcha|warning|showed/i.test(out.stopped)) {
        l.status = "stopped"; l.stopped = out.stopped;
        l.steps.forEach(x => { if (x.st === "wait") { x.st = "skip"; x.why = "lane stopped"; } });
        if (Array.isArray(then)) then.splice(0, then.length);
      }
    });
  }
  function onIdle(x) {
    if (!fast()) return;
    const lane = x == null ? ss.get("fa-prime-lane") : laneOf(x);
    unwatch(lane);
    if (!lane || !L(lane)) return;
    setL(lane, l => { const c = current(l); if (c) c.st = "ok"; if (l.status !== "stopped") { l.status = "done"; l.steps.forEach(s => { if (s.st === "wait") { s.st = "skip"; s.why = s.why || "not reached"; } }); } l.t1 = Date.now(); });
  }
  // Wait before the next step on this lane: never less than the floor since the last post/comment on this network.
  function gap(out) {
    const l = out ? L(laneOf(out)) : null;
    const floor = (GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)) * 1000;
    return l && l.lastAct ? Math.max(200, Math.round(floor - (Date.now() - l.lastAct))) : 200;
  }
  // Job timing while Prime runs: the floor instead of the normal (longer) waits. Caps (limits, batch sizes) are untouched.
  function tune(job) {
    job.prime = true;
    unwatch(laneOf(job));   // a job was launched: the lane is busy, not stuck
    delete job.wait_first;
    const gapKinds = /^(post|ig|x|tiktok|engage|fxfix|fxreply|mkedit|ttfix|mklist|story|youtube)$/;
    if (gapKinds.test(job.kind)) { job.min = GAP_MIN; job.max = GAP_MAX; }
    if (job.kind === "grow" || job.relay) { job.pmin = GAP_MIN; job.pmax = GAP_MAX; }   // joins (grow's own min/max are member counts)
    if (job.kind === "renew") job.pause = GAP_MIN;
    return job;
  }

  // Per lane: if a step neither launched an add-on job nor moved on within 25 s (e.g. the add-on is too old for that
  // network), note it and go on with the rest of that lane.
  const wt = {};
  function watch(k, rest) {
    const lane = laneOf(k);
    unwatch(lane);
    const snap = JSON.stringify(rest || []);
    wt[lane] = setTimeout(() => {
      delete wt[lane];
      onSkip(k, "didn't start (add-on not ready?)");
      const r = JSON.parse(snap);
      if (r.length && F()) F().runStep(r, true); else onIdle(k);
    }, STALL);
  }
  function unwatch(lane) { if (lane == null) { Object.keys(wt).forEach(unwatch); return; } if (wt[lane]) { clearTimeout(wt[lane]); delete wt[lane]; } }
  window.addEventListener("pagehide", () => unwatch());

  // ---------------------------------------------------------------- admin lane: everything that doesn't touch a social network
  async function adminLane(id) {
    const tasks = [
      ["trends", "Trending hashtags", () => window.FAV_CAPTIONS && window.FAV_CAPTIONS.loadTrends && window.FAV_CAPTIONS.loadTrends(true)],
      ["leads", "Leads refresh", () => window.FAV_LEADS && window.FAV_LEADS.refresh()],
      ["sales", "Sales refresh", () => window.FAV_SALES && window.FAV_SALES.refresh()],
      ["seo", "SEO check", () => window.FAV_SEO && window.FAV_SEO.runNow()],
      ["ads", "Box ads / ad models rebuild", () => A().gh && A().gh("/actions/workflows/rebuild-ads.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) })],
      ["prospects", "Bulk buyers refresh", () => window.FAV_PROSPECTS && window.FAV_PROSPECTS.load(true)],
      ["profilekit", "Profile kit refresh", () => window.FAV_PROFILEKIT && window.FAV_PROFILEKIT.load(true)],
      ["aifix", "🤖 AI Fix (open items)", () => window.FAV_OPENITEMS && window.FAV_OPENITEMS.fixAll({ auto: true, from: "prime" })]
    ];
    ls.set(LK("admin"), { lane: "admin", run: id, status: "running", t0: Date.now(), steps: tasks.map(([k, label]) => ({ k, label, st: "run", t: Date.now() })) });
    paint();
    const limit = (p, ms) => Promise.race([Promise.resolve().then(p), new Promise((_, rej) => setTimeout(() => rej(new Error("took over " + ms / 1000 + " s")), ms))]);
    await Promise.all(tasks.map(async ([k, , fn]) => {
      let st = "ok", why = "";
      try { const r = await limit(fn, 90000); if (r && r.error) { st = "fail"; why = String(r.error); } }
      catch (e) { st = "fail"; why = String((e && e.message) || e).slice(0, 120); }
      setL("admin", l => { const s = l.steps.find(x => x.k === k); s.st = st; s.why = why; s.t1 = Date.now(); });
    }));
    setL("admin", l => { l.status = "done"; l.t1 = Date.now(); });
  }

  // ---------------------------------------------------------------- start
  async function start(opts) {
    opts = opts || {};
    const AP = window.FAV_AIPLAN;
    if (AP && AP.paused && AP.paused()) return toast("Paused in 🧭 AI Plan. Press Resume all there first.", true);
    if (AP && AP.load) await AP.load().catch(() => null);
    if (AP && AP.decide) {
      const d = AP.decide("prime");
      if (d.v === "skip") return toast(`⚡ Prime is off: ${d.why}. Approve rule M8 in 🧭 AI Plan.`, true);
    }
    if (AP && AP.gate && !AP.gate("prime", "prime-" + new Date().toISOString().slice(0, 13))) return;
    const f = F();
    if (!f) return toast("The Social autopilot isn't loaded yet.", true);
    if (!opts.inline && f.open) await f.open().catch(() => null);   // loads every autopilot log first
    if (!opts.inline) show();
    const id = Date.now().toString(36), lanes = plan();
    const names = Object.keys(lanes).filter(l => lanes[l].length);
    const est = Object.fromEntries(names.map(l => [l, lanes[l].reduce((s, k) => s + estimate(k), 0)]));
    ls.set(RUN, { id, at: Date.now(), lanes: names, est, mode: opts.inline ? "inline" : "tabs" });
    names.forEach(l => ls.set(LK(l), { lane: l, run: id, status: "waiting", t0: Date.now(), steps: lanes[l].map(k => ({ k, st: "wait" })) }));
    Object.keys(LANES).filter(l => !names.includes(l) && l !== "admin").forEach(l => { try { localStorage.removeItem(LK(l)); } catch (e) { /* */ } });
    tickStart();
    adminLane(id);
    const hasExt = !!document.documentElement.dataset.favautoExt;
    if (!hasExt) {
      names.forEach(l => setL(l, x => { x.status = "stopped"; x.stopped = "The FA Vision add-on isn't installed in this browser, so nothing was posted."; x.steps.forEach(s => { s.st = "skip"; s.why = "needs the add-on"; }); }));
      return;
    }
    if (opts.inline) { names.forEach(l => f.runStep(lanes[l].slice(), true)); return; }   // tests: every lane in this tab
    const url = l => location.origin + location.pathname + "#prime-lane=" + l + "&run=" + id;
    if (document.documentElement.dataset.favautoLanes) names.forEach(l => window.postMessage({ type: "favauto-lane", id, url: url(l) }, location.origin));
    else {
      // Older add-on: one extra tab runs the lanes one after another (the browser allows one pop-up per click).
      ls.set(RUN, Object.assign(run(), { serial: names }));
      const w = window.open(url("all"), "_blank");
      if (!w) toast("Allow pop-ups for the admin (or update the add-on to 5.5) so Prime can open its tab.", true);
      toast("Update the add-on to 5.5 (edge://extensions → ↻ Reload) so the networks run side by side. This run goes one network after another.");
    }
  }
  // A lane tab (or the serial "all" tab) starting up.
  async function laneBoot() {
    const m = location.hash.match(/^#prime-lane=([a-z]+)&run=(\w+)/);
    if (!m) return;
    ss.set("fa-prime-lane", m[1]);
    history.replaceState(null, "", location.pathname + "#fbauto");
    for (let i = 0; i < 120 && !(F() && A().signedIn && A().signedIn() && A().products && A().products().length); i++) await new Promise(r => setTimeout(r, 500));
    const r = run(); if (!r || r.id !== m[2] || !F()) return;
    await F().open().catch(() => null);
    const lanes = m[1] === "all" ? (r.serial || r.lanes) : [m[1]];
    const steps = lanes.flatMap(l => (L(l) || { steps: [] }).steps.filter(s => s.st === "wait").map(s => s.k));
    if (steps.length) F().runStep(steps, true); else onIdle(m[1]);
  }

  // ---------------------------------------------------------------- panel
  let timer = null;
  function tickStart() { if (!timer) timer = setInterval(paint, 1000); }
  function summary() {
    const r = ls.get(RUN, null);
    if (!r || Date.now() - r.at > 12 * 36e5) return null;
    const lanes = ["admin"].concat(r.lanes || []).map(l => L(l)).filter(Boolean);
    const all = lanes.flatMap(l => l.steps);
    return { r, lanes, done: lanes.filter(l => l.status === "done").length, stopped: lanes.filter(l => l.status === "stopped"), running: lanes.filter(l => !/^(done|stopped)$/.test(l.status)),
      posted: all.reduce((s, x) => s + (x.n || 0), 0), left: Math.max(0, TARGET - (Date.now() - r.at)), ok: all.filter(x => x.st === "ok").length, total: all.length };
  }
  const ICON = { wait: "⏳", run: "▶️", ok: "✅", skip: "⏭", fail: "⛔" };
  const NAME = k => ({ renew: "Renew Marketplace listings", post: "Facebook group posts", mkscan: "Marketplace scan", mklist: "List missing products on Marketplace", declines: "Groups that declined posts", sync: "Import groups", grow: "Join new big groups",
    "story:fb": "Facebook story", ig: "Instagram posts", x: "X posts", tiktok: "TikTok posts", sounds: "Trending sounds", "ttcaps:all": "TikTok captions fix", "yt:all": "Videos to YouTube", "prime:relay": "Profile relay", report: "Email the report" }[k]
    || k.replace(/^fx:scan:(\w+)/, "Fix all: scan $1").replace(/^fx:fix:(\w+)/, "Fix all: fix $1").replace(/^profile:(\w+):check/, "Profile check $1").replace(/^engage:(\w+):(\w+)/, "Engagement $1: $2").replace(/^reel:(\w+)/, "Reel on $1"));
  function panelHtml() {
    const s = summary();
    if (!s) return `<p class="muted fa-small">Nothing running. Press ⚡ PRIME to post everything due now and run every check at once.</p>`;
    const mm = Math.floor(s.left / 60e3), sec = Math.floor(s.left / 1000) % 60;
    const finished = !s.running.length;
    const head = finished ? `<b>Finished</b> in ${Math.round(((Math.max(...s.lanes.map(l => l.t1 || l.u || 0)) || Date.now()) - s.r.at) / 1000)} s` : s.left ? `<b class="pr-clock">${mm}:${String(sec).padStart(2, "0")}</b> left of 6:00` : `<b>6:00 reached</b>: the rest carries on in the background at the safe pace`;
    return `<div class="pr-head">${head} · ${s.posted} posts/comments/fixes done · ${s.done} of ${s.lanes.length} lanes done${s.stopped.length ? ` · <span class="pr-bad">${s.stopped.length} stopped</span>` : ""}</div>
      <div class="pr-lanes">${s.lanes.map(l => `<div class="pr-lane ${l.status}"><div class="pr-lt">${esc(LANES[l.lane] || l.lane)} <small>${esc(l.status === "done" ? "done ✓" : l.status === "stopped" ? "stopped" : l.status === "waiting" ? "starting…" : "running")}</small></div>
        ${l.stopped ? `<div class="pr-bad fa-small">⛔ ${esc(l.stopped)}</div>` : ""}
        <ul>${l.steps.map(x => `<li class="st-${x.st}"><span>${ICON[x.st] || ""} ${esc(x.label || NAME(x.k))}</span><small>${x.of ? `${x.n || 0}/${x.of}` : ""}${x.why ? " · " + esc(String(x.why).slice(0, 80)) : ""}</small></li>`).join("")}</ul></div>`).join("")}</div>
      ${!s.left || finished ? `<div class="pr-sum"><b>Summary.</b> Done: ${s.lanes.filter(l => l.status === "done").map(l => esc(LANES[l.lane])).join(", ") || "none"}. ${s.running.length ? `Still running in the background: ${s.running.map(l => esc(LANES[l.lane])).join(", ")}. ` : ""}${s.stopped.length ? `Stopped: ${s.stopped.map(l => `${esc(LANES[l.lane])} (${esc(l.stopped)})`).join("; ")}.` : ""}</div>` : ""}`;
  }
  function paint() {
    document.querySelectorAll("[data-prime-panel]").forEach(el => { el.innerHTML = panelHtml(); });
    const s = summary();
    if (s && !s.running.length && timer && Date.now() - (s.r.at || 0) > 2000) {
      clearInterval(timer); timer = null; finishRun(s);
      const r = ls.get(RUN, null); if (r && r.id === s.r.id && !r.over) { r.over = Date.now(); ls.set(RUN, r); }   // fast mode ends with the last lane
    }
  }
  let reported = "";
  function finishRun(s) {
    if (reported === s.r.id || ss.get("fa-prime-lane") || s.r.mode === "inline") return;
    reported = s.r.id;
    // One report email at the end (the relay sends its own when it ran).
    const fbl = L("fb");
    if (F() && !(fbl && fbl.steps.some(x => x.k === "prime:relay" && x.st === "ok"))) F().runStep(["report"], true);
  }
  function button() {
    return `<section class="fa-card prime-card"><button class="btn btn-sell prime-btn" type="button" data-prime-go>⚡ PRIME · run everything now</button>
      <p class="muted fa-small">Posts everything due and runs every check, all networks side by side, in about 6 minutes. Keeps 8–12 s between two posts on the same account and stops a network on any warning.</p>
      <div data-prime-panel>${panelHtml()}</div></section>`;
  }

  let screen = $("#screen-prime");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-prime"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>⚡ Prime</h1><p class="muted">Every tab and feature in one press: Facebook, Marketplace, Instagram, X, TikTok and YouTube run side by side while the website work (trends, leads, sales, SEO, ads, AI Fix) runs here.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button><button class="btn btn-ghost btn-sm" data-fbauto>Social autopilot</button></div></div><div id="pr-body"></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `.prime-btn{font-size:20px;font-weight:800;padding:16px 22px;width:100%;letter-spacing:.02em}.prime-card{margin-bottom:14px}
.pr-head{margin:10px 0;font-size:15px}.pr-clock{font-size:22px;font-variant-numeric:tabular-nums;color:#0d55af}.pr-bad{color:#d32f2f}
.pr-lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:10px}
.pr-lane{border:1px solid #e3e7ee;border-radius:10px;padding:8px 10px;background:#fff;min-width:0}.pr-lane.done{border-color:#1f9d55}.pr-lane.stopped{border-color:#d32f2f}
.pr-lt{font-weight:700;display:flex;justify-content:space-between;gap:6px}.pr-lane ul{list-style:none;margin:6px 0 0;padding:0;font-size:13px}
.pr-lane li{display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid #f1f3f6}.pr-lane li span{min-width:0;overflow-wrap:anywhere}.pr-lane li small{color:#5f6368;white-space:nowrap}
.pr-lane li.st-skip{opacity:.6}.pr-lane li.st-fail span{color:#d32f2f}.pr-sum{margin-top:10px;background:#f6f8fc;border-radius:8px;padding:10px;font-size:14px}
#prime-dash{margin:0 0 14px}`;
    document.head.appendChild(st);
  }
  // Big button on top of the dashboard.
  const dash = $("#screen-dash .dash-head");
  if (dash && !$("#prime-dash")) dash.insertAdjacentHTML("afterend", `<div id="prime-dash">${button()}</div>`);
  function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#prime") history.replaceState(null, "", "#prime");
    $("#pr-body").innerHTML = button();
    if (run()) tickStart();
  }
  document.addEventListener("click", e => {
    if (e.target.closest("[data-prime-go]")) { e.preventDefault(); start(); return; }
    if (e.target.closest("[data-prime]")) { e.preventDefault(); show(); }
  });
  window.addEventListener("storage", e => { if (e.key && e.key.startsWith("fa-prime")) { paint(); if (run()) tickStart(); } });
  if (location.hash === "#prime") { const w = setInterval(() => { if (A().signedIn && A().signedIn()) { clearInterval(w); show(); } }, 300); setTimeout(() => clearInterval(w), 30000); }
  laneBoot();
  if (run()) tickStart();

  window.FAV_PRIME = { start, show, fast, tune, gap, onStep, onSkip, onResult, onIdle, step: primeStep, button, plan, estimate, laneOf, summary,
    _test: { L, run, reset: () => { try { Object.keys(localStorage).filter(k => k.startsWith("fa-prime")).forEach(k => localStorage.removeItem(k)); } catch (e) { /* */ } } } };

  // runStep keys "prime:…": prime:relay = start the Profile relay (its own steps; it ends with the report email).
  function primeStep(k, then) {
    if (k === "prime:relay" && window.FAV_RELAY && window.FAV_RELAY.begin) {
      setL("fb", l => { const s = l.steps.find(x => x.k === k); if (s) s.why = "runs on in its own steps (joins, then each Page posts)"; });
      onIdle(k); return window.FAV_RELAY.begin(false);
    }
    if (then && then.length && F()) F().runStep(then, true); else onIdle(k);
  }
})();
