// Facebook catalog (admin → 🏷 Facebook catalog): the products used for Facebook/Instagram
// product tags and the Shop. Meta reads them from the catalog feed output/meta-catalog.csv,
// which scripts/generate_listings.py rebuilds from data/products.json after every change
// (rebuild-ads.yml). So: change a price, stock or details here → the website updates at once
// and Facebook picks the new price up on its next feed fetch (set the feed to Hourly).
(function () {
  const C = window.FAV_CONFIG, A = window.FAV_ADMIN;
  const $ = s => document.querySelector(s);
  const screen = $("#screen-catalog");
  if (!C || !A || !screen) return;
  const esc = C.escapeHtml;
  const FEED = "https://favisionenterprize.github.io/output/meta-catalog.csv";
  const COMMERCE = "https://business.facebook.com/commerce/";
  let q = "", busyNow = false;

  function open() {
    if (A.signedIn && !A.signedIn()) return A.show("login");
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#catalog") history.replaceState(null, "", "#catalog");
    render();
  }

  const status = p => !p.price_ghs || !(p.images || []).length ? ["skip", "Not in catalog: needs a price and a photo"]
    : p.in_stock ? ["ok", "In stock"] : p.custom_order ? ["est", "Available to order"] : ["sold", "Out of stock"];

  function render() {
    const all = A.products().filter(p => !p.placeholder);
    const list = all.filter(p => !q || (p.id + " " + p.name + " " + (p.category || "")).toLowerCase().includes(q.toLowerCase()));
    const inFeed = all.filter(p => status(p)[0] !== "skip").length;
    $("#cat-body").innerHTML = `
      <div class="card cat-feed">
        <h2>Your catalog feed</h2>
        <p class="muted small">${inFeed} of ${all.length} products are in the feed. Facebook updates product tags and your Shop from this link, so the prices always match your website.</p>
        <div class="leads-inline"><input readonly value="${esc(FEED)}" aria-label="Catalog feed link"><button class="btn btn-primary btn-sm" data-cat="copy">Copy link</button>
          <a class="btn btn-ghost btn-sm" href="${esc(FEED)}" download>Download CSV</a></div>
        <details><summary><b>Connect it once</b> (2 minutes)</summary>
          <ol class="small">
            <li>Open <a href="${COMMERCE}" target="_blank" rel="noopener">Commerce Manager</a> → your catalog → <b>Catalog → Data sources</b>.</li>
            <li><b>Add items → Data feed → Next → Use a URL</b>, paste the link above, schedule <b>Hourly</b>, currency <b>GHS</b>.</li>
            <li>Upload. Items with the same ID (FAV-001 …) are updated, not duplicated. Old items you added by hand can be deleted from the catalog.</li>
          </ol>
          <p class="small muted">After that, every price, photo or stock change you save here reaches Facebook by itself within about an hour.</p>
        </details>
      </div>
      <div class="dash-tools">
        <input type="search" id="cat-search" placeholder="Search products…" value="${esc(q)}" aria-label="Search catalog">
        <button class="btn btn-sell" data-go="post">+ Add product</button>
      </div>
      <div class="cat-list">${list.map(row).join("") || `<p class="muted">No products match.</p>`}</div>`;
    const s = $("#cat-search");
    s.addEventListener("input", e => { q = e.target.value; const pos = e.target.selectionStart; render(); const t = $("#cat-search"); t.focus(); try { t.setSelectionRange(pos, pos); } catch (x) { /* */ } });
  }

  function row(p) {
    const [cls, label] = status(p);
    const img = (p.images || [])[0];
    const fb = (p.facebook_listings || []).filter(l => Number(l.price) !== Number(p.price_ghs)).length;
    return `<article class="cat-row" data-id="${esc(p.id)}">
      ${img ? `<img src="../${esc(img)}" alt="" loading="lazy">` : `<div class="cat-noimg">${esc(p.icon || "📦")}</div>`}
      <div class="cat-info">
        <div class="item-name">${esc(p.name)}</div>
        <div class="item-meta">${esc(p.id)} · ${esc(p.category || "")} · <span class="pill ${cls}">${esc(label)}</span>${p.seller ? ` · Sold by ${esc(p.seller.name)}` : ""}${fb ? ` · <a href="#pricesync" data-pricesync class="due">${fb} Marketplace listing${fb > 1 ? "s" : ""} at an old price</a>` : ""}</div>
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

  screen.addEventListener("click", async e => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    if (b.dataset.cat === "copy") {
      try { await navigator.clipboard.writeText(FEED); b.textContent = "Copied ✓"; } catch (x) { prompt("Copy this link:", FEED); }
    } else if (b.dataset.cat === "edit") {
      A.edit(b.closest("[data-id]").dataset.id);
    }
  });

  screen.addEventListener("change", e => {
    const r = e.target.closest("[data-id]");
    if (!r) return;
    const id = r.dataset.id;
    if (e.target.matches("[data-cat-price]")) {
      const v = Math.round(Number(e.target.value));
      if (!(v > 0)) { A.toast("Enter a price above 0", true); return render(); }
      save(id, p => Object.assign(p, { price_ghs: v }), `Catalog: ${id} price GH₵${v}`);
    } else if (e.target.matches("[data-cat-stock]")) {
      const v = e.target.value;
      save(id, p => Object.assign(p, { in_stock: v === "in", custom_order: v === "order" }), `Catalog: ${id} ${v === "in" ? "in stock" : v === "order" ? "made to order" : "out of stock"}`);
    }
  });

  document.addEventListener("click", e => { if (e.target.closest("[data-catalog]")) { e.preventDefault(); open(); } });
  window.FAV_CATALOG = { open, render };
})();
