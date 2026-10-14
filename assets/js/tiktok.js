// TikTok shop page (/tiktok/). TikTok Shop isn't open to Ghana sellers, so this page is the
// TikTok bio link instead: the products picked in admin → Commerce hub → "TikTok shop" tab
// (a "tiktok": <position> number on each product in data/products.json; no number = hidden),
// with one-tap WhatsApp ordering and the site's own checkout for deposits.
// Everything that leaves this page is tagged so TikTok orders can be told apart:
//   WhatsApp messages say "on your TikTok"; links carry ?src=tiktok; WhatsApp taps are logged
//   in the backend with source "tiktok" (Leads shows them as TikTok); checkout orders carry
//   source "tiktok" and "· via TikTok" on the product line in the Orders sheet.
(function () {
  const C = window.FAV_CONFIG;
  const CO = window.FAV_CHECKOUT;
  const { business, products } = window.FAV_DATA;
  const esc = C.escapeHtml;
  const $ = s => document.querySelector(s);
  const SITE = (business.website || "https://favisionenterprize.github.io/").replace(/\/?$/, "/");
  const SRC = "src=tiktok";
  const WA = business.whatsapp.replace(/\D/g, "");
  const digits = n => String(n || "").replace(/\D/g, "");

  // ---------- which products, in which order
  // Products with a "tiktok" position, lowest first. If none are picked yet, fall back to
  // in-stock products with the student desk (FAV-014) and chairs first.
  function picked() {
    const live = products.filter(p => !p.placeholder);
    const chosen = live.filter(p => Number(p.tiktok) > 0).sort((a, b) => a.tiktok - b.tiktok);
    if (chosen.length) return chosen;
    const chair = p => /chair/i.test(p.type || "") || /chair/i.test(p.name);
    const score = p => p.id === "FAV-014" ? 0 : chair(p) ? 1 : p.seller ? 3 : 2;
    return live.filter(p => p.in_stock).map((p, i) => ({ p, i })).sort((a, b) => score(a.p) - score(b.p) || a.i - b.i).map(x => x.p);
  }
  const list = picked();

  // ---------- links and messages
  // p/<id>.html is the share page (photo preview card in WhatsApp); it redirects to the main site.
  const productPage = p => `${SITE}p/${encodeURIComponent(p.id)}.html?${SRC}`;
  const siteProduct = p => `${SITE}?${SRC}#product/${encodeURIComponent(p.id)}`;
  const sellerWa = p => p.seller ? digits(p.seller.whatsapp || (p.seller.phones || [])[0]) : "";
  const callNumber = p => p.seller ? (p.seller.phones || [])[0] || p.seller.whatsapp : business.phones[0];
  const wasOf = p => (p.was_price_ghs && p.price_ghs && p.was_price_ghs > p.price_ghs) ? p.was_price_ghs : 0;
  function message(p) {
    const who = p.seller ? p.seller.name : "F.A Vision";
    const where = p.seller ? "on the F.A Vision TikTok shop" : "on your TikTok";
    const price = p.price_ghs ? ` Listed at ${C.formatPrice(p.price_ghs)}.` : "";
    return `Hello ${who}, I saw the ${p.name} (${p.id}) ${where}.${price} Is it available? I'd like to order.\n(From TikTok)\n${productPage(p)}`;
  }
  const waHref = p => `https://wa.me/${sellerWa(p) || WA}?text=${encodeURIComponent(message(p))}`;
  const canDeposit = p => !!(CO && CO.canBuy(p) && CO.payNow);

  // ---------- small bits of markup
  const WA_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5A11 11 0 0 0 3.2 17.1L2 22l5-1.3A11 11 0 1 0 20.5 3.5zM12 20a8.9 8.9 0 0 1-4.6-1.3l-.3-.2-3 .8.8-2.9-.2-.3A9 9 0 1 1 12 20z"/></svg>';
  function priceHtml(p) {
    if (!p.price_ghs) return `<span class="tt-price request">Price on request</span>`;
    const was = wasOf(p);
    return `<span class="tt-price"><small>${was ? "Offer" : p.custom_order ? "From" : ""}</small>${C.formatPrice(p.price_ghs)}${was ? ` <s>${C.formatPrice(was)}</s>` : ""}</span>`;
  }
  function badges(p, i) {
    const out = [];
    if (i === 0) out.push(`<span class="tt-badge top">Top pick</span>`);
    if (wasOf(p)) out.push(`<span class="tt-badge offer">Offer</span>`);
    if (p.in_stock && !p.custom_order) out.push(`<span class="tt-badge stock">In stock</span>`);
    else if (p.in_stock) out.push(`<span class="tt-badge order">Made to order</span>`);
    else out.push(`<span class="tt-badge out">Sold out</span>`);
    return `<span class="tt-badges">${out.join("")}</span>`;
  }
  function blurb(p) {
    const h = (p.highlights || [])[0];
    if (h) return h;
    const first = String(p.description || "").split(/(?<=[.!?])\s/)[0];
    return first.length > 110 ? first.slice(0, 107) + "…" : first;
  }
  const sellerLine = p => p.seller ? `<span class="tt-seller">Sold by ${esc(p.seller.name)}</span>` : "";
  function actions(p, big) {
    return `<a class="tt-btn tt-wa" href="${esc(waHref(p))}" target="_blank" rel="noopener" data-wa="${esc(p.id)}">${big ? WA_ICON + " " : ""}${p.in_stock ? "Order on WhatsApp" : "Ask on WhatsApp"}</a>` +
      (canDeposit(p) ? `<button class="tt-btn tt-dep" type="button" data-deposit="${esc(p.id)}">Pay deposit${big ? " (MoMo)" : ""}</button>` : "");
  }

  // ---------- grid
  let cat = "All";
  const cats = ["All", ...new Set(list.map(p => p.category).filter(Boolean))];
  function renderChips() {
    $("#tt-chips").innerHTML = cats.length > 2 ? cats.map(c => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === cat}">${esc(c)}</button>`).join("") : "";
  }
  function renderGrid() {
    const shown = list.filter(p => cat === "All" || p.category === cat);
    $("#tt-count").textContent = `${shown.length} item${shown.length === 1 ? "" : "s"}${cat === "All" ? "" : " in " + cat}`;
    $("#tt-grid").innerHTML = shown.length ? shown.map(p => {
      const i = list.indexOf(p), img = (p.images || [])[0], n = (p.images || []).length;
      return `<article class="tt-card">
        <button class="tt-open" type="button" data-open="${esc(p.id)}" aria-label="${esc(p.name)}: see all photos and details">
          <span class="tt-media">${img ? `<img src="../${esc(img)}" alt="" loading="${i < 4 ? "eager" : "lazy"}" width="400" height="400">` : `<span class="ph">${C.iconSvg(C.categoryIcon(p), 40)}</span>`}
            ${badges(p, i)}${n > 1 ? `<span class="tt-photos">${n} photos</span>` : ""}</span>
          <span class="tt-info">
            ${priceHtml(p)}
            <span class="tt-name">${esc(p.name)}</span>
            <span class="tt-blurb">${esc(blurb(p))}</span>
            ${sellerLine(p)}
          </span>
        </button>
        <div class="tt-acts">${actions(p, false)}</div>
      </article>`;
    }).join("") : `<p class="tt-empty">Nothing here right now. <a href="${esc(SITE)}?${SRC}#shop">See the full shop</a>.</p>`;
  }

  // ---------- quick view (all photos). Uses #product/FAV-xxx so the Meta pixel logs ViewContent
  // and a shared link opens the same product.
  const dlg = $("#tt-qv");
  function quickView(p) {
    const imgs = (p.images || []).length ? p.images : [null];
    const specs = [["Material", p.material], ["Size", p.dimensions], ["Colours", (p.colors || []).join(", ")], ["Ref", p.id]].filter(([, v]) => v);
    $("#tt-qv-body").innerHTML = `<div class="tt-qv-inner">
      <div class="tt-gal">
        <div class="tt-slides" id="tt-slides" tabindex="0" aria-label="Photos of ${esc(p.name)}">
          ${imgs.map((src, i) => `<figure>${src ? `<img src="../${esc(src)}" alt="${esc(p.name)}, photo ${i + 1} of ${imgs.length}" loading="${i ? "lazy" : "eager"}">` : `<span class="ph">${C.iconSvg(C.categoryIcon(p), 60)}</span>`}</figure>`).join("")}
        </div>
        ${imgs.length > 1 ? `<div class="tt-thumbs">${imgs.map((src, i) => `<button type="button" data-slide="${i}" aria-current="${i === 0}" aria-label="Show photo ${i + 1}"><img src="../${esc(src)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="tt-qv-info">
        ${badges(p, list.indexOf(p))}
        <h2 id="tt-qv-title">${esc(p.name)}</h2>
        ${priceHtml(p)}
        ${p.seller ? `<p class="tt-seller">Sold and delivered by ${esc(p.seller.name)}${p.seller.formerly ? ` (formerly ${esc(p.seller.formerly)})` : ""}, a partner business. WhatsApp and calls go straight to them.</p>` : ""}
        <p class="tt-qv-desc">${esc(p.description || "")}</p>
        ${(p.highlights || []).length ? `<ul class="features">${p.highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
        ${specs.length ? `<dl class="specs">${specs.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
        <div class="tt-qv-acts">${actions(p, true)}</div>
        <a class="tt-btn tt-call" href="tel:${esc(callNumber(p))}">Call ${esc(C.localPhone(callNumber(p)))}${p.seller ? " (" + esc(p.seller.name) + ")" : ""}</a>
        <a class="tt-qv-link" href="${esc(siteProduct(p))}">Full product page →</a>
      </div>
    </div>`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    const slides = $("#tt-slides");
    slides.addEventListener("scroll", () => {
      const i = Math.round(slides.scrollLeft / slides.clientWidth);
      dlg.querySelectorAll("[data-slide]").forEach(b => b.setAttribute("aria-current", String(+b.dataset.slide === i)));
    }, { passive: true });
  }
  function openFromHash() {
    const m = location.hash.match(/^#product\/(.+)$/);
    const p = m && products.find(x => x.id === decodeURIComponent(m[1]));
    if (p) quickView(p); else if (dlg.open) dlg.close();
  }
  dlg.addEventListener("click", e => {
    if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
    const s = e.target.closest("[data-slide]");
    if (s) { const sl = $("#tt-slides"); sl.scrollTo({ left: sl.clientWidth * +s.dataset.slide, behavior: "smooth" }); }
  });
  dlg.addEventListener("close", () => { if (/^#product\//.test(location.hash)) history.replaceState(null, "", location.pathname + location.search); });
  window.addEventListener("hashchange", openFromHash);

  // ---------- deposit: the site's checkout, opened on the deposit plan, tagged as a TikTok order
  function deposit(p) {
    if (dlg.open) dlg.close();
    CO.open(Object.assign({}, p, {
      images: (p.images || []).map(i => /^(https?:)?\//.test(i) ? i : "../" + i),   // this page is one folder down
      onRecord: order => { order.source = "tiktok"; if (!/via TikTok/.test(order.product)) order.product += " · via TikTok"; }
    }));
    const r = document.querySelector('#co input[name=plan][value=deposit]');
    if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
  }

  // ---------- WhatsApp taps are logged in the backend Sheet as TikTok leads (like site.js does
  // for the main site), at most once per product and 5 per visit.
  const pinged = new Set();
  function logTap(p) {
    if (!business.enquiry_endpoint || pinged.has(p ? p.id : "") || pinged.size >= 5) return;
    pinged.add(p ? p.id : "");
    fetch(business.enquiry_endpoint, {
      method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ name: "TikTok visitor (WhatsApp tap)", product: p ? `${p.name} (${p.id})` : "", message: p ? message(p) : "WhatsApp chat from the TikTok shop page", source: "tiktok" })
    }).catch(() => {});
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("[data-cat],[data-open],[data-deposit],[data-wa],#tt-wa-float");
    if (!t) return;
    if (t.dataset.cat) { cat = t.dataset.cat; renderChips(); renderGrid(); return; }
    if (t.dataset.open) { location.hash = "product/" + t.dataset.open; return; }
    const p = products.find(x => x.id === (t.dataset.deposit || t.dataset.wa));
    if (t.dataset.deposit && p) { e.preventDefault(); deposit(p); return; }
    logTap(t.id === "tt-wa-float" ? null : p);
  });

  // ---------- static bits
  $("#tt-wa-float").href = `https://wa.me/${WA}?text=${encodeURIComponent("Hello F.A Vision, I found you on TikTok. I'd like to ask about your furniture.\n(From TikTok)")}`;
  $("#tt-phones").innerHTML = business.phones.map(n => `<a href="tel:${esc(n)}">${esc(C.localPhone(n))}</a>`).join(" · ");
  $("#tt-year").textContent = new Date().getFullYear();
  if (CO) $("#tt-pay").innerHTML = CO.badges();
  renderChips();
  renderGrid();
  openFromHash();
})();
