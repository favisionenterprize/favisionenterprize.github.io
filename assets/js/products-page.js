/* /products/: every product as a grid with category chips, search and price sort.
   Data: window.FAV_DATA (products-data.js); grouping and price text from window.FAV_NAV (nav.js). */
(function () {
  "use strict";
  const data = window.FAV_DATA, N = window.FAV_NAV;
  if (!data || !N) return;
  const { business, products } = data;
  const { esc, money, groupProducts, searchText } = N;
  const ROOT = "../";
  const SITE = String(business.website || "https://favisionenterprize.github.io/").replace(/\/?$/, "/");
  const WA = String(business.whatsapp || "+233572646176").replace(/\D/g, "");
  const $ = s => document.querySelector(s);

  const groups = groupProducts(products);
  const groupOf = new Map();
  groups.forEach(g => g.items.forEach(p => groupOf.set(p.id, g.name)));
  // Featured: pinned products first ("featured": 1, 2…; FAV-014 if none is set), then products
  // with photos, then in stock, keeping data order (as on the home page).
  const anyPinned = products.some(p => Number(p.featured) > 0);
  const pinOf = p => Number(p.featured) > 0 ? Number(p.featured) : (!anyPinned && p.id === "FAV-014" ? 1 : Infinity);
  const featuredRank = new Map(products.map((p, i) => ({ p, i }))
    .sort((a, b) => (pinOf(a.p) - pinOf(b.p) || 0) || (!!(b.p.images || []).length - !!(a.p.images || []).length) || ((b.p.in_stock ? 1 : 0) - (a.p.in_stock ? 1 : 0)) || a.i - b.i)
    .map((x, r) => [x.p.id, r]));

  const params = new URLSearchParams(location.search);
  let cat = groups.some(g => g.name === params.get("cat")) ? params.get("cat") : "All";
  let q = params.get("q") || "";
  let sort = params.get("sort") || "featured";
  $("#pl-q").value = q;
  if ($(`#pl-sort option[value="${sort}"]`)) $("#pl-sort").value = sort; else sort = "featured";

  const wasOf = p => (p.was_price_ghs && p.price_ghs && p.was_price_ghs > p.price_ghs) ? p.was_price_ghs : 0;
  function priceHtml(p) {
    if (!p.price_ghs) return `<span class="pl-price">Price on request</span>`;
    const w = wasOf(p);
    return `<span class="pl-price">${p.custom_order && !w ? "From " : ""}${esc(money(p.price_ghs))}${w ? `<s>${esc(money(w))}</s>` : ""}</span>`;
  }
  function badge(p) {
    if (p.custom_order) return `<span class="pl-badge order">Made to order</span>`;
    if (p.in_stock === false) return `<span class="pl-badge out">Ask for stock</span>`;
    return `<span class="pl-badge">In stock</span>`;
  }
  function waHref(p) {
    const url = `${SITE}p/${p.id}.html`;
    const price = p.price_ghs ? ` Listed at ${money(p.price_ghs)}.` : "";
    const msg = p.seller
      ? `Hello ${p.seller.name}, I saw the ${p.name} (${p.id}) on the F.A Vision website.${price} Is it available?\n${url}`
      : `Hello F.A Vision, I'm interested in the ${p.name} (${p.id}).${price} Is it available?\n${url}`;
    const num = p.seller && p.seller.whatsapp ? p.seller.whatsapp.replace(/\D/g, "") : WA;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  }

  function renderChips() {
    const chip = (name, n) => `<button type="button" class="chip" role="tab" data-cat="${esc(name)}" aria-selected="${cat === name}">${esc(name)} <span class="count">${n}</span></button>`;
    $("#pl-chips").innerHTML = chip("All", products.length) + groups.map(g => chip(g.name, g.items.length)).join("");
  }
  function list() {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out = products.filter(p => (cat === "All" || groupOf.get(p.id) === cat) && words.every(w => searchText(p).includes(w)));
    const price = p => p.price_ghs || Infinity;
    if (sort === "price-asc") out.sort((a, b) => price(a) - price(b));
    else if (sort === "price-desc") out.sort((a, b) => (b.price_ghs || -1) - (a.price_ghs || -1));
    else if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else out.sort((a, b) => featuredRank.get(a.id) - featuredRank.get(b.id));
    return out;
  }
  function renderGrid() {
    const items = list();
    $("#pl-grid").innerHTML = items.map((p, i) => {
      const img = (p.images || [])[0];
      const view = `${ROOT}p/${esc(p.id)}.html`;
      const top = sort === "featured" && pinOf(p) !== Infinity && featuredRank.get(p.id) === 0;
      return `<article class="pl-card${top ? " is-top" : ""}">
        <a class="pl-img" href="${view}" tabindex="-1" aria-hidden="true">
          ${img ? `<img src="${esc(ROOT + img)}" alt="" loading="${i < 4 ? "eager" : "lazy"}" decoding="async">` : `<span class="pl-ph">${esc(p.icon || "▢")}</span>`}
          ${badge(p)}${top ? `<span class="pl-top">★ Top pick</span>` : ""}
        </a>
        <div class="pl-body">
          <span class="pl-cat">${esc(p.category || "")}</span>
          <h2 class="pl-name"><a href="${view}">${esc(p.name)}</a></h2>
          ${priceHtml(p)}
          ${p.seller ? `<span class="pl-seller">Sold by ${esc(p.seller.name)}, a partner business</span>` : ""}
          <div class="pl-acts">
            <a class="btn btn-ghost btn-sm" href="${view}">View</a>
            <a class="btn btn-wa btn-sm" href="${esc(waHref(p))}" target="_blank" rel="noopener" data-wa="${esc(p.id)}">Order on WhatsApp</a>
          </div>
        </div>
      </article>`;
    }).join("");
    $("#pl-empty").hidden = items.length > 0;
    $("#pl-count").textContent = `${items.length} product${items.length === 1 ? "" : "s"}${cat !== "All" ? ` in ${cat}` : ""}${q.trim() ? ` matching “${q.trim()}”` : ""}`;
    const p = new URLSearchParams();
    if (cat !== "All") p.set("cat", cat);
    if (q.trim()) p.set("q", q.trim());
    if (sort !== "featured") p.set("sort", sort);
    const qs = p.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "")); } catch (_) { /* ignore */ }
  }

  $("#pl-chips").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    cat = b.dataset.cat; renderChips(); renderGrid();
  });
  $("#pl-q").addEventListener("input", e => { q = e.target.value; renderGrid(); });
  $("#pl-sort").addEventListener("change", e => { sort = e.target.value; renderGrid(); });

  // WhatsApp taps are logged in the backend Sheet like on the home page (once per product, max 5 per visit).
  const pinged = new Set();
  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-wa]");
    if (!a || !business.enquiry_endpoint || pinged.has(a.dataset.wa) || pinged.size >= 5) return;
    pinged.add(a.dataset.wa);
    const p = products.find(x => x.id === a.dataset.wa);
    let msg = "";
    try { msg = new URL(a.href).searchParams.get("text") || ""; } catch (_) { /* ignore */ }
    fetch(business.enquiry_endpoint, {
      method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ name: "WhatsApp visitor", product: p ? `${p.name} (${p.id})` : "", message: msg, source: "whatsapp" })
    }).catch(() => {});
  });

  renderChips();
  renderGrid();
})();
