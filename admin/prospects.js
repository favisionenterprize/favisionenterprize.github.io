// "🏢 Bulk buyers" screen (dashboard button, deep link #prospects): find schools, churches, hotels, offices,
// hostels, event centres and restaurants in Accra / Tema / Kasoa that could buy in bulk, then draft a pitch
// and one quote for the ones Alexander keeps. Flow (from the "goal → tasks → public listings → filter chains →
// shortlist with a cited source → draft pitches + one quote page" post):
//   1. pick target type + area + product (data/products.json; default student desk FAV-014, GH₵650/set,
//      GH₵640 each from 50);
//   2. "✨ Suggest prospects" asks the backend `muse` action (mode assistant) for local, independent buyers.
//      Muse has NO web search, so every AI suggestion arrives "unverified" even when it gives a link: Alexander
//      opens the source and ticks "I checked it". The "Search the web" links and "+ Add one myself" are the
//      other ways in. Chains / franchises / big groups are dropped (AI told to skip them + CHAIN words + a tick);
//   3. tick the keepers (a keeper needs a source URL), enter quantity and unit price per prospect. If either is
//      empty the draft is blocked: "Enter the price — I won't guess" (the run stops instead of guessing);
//   4. per keeper: WhatsApp / email pitch (template in the brand voice, or "✨ AI pitch" via muse mode content)
//      + a quote line, Copy, Open WhatsApp (wa.me with the text, never auto-sent), Open quote page
//      (FAV_INVOICE proforma, print / save as PDF), Add to Leads (FAV_LEADS.add, source "prospect").
// Nothing is ever sent. Public data only in data/prospects.json (business name, type, area, public source URL);
// phone numbers, contact names, quantities, prices, notes and drafts stay in this browser (fa-prospects-private).
// AI steps go through the AI Plan gate: "prospects:find" and "prospects:pitch" (rule S5).
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const FILE = "data/prospects.json";
  const PRIV = "fa-prospects-private";
  const EMPTY = { updated: null, prospects: [] };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, bad) => { if (A().toast) A().toast(m, bad); };
  const money = n => "GH₵" + (Math.round(Number(n) * 100) / 100).toLocaleString("en-GH");
  const today = () => new Date().toLocaleDateString("en-CA");
  const SITE = "https://favisionenterprize.github.io/";
  const TYPES = { school: "Schools", church: "Churches", hotel: "Hotels & guest houses", office: "Offices", hostel: "Hostels", events: "Event centres", restaurant: "Restaurants" };
  const AREAS = ["Accra", "Tema", "Kasoa"];
  // Words that mark a chain, franchise or big group (they buy through head office, not from us).
  const CHAIN = /\b(kfc|pizza hut|papaye|chicken inn|burger king|starbucks|marriott|kempinski|m[öo]venpick|radisson|holiday inn|ibis|novotel|best western|golden tulip|accor|hilton|shoprite|melcom|game stores|palace mall|mtn|vodafone|telecel|airteltigo|ecobank|stanbic|absa|gcb|fidelity|calbank|total ?energies|goil|shell|university of ghana|knust|ucc)\b/i;
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  let D = null, dirty = false, pick = ls.get("fa-prospects-pick", { type: "school", area: "Kasoa", product: "FAV-014" }), finding = false, adding = false;
  const priv = () => ls.get(PRIV, {});
  const setPriv = (id, patch) => { const all = priv(); all[id] = Object.assign({}, all[id] || {}, patch); ls.set(PRIV, all); };

  function norm(d) {
    d = d && typeof d === "object" ? d : JSON.parse(JSON.stringify(EMPTY));
    d.prospects = (Array.isArray(d.prospects) ? d.prospects : []).filter(p => p && p.name).map(p => ({
      id: p.id || slug(p.name + "-" + (p.area || "")), name: String(p.name).slice(0, 120), type: TYPES[p.type] ? p.type : "office", area: String(p.area || "").slice(0, 60),
      source: /^https?:\/\//i.test(p.source || "") ? String(p.source).slice(0, 400) : "", checked: !!p.checked && /^https?:\/\//i.test(p.source || ""),
      chain: !!p.chain, keep: !!p.keep, product: p.product || "FAV-014", why: String(p.why || "").slice(0, 200), by: p.by === "me" ? "me" : "ai", added: p.added || today()
    }));
    return d;
  }
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "p" + Date.now().toString(36);
  async function load(force) { if (!D || force) { try { D = norm(await A().readJsonFile(FILE, EMPTY)); } catch (e) { D = D || norm(null); } } return D; }
  const products = () => (A().products ? A().products() : []).filter(p => !p.placeholder);
  const product = id => products().find(p => p.id === id) || null;
  const short = p => String(p.name).split(" — ")[0];
  // Catalogue price for a quantity (not a guess: FAV-014 is GH₵640 each from 50 sets).
  function catalogPrice(p, qty) {
    if (!p || !(Number(p.price_ghs) > 0)) return "";
    if (p.id === "FAV-014" && Number(qty) >= 50) return 640;
    return Number(p.price_ghs);
  }
  const verified = x => !!(x.source && x.checked);

  // ---------------------------------------------------------------- AI Plan gate
  function gateMsg(key) {
    const AP = window.FAV_AIPLAN;
    if (!AP || !AP.decide) return "";
    const d = AP.decide(key);
    return d.v === "skip" ? d.why : "";
  }
  const gate = key => !window.FAV_AIPLAN || window.FAV_AIPLAN.gate(key, "prospects-" + new Date().toISOString().slice(0, 13));

  // ---------------------------------------------------------------- screen
  let screen = $("#screen-prospects");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-prospects"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>🏢 Bulk buyers</h1>
      <p class="muted">Find schools, churches, hotels, offices and other bulk buyers near you, keep the real ones, then get a ready pitch and quote for each. Nothing is ever sent for you: you copy it or open WhatsApp yourself.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button><button class="btn btn-ghost btn-sm" data-leads>📥 Leads</button></div></div>
      <div id="pr-body"><p class="muted">Loading…</p></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `#pr-body{display:grid;gap:16px}.pr-pick{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px}
.pr-pick label,.pr-add label,.pr-q label{display:grid;gap:4px;font-size:13px;color:#5f6368}
.pr-pick select,.pr-add input,.pr-add select,.pr-q input,.pr-card textarea{font:inherit;font-size:14px;padding:7px 9px;border:1px solid #dadce0;border-radius:8px;min-width:0;width:100%;box-sizing:border-box;background:#fff}
.pr-card{background:#fff;border:1px solid #e3e7ee;border-radius:12px;padding:12px 14px;display:grid;gap:8px;overflow-wrap:anywhere;min-width:0}.pr-card.keep{border-left:4px solid #0d55af}.pr-card.chain{opacity:.55}
.pr-top{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.pr-top b{font-size:15px}
.pr-src{font-size:13px;word-break:break-all}.pr-q{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,130px),1fr));gap:8px}
.pr-stop{background:#fdecea;border:1px solid #f5b5ae;color:#a12a1f;border-radius:8px;padding:8px 10px;font-weight:600;font-size:14px}
.pr-quote{background:#f6f8fc;border-radius:8px;padding:8px 10px;font-size:14px}.pr-card textarea{min-height:150px}
.pr-row{display:flex;flex-wrap:wrap;gap:8px}.pr-add{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:8px}
.pill.warn{background:#fff2dc;color:#8a5300}`;
    document.head.appendChild(st);
  }
  if (!document.querySelector("[data-prospects]")) {
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-prospects>🏢 Bulk buyers</button>`);
  }
  async function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#prospects") history.replaceState(null, "", "#prospects");
    if (!dirty) await load(true);
    render();
  }

  // ---------------------------------------------------------------- drafting
  function quote(x) {
    const p = product(x.product), v = priv()[x.id] || {};
    const qty = String(v.qty == null ? "" : v.qty).trim(), price = String(v.price == null ? "" : v.price).trim();
    if (!qty || !(Number(qty) > 0)) return { stop: "Enter the quantity — I won't guess." };
    if (!price || !(Number(price) > 0)) return { stop: "Enter the price — I won't guess." };
    const q = Number(qty), u = Number(price);
    return { p, qty: q, unit: u, total: q * u, line: `${q} × ${p ? short(p) : x.product} @ ${money(u)} = ${money(q * u)}` };
  }
  function pitch(x, kind) {
    const qt = quote(x);
    if (qt.stop) return "";
    const B = A().business ? A().business() || {} : {}, p = qt.p, v = priv()[x.id] || {};
    const wa = (window.FAV_CONFIG && window.FAV_CONFIG.localPhone ? window.FAV_CONFIG.localPhone(B.whatsapp || "+233572646176") : "057 264 6176");
    const hello = v.contact ? `Hello ${String(v.contact).split(/\s+/)[0]},` : `Hello ${x.name} team,`;
    const what = p ? short(p) : "furniture";
    const fit = { school: "your classrooms", church: "your church and events", hotel: "your rooms and lounges", office: "your office", hostel: "your hostel rooms", events: "your event centre", restaurant: "your restaurant" }[x.type] || "your space";
    const facts = p ? (p.highlights || []).slice(0, 2).map(h => "• " + h).join("\n") : "";
    const cta = window.FAV_CAPTIONS && window.FAV_CAPTIONS.cta && p ? window.FAV_CAPTIONS.cta(p, { net: "share" }) : `📲 WhatsApp ${wa} to order.`;
    const link = p ? `${SITE}p/${p.id}.html` : SITE;
    if (kind === "email") {
      return `Subject: ${what} for ${x.name}: quote from F.A Vision Enterprise\n\n${hello}\n\nI'm Alexander from F.A Vision Enterprise in Odorkor, Accra. We sell ${what.toLowerCase()} and other furniture for ${fit}, with delivery across Accra, Tema and Kasoa.\n\n${facts ? facts + "\n\n" : ""}Quote: ${qt.line}.\n\nPhotos and details: ${link}\nYou're welcome to see it at our showroom: Tarazzo Road, opposite Pacific, Odorkor.\n\nCall 020 747 3267 or WhatsApp ${wa} and we'll arrange it.\n\nThank you,\nAlexander Awuku\nF.A Vision Enterprise · ${SITE.replace("https://", "")}`;
    }
    return `${hello} this is Alexander from F.A Vision Enterprise, Odorkor. 👋\n\nWe sell ${what.toLowerCase()} for ${fit}, delivered across Accra, Tema & Kasoa.\n${facts ? facts + "\n" : ""}\n💰 Quote: ${qt.line}\n👉 ${link}\n\n${cta}`;
  }
  function openQuote(x) {
    const qt = quote(x);
    if (qt.stop) return toast(qt.stop, true);
    const INV = window.FAV_INVOICE;
    const B = A().business ? A().business() || {} : {};
    const d = new Date(), valid = new Date(Date.now() + 14 * 864e5);
    const inv = { kind: "proforma", number: "QUOTE-" + d.toISOString().slice(0, 10).replace(/-/g, "") + "-" + x.id.slice(0, 6).toUpperCase(),
      issue_date: d.toISOString().slice(0, 10), due_date: valid.toISOString().slice(0, 10),
      customer: { organisation: x.name, address: x.area }, lines: [{ description: qt.p ? qt.p.name : x.product, qty: qt.qty, unit_price: qt.unit }],
      taxes: [], amount_paid: 0, notes: "Quote valid for 14 days. Delivery fee depends on location. A deposit confirms the order." };
    const w = window.open("", "_blank");
    if (!w) return toast("Allow pop-ups for this page to open the quote.", true);
    if (INV && INV.render) { w.document.write(INV.render(inv, B)); w.document.close(); }
    else { w.document.write(`<pre style="font:16px sans-serif;padding:24px">${esc(`F.A Vision Enterprise · Quote ${inv.number}\n\nFor: ${x.name}\n${qt.line}\nValid 14 days.`)}</pre>`); w.document.close(); }
  }
  async function aiPitch(x) {
    const qt = quote(x);
    if (qt.stop) return toast(qt.stop, true);
    const why = gateMsg("prospects:pitch");
    if (why) return toast(`AI pitch is off: ${why}. Approve rule S5 in 🧭 AI Plan.`, true);
    if (!gate("prospects:pitch")) return;
    const p = qt.p;
    const facts = `Prospect: ${x.name} (${TYPES[x.type]}, ${x.area}). Product: ${p ? p.name : x.product}. ${p && p.highlights ? "Highlights: " + p.highlights.join("; ") + "." : ""} Quote: ${qt.line}. Link: ${p ? SITE + "p/" + p.id + ".html" : SITE}. Showroom Tarazzo Road, opposite Pacific, Odorkor. Delivery across Accra, Tema and Kasoa. WhatsApp 057 264 6176, call 020 747 3267.`;
    if (A().busy) A().busy("Asking your AI for a pitch draft…");
    try {
      const r = await A().backendSigned({ action: "muse", mode: "content", context: facts, messages: [{ role: "user", text: "Write ONE short, warm WhatsApp message (max 90 words, plain text, at most 2 emojis, no hashtags) from Alexander of F.A Vision Enterprise to this prospect, offering the product with the exact quote line. Use only these facts; never invent prices, discounts, stock or delivery dates. Say \"we sell\", never \"we make\". End with the WhatsApp number." }] });
      if (r && r.ok && r.text) { setPriv(x.id, { draft: String(r.text).trim(), draftKind: "wa" }); toast("AI pitch ready: check it before you send it."); }
      else toast(r && r.error === "no_session" ? "AI pitches need the email sign-in. The template pitch is still there." : r && r.error === "no_ai_key" ? "Your backend has no AI key: use the template pitch." : "The AI didn't answer: " + ((r && r.error) || "unknown"), true);
    } catch (e) { toast("Couldn't reach the backend: " + (A().friendly ? A().friendly(e) : e), true); }
    finally { if (A().busy) A().busy(null); render(); }
  }

  // ---------------------------------------------------------------- finding
  function searchLinks() {
    const q = `${TYPES[pick.type]} in ${pick.area} Ghana`;
    return [["Google Maps", "https://www.google.com/maps/search/" + encodeURIComponent(q)], ["Google", "https://www.google.com/search?q=" + encodeURIComponent(q)], ["Bing", "https://www.bing.com/search?q=" + encodeURIComponent(q)]];
  }
  function parse(text) {
    const m = String(text || "").match(/\{[\s\S]*\}/);
    if (!m) return [];
    let j; try { j = JSON.parse(m[0]); } catch (e) { return []; }
    return (Array.isArray(j.prospects) ? j.prospects : []).slice(0, 15);
  }
  async function find() {
    const why = gateMsg("prospects:find");
    if (why) return toast(`AI suggestions are off: ${why}. Approve rule S5 in 🧭 AI Plan (you can still add prospects yourself).`, true);
    if (!gate("prospects:find")) return;
    const p = product(pick.product);
    const known = D.prospects.map(x => x.name).slice(0, 60).join("; ");
    const prompt = `Goal: find bulk buyers for ${p ? p.name : "furniture"} from F.A Vision Enterprise (Odorkor, Accra).\n` +
      `Target: ${TYPES[pick.type]} in ${pick.area}, Ghana.\nTasks: list up to 10 real, independent, locally run ${TYPES[pick.type].toLowerCase()} in or near ${pick.area} that could buy this in bulk. ` +
      `Skip chains, franchises, international hotel groups, banks, telecoms, big public universities and anything that buys through a head office. Skip these, we have them already: ${known || "none"}.\n` +
      `For each give the public page where it is listed (its own website, Google Maps, Ghana Schools / GES list, Facebook page, a directory). If you are not sure a page exists, leave source_url empty: never make up a link. ` +
      `No personal phone numbers or names of individuals.\nReply with JSON only: {"prospects":[{"name":"...","area":"...","why":"one short line","source_url":"https://... or empty","chain":false}]}`;
    finding = true; render();
    try {
      const r = await A().backendSigned({ action: "muse", mode: "assistant", messages: [{ role: "user", text: prompt }] });
      if (!r || !r.ok) { toast(r && r.error === "no_session" ? "AI suggestions need the email sign-in. Use the search links and add prospects yourself." : r && r.error === "no_ai_key" ? "Your backend has no AI key: use the search links and add prospects yourself." : "The AI didn't answer: " + ((r && r.error) || "unknown"), true); return; }
      const have = new Set(D.prospects.map(x => x.name.toLowerCase()));
      let n = 0, chains = 0;
      for (const it of parse(r.text)) {
        const name = String(it.name || "").trim();
        if (!name || have.has(name.toLowerCase())) continue;
        const chain = !!it.chain || CHAIN.test(name);
        if (chain) { chains++; continue; }   // filtered out: chains buy through head office
        have.add(name.toLowerCase());
        D.prospects.unshift(norm({ prospects: [{ name, type: pick.type, area: it.area || pick.area, why: it.why, source: it.source_url, checked: false, product: pick.product, by: "ai" }] }).prospects[0]);
        n++;
      }
      dirty = n > 0;
      toast(n ? `${n} prospect${n === 1 ? "" : "s"} suggested${chains ? `, ${chains} chain${chains === 1 ? "" : "s"} left out` : ""}. All are unverified: open each source and tick "I checked it".` : "No new prospects in that answer. Try another area or type.", !n);
    } catch (e) { toast("Couldn't reach the backend: " + (A().friendly ? A().friendly(e) : e), true); }
    finally { finding = false; render(); }
  }
  async function save() {
    if (A().busy) A().busy("Saving the shortlist…");
    const mine = JSON.parse(JSON.stringify(D.prospects));
    try {
      D = norm(await A().saveJson(FILE, () => ({ updated: today(), prospects: mine }), "Bulk buyers: shortlist updated by Alexander", EMPTY));
      dirty = false; toast("Shortlist saved ✓");
    } catch (e) { toast(A().friendly ? A().friendly(e) : String(e), true); }
    finally { if (A().busy) A().busy(null); render(); }
  }

  // ---------------------------------------------------------------- render
  function card(x) {
    const v = priv()[x.id] || {}, qt = quote(x), p = product(x.product);
    const kind = v.draftKind || "wa";
    const text = v.draft || (qt.stop ? "" : pitch(x, kind));
    const waNum = String(v.phone || "").replace(/\D/g, "").replace(/^0/, "233");
    const ok = verified(x);
    return `<article class="pr-card${x.keep ? " keep" : ""}${x.chain ? " chain" : ""}" data-pid="${esc(x.id)}">
      <div class="pr-top"><div><b>${esc(x.name)}</b> <span class="pill">${esc(TYPES[x.type])}</span> <span class="pill">${esc(x.area)}</span>
        ${ok ? `<span class="pill ok">source checked</span>` : `<span class="pill warn">unverified</span>`}${x.chain ? ` <span class="pill sold">chain: skipped</span>` : ""}
        ${x.why ? `<div class="muted small">${esc(x.why)}</div>` : ""}</div>
        <label class="fa-check"><input type="checkbox" data-pr="keep" ${x.keep ? "checked" : ""} ${x.chain ? "disabled" : ""}> Keep</label></div>
      <div class="pr-src">${x.source ? `Source: <a href="${esc(x.source)}" target="_blank" rel="noopener">${esc(x.source.replace(/^https?:\/\//, "").slice(0, 80))} ↗</a> <label class="fa-check"><input type="checkbox" data-pr="checked" ${x.checked ? "checked" : ""}> I checked it (it's real and still open)</label>` : `<span class="muted">No source yet.</span>`}
        <button class="btn btn-ghost btn-sm" data-pr="src">${x.source ? "Change source" : "+ Add source URL"}</button>
        <label class="fa-check"><input type="checkbox" data-pr="chain" ${x.chain ? "checked" : ""}> Chain / head office</label>
        <button class="btn btn-ghost btn-sm" data-pr="del">Remove</button></div>
      ${x.keep ? `<div class="pr-q">
          <label>Product<select data-pr="product">${products().map(q => `<option value="${esc(q.id)}" ${q.id === x.product ? "selected" : ""}>${esc(q.id)} · ${esc(short(q))}</option>`).join("")}</select></label>
          <label>Quantity<input data-pv="qty" type="number" min="1" inputmode="numeric" value="${esc(v.qty == null ? "" : v.qty)}" placeholder="e.g. 50"></label>
          <label>Unit price (GH₵)<input data-pv="price" type="number" min="1" inputmode="decimal" value="${esc(v.price == null ? "" : v.price)}" placeholder="${p && p.price_ghs ? "catalogue " + esc(catalogPrice(p, v.qty)) : "enter it"}"></label>
          <label>Contact name <small>(stays on this device)</small><input data-pv="contact" value="${esc(v.contact || "")}" placeholder="optional"></label>
          <label>WhatsApp number <small>(stays on this device)</small><input data-pv="phone" inputmode="tel" value="${esc(v.phone || "")}" placeholder="optional"></label>
        </div>
        ${p && p.price_ghs && !v.price ? `<div class="pr-row"><button class="btn btn-ghost btn-sm" data-pr="catalog">Use catalogue price ${esc(money(catalogPrice(p, v.qty)))}${p.id === "FAV-014" ? " (GH₵640 each from 50)" : ""}</button></div>` : ""}
        ${qt.stop ? `<div class="pr-stop">✋ ${esc(qt.stop)} The pitch and quote stay blocked until it's filled in.</div>` : `
        <div class="pr-quote">💰 ${esc(qt.line)}</div>
        <div class="pr-row"><button class="btn btn-ghost btn-sm" data-pr="kind" data-k="wa" aria-pressed="${kind === "wa"}">WhatsApp pitch</button><button class="btn btn-ghost btn-sm" data-pr="kind" data-k="email" aria-pressed="${kind === "email"}">Email pitch</button><button class="btn btn-ghost btn-sm" data-pr="ai">✨ AI pitch</button>${v.draft ? `<button class="btn btn-ghost btn-sm" data-pr="reset">↺ Template</button>` : ""}</div>
        <textarea data-pv="draft" aria-label="Pitch draft">${esc(text)}</textarea>
        <div class="pr-row">
          <button class="btn btn-ghost btn-sm" data-pr="copy">Copy</button>
          <a class="btn btn-wa btn-sm" target="_blank" rel="noopener" data-pr-wa href="https://wa.me/${waNum.length >= 12 ? esc(waNum) : ""}?text=${encodeURIComponent(text)}">Open WhatsApp</a>
          <button class="btn btn-ghost btn-sm" data-pr="quote">Open quote page</button>
          <button class="btn btn-primary btn-sm" data-pr="lead">Add to Leads</button>
        </div>
        <p class="muted small">Nothing is sent from here: WhatsApp opens with the text ready and you press send yourself.</p>`}` : ""}
    </article>`;
  }
  function render() {
    if (screen.hidden || !D) return;
    const p = product(pick.product);
    const off = gateMsg("prospects:find");
    const list = D.prospects.filter(x => x.type === pick.type || pick.type === "all");
    const keep = D.prospects.filter(x => x.keep);
    $("#pr-body").innerHTML = `
      <section class="fa-card">
        <header><h2>1. Who are you looking for?</h2><span class="fa-big">${D.prospects.length}</span></header>
        <div class="pr-pick">
          <label>Target type<select data-pick="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === pick.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label>Area<select data-pick="area">${AREAS.map(a => `<option ${a === pick.area ? "selected" : ""}>${a}</option>`).join("")}</select></label>
          <label>Product<select data-pick="product">${products().map(q => `<option value="${esc(q.id)}" ${q.id === pick.product ? "selected" : ""}>${esc(q.id)} · ${esc(short(q))}${q.price_ghs ? " · " + esc(money(q.price_ghs)) : ""}</option>`).join("")}</select></label>
        </div>
        ${p && p.id === "FAV-014" ? `<p class="fa-small">Student desk FAV-014: GH₵650 a set, GH₵640 each from 50 sets.</p>` : ""}
        <div class="fa-actions">
          <button class="btn btn-sell" data-pr="find" ${finding ? "disabled" : ""}>${finding ? "Asking…" : "✨ Suggest prospects"}</button>
          <button class="btn btn-ghost" data-pr="add">+ Add one myself</button>
          ${searchLinks().map(([n, u]) => `<a class="btn btn-ghost btn-sm" href="${esc(u)}" target="_blank" rel="noopener">Search ${esc(n)} ↗</a>`).join("")}
        </div>
        ${off ? `<p class="fa-small pr-stop" style="font-weight:500">AI suggestions are off: ${esc(off)}. Approve rule <b>S5</b> in <a href="#aiplan" data-aiplan>🧭 AI Plan</a>. You can still search and add prospects yourself.</p>` : ""}
        <p class="muted fa-small">The AI can't browse the web, so its suggestions (and any links it gives) are <b>unverified</b> until you open the source and tick "I checked it". Chains and head-office buyers are left out.</p>
        ${adding ? `<form class="pr-add" id="pr-add-form">
          <label>Business name<input name="name" required></label>
          <label>Area<input name="area" value="${esc(pick.area)}"></label>
          <label>Public source URL<input name="source" type="url" placeholder="https://… (Google Maps, website, Facebook page)"></label>
          <div class="pr-row" style="align-items:end"><button class="btn btn-primary btn-sm" type="submit">Add</button><button class="btn btn-ghost btn-sm" type="button" data-pr="add">Cancel</button></div>
        </form>` : ""}
      </section>
      <section class="fa-card">
        <header><h2>2. ${esc(TYPES[pick.type])}: tick the keepers</h2><span class="fa-big ${keep.length ? "hot" : ""}">${keep.length}</span></header>
        <p class="muted fa-small">A keeper needs a source link. Enter the quantity and price for each: the pitch and quote wait until both are filled in.</p>
        ${list.length ? list.map(card).join("") : `<p class="muted">No ${esc(TYPES[pick.type].toLowerCase())} yet. Press Suggest prospects or add one yourself.</p>`}
        ${D.prospects.length > list.length ? `<p class="muted fa-small">${D.prospects.length - list.length} more under other target types.</p>` : ""}
      </section>
      <div class="br-bar" style="position:sticky;bottom:0;display:flex;gap:10px;justify-content:flex-end;padding:10px;background:rgba(255,255,255,.95);border-top:1px solid #e3e7ee">
        <span class="muted" style="margin-right:auto;align-self:center">${dirty ? "Unsaved changes" : "Shortlist saved"} · only business names, areas and public links are saved to the website files</span>
        <button class="btn btn-sell" data-pr="save" ${dirty ? "" : "disabled"}>Save shortlist</button></div>`;
  }

  // ---------------------------------------------------------------- events
  const of = el => { const c = el.closest("[data-pid]"); return c ? D.prospects.find(x => x.id === c.dataset.pid) : null; };
  const mark = () => { dirty = true; };
  document.addEventListener("click", async e => {
    if (e.target.closest("[data-prospects]")) { e.preventDefault(); show(); return; }
    if (screen.hidden || !D) return;
    const b = e.target.closest("[data-pr]");
    if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
    const k = b.dataset.pr, x = of(b);
    if (k === "find") return find();
    if (k === "add") { adding = !adding; return render(); }
    if (k === "save") return save();
    if (!x) return;
    if (k === "del") { D.prospects = D.prospects.filter(y => y !== x); mark(); return render(); }
    if (k === "src") {
      const u = (window.prompt("Public page for " + x.name + " (website, Google Maps, Facebook page, directory):", x.source || "") || "").trim();
      if (!u) return;
      if (!/^https?:\/\//i.test(u)) return toast("That isn't a web link (it must start with https://).", true);
      x.source = u; x.checked = false; mark(); return render();
    }
    if (k === "catalog") { const v = priv()[x.id] || {}; setPriv(x.id, { price: catalogPrice(product(x.product), v.qty) }); return render(); }
    if (k === "kind") { setPriv(x.id, { draftKind: b.dataset.k, draft: "" }); return render(); }
    if (k === "reset") { setPriv(x.id, { draft: "" }); return render(); }
    if (k === "ai") return aiPitch(x);
    if (k === "quote") return openQuote(x);
    const text = ((b.closest(".pr-card").querySelector("[data-pv=draft]") || {}).value || "").trim();
    if (k === "copy") { if (!text) return; try { await navigator.clipboard.writeText(text); toast("Copied ✓"); } catch (err) { window.prompt("Copy this:", text); } return; }
    if (k === "lead") {
      const qt = quote(x);
      if (qt.stop) return toast(qt.stop, true);
      const v = priv()[x.id] || {};
      const L = window.FAV_LEADS;
      const lead = { name: v.contact || x.name, organisation: x.name, phone: v.phone || "", product: qt.p ? short(qt.p) : x.product, quantity: qt.qty,
        message: `Bulk-buyer prospect (${TYPES[x.type]}, ${x.area}). Quote: ${qt.line}.${x.source ? " Source: " + x.source : ""}`, source: "prospect" };
      b.disabled = true;
      try {
        if (L && L.add) await L.add(lead); else throw new Error("Leads screen not loaded");
        setPriv(x.id, { lead: today() }); toast(`${x.name} added to 📥 Leads ✓`);
      } catch (err) { b.disabled = false; toast("Couldn't add the lead: " + (err.message || err), true); }
    }
  });
  document.addEventListener("click", e => {   // WhatsApp link: open with the latest text from the box (still not sent)
    const a = e.target.closest("[data-pr-wa]");
    if (!a || screen.hidden) return;
    const box = a.closest(".pr-card").querySelector("[data-pv=draft]");
    if (box) a.href = a.href.replace(/\?text=.*$/, "?text=" + encodeURIComponent(box.value));
  }, true);
  document.addEventListener("change", e => {
    if (screen.hidden || !D) return;
    const t = e.target;
    if (t.dataset.pick) { pick[t.dataset.pick] = t.value; ls.set("fa-prospects-pick", pick); return render(); }
    const x = of(t); if (!x) return;
    if (t.dataset.pr === "keep") {
      if (t.checked && !x.source) { t.checked = false; return toast("Add the public source link first: every keeper needs one.", true); }
      x.keep = t.checked; mark(); return render();
    }
    if (t.dataset.pr === "checked") { x.checked = t.checked && !!x.source; mark(); return render(); }
    if (t.dataset.pr === "chain") { x.chain = t.checked; if (x.chain) x.keep = false; mark(); return render(); }
    if (t.dataset.pr === "product") { x.product = t.value; setPriv(x.id, { draft: "" }); mark(); return render(); }
    if (t.dataset.pv && t.dataset.pv !== "draft") { setPriv(x.id, { [t.dataset.pv]: t.value.trim(), draft: "" }); return render(); }
  });
  document.addEventListener("input", e => {
    const t = e.target;
    if (screen.hidden || !D || t.dataset.pv !== "draft") return;
    const x = of(t); if (x) setPriv(x.id, { draft: t.value });
  });
  document.addEventListener("submit", e => {
    if (e.target.id !== "pr-add-form") return;
    e.preventDefault();
    const f = e.target, name = f.elements.name.value.trim(), src = f.elements.source.value.trim();
    if (!name) return;
    if (D.prospects.some(x => x.name.toLowerCase() === name.toLowerCase())) return toast(name + " is already on the list.", true);
    if (src && !/^https?:\/\//i.test(src)) return toast("The source must be a web link (https://…).", true);
    D.prospects.unshift(norm({ prospects: [{ name, type: pick.type, area: f.elements.area.value.trim() || pick.area, source: src, checked: !!src, chain: CHAIN.test(name), product: pick.product, by: "me" }] }).prospects[0]);
    adding = false; mark(); render();
  });
  window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  window.FAV_PROSPECTS = { open: show, load, quote, pitch, _test: { state: () => D, priv, setPriv, parse, CHAIN, set: d => { D = norm(d); } } };
})();
