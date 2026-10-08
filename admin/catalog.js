// Commerce hub (admin → 🏷 Facebook catalog): everything for Meta Commerce Manager in one place.
// The catalog itself is fed by output/meta-catalog.csv, which scripts/generate_listings.py
// rebuilds from data/products.json after every change (rebuild-ads.yml). So a price, stock
// or offer saved here reaches the website at once and Facebook on its next hourly feed fetch.
// Tabs: Overview · Products · Fix problems · Sets · Tag & post · Catalog ads · Offers · More.
// Offers: price_ghs becomes the offer price and was_price_ghs keeps the normal price
// (optional sale_from / sale_until, YYYY-MM-DD), so website, checkout and feed all agree.
(function () {
  const C = window.FAV_CONFIG, A = window.FAV_ADMIN;
  const $ = s => document.querySelector(s);
  const screen = $("#screen-catalog");
  if (!C || !A || !screen) return;
  const esc = C.escapeHtml;

  const SITE = "https://favisionenterprize.github.io";
  const FEED = SITE + "/output/meta-catalog.csv";
  const BIZ = "769785330076321", CAT = "236758040944623", CM = "1695065227321474", PIXEL = "418736689184304";
  const q_ = `?business_id=${BIZ}`;
  const L = {
    products: `https://business.facebook.com/commerce/catalogs/${CAT}/products/${q_}`,
    issues: `https://business.facebook.com/commerce/catalogs/${CAT}/products/${q_}&selected_tab=actions`,
    sets: `https://business.facebook.com/commerce/catalogs/${CAT}/sets/${q_}`,
    sources: `https://business.facebook.com/commerce/catalogs/${CAT}/data_sources/${q_}`,
    events: `https://business.facebook.com/commerce/catalogs/${CAT}/events/${q_}`,
    templates: `https://business.facebook.com/commerce/catalogs/${CAT}/templates/${q_}`,
    shops: `https://business.facebook.com/commerce/${CM}/shops/${q_}`,
    offers: `https://business.facebook.com/commerce/${CM}/promotions/offers/${q_}`,
    insights: `https://business.facebook.com/commerce/${CM}/performance/overview/${q_}`,
    insightsProducts: `https://business.facebook.com/commerce/${CM}/performance/products/${q_}`,
    tagged: `https://business.facebook.com/commerce/${CM}/performance/product_tagged_content/${q_}`,
    settings: `https://business.facebook.com/commerce/${CM}/settings/general/${q_}`,
    people: `https://business.facebook.com/settings/people${q_}`,
    catalogsAccess: `https://business.facebook.com/settings/product-catalogs/${CAT}${q_}`,
    composer: `https://business.facebook.com/latest/composer${q_}`,
    ads: `https://adsmanager.facebook.com/adsmanager/manage/campaigns${q_}`,
    pixel: `https://business.facebook.com/events_manager2/list/dataset/${PIXEL}/overview${q_}`
  };
  const TABS = [["overview", "Overview"], ["products", "Products"], ["health", "Fix problems"], ["sets", "Sets"],
    ["tag", "Tag & post"], ["ads", "Catalog ads"], ["offers", "Offers"], ["more", "Templates, insights & access"]];
  const BANDS = [[1000, "Under GH₵1,000"], [5000, "GH₵1,000 – 5,000"], [10000, "GH₵5,000 – 10,000"], [Infinity, "GH₵10,000 and above"]];

  let tab = "overview", q = "", busyNow = false, tagId = "", feedInfo = null;

  const ext = (href, text, cls) => `<a class="btn ${cls || "btn-ghost"} btn-sm" href="${esc(href)}" target="_blank" rel="noopener">${text} ↗</a>`;
  const all = () => A.products().filter(p => !p.placeholder);
  const band = p => (BANDS.find(([lim]) => (p.price_ghs || 0) < lim) || BANDS[3])[1];
  const today = () => new Date().toISOString().slice(0, 10);
  const onOffer = p => !!(p.was_price_ghs && p.price_ghs && p.was_price_ghs > p.price_ghs);
  const inFeed = p => !!p.price_ghs && (p.images || []).length > 0;
  const productLink = p => `${SITE}/p/${encodeURIComponent(p.id)}.html`;

  function open(which) {
    if (A.signedIn && !A.signedIn()) return A.show("login");
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (which) tab = which;
    if (location.hash !== "#catalog") history.replaceState(null, "", "#catalog");
    render();
    loadFeed();
  }

  // The live feed file, so the hub shows what Facebook actually reads.
  async function loadFeed() {
    try {
      const r = await fetch(FEED + "?t=" + Date.now(), { cache: "no-store" });
      const text = await r.text();
      const rows = text.trim().split(/\r?\n/).filter(l => /^[A-Z]+-\d+,/.test(l)).length;
      feedInfo = { ok: r.ok, rows, modified: r.headers.get("last-modified") || "", hasLabels: /custom_label_0/.test(text.split("\n")[0]) };
    } catch (e) { feedInfo = { ok: false }; }
    if (!screen.hidden && tab === "overview") render();
  }

  // ---------------------------------------------------------------- checks ("Fix problems")
  function problems(p) {
    const out = [];
    const imgs = p.images || [];
    if (!p.price_ghs) out.push(["err", "No price: left out of the catalog"]);
    if (!imgs.length) out.push(["err", "No photo: left out of the catalog"]);
    else if (imgs.length < 2) out.push(["warn", "Only 1 photo: add 2–4 angles, catalog ads rotate them"]);
    if ((p.name || "").length > 65) out.push(["warn", `Title is ${p.name.length} characters: under 65 shows in full on ads`]);
    if ((p.description || "").length < 60) out.push(["warn", "Short description: give size, material and what it's for"]);
    if (!p.category || !p.type) out.push(["warn", "No category/type: it won't land in a product set"]);
    if (!p.in_stock && !p.custom_order) out.push(["info", "Out of stock: Facebook hides it from ads and the Shop"]);
    if (onOffer(p) && p.sale_until && p.sale_until < today()) out.push(["err", `Offer ended on ${p.sale_until}: end it in Offers so the website goes back to the normal price`]);
    if (/(gh[c₵s]|cedis?)\s*[\d,]{2,}/i.test((p.name || "") + " " + (p.description || ""))) out.push(["warn", "A price is written in the title/description: it goes stale when prices change"]);
    return out;
  }

  // ---------------------------------------------------------------- render
  function render() {
    const body = $("#cat-body");
    const panels = { overview, products: productsTab, health, sets, tag: tagTab, ads, offers, more };
    body.innerHTML = `
      <nav class="ch-tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${k === tab}">${t}${k === "health" ? badge() : ""}</button>`).join("")}</nav>
      <div class="ch-panel">${panels[tab]()}</div>`;
    if (tab === "products") {
      const s = $("#cat-search");
      if (s) s.addEventListener("input", e => { q = e.target.value; const pos = e.target.selectionStart; render(); const t = $("#cat-search"); t.focus(); try { t.setSelectionRange(pos, pos); } catch (x) { /* */ } });
    }
  }
  function badge() {
    const n = all().filter(p => problems(p).some(([lvl]) => lvl === "err")).length;
    return n ? ` <span class="ch-badge">${n}</span>` : "";
  }

  function overview() {
    const list = all(), feed = list.filter(inFeed);
    const errs = list.filter(p => problems(p).some(([l]) => l === "err")).length;
    const warns = list.filter(p => problems(p).some(([l]) => l === "warn")).length;
    const offersOn = list.filter(onOffer).length;
    const f = feedInfo;
    return `
      <div class="ch-kpis">
        <div class="card"><b>${feed.length}</b><span>in the catalog feed</span></div>
        <div class="card"><b>${list.length - feed.length}</b><span>left out (no price/photo)</span></div>
        <div class="card"><b class="${errs ? "due" : ""}">${errs}</b><span>products to fix</span></div>
        <div class="card"><b>${offersOn}</b><span>on offer</span></div>
      </div>
      <div class="card ch-sec">
        <h2>1 · Website feed <span class="pill ok">connected</span></h2>
        <p class="muted small">Facebook reads this file every hour. Prices, photos, stock and offers you save in this admin reach your catalog, Shop, product tags and catalog ads by themselves.</p>
        <div class="leads-inline"><input readonly value="${esc(FEED)}" aria-label="Catalog feed link"><button class="btn btn-primary btn-sm" data-cat="copy">Copy link</button></div>
        <p class="small">${f ? (f.ok ? `Live file: <b>${f.rows}</b> products${f.modified ? `, rebuilt ${esc(new Date(f.modified).toLocaleString())}` : ""}. ${f.hasLabels ? "Set &amp; ad labels ✓" : "<span class='due'>Set labels not in the file yet: they appear after the next rebuild.</span>"}` : "<span class='due'>Couldn't read the feed file.</span>") : "Checking the live file…"}</p>
        <div class="ch-actions">${ext(L.sources, "Data sources")} ${ext(L.products, "Catalog products")} ${ext(L.issues, "Facebook's issue list")}</div>
        <p class="small muted">Saved a price and want Facebook to see it now? Data sources → <b>Website feed</b> → <b>Update</b>.</p>
      </div>
      <div class="card ch-sec">
        <h2>2 · Your three main jobs</h2>
        <div class="ch-steps">
          <button class="ch-step" data-tab="tag"><b>🏷 Tag products in posts</b><span>Pick a product, copy a ready caption, tag it in Facebook/Instagram.</span></button>
          <button class="ch-step" data-tab="ads"><b>📣 Catalog ads</b><span>Step-by-step Advantage+ catalog ad with your sets and ad text.</span></button>
          <button class="ch-step" data-tab="health"><b>🛠 Fix problems</b><span>${errs} must-fix · ${warns} to improve</span></button>
        </div>
      </div>
      <div class="card ch-sec">
        <h2>3 · Pixel (website visits → catalog)</h2>
        <p class="small">The website sends <b>ViewContent</b> with the product ID (FAV-001 …) whenever someone opens a product, plus <b>Contact</b> on WhatsApp/Call and <b>InitiateCheckout</b> on Buy now. That raises the catalog match rate above 90% and lets catalog ads re-show people the furniture they looked at. The rate climbs over the next few days as visits come in.</p>
        <div class="ch-actions">${ext(L.events, "Catalog match rate")} ${ext(L.pixel, "Pixel in Events Manager")}</div>
      </div>`;
  }

  function productsTab() {
    const list = all().filter(p => !q || (p.id + " " + p.name + " " + (p.category || "")).toLowerCase().includes(q.toLowerCase()));
    return `
      <div class="dash-tools">
        <input type="search" id="cat-search" placeholder="Search products…" value="${esc(q)}" aria-label="Search catalog">
        <button class="btn btn-sell" data-go="post">+ Add product</button>
      </div>
      <p class="small muted">Change a price or stock here: the website updates at once, Facebook within the hour.</p>
      <div class="cat-list">${list.map(row).join("") || `<p class="muted">No products match.</p>`}</div>`;
  }

  const status = p => !inFeed(p) ? ["skip", "Not in catalog: needs a price and a photo"]
    : p.in_stock ? ["ok", "In stock"] : p.custom_order ? ["est", "Available to order"] : ["sold", "Out of stock"];

  function row(p) {
    const [cls, label] = status(p);
    const img = (p.images || [])[0];
    const fb = (p.facebook_listings || []).filter(l => Number(l.price) !== Number(p.price_ghs)).length;
    return `<article class="cat-row" data-id="${esc(p.id)}">
      ${img ? `<img src="../${esc(img)}" alt="" loading="lazy">` : `<div class="cat-noimg">${esc(p.icon || "📦")}</div>`}
      <div class="cat-info">
        <div class="item-name">${esc(p.name)}</div>
        <div class="item-meta">${esc(p.id)} · ${esc(p.category || "")} · <span class="pill ${cls}">${esc(label)}</span>${onOffer(p) ? ` · <span class="pill est">Offer (was ${esc(C.formatPrice(p.was_price_ghs))})</span>` : ""}${p.seller ? ` · Sold by ${esc(p.seller.name)}` : ""}${fb ? ` · <a href="#pricesync" data-pricesync class="due">${fb} Marketplace listing${fb > 1 ? "s" : ""} at an old price</a>` : ""}</div>
      </div>
      <label class="cat-price">GH₵ <input type="number" min="0" step="1" value="${esc(p.price_ghs || "")}" data-cat-price aria-label="Price of ${esc(p.id)}"></label>
      <select data-cat-stock aria-label="Stock of ${esc(p.id)}">
        <option value="in" ${p.in_stock ? "selected" : ""}>In stock</option>
        <option value="order" ${!p.in_stock && p.custom_order ? "selected" : ""}>Made to order</option>
        <option value="out" ${!p.in_stock && !p.custom_order ? "selected" : ""}>Out of stock</option>
      </select>
      <button class="btn btn-ghost btn-sm" data-cat="edit">Edit details &amp; photos</button>
    </article>`;
  }

  function health() {
    const rows = all().map(p => [p, problems(p)]).filter(([, pr]) => pr.length)
      .sort((a, b) => (b[1].some(x => x[0] === "err") - a[1].some(x => x[0] === "err")) || b[1].length - a[1].length);
    return `
      <div class="card ch-sec">
        <h2>Fix problems</h2>
        <p class="small muted">Checked here, before Facebook sees them. Red = missing from the catalog or showing a wrong price. Amber = works, but ads and the Shop do better once fixed. Facebook's own list (policy, image and pixel issues) is in Commerce Manager.</p>
        <div class="ch-actions">${ext(L.issues, "Facebook's issue list")} ${ext(L.events, "Pixel match rate")}</div>
      </div>
      ${rows.length ? `<div class="cat-list">${rows.map(([p, pr]) => `
        <article class="cat-row ch-issue" data-id="${esc(p.id)}">
          ${(p.images || [])[0] ? `<img src="../${esc(p.images[0])}" alt="" loading="lazy">` : `<div class="cat-noimg">📦</div>`}
          <div class="cat-info"><div class="item-name">${esc(p.name)} <span class="muted small">${esc(p.id)}</span></div>
            <ul class="ch-probs">${pr.map(([l, t]) => `<li class="${l}">${esc(t)}</li>`).join("")}</ul></div>
          <button class="btn btn-primary btn-sm" data-cat="edit">Fix</button>
        </article>`).join("")}</div>` : `<p class="card">✓ No problems found. Every product is ready for the catalog.</p>`}`;
  }

  function setDefs() {
    const list = all().filter(inFeed);
    const byCat = {};
    list.forEach(p => { (byCat[p.category || "Other"] = byCat[p.category || "Other"] || []).push(p); });
    const defs = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length)
      .map(([cat, items]) => ({ name: cat, rule: `Custom label 0 · is · ${cat}`, items }));
    BANDS.forEach(([, label]) => { const items = list.filter(p => band(p) === label); if (items.length) defs.push({ name: `Budget: ${label}`, rule: `Custom label 1 · is · ${label}`, items }); });
    defs.push({ name: "On offer", rule: "Custom label 2 · is · On offer", items: list.filter(onOffer) });
    const furn = list.filter(p => /Living Room|Bedroom|Dining|Office|School/.test(p.category || ""));
    defs.push({ name: "All furniture", rule: "Custom label 0 · is any of · Living Room, Bedroom, Dining, Office, School", items: furn });
    return defs;
  }

  function sets() {
    return `
      <div class="card ch-sec">
        <h2>Product sets</h2>
        <p class="small muted">Sets group products into Shop collections and catalog-ad audiences (e.g. show "Dining" to people who looked at dining sets). Every product in your feed is labelled, so each set is one rule and keeps itself up to date.</p>
        <ol class="small">
          <li>Open ${ext(L.sets, "Sets")} → <b>Create set</b> → <b>Use filters</b>.</li>
          <li>Choose the attribute and value shown on the card (Copy value), name the set, <b>Create</b>.</li>
        </ol>
        <p class="small muted">If "Custom label 0" isn't offered yet, press Update on the Website feed in Data sources and try again in a few minutes.</p>
      </div>
      <div class="ch-sets">${setDefs().map(d => `
        <div class="card ch-set">
          <div><b>${esc(d.name)}</b> <span class="muted small">${d.items.length} product${d.items.length === 1 ? "" : "s"}</span></div>
          <code>${esc(d.rule)}</code>
          <div class="ch-thumbs">${d.items.slice(0, 8).map(p => (p.images || [])[0] ? `<img src="../${esc(p.images[0])}" alt="${esc(p.name)}" title="${esc(p.name)}" loading="lazy">` : "").join("")}</div>
          <button class="btn btn-ghost btn-sm" data-copy="${esc(d.rule.split(" · ").pop())}">Copy value</button>
        </div>`).join("")}</div>`;
  }

  function caption(p) {
    const b = A.business ? (A.business() || {}) : {};
    const phones = (b.phones || []).slice(0, 2).map(n => C.localPhone(n)).join(" / ");
    const price = p.price_ghs ? (onOffer(p) ? `🔥 Offer: ${C.formatPrice(p.price_ghs)} (was ${C.formatPrice(p.was_price_ghs)})${p.sale_until ? " until " + p.sale_until : ""}` : `💰 ${C.formatPrice(p.price_ghs)}${p.negotiable ? " (negotiable)" : ""}`) : "💰 Price on request";
    const hl = (p.highlights || []).slice(0, 3).map(h => `✅ ${h}`).join("\n");
    return `${p.name}\n\n${price}\n${hl ? hl + "\n" : ""}\n🛒 Tap the product tag for details, or order on WhatsApp${phones ? ": " + phones : ""}.\n📍 Odorkor · Omanjor · Kasoa | Delivery available\n\n${productLink(p)}\n\n#FAVisionEnterprise #FurnitureGhana #Accra #${(p.category || "Furniture").replace(/\W+/g, "")}`;
  }

  function tagTab() {
    const list = all().filter(inFeed);
    const p = list.find(x => x.id === tagId) || list[0];
    if (!p) return `<p class="card">No catalog products yet.</p>`;
    tagId = p.id;
    return `
      <div class="card ch-sec">
        <h2>Tag products in posts</h2>
        <p class="small muted">Posts with a product tag let people tap straight to the product. Pick it, copy the caption and photo, then tag it.</p>
        <label class="small">Product <select data-tag-pick>${list.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? "selected" : ""}>${esc(x.id)} · ${esc(x.name)}</option>`).join("")}</select></label>
        <div class="ch-tag">
          ${(p.images || [])[0] ? `<img src="../${esc(p.images[0])}" alt="">` : ""}
          <div>
            <textarea rows="11" readonly id="ch-caption">${esc(caption(p))}</textarea>
            <div class="ch-actions">
              <button class="btn btn-primary btn-sm" data-copy-el="#ch-caption">Copy caption</button>
              <a class="btn btn-ghost btn-sm" href="../${esc((p.images || [])[0] || "")}" download="${esc(p.id)}.jpg">Download photo</a>
              ${ext(L.composer, "Open post composer", "btn-sell")}
            </div>
          </div>
        </div>
        <details open><summary><b>How to tag it</b></summary>
          <ol class="small">
            <li><b>Meta Business Suite</b> (composer button): add the photo, paste the caption, tick Facebook and Instagram → <b>Tag products</b> → search <b>${esc(p.id)}</b> or the name → Publish.</li>
            <li><b>Facebook app</b>: create a post on your Page → add the photo → tap the 🏷 icon → <b>Tag products</b>.</li>
            <li><b>Instagram app</b>: new post → Next → <b>Tag products</b>. For reels and stories use the product sticker.</li>
          </ol>
          <p class="small muted">Clicks from tagged posts show in ${ext(L.tagged, "Tagged content insights")}.</p>
        </details>
      </div>`;
  }

  function ads() {
    const s = setDefs().filter(d => d.items.length);
    const errs = all().filter(p => problems(p).some(x => x[0] === "err")).length;
    return `
      <div class="card ch-sec">
        <h2>Advantage+ catalog ads</h2>
        <p class="small muted">One ad that automatically shows the right furniture to the right people, with your catalog photos and website prices.</p>
        <ul class="ch-check small">
          <li class="ok">Catalog connected to your website feed</li>
          <li class="ok">Website pixel sends the same product IDs as the catalog (FAV-…)</li>
          <li class="${errs ? "warn" : "ok"}">${errs ? `${errs} product(s) to fix first (Fix problems tab)` : "No blocking product problems"}</li>
          <li class="warn">Re-showing products to visitors needs a few days of pixel visits; start with broad Ghana targeting meanwhile</li>
        </ul>
        <h3>Set it up (about 5 minutes)</h3>
        <ol class="small">
          <li>${ext(L.ads, "Ads Manager")} → <b>+ Create</b> → objective <b>Sales</b> → turn on <b>Advantage+ catalog ads</b> → catalog <b>Products for F.A Vision Enterprise</b>.</li>
          <li>Ad set → <b>Product set</b>: start with <b>All furniture</b> (or one set below). Audience: Ghana, 22–60, around Accra / Kasoa. Budget: <b>GH₵50–100 a day</b> for 7 days so it can learn.</li>
          <li>Ad → format <b>Carousel</b>, paste the ad text below. Destination: <b>Website</b> (each product opens its page on your site).</li>
          <li>Publish. After 3–4 days keep the sets with the most clicks and WhatsApp messages.</li>
        </ol>
        <h3>Ad text</h3>
        <textarea rows="4" readonly id="ch-adtext">Quality furniture for homes, offices &amp; schools 🛋️ Delivered across Accra.
