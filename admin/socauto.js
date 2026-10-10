// X (Twitter) and TikTok autopilot, run by the FA Vision add-on (extension/social.js).
// Same photos as Instagram (strategy ads and deal cards from igauto.js), with captions made
// for each network. Two ways to post, like Facebook and Instagram:
//   - the daily plan: `daily_posts` a day per network, least recently posted photos first,
//     one photo per product a day (Today tab → Run everything);
//   - Post now: the ticked products, any time (fbauto.js Post now tab). Those posts carry
//     now:true so they don't use up the daily plan.
// Log: data/social-autopilot.json { settings, posts: [{ d, t, net, k, p, ok, why, now }], runs }.
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/social-autopilot.json";
  const NETS = { x: "X", tiktok: "TikTok" };
  const EMPTY = {
    settings: {
      x: { on: true, daily_posts: 2, account: "FaVisionEnt" },
      tiktok: { on: true, daily_posts: 2 },
      pause_min_s: 90, pause_max_s: 240
    },
    posts: [], runs: []
  };
  const IG = () => window.FAV_IGAUTO;
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  let S = null;

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    const st = s.settings || {};
    s.settings = { ...EMPTY.settings, ...st, x: { ...EMPTY.settings.x, ...(st.x || {}) }, tiktok: { ...EMPTY.settings.tiktok, ...(st.tiktok || {}) } };
    s.posts = s.posts || [];
    s.runs = s.runs || [];
    return s;
  }
  async function load(force) { if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY)); return S; }
  async function save(mutate, message) { S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY)); }

  // Photos: the same pool as Instagram (strategy ads, deal cards and the AI Studio ad).
  const pool = () => (IG() ? IG().pool() : []);
  const shortName = p => String(p.name).split(" — ")[0];

  function caption(net, it, v, full) {
    if (window.FAV_CAPTIONS) return window.FAV_CAPTIONS.write(it.studio ? null : it.p, { net, ad: it.ad, studio: !!it.studio, full: !!full, subject: it.subject });
    const B = A.business();
    const site = location.origin + "/";
    if (it.studio) {
      return net === "x"
        ? `See your room before you buy ✨ Design it free with F.A Vision AI Studio, then order only what you love. ${site}studio #AccraFurniture #InteriorDesign`
        : `See your room before you buy it ✨\nDesign your room free with F.A Vision AI Studio: pick sofas, dining sets and wallpaper and see them in your space.\nLink in bio · WhatsApp ${C.localPhone(B.whatsapp)}\n#furnitureghana #accra #interiordesign #homedecor #fyp`;
    }
    const p = it.p, s = p.seller;
    const wa = C.localPhone((s && s.whatsapp) || B.whatsapp);
    const name = shortName(p);
    const price = C.formatPrice(p.price_ghs) + (p.negotiable ? " (negotiable)" : "");
    const page = `${site}p/${p.id}.html`;
    const hl = (p.highlights || []).slice(0, 2);
    const head = it.ad ? `${it.ad.headline} ${it.ad.accent}` : `${name} in stock`;
    if (net === "x") {
      const opts = [
        `${head} 🔥 ${name}: ${price}. WhatsApp ${wa} 👉 ${page} #FAVisionEnterprise #AccraFurniture`,
        `${name} at ${price}${hl[0] ? ` · ${hl[0]}` : ""}. Delivery across Accra. Order: ${page} #FurnitureGhana`,
        `Looking for ${/s$/i.test(name) ? "" : "a "}${name.toLowerCase()}? ${price} at F.A Vision, Odorkor. WhatsApp ${wa} ${page}`
      ];
      let t = opts[v % opts.length];
      if (t.length > 280) t = `${name}: ${price}. WhatsApp ${wa} ${page}`.slice(0, 280);
      return t;
    }
    const where = s ? `Sold by ${s.name}` : "Showroom: Odorkor, Accra · delivery available";
    const tags = s ? "#ghana #accra #fyp #ghanabusiness" : "#furnitureghana #accra #ghanatiktok #homedecor #fyp";
    if (full) {
      // Full description (used by "Post to all groups"): the product's own description, highlights and how to order.
      const desc = String(p.description || "").split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim().slice(0, 600);
      const cols = [].concat(p.colors || []);
      const extra = [p.dimensions && `Size: ${p.dimensions}`, p.material && `Material: ${p.material}`, cols.length && `Colours: ${cols.join(", ")}`].filter(Boolean);
      return [
        `${head} 🔥`,
        `${name}: ${price}`,
        desc,
        (p.highlights || []).slice(0, 4).map(h => "✔ " + h).join("\n"),
        extra.join("\n"),
        s ? `${where}. WhatsApp ${wa} to order.` : `${where}. Pay 50% now and the rest on delivery (MoMo, GhanaPay or card).`,
        `📲 WhatsApp ${wa} · link in bio`,
        tags
      ].filter(Boolean).join("\n").slice(0, 2000);
    }
    const opts = [
      `${head} 🔥\n${name}: ${price}\n${hl.map(h => "✔ " + h).join("\n")}\n${where}\nWhatsApp ${wa} · link in bio\n${tags}`,
      `POV: you just found ${/s$/i.test(name) ? "" : "the perfect "}${name.toLowerCase()} 😍\n${price}\n${where}\nOrder on WhatsApp ${wa}\n${tags}`,
      `${name} ✨ ${price}\n${hl.join(" · ")}\nPay 50% now, rest on delivery. WhatsApp ${wa}\n${tags}`
    ];
    return opts[v % opts.length].replace(/\n{2,}/g, "\n").trim();
  }
  const titleOf = it => it.seasonal ? String(it.subject || "").split(/[!.]/)[0].slice(0, 90) : window.FAV_CAPTIONS ? window.FAV_CAPTIONS.title(it.studio ? null : it.p, { net: "tiktok" }).slice(0, 90) : it.studio ? "Design your room free" : `${shortName(it.p)} · ${C.formatPrice(it.p.price_ghs)}`;

  // ------------------------------------------------------------------ what to post
  const ORDER = (items, keyOf, lastOf) => window.FAV_CAPTIONS && window.FAV_CAPTIONS.dailyOrder ? window.FAV_CAPTIONS.dailyOrder(items, keyOf, lastOf, 7) : items.slice().sort((a, b) => (lastOf(a) || "").localeCompare(lastOf(b) || ""));
  function plan(net) {
    const st = S.settings[net], d = today();
    const okToday = S.posts.filter(x => x.net === net && x.d === d && x.ok && !x.now);
    const room = st.on ? Math.max(0, st.daily_posts - okToday.length) : 0;
    const last = {};
    for (const x of S.posts) if (x.net === net && x.ok && (!last[x.k] || x.t > last[x.k])) last[x.k] = x.t;
    const used = new Set(okToday.map(x => x.p).filter(Boolean));
    const queue = [];
    // random order each day among photos not posted on this network in the last week
    for (const it of ORDER(pool(), i => net + ":" + i.k, i => last[i.k])) {
      if (queue.length >= room) break;
      if (it.p && used.has(it.p.id)) continue;   // one photo per product a day
      queue.push(it);
      if (it.p) used.add(it.p.id);
    }
    return { queue, room, done: okToday.length, target: st.daily_posts, on: st.on };
  }
  // opts: { products: [ids], limit, dry }
  function job(net, opts) {
    opts = opts || {};
    let q = plan(net).queue;
    if (opts.products) {
      const items = pool(), last = {};
      for (const x of S.posts) if (x.net === net && x.ok && x.p && (!last[x.p] || x.t > last[x.p])) last[x.p] = x.t;
      q = opts.products
        .map(id => { const lastK = {}; for (const x of S.posts) if (x.net === net && x.ok && (!lastK[x.k] || x.t > lastK[x.k])) lastK[x.k] = x.t;
          // rotate the designs: classic ad, tile, presence (least recently posted first)
          return items.filter(i => i.p && i.p.id === id && i.ad).sort((a, b) => (lastK[a.k] || "").localeCompare(lastK[b.k] || ""))[0] || items.find(i => i.k === "card:" + id); })
        .filter(Boolean)
        .sort((a, b) => (last[a.p.id] || "").localeCompare(last[b.p.id] || ""))
        .slice(0, Math.max(1, opts.limit || 2));
    }
    if (opts.keys) q = pool().filter(i => opts.keys.includes(i.k));
    if (opts.dry) q = (q.length ? q : pool()).slice(0, 1);
    if (!q.length) return null;
    const site = location.origin + "/", start = S.posts.filter(x => x.net === net).length;
    return {
      url: net === "x" ? "https://x.com/compose/post" : "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo",
      job: {
        kind: net, dry: !!opts.dry, mode: opts.products || opts.keys ? "now" : null, account: S.settings.x.account,
        q: q.map((it, i) => ({ k: it.k, p: it.p ? it.p.id : null, img: site + it.img, text: caption(net, it, start + i, !!opts.full), title: titleOf(it) })),
        min: S.settings.pause_min_s, max: S.settings.pause_max_s
      }
    };
  }

  async function receive(out) {
    const net = out.kind, d = today(), name = NETS[net];
    if (out.dry) {
      const r = out.res[0];
      return { text: r ? (r.ok ? `${name} test passed: ${r.why}.` : `${name} test failed: ${r.why}`) : `${name} test stopped. ${out.stopped || ""}`, bad: !r || !r.ok };
    }
    const ok = out.res.filter(r => r.ok).length;
    await save(s => {
      for (const r of out.res) s.posts.push({ d, t: r.t, net, k: r.k, p: r.p, ok: r.ok, ...(out.mode === "now" ? { now: true } : {}), ...(r.why ? { why: r.why } : {}) });
      s.runs = s.runs.concat([{ d, t: new Date().toISOString(), kind: net, tried: out.res.length, ok, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-200);
      s.posts = s.posts.slice(-2000);
      return s;
    }, `${name} autopilot: posted ${ok} of ${out.res.length}`);
    return { text: `${name}: posted ${plural(ok, "photo")}${out.res.length - ok ? `, ${out.res.length - ok} skipped` : ""}.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped };
  }

  function summary(net) {
    if (!S) return null;
    const pl = plan(net);
    return { on: pl.on, done: pl.done, target: pl.target, waiting: pl.queue.length, mins: Math.round(pl.queue.length * (2 + (S.settings.pause_min_s + S.settings.pause_max_s) / 120)) };
  }

  // ------------------------------------------------------------------ tab
  function renderTab() {
    if (!S) return `<p class="muted">Loading…</p>`;
    const mode = document.documentElement.dataset.favautoMode;
    const label = it => (IG() ? IG().label(it) : it.k);
    const recent = S.posts.slice(-20).reverse();
    const byK = Object.fromEntries(pool().map(i => [i.k, i]));
    const card = net => {
      const st = S.settings[net], sm = summary(net);
      return `<section class="fa-card">
        <header><h2>${NETS[net]}</h2><span class="fa-big ${sm.waiting ? "hot" : ""}">${sm.done}/${sm.target}</span></header>
        <p class="muted">${net === "x" ? `Posts on @${esc(st.account)} at x.com: photo + a short caption with price, WhatsApp and the product link.` : "Photo posts from TikTok Studio (Upload → Photos) with a title and a description with hashtags."} Daily plan: ${plural(st.daily_posts, "post")} a day. The Post now tab posts the products you tick, any time.</p>
        <div class="fa-actions">
          <button class="btn btn-sell" data-soc="${net}" ${sm.waiting ? "" : "disabled"}>${sm.waiting ? `Post today's ${sm.waiting} on ${NETS[net]}` : "Done for today ✓"}</button>
          <button class="btn btn-ghost" data-soc-test="${net}">Test without posting</button>
        </div>
      </section>`;
    };
    return `${mode !== "live" ? `<p class="fa-ext bad">✗ X and TikTok need the add-on's automatic updates switched on (Today tab, top). Without them it can't download its X/TikTok part.</p>` : ""}
      ${trendsCard()}
      ${card("x")}${card("tiktok")}
      <section class="fa-card">
        <header><h2>Settings</h2></header>
        <form class="fa-settings" id="soc-settings">
          <label class="fa-check"><input name="x_on" type="checkbox" ${S.settings.x.on ? "checked" : ""}> Post on X in the daily run</label>
          <label>X posts a day <input name="x_daily" type="number" min="1" max="10" value="${S.settings.x.daily_posts}"></label>
          <label>X account (without @) <input name="x_account" type="text" value="${esc(S.settings.x.account)}"></label>
          <label class="fa-check"><input name="tt_on" type="checkbox" ${S.settings.tiktok.on ? "checked" : ""}> Post on TikTok in the daily run</label>
          <label>TikTok posts a day <input name="tt_daily" type="number" min="1" max="10" value="${S.settings.tiktok.daily_posts}"></label>
          <button class="btn btn-ghost btn-sm" type="submit">Save settings</button>
        </form>
      </section>
      ${recent.length ? `<section class="fa-card"><header><h2>Recent X and TikTok posts</h2></header><ul class="fa-list">${recent.map(x => `<li class="${x.ok ? "" : "bad"}"><span>${x.ok ? "✓" : "✗"} ${NETS[x.net]} · ${esc(byK[x.k] ? label(byK[x.k]) : x.k)}</span><small>${esc(x.d)}${x.now ? " · post now" : ""}${x.why ? " · " + esc(x.why) : ""}</small></li>`).join("")}</ul></section>` : ""}`;
  }
  // Today's trending hashtags (data/trends.json via admin/captions.js), used in every caption.
  function trendsCard() {
    const CAP = window.FAV_CAPTIONS;
    if (!CAP || !CAP.trends) return "";
    const T = CAP.trends(), day = today();
    const chips = a => (a || []).length ? a.map(t => `<code>${esc(t)}</code>`).join(" ") : `<span class="muted">none yet</span>`;
    const rows = T && T.nets ? [["X", T.nets.x], ["TikTok", T.nets.tiktok], ["Instagram", T.nets.instagram], ["Facebook", T.nets.facebook]] : [];
    const aud = [["Ghanaians", "ghana"], ["Expats in Ghana", "expats"], ["Ghanaians abroad", "diaspora"], ["Travellers to Ghana", "travel"]];
    return `<section class="fa-card">
      <header><h2>Trending hashtags</h2><span class="muted fa-small">${T && T.d ? (T.d === day ? "checked today" : "last checked " + esc(T.d)) : "not checked yet"}</span></header>
      <p class="muted">Every post mixes in today's trending tags for its network (trending tag first on X), plus tags for Ghanaians, expats in Ghana, Ghanaians abroad and travellers to Ghana. Only trends that are safe and fit a home and furniture brand are kept: no politics, tragedies or other brands' campaigns, so the posts aren't marked as spam.</p>
      ${rows.length ? `<ul class="fa-list">${rows.map(([n, a]) => `<li><span><b>${n}</b> ${chips(a)}</span></li>`).join("")}</ul>` : ""}
      <ul class="fa-list">${aud.map(([n, k]) => `<li><span><b>${n}</b> ${chips(((T && T.audiences) || {})[k] && T.audiences[k].length ? T.audiences[k] : CAP.AUDIENCE[k])}</span></li>`).join("")}</ul>
      <div class="fa-actions"><button class="btn btn-ghost btn-sm" data-trends-refresh>↻ Check trends now</button></div>
      <p class="muted fa-small">Checked automatically once a day when you open the Social autopilot.</p>
    </section>`;
  }
  document.addEventListener("click", async e => {
    const b = e.target.closest && e.target.closest("[data-trends-refresh]");
    if (!b || !window.FAV_CAPTIONS) return;
    A.busy("Checking today's trends on X, TikTok, Instagram and Facebook…");
    try { await window.FAV_CAPTIONS.loadTrends(true); A.busy(null); A.toast("Trends updated ✓"); }
    catch (err) { A.busy(null); return A.toast(/unknown|no_ai_key|not.*action/i.test(String(err && err.message)) ? "The backend needs updating first (see the note from Claude), or it has no AI key." : A.friendly(err), true); }
    const tab = document.querySelector("[data-fa-tab][aria-selected=true]"); if (tab) tab.click();
  });
  async function saveSettings(form) {
    const f = form.elements, clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || lo));
    await save(s => {
      s.settings.x = { ...s.settings.x, on: f.x_on.checked, daily_posts: clamp(f.x_daily.value, 1, 10), account: f.x_account.value.replace(/^@/, "").trim() || "FaVisionEnt" };
      s.settings.tiktok = { ...s.settings.tiktok, on: f.tt_on.checked, daily_posts: clamp(f.tt_daily.value, 1, 10) };
      return s;
    }, "X/TikTok autopilot: settings");
  }

  window.FAV_SOCAUTO = { NETS, load, state: () => S, plan, job, receive, summary, renderTab, saveSettings, caption, _set: s => { S = normalise(s); } };
})();
