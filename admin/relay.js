// Profile relay (Social autopilot → Facebook tab, card on top; log in data/facebook-autopilot.json `relay`).
// Alexander: "all the profiles take turns and join 40 groups in Facebook. After joining … student desk and
// chair postings to 40 groups are done for fa vision enterprise, fa vision furnitures, oteng furniture then
// do agoodman ventures postings of its items as well".
//
// Phase 1 · Join (runStep "relay:join"): the ticked profiles / Pages take turns, one join each (add-on job
//   "grow" with relay:true in extension/autopilot.js), biggest fitting groups first (the same size tiers,
//   search words and blocked words as "New big groups"), human-like 40–100 s gaps, until `join_target`
//   groups are JOINED (requests waiting for a group admin don't count until the next import accepts them).
//   A profile Facebook limits is dropped for the day; a security check stops the whole run. Membership
//   questions are answered from that profile's brand (FAV_BRANDS.qa); anything private → "needs a manual
//   answer". Batches of 10 joins, each saved here, then the next batch carries on by itself.
// Phase 2 · Post (after the target, or "Skip to posting"): for each ticked brand in order, first read the
//   groups THAT Page is in ("relay:import:<i>", job import with `as`), then post its product(s) into up to
//   `groups_per_brand` of them ("relay:post:<i>"), acting as that Page (it.as), different groups for each
//   brand where possible (else the least recently posted), never a group that declined us. Each post gets a
//   fresh caption (FAV_CAPTIONS.write with the brand's own name/contacts, hashtags and call to action; the FA
//   Vision family sign-off), the brand's stamped picture (admin/brandstamp.js) and the quality gate.
//   Brands without a Facebook Page in 🏷 Brands are skipped with a notice (never posted as F.A Vision).
// Emails: the session alert before each phase starts; a finish summary (session_alert kind "relay_done").
(function () {
  "use strict";
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const F = () => window.FAV_FBAUTO;
  const BR = () => window.FAV_BRANDS;
  const today = () => new Date().toLocaleDateString("en-CA");
  const SIGNOFF = "Follow for more room ideas · Design yours free: favisionenterprize.github.io/studio";
  const DEFAULTS = {
    join_target: 40, groups_per_brand: 40, batch: 10, pmin: 40, pmax: 100,
    profiles: [
      { name: "Alexander Awuku", on: true }, { name: "F.A Vision Enterprise", on: true }, { name: "Fa Vision Furnitures", on: true },
      { name: "Oteng Furniture", on: true }, { name: "Agoodmann Ventures", on: true }, { name: "Manye Oye Rehoboth", on: true },
      { name: "Rubaks Catering Services", on: false }, { name: "Christ Kingdom Christian Mission International", on: false }
    ],
    // Phase 2 order: which Page posts what. brand = data/brands.json id (contacts, kit, stamp).
    brands: [
      { key: "fav", page: "F.A Vision Enterprise", brand: "fa-vision", products: ["FAV-014"], on: true },
      { key: "favf", page: "Fa Vision Furnitures", brand: "fa-vision", products: ["FAV-014"], on: true },
      { key: "oteng", page: "Oteng Furniture", brand: "oteng-furniture", products: ["FAV-014"], on: true },
      { key: "agood", page: "", brand: "agoodmann-ventures", products: ["FAV-024"], on: true }
    ]
  };
  const shortName = p => String(p.name).split(" — ")[0];
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  let busy = false, preview = null;

  // ---------------------------------------------------------------- state (lives in facebook-autopilot.json)
  const S = () => F() && F()._test.state();
  function R(s) {
    s = s || S();
    if (!s) return null;
    const r = s.relay = s.relay || {};
    r.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), r.settings || {});
    if (!Array.isArray(r.settings.profiles) || !r.settings.profiles.length) r.settings.profiles = JSON.parse(JSON.stringify(DEFAULTS.profiles));
    if (!Array.isArray(r.settings.brands) || !r.settings.brands.length) r.settings.brands = JSON.parse(JSON.stringify(DEFAULTS.brands));
    r.joins = r.joins || []; r.posts = r.posts || []; r.manual = r.manual || []; r.runs = r.runs || [];
    return r;
  }
  const save = (mut, msg) => F()._test.save(s => { mut(R(s), s); return s; }, msg);
  const brandById = id => (BR() && BR().list().find(b => b.id === id)) || null;
  // AGOODMANN's Page comes from 🏷 Brands (accounts.facebook live + handle); the setting can override it.
  function pageFor(b) {
    if (b.page) return b.page;
    const br = brandById(b.brand), fb = br && br.accounts && br.accounts.facebook;
    return fb && fb.status === "live" && fb.handle ? fb.handle : "";
  }
  const run = () => (R() || {}).cur || null;
  const joinedThisRun = r => (r.joins || []).filter(j => j.run === r.id && j.status === "joined").length;
  const mainProfile = r => (r || R()).settings.profiles[0] ? (r || R()).settings.profiles[0].name : "Alexander Awuku";

  // ---------------------------------------------------------------- phase 1: join
  function startJoin(then) {
    const f = F(); if (f.needExt()) return;
    const s = S(), r = R(), cur = r.cur;
    const profiles = r.settings.profiles.filter(p => p.on).map(p => p.name);
    if (!profiles.length) return A.toast("Tick at least one profile or Page for the relay.", true);
    const need = Math.max(0, r.settings.join_target - joinedThisRun(Object.assign({}, r, { id: cur.id })));
    if (!need) return f.runStep(["relay:post:0"].concat(then || []), true);
    const kws = s.settings.grow_keywords, shift = Math.floor(Date.now() / 864e5) % kws.length;
    const q = kws.slice(shift).concat(kws.slice(0, shift)).map(kw => ({ kw, url: `https://www.facebook.com/search/groups/?q=${encodeURIComponent(kw)}` }));
    const skip = [...new Set([...s.groups.map(g => g.id), ...s.removed.map(x => x.id), ...s.joins.map(j => j.g)])];
    const qa = BR() && BR().qa ? BR().qa(mainProfile()) : {};
    const st = cur.join || {};
    f.launch(q[0].url, {
      kind: "grow", relay: true, rb: cur.id, q, skip: skip.concat(Object.values(st.skipBy || {}).flat()), limit: need, batch: cur.dry ? profiles.length + 1 : Math.min(r.settings.batch || 10, need + 5),
      profiles, dropped: (cur.dropped || []).slice(), turn: st.turn || 0, kwi: st.kwi || {}, skipBy: st.skipBy || {},
      min: s.settings.grow_min_members, minGlobal: Math.max(s.settings.grow_min_global, s.settings.grow_min_members), deny: window.FAV_FBAUTO_DENY || null,
      pmin: r.settings.pmin, pmax: r.settings.pmax, dry: !!cur.dry, test_join: !!cur.dry, ...qa, qa_on: !(window.FAV_AIPLAN && window.FAV_AIPLAN.on && !window.FAV_AIPLAN.on("P2")), then: then && then.length ? then : null
    });
  }

  // ---------------------------------------------------------------- phase 2: post
  // Groups this Page is in (read by relay:import:<i>), minus removed / off / pending, ordered: never used in this
  // run first, then least recently posted. Different groups for each brand where possible.
  function groupsFor(b, r, s) {
    const page = pageFor(b), member = ((r.cur.members || {})[page] || []);
    const removed = new Set(s.removed.map(x => x.id)), off = new Set(s.groups.filter(g => g.active === false).map(g => g.id));
    const usedRun = new Set(r.posts.filter(x => x.run === r.cur.id && x.ok).map(x => x.g));
    const last = {};
    for (const x of s.posts.concat(r.posts)) { const t = x.t || x.d; if (t && (!last[x.g] || t > last[x.g])) last[x.g] = t; }
    const ok = member.filter(g => !removed.has(g.id) && !off.has(g.id));
    return ok.sort((a, c) => (usedRun.has(a.id) - usedRun.has(c.id)) || String(last[a.id] || "").localeCompare(String(last[c.id] || ""))).slice(0, r.settings.groups_per_brand);
  }
  function captionFor(p, br, page) {
    const W = window.FAV_CAPTIONS;
    const brand = br ? { ...br, name: br.default ? page || br.name : br.name } : null;
    let t = W.write(p, { net: "fb", brand, forceTags: true });
    if (br && br.default) t = t.replace(/\n(#[^\n]*)$/, `\n${SIGNOFF}\n\n$1`);   // FA Vision family sign-off before the hashtags
    if (br && br.default && !t.includes(SIGNOFF)) t += "\n" + SIGNOFF;
    return W.ensure(t, p, { net: "fb", brand });
  }
  function buildPost(i, r, s) {
    const b = r.settings.brands.filter(x => x.on)[i];
    if (!b) return null;
    const br = brandById(b.brand), page = pageFor(b);
    const prods = b.products.map(id => A.products().find(p => p.id === id)).filter(p => p && (p.images || []).length);
    if (!page) return { b, page, skip: `Add ${br ? br.name : b.brand}' Facebook Page in Profiles (🏷 Brands → Facebook → Live + Page name) to post its items.` };
    if (!prods.length) return { b, page, skip: "its product isn't on the site (needs a photo)" };
    const groups = groupsFor(b, r, s);
    if (!groups.length) return { b, page, groups, skip: `${page} isn't a member of any group yet (the relay joins groups first; pending requests count once accepted)` };
    const q = groups.map((g, k) => {
      const p = prods[k % prods.length];
      const pics = window.FAV_STAMP ? window.FAV_STAMP.choices(p, br) : [];   // that brand's own designs + stamped photos, in turn
      const img = pics.length ? location.origin + "/" + pics[k % pics.length] : null;
      return { g: g.id, name: g.name, url: g.url || `https://www.facebook.com/groups/${g.id}/`, p: p.id, text: captionFor(p, br, page), img: img || location.origin + "/" + p.images[0], as: page, brand: b.brand };
    });
    return { b, br, page, groups, q };
  }
  function startImport(i, then) {
    const f = F(); if (f.needExt()) return;
    const r = R(), b = r.settings.brands.filter(x => x.on)[i];
    if (!b) return f.runStep(["relay:done"].concat(then || []), true);
    const page = pageFor(b);
    if (!page) { note(`${brandName(b)}: no Facebook Page set, skipped.`); return f.runStep([`relay:post:${i}`].concat(then || []), true); }
    f.launch("https://www.facebook.com/groups/joins/?nav_source=tab", { kind: "import", as: page, rb: r.cur.id, then: [`relay:post:${i}`].concat(then || []) });
  }
  const brandName = b => (brandById(b.brand) || {}).name || b.page || b.brand;
  function note(t) { A.toast(t); }
  async function startPost(i, then) {
    const f = F(); if (f.needExt()) return;
    const r = R(), s = S();
    const pl = buildPost(i, r, s);
    const next = [(r.settings.brands.filter(x => x.on)[i + 1] ? `relay:import:${i + 1}` : "relay:done")].concat(then || []);
    if (!pl) return f.runStep(["relay:done"].concat(then || []), true);
    if (pl.skip) {
      await save(rr => { rr.cur.skipped = (rr.cur.skipped || []).concat({ brand: pl.b.key, page: pl.page, why: pl.skip }); }, `Profile relay: ${brandName(pl.b)} skipped`).catch(() => null);
      A.toast(`${brandName(pl.b)}: ${pl.skip}`, true);
      return setTimeout(() => f.runStep(next, true), 1500);
    }
    await f.sendAlert("session", { products: 1, pairs: pl.q.map(x => ({ p: A.products().find(p => p.id === x.p), g: { name: x.name } })) });
    f.launch(pl.q[0].url, { kind: "post", mode: "now", relay: true, rb: r.cur.id, brand_key: pl.b.key, q: pl.q, dry: !!r.cur.dry, min: s.settings.pause_min_s, max: s.settings.pause_max_s, then: next });
  }

  // ---------------------------------------------------------------- run control
  async function begin(dry, skipJoin) {
    if (busy) return;
    const f = F(); if (f.needExt()) return;
    if (Number(document.documentElement.dataset.favautoExt || 0) < 3) return A.toast("Update the add-on first (Today tab, bottom).", true);
    busy = true;
    try {
      const id = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      await save(r => { r.cur = { id, d: today(), t: new Date().toISOString(), dry: !!dry, phase: skipJoin ? "post" : "join", dropped: [], members: {}, skipped: [] }; }, `Profile relay: ${dry ? "test" : "run"} started`);
      if (!dry) await f.sendAlert("session", { products: 0, pairs: [], listing: skipJoin ? "Profile relay: posting phase" : `Profile relay: profiles take turns joining ${R().settings.join_target} groups, then post` });
    } catch (e) { busy = false; return A.toast(A.friendly(e), true); }
    busy = false;
    f.runStep([skipJoin ? "relay:import:0" : "relay:join", "report"], false);
  }
  async function skipToPosting() {
    const r = R();
    if (!r.cur) return begin(false, true);
    await save(rr => { rr.cur.phase = "post"; }, "Profile relay: skip to posting");
    F().runStep(["relay:import:0", "report"], false);
  }
  async function finishRun(then) {
    const r = R(), cur = r.cur;
    if (!cur) return then && then.length ? F().runStep(then, true) : null;
    const posts = r.posts.filter(x => x.run === cur.id), joins = r.joins.filter(x => x.run === cur.id);
    const sum = {
      id: cur.id, d: cur.d, t: new Date().toISOString(), dry: !!cur.dry,
      joined: joins.filter(j => j.status === "joined").length, pending: joins.filter(j => j.status === "pending").length,
      manual: joins.filter(j => j.status === "manual").length, dropped: cur.dropped || [],
      by_profile: Object.entries(joins.reduce((m, j) => { if (j.as) (m[j.as] = m[j.as] || { joined: 0, pending: 0, manual: 0 })[j.status === "joined" ? "joined" : j.status === "manual" ? "manual" : "pending"]++; return m; }, {})).map(([k, v]) => ({ as: k, ...v })),
      by_brand: r.settings.brands.filter(b => b.on).map(b => ({ key: b.key, name: b.page || brandName(b), ok: posts.filter(x => x.brand_key === b.key && x.ok).length, tried: posts.filter(x => x.brand_key === b.key).length })),
      skipped: cur.skipped || []
    };
    await save(rr => { rr.runs = rr.runs.concat(sum).slice(-30); rr.last = sum; delete rr.cur; }, `Profile relay: ${cur.dry ? "test" : "run"} done`);
    if (!cur.dry) {
      try {
        await A.backendSigned({ action: "session_alert", kind: "relay_done", day: today(), listing: "Profile relay finished",
          groups: sum.by_brand.map(b => `${b.name}: ${b.ok} of ${b.tried} group posts`),
          joins: joins.slice(0, 60).map(j => ({ name: `${j.name} (by ${j.as})`, members: j.members, status: j.status === "manual" ? "questions" : j.status, url: j.url || "" })),
          removed: [], totals: { active: S().groups.filter(g => g.active !== false).length, pending: S().groups.filter(g => g.pending).length, removed: S().removed.length, joined_today: sum.joined, target: r.settings.join_target } });
      } catch (e) { /* never block on the email */ }
    }
    A.toast(`Profile relay ${cur.dry ? "test " : ""}done: ${sum.joined} joined${sum.pending ? `, ${sum.pending} waiting for admins` : ""}${sum.manual ? `, ${sum.manual} need a manual answer` : ""}; ${sum.by_brand.map(b => `${b.name} ${b.ok}/${b.tried}`).join(" · ")}.`);
    F().render();
    if (then && then.length) setTimeout(() => F().runStep(then, true), 1500);
  }
  // runStep keys: relay:join · relay:import:<i> · relay:post:<i> · relay:done
  function step(k, then) {
    if (!R() || !R().cur) { A.toast("No Profile relay run is going. Press Run in the Facebook tab.", true); return then && then.length ? F().runStep(then, true) : null; }
    const [, what, n] = k.split(":");
    if (what === "join") return startJoin(then);
    if (what === "import") return startImport(Number(n) || 0, then);
    if (what === "post") return startPost(Number(n) || 0, then);
    if (what === "done") return finishRun(then);
  }

  // ---------------------------------------------------------------- results from the add-on
  async function receive(out) {
    const r = R(), cur = r && r.cur, d = today();
    if (!cur) return { text: "Profile relay: no run going any more; result ignored.", bad: true };
    if (out.kind === "grow") {
      const res = out.res || [];
      await save((rr, s) => {
        for (const x of res) {
          if (x.drop) continue;
          rr.joins.push({ run: cur.id, d, t: x.t, g: x.g, name: x.name, members: x.members, status: x.status, as: x.as, url: x.url, ...(x.why ? { why: x.why } : {}), ...(x.qa ? { qa: x.qa } : {}), ...(x.qs ? { qs: x.qs } : {}) });
          if (x.status === "manual") rr.manual = rr.manual.filter(m => m.g !== x.g).concat({ g: x.g, name: x.name, url: x.url, as: x.as, d, why: x.why, qs: x.qs || [], qa: x.qa || [] }).slice(-100);
          if (cur.dry || x.status === "failed" || x.status === "test" || x.status === "manual") continue;
          s.joins.push({ d, t: x.t, g: x.g, name: x.name, members: x.members, status: x.status, url: x.url, as: x.as, relay: true, ...(x.qa ? { qa: x.qa } : {}) });
          if (!s.groups.some(g => g.id === x.g)) {
            const g = { id: x.g, name: x.name, url: x.url, added: d, members: x.members, source: "relay", by: x.as };
            if (x.status === "joined") g.active = true; else Object.assign(g, { active: false, pending: true, off_why: "Waiting for the group's admin to accept us" });
            s.groups.push(g);
          }
        }
        rr.joins = rr.joins.slice(-1500);
        rr.cur.dropped = out.dropped || rr.cur.dropped || [];
        rr.cur.join = { turn: out.turn || 0, kwi: out.kwi || {}, skipBy: out.skipBy || {} };
        if (out.home) rr.cur.home = out.home;
      }, `Profile relay: ${res.filter(x => x.status === "joined").length} groups joined`);
      const r2 = R(), joined = joinedThisRun(Object.assign({}, r2, { id: cur.id }));
      const more = out.more && !out.stopped && joined < r2.settings.join_target;
      if (out.stopped && /Facebook showed/.test(out.stopped)) return { text: `Profile relay stopped: ${out.stopped}`, bad: true, then: ["report"] };
      if (more) return { text: `Profile relay: ${joined}/${r2.settings.join_target} joined. Next batch starts in a moment…`, then: ["relay:join"].concat((out.then || []).filter(k => k !== "relay:join")) };
      if (!cur.dry && joined < r2.settings.join_target && out.stopped) return { text: `Profile relay: ${joined}/${r2.settings.join_target} joined. ${out.stopped} Press "Skip to posting" to post with the groups you have.`, bad: true, then: ["report"] };
      await save(rr => { rr.cur.phase = "post"; }, "Profile relay: posting phase");
      return { text: `Profile relay: ${joined} joined${cur.dry ? " (test)" : ""}. Posting phase next…`, then: ["relay:import:0"].concat((out.then || []).filter(k => !/^relay:/.test(k))) };
    }
    if (out.kind === "import") {
      const found = (out.groups || []).filter(g => g.id && g.name);
      await save((rr, s) => {
        rr.cur.members = rr.cur.members || {};
        if (found.length) rr.cur.members[out.as] = found.map(g => ({ id: g.id, name: g.name, url: g.url }));
        const gone = new Set(s.removed.map(x => x.id));
        for (const g of found) {
          if (gone.has(g.id)) continue;
          const have = s.groups.find(x => x.id === g.id);
          if (have) { if (have.pending) { delete have.pending; delete have.off_why; have.active = true; } }
          else s.groups.push({ id: g.id, name: g.name, url: g.url, active: true, added: d, by: out.as });
        }
      }, `Profile relay: read ${found.length} groups of ${out.as}`);
      return { text: found.length ? `${out.as} is in ${plural(found.length, "group")}.` : `Couldn't read ${out.as}'s groups${out.stopped ? ": " + out.stopped : ""}.`, bad: !found.length };
    }
    if (out.kind === "post") {
      const res = out.res || [];
      const declined = res.filter(x => !x.ok && /declin|removed your post|rejected/i.test(x.why || "")).map(x => x.g);
      await save((rr, s) => {
        for (const x of res) rr.posts.push({ run: cur.id, d, t: x.t, g: x.g, p: x.p, ok: x.ok, as: x.as, brand_key: out.brand_key, dry: !!out.dry, ...(x.why ? { why: x.why } : {}) });
        rr.posts = rr.posts.slice(-2000);
        if (!out.dry) for (const x of res) s.posts.push({ d, t: x.t, p: x.p, g: x.g, ok: x.ok, now: true, relay: true, ...(x.as ? { as: x.as } : {}), ...(x.why ? { why: x.why } : {}) });
        for (const id of declined) {                       // groups that decline our posts: off the list for good (existing rule)
          const g = s.groups.find(x => x.id === id);
          s.groups = s.groups.filter(x => x.id !== id);
          if (!s.removed.some(x => x.id === id)) s.removed.push({ id, name: (g && g.name) || id, url: (g && g.url) || `https://www.facebook.com/groups/${id}/`, why: "Declined our post (Profile relay)", d, left: false, tries: 0 });
        }
      }, `Profile relay: ${res.filter(x => x.ok).length} of ${res.length} posts`);
      const ok = res.filter(x => x.ok).length;
      return { text: `Profile relay · ${(res[0] && res[0].as) || "posts"}: ${out.dry ? "test passed in" : "posted in"} ${ok} of ${res.length} groups${(out.refused || []).length ? `, ${out.refused.length} refused (no brand stamp)` : ""}.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped };
    }
    return { text: "" };
  }

  // ---------------------------------------------------------------- card (Facebook tab)
  function renderCard() {
    const r = R();
    if (!r) return "";
    const st = r.settings, cur = r.cur, last = r.last;
    const joined = cur ? joinedThisRun(Object.assign({}, r, { id: cur.id })) : 0;
    const byProf = {};
    for (const j of r.joins.filter(j => cur && j.run === cur.id)) { const m = byProf[j.as] = byProf[j.as] || { joined: 0, pending: 0, manual: 0, failed: 0 }; m[j.status in m ? j.status : "pending"]++; }
    const postsBy = k => r.posts.filter(x => cur && x.run === cur.id && x.brand_key === k);
    const brandsOn = st.brands;
    const agood = st.brands.find(b => b.brand === "agoodmann-ventures");
    const stampPrev = (b) => { const p = A.products().find(x => x.id === b.products[0]); const u = p && window.FAV_STAMP ? window.FAV_STAMP.preview(p, b.brand) : null; return u ? `<img src="../${esc(u)}" alt="" width="54" height="68" loading="lazy" class="rl-thumb">` : `<span class="rl-thumb rl-nostamp" title="No brand stamp yet">!</span>`; };
    return `<section class="fa-card rl-card" id="relay-card">
      <header><h2>Profile relay</h2><span class="fa-big ${cur ? "hot" : ""}">${cur ? `${joined}/${st.join_target}` : last ? `${last.joined}/${st.join_target}` : `0/${st.join_target}`}</span></header>
      <p class="muted">Your profiles and Pages take turns joining big groups (one each, then the next), until ${st.join_target} groups are joined. Then each Page posts into ${st.groups_per_brand} of its groups, in this order. Every post gets its own description, hashtags, a call to action and the Page's own name and logo on the picture. Boost stays off; groups that decline posts are removed for good.</p>
      ${cur ? `<div class="rl-live"><b>${cur.dry ? "Test running" : "Running"} · ${cur.phase === "join" ? "Phase 1: joining" : "Phase 2: posting"}</b>
        <ul class="fa-list">${Object.entries(byProf).map(([k, v]) => `<li><span>${esc(k)}</span><small>${v.joined} joined${v.pending ? ` · ${v.pending} waiting` : ""}${v.manual ? ` · ${v.manual} manual` : ""}</small></li>`).join("") || `<li><span class="muted">No joins yet</span></li>`}
        ${(cur.dropped || []).map(n => `<li class="bad"><span>${esc(n)}</span><small>dropped for today</small></li>`).join("")}
        ${brandsOn.filter(b => b.on).map(b => { const ps = postsBy(b.key); return `<li><span>✎ ${esc(b.page || pageFor(b) || brandName(b))}</span><small>${ps.filter(x => x.ok).length}/${st.groups_per_brand} posted${ps.some(x => !x.ok) ? ` · ${ps.filter(x => !x.ok).length} skipped` : ""}</small></li>`; }).join("")}</ul>
        <div class="fa-actions"><button class="btn btn-sell btn-sm" data-relay="skip" ${cur.phase === "post" ? "disabled" : ""}>Skip to posting</button><button class="btn btn-ghost btn-sm" data-relay="stop">Stop the relay</button></div>
        <p class="muted fa-small">The Facebook tab shows its own box with a Stop button while it works. Stop there, then "Stop the relay" here ends the run (the summary is saved).</p></div>` : ""}
      <form class="fa-settings rl-form" id="relay-form">
        <div class="rl-row"><label>Groups to join <input name="join_target" type="number" min="1" max="100" value="${st.join_target}"></label>
        <label>Groups per brand <input name="groups_per_brand" type="number" min="1" max="100" value="${st.groups_per_brand}"></label></div>
        <fieldset class="rl-set"><legend>Profiles and Pages that take turns joining</legend>
          ${st.profiles.map((p, i) => `<label class="fa-check"><input type="checkbox" name="prof_${i}" ${p.on ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}
          <label>Add another (exact name as in Facebook's profile list) <input name="prof_new" type="text" maxlength="80" placeholder="Page name"></label></fieldset>
        <fieldset class="rl-set"><legend>Posting order (Phase 2)</legend>
          ${brandsOn.map((b, i) => { const p = A.products().find(x => x.id === b.products[0]); const pg = pageFor(b); return `<div class="rl-brand ${pg ? "" : "off"}">${stampPrev(b)}<label class="fa-check"><input type="checkbox" name="br_${i}" ${b.on ? "checked" : ""}> <span><b>${i + 1}. ${esc(pg || brandName(b))}</b><small>${esc(p ? shortName(p) : b.products.join(", "))} · ${esc(brandName(b))}'s contacts${pg ? "" : " · no Page set"}</small></span></label>
            <span class="rl-move"><button type="button" class="btn btn-ghost btn-sm" data-relay-up="${i}" ${i ? "" : "disabled"} aria-label="Move up">↑</button><button type="button" class="btn btn-ghost btn-sm" data-relay-down="${i}" ${i < brandsOn.length - 1 ? "" : "disabled"} aria-label="Move down">↓</button></span></div>`; }).join("")}
          ${agood && !pageFor(agood) ? `<p class="rl-warn">Add AGOODMANN VENTURES' Facebook Page in Profiles (🏷 Brands → AGOODMANN VENTURES → Facebook → Live, Page name). Until then its posts are skipped, never posted as F.A Vision.</p>` : ""}</fieldset>
        <div class="fa-actions">
          <button class="btn btn-sell" type="submit" data-relay-go="run" ${cur ? "disabled" : ""}>▶ Run the relay</button>
          <button class="btn btn-ghost" type="submit" data-relay-go="test" ${cur ? "disabled" : ""}>Test without posting</button>
          <button class="btn btn-ghost" type="submit" data-relay-go="post" ${cur ? "disabled" : ""}>Skip to posting</button>
          <button class="btn btn-ghost btn-sm" type="submit" data-relay-go="save">Save settings</button>
        </div>
        <p class="muted fa-small">About ${Math.round(st.join_target * 1.4)} min of joining (40–100 s between joins), then ${Math.round(st.brands.filter(b => b.on).length * st.groups_per_brand * 2)} min of posting. Test opens each step, fills one group's questions (never sends them) and checks every post up to the Post button. ${F() && F().keepNote ? F().keepNote() : ""}</p>
      </form>
      ${r.manual.length ? `<details class="fa-more"><summary>Groups that need a manual answer (${r.manual.length})</summary><ul class="fa-list rl-qa">${r.manual.slice().reverse().slice(0, 30).map(m => `<li class="bad"><span><a href="${esc(m.url || "#")}" target="_blank" rel="noopener">${esc(m.name)}</a> <small>by ${esc(m.as || "")}</small></span><small>${esc(m.why || "")}${(m.qs || []).length ? ": “" + esc(m.qs.join("” · “")) + "”" : ""}</small></li>`).join("")}</ul></details>` : ""}
      ${r.joins.some(j => (j.qa || []).length) ? `<details class="fa-more"><summary>Questions answered</summary><ul class="fa-list rl-qa">${r.joins.filter(j => (j.qa || []).length).slice(-20).reverse().map(j => `<li><span>${esc(j.name)} <small>by ${esc(j.as || "")} · ${esc(j.status)}</small></span><small>${j.qa.map(x => `${esc(x.q)} → ${esc(x.a)}`).join("<br>")}</small></li>`).join("")}</ul></details>` : ""}
      ${last ? `<details class="fa-more" open><summary>Last ${last.dry ? "test" : "run"} · ${esc(last.d)}</summary><ul class="fa-list">
        <li><span>Joined</span><small>${last.joined} of ${st.join_target}${last.pending ? ` · ${last.pending} waiting for admins` : ""}${last.manual ? ` · ${last.manual} need a manual answer` : ""}</small></li>
        ${(last.by_profile || []).map(x => `<li><span>${esc(x.as)}</span><small>${x.joined} joined${x.pending ? ` · ${x.pending} waiting` : ""}</small></li>`).join("")}
        ${(last.by_brand || []).map(x => `<li><span>✎ ${esc(x.name)}</span><small>${x.ok} of ${x.tried} posts</small></li>`).join("")}
        ${(last.skipped || []).map(x => `<li class="bad"><span>${esc(x.page || x.brand)}</span><small>${esc(x.why)}</small></li>`).join("")}
        ${(last.dropped || []).length ? `<li class="bad"><span>Dropped for the day</span><small>${esc(last.dropped.join(", "))}</small></li>` : ""}</ul></details>` : ""}
    </section>`;
  }
  // the four ticked defaults read as checkboxes; order changes are saved straight away
  function readForm(f) {
    const r = R(), el = f.elements, clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || lo));
    const profiles = r.settings.profiles.map((p, i) => ({ ...p, on: !!(el["prof_" + i] && el["prof_" + i].checked) }));
    const add = (el.prof_new.value || "").trim();
    if (add && !profiles.some(p => p.name.toLowerCase() === add.toLowerCase())) profiles.push({ name: add, on: true });
    return { ...r.settings, join_target: clamp(el.join_target.value, 1, 100), groups_per_brand: clamp(el.groups_per_brand.value, 1, 100), profiles,
      brands: r.settings.brands.map((b, i) => ({ ...b, on: !!(el["br_" + i] && el["br_" + i].checked) })) };
  }
  document.addEventListener("submit", async e => {
    if (!e.target || e.target.id !== "relay-form") return;
    e.preventDefault();
    const go = (e.submitter && e.submitter.dataset.relayGo) || "save", next = readForm(e.target);
    try { await save(r => { r.settings = next; }, "Profile relay: settings"); } catch (err) { return A.toast(A.friendly(err), true); }
    if (go === "save") { A.toast("Profile relay settings saved"); return F().render(); }
    if (go === "test") return begin(true, false);
    if (go === "post") return begin(false, true);
    if (!window.confirm(`Run the Profile relay now?\n\n${next.profiles.filter(p => p.on).length} profiles/Pages take turns joining ${next.join_target} groups, then ${next.brands.filter(b => b.on).length} Pages post into ${next.groups_per_brand} groups each.`)) return;
    begin(false, false);
  });
  document.addEventListener("click", async e => {
    const mv = e.target.closest("[data-relay-up],[data-relay-down]");
    if (mv) {
      e.preventDefault();
      const i = Number(mv.dataset.relayUp != null ? mv.dataset.relayUp : mv.dataset.relayDown), j = mv.dataset.relayUp != null ? i - 1 : i + 1;
      try { await save(r => { const a = r.settings.brands; if (a[i] && a[j]) [a[i], a[j]] = [a[j], a[i]]; }, "Profile relay: posting order"); } catch (err) { return A.toast(A.friendly(err), true); }
      return F().render();
    }
    const b = e.target.closest("[data-relay]");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.relay === "skip") return skipToPosting();
    if (b.dataset.relay === "stop") { if (window.confirm("End this relay run now? What it did so far is kept.")) return finishRun([]); }
  });

  window.FAV_RELAY = { renderCard, step, receive, begin, SIGNOFF, state: () => R(), _test: { buildPost: i => buildPost(i, R(), S()), groupsFor: b => groupsFor(b, R(), S()), captionFor, pageFor, DEFAULTS } };
})();
