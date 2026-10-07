(function () {
  const C = window.FAV_CONFIG;
  const CO = window.FAV_CHECKOUT;
  const { business, products } = window.FAV_DATA;
  const esc = C.escapeHtml;
  const $ = s => document.querySelector(s);
  const WA = business.whatsapp.replace(/\D/g, "");
  const SITE = (business.website || location.href.split("#")[0]).replace(/\/?$/, "/");

  const waLink = (msg, num) => `https://wa.me/${num || WA}?text=${encodeURIComponent(msg)}`;
  // Partner products (p.seller) are sold by another business: enquiries go to them.
  const sellerWa = p => p.seller && p.seller.whatsapp ? p.seller.whatsapp.replace(/\D/g, "") : "";
  const waFor = p => waLink(enquiry(p), sellerWa(p));
  const sellerName = p => p.seller ? p.seller.name + (p.seller.formerly ? ` (formerly ${p.seller.formerly})` : "") : "";
  const productUrl = p => `${SITE}#product/${p.id}`;

  // ---------- helpers ----------
  function media(p, alt) {
    const img = (p.images || [])[0];
    if (img) return `<img src="${esc(img)}" alt="${esc(alt || p.name)}" loading="lazy">`;
    return `<div class="ph" data-cat="${esc(p.category)}">${C.iconSvg(C.categoryIcon(p))}</div>`;
  }
  function priceHtml(p, cls) {
    if (!p.price_ghs) return `<span class="price request ${cls || ""}">Price on request</span>`;
    return `<span class="price ${cls || ""}"><small>${p.custom_order ? "From" : "Price"}</small>${C.formatPrice(p.price_ghs)}</span>`;
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function enquiry(p) {
    if (p.seller) return `Hello ${p.seller.name}, I saw the ${p.name} (${p.id}) on the F.A Vision website.${p.price_ghs ? ` Listed at ${C.formatPrice(p.price_ghs)}.` : ""} Is it available?\n${productUrl(p)}`;
    return `Hello F.A Vision, I'm interested in the ${p.name} (${p.id}).${p.price_ghs ? ` Listed at ${C.formatPrice(p.price_ghs)}.` : ""} Is it available?\n${productUrl(p)}`;
  }

  // Products with photos first, then in-stock, then the rest, keeping data order.
  const featured = products
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (!!(b.p.images || []).length - !!(a.p.images || []).length) || (b.p.in_stock - a.p.in_stock) || a.i - b.i)
    .map(x => x.p);

  // ---------- WhatsApp tap alerts ----------
  // Every tap on a WhatsApp link is logged in the backend Sheet, which texts the owner (SMS alerts,
  // backend/README.md). Throttled to one ping per link per visit so it can't flood.
  const pinged = new Set();
  document.addEventListener("click", e => {
    const a = e.target.closest('a[href^="https://wa.me/"]');
    // Checkout's own WhatsApp buttons (.co-pay) are skipped: that order is already recorded and alerted.
    if (!a || a.classList.contains("co-pay") || !business.enquiry_endpoint) return;
    let msg = "";
    try { msg = new URL(a.href).searchParams.get("text") || ""; } catch (err) { /* ignore */ }
    const key = msg.slice(0, 80);
    if (pinged.has(key) || pinged.size >= 5) return;
    pinged.add(key);
    fetch(business.enquiry_endpoint, {
      method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ name: "WhatsApp visitor", product: a.id === "promo-order" ? "Student desk promo" : "", message: msg, source: "whatsapp" })
    }).catch(() => {});
  });

  // ---------- static bits ----------
  document.querySelectorAll(".js-wa").forEach(a => {
    a.href = waLink(a.dataset.msg || "Hello F.A Vision!");
    a.target = "_blank";
    a.rel = "noopener";
  });
  $("#year").textContent = new Date().getFullYear();
  $("#pay-ways").innerHTML = CO.badges();
  // Locations and phones are written into index.html so search engines see them.
  // An exact Google Maps pin saved in data/business.json (locations[].maps_url) wins over the search link.
  (business.locations || []).forEach((loc, i) => {
    const a = document.querySelector(`.loc[data-loc="${i}"] .js-dir`);
    if (a && loc.maps_url) a.href = loc.maps_url;
  });

  const toggle = $("#nav-toggle"), links = $("#nav-links");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.addEventListener("click", e => {
    if (e.target.tagName === "A") { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
  });

  // Hero: three featured pieces from different categories
  const heroPicks = [];
  for (const p of featured) {
    if (heroPicks.length === 3) break;
    if (!heroPicks.some(h => h.category === p.category)) heroPicks.push(p);
  }
  $("#hero-stack").innerHTML = heroPicks.map(p => `
    <a class="hero-card" href="#product/${esc(p.id)}" tabindex="-1">
      <div class="media">${media(p)}</div>
      <div class="hc-body"><span class="hc-name">${esc(p.name)}</span><span class="hc-price">${p.price_ghs ? C.formatPrice(p.price_ghs) : "On request"}</span></div>
    </a>`).join("");

  const marqueeItems = ["Sofas", "Beds", "Wardrobes", "Dining sets", "Office desks", "School furniture", "Custom builds", "Re-upholstery", "Delivery across Ghana"];
  $("#marquee").innerHTML = [...marqueeItems, ...marqueeItems].map(t => `<span>${t}</span>`).join("");

  $("#quote-type").innerHTML += C.CATEGORIES.map(c => `<option>${esc(c.id)}</option>`).join("");
  $("#quote-form").addEventListener("submit", e => {
    e.preventDefault();
    const d = new FormData(e.target);
    window.open(waLink(`Hello F.A Vision, I'd like a quote.\nName: ${d.get("name")}\nFor: ${d.get("type")}\nDetails: ${d.get("details")}`), "_blank", "noopener");
    // Also log the request in the backend Sheet (backend/README.md), when configured.
    // text/plain + no-cors because Apps Script can't answer a CORS preflight.
    if (business.enquiry_endpoint) {
      fetch(business.enquiry_endpoint, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          name: d.get("name"), phone: d.get("phone"), product: d.get("type"),
          message: d.get("details"), source: "website",
        }),
      }).catch(() => {});
    }
  });

  // ---------- student desk promo ----------
  const promoPics = ["fav-014-muk5690f-1.jpg", "fav-014-muk5690f-3.jpg", "fav-014-muk5690f-4.jpg", "fav-014-muk5690f-5.jpg"]
    .map(f => "assets/images/products/" + f);
  const pImg = $("#promo-img"), pDots = $("#promo-dots");
  let pIdx = 0;
  if (pImg && pDots) {
    pDots.innerHTML = promoPics.map((_, i) => `<span class="${i ? "" : "on"}"></span>`).join("");
    promoPics.slice(1).forEach(src => { const i = new Image(); i.src = src; });
    $("#promo-pic").addEventListener("click", () => {
      pIdx = (pIdx + 1) % promoPics.length;
      pImg.classList.add("swap");
      setTimeout(() => { pImg.src = promoPics[pIdx]; pImg.classList.remove("swap"); }, 200);
      [...pDots.children].forEach((d, i) => d.classList.toggle("on", i === pIdx));
    });
  }
  const pQty = $("#promo-qty");
  if (pQty) {
    const cedis = n => "GH₵" + n.toLocaleString("en-GH");
    const quip = n => n === 1 ? "One proper study corner, coming right up."
      : n < 10 ? "A few happy students. Nice!"
      : n < 50 ? `${50 - n} more set${50 - n === 1 ? "" : "s"} and you unlock the bulk price.`
      : n < 150 ? "Bulk price unlocked! A whole classroom, sorted."
      : "Okay, Headmaster! We'll bring the truck.";
    const render = () => {
      let n = Math.max(1, Math.min(2000, parseInt(pQty.value, 10) || 1));
      pQty.value = n;
      const each = n >= 50 ? 640 : 650;
      $("#promo-each").textContent = `${cedis(each)} per set`;
      $(".promo-total").classList.toggle("bulk", n >= 50);
      const sum = $("#promo-sum");
      sum.textContent = cedis(each * n);
      sum.classList.remove("bump"); void sum.offsetWidth; sum.classList.add("bump");
      $("#promo-quip").textContent = quip(n);
      document.querySelectorAll(".promo-quick button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.qty) === n)));
      $("#promo-order").href = waLink(`Hello F.A Vision, I'd like ${n} student desk & chair set${n > 1 ? "s" : ""} (FAV-014) at ${cedis(each)} each, total ${cedis(each * n)}.`);
    };
    document.querySelectorAll(".promo-stepper button").forEach(b => b.addEventListener("click", () => {
      pQty.value = (parseInt(pQty.value, 10) || 1) + Number(b.dataset.step); render();
    }));
    document.querySelectorAll(".promo-quick button").forEach(b => b.addEventListener("click", () => { pQty.value = b.dataset.qty; render(); }));
    pQty.addEventListener("input", () => { if (pQty.value !== "") render(); });
    pQty.addEventListener("blur", render);
    render();
  }
  // Pointer on the order button: hides once the visitor taps order.
  const pointer = $(".order-pointer");
  const pOrder = $("#promo-order");
  if (pointer && pOrder) pOrder.addEventListener("click", () => pointer.classList.add("gone"));

  const shareBtn = $("#promo-share");
  if (shareBtn) shareBtn.addEventListener("click", async () => {
    // desks/ carries its own preview (photo, title, price) for WhatsApp/Facebook, then opens #promo.
    const url = SITE + "desks/";
    const text = "Student desk & chair sets from F.A Vision Enterprise: GH₵650 per set, GH₵640 each from 50 sets.";
    try {
      if (navigator.share) {
        const flyer = active && /^fav-014-/.test(active.ad) ? `assets/images/ads/${active.ad}.jpg` : "assets/images/promo-student-desks.jpg";
        const img = await fetch(flyer).then(r => r.blob()).catch(() => null);
        const file = img && new File([img], "fa-vision-student-desks.jpg", { type: "image/jpeg" });
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: `${text}\n${url}` });
        else await navigator.share({ title: "F.A Vision student desks", text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("Link copied. Paste it in WhatsApp or anywhere.");
    } catch (err) { /* share sheet dismissed */ }
  });

  // ---------- promo calendar & strategy ads ----------
  // business.promos.schedule: the first entry whose dates include today wins. "from"/"to" are
  // YYYY-MM-DD (one-off, e.g. the 2026 student desk consignment) or MM-DD (repeats every year), so
  // dated promos drop off by themselves and the year-round calendar takes over.
  const promoCfg = business.promos || { ads: [], schedule: [] };
  const adById = Object.fromEntries((promoCfg.ads || []).map(a => [a.id, a]));
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const ymd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, md = ymd.slice(5);
  const inWindow = s => {
    const t = s.from.length === 10 ? ymd : md;
    return s.from <= s.to ? (t >= s.from && t <= s.to) : (t >= s.from || t <= s.to);
  };
  const active = (promoCfg.schedule || []).find(inWindow);
  if (active) {
    const bar = $("#announce"), text = $("#announce-text");
    if (bar && text && active.bar) {
      // {price:FAV-001} placeholders show the product's current price.
      text.innerHTML = active.bar.replace(/\{price:([A-Z]+-\d+)\}/g, (m, id) => {
        const p = products.find(x => x.id === id);
        return p && p.price_ghs ? C.formatPrice(p.price_ghs).replace(" ", "") : "great prices";
      });
      bar.href = active.link || "#deals";
    }
    const sticker = $("#promo-sticker");
    if (sticker && active.sticker && (adById[active.ad] || {}).product === "FAV-014") sticker.textContent = active.sticker;
  }
  // Dated ads show only inside their own window; every other product ad is always on.
  const dated = new Set((promoCfg.schedule || []).filter(s => s.from.length === 10).map(s => s.ad));
  const seasonal = active ? [active.ad, ...(active.also || [])] : [];
  let deckIds = [...new Set([...seasonal, ...(promoCfg.ads || []).map(a => a.id)])]
    .filter(id => adById[id] && (!dated.has(id) || (active && active.ad === id)));
  if (deckIds.some(id => dated.has(id))) deckIds = deckIds.filter(id => id !== "fav-014");  // one desk ad at a time
  const adImg = a => `assets/images/ads/${a.id}.jpg`;
  const track = $("#deals-track");
  if (track && deckIds.length) {
    const pById = Object.fromEntries(products.map(p => [p.id, p]));
    track.innerHTML = deckIds.map(id => {
      const a = adById[id], p = pById[a.product] || {};
      const hot = seasonal.includes(id);
      return `<article class="deal${hot ? " hot" : ""}">
        <a class="deal-img" href="#product/${esc(a.product)}" aria-label="${esc(p.name || a.headline)}">
          <img src="${esc(adImg(a))}" alt="${esc(`${a.headline} ${a.accent}: ${p.name || ""}`)}" loading="lazy" width="1080" height="1350">
          ${hot ? `<span class="deal-flag">This season</span>` : ""}
        </a>
        <div class="deal-actions">
          <a class="btn btn-gold btn-sm" href="#product/${esc(a.product)}">View</a>
          <button class="btn btn-ghost btn-sm" type="button" data-share-ad="${esc(id)}">Share</button>
        </div>
      </article>`;
    }).join("");
    // The AI Studio Room Designer ad (scripts/make_studio_ad.py) leads the row.
    track.insertAdjacentHTML("afterbegin", `<article class="deal hot">
        <a class="deal-img" href="studio/#designer" aria-label="Design your room free in F.A Vision AI Studio">
          <img src="assets/images/ads/ai-studio.jpg" alt="See your room before you buy it: design your room free with F.A Vision AI Studio" loading="lazy" width="1080" height="1350">
          <span class="deal-flag">New · Free</span>
        </a>
        <div class="deal-actions">
          <a class="btn btn-gold btn-sm" href="studio/#designer">Try it</a>
          <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${waLink(`Design your room free and see it before you buy: ${SITE}studio/`)}">Share</a>
        </div>
      </article>`);
    if (window.FavCarousel) window.FavCarousel(track, { speed: 30 });
    track.addEventListener("click", async e => {
      const b = e.target.closest("[data-share-ad]");
      if (!b) return;
      const a = adById[b.dataset.shareAd], p = pById[a.product] || {};
      const url = `${SITE}#product/${a.product}`;
      const text = `${p.name || a.headline}${p.price_ghs ? " · " + C.formatPrice(p.price_ghs) : ""} from F.A Vision Enterprise`;
      try {
        if (navigator.share) {
          const blob = await fetch(adImg(a)).then(r => r.blob()).catch(() => null);
          const file = blob && new File([blob], `fa-vision-${a.id}.jpg`, { type: "image/jpeg" });
          if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: `${text}\n${url}` });
          else await navigator.share({ title: text, text, url });
          return;
        }
        window.open(waLink(`${text}\n${url}`), "_blank", "noopener");
      } catch (err) { /* share sheet dismissed */ }
    });
  } else if (track) {
    track.closest("section").hidden = true;
  }

  // ---------- invoice requests ----------
  // Saved in the backend Sheet's "Invoices" tab (when connected) and always sent on WhatsApp,
  // so no request is lost. The admin's Invoices screen turns a request into a numbered invoice.
  const inv = $("#invoice-form");
  const fld = inv.elements;
  const invRef = inv.querySelector(".inv-ref");
  const syncKind = () => { invRef.hidden = fld.kind.value !== "order"; };
  inv.addEventListener("change", e => { if (e.target.name === "kind") syncKind(); });

  // Buttons elsewhere (promo, checkout confirmation) jump here with details filled in.
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-invoice-for], [data-invoice-ref]");
    if (!a) return;
    e.preventDefault();
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    const d = a.dataset;
    fld.kind.value = d.invoiceKind || "proforma";
    if (d.invoiceRef) fld.order_ref.value = d.invoiceRef;
    if (d.invoiceFor) fld.items.value = d.invoiceFor;
    if (d.invoiceName) fld.name.value = d.invoiceName;
    if (d.invoicePhone) fld.phone.value = d.invoicePhone;
    if (d.invoiceEmail) fld.email.value = d.invoiceEmail;
    syncKind();
    history.replaceState(null, "", "#invoice");
    $("#invoice").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => (fld.name.value ? fld.items : fld.name).focus({ preventScroll: true }), 500);
  });

  inv.addEventListener("submit", e => {
    e.preventDefault();
    const f = new FormData(inv);
    const v = k => String(f.get(k) || "").trim();
    const err = $("#invoice-error");
    const problem = !v("name") ? "Please enter your name."
      : v("phone").replace(/\D/g, "").length < 9 ? "Please enter a phone number we can reach you on."
        : v("email") && !/^\S+@\S+\.\S+$/.test(v("email")) ? "That email address doesn't look right."
          : !v("items") ? "Please tell us the items and quantities."
            : v("kind") === "order" && !v("order_ref") ? "Please enter your order reference, or choose proforma invoice." : "";
    err.hidden = !problem;
    err.textContent = problem;
    if (problem) return;

    const id = "IR-" + Date.now().toString(36).toUpperCase();
    const kindLabel = v("kind") === "order" ? "Invoice for order" : "Proforma invoice";
    const req = {
      action: "invoice_request", request_id: id, kind: v("kind"), order_ref: v("order_ref"), name: v("name"),
      organisation: v("organisation"), phone: v("phone"), email: v("email"), address: v("address"),
      tin: v("tin"), po: v("po"), items: v("items"), website: v("website"), source: "website"
    };
    if (business.enquiry_endpoint) {
      fetch(business.enquiry_endpoint, {
        method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(req)
      }).catch(() => {});
    }
    const msg = `Hello F.A Vision, I'd like a ${kindLabel.toLowerCase()}.\nRequest: ${id}\n` +
      (req.order_ref ? `Order reference: ${req.order_ref}\n` : "") +
      `Name: ${req.name}\n` + (req.organisation ? `Organisation: ${req.organisation}\n` : "") +
      `Phone: ${req.phone}\n` + (req.email ? `Email: ${req.email}\n` : "") +
      (req.address ? `Address: ${req.address}\n` : "") + (req.tin ? `TIN: ${req.tin}\n` : "") + (req.po ? `PO: ${req.po}\n` : "") +
      `Items: ${req.items}`;
    window.open(waLink(msg), "_blank", "noopener");
    const done = $("#invoice-done");
    done.hidden = false;
    done.innerHTML = `Thank you, ${esc(req.name.split(" ")[0])}! Your request <b>${esc(id)}</b> has been sent. We'll send your ${esc(kindLabel.toLowerCase())} ${req.email ? `to <b>${esc(req.email)}</b> and ` : ""}on WhatsApp.`;
    inv.querySelector("button[type=submit]").textContent = "Send another request";
  });

  // ---------- catalogue ----------
  const state = { cat: "All", q: "", sort: "featured" };
  const cats = C.CATEGORIES.filter(c => products.some(p => p.category === c.id));

  function renderChips() {
    const all = `<button class="chip" role="tab" data-cat="All" aria-selected="${state.cat === "All"}">All <span class="count">${products.length}</span></button>`;
    $("#chips").innerHTML = all + cats.map(c => `
      <button class="chip" role="tab" data-cat="${esc(c.id)}" aria-selected="${state.cat === c.id}">
        ${C.iconSvg(C.ICONS[c.icon])}${esc(c.id)} <span class="count">${products.filter(p => p.category === c.id).length}</span>
      </button>`).join("");
  }

  function visible() {
    const q = state.q.trim().toLowerCase();
    let list = featured.filter(p =>
      (state.cat === "All" || p.category === state.cat) &&
      (!q || [p.name, p.type, p.category, p.description, p.material, ...(p.colors || [])].join(" ").toLowerCase().includes(q)));
    const price = p => p.price_ghs || Infinity;
    if (state.sort === "price-asc") list = [...list].sort((a, b) => price(a) - price(b));
    if (state.sort === "price-desc") list = [...list].sort((a, b) => (b.price_ghs || 0) - (a.price_ghs || 0));
    if (state.sort === "newest") list = [...list].sort((a, b) => b.id.localeCompare(a.id));
    return list;
  }

  function renderGrid() {
    const list = visible();
    $("#empty").hidden = list.length > 0;
    $("#grid").innerHTML = list.map((p, i) => {
      const badges = [
        !p.in_stock ? `<span class="badge sold">Sold out</span>` : "",
        p.custom_order ? `<span class="badge">Made to order</span>` : "",
        p.negotiable && p.price_ghs ? `<span class="badge gold">Negotiable</span>` : "",
        p.seller ? `<span class="badge partner">By ${esc(p.seller.name)}</span>` : ""
      ].join("");
      const n = (p.images || []).length;
      return `
      <article class="card" data-id="${esc(p.id)}" style="animation-delay:${Math.min(i, 8) * 40}ms" tabindex="0" aria-label="${esc(p.name)}">
        <div class="media">${media(p)}<div class="badges">${badges}</div>${n > 1 ? `<span class="photo-count">${n} photos</span>` : ""}</div>
        <div class="card-body">
          <span class="card-type">${esc(p.type || p.category)}</span>
          <h3>${esc(p.name)}</h3>
          <p class="card-desc">${esc(p.description)}</p>
          <div class="card-foot">
            ${priceHtml(p)}
            <a class="icon-btn" href="${waFor(p)}" target="_blank" rel="noopener" aria-label="Enquire about ${esc(p.name)} on WhatsApp" data-stop>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>
            </a>
          </div>
        </div>
      </article>`;
    }).join("");
  }

  $("#chips").addEventListener("click", e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    state.cat = b.dataset.cat;
    renderChips();
    renderGrid();
  });
  $("#search").addEventListener("input", e => { state.q = e.target.value; renderGrid(); });
  $("#sort").addEventListener("change", e => { state.sort = e.target.value; renderGrid(); });
  $("#grid").addEventListener("click", e => {
    if (e.target.closest("[data-stop]")) return;
    const card = e.target.closest(".card");
    if (card) location.hash = "product/" + card.dataset.id;
  });
  $("#grid").addEventListener("keydown", e => {
    const card = e.target.closest(".card");
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = "product/" + card.dataset.id; }
  });

  // ---------- product detail (deep-linkable: #product/FAV-001) ----------
  const dlg = $("#pd");
  const HOME_TITLE = document.title;

  function openProduct(p) {
    const imgs = p.images || [];
    const specs = [
      ["Category", p.type ? `${p.category} · ${p.type}` : p.category],
      ["Condition", p.condition],
      ["Material", p.material],
      ["Size", p.dimensions],
      ["Colours", (p.colors || []).join(", ")],
      ["Availability", p.in_stock ? (p.custom_order ? "Made to order" : "In stock") : "Sold out"],
      ["Sold by", sellerName(p)],
      ["Ref", p.id]
    ].filter(([, v]) => v);
    $("#pd-body").innerHTML = `
      <div class="gallery">
        <div class="media" id="pd-main">${media(p)}</div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((src, i) => `<button data-src="${esc(src)}" aria-current="${i === 0}" aria-label="Photo ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join("")}</div>` : ""}
        ${(() => { const cr = (p.image_credits || []).filter(c => imgs.includes(c.path)); return cr.length ? `<p class="pd-credit">Some photos show the same style of ${esc((p.type || "item").toLowerCase())}: ${cr.map(c => c.page ? `<a href="${esc(c.page)}" target="_blank" rel="noopener nofollow">${esc(c.creator || c.src)}</a>` : esc(c.creator || c.src)).join(", ")} (${esc([...new Set(cr.map(c => c.src))].join(", "))}).</p>` : ""; })()}
      </div>
      <div class="pd-info">
        <span class="card-type">${esc(p.type || p.category)}</span>
        <h2 id="pd-title">${esc(p.name)}</h2>
        <div class="pd-price">${p.price_ghs ? `${C.formatPrice(p.price_ghs)}<small>${p.negotiable ? "Negotiable" : "Fixed price"}</small>` : `<span class="price request">Price on request</span>`}</div>
        <p class="pd-desc">${esc(p.description)}</p>
        ${p.seller ? `<p class="pd-seller"><b>Sold by ${esc(sellerName(p))}</b>, a partner business. Call / WhatsApp ${p.seller.phones.map(n => `<a href="tel:${esc(n)}">${esc(C.localPhone(n))}</a>`).join(" · ")}${p.seller.address ? `<br>📍 ${esc(p.seller.address)}` : ""}</p>` : ""}
        ${(p.highlights || []).length ? `<ul class="features">${p.highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
        ${CO.canBuy(p) ? `<div class="pd-pay">${CO.badges()}<small>Pay in full, pay a deposit, pay on delivery or walk in and pay.</small></div>` : ""}
        <dl class="specs">${specs.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        <div class="pd-actions">
          ${CO.canBuy(p) ? `<button class="btn btn-gold pd-buy" id="pd-buy" type="button">Buy now</button>` : ""}
          <a class="btn btn-wa" href="${waFor(p)}" target="_blank" rel="noopener">Order on WhatsApp</a>
          <a class="btn btn-outline" href="tel:${esc(p.seller ? p.seller.phones[0] : (business.phones ? business.phones[0] : business.whatsapp))}">Call</a>
          <button class="btn btn-outline" id="pd-share" type="button">Share</button>
        </div>
      </div>`;
    const thumbs = dlg.querySelector(".thumbs");
    if (thumbs) thumbs.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      $("#pd-main").innerHTML = `<img src="${esc(b.dataset.src)}" alt="${esc(p.name)}">`;
      thumbs.querySelectorAll("button").forEach(x => x.setAttribute("aria-current", String(x === b)));
    });
    const buy = $("#pd-buy");
    if (buy) buy.addEventListener("click", () => CO.open(p));
    $("#pd-share").addEventListener("click", async () => {
      if (window.FAV_SHARE) return window.FAV_SHARE.open(p.id);
      const data = { title: p.name, text: `${p.name}${p.price_ghs ? " · " + C.formatPrice(p.price_ghs) : ""} from ${p.seller ? p.seller.name : "F.A Vision Enterprise"}`, url: productUrl(p) };
      try {
        if (navigator.share) { await navigator.share(data); return; }
        await navigator.clipboard.writeText(`${data.text}\n${data.url}`);
        toast("Link copied. Paste it in WhatsApp or anywhere.");
      } catch (err) { /* share sheet dismissed */ }
    });
    document.title = `${p.name} | F.A Vision Enterprise`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }

  function closeProduct() {
    if (dlg.open) dlg.close();
  }

  function route() {
    const m = location.hash.match(/^#product\/(.+)$/);
    const p = m && products.find(x => x.id === decodeURIComponent(m[1]));
    if (p) openProduct(p); else closeProduct();
  }

  dlg.addEventListener("close", () => {
    document.title = HOME_TITLE;
    if (location.hash.startsWith("#product/")) history.replaceState(null, "", "#shop");
  });
  $("#pd-close").addEventListener("click", closeProduct);
  dlg.addEventListener("click", e => { if (e.target === dlg) closeProduct(); });
  window.addEventListener("hashchange", route);

  renderChips();
  renderGrid();
  route();
})();
