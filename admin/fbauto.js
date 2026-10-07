// Social autopilot: one screen, three tabs.
//   Today     – one button runs everything due today, in order: Marketplace
//               renewals → Facebook group posts → Instagram posts (admin/igauto.js)
//               → emails the day's posting report (backend action posting_report).
//   Facebook  – Marketplace renewals and the daily group-posting rotation (below).
//   Instagram – admin/igauto.js.
//
// Facebook has no API for either job, so the FA Vision browser add-on does the
// clicking (extension/autopilot.js). This screen decides what to do, sends the
// add-on a queue, and saves what came back to data/facebook-autopilot.json.
//
// Group rotation: one listing per day, posted into up to `daily_limit` groups
// it has never been posted into (groups rested longest go first). The next day
// the next listing takes its turn. When a listing has been in every group, it
// starts a fresh round.
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const $ = s => document.querySelector(s);
  const FILE = "data/facebook-autopilot.json";
  const EMPTY = {
    settings: {
      daily_limit: 20, renew_after_days: 7, renew_batch: 20, pause_min_s: 60, pause_max_s: 180, auto_run: false, auto_time: "09:00",
      now_limit: 20,                            // "Post now": most group posts per session
      group_rest_hours: 6,                      // "Post now": skip groups posted in within this many hours
      cleanup_on: true,                         // find groups that decline our posts, leave them and drop them from the list
      grow_on: true, grow_daily: 20,
      grow_min_members: 10000,                 // Ghana/Accra groups qualify from this size…
      grow_min_global: 100000,                 // …any other group from this size (1M+ always qualifies)
      grow_keywords: ["buy and sell ghana", "accra buy and sell", "accra market", "ghana online market", "furniture ghana", "home decor ghana", "kasoa buy and sell", "furniture", "home decor", "interior design", "furniture for sale", "ghana business"]
    },
    groups: [], posts: [], resets: {}, today: null, renewals: {}, removed: [], joins: [], checks: {}
  };
  // Groups whose names say they aren't for selling furniture: never joined.
  const GROW_DENY = "dating|singles|married|crypto|forex|bitcoin|betting|lotto|pubg|gaming|game|sugar|hookup|loan|ponzi|pi ?network|army|police|church|prayer|politic|fans? of|fan club|nsfw|18\\+|news|rent|lands?\\b|houses?\\b|apartments?|rooms?\\b";
  const screen = $("#screen-fbauto");
  const today = () => new Date().toLocaleDateString("en-CA");
  const days = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 864e5);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const ext = () => document.documentElement.dataset.favautoExt;
  const IG = () => window.FAV_IGAUTO;
  const SOC = () => window.FAV_SOCAUTO;
  const VID = () => window.FAV_VIDAUTO;
  const ENG = () => window.FAV_ENGAGE;           // Engagement: comment on all posts + followers/likes (admin/engage.js + extension/engage.js)          // Videos & YouTube (admin/vidauto.js + extension/youtube.js)          // X and TikTok (admin/socauto.js + extension/social.js)
  const liveAddon = () => document.documentElement.dataset.favautoMode === "live";
  const REPORT_TO = "nanaotengdonkor1@gmail.com";
  let S = null, tab = "today";

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    s.settings = { ...EMPTY.settings, ...(s.settings || {}) };
    for (const k of ["groups", "posts", "removed", "joins"]) s[k] = s[k] || [];
    for (const k of ["resets", "renewals", "checks", "rounds"]) s[k] = s[k] || {};
    if (!Array.isArray(s.settings.grow_keywords) || !s.settings.grow_keywords.length) s.settings.grow_keywords = EMPTY.settings.grow_keywords.slice();
    return s;
  }
  async function load(force) {
    if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY));
    return S;
  }
  async function save(mutate, message) {
    S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY));
  }

  // ------------------------------------------------------------------ renewals
  // S.selling is what the add-on last read on Facebook's "Your listings" page:
  // { d: date checked, cards: [{ t, listed, status, none? }] }. Before the first
  // check we don't know the listing dates, so dueList() returns null.
  // `next` = the date Facebook will offer Renew again (read from its "Renew (N days)" menu item).
  // Facebook never changes "Listed on" after a renewal, so `next` decides when it's known.
  const sellable = c => !/sold|pending|out of stock/i.test(c.status || "");
  const isDue = c => sellable(c) && (c.next ? c.next <= today() : (c.listed && days(c.listed, today()) >= S.settings.renew_after_days)) && c.none !== today();
  function dueList() {
    if (!S.selling || !S.selling.cards) return null;
    return S.selling.cards.filter(isDue)
      .map(c => ({ ...c, age: c.listed ? days(c.listed, today()) : 0 }))
      .sort((a, b) => b.age - a.age);
  }
  const nextRenewal = () => (S.selling && S.selling.cards || []).filter(c => sellable(c) && c.next && c.next > today()).map(c => c.next).sort()[0];

  // ------------------------------------------------------------------ group rotation
  const postable = () => A.products()
    .filter(p => !p.placeholder && p.in_stock !== false && !p.seller && (p.images || []).length && p.price_ghs)
    .sort((a, b) => a.id.localeCompare(b.id));
  const activeGroups = () => S.groups.filter(g => g.active !== false);
  const attemptsToday = () => S.posts.filter(x => x.d === today() && !x.now).length;   // daily plan only; "Post now" has its own limit

  // ------------------------------------------------------------------ clean-up (groups that decline us) and growth (new big groups)
  const joinsToday = () => S.joins.filter(j => j.d === today() && j.status !== "failed").length;
  const pendingGroups = () => S.groups.filter(g => g.pending);
  const cleanupWaiting = () => S.settings.cleanup_on && S.groups.length > 0 && S.checks.declines !== today();
  const syncWaiting = () => pendingGroups().length > 0 && S.checks.sync !== today();
  const growWaiting = () => S.settings.grow_on && joinsToday() < S.settings.grow_daily && S.checks.grow !== today();
  const membersText = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n || "?");

  function todaysListing() {
    const list = postable();
    if (!list.length) return null;
    if (S.today && S.today.d === today()) {
      const p = list.find(x => x.id === S.today.p);
      if (p) return p;
    }
    if (!S.today) return list[0];
    const next = list.find(x => x.id > S.today.p);   // the listing after the last one that had a turn
    return next || list[0];
  }

  function coverage(p) {
    const since = S.resets[p.id] || "";
    const groups = activeGroups();
    const tried = new Set(S.posts.filter(x => x.p === p.id && (x.t || x.d) > since).map(x => x.g));
    const ids = new Set(groups.map(g => g.id));
    const done = [...tried].filter(g => ids.has(g)).length;
    return { done, total: groups.length, tried, fresh: groups.length > 0 && done >= groups.length };
  }

  function plan() {
    const p = todaysListing();
    if (!p) return { p: null, groups: [], room: 0 };
    const room = Math.max(0, S.settings.daily_limit - attemptsToday());
    const cov = coverage(p);
    const usedToday = new Set(S.posts.filter(x => x.d === today()).map(x => x.g));
    const lastUse = {};
    for (const x of S.posts) if (!lastUse[x.g] || (x.t || x.d) > lastUse[x.g]) lastUse[x.g] = x.t || x.d;
    const groups = activeGroups()
      .filter(g => !usedToday.has(g.id) && (cov.fresh || !cov.tried.has(g.id)))
      .sort((a, b) => (lastUse[a.id] || "").localeCompare(lastUse[b.id] || ""))
      .slice(0, room);
    return { p, groups, room, cov };
  }

  // ------------------------------------------------------------------ "Post now": any products, any time (alongside the daily plan)
  // The choice is kept in this browser so it survives the trips to Facebook and Instagram and back.
  const SEL_KEY = "fa-post-now";
  function selection() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(SEL_KEY)); } catch (e) { /* none saved */ }
    const ok = new Set(postable().map(p => p.id));
    v = Object.assign({ ids: [...ok], fb: true, ig: true, ig_n: 3, x: true, x_n: 2, tt: true, tt_n: 2 }, v || {});
    v.ids = (v.ids || []).filter(id => ok.has(id));
    return v;
  }
  function setSelection(v) { try { localStorage.setItem(SEL_KEY, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  const lastPostOf = id => S.posts.filter(x => x.p === id).map(x => x.t || x.d).sort().pop() || "";

  // Pairs the chosen products with groups for one session:
  //  - each group gets one product per session, so the products land in different groups;
  //  - a product only goes to groups it hasn't been in yet (when it has been in all, it starts a new round);
  //  - products posted least recently and groups rested longest go first;
  //  - groups posted in during the last `group_rest_hours` rest (fewer declines);
  //  - at most `now_limit` group posts per session.
  function planNow(ids) {
    ids = ids || selection().ids;
    const prods = postable().filter(p => ids.includes(p.id)).sort((a, b) => lastPostOf(a.id).localeCompare(lastPostOf(b.id)));
    const lastUse = {};
    for (const x of S.posts) { const t = x.t || x.d; if (!lastUse[x.g] || t > lastUse[x.g]) lastUse[x.g] = t; }
    const restMs = (Number(S.settings.group_rest_hours) || 0) * 36e5, now = Date.now();
    const all = activeGroups();
    const groups = all.filter(g => !lastUse[g.id] || now - Date.parse(lastUse[g.id]) >= restMs)
      .sort((a, b) => (lastUse[a.id] || "").localeCompare(lastUse[b.id] || ""));
    const cov = Object.fromEntries(prods.map(p => [p.id, coverage(p)]));
    const pairs = [], used = new Set(), cap = S.settings.now_limit;
    for (let more = true; more && pairs.length < cap;) {
      more = false;
      for (const p of prods) {
        if (pairs.length >= cap) break;
        const g = groups.find(x => !used.has(x.id) && (cov[p.id].fresh || !cov[p.id].tried.has(x.id)));
        if (g) { pairs.push({ p, g }); used.add(g.id); more = true; }
      }
    }
    return { pairs, prods, products: new Set(pairs.map(x => x.p.id)).size, groups: all.length, resting: all.length - groups.length, fresh: prods.filter(p => cov[p.id].fresh).map(p => p.id) };
  }

  // ------------------------------------------------------------------ captions (3 variants, rotated)
  function caption(p, v, net) {
    if (window.FAV_CAPTIONS) return window.FAV_CAPTIONS.write(p, { net: net || "fb" });   // fresh text every post, always with a call to action
    const B = A.business();
    const wa = C.localPhone(B.whatsapp);
    const url = A.productUrl(p);
    const price = C.formatPrice(p.price_ghs) + (p.negotiable ? " (negotiable)" : "");
    const hl = (p.highlights || []).slice(0, 3);
    const name = String(p.name).split(" — ")[0];
    const first = String(p.description || "").split("\n")[0];
    const tags = (B.hashtags || []).slice(0, 3).join(" ");
    const variants = [
      `🛋️ ${name} available now!\n${hl.map(h => "• " + h).join("\n")}\n💰 ${price}\n📍 Odorkor, Accra · delivery available\n📞 WhatsApp ${wa}\n👉 ${url}\n${tags}`,
      `NEW IN STOCK: ${name}\n\n${first}\n\nPrice: ${price}\nPay 50% now and the rest on delivery. MoMo, GhanaPay or card.\n\nWhatsApp ${wa} or see all the photos here: ${url}`,
      `Looking for a ${name.toLowerCase()}? We have it in stock at ${price}.\n${hl.map(h => "✔ " + h).join("\n")}\nShowroom: Tarazzo Road, Odorkor (opposite Pacific), Accra. Delivery across Accra and beyond.\nCall or WhatsApp ${wa} · ${url}`
    ];
    return variants[v % variants.length].replace(/\n{3,}/g, "\n\n").trim();
  }

  // Picture for a group post: the product photo or one of its ad designs (classic, tile, presence), at random.
  function postImg(p) {
    const ad = ((A.business().promos || {}).ads || []).find(a => a.product === p.id && !/-arrived$/.test(a.id));
    const pics = [p.images[0]].concat(ad ? [`assets/images/ads/${ad.id}.jpg`, `assets/images/ads/models/tile-${ad.id}.jpg`, `assets/images/ads/models/presence-${ad.id}.jpg`] : []);
    return location.origin + "/" + pics[Math.floor(Math.random() * pics.length)];
  }
  // ------------------------------------------------------------------ jobs for the add-on
  function launch(url, job) {
    job.id = Date.now().toString(36);
    // First comment under each Facebook group post (where are you seeing this from + like & follow).
    if (job.kind === "post" && Array.isArray(job.q) && window.FAV_CAPTIONS) job.q.forEach(x => { if (!x.comment) x.comment = window.FAV_CAPTIONS.comment("fb", "this post"); });
    job.back = location.origin + location.pathname;
    if (Number(ext()) >= 3) {
      job.navFor = 0;                                   // the add-on opens the first page itself
      window.postMessage({ type: "favauto-start", url, job }, location.origin);
      return;
    }
    location.href = url.replace(/#.*$/, "") + "#favauto=" + encodeURIComponent(JSON.stringify(job));
  }
  function needExt() {
    if (ext()) return false;
    A.toast("Install or update the FA Vision add-on first (steps at the bottom of this screen).", true);
    return true;
  }

  function startRenew(then) {
    if (needExt()) return;
    if (Number(ext()) < 3) return A.toast("Update the add-on first (steps at the bottom of this screen).", true);
    launch("https://www.facebook.com/marketplace/you/selling", {
      kind: "renew", batch: S.settings.renew_batch, pause: 120, after: S.settings.renew_after_days, then: then || null
    });
  }

  // Test: runs every step in the first queued group except tapping Post.
  function startTest() {
    if (needExt()) return;
    if (Number(ext()) < 3) return A.toast("Update the add-on first (steps at the bottom of this screen), then test.", true);
    const pl = plan();
    const g = (pl.groups[0] || activeGroups()[0]);
    if (!pl.p || !g) return A.toast("Nothing to test: needs a listing and at least one group switched on.", true);
    const p = pl.p, img = postImg(p);
    launch(g.url, { kind: "post", dry: true, q: [{ g: g.id, name: g.name, url: g.url, p: p.id, text: caption(p, 0), img }], min: 5, max: 5 });
  }

  async function startPosting(auto, then) {
    if (needExt()) return;
    const pl = plan();
    if (!activeGroups().length) return A.toast("Import your groups first.", true);
    if (!pl.p) return A.toast("No listing is ready to post (needs a price, a photo and to be in stock).", true);
    if (!pl.groups.length) return A.toast(pl.room ? "No new groups left for today's listing." : `Today's ${S.settings.daily_limit} group posts are done. Come back tomorrow.`);
    A.busy("Preparing today's posts…");
    try {
      const pid = pl.p.id, fresh = pl.cov.fresh, d = today();
      await save(s => {
        if (fresh) s.resets[pid] = new Date().toISOString();
        s.today = { d, p: pid };
        return s;
      }, `Autopilot: ${pid} is today's group listing`);
    } catch (err) { A.busy(null); return A.toast(A.friendly(err), true); }
    A.busy(null);
    await sendAlert("session");
    const p = pl.p, start = S.posts.filter(x => x.p === p.id).length;
    const img = postImg(p);
    const q = pl.groups.map((g, i) => ({ g: g.id, name: g.name, url: g.url, p: p.id, text: caption(p, start + i), img }));
    launch(q[0].url, { kind: "post", q, min: S.settings.pause_min_s, max: S.settings.pause_max_s, auto: !!auto, then: then || null });
  }

  // ------------------------------------------------------------------ Instagram, the one-button run and the report
  function startIg(opts, then) {
    if (needExt()) return;
    if (Number(ext()) < 4) return A.toast("Update the FA Vision add-on to post on Instagram (steps at the bottom of the Today tab).", true);
    const j = IG() && IG().job(opts);
    if (!j) return A.toast("Today's Instagram posts are done ✓");
    j.job.then = then || null;
    launch(j.url, j.job);
  }

  // What still needs doing today, in running order.
  function stepsToday() {
    const dl = dueList(), steps = [];
    if (dl === null || dl.length) steps.push("renew");
    if (cleanupWaiting()) steps.push("declines");
    if (syncWaiting()) steps.push("sync");
    if (growWaiting()) steps.push("grow");
    if (activeGroups().length && plan().groups.length) steps.push("post");
    if (IG() && IG().state() && IG().summary().waiting) steps.push("ig");
    for (const net of ["x", "tiktok"]) if (SOC() && SOC().state() && SOC().summary(net).waiting && liveAddon()) steps.push(net);
    return steps;
  }
  // Runs the first step; each step hands the rest of the list to the add-on, which
  // passes it back when it returns, and receive() carries on with it.
  function runStep(steps, auto) {
    steps = (steps || []).slice();
    while (steps.length) {
      const k = steps.shift();
      if (k === "renew") return startRenew(steps);
      if (k === "declines" && cleanupWaiting()) return startDeclines(steps);
      if (k === "sync" && syncWaiting()) return startImport(steps);
      if (k.startsWith("allgroups:")) return postAllGroups(k.slice(10), steps);
      if (k.startsWith("tt1:") && SOC() && SOC().state()) return startSoc("tiktok", { products: [k.slice(4)], limit: 1, full: true }, steps);
      if (k === "grow" && growWaiting()) return startGrow(steps);
      if (k === "post" && activeGroups().length && plan().groups.length) return startPosting(auto, steps);
      if (k === "ig" && IG() && IG().summary().waiting && Number(ext()) >= 4) return startIg({}, steps);
      if (k === "postnow" && activeGroups().length) return startPostNow(steps);
      if (k === "ignow" && IG() && Number(ext()) >= 4) { const sel = selection(); return startIg({ products: sel.ids, limit: sel.ig_n }, steps); }
      if ((k === "x" || k === "tiktok") && SOC() && SOC().summary(k).waiting && liveAddon()) return startSoc(k, {}, steps);
      if ((k === "xnow" || k === "ttnow") && SOC() && liveAddon()) { const sel = selection(), net = k === "xnow" ? "x" : "tiktok"; return startSoc(net, { products: sel.ids, limit: net === "x" ? sel.x_n : sel.tt_n }, steps); }
      if (k.startsWith("engage:") && ENG() && ENG().state()) return ENG().start(k.slice(7), steps);
      if (k === "report") return sendReport(true);
    }
  }
  function runAll(auto) {
    if (needExt()) return;
    if (Number(ext()) < 3) return A.toast("Update the add-on first (steps at the bottom of this screen).", true);
    const steps = stepsToday();
    if (!steps.length) return A.toast("Everything for today is done ✓");
    runStep(steps.concat("report"), auto);
  }

  // "Post now": posts the chosen products into different groups straight away.
  async function startPostNow(then) {
    if (needExt()) return;
    if (Number(ext()) < 3) return A.toast("Update the add-on first (steps at the bottom of the Today tab).", true);
    const pl = planNow();
    if (!activeGroups().length) return A.toast("Import your groups first (Facebook tab).", true);
    if (!pl.prods.length) return A.toast("Tick at least one product to post.", true);
    if (!pl.pairs.length) {
      A.toast(pl.resting ? `Every group was posted in during the last ${S.settings.group_rest_hours} hours. Try later, or lower "Rest between posts in a group" in the Facebook tab.` : "The ticked products have been in all your groups already. Join more groups or tick other products.", true);
      if (then && then.length) setTimeout(() => runStep(then, true), 1500);
      return;
    }
    if (pl.fresh.length) {
      A.busy("Preparing the posts…");
      try {
        const going = new Set(pl.pairs.map(x => x.p.id));
        await save(s => { for (const id of pl.fresh) if (going.has(id)) s.resets[id] = new Date().toISOString(); return s; }, "Autopilot: new round for products already in every group");
      } catch (err) { A.busy(null); return A.toast(A.friendly(err), true); }
      A.busy(null);
    }
    await sendAlert("session", pl);
    const used = {};
    const q = pl.pairs.map(({ p, g }) => {
      used[p.id] = (used[p.id] || 0) + 1;
      return { g: g.id, name: g.name, url: g.url, p: p.id, text: caption(p, S.posts.filter(x => x.p === p.id).length + used[p.id]), img: postImg(p) };
    });
    launch(q[0].url, { kind: "post", mode: "now", q, min: S.settings.pause_min_s, max: S.settings.pause_max_s, then: then || null });
  }
  // X / TikTok: the add-on's social.js does the posting (downloaded from the site, so it needs live mode).
  function startSoc(net, opts, then) {
    if (needExt()) return;
    const name = SOC().NETS[net];
    if (!liveAddon()) { A.toast(`${name} needs the add-on's automatic updates switched on (Today tab, top).`, true); if (then && then.length) setTimeout(() => runStep(then, true), 1500); return; }
    const j = SOC().job(net, opts || {});
    if (!j) { A.toast(opts && opts.products ? `None of the ticked products has a photo for ${name}.` : `Today's ${name} posts are done ✓`); if (then && then.length) setTimeout(() => runStep(then, true), 1500); return; }
    j.job.then = then || null;
    launch(j.url, j.job);
  }
  // One product → every active group, once, back to back (no pause between groups).
  // "Post to all groups": rounds per product. Each press first re-reads every group you're in
  // on Facebook (so newly joined groups count), then posts the product into each group it
  // hasn't been in yet this round, back to back. When it has been in all of them, the next
  // press starts a new round (count back to 0).
  function roundOf(pid) {
    const since = S.rounds[pid] || "9999";   // no round yet: nothing counted
    const ids = new Set(activeGroups().map(g => g.id));
    const done = new Set(S.posts.filter(x => x.p === pid && x.ok && (x.t || x.d) >= since && ids.has(x.g)).map(x => x.g));
    return { since, done, total: ids.size, left: activeGroups().filter(g => !done.has(g.id)) };
  }
  function startAllGroups(pid) {
    if (needExt()) return;
    if (Number(ext()) < 3) return A.toast("Update the add-on first (steps at the bottom of the Today tab).", true);
    if (!postable().some(x => x.id === pid)) return A.toast("That product can't be posted (it needs a price, a photo and to be in stock).", true);
    A.toast("Reading all your Facebook groups first, then posting…");
    startImport(["allgroups:" + pid, "tt1:" + pid, "report"]);   // Facebook groups, then the same product on TikTok
  }
  async function postAllGroups(pid, then) {
    const p = postable().find(x => x.id === pid);
    if (!p || !activeGroups().length) { A.toast(!p ? "That product can't be posted." : "No groups switched on (Facebook tab).", true); return runStep(then, true); }
    let r = roundOf(pid);
    if (!r.left.length) {   // every group done: start the count again
      try { await save(s => { s.rounds[pid] = new Date().toISOString(); return s; }, `Autopilot: new round of all groups for ${pid}`); } catch (err) { return A.toast(A.friendly(err), true); }
      r = roundOf(pid);
      A.toast(`${shortName(p)} has been in all your groups: starting a new round.`);
    } else if (!S.rounds[pid]) {
      try { await save(s => { s.rounds[pid] = new Date().toISOString(); return s; }, `Autopilot: first round of all groups for ${pid}`); } catch (err) { return A.toast(A.friendly(err), true); }
      r = roundOf(pid);
    }
    await sendAlert("session", { products: 1, pairs: r.left.map(g => ({ p, g })) });
    const start = S.posts.filter(x => x.p === p.id).length, img = postImg(p);
    const q = r.left.map((g, i) => ({ g: g.id, name: g.name, url: g.url, p: p.id, text: caption(p, start + i), img }));
    A.toast(`Posting ${shortName(p)} into ${q.length} group${q.length === 1 ? "" : "s"} (${r.done.size}/${r.total} done this round)…`);
    launch(q[0].url, { kind: "post", mode: "now", q, min: 2, max: 4, then: then || null });
  }
  function runNow() {
    if (needExt()) return;
    if (Number(ext()) < 3) return A.toast("Update the add-on first (steps at the bottom of the Today tab).", true);
    const sel = selection(), steps = [];
    if (!sel.ids.length) return A.toast("Tick at least one product to post.", true);
    if (sel.fb) steps.push("postnow");
    if (sel.ig && IG() && IG().state()) steps.push("ignow");
    if (sel.x && SOC() && SOC().state()) steps.push("xnow");
    if (sel.tt && SOC() && SOC().state()) steps.push("ttnow");
    if ((sel.x || sel.tt) && !liveAddon()) A.toast("X and TikTok need the add-on's automatic updates switched on (Today tab, top); they'll be skipped until then.", true);
    if (!steps.length) return A.toast("Tick at least one place to post (or use the share buttons below).", true);
    runStep(steps.concat("report"), false);
  }

  // Email the day's posting report (built and sent by the Apps Script backend).
  async function sendReport(afterRun) {
    const d = today(), week = new Date(Date.now() - 8 * 864e5).toLocaleDateString("en-CA");
    const igS = IG() && IG().state();
    const fb = {
      settings: S.settings,
      posts: S.posts.filter(x => x.d >= week),
      renewLog: (S.renewLog || []).filter(x => x.d >= week),
      runs: (S.runs || []).filter(x => x.d >= week),
      groups: S.groups.map(g => ({ id: g.id, name: g.name, active: g.active !== false, off_why: g.off_why || "" })),
      selling: S.selling ? { d: S.selling.d, n: S.selling.cards.length, due: (dueList() || []).length } : null
    };
    const ig = igS ? {
      settings: { account: igS.settings.account, daily_posts: igS.settings.daily_posts, on: igS.settings.on },
      posts: igS.posts.filter(x => x.d >= week).map(x => ({ ...x, label: (IG().pool().find(i => i.k === x.k) && IG().label(IG().pool().find(i => i.k === x.k))) || x.k })),
      profile: igS.profile.slice(-40), runs: igS.runs.filter(x => x.d >= week)
    } : null;
    const products = Object.fromEntries(A.products().map(p => [p.id, String(p.name).split(" — ")[0]]));
    A.busy("Emailing today's report…");
    try {
      const r = await A.backendSigned({ action: "posting_report", day: d, fb, ig, products });
      if (r.ok) A.toast(`${afterRun ? "All done for today. " : ""}Report emailed to ${r.to || REPORT_TO} ✓`);
      else if (r.error === "no_session") A.toast(`${afterRun ? "All done for today. " : ""}The report will be emailed tonight at 9 pm (sign in with email and password to get it straight away).`);
      else if (r.error === "bad request" || /unknown action/i.test(r.error || "")) A.toast("The backend can't send reports yet: paste the latest Code.gs into Apps Script, deploy, and run setup() once (backend/README.md).", true);
      else A.toast("Couldn't email the report: " + (r.error || "unknown error"), true);
    } catch (err) { A.toast("Couldn't reach the backend to email the report. It will still arrive tonight at 9 pm.", true); }
    finally { A.busy(null); }
  }

  function startImport(then) {
    if (needExt()) return;
    launch("https://www.facebook.com/groups/joins/?nav_source=tab", { kind: "import", then: then || null });
  }

  // Groups that decline our posts: read notifications, then each group we posted in over the
  // last 3 weeks (its "declined" page). The add-on leaves every group it finds. Groups removed
  // earlier but not yet left on Facebook are tried again (up to 3 times).
  function startDeclines(then) {
    if (needExt()) return;
    const since = new Date(Date.now() - 21 * 864e5).toLocaleDateString("en-CA");
    const recent = [...new Set(S.posts.filter(x => x.d >= since).map(x => x.g))];
    const names = Object.fromEntries(S.groups.map(g => [g.id, g.name]));
    const q = [{ type: "notif", url: "https://www.facebook.com/notifications" }];
    for (const id of recent.slice(-30)) {
      const g = S.groups.find(x => x.id === id);
      if (g) q.push({ type: "check", g: id, name: g.name, what: "declined", url: `https://www.facebook.com/groups/${id}/my_declined_content` });
    }
    const found = {};
    for (const r of S.removed.filter(r => !r.left && (r.tries || 0) < 3).slice(0, 10)) {
      found[r.id] = { g: r.id, name: r.name, why: r.why, left: false, retry: true };
      q.push({ type: "leave", g: r.id, name: r.name, url: `https://www.facebook.com/groups/${r.id}/` });
    }
    launch(q[0].url, { kind: "declines", q, names, found, keep: [], then: then || null });
  }

  // Join big groups: search Facebook with the growth keywords (a different starting keyword
  // each day) and join groups with at least grow_min_members members, up to grow_daily a day.
  function startGrow(then) {
    if (needExt()) return;
    const room = S.settings.grow_daily - joinsToday();
    if (room <= 0) return A.toast(`Today's ${S.settings.grow_daily} new groups are done ✓`);
    const kws = S.settings.grow_keywords;
    const shift = Math.floor(Date.now() / 864e5) % kws.length;
    const q = kws.slice(shift).concat(kws.slice(0, shift)).map(kw => ({ kw, url: `https://www.facebook.com/search/groups/?q=${encodeURIComponent(kw)}` }));
    const skip = [...new Set([...S.groups.map(g => g.id), ...S.removed.map(r => r.id), ...S.joins.map(j => j.g)])];
    launch(q[0].url, { kind: "grow", q, skip, limit: room, min: S.settings.grow_min_members, minGlobal: Math.max(S.settings.grow_min_global, S.settings.grow_min_members), deny: GROW_DENY, pmin: 40, pmax: 100, then: then || null });
  }

  // Alert before every posting session (email via the backend, plus the badge here).
  // kind "milestone" = the special alert when today's new groups reach grow_daily.
  async function sendAlert(kind, nowPlan) {
    const pl = plan(), d = today();
    const short = p => String(p.name).split(" — ")[0];
    const payload = {
      action: "session_alert", kind: kind || "session", day: d,
      listing: nowPlan ? `Post now: ${nowPlan.products} product${nowPlan.products === 1 ? "" : "s"}` : pl.p ? short(pl.p) : "",
      groups: nowPlan ? nowPlan.pairs.map(x => `${x.g.name} ← ${short(x.p)}`) : pl.groups.map(g => g.name),
      joins: S.joins.filter(j => j.d === d).map(j => ({ name: j.name, members: j.members, status: j.status, url: j.url || "" })),
      removed: S.removed.filter(r => r.d === d).map(r => ({ name: r.name, why: r.why, left: !!r.left })),
      totals: { active: activeGroups().length, pending: pendingGroups().length, removed: S.removed.length, joined_today: joinsToday(), target: S.settings.grow_daily }
    };
    try {
      const r = await A.backendSigned(payload);
      if (r.ok) return A.toast(kind === "milestone" ? `🎉 ${joinsToday()} new groups today. Alert emailed to ${r.to || REPORT_TO}.` : `Alert emailed to ${r.to || REPORT_TO}: posting session starting.`);
      if (/unknown action|bad request|name required/i.test(r.error || "")) return A.toast("Posting alerts need the latest Code.gs in Apps Script (backend/README.md). Posting carries on.", true);
    } catch (err) { /* never block posting because of the alert */ }
  }

  // ------------------------------------------------------------------ results coming back from the add-on
  const groupName = id => ((S.groups.find(g => g.id === id) || {}).name || id);
  async function receive(out) {
    const d = today();
    A.busy("Saving what the add-on did…");
    const runLog = (s, extra) => { s.runs = (s.runs || []).concat([{ d, t: new Date().toISOString(), kind: out.kind, ...extra, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-200); };
    try {
      if (out.kind === "engage" && ENG()) {
        const r = await ENG().receive(out);
        A.toast(r.text, r.bad);
        tab = "engage";
      } else if (out.kind === "youtube" && VID()) {
        const r = await VID().receive(out);
        A.toast(r.text, r.bad);
        tab = "videos";
        A.busy(null); render(); return;
      } else if ((out.kind === "x" || out.kind === "tiktok") && SOC()) {
        const r = await SOC().receive(out);
        A.toast(r.text, r.bad);
        if (out.dry) { A.busy(null); render(); return; }
      } else if (out.kind === "ig") {
        const r = await IG().receive(out);
        A.toast(r.text, r.bad);
      } else if (out.kind === "renew") {
        const ok = out.res.filter(r => r.ok).length;
        await save(s => {
          if (out.snapshot) {
            const cards = out.snapshot.map(c => ({ ...c }));
            for (const r of out.res) {
              const c = cards.find(x => x.t === r.t && x.listed === r.listed && !x._seen);
              if (!c) continue;
              c._seen = true;
              if (r.next) c.next = r.next;
              if (!r.ok && !r.next) c.none = d;
            }
            cards.forEach(c => delete c._seen);
            s.selling = { d, cards };
          }
          runLog(s, { tried: out.res.length, ok });
          s.renewLog = (s.renewLog || []).concat(out.res.map(r => ({ d, t: r.t, listed: r.listed, ok: r.ok, ...(r.why ? { why: r.why } : {}) }))).slice(-200);
          return s;
        }, `Autopilot: renewed ${ok} of ${out.res.length} Marketplace listings`);
        A.toast(`Renewed ${plural(ok, "listing")}${out.res.length - ok ? `, ${out.res.length - ok} not ready yet` : ""}.${out.stopped ? " Stopped: " + out.stopped : ""}`, !!out.stopped);
      } else if (out.kind === "post" && out.dry) {
        const r = out.res[0];
        A.busy(null);
        if (!r) A.toast("Test stopped before it reached a group." + (out.stopped ? " " + out.stopped : ""), true);
        else A.toast(r.ok ? `Test passed in ${groupName(r.g)}: ${r.why}. Nothing was posted.` : `Test failed in ${groupName(r.g)}: ${r.why}`, !r.ok || /didn't attach/.test(r.why));
        return;
      } else if (out.kind === "post") {
        const ok = out.res.filter(r => r.ok).length;
        await save(s => {
          runLog(s, { tried: out.res.length, ok });
          for (const r of out.res) s.posts.push({ d, t: r.t, p: r.p, g: r.g, ok: r.ok, ...(out.mode === "now" ? { now: true } : {}), ...(r.why ? { why: r.why } : {}) });
          // a group that failed 3 times in a row is switched off
          for (const r of out.res.filter(x => !x.ok)) {
            const last3 = s.posts.filter(x => x.g === r.g).slice(-3);
            if (last3.length === 3 && last3.every(x => !x.ok)) { const g = s.groups.find(x => x.id === r.g); if (g) { g.active = false; g.off_why = r.why; } }
          }
          return s;
        }, `Autopilot: posted in ${ok} of ${out.res.length} groups`);
        A.toast(`Posted in ${plural(ok, "group")}${out.res.length - ok ? `, ${out.res.length - ok} skipped` : ""}.${out.stopped ? " Stopped: " + out.stopped : ""}`, !!out.stopped);
      } else if (out.kind === "import") {
        const found = (out.groups || []).filter(g => g.id && g.name);
        let added = 0, accepted = 0;
        await save(s => {
          const gone = new Set(s.removed.map(r => r.id));
          for (const g of found) {
            if (gone.has(g.id)) continue;                // removed for declining our posts: never back on the list
            const have = s.groups.find(x => x.id === g.id);
            if (have) {
              have.name = g.name;
              if (have.pending) { delete have.pending; delete have.off_why; have.active = true; accepted++; }
            }
            else { s.groups.push({ id: g.id, name: g.name, url: g.url, active: true, added: d }); added++; }
          }
          if (found.length) s.checks.sync = d;
          return s;
        }, `Autopilot: imported ${found.length} Facebook groups`);
        A.toast(found.length ? `Found ${plural(found.length, "group")} (${added} new${accepted ? `, ${plural(accepted, "join request")} accepted` : ""}).` : "No groups found. Make sure you're logged in to Facebook and try again.", !found.length);
      } else if (out.kind === "declines") {
        const res = out.res || [];
        const fresh = res.filter(r => !r.retry);
        await save(s => {
          runLog(s, { found: fresh.length, left: res.filter(r => r.left).length });
          if (!out.stopped) s.checks.declines = d;
          for (const r of res) {
            const old = s.removed.find(x => x.id === r.g);
            if (old) { old.left = !!r.left; old.tries = (old.tries || 0) + 1; if (r.left) old.left_d = d; continue; }
            const g = s.groups.find(x => x.id === r.g);
            s.groups = s.groups.filter(x => x.id !== r.g);
            s.removed.push({ id: r.g, name: (g && g.name) || r.name, url: (g && g.url) || `https://www.facebook.com/groups/${r.g}/`, why: r.why, d, left: !!r.left, tries: 1, ...(r.left ? { left_d: d } : {}) });
          }
          return s;
        }, `Autopilot: ${fresh.length} groups declined our posts and were removed`);
        const notLeft = fresh.filter(r => !r.left).length;
        A.toast(fresh.length ? `${plural(fresh.length, "group")} declined our posts: removed from your list${notLeft ? `, ${notLeft} still to leave on Facebook (tried again next run)` : " and left on Facebook"} ✓` : `No group declined our posts ✓${out.stopped ? " Stopped: " + out.stopped : ""}`, !!out.stopped);
      } else if (out.kind === "grow") {
        const res = out.res || [];
        const before = joinsToday();
        await save(s => {
          runLog(s, { joined: res.filter(r => r.status === "joined").length, requested: res.filter(r => /pending|questions/.test(r.status)).length });
          s.checks.grow = d;
          for (const r of res) {
            s.joins.push({ d, t: r.t || new Date().toISOString(), g: r.g, name: r.name, members: r.members, status: r.status, url: r.url, ...(r.why ? { why: r.why } : {}) });
            if (r.status === "failed" || s.groups.some(x => x.id === r.g)) continue;
            const g = { id: r.g, name: r.name, url: r.url, added: d, members: r.members, source: "autopilot" };
            if (r.status === "joined") g.active = true;
            else Object.assign(g, { active: false, pending: true, off_why: r.status === "questions" ? "Join request needs answers: open the group on Facebook and answer its questions" : "Waiting for the group's admin to accept us" });
            s.groups.push(g);
          }
          s.joins = s.joins.slice(-1000);
          return s;
        }, `Autopilot: joined ${res.filter(r => r.status !== "failed").length} new Facebook groups`);
        const n = joinsToday();
        A.toast(`${plural(n, "new group")} today (${res.filter(r => r.status === "joined").length} joined now, ${res.filter(r => /pending|questions/.test(r.status)).length} waiting for approval).${res.length ? "" : ` No new groups big enough turned up: add search words or lower the sizes in Settings.`}${out.stopped ? " Stopped: " + out.stopped : ""}`, !!out.stopped);
        if (before < S.settings.grow_daily && n >= S.settings.grow_daily) await sendAlert("milestone");
      }
    } catch (err) {
      A.toast(A.friendly(err), true);
    } finally { A.busy(null); }
    render();
    updateBadge();
    // Carry on with the one-button run. A warning on one site doesn't stop the next one;
    // pressing Stop does (only the report is still sent).
    let then = Array.isArray(out.then) ? out.then : out.then === "post" ? ["post"] : [];
    if (out.stopped === "Stopped by you.") then = then.filter(k => k === "report");
    if (then.length) setTimeout(() => runStep(then, true), 1500);
  }

  // ------------------------------------------------------------------ rendering
  function renderFacebook() {
    const dl = dueList(), due = dl || [], pl = plan(), groups = S.groups;
    const sell = S.selling;
    const doneToday = attemptsToday(), limit = S.settings.daily_limit;
    const recent = S.posts.slice(-25).reverse();
    const gname = id => (S.groups.find(g => g.id === id) || {}).name || id;
    const pname = id => (A.products().find(p => p.id === id) || {}).name || id;
    const order = postable();
    const cur = pl.p ? order.findIndex(p => p.id === pl.p.id) : -1;
    const recentRenew = (S.renewLog || []).slice(-10).reverse();
    return `

      <section class="fa-card">
        <header><h2>Marketplace renewals</h2><span class="fa-big ${dl === null || due.length ? "hot" : ""}">${dl === null ? "?" : due.length}</span></header>
        <p class="muted">Renewing pushes a listing back to the top. Facebook offers it ${S.settings.renew_after_days} days after a listing was posted or last renewed. Make sure Facebook is on your personal profile (Pages can't use Marketplace).</p>
        ${sell ? `<p class="muted fa-small">Last checked ${esc(sell.d)}: ${plural(sell.cards.length, "listing")} on Your listings.</p>` : `<p class="fa-empty">Your listings haven't been checked yet. Tap the button to read them on Facebook and renew any that are due.</p>`}
        <div class="fa-actions">
          <button class="btn btn-sell" data-fa="renew">${dl === null ? "Check & renew now" : due.length ? `Renew all ${due.length} due (${S.settings.renew_batch} at a time)` : "Check again"}</button>
        </div>
        ${due.length ? `<details class="fa-more"><summary>See the ${plural(due.length, "listing")} due</summary><ul class="fa-list">${due.map(c => `<li><span>${esc(c.t)}</span><small>listed ${esc(c.listed || "?")}${c.next ? " · ready since " + esc(c.next) : ""}</small></li>`).join("")}</ul></details>` : dl ? `<p class="fa-empty">Nothing to renew right now.${nextRenewal() ? ` Next renewals are ready on ${esc(nextRenewal())}.` : ""}</p>` : ""}
        ${recentRenew.length ? `<details class="fa-more"><summary>Recent renewals</summary><ul class="fa-list">${recentRenew.map(r => `<li class="${r.ok ? "" : "bad"}"><span>${r.ok ? "✓" : "–"} ${esc(r.t)}</span><small>${esc(r.d)}${r.why ? " · " + esc(r.why) : ""}</small></li>`).join("")}</ul></details>` : ""}
      </section>

      <section class="fa-card">
        <header><h2>Group posting</h2><span class="fa-big ${pl.groups.length && groups.length ? "hot" : ""}">${doneToday}/${limit}</span></header>
        ${!groups.length ? `<p class="fa-empty">No groups yet. Tap <b>Import my groups from Facebook</b> below first.</p>` : pl.p ? `
          <div class="fa-today">
            <img src="../${esc(pl.p.images[0])}" alt="" width="64" height="48">
            <div><small>Today's listing</small><b>${esc(pl.p.name)}</b>
            <span class="muted">${pl.groups.length ? `${plural(pl.groups.length, "new group")} queued` : doneToday >= limit ? "Done for today ✓" : "No new groups left today"} · been in ${pl.cov.done} of ${pl.cov.total} groups${pl.cov.fresh ? " (starting a new round)" : ""}</span></div>
          </div>
          <div class="fa-actions"><button class="btn btn-sell" data-fa="post" ${pl.groups.length ? "" : "disabled"}>Start today's ${pl.groups.length || limit} group posts</button><button class="btn btn-ghost" data-fa="test">Test without posting</button></div>
          <p class="muted fa-small" ${pl.groups.length ? "" : "hidden"}>Runs by itself in a Facebook tab, ${S.settings.pause_min_s / 60}–${S.settings.pause_max_s / 60} minutes between groups (about ${Math.round(pl.groups.length * (S.settings.pause_min_s + S.settings.pause_max_s) / 120)} minutes). Keep that tab open and in front (Edge slows background tabs a lot). It stops at once if Facebook shows any warning.</p>
          <details class="fa-more"><summary>Rotation order (${order.length} listings, one a day)</summary><ol class="fa-list">${order.map((p, i) => { const c = coverage(p); return `<li class="${i === cur ? "now" : ""}"><span>${i === cur ? "▶ " : ""}${esc(p.name)}</span><small>${c.done}/${c.total} groups</small></li>`; }).join("")}</ol></details>`
        : `<p class="fa-empty">No listing is ready (each needs a price, a photo and to be in stock).</p>`}
      </section>

      <section class="fa-card">
        <header><h2>Your groups</h2><span class="fa-big">${activeGroups().length}</span></header>
        <div class="fa-actions">
          <button class="btn btn-primary" data-fa="import">Import my groups from Facebook</button>
        </div>
        ${groups.length ? `<details class="fa-more"><summary>Show all ${groups.length} groups</summary><ul class="fa-list fa-groups">${groups.map(g => `<li class="${g.active === false ? "off" : ""}">
          <label><input type="checkbox" data-fa-group="${esc(g.id)}" ${g.active === false ? "" : "checked"}> <a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.name)}</a></label>
          <small>${g.active === false && g.off_why ? esc("Off: " + g.off_why) : ""}</small></li>`).join("")}</ul></details>` : ""}
      </section>

      <section class="fa-card">
        <header><h2>New big groups</h2><span class="fa-big ${joinsToday() >= S.settings.grow_daily ? "" : "hot"}">${joinsToday()}/${S.settings.grow_daily}</span></header>
        <p class="muted">Every day the run searches Facebook and joins up to ${S.settings.grow_daily} groups that fit furniture selling, biggest first: any group with ${membersText(S.settings.grow_min_global)}+ members (1M+ always), and Ghana/Accra groups from ${membersText(S.settings.grow_min_members)}. You get an email before each posting session, and a special one the day ${S.settings.grow_daily} are added.${pendingGroups().length ? ` ${plural(pendingGroups().length, "join request")} waiting for group admins.` : ""}</p>
        <div class="fa-actions"><button class="btn btn-primary" data-fa="grow" ${S.settings.grow_on && joinsToday() < S.settings.grow_daily ? "" : "disabled"}>Find &amp; join groups now</button></div>
        ${S.joins.length ? `<details class="fa-more"><summary>Recently added (${S.joins.length})</summary><ul class="fa-list">${S.joins.slice(-30).reverse().map(j => `<li class="${j.status === "failed" ? "bad" : ""}"><span>${j.status === "joined" ? "✓" : j.status === "failed" ? "✗" : "…"} ${j.url ? `<a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.name)}</a>` : esc(j.name)}</span><small>${membersText(j.members)} members · ${esc(j.d)} · ${esc({ joined: "joined", pending: "waiting for admin", questions: "answer the group's questions", failed: j.why || "failed" }[j.status] || j.status)}</small></li>`).join("")}</ul></details>` : ""}
      </section>

      <section class="fa-card">
        <header><h2>Groups that declined us</h2><span class="fa-big">${S.removed.length}</span></header>
        <p class="muted">Before posting, the run checks your notifications and each group's declined posts. Any group that declines us is left on Facebook and taken off your list for good (it's never re-imported or re-joined).${S.checks.declines ? ` Last checked ${esc(S.checks.declines)}.` : ""}</p>
        <div class="fa-actions"><button class="btn btn-ghost" data-fa="declines">Check for declined posts now</button></div>
        ${S.removed.length ? `<details class="fa-more"><summary>Show the ${plural(S.removed.length, "removed group")}</summary><ul class="fa-list">${S.removed.slice().reverse().map(r => `<li class="${r.left ? "off" : "bad"}"><span><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a></span><small>${esc(r.d)} · ${esc(r.why)} · ${r.left ? "left on Facebook ✓" : (r.tries || 0) >= 3 ? "couldn't leave: open it and tap Joined → Leave group" : "leaving on the next run"}</small></li>`).join("")}</ul></details>` : ""}
      </section>

      <section class="fa-card">
        <header><h2>Settings</h2></header>
        <form class="fa-settings" id="fa-settings">
          <label>Group posts a day <input id="fa-daily" name="daily_limit" type="number" min="1" max="50" value="${limit}"></label>
          <label>Renew in batches of <input id="fa-batch" name="renew_batch" type="number" min="1" max="50" value="${S.settings.renew_batch}"></label>
          <label>Post now: most group posts a session <input name="now_limit" type="number" min="1" max="50" value="${S.settings.now_limit}"></label>
          <label>Rest between posts in a group (hours) <input name="group_rest_hours" type="number" min="0" max="72" value="${S.settings.group_rest_hours}"></label>
          <label class="fa-check"><input name="cleanup_on" type="checkbox" ${S.settings.cleanup_on ? "checked" : ""}> Leave and remove groups that decline our posts</label>
          <label class="fa-check"><input name="grow_on" type="checkbox" ${S.settings.grow_on ? "checked" : ""}> Join new big groups every day</label>
          <label>New groups a day <input name="grow_daily" type="number" min="1" max="30" value="${S.settings.grow_daily}"></label>
          <label>Smallest Ghana/Accra group (members) <input name="grow_min_members" type="number" min="1000" step="1000" value="${S.settings.grow_min_members}"></label>
          <label>Smallest other group (members) <input name="grow_min_global" type="number" min="1000" step="1000" value="${S.settings.grow_min_global}"></label>
          <label>Search words (comma separated) <input name="grow_keywords" type="text" value="${esc(S.settings.grow_keywords.join(", "))}"></label>
          <p class="muted fa-small">The daily run itself is switched on and off in the Today tab.</p>
          <button class="btn btn-ghost btn-sm" type="submit">Save settings</button>
        </form>
      </section>

      ${recent.length ? `<section class="fa-card"><header><h2>Recent group posts</h2></header><ul class="fa-list">${recent.map(x => `<li class="${x.ok ? "" : "bad"}"><span>${x.ok ? "✓" : "✗"} ${esc(gname(x.g))}</span><small>${esc(String(pname(x.p)).split(" — ")[0])} · ${esc(x.d)}${x.why ? " · " + esc(x.why) : ""}</small></li>`).join("")}</ul></section>` : ""}`;
  }

  // ------------------------------------------------------------------ Today tab: one button
  // ------------------------------------------------------------------ Post now tab
  const shortName = p => String(p.name).split(" — ")[0];
  function renderNow() {
    const sel = selection(), list = postable(), on = new Set(sel.ids), pl = planNow(sel.ids);
    const mins = Math.round(pl.pairs.length * (S.settings.pause_min_s + S.settings.pause_max_s) / 120) + (sel.ig ? sel.ig_n * 4 : 0) + (sel.x ? sel.x_n * 3 : 0) + (sel.tt ? sel.tt_n * 4 : 0);
    const fbLine = !activeGroups().length ? "no groups yet (import them in the Facebook tab)"
      : pl.pairs.length ? `${plural(pl.pairs.length, "post")}: ${plural(pl.products, "product")} into ${plural(pl.pairs.length, "different group")}`
      : !sel.ids.length ? "tick some products"
      : pl.resting ? `every group was posted in during the last ${S.settings.group_rest_hours} hours; try later`
      : "the ticked products are already in all your groups";
    const chosen = list.filter(p => on.has(p.id));
    return `
      <section class="fa-card">
        <header><h2>Post now</h2><span class="fa-big">${sel.ids.length}/${list.length}</span></header>
        <p class="muted">Tick any products and post them whenever you like. Each product goes into different groups (one product per group in a session) and never twice into the same group. This is separate from the daily plan in the Today tab, which keeps running as before.</p>
        <div class="fa-actions"><button class="btn btn-ghost btn-sm" data-now="all">Tick all ${list.length}</button><button class="btn btn-ghost btn-sm" data-now="none">Clear</button></div>
        <ul class="fa-list now-list">${list.map(p => { const c = coverage(p); return `<li><label><input type="checkbox" data-now-p="${esc(p.id)}" ${on.has(p.id) ? "checked" : ""}> <img src="../${esc(p.images[0])}" alt="" width="40" height="30" loading="lazy"> ${esc(shortName(p))}</label><span class="now-right"><small>${esc(C.formatPrice(p.price_ghs))} · in ${c.done}/${c.total} groups</small><button type="button" class="btn btn-sell btn-sm" data-all-groups="${esc(p.id)}" title="This round: in ${roundOf(p.id).done.size} of ${roundOf(p.id).total} groups">Post to all groups · ${roundOf(p.id).done.size}/${roundOf(p.id).total}</button></span></li>`; }).join("")}</ul>
        <p class="muted fa-small"><b>Post to all groups</b> first reads every group you are in on Facebook, then posts that product into each group it has not been in yet this round, with no waiting between groups (only a few seconds for each page to load). Then it posts the same product on TikTok with a full description (needs the add-on in auto-update mode). The count (e.g. 12/40) shows this round; when it reaches all your groups, the next press starts a new round from 0. Groups that declined you or that you switched off are skipped. Posting fast into many groups is what Facebook most often flags as spam, so use it for one product at a time.</p>
      </section>

      <section class="fa-card">
        <header><h2>Where to post</h2></header>
        <label class="fa-check now-opt"><input type="checkbox" data-now-opt="fb" ${sel.fb ? "checked" : ""}> <span><b>Facebook groups</b> · ${esc(fbLine)}</span></label>
        <label class="fa-check now-opt"><input type="checkbox" data-now-opt="ig" ${sel.ig ? "checked" : ""}> <span><b>Instagram</b> · up to <input type="number" min="1" max="10" data-now-ign value="${sel.ig_n}" class="now-num" aria-label="Instagram photos"> photos of the ticked products</span></label>
        <label class="fa-check now-opt"><input type="checkbox" data-now-opt="x" ${sel.x ? "checked" : ""}> <span><b>X (Twitter)</b> · up to <input type="number" min="1" max="10" data-now-n="x_n" value="${sel.x_n}" class="now-num" aria-label="X posts"> posts of the ticked products</span></label>
        <label class="fa-check now-opt"><input type="checkbox" data-now-opt="tt" ${sel.tt ? "checked" : ""}> <span><b>TikTok</b> · up to <input type="number" min="1" max="10" data-now-n="tt_n" value="${sel.tt_n}" class="now-num" aria-label="TikTok posts"> photo posts of the ticked products</span></label>
        ${(sel.x || sel.tt) && !liveAddon() ? `<p class="fa-small" style="color:var(--err)">X and TikTok need the add-on's automatic updates switched on (Today tab, top).</p>` : ""}
        <button class="btn btn-sell run-btn" data-now="go" ${sel.ids.length && (sel.fb || sel.ig || sel.x || sel.tt) ? "" : "disabled"}>Post now</button>
        <p class="muted fa-small">About ${Math.max(3, mins)} minutes, in this Edge tab. Keep it open and in front. You get the alert email as it starts and the report when it ends. It stops by itself if Facebook or Instagram shows a warning.</p>
        ${pl.pairs.length ? `<details class="fa-more"><summary>See which product goes to which group</summary><ul class="fa-list">${pl.pairs.map(x => `<li><span>${esc(x.g.name)}</span><small>${esc(shortName(x.p))}</small></li>`).join("")}</ul></details>` : ""}
      </section>

      <section class="fa-card">
        <header><h2>Other socials</h2></header>
        <p class="muted">One tap opens each with the caption ready. <b>Facebook Page:</b> choose "Share to a Page" in the window that opens (caption is copied, paste it). <b>TikTok:</b> the caption is copied and the photo saved; add both in TikTok Studio.</p>
        ${chosen.length ? `<ul class="fa-list">${chosen.map(p => `<li class="share-li"><span>${esc(shortName(p))}</span><span class="share-row">
          <button class="btn btn-ghost btn-sm" data-share="page" data-pid="${esc(p.id)}">Facebook Page</button>
          <button class="btn btn-ghost btn-sm" data-share="x" data-pid="${esc(p.id)}">X</button>
          <button class="btn btn-ghost btn-sm" data-share="wa" data-pid="${esc(p.id)}">WhatsApp</button>
          <button class="btn btn-ghost btn-sm" data-share="tt" data-pid="${esc(p.id)}">TikTok</button>
          <button class="btn btn-ghost btn-sm" data-share="copy" data-pid="${esc(p.id)}">Copy caption</button></span></li>`).join("")}</ul>` : `<p class="fa-empty">Tick products above to share them.</p>`}
      </section>`;
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok; }
  }
  async function share(kind, p) {
    const B = A.business(), page = location.origin + "/p/" + p.id + ".html";
    const text = caption(p, S.posts.filter(x => x.p === p.id).length, kind === "tt" ? "tiktok" : "share");
    const price = C.formatPrice(p.price_ghs) + (p.negotiable ? " (negotiable)" : "");
    if (kind === "x") return window.open("https://x.com/intent/post?text=" + encodeURIComponent(window.FAV_CAPTIONS ? window.FAV_CAPTIONS.write(p, { net: "x" }) : `🛋️ ${shortName(p)} in stock: ${price}. WhatsApp ${C.localPhone(B.whatsapp)} 👉 ${page}`.slice(0, 280)), "_blank", "noopener");
    if (kind === "wa") return window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
    await copyText(text);
    if (kind === "copy") return A.toast("Caption copied ✓");
    if (kind === "page") { window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(page), "_blank", "width=680,height=640"); return A.toast("Caption copied: choose “Share to a Page”, paste it, then Post."); }
    if (kind === "tt") {
      const a = document.createElement("a"); a.href = "../" + p.images[0]; a.download = p.id + ".jpg"; document.body.appendChild(a); a.click(); a.remove();
      window.open("https://www.tiktok.com/tiktokstudio/upload", "_blank", "noopener");
      return A.toast("Caption copied and photo saved: add them in TikTok Studio (Photos).");
    }
  }

  const TABS = [["today", "Today"], ["now", "Post now"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["social", "X & TikTok"], ["videos", "Videos & YouTube"], ["engage", "Engagement"]];
  function step(state, title, detail) {
    const icon = { done: "✓", wait: "•", off: "–", warn: "!" }[state];
    return `<li class="run-step ${state}"><span class="run-icon" aria-hidden="true">${icon}</span><div><b>${title}</b><small>${detail}</small></div></li>`;
  }
  function lastDays(n) {
    const out = [], igS = IG() && IG().state();
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.now() - i * 864e5).toLocaleDateString("en-CA");
      const prof = igS ? igS.profile.find(x => x.d === d) : null;
      out.push({
        d,
        renewed: (S.renewLog || []).filter(x => x.d === d && x.ok).length,
        groups: S.posts.filter(x => x.d === d && x.ok).length,
        groupsTried: S.posts.filter(x => x.d === d).length,
        ig: igS ? igS.posts.filter(x => x.d === d && x.ok).length : 0,
        followers: prof ? prof.followers : null
      });
    }
    return out;
  }
  function renderToday() {
    const dl = dueList(), pl = plan(), ig = IG() && IG().state() ? IG().summary() : null;
    const limit = S.settings.daily_limit, doneFb = attemptsToday();
    const steps = stepsToday();
    const mins = (steps.includes("renew") ? 5 : 0) + (steps.includes("post") ? Math.round(pl.groups.length * (S.settings.pause_min_s + S.settings.pause_max_s) / 120) : 0) + (steps.includes("ig") && ig ? ig.mins : 0) + ["x", "tiktok"].reduce((m, n) => m + (steps.includes(n) && SOC() ? SOC().summary(n).mins : 0), 0)
      + (steps.includes("declines") ? 5 : 0) + (steps.includes("sync") ? 3 : 0) + (steps.includes("grow") ? Math.round((S.settings.grow_daily - joinsToday()) * 1.3) + 5 : 0);
    const shortName = p => String(p.name).split(" — ")[0];
    const ds = document.documentElement.dataset;
    const extMsg = !ext() ? "The FA Vision add-on isn't installed in this Edge browser yet. Install it first (steps below)."
      : Number(ext()) < 5 ? "Your FA Vision add-on needs one last manual update (steps below). After that it updates itself from your website."
      : "";
    const updMsg = Number(ext()) >= 5 && ds.favautoMode === "bundled"
      ? `<div class="fa-upd bad"><p><b>Switch on automatic updates.</b> In Edge open <code>edge://extensions</code> and turn on <b>Developer mode</b> (left side of the page). Then click <b>Details</b> under FA Vision Autopilot and, if you see <b>Allow user scripts</b>, turn it on too. The add-on then fetches its latest version from your website by itself. Until then it uses the copy in its folder.</p><button class="btn btn-ghost btn-sm" data-fa="recheck">I've switched it on, check again</button></div>`
      : Number(ext()) >= 5 && ds.favautoMode === "live" ? `<p class="fa-ext ok">✓ The add-on updates itself from your website${ds.favautoVersion ? ` (version ${esc(ds.favautoVersion)})` : ""}. Nothing to download.</p>` : "";
    const days = lastDays(7);
    return `
      ${extMsg ? `<p class="fa-ext bad">✗ ${extMsg}</p>` : updMsg}
      <section class="fa-card run-card">
        <header><h2>Today's posting</h2><span class="muted fa-small">${esc(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }))}</span></header>
        <ol class="run-steps">
          ${dl === null ? step("wait", "Marketplace renewals", "Your listings haven't been checked yet. The run checks and renews them.")
            : dl.length ? step("wait", "Marketplace renewals", `${plural(dl.length, "listing")} due for renewal`)
            : step("done", "Marketplace renewals", `Nothing due${nextRenewal() ? ` · next on ${esc(nextRenewal())}` : ""}`)}
          ${!S.settings.cleanup_on ? step("off", "Declined-post clean-up", "Switched off (Facebook tab → Settings)")
            : cleanupWaiting() ? step("wait", "Declined-post clean-up", "Checks which groups declined our posts, leaves them and drops them from the list")
            : step("done", "Declined-post clean-up", `Checked today · ${plural(S.removed.length, "group")} removed so far`)}
          ${!S.settings.grow_on ? step("off", "New big groups", "Switched off (Facebook tab → Settings)")
            : growWaiting() ? step("wait", "New big groups", `Joins up to ${S.settings.grow_daily - joinsToday()} more groups (${membersText(S.settings.grow_min_global)}+, or ${membersText(S.settings.grow_min_members)}+ in Ghana) · ${joinsToday()}/${S.settings.grow_daily} today`)
            : step(joinsToday() >= S.settings.grow_daily ? "done" : "warn", "New big groups", `${joinsToday()}/${S.settings.grow_daily} added today${pendingGroups().length ? ` · ${pendingGroups().length} waiting for admins` : ""}`)}
          ${!activeGroups().length ? step("off", "Facebook groups", "No groups yet. Import them in the Facebook tab.")
            : pl.groups.length ? step("wait", "Facebook groups", `${plural(pl.groups.length, "group post")} waiting · ${esc(shortName(pl.p))}`)
            : step("done", "Facebook groups", `${doneFb}/${limit} posted today`)}
          ${!ig ? step("off", "Instagram", "Loading…") : !ig.on ? step("off", "Instagram", "Switched off (Instagram tab)")
            : ig.waiting ? step("wait", "Instagram", `${plural(ig.waiting, "photo")} waiting · ${ig.done}/${ig.target} posted today`)
            : step("done", "Instagram", `${ig.done}/${ig.target} posted today`)}
          ${step(steps.includes("post") ? "wait" : "done", "Alert before posting", `Email to ${esc(REPORT_TO)} just before the group posts start (and a special one when ${S.settings.grow_daily} new groups are added in a day)`)}
          ${["x", "tiktok"].map(net => { const sm = SOC() && SOC().state() ? SOC().summary(net) : null, name = net === "x" ? "X (Twitter)" : "TikTok";
            return !sm ? step("off", name, "Loading…") : !sm.on ? step("off", name, "Switched off (X & TikTok tab)") : !liveAddon() ? step("warn", name, "Needs the add-on's automatic updates switched on (top of this tab)")
              : sm.waiting ? step("wait", name, `${plural(sm.waiting, "photo")} waiting · ${sm.done}/${sm.target} posted today`) : step("done", name, `${sm.done}/${sm.target} posted today`); }).join("")}
          ${step(steps.length ? "wait" : "done", "Email report", `Breakdown sent to ${esc(REPORT_TO)} when the run ends (and every night at 9 pm)`)}
        </ol>
        ${steps.length ? `<button class="btn btn-sell run-btn" data-fa="run">Run everything for today</button>
          <p class="muted fa-small">About ${Math.max(5, mins)} minutes. It runs in this Edge tab, one site after the other. Keep the tab open and in front. It stops by itself if Facebook, Instagram, X or TikTok shows a warning.</p>`
        : `<p class="run-done">All done for today ✓</p>`}
        <div class="run-foot">
          <label class="fa-check"><input type="checkbox" data-fa-autorun ${S.settings.auto_run ? "checked" : ""}> Run by itself every day at <input type="time" data-fa-autotime value="${esc(S.settings.auto_time)}"></label>
          <button class="btn btn-ghost btn-sm" data-fa="report">Email today's report now</button>
        </div>
      </section>

      <section class="fa-card">
        <header><h2>Last 7 days</h2></header>
        <div class="run-table"><table>
          <thead><tr><th>Day</th><th>Renewed</th><th>Group posts</th><th>Instagram</th><th>Followers</th></tr></thead>
          <tbody>${days.map(x => `<tr><td>${esc(new Date(x.d + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }))}</td><td>${x.renewed}</td><td>${x.groups}${x.groupsTried > x.groups ? ` <small>of ${x.groupsTried}</small>` : ""}</td><td>${x.ig}</td><td>${x.followers != null ? x.followers.toLocaleString() : "–"}</td></tr>`).join("")}</tbody>
        </table></div>
      </section>

      <details class="fa-card fa-help"${ext() && Number(ext()) >= 5 ? "" : " open"}><summary><b>${ext() ? "Update" : "Install"} the FA Vision add-on (one time)</b></summary>
        <ol>
          <li>Download the <code>extension</code> folder from your GitHub repo (Code → Download ZIP, then unzip). Keep it somewhere it won't be deleted.</li>
          <li>In Edge open <code>edge://extensions</code> and turn on <b>Developer mode</b> (left side of the page). If an older FA Vision add-on is there, click <b>Remove</b> on it first.</li>
          <li>Click <b>Load unpacked</b> and pick the <code>extension</code> folder.</li>
          <li>Keep <b>Developer mode</b> on, and if <b>Details</b> under FA Vision Autopilot shows <b>Allow user scripts</b>, turn that on too. This is what lets it update itself.</li>
          <li>Show it in the toolbar (Extensions button → eye icon next to FA Vision Autopilot), and stay logged in to Facebook (personal profile) and Instagram (@favisionent) in this Edge.</li>
        </ol>
        <p class="muted fa-small">That's the last time. From version 5 the add-on downloads its latest posting scripts from your website every hour and before every run, so updates arrive by themselves.</p></details>`;
  }

  function render() {
    if (!S) return;
    const body = tab === "facebook" ? renderFacebook() : tab === "instagram" ? (IG() ? IG().renderTab() : "") : tab === "now" ? renderNow() : tab === "social" ? (SOC() ? SOC().renderTab() : "") : tab === "videos" ? (VID() ? VID().renderTab() : "") : tab === "engage" ? (ENG() ? ENG().renderTab() : "") : renderToday();
    $("#fa-body").innerHTML = `<nav class="fa-tabs" role="tablist">${TABS.map(([k, t]) => `<button type="button" role="tab" aria-selected="${tab === k}" data-fa-tab="${k}">${t}</button>`).join("")}</nav>` + body;
  }

  function updateBadge() {
    const b = $("#fa-badge"), alert = $("#fa-alert");
    if (!S) return;
    const dl = dueList(), due = dl ? dl.length : 0;
    const postsWaiting = activeGroups().length > 0 && plan().groups.length > 0;
    const igWaiting = !!(IG() && IG().state() && IG().summary().waiting) || (liveAddon() && !!SOC() && !!SOC().state() && ["x", "tiktok"].some(n => SOC().summary(n).waiting));
    const n = (dl === null ? 1 : due) + (postsWaiting ? 1 : 0) + (igWaiting ? 1 : 0);
    if (b) { b.hidden = !n; b.textContent = n; }
    if (alert) {
      const bits = [dl === null ? `<b>Your Marketplace listings haven't been checked for renewal yet.</b>` : due && `<b>${plural(due, "Marketplace listing")} ready to renew.</b>`, postsWaiting && `<b>Today's group posts haven't run yet.</b>`, igWaiting && `<b>Today's Instagram posts haven't run yet.</b>`,
        joinsToday() >= S.settings.grow_daily && `<b>🎉 ${joinsToday()} new big groups added today.</b>`,
        S.removed.filter(r => r.d === today()).length && `<b>${plural(S.removed.filter(r => r.d === today()).length, "group")} removed today for declining our posts.</b>`].filter(Boolean);
      alert.hidden = !bits.length;
      alert.innerHTML = bits.join(" ") + " Open Social autopilot and tap Run →";
    }
  }

  // ------------------------------------------------------------------ events
  screen.addEventListener("click", e => {
    const t = e.target.closest("[data-fa-tab]");
    if (t) { tab = t.dataset.faTab; render(); return; }
    const so = e.target.closest("[data-soc],[data-soc-test]");
    if (so) { if (so.dataset.soc) startSoc(so.dataset.soc, {}); else startSoc(so.dataset.socTest, { dry: true }); return; }
    const ib = e.target.closest("[data-ig]");
    if (ib) { if (ib.dataset.ig === "post") startIg({}); else startIg({ dry: true }); return; }
    const ag = e.target.closest("[data-all-groups]");
    if (ag) { e.preventDefault(); return startAllGroups(ag.dataset.allGroups); }
    const nb = e.target.closest("[data-now]");
    if (nb) {
      const sel = selection();
      if (nb.dataset.now === "go") return runNow();
      sel.ids = nb.dataset.now === "all" ? postable().map(p => p.id) : [];
      setSelection(sel); render(); return;
    }
    const sb = e.target.closest("[data-share]");
    if (sb) { const p = postable().find(x => x.id === sb.dataset.pid); if (p) share(sb.dataset.share, p); return; }
    const b = e.target.closest("[data-fa]");
    if (!b) return;
    const k = b.dataset.fa;
    if (k === "recheck") { window.postMessage({ type: "favauto-recheck" }, location.origin); A.toast("Checking the add-on…"); }
    else if (k === "run") runAll(false);
    else if (k === "report") sendReport(false);
    else if (k === "renew") startRenew();
    else if (k === "post") startPosting(false);
    else if (k === "test") startTest();
    else if (k === "import") startImport();
    else if (k === "declines") startDeclines();
    else if (k === "grow") startGrow();
  });
  async function saveAutoRun() {
    const on = !!(screen.querySelector("[data-fa-autorun]") || {}).checked;
    const time = (screen.querySelector("[data-fa-autotime]") || {}).value || "09:00";
    try {
      await save(s => { s.settings.auto_run = on; s.settings.auto_time = time; return s; }, "Autopilot: daily run " + (on ? "on at " + time : "off"));
      A.toast(on ? `Runs by itself every day at ${time} (Edge must be open on this computer).` : "Daily run switched off.");
    } catch (err) { A.toast(A.friendly(err), true); }
  }
  screen.addEventListener("change", async e => {
    if (e.target.closest("[data-fa-autorun],[data-fa-autotime]")) return saveAutoRun();
    if (e.target.closest("[data-now-p],[data-now-opt],[data-now-ign],[data-now-n]")) {
      const sel = selection(), el = e.target;
      if (el.dataset.nowP) sel.ids = el.checked ? [...new Set(sel.ids.concat(el.dataset.nowP))] : sel.ids.filter(id => id !== el.dataset.nowP);
      if (el.dataset.nowOpt) sel[el.dataset.nowOpt] = el.checked;
      if (el.hasAttribute("data-now-ign")) sel.ig_n = Math.min(10, Math.max(1, parseInt(el.value, 10) || 3));
      if (el.dataset.nowN) sel[el.dataset.nowN] = Math.min(10, Math.max(1, parseInt(el.value, 10) || 2));
      setSelection(sel);
      const y = window.scrollY; render(); window.scrollTo(0, y);
      return;
    }
    const c = e.target.closest("[data-fa-group]");
    if (!c) return;
    const id = c.dataset.faGroup, on = c.checked;
    try {
      await save(s => { const g = s.groups.find(x => x.id === id); if (g) { g.active = on; delete g.off_why; } return s; }, `Autopilot: group ${on ? "on" : "off"}`);
      A.toast(on ? "Group switched on" : "Group switched off");
      updateBadge();
    } catch (err) { A.toast(A.friendly(err), true); c.checked = !on; }
  });
  screen.addEventListener("submit", async e => {
    if (e.target.id === "soc-settings") {
      e.preventDefault();
      A.busy("Saving X and TikTok settings…");
      try { await SOC().saveSettings(e.target); A.toast("X and TikTok settings saved"); render(); updateBadge(); }
      catch (err) { A.toast(A.friendly(err), true); }
      finally { A.busy(null); }
      return;
    }
    if (e.target.id === "ig-settings") {
      e.preventDefault();
      A.busy("Saving Instagram settings…");
      try { await IG().saveSettings(e.target); A.toast("Instagram settings saved"); render(); updateBadge(); }
      catch (err) { A.toast(A.friendly(err), true); }
      finally { A.busy(null); }
      return;
    }
    if (e.target.id !== "fa-settings") return;
    e.preventDefault();
    const f = e.target.elements;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || lo));
    const next = {
      daily_limit: clamp(f.daily_limit.value, 1, 50), renew_batch: clamp(f.renew_batch.value, 1, 50),
      now_limit: clamp(f.now_limit.value, 1, 50), group_rest_hours: clamp(f.group_rest_hours.value, 0, 72),
      cleanup_on: f.cleanup_on.checked, grow_on: f.grow_on.checked,
      grow_daily: clamp(f.grow_daily.value, 1, 30), grow_min_members: clamp(f.grow_min_members.value, 1000, 1e9), grow_min_global: clamp(f.grow_min_global.value, 1000, 1e9),
      grow_keywords: f.grow_keywords.value.split(",").map(x => x.trim()).filter(Boolean).slice(0, 30)
    };
    if (!next.grow_keywords.length) next.grow_keywords = EMPTY.settings.grow_keywords.slice();
    A.busy("Saving settings…");
    try { await save(s => { Object.assign(s.settings, next); return s; }, "Autopilot: settings"); A.toast("Settings saved"); render(); updateBadge(); }
    catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); }
  });

  async function open() {
    if (!A.signedIn()) return A.show("login");
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    $("#top-actions").hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#fbauto") history.replaceState(null, "", "#fbauto");
    if (!S || (IG() && !IG().state()) || (SOC() && !SOC().state()) || (VID() && !VID().state()) || (ENG() && !ENG().state())) { $("#fa-body").innerHTML = `<p class="muted">Loading…</p>`; await Promise.all([load(), IG() ? IG().load() : null, SOC() ? SOC().load() : null, VID() ? VID().load().catch(() => null) : null, ENG() ? ENG().load().catch(() => null) : null]).catch(err => A.toast(A.friendly(err), true)); }
    render();
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-fbauto]");
    if (!b) return;
    e.preventDefault();
    open();
  });

  // ------------------------------------------------------------------ start-up: badge, results and the daily run
  const hash = location.hash;
  const wait = setInterval(async () => {
    if (!A.signedIn() || !A.products().length) return;
    clearInterval(wait);
    try { await Promise.all([load(), IG() ? IG().load() : null, SOC() ? SOC().load() : null, VID() ? VID().load().catch(() => null) : null, ENG() ? ENG().load().catch(() => null) : null]); } catch (err) { return; }
    updateBadge();
    const m = hash.match(/^#favauto-done=(.+)$/);
    if (m) {
      let out = null;
      try { out = JSON.parse(decodeURIComponent(m[1])); } catch (e) { /* ignore */ }
      await open();
      if (out) await receive(out);
    } else if (hash === "#fbauto") {
      open();
    } else if (hash === "#fbauto-run") {
      await open();
      if (!S.settings.auto_run) return;
      if (!stepsToday().length) return A.toast("Daily run: nothing to do today ✓");
      A.toast("Daily run starts in 15 seconds…");
      setTimeout(() => runAll(true), 15000);
    }
  }, 300);
  setTimeout(() => clearInterval(wait), 60000);

  window.addEventListener("message", e => {
    if (e.source === window && e.data && e.data.type === "favauto-status" && S && !screen.hidden) {
      render();
      if (e.data.status.mode === "live" && e.data.status.userScripts) return;
    }
    if (e.source === window && e.data && e.data.type === "favauto-start-failed") A.toast("The add-on couldn't start the run. Reload the add-on in edge://extensions and try again.", true);
  });
  window.FAV_FBAUTO = { open, launch, needExt, liveAddon, render: () => { if (!screen.hidden || tab === "videos" || tab === "engage") render(); }, _test: { set: s => { S = normalise(s); }, dueList, plan, caption, receive, state: () => S, stepsToday, runStep, setTab: t => { tab = t; render(); } } };
})();
