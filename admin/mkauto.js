// Marketplace sync (Social autopilot → "Marketplace" tab).
//   Scan my listings  – the add-on (extension/marketplace.js, job "mkscan") reads every listing on
//                       Facebook's "Your listings": title, price, status, listed date, item id and
//                       whether Renew is ready. Saved to data/marketplace-scan.json.
//   The tab matches the listings to data/products.json (by the facebook_listings ids the products
//   already keep, then by a fuzzy title match) and shows:
//     - products not on Marketplace, with "List on Marketplace" (one, or all missing, one at a time)
//     - price differences between the site and Marketplace (never edits Facebook: "Use this price on
//       the site" commits the Marketplace price, or open the listing to change it there)
//     - duplicates (same title listed several times): report only, never deleted
//     - how many listings can be renewed now, with the existing Renew button
//     - listings not linked to any product (link one with a tap)
//   Buyer messages    – the add-on (job "mkinbox") reads the Marketplace inbox (selling side). Threads
//                       stay in this browser only (localStorage "fa-mk-inbox"), never in the repo.
//                       Each gets a reply draft from the product's facts (or an AI draft through the
//                       backend "muse" action on request) to edit, copy and send by hand. Never auto-sent.
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/marketplace-scan.json";
  const SITE = "https://favisionenterprize.github.io/";
  const EMPTY = {
    settings: { scan_in_run: true, list_in_run: false, list_per_run: 3, gap_min_s: 30, gap_max_s: 60, menus: true, inbox_max: 20, photos: 8 },
    scan: null, listed: [], runs: [], skip: []
  };
  const INBOX_KEY = "fa-mk-inbox";
  const F = () => window.FAV_FBAUTO;
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const money = n => n == null ? "?" : C.formatPrice(n);
  const shortName = p => String(p.name).split(" — ")[0];
  const fbItem = id => `https://www.facebook.com/marketplace/item/${encodeURIComponent(id)}/`;
  const fbEdit = id => `https://www.facebook.com/marketplace/edit/?listing_id=${encodeURIComponent(id)}`;
  const SELLING = "https://www.facebook.com/marketplace/you/selling";
  const safeUrl = u => /^https:\/\/(www|web|m)\.facebook\.com\//.test(String(u || "")) ? String(u) : SELLING;
  let S = null, inbox = null, drafts = {};

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    s.settings = { ...EMPTY.settings, ...(s.settings || {}) };
    s.listed = s.listed || []; s.runs = s.runs || []; s.skip = s.skip || [];
    return s;
  }
  async function load(force) { if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY)); return S; }
  async function save(mutate, message) { S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY)); }
  function readInbox() {
    try { const v = JSON.parse(localStorage.getItem(INBOX_KEY) || "null"); return v && Array.isArray(v.threads) ? v : null; } catch (e) { return null; }
  }
  function writeInbox(v) { inbox = v; try { if (v) localStorage.setItem(INBOX_KEY, JSON.stringify(v)); else localStorage.removeItem(INBOX_KEY); } catch (e) { /* storage blocked: kept for this visit only */ } }

  // ------------------------------------------------------------------ matching listings to products
  const STOP = new Set("a an and the for with of in on to at is are our now new very strong premium quality available just only gh ghs ghc cedis price sale buy sell selling".split(" "));
  function tokens(s) {
    return String(s || "").toLowerCase()
      .replace(/dinn?ing/g, "dining").replace(/sofasets?/g, "sofa set").replace(/centre|center/g, "centre").replace(/wardrobes?/g, "wardrobe")
      .replace(/gh[₵¢]?\s?[\d,]+/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
      .map(w => w.length > 3 ? w.replace(/(es|s)$/, "") : w).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
  }
  function sim(a, b) {
    const A1 = new Set(tokens(a)), B1 = new Set(tokens(b));
    if (!A1.size || !B1.size) return 0;
    let inter = 0; A1.forEach(t => { if (B1.has(t)) inter++; });
    return 0.6 * inter / Math.min(A1.size, B1.size) + 0.4 * inter / new Set([...A1, ...B1]).size;
  }
  const dupKey = t => tokens(t).sort().join(" ");
  const sellable = l => !/sold|draft/i.test(l.status || "");
  const listable = p => !p.placeholder && p.price_ghs && (p.images || []).length;
  function productFor(l, list) {
    list = list || A.products();
    if (l.id) { const p = list.find(x => (x.facebook_listings || []).some(f => String(f.id) === String(l.id))); if (p) return { p, how: "id", score: 1 }; }
    let best = null;
    for (const p of list) {
      if (p.placeholder) continue;
      const titles = [shortName(p), p.name].concat((p.facebook_listings || []).map(f => f.title));
      let sc = Math.max(...titles.map(t => sim(l.t, t)));
      if (l.price != null && Number(l.price) === Number(p.price_ghs)) sc += 0.08;
      if ((p.facebook_listings || []).some(f => String(f.title || "").trim().toLowerCase() === String(l.t || "").trim().toLowerCase())) sc += 0.2;   // the exact title this product was listed under before
      if (!best || sc > best.score) best = { p, how: "title", score: sc };
    }
    return best && best.score >= 0.55 ? best : null;
  }
  function analyse() {
    const list = A.products();
    const listings = (S && S.scan && S.scan.listings) || [];
    const rows = listings.map((l, i) => ({ ...l, i, m: productFor(l, list) }));
    const active = rows.filter(sellable);
    const onFb = new Set(active.filter(r => r.m).map(r => r.m.p.id));
    const missing = list.filter(p => listable(p) && !onFb.has(p.id) && !S.skip.includes(p.id));
    const mismatch = active.filter(r => r.m && r.price != null && Number(r.price) !== Number(r.m.p.price_ghs));
    const groups = {};
    active.forEach(r => { const k = dupKey(r.t); if (k) (groups[k] = groups[k] || []).push(r); });
    const dups = Object.values(groups).filter(g => g.length > 1).sort((a, b) => b.length - a.length);
    const unmatched = active.filter(r => !r.m);
    const ready = active.filter(r => r.renew === "ready");
    const waiting = active.filter(r => r.renew === "wait");
    const next = waiting.map(r => r.next).filter(Boolean).sort()[0] || null;
    return { rows, active, missing, mismatch, dups, unmatched, ready, waiting, next, scanned: !!(S && S.scan) };
  }

  // ------------------------------------------------------------------ listing text and category
  function categoriesFor(p) {
    const m = String(p.marketplace_category || "") + " " + (p.category || "");
    if (/wallpaper|home decor|walls/i.test(m)) return ["Household", "Home decor", "Furniture"];
    if (/electronics|tv/i.test(m)) return ["Electronics & computers", "Electronics", "Household"];
    if (/appliance/i.test(m)) return ["Appliances", "Household"];
    if (/office supplies|printing|stationery/i.test(m)) return ["Office supplies", "Household"];
    if (/home improvement|plumbing|flooring|tiles/i.test(m)) return ["Home improvement supplies", "Household"];
    if (/groceries/i.test(m)) return ["Household", "Miscellaneous"];
    return ["Furniture", "Household"];
  }
  function description(p) {
    const W = window.FAV_CAPTIONS;
    let t = W ? W.write(p, { net: "share" }) : (A.marketplaceText ? A.marketplaceText(p) : p.description);
    t = String(t).split("\n").filter(l => !/where are you (seeing|watching)|which town are you|comment where you|tell us where you('|’)re/i.test(l)).join("\n");
    return t.replace(/\n{3,}/g, "\n\n").trim() + `\n\nOrder or see more: ${SITE}p/${p.id}.html`;
  }
  function listItem(p) {
    return {
      p: p.id, title: String(p.name).slice(0, 99), price: Number(p.price_ghs), cats: categoriesFor(p), cond: "New",
      text: description(p), loc: "Odorkor", imgs: (p.images || []).slice(0, S.settings.photos).map(x => SITE + String(x).replace(/^\//, ""))
    };
  }

  // ------------------------------------------------------------------ jobs for the add-on
  function ready(then) {
    const f = F();
    if (!f || f.needExt()) return false;
    if (!f.liveAddon()) {
      A.toast("Marketplace sync needs the add-on's automatic updates switched on (Today tab, top).", true);
      if (then && then.length) setTimeout(() => f.runStep(then, true), 1500);
      return false;
    }
    return true;
  }
  function startScan(then) {
    if (!ready(then)) return;
    F().launch(SELLING, { kind: "mkscan", menus: S.settings.menus, then: then && then.length ? then : null });
  }
  // ids = product ids (null: the missing ones, up to list_per_run). opts.dry = test, stops before Publish.
  function startList(ids, opts, then) {
    opts = opts || {};
    const an = analyse();
    let prods = ids ? A.products().filter(p => ids.includes(p.id) && listable(p)) : an.missing.slice(0, S.settings.list_per_run);
    if (opts.dry) prods = prods.slice(0, 1);
    if (!prods.length) { A.toast(ids ? "That product can't be listed (it needs a price and a photo)." : "Every product is on Marketplace ✓"); if (then && then.length && F()) setTimeout(() => F().runStep(then, true), 1200); return; }
    if (!ready(then)) return;
    const q = prods.map(listItem);
    F().launch("https://www.facebook.com/marketplace/create/item", { kind: "mklist", q, dry: !!opts.dry, min: S.settings.gap_min_s, max: S.settings.gap_max_s, maxHops: 10 + q.length * 4, then: then && then.length ? then : null });
  }
  function startInbox(then) {
    if (!ready(then)) return;
    F().launch("https://www.facebook.com/marketplace/inbox/", { kind: "mkinbox", max: S.settings.inbox_max, then: then && then.length ? then : null });
  }
  const scanWaiting = () => !!S && S.settings.scan_in_run && (!S.scan || S.scan.d !== today());
  const listWaiting = () => !!S && S.settings.list_in_run && !!S.scan && analyse().missing.length > 0 && !S.listed.some(x => x.d === today() && !x.dry);

  async function receive(out) {
    const d = today(), res = out.res || [];
    if (out.kind === "mkscan") {
      if (!res.length) return { text: "Marketplace scan: " + (out.stopped || "no listings read."), bad: true };
      const listings = res.map(r => ({ t: r.t, price: r.price, status: r.status || "", listed: r.listed || null, ...(r.id ? { id: r.id } : {}), ...(r.renew ? { renew: r.renew } : {}), ...(r.next ? { next: r.next } : {}) }));
      await save(s => {
        s.scan = { d, t: new Date().toISOString(), n: listings.length, listings };
        s.runs = s.runs.concat([{ d, kind: "scan", n: listings.length, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
        return s;
      }, `Marketplace sync: read ${listings.length} listings`);
      const an = analyse();
      return { text: `Read ${plural(listings.length, "listing")}: ${an.missing.length} products not on Marketplace, ${plural(an.mismatch.length, "price difference")}, ${plural(an.dups.length, "duplicate group")}, ${an.ready.length} ready to renew.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped };
    }
    if (out.kind === "mklist") {
      const ok = res.filter(r => r.ok && !r.dry);
      await save(s => {
        s.listed = s.listed.concat(res.map(r => ({ d, t: r.t, p: r.p, title: r.title, price: r.price, ok: !!r.ok, ...(r.dry ? { dry: true } : {}), ...(r.id ? { id: r.id } : {}), ...(r.verified != null ? { verified: r.verified } : {}), ...(r.why ? { why: r.why } : {}) }))).slice(-300);
        if (s.scan) s.scan.listings = s.scan.listings.concat(ok.map(r => ({ t: r.title, price: r.price, status: "Active", listed: d, ...(r.id ? { id: r.id } : {}), renew: "wait" })));
        s.runs = s.runs.concat([{ d, kind: "list", tried: res.length, ok: ok.length, ...(out.dry ? { dry: true } : {}), ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
        return s;
      }, out.dry ? "Marketplace sync: listing test" : `Marketplace sync: listed ${ok.length} of ${res.length} products`);
      // Link new listings to their products (so price sync and the next scan know them).
      const withId = ok.filter(r => r.id);
      if (withId.length) {
        try {
          await A.commit({ message: `Marketplace: link ${plural(withId.length, "new listing")}`, mutate: list => list.map(p => {
            const mine = withId.filter(r => r.p === p.id);
            if (!mine.length) return p;
            const have = new Set((p.facebook_listings || []).map(f => String(f.id)));
            return { ...p, facebook_listings: (p.facebook_listings || []).concat(mine.filter(r => !have.has(String(r.id))).map(r => ({ id: String(r.id), title: r.title, price: r.price, checked: d, synced: d }))) };
          }) });
        } catch (err) { A.toast("Listed, but couldn't link the new listings to the products: " + A.friendly(err), true); }
      }
      if (out.dry) { const r = res[0]; return { text: r ? (r.ok ? "Test passed: " + r.why : "Test failed: " + r.why) : "Test stopped. " + (out.stopped || ""), bad: !r || !r.ok }; }
      const bad = res.filter(r => !r.ok);
      return { text: `Listed ${plural(ok.length, "product")} on Marketplace${bad.length ? `, ${bad.length} not published (${bad.map(r => r.why).filter(Boolean).slice(0, 2).join("; ")})` : " ✓"}.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped || !!bad.length };
    }
    if (out.kind === "mkinbox") {
      // Buyer threads stay in this browser: never written to the repo.
      const threads = (out.threads || []).slice(0, 50).map(t => ({
        url: safeUrl(t.url), name: String(t.name || "").slice(0, 80), listing: String(t.listing || "").slice(0, 100), snippet: String(t.snippet || "").slice(0, 200),
        unread: !!t.unread, locked: !!t.locked, msgs: (t.msgs || []).slice(-6).map(m => ({ me: !!m.me, text: String(m.text || "").slice(0, 300) }))
      }));
      writeInbox({ t: new Date().toISOString(), threads, locked: out.locked || 0 });
      drafts = {};
      return { text: `Read ${plural(threads.filter(t => !t.locked).length, "buyer conversation")}${out.locked ? ` (${out.locked} PIN-locked, skipped)` : ""}. Drafts are ready to edit; nothing was sent.${out.stopped ? " Stopped: " + out.stopped : ""}`, bad: !!out.stopped };
    }
    return { text: "", bad: false };
  }

  // ------------------------------------------------------------------ reply drafts (template from product facts, or AI)
  function threadProduct(t) {
    const text = [t.listing, t.snippet].concat((t.msgs || []).map(m => m.text)).join(" ");
    let best = null;
    for (const p of A.products()) {
      if (p.placeholder) continue;
      const titles = [shortName(p)].concat((p.facebook_listings || []).map(f => f.title));
      const sc = Math.max(...titles.map(x => sim(t.listing || text, x)));
      if (!best || sc > best.sc) best = { p, sc };
    }
    return best && best.sc >= 0.45 ? best.p : null;
  }
  function bulkLine(p) {
    const h = (p.highlights || []).find(x => /bulk|wholesale/i.test(x) && /\d/.test(x));
    return h ? h.replace(/^bulk discount:\s*/i, "Bulk price: ") : "";
  }
  function templateDraft(t) {
    const p = threadProduct(t), B = A.business() || {};
    const first = String(t.name || "").trim().split(/\s+/)[0] || "there";
    const last = ((t.msgs || []).filter(m => !m.me).pop() || {}).text || t.snippet || "";
    const s = p && p.seller;
    const wa = C.localPhone ? C.localPhone((s && s.whatsapp) || B.whatsapp || "+233572646176") : "057 264 6176";
    const phones = [].concat((s && s.phones) || B.phones || []).map(x => C.localPhone ? C.localPhone(x) : x).filter(x => x !== wa).slice(0, 2).join(" / ");
    const lines = [`Hi ${first}, thank you for your message${p ? ` about the ${shortName(p)}` : ""}! 🙏`];
    if (p) {
      lines.push(p.in_stock === false ? "It's currently out of stock, but we can take your order." : p.custom_order ? "Yes, we take orders for it (custom sizes and colours available)." : "Yes, it's available and in stock.");
      lines.push(`Price: ${money(p.price_ghs)}${p.negotiable ? " (slightly negotiable)" : ""}.${bulkLine(p) ? " " + bulkLine(p) + "." : ""}`.replace(/\.\./g, "."));
    }
    if (/deliver|transport|bring|kumasi|tema|kasoa|location|where/i.test(last)) lines.push(B.delivery_note || "We deliver across Accra and beyond (fee depends on location).");
    lines.push(s ? `For orders call ${phones || wa} or WhatsApp ${wa}.` : `You're welcome to see it at our showroom: Tarazzo Road, Odorkor (opposite Pacific), Accra. Call ${phones || "020 747 3267"} or WhatsApp ${wa}.`);
    if (p) lines.push(`Photos and details: ${SITE}p/${p.id}.html`);
    return lines.join("\n");
  }
  async function aiDraft(i) {
    const t = inbox && inbox.threads[i];
    if (!t) return;
    const p = threadProduct(t);
    const facts = p ? `Product: ${p.name}. Price ${money(p.price_ghs)}${p.negotiable ? " (negotiable)" : ""}. ${p.in_stock === false ? "Out of stock." : "In stock."} ${bulkLine(p)} Link ${SITE}p/${p.id}.html.${p.seller ? ` Sold by ${p.seller.name}: phones ${[].concat(p.seller.phones || []).join(", ")}, WhatsApp ${p.seller.whatsapp || ""}.` : " Showroom: Tarazzo Road, Odorkor (opposite Pacific), Accra."}` : "Product: unknown (ask which item they mean).";
    const convo = (t.msgs || []).map(m => (m.me ? "Us: " : "Buyer: ") + m.text).join("\n") || ("Buyer: " + t.snippet);
    A.busy("Asking your AI for a reply draft…");
    try {
      const r = await A.backendSigned({ action: "muse", mode: "content", context: facts, messages: [{ role: "user", text: `Write ONE short, friendly Facebook Marketplace reply (max 80 words, plain text, no hashtags) to this buyer. Use only these facts and never invent prices or stock.\n\n${convo}` }] });
      if (r.ok && r.text) { drafts[i] = String(r.text).trim(); render(); A.toast("AI draft ready: check it before you send it."); }
      else A.toast(r.error === "no_session" ? "AI drafts need the email sign-in. The template draft is still there." : r.error === "no_ai_key" ? "Your backend has no AI key: use the template draft." : "The AI didn't answer: " + (r.error || "unknown"), true);
    } catch (err) { A.toast("Couldn't reach the backend: " + A.friendly(err), true); }
    finally { A.busy(null); }
  }

  // ------------------------------------------------------------------ screen
  const img = p => `<img src="../${esc((p.images || [])[0] || "")}" alt="" width="40" height="30" loading="lazy">`;
  function renderTab() {
    if (!S) return `<p class="muted">Loading…</p>`;
    const an = analyse(), st = S.settings, sc = S.scan;
    const live = F() && F().liveAddon();
    const prods = A.products().filter(p => !p.placeholder);
    inbox = inbox || readInbox();
    const lastList = S.listed.slice(-12).reverse();
    return `${live ? "" : `<p class="fa-ext bad">✗ Marketplace sync needs the add-on's automatic updates switched on (Today tab, top). Scanning, listing and reading messages run in the add-on's live scripts.</p>`}
      <section class="fa-card">
        <header><h2>Marketplace sync</h2><span class="fa-big ${an.scanned && (an.missing.length || an.mismatch.length) ? "hot" : ""}">${an.scanned ? an.active.length : "?"}</span></header>
        <p class="muted">Reads every listing on Facebook's <b>Your listings</b> and compares it with your website: what's missing, prices that differ, duplicates and renewals. Facebook is never changed by the scan. Make sure Facebook is on your personal profile (Pages can't use Marketplace).</p>
        ${sc ? `<p class="muted fa-small">Last scan ${esc(sc.d)}: ${plural(sc.n, "listing")} (${an.active.length} active), ${prods.length - an.missing.length - S.skip.length} of ${prods.length} products on Marketplace.</p>` : `<p class="fa-empty">Not scanned yet. Press <b>Scan my listings</b>.</p>`}
        <div class="fa-actions"><button class="btn btn-primary" data-mk="scan">🔎 Scan my listings</button></div>
      </section>

      <section class="fa-card" id="mk-missing">
        <header><h2>Not on Marketplace</h2><span class="fa-big ${an.missing.length ? "hot" : ""}">${an.scanned ? an.missing.length : "?"}</span></header>
        ${!an.scanned ? `<p class="fa-empty">Scan first to see which products aren't listed.</p>` : !an.missing.length ? `<p class="fa-empty">Every product is on Marketplace ✓</p>` : `
          <ul class="fa-list mk-list">${an.missing.map(p => `<li data-mk-row="${esc(p.id)}"><span>${img(p)} ${esc(shortName(p))}${p.seller ? ` <small class="muted">· ${esc(p.seller.name)}</small>` : ""}</span><span class="now-right"><small>${esc(money(p.price_ghs))} · ${(p.images || []).length} photos</small><button type="button" class="btn btn-sell btn-sm" data-mk-list="${esc(p.id)}">List on Marketplace</button><button type="button" class="btn btn-ghost btn-sm" data-mk-skip="${esc(p.id)}" title="Leave it off this list">Don't list</button></span></li>`).join("")}</ul>
          <div class="fa-actions"><button class="btn btn-sell" data-mk="listall">List all ${an.missing.length} missing</button><button class="btn btn-ghost" data-mk="test">Test without publishing</button></div>
          <p class="muted fa-small">One at a time, ${st.gap_min_s}–${st.gap_max_s} s apart, in this Edge tab: photos, title, price, category, condition New, a fresh description ending with the product link, location Odorkor. No groups, no Boost. A listing is never published if its photos didn't attach, and the run stops at once on any Facebook warning. Partner products keep their seller's contacts.</p>`}
        ${S.skip.length ? `<p class="muted fa-small">Left off on purpose: ${S.skip.map(id => `${esc(id)} <button type="button" class="btn btn-ghost btn-sm" data-mk-unskip="${esc(id)}">undo</button>`).join(" ")}</p>` : ""}
      </section>

      <section class="fa-card" id="mk-prices">
        <header><h2>Price differences</h2><span class="fa-big ${an.mismatch.length ? "hot" : ""}">${an.scanned ? an.mismatch.length : "?"}</span></header>
        ${!an.scanned ? `<p class="fa-empty">Scan first.</p>` : !an.mismatch.length ? `<p class="fa-empty">Site and Marketplace prices match ✓</p>` : `
          <p class="muted fa-small">Facebook is never edited from here. Either use the Marketplace price on the website, or open the listing and change it on Facebook.</p>
          <ul class="fa-list mk-list">${an.mismatch.map(r => `<li><span>${esc(r.t)} <small class="muted">→ ${esc(shortName(r.m.p))}</small></span><span class="now-right"><small>site <b>${esc(money(r.m.p.price_ghs))}</b> · Marketplace <b>${esc(money(r.price))}</b></small>
            <button type="button" class="btn btn-ghost btn-sm" data-mk-price="${r.i}">Use ${esc(money(r.price))} on the site</button>
            <a class="btn btn-ghost btn-sm" href="${esc(r.id ? fbEdit(r.id) : SELLING)}" target="_blank" rel="noopener">Open listing to edit</a></span></li>`).join("")}</ul>`}
      </section>

      <section class="fa-card" id="mk-dups">
        <header><h2>Duplicates</h2><span class="fa-big">${an.scanned ? an.dups.length : "?"}</span></header>
        ${!an.scanned ? `<p class="fa-empty">Scan first.</p>` : !an.dups.length ? `<p class="fa-empty">No title is listed more than once ✓</p>` : `
          <p class="muted fa-small">The same title listed several times. Report only: nothing is deleted. Facebook may hide repeated listings, so consider marking the extra ones as sold or deleting them yourself.</p>
          ${an.dups.map(g => `<details class="fa-more"><summary>${esc(g[0].t)} · listed ${g.length} times</summary><ul class="fa-list">${g.map(r => `<li><span>${r.id ? `<a href="${esc(fbItem(r.id))}" target="_blank" rel="noopener">${esc(r.t)}</a>` : esc(r.t)}</span><small>${esc(money(r.price))} · listed ${esc(r.listed || "?")}${r.status ? " · " + esc(r.status) : ""}</small></li>`).join("")}</ul></details>`).join("")}`}
      </section>

      <section class="fa-card">
        <header><h2>Ready to renew</h2><span class="fa-big ${an.ready.length ? "hot" : ""}">${an.scanned ? an.ready.length : "?"}</span></header>
        <p class="muted">${!an.scanned ? "Scan first (or just press Renew: it checks every listing itself)." : st.menus ? `${plural(an.ready.length, "listing")} can be renewed now${an.waiting.length ? `, ${an.waiting.length} later${an.next ? ` (next on ${esc(an.next)})` : ""}` : ""}.` : "The scan doesn't open the renew menus (switched off in settings)."}</p>
        <div class="fa-actions"><button class="btn btn-sell" data-mk="renew">Renew listings now</button></div>
      </section>

      ${an.unmatched.length ? `<section class="fa-card" id="mk-unmatched">
        <header><h2>Listings not linked to a product</h2><span class="fa-big">${an.unmatched.length}</span></header>
        <p class="muted fa-small">Pick the product a listing sells, so its price is compared from now on.</p>
        <ul class="fa-list mk-list">${an.unmatched.map(r => `<li><span>${r.id ? `<a href="${esc(fbItem(r.id))}" target="_blank" rel="noopener">${esc(r.t)}</a>` : esc(r.t)}</span><span class="now-right"><small>${esc(money(r.price))}</small>
          ${r.id ? `<select data-mk-link="${r.i}" aria-label="Product for this listing"><option value="">Link to…</option>${prods.map(p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(shortName(p))}</option>`).join("")}</select>` : `<small class="muted">no item id read</small>`}</span></li>`).join("")}</ul>
      </section>` : ""}

      <section class="fa-card" id="mk-inbox">
        <header><h2>Buyer messages</h2>${inbox ? `<span class="muted fa-small">Read ${esc(new Date(inbox.t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</span>` : ""}</header>
        <p class="muted">Reads your Marketplace inbox (selling) and writes a reply draft for each buyer from the product's facts. <b>Nothing is ever sent</b>: edit the draft, copy it, open the chat and send it yourself. Conversations stay in this browser only; they are never saved to your website.</p>
        <div class="fa-actions"><button class="btn btn-primary" data-mk="inbox">📥 Read buyer messages</button>${inbox ? `<button class="btn btn-ghost btn-sm" data-mk="forget">Forget these conversations</button>` : ""}</div>
        ${inbox && inbox.locked ? `<p class="muted fa-small">🔒 ${plural(inbox.locked, "chat")} locked with your Messenger PIN: open them in Messenger yourself.</p>` : ""}
        ${inbox ? (inbox.threads.filter(t => !t.locked).length ? inbox.threads.map((t, i) => t.locked ? "" : `<div class="mk-thread${t.unread ? " unread" : ""}">
          <div class="mk-thread-head"><b>${esc(t.name || "Buyer")}</b>${t.listing ? ` <small class="muted">· ${esc(t.listing)}</small>` : ""}</div>
          <ul class="mk-msgs">${(t.msgs.length ? t.msgs : [{ me: false, text: t.snippet }]).filter(m => m.text).map(m => `<li class="${m.me ? "me" : ""}"><small>${m.me ? "You" : "Buyer"}</small> ${esc(m.text)}</li>`).join("")}</ul>
          <label class="mk-draft">Reply draft<textarea rows="5" data-mk-draft="${i}">${esc(drafts[i] != null ? drafts[i] : templateDraft(t))}</textarea></label>
          <div class="fa-actions"><button type="button" class="btn btn-sell btn-sm" data-mk-copy="${i}">Copy</button><button type="button" class="btn btn-ghost btn-sm" data-mk-ai="${i}">✨ AI draft</button><a class="btn btn-ghost btn-sm" href="${esc(safeUrl(t.url))}" target="_blank" rel="noopener">Open thread</a></div>
        </div>`).join("") : `<p class="fa-empty">No buyer conversations found.</p>`) : ""}
      </section>

      <section class="fa-card">
        <header><h2>Settings</h2></header>
        <form class="fa-settings" id="mk-settings">
          <label class="fa-check"><input type="checkbox" name="scan_in_run" ${st.scan_in_run ? "checked" : ""}> Scan my listings in the daily run (after renewals)</label>
          <label class="fa-check"><input type="checkbox" name="list_in_run" ${st.list_in_run ? "checked" : ""}> List missing products in the daily run</label>
          <label>Products listed per run <input name="list_per_run" type="number" min="1" max="20" value="${st.list_per_run}"></label>
          <label>Seconds between listings, from <input name="gap_min_s" type="number" min="30" max="600" value="${st.gap_min_s}"></label>
          <label>… to <input name="gap_max_s" type="number" min="30" max="900" value="${st.gap_max_s}"></label>
          <label>Photos per listing <input name="photos" type="number" min="1" max="10" value="${st.photos}"></label>
          <label class="fa-check"><input type="checkbox" name="menus" ${st.menus ? "checked" : ""}> Scan also reads each listing's renew menu (slower)</label>
          <label>Buyer conversations to read <input name="inbox_max" type="number" min="1" max="50" value="${st.inbox_max}"></label>
          <button class="btn btn-ghost btn-sm" type="submit">Save settings</button>
        </form>
      </section>
      ${lastList.length ? `<section class="fa-card"><header><h2>Recently listed</h2></header><ul class="fa-list">${lastList.map(x => `<li class="${x.ok ? "" : "bad"}"><span>${x.ok ? (x.dry ? "🧪" : "✓") : "✗"} ${x.id ? `<a href="${esc(fbItem(x.id))}" target="_blank" rel="noopener">${esc(x.title || x.p)}</a>` : esc(x.title || x.p)}</span><small>${esc(x.d)}${x.why ? " · " + esc(x.why) : ""}</small></li>`).join("")}</ul></section>` : ""}`;
  }
  const render = () => { if (F()) F().render(); };

  // ------------------------------------------------------------------ events
  document.addEventListener("click", async e => {
    if (!S || !e.target.closest || !e.target.closest("#fa-body")) return;
    const b = e.target.closest("[data-mk],[data-mk-list],[data-mk-skip],[data-mk-unskip],[data-mk-price],[data-mk-copy],[data-mk-ai]");
    if (!b) return;
    e.preventDefault();
    const d = b.dataset;
    if (d.mk === "scan") return startScan();
    if (d.mk === "listall") return startList(analyse().missing.map(p => p.id));
    if (d.mk === "test") return startList(analyse().missing.slice(0, 1).map(p => p.id), { dry: true });
    if (d.mk === "renew") return F() && F().runStep(["renew"]);
    if (d.mk === "inbox") return startInbox();
    if (d.mk === "forget") { writeInbox(null); drafts = {}; render(); return A.toast("Conversations removed from this browser."); }
    if (d.mkList) return startList([d.mkList]);
    if (d.mkSkip || d.mkUnskip) {
      const id = d.mkSkip || d.mkUnskip;
      try { await save(s => { s.skip = d.mkSkip ? [...new Set(s.skip.concat(id))] : s.skip.filter(x => x !== id); return s; }, `Marketplace sync: ${d.mkSkip ? "don't list" : "list again"} ${id}`); render(); }
      catch (err) { A.toast(A.friendly(err), true); }
      return;
    }
    if (d.mkPrice != null) {
      const r = analyse().rows.find(x => String(x.i) === d.mkPrice);
      if (!r || !r.m) return;
      const p = r.m.p, price = Number(r.price);
      if (!(price > 0)) return A.toast("That listing has no price to copy.", true);
      if (!window.confirm(`Change the website price of ${shortName(p)} from ${money(p.price_ghs)} to ${money(price)}?`)) return;
      A.busy("Saving the new price…");
      try { await A.commit({ message: `Price: ${p.id} is now ${money(price)} (from Marketplace)`, mutate: list => list.map(x => x.id !== p.id ? x : { ...x, price_ghs: price, placeholder: false }) }); A.toast(`${shortName(p)} is now ${money(price)} on the site ✓`); if (A.refreshDash) A.refreshDash(); render(); }
      catch (err) { A.toast(A.friendly(err), true); }
      finally { A.busy(null); }
      return;
    }
    if (d.mkCopy != null) {
      const ta = document.querySelector(`[data-mk-draft="${CSS.escape(d.mkCopy)}"]`);
      const text = ta ? ta.value : "";
      try { await navigator.clipboard.writeText(text); } catch (err) { if (ta) { ta.select(); document.execCommand("copy"); } }
      return A.toast("Reply copied: open the thread and paste it.");
    }
    if (d.mkAi != null) return aiDraft(+d.mkAi);
  });
  document.addEventListener("input", e => { const t = e.target.closest && e.target.closest("[data-mk-draft]"); if (t) drafts[t.dataset.mkDraft] = t.value; });
  document.addEventListener("change", async e => {
    const sel = e.target.closest && e.target.closest("[data-mk-link]");
    if (!sel || !sel.value || !S) return;
    const r = analyse().rows.find(x => String(x.i) === sel.dataset.mkLink);
    if (!r || !r.id) return;
    const pid = sel.value, d = today();
    A.busy("Linking the listing…");
    try {
      await A.commit({ message: `Marketplace: link listing ${r.id} to ${pid}`, mutate: list => list.map(p => p.id !== pid || (p.facebook_listings || []).some(f => String(f.id) === String(r.id)) ? p : { ...p, facebook_listings: (p.facebook_listings || []).concat([{ id: String(r.id), title: r.t, price: r.price, checked: d }]) }) });
      A.toast("Linked ✓"); render();
    } catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); }
  });
  document.addEventListener("submit", async e => {
    if (!e.target || e.target.id !== "mk-settings" || !S) return;
    e.preventDefault();
    const f = e.target.elements, clamp = (v, lo, hi, def) => Math.min(hi, Math.max(lo, parseInt(v, 10) || def));
    const gmin = clamp(f.gap_min_s.value, 30, 600, 30);
    const next = { scan_in_run: f.scan_in_run.checked, list_in_run: f.list_in_run.checked, list_per_run: clamp(f.list_per_run.value, 1, 20, 3), gap_min_s: gmin, gap_max_s: Math.max(gmin, clamp(f.gap_max_s.value, 30, 900, 60)), photos: clamp(f.photos.value, 1, 10, 8), menus: f.menus.checked, inbox_max: clamp(f.inbox_max.value, 1, 50, 20) };
    A.busy("Saving…");
    try { await save(s => { Object.assign(s.settings, next); return s; }, "Marketplace sync: settings"); A.toast("Settings saved"); render(); }
    catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); }
  });

  window.FAV_MKAUTO = { load, state: () => S, renderTab, receive, startScan, startList, startInbox, scanWaiting, listWaiting, analyse, _test: { productFor, sim, templateDraft, listItem, description, categoriesFor, set: s => { S = normalise(s); }, setInbox: writeInbox } };
})();