Get {{product.name}} for {{product.price}} at F.A Vision Enterprise · Odorkor, Omanjor &amp; Kasoa.
Order on WhatsApp: 020 747 3267 · 057 264 6176</textarea>
        <div class="ch-actions"><button class="btn btn-primary btn-sm" data-copy-el="#ch-adtext">Copy ad text</button>
          <button class="btn btn-ghost btn-sm" data-copy="{{product.name}} · {{product.price}}">Copy headline</button></div>
      </div>
      <div class="card ch-sec">
        <h3>Sets to try as separate ads</h3>
        <ul class="small">${s.map(d => `<li><b>${esc(d.name)}</b> (${d.items.length}) · <code>${esc(d.rule)}</code></li>`).join("")}</ul>
      </div>`;
  }

  function offers() {
    const list = all().filter(inFeed);
    const active = list.filter(onOffer);
    const choices = list.filter(p => !onOffer(p));
    return `
      <div class="card ch-sec">
        <h2>Offers</h2>
        <p class="small muted">Put a product on offer: the website shows the offer price with the normal price struck through, Buy now charges the offer price, and the catalog feed sends Facebook a sale price, so ads and the Shop show the discount. End it any time to go back to the normal price.</p>
        ${active.length ? `<h3>On offer now</h3><div class="cat-list">${active.map(p => `
          <article class="cat-row" data-id="${esc(p.id)}">
            ${(p.images || [])[0] ? `<img src="../${esc(p.images[0])}" alt="" loading="lazy">` : `<div class="cat-noimg">📦</div>`}
            <div class="cat-info"><div class="item-name">${esc(p.name)}</div>
              <div class="item-meta">${esc(C.formatPrice(p.price_ghs))} <s>${esc(C.formatPrice(p.was_price_ghs))}</s> · ${Math.round(100 - 100 * p.price_ghs / p.was_price_ghs)}% off${p.sale_until ? ` · until ${esc(p.sale_until)}${p.sale_until < today() ? ` <b class="due">ended</b>` : ""}` : ""}</div></div>
            <button class="btn btn-danger btn-sm" data-offer-end>End offer</button>
          </article>`).join("")}</div>` : ""}
        <h3>New offer</h3>
        <div class="ch-offer">
          <label class="small">Product <select id="of-pid">${choices.map(p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.name)} · ${esc(C.formatPrice(p.price_ghs))}</option>`).join("")}</select></label>
          <label class="small">Offer price (GH₵) <input type="number" id="of-price" min="1" step="1"></label>
          <label class="small">or % off <input type="number" id="of-pct" min="1" max="90" step="1" placeholder="10"></label>
          <label class="small">Ends (optional) <input type="date" id="of-until" min="${today()}"></label>
          <button class="btn btn-sell" data-offer-start>Start offer</button>
        </div>
        <p class="small muted">Promo codes (e.g. FAV10) are made in Commerce Manager: ${ext(L.offers, "Promotions → Offers")}</p>
      </div>`;
  }

  function more() {
    return `
      <div class="ch-grid">
        <div class="card ch-sec"><h2>🖼 Image templates</h2>
          <p class="small">Add a branded frame and live price tag to every catalog photo automatically, in ads only. Your website photos stay clean and the price on the image always matches the feed.</p>
          <ol class="small"><li>Open ${ext(L.templates, "Image templates")} → <b>Create template</b>.</li>
          <li>Frame colour <b>#0d55af</b> (brand blue); add a <b>Price</b> overlay (red <b>#f42c2c</b>, white text) top-left; add the text <b>“Order on WhatsApp · 057 264 6176”</b> at the bottom.</li>
          <li>Apply it to the set <b>All furniture</b>; pick it in a catalog ad under <b>Creative → Catalog options</b>.</li></ol></div>
        <div class="card ch-sec"><h2>🛍 Shop</h2>
          <p class="small">Your Facebook and Instagram Shop shows these catalog products. Organise it into collections, one per set from the Sets tab.</p>
          <div class="ch-actions">${ext(L.shops, "Shops")}</div></div>
        <div class="card ch-sec"><h2>📊 Insights</h2>
          <p class="small">Product views, clicks, saves and your best performers, plus results from tagged posts.</p>
          <div class="ch-actions">${ext(L.insights, "Overview")} ${ext(L.insightsProducts, "By product")} ${ext(L.tagged, "Tagged content")}</div></div>
        <div class="card ch-sec"><h2>🔐 Who can manage it</h2>
          <p class="small">Give a staff member access to the catalog only, not your whole business: Business settings → <b>Catalogs</b> → this catalog → <b>Assign people</b> → <b>Manage catalog</b>. Remove people who leave under <b>People</b>.</p>
          <div class="ch-actions">${ext(L.catalogsAccess, "Catalog access")} ${ext(L.people, "People")} ${ext(L.settings, "Commerce settings")}</div></div>
      </div>`;
  }

  // ---------------------------------------------------------------- saving
  async function save(id, change, message) {
    if (busyNow) return;
    busyNow = true;
    try {
      await A.commit({ message, mutate: list => list.map(p => p.id === id ? change(Object.assign({}, p)) : p) });
      A.toast("Saved ✓ Website updated now; Facebook catalog within the hour.");
      A.refreshDash();
    } catch (err) {
      A.toast(A.friendly(err), true);
    } finally {
      busyNow = false;
      render();
    }
  }

  async function copy(text, b) {
    try {
      await navigator.clipboard.writeText(text);
      if (b) { const t = b.textContent; b.textContent = "Copied ✓"; setTimeout(() => { b.textContent = t; }, 1500); }
    } catch (x) { prompt("Copy this:", text); }
  }

  screen.addEventListener("click", async e => {
    const t = e.target.closest("[data-tab]");
    if (t) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const c = e.target.closest("[data-copy]");
    if (c) return copy(c.dataset.copy, c);
    const ce = e.target.closest("[data-copy-el]");
    if (ce) { const el = $(ce.dataset.copyEl); return copy(el ? el.value : "", ce); }
    if (e.target.closest("[data-offer-end]")) {
      const id = e.target.closest("[data-id]").dataset.id;
      const p = all().find(x => x.id === id);
      if (!p || !confirm(`End the offer on ${p.name}? The price goes back to ${C.formatPrice(p.was_price_ghs)}.`)) return;
      return save(id, x => { if (x.was_price_ghs) x.price_ghs = x.was_price_ghs; delete x.was_price_ghs; delete x.sale_until; delete x.sale_from; return x; }, `Offer ended: ${id} back to GH₵${p.was_price_ghs}`);
    }
    if (e.target.closest("[data-offer-start]")) {
      const id = $("#of-pid") && $("#of-pid").value;
      const p = all().find(x => x.id === id);
      if (!p) return A.toast("Pick a product", true);
      let price = Math.round(Number($("#of-price").value));
      const pct = Number($("#of-pct").value);
      if (!(price > 0) && pct > 0) price = Math.round(p.price_ghs * (100 - pct) / 100);
      if (!(price > 0) || price >= p.price_ghs) return A.toast(`Offer price must be below ${C.formatPrice(p.price_ghs)}`, true);
      const until = $("#of-until").value || "";
      return save(id, x => { x.was_price_ghs = x.price_ghs; x.price_ghs = price; if (until) { x.sale_until = until; x.sale_from = today(); } return x; },
        `Offer: ${id} GH₵${price} (was GH₵${p.price_ghs})${until ? " until " + until : ""}`);
    }
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    if (b.dataset.cat === "copy") copy(FEED, b);
    else if (b.dataset.cat === "edit") A.edit(b.closest("[data-id]").dataset.id);
  });

  screen.addEventListener("change", e => {
    if (e.target.matches("[data-tag-pick]")) { tagId = e.target.value; return render(); }
    const r = e.target.closest("[data-id]");
    if (!r) return;
    const id = r.dataset.id;
    if (e.target.matches("[data-cat-price]")) {
      const v = Math.round(Number(e.target.value));
      if (!(v > 0)) { A.toast("Enter a price above 0", true); return render(); }
      // Typing a new normal price ends any running offer.
      save(id, p => { delete p.was_price_ghs; delete p.sale_until; delete p.sale_from; return Object.assign(p, { price_ghs: v }); }, `Catalog: ${id} price GH₵${v}`);
    } else if (e.target.matches("[data-cat-stock]")) {
      const v = e.target.value;
      save(id, p => Object.assign(p, { in_stock: v === "in", custom_order: v === "order" }), `Catalog: ${id} ${v === "in" ? "in stock" : v === "order" ? "made to order" : "out of stock"}`);
    }
  });

  document.addEventListener("click", e => { if (e.target.closest("[data-catalog]")) { e.preventDefault(); open(); } });
  window.FAV_CATALOG = { open, render };
})();
