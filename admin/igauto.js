// Instagram autopilot: the Instagram tab of the Social autopilot screen (admin/fbauto.js).
//
// Every day it posts `daily_posts` photos on @favisionent through the FA Vision
// add-on (extension/instagram.js). Posts come from the strategy ads
// (assets/images/ads) and the HD deal cards (assets/images/share), in a rotation
// that never repeats a photo until every other one has had a turn.
//
// Instagram Plus-style features, done for the business:
//   - Audience lists: each post gets the hashtag set for its buyers (students,
//     homes, offices, builders, bakers), editable here.
//   - Weekly spotlight: on the spotlight day the current headline promo goes out first.
//   - Follower insights: followers / following / posts read at every run, with
//     growth shown here and in the daily email report.
//
// Log: data/instagram-autopilot.json
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/instagram-autopilot.json";
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const EMPTY = {
    settings: {
      on: true, account: "favisionent", daily_posts: 3, pause_min_s: 120, pause_max_s: 300, spotlight_day: 1,
      audiences: {
        students: "#StudentDesk #SchoolFurniture #SHSGhana #BackToSchoolGhana #GhanaSchools #StudyDesk",
        home: "#HomeDecorGhana #InteriorDesignGhana #LivingRoomIdeas #DiningSet #GhanaHomes #AccraLiving",
        office: "#OfficeFurnitureGhana #OfficeSetup #WorkspaceGoals #GhanaBusiness #AccraOffices",
        build: "#GhanaBuilders #TilesGhana #BathroomIdeas #ConstructionGhana #AccraHomes",
        food: "#BakersGhana #BakingGhana #FlourGhana #AccraBakers #GhanaFood"
      }
    },
    posts: [], profile: [], runs: []
  };
  const AUDIENCE_NAMES = { students: "Students & schools", home: "Homes", office: "Offices & print", build: "Builders & bathrooms", food: "Bakers & food" };
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  let S = null;

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    s.settings = { ...EMPTY.settings, ...(s.settings || {}) };
    s.settings.audiences = { ...EMPTY.settings.audiences, ...(s.settings.audiences || {}) };
    for (const k of ["posts", "profile", "runs"]) s[k] = s[k] || [];
    return s;
  }
  async function load(force) {
    if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY));
    return S;
  }
  async function save(mutate, message) {
    S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY));
  }

  // ------------------------------------------------------------------ what can be posted
  // The promo calendar's "active" entry (same rule as the website: first matching window wins).
  function activePromo() {
    const pr = A.business().promos || {}, d = today(), md = d.slice(5);
    return (pr.schedule || []).find(s => s.from.length === 10 ? d >= s.from && d <= s.to
      : s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to) || null;
  }
  function audienceOf(p) {
    const c = String((p && p.category) || "");
    if (/school/i.test(c)) return "students";
    if (/office|printing|stationery/i.test(c)) return "office";
    if (/bath|tile/i.test(c)) return "build";
    if (/grocer|food/i.test(c)) return "food";
    return "home";
  }
  const SEASONAL = [
    { id: "customer-service-week-2026", from: "2026-10-05", to: "2026-10-11", img: "assets/images/ads/customer-service-week-2026.jpg",
      subject: "Happy Customer Service Week! 🎉 To every customer who trusted us this year: thank you. We'll keep going the extra mile for you." }
  ];
  function pool() {
    const pr = A.business().promos || {};
    const byId = Object.fromEntries(A.products().map(p => [p.id, p]));
    const ok = p => p && !p.placeholder && p.in_stock !== false && p.price_ghs;
    const active = activePromo();
    const dated = new Set((pr.schedule || []).filter(s => s.from.length === 10).map(s => s.ad));
    const items = [];
    for (const a of pr.ads || []) {
      const p = byId[a.product];
      if (!ok(p) || (dated.has(a.id) && !(active && active.ad === a.id))) continue;   // dated ads only while their dates run
      items.push({ k: "ad:" + a.id, img: `assets/images/ads/${a.id}.jpg`, p, ad: a, kind: "Ad" });
      // the same ad in the two extra designs (scripts/make_ad_models.py): tile and presence
      items.push({ k: "tile:" + a.id, img: `assets/images/ads/models/tile-${a.id}.jpg`, p, ad: a, kind: "Tile ad" });
      items.push({ k: "presence:" + a.id, img: `assets/images/ads/models/presence-${a.id}.jpg`, p, ad: a, kind: "Presence ad" });
    }
    // seasonal ads, only while their dates run
    const day = new Date().toLocaleDateString("en-CA");
    for (const s of SEASONAL) if (day >= s.from && day <= s.to) items.push({ k: "season:" + s.id, img: s.img, p: null, seasonal: true, subject: s.subject, kind: "Seasonal" });
    items.push({ k: "ad:ai-studio", img: "assets/images/ads/ai-studio.jpg", p: null, studio: true, kind: "Ad" });
    for (const p of A.products().filter(ok).sort((a, b) => a.id.localeCompare(b.id))) {
      items.push({ k: "card:" + p.id, img: `assets/images/share/${p.id.toLowerCase()}.jpg`, p, kind: "Deal card" });
    }
    return items;
  }
  const label = it => it.seasonal ? "Happy Customer Service Week" : it.studio ? "AI Studio: design your room free" : it.ad ? `${it.ad.headline} ${it.ad.accent} (${String(it.p.name).split(" — ")[0]})` : String(it.p.name).split(" — ")[0];

  function plan() {
    const items = pool(), d = today();
    const okToday = S.posts.filter(x => x.d === d && x.ok && !x.now);   // "Post now" posts don't use up the daily plan
    const room = S.settings.on ? Math.max(0, S.settings.daily_posts - okToday.length) : 0;
    const last = {};
    for (const x of S.posts) if (x.ok && (!last[x.k] || x.t > last[x.k])) last[x.k] = x.t;
    const usedProducts = new Set(okToday.map(x => x.p).filter(Boolean));
    const sorted = items.slice().sort((a, b) => (last[a.k] || "").localeCompare(last[b.k] || ""));
    const queue = [];
    // Weekly spotlight: the headline promo goes first on the spotlight day
    const isSpot = new Date().getDay() === Number(S.settings.spotlight_day);
    const promo = activePromo();
    const spotItem = promo && items.find(i => i.k === "ad:" + promo.ad);
    const spotDone = S.posts.some(x => x.d === d && x.ok && x.spot);
    if (room && isSpot && spotItem && !spotDone) { queue.push({ ...spotItem, spot: true }); if (spotItem.p) usedProducts.add(spotItem.p.id); }
    // Variety: different product types first (dining, office, school…), then anything left.
    const cat = it => it.studio ? "studio" : it.seasonal ? "seasonal" : String((it.p && it.p.category) || "");
    const usedCats = new Set(queue.map(cat).concat(okToday.map(x => { const it = items.find(i => i.k === x.k); return it ? cat(it) : ""; })));
    for (const mixed of [true, false]) {
      for (const it of sorted) {
        if (queue.length >= room) break;
        if (queue.some(q => q.k === it.k)) continue;
        if (it.p && usedProducts.has(it.p.id)) continue;   // one photo per product a day
        if (mixed && usedCats.has(cat(it))) continue;
        queue.push(it);
        usedCats.add(cat(it));
        if (it.p) usedProducts.add(it.p.id);
      }
    }
    return { queue, room, doneToday: okToday.length, target: S.settings.daily_posts, total: items.length, posted: Object.keys(last).length, isSpot, spotItem };
  }

  // ------------------------------------------------------------------ captions (3 variants, rotated)
  function caption(it, v) {
    const B = A.business();
    if (window.FAV_CAPTIONS) return window.FAV_CAPTIONS.write(it.studio ? null : it.p, { net: "ig", ad: it.ad, studio: !!it.studio, subject: it.subject, tags: it.studio ? S.settings.audiences.home : S.settings.audiences[audienceOf(it.p)] });
    const brand = "#FAVisionEnterprise #AccraFurniture #FurnitureGhana";
    if (it.studio) {
      return `See your room before you buy it ✨\n\nDesign your room free with F.A Vision AI Studio: pick sofas, dining sets, wardrobes and wallpaper, and see them in your space. You only pay for the pieces you order.\n\n🔗 favisionenterprize.github.io/studio (link in bio)\n📲 WhatsApp ${C.localPhone(B.whatsapp)}\n📍 Odorkor, Accra\n\n${S.settings.audiences.home} ${brand}`;
    }
    const p = it.p, s = p.seller;
    const wa = C.localPhone((s && s.whatsapp) || B.whatsapp);
    const name = String(p.name).split(" — ")[0];
    let price = C.formatPrice(p.price_ghs) + (p.negotiable ? " (negotiable)" : "");
    if (p.id === "FAV-014") price += " a set · GH₵640 each from 50 sets";
    const hl = (p.highlights || []).slice(0, 3);
    const where = s ? `🏪 Sold by ${s.name}${s.address ? " · " + s.address : ""}` : "📍 Showroom: Tarazzo Road, Odorkor (opposite Pacific), Accra";
    const pay = s ? "" : "💳 Pay 50% now, the rest on delivery. MoMo, GhanaPay or card.\n";
    const tags = `${S.settings.audiences[audienceOf(p)] || ""} ${s ? "" : brand}`.trim();
    const head = it.ad ? `${it.ad.headline} ${it.ad.accent}` : `${name} in stock`;
    const variants = [
      `${head} 🔥\n\n${name}\n💰 ${price}\n${hl.map(h => "✔ " + h).join("\n")}\n\n${where}\n${pay}📲 WhatsApp ${wa}\n🔗 favisionenterprize.github.io (link in bio)\n\n${tags}`,
      `${head}\n\n${String(p.description || "").split("\n")[0]}\n\nPrice: ${price}\n${pay}Order on WhatsApp ${wa} or through the link in our bio.\n${where}\n\n${tags}`,
      `Looking for ${/s$/i.test(name) ? "" : "a "}${name.toLowerCase()}? 👀\n\n${hl.map(h => "• " + h).join("\n")}\n💰 ${price}\n\nDM us or WhatsApp ${wa}. Delivery across Accra and beyond.\n${where}\n\n${tags}`
    ];
    return variants[v % variants.length].replace(/\n{3,}/g, "\n\n").trim();
  }

  // ------------------------------------------------------------------ jobs for the add-on (launched by fbauto.js)
  function job(opts) {
    opts = opts || {};
    const pl = plan();
    const site = location.origin + "/";
    let q = pl.queue;
    if (opts.products) {
      // "Post now": the chosen products (their ad if there is one, else the deal card),
      // least recently posted on Instagram first, up to opts.limit.
      const items = pool(), last = {};
      for (const x of S.posts) if (x.ok && x.p && (!last[x.p] || x.t > last[x.p])) last[x.p] = x.t;
      q = opts.products
        .map(id => { const lastK = {}; for (const x of S.posts) if (x.ok && (!lastK[x.k] || x.t > lastK[x.k])) lastK[x.k] = x.t;
          // rotate the designs: classic ad, tile, presence (least recently posted first)
          return items.filter(i => i.p && i.p.id === id && i.ad).sort((a, b) => (lastK[a.k] || "").localeCompare(lastK[b.k] || ""))[0] || items.find(i => i.k === "card:" + id); })
        .filter(Boolean)
        .sort((a, b) => (last[a.p.id] || "").localeCompare(last[b.p.id] || ""))
        .slice(0, Math.max(1, opts.limit || 3));
    }
    if (opts.keys) q = pool().filter(i => opts.keys.includes(i.k));
    if (opts.dry) q = (q.length ? q : pool()).slice(0, 1);
    if (!q.length) return null;
    const start = S.posts.length;
    return {
      url: `https://www.instagram.com/${S.settings.account}/`,
      job: {
        kind: "ig", account: S.settings.account, dry: !!opts.dry, mode: opts.products || opts.keys ? "now" : null,
        spot: q.filter(it => it.spot).map(it => it.k),
        q: q.map((it, i) => ({ k: it.k, p: it.p ? it.p.id : null, img: site + it.img, text: caption(it, start + i) })),
        min: S.settings.pause_min_s, max: S.settings.pause_max_s
      }
    };
  }

  async function receive(out) {
    const d = today();
    if (out.dry) {
      const r = out.res[0];
      return { text: r ? (r.ok ? "Instagram test passed: photo, crop and caption were ready. Nothing was posted." : "Instagram test failed: " + r.why) : "Instagram test stopped. " + (out.stopped || ""), bad: !r || !r.ok };
    }
    const ok = out.res.filter(r => r.ok).length;
    const spot = new Set(out.spot || []);
    await save(s => {
      for (const r of out.res) s.posts.push({ d, t: r.t, k: r.k, p: r.p, ok: r.ok, ...(r.ok && spot.has(r.k) ? { spot: true } : {}), ...(out.mode === "now" ? { now: true } : {}), ...(r.why ? { why: r.why } : {}) });
      if (out.stats && (out.stats.followers != null || out.stats.posts != null)) {
        s.profile = s.profile.filter(x => x.d !== d).concat([{ d, followers: out.stats.followers, following: out.stats.following, posts: out.stats.posts }]).slice(-400);
      }
      s.runs = s.runs.concat([{ d, t: new Date().toISOString(), kind: "ig", tried: out.res.length, ok, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-200);
      s.posts = s.posts.slice(-2000);
      return s;
    }, `Instagram autopilot: posted ${ok} of ${out.res.length}`);
    return { text: `Instagram: posted ${plural(ok, "photo")}${out.res.length - ok ? `, ${out.res.length - ok} skipped` : ""}.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped };
  }

  // ------------------------------------------------------------------ numbers for the Today tab and the report
  function growth() {
    const pr = S.profile;
    if (!pr.length) return null;
    const now = pr[pr.length - 1];
    const back = n => { const t = new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA"); return pr.filter(x => x.d <= t).slice(-1)[0]; };
    const diff = o => o && now.followers != null && o.followers != null ? now.followers - o.followers : null;
    return { ...now, day: diff(back(1)), week: diff(back(7)), month: diff(back(30)) };
  }
  function summary() {
    const pl = plan();
    return { on: S.settings.on, done: pl.doneToday, target: pl.target, waiting: pl.queue.length, growth: growth(), mins: Math.round(pl.queue.length * (2 + (S.settings.pause_min_s + S.settings.pause_max_s) / 120)) };
  }

  // ------------------------------------------------------------------ the Instagram tab
  const signed = n => n == null ? "–" : (n > 0 ? "+" : "") + n.toLocaleString();
  function renderTab() {
    if (!S) return `<p class="muted">Loading…</p>`;
    const pl = plan(), g = growth(), st = S.settings;
    const names = {};
    for (const it of pool()) names[it.k] = label(it);
    const recent = S.posts.slice(-20).reverse();
    return `
      <section class="fa-card">
        <header><h2>Instagram @${esc(st.account)}</h2><span class="fa-big ${pl.queue.length ? "hot" : ""}">${pl.doneToday}/${pl.target}</span></header>
        ${!st.on ? `<p class="fa-empty">Instagram posting is switched off in the settings below.</p>` : pl.queue.length ? `
          <p class="muted fa-small">Up next today${pl.queue[0] && pl.queue[0].spot ? " (spotlight day: the headline promo goes first)" : ""}:</p>
          <div class="ig-next">${pl.queue.map(it => `<figure><img src="../${esc(it.img)}" alt="" loading="lazy" width="108" height="135"><figcaption>${it.spot ? "★ " : ""}${esc(label(it))}</figcaption></figure>`).join("")}</div>
          <div class="fa-actions"><button class="btn btn-sell" data-ig="post">Post ${plural(pl.queue.length, "photo")} on Instagram now</button><button class="btn btn-ghost" data-ig="test">Test without posting</button></div>`
        : `<p class="fa-empty">Today's ${plural(pl.target, "post")} are done ✓</p>`}
        <p class="muted fa-small">${pl.posted} of ${pl.total} photos have been posted at least once. Nothing repeats until every photo has had a turn.</p>
      </section>

      <section class="fa-card">
        <header><h2>Followers</h2><span class="fa-big">${g && g.followers != null ? g.followers.toLocaleString() : "?"}</span></header>
        ${g ? `<div class="ig-stats"><div><b>${signed(g.day)}</b><small>since yesterday</small></div><div><b>${signed(g.week)}</b><small>this week</small></div><div><b>${signed(g.month)}</b><small>in 30 days</small></div><div><b>${g.posts != null ? g.posts.toLocaleString() : "–"}</b><small>posts</small></div></div>
        <p class="muted fa-small">Read from your profile at every run (last ${esc(g.d)}).</p>`
        : `<p class="fa-empty">Read at the first run.</p>`}
      </section>

      <section class="fa-card">
        <header><h2>Plus features</h2></header>
        <ul class="ig-plus">
          <li><b>Audience lists.</b> Every post gets the hashtags for the people who buy that product (edit them below).</li>
          <li><b>Weekly spotlight.</b> Every ${DAYS[st.spotlight_day]} your headline promo${pl.spotItem ? ` (now: “${esc(label(pl.spotItem))}”)` : ""} is posted first.</li>
          <li><b>Follower insights.</b> Followers and growth at every run, and in your daily email report.</li>
          <li><b>No repeats.</b> Ads and HD deal cards take turns, so the same photo never goes out twice in a row.</li>
        </ul>
      </section>

      <section class="fa-card">
        <header><h2>Instagram settings</h2></header>
        <form class="fa-settings" id="ig-settings">
          <label class="fa-check"><input name="on" type="checkbox" ${st.on ? "checked" : ""}> Post on Instagram in the daily run</label>
          <label>Posts a day <input name="daily_posts" type="number" min="1" max="10" value="${st.daily_posts}"></label>
          <label>Spotlight day <select name="spotlight_day">${DAYS.map((d, i) => `<option value="${i}" ${i === Number(st.spotlight_day) ? "selected" : ""}>${d}</option>`).join("")}</select></label>
          <label>Account @<input name="account" type="text" value="${esc(st.account)}" size="16"></label>
          <details class="fa-more"><summary>Audience lists (hashtags)</summary>
            ${Object.keys(AUDIENCE_NAMES).map(k => `<label class="ig-aud">${AUDIENCE_NAMES[k]}<textarea name="aud_${k}" rows="2">${esc(st.audiences[k] || "")}</textarea></label>`).join("")}
          </details>
          <p class="muted fa-small">Instagram must be logged in as @${esc(st.account)} in the same Edge browser. "Share to Facebook" is switched off on every post, so nothing lands on your personal Facebook.</p>
          <button class="btn btn-ghost btn-sm" type="submit">Save Instagram settings</button>
        </form>
      </section>

      ${recent.length ? `<section class="fa-card"><header><h2>Recent Instagram posts</h2></header><ul class="fa-list">${recent.map(x => `<li class="${x.ok ? "" : "bad"}"><span>${x.ok ? "✓" : "✗"} ${x.spot ? "★ " : ""}${esc(names[x.k] || x.k)}</span><small>${esc(x.d)}${x.why ? " · " + esc(x.why) : ""}</small></li>`).join("")}</ul></section>` : ""}`;
  }

  async function saveSettings(form) {
    const f = form.elements;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || lo));
    const aud = {};
    for (const k of Object.keys(AUDIENCE_NAMES)) aud[k] = f["aud_" + k].value.replace(/\s+/g, " ").trim();
    const next = { on: f.on.checked, daily_posts: clamp(f.daily_posts.value, 1, 10), spotlight_day: clamp(f.spotlight_day.value, 0, 6), account: f.account.value.replace(/^@/, "").trim() || "favisionent", audiences: aud };
    await save(s => { Object.assign(s.settings, next); return s; }, "Instagram autopilot: settings");
  }

  window.FAV_IGAUTO = { load, state: () => S, plan, job, receive, summary, growth, renderTab, saveSettings, label, pool, caption, _set: s => { S = normalise(s); } };
})();
