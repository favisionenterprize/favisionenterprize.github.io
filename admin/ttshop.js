// TikTok shop card (Social autopilot → "X & TikTok" tab, top card).
// Picks which products show on /tiktok/ (the TikTok bio link; TikTok Shop isn't open to
// Ghana sellers) and their order. Stored as "tiktok": <position> on each product in
// data/products.json (1 = first; no number = hidden), saved with FAV_ADMIN.commit like every
// other product edit, so the page updates about a minute later.
// There is no visit counter (the backend has no action for it and Code.gs is pinned). "Count
// TikTok orders" reads the Leads data (?action=customers): orders from the page carry
// "· via TikTok" on the product line. WhatsApp taps are logged as Enquiries rows with Source
// "tiktok", but the customers feed leaves out rows without a phone, so they're only in the Sheet.
(function () {
  const C = window.FAV_CONFIG, A = window.FAV_ADMIN;
  if (!C || !A) return;
  const esc = C.escapeHtml;
  const PAGE = "https://favisionenterprize.github.io/tiktok/";
  const KEY_STORE = "fav-orders-key"; // shared with orders.js / leads.js
  let draft = null;     // ids in order while editing; null = matches the saved data
  let leads = null;     // { orders, people } after "Count TikTok orders"
  let saving = false;

  const all = () => (A.products() || []).filter(p => !p.placeholder);
  const savedIds = () => all().filter(p => Number(p.tiktok) > 0).sort((a, b) => a.tiktok - b.tiktok).map(p => p.id);
  // Same fallback as the page (assets/js/tiktok.js) when nothing is picked yet.
  function defaultIds() {
    const chair = p => /chair/i.test(p.type || "") || /chair/i.test(p.name);
    const score = p => p.id === "FAV-014" ? 0 : chair(p) ? 1 : p.seller ? 3 : 2;
    return all().filter(p => p.in_stock).map((p, i) => ({ p, i })).sort((a, b) => score(a.p) - score(b.p) || a.i - b.i).map(x => x.p.id);
  }
  const current = () => draft || (savedIds().length ? savedIds() : defaultIds());
  const dirty = () => !!draft && draft.join() !== (savedIds().length ? savedIds() : defaultIds()).join();
  const byId = id => all().find(p => p.id === id);
  const stock = p => p.in_stock ? (p.custom_order ? "made to order" : "in stock") : "sold out";

  function renderCard() {
    const ids = current().filter(byId);
    const others = all().filter(p => !ids.includes(p.id));
    const thumb = p => (p.images || [])[0] ? `<img src="../${esc(p.images[0])}" alt="" loading="lazy">` : `<span class="tts-noimg">📦</span>`;
    return `<section class="fa-card" id="tts-card">
      <header><h2>TikTok shop page</h2><span class="fa-big">${ids.length}</span></header>
      <p class="muted">TikTok Shop isn't open to Ghana sellers, so put <b>${esc(PAGE.replace("https://", ""))}</b> as the link in your TikTok bio. It shows the products below in this order, each with "Order on WhatsApp" (message says they came from TikTok) and "Pay deposit" where online payment works. Partner products go to the partner's own WhatsApp.</p>
      <div class="fa-actions">
        <a class="btn btn-ghost btn-sm" href="${PAGE}" target="_blank" rel="noopener">Open the page ↗</a>
        <button class="btn btn-ghost btn-sm" type="button" data-tts="copy">Copy bio link</button>
        <button class="btn btn-ghost btn-sm" type="button" data-tts="leads">${leads ? "↻ " : ""}Count TikTok orders</button>
      </div>
      ${leads ? `<p class="fa-small" id="tts-leads"><b>${leads.orders}</b> order${leads.orders === 1 ? "" : "s"} placed from the TikTok page so far${leads.people ? `, plus <b>${leads.people}</b> TikTok lead${leads.people === 1 ? "" : "s"} with a phone number in Leads` : ""}.</p>` : ""}
      <p class="muted fa-small">How TikTok orders are marked: WhatsApp messages say "on your TikTok … (From TikTok)"; deposits show "· via TikTok" in Orders; each WhatsApp tap adds a row with Source <b>tiktok</b> to the Enquiries sheet (and an SMS alert). Page visits aren't counted: the backend has no visit counter.</p>
      <ol class="fa-list tts-list" aria-label="Products on the TikTok page, in order">
        ${ids.map((id, i) => { const p = byId(id); return `<li class="tts-row" data-id="${esc(id)}">
          ${thumb(p)}
          <span class="tts-name"><b>${i + 1}.</b> ${esc(p.name)}<small>${esc(id)} · ${p.price_ghs ? esc(C.formatPrice(p.price_ghs)) : "price on request"} · ${stock(p)}${p.seller ? " · " + esc(p.seller.name) : ""}</small></span>
          <span class="tts-btns">
            <button class="btn btn-ghost btn-sm" type="button" data-tts="up" ${i ? "" : "disabled"} aria-label="Move ${esc(p.name)} up">↑</button>
            <button class="btn btn-ghost btn-sm" type="button" data-tts="down" ${i < ids.length - 1 ? "" : "disabled"} aria-label="Move ${esc(p.name)} down">↓</button>
            <button class="btn btn-ghost btn-sm" type="button" data-tts="remove" aria-label="Hide ${esc(p.name)} from the TikTok page">Hide</button>
          </span></li>`; }).join("") || `<li class="muted">No products picked: the page falls back to in-stock products.</li>`}
      </ol>
      ${others.length ? `<div class="tts-add"><label>Add a product <select id="tts-add" aria-label="Add a product to the TikTok page"><option value="">Choose…</option>${others.map(p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.name)} (${stock(p)})</option>`).join("")}</select></label></div>` : ""}
      <div class="fa-actions">
        <button class="btn btn-sell" type="button" data-tts="save" ${dirty() && !saving ? "" : "disabled"}>${saving ? "Saving…" : dirty() ? "Save TikTok page" : "Saved ✓"}</button>
        ${dirty() ? `<button class="btn btn-ghost" type="button" data-tts="discard">Discard</button>` : ""}
        <button class="btn btn-ghost btn-sm" type="button" data-tts="reset">Reset: in stock, desks &amp; chairs first</button>
      </div>
    </section>`;
  }

  function redraw() {
    const el = document.getElementById("tts-card");
    if (el) el.outerHTML = renderCard();
  }

  async function save() {
    if (!dirty() || saving) return;
    const ids = draft.slice();
    saving = true; redraw();
    try {
      await A.commit({
        message: `TikTok shop page: ${ids.length} products (${ids.slice(0, 3).join(", ")}${ids.length > 3 ? "…" : ""})`,
        mutate: list => list.map(p => {
          const n = ids.indexOf(p.id) + 1;
          const q = Object.assign({}, p);
          if (n) q.tiktok = n; else delete q.tiktok;
          return q;
        })
      });
      draft = null;
      A.toast("Saved ✓ The TikTok page updates in about a minute.");
      if (A.refreshDash) A.refreshDash();
    } catch (err) {
      A.toast(A.friendly(err), true);
    } finally { saving = false; redraw(); }
  }

  async function countLeads() {
    const key = (() => { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } })();
    if (!key) return A.toast("Open 📥 Leads once and enter your admin key first, then count again.", true);
    const biz = A.business() || {};
    if (!biz.enquiry_endpoint) return A.toast("The backend isn't connected (no enquiry_endpoint).", true);
    A.busy("Counting TikTok orders…");
    try {
      const r = await fetch(`${biz.enquiry_endpoint}?action=customers&key=${encodeURIComponent(key)}`).then(x => x.json());
      if (!r.ok) throw new Error(r.error || "not allowed");
      const people = r.customers || [];
      const orders = people.reduce((n, c) => n + (c.orders || []).filter(o => /via TikTok/i.test(o.product || "")).length, 0);
      const ppl = people.reduce((n, c) => n + (c.enquiries || []).filter(e => e.source === "tiktok").length, 0);
      leads = { orders, people: ppl };
    } catch (err) {
      A.toast("Couldn't read Leads: " + (err.message || err), true);
    } finally { A.busy(null); redraw(); }
  }

  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("#tts-card [data-tts]");
    if (!b || b.disabled) return;
    const act = b.dataset.tts, row = b.closest("[data-id]");
    const ids = current().slice();
    const i = row ? ids.indexOf(row.dataset.id) : -1;
    if (act === "copy") {
      (navigator.clipboard ? navigator.clipboard.writeText(PAGE) : Promise.reject()).then(() => A.toast("Copied. Paste it as the link in your TikTok bio."), () => prompt("Copy this link:", PAGE));
      return;
    }
    if (act === "leads") return countLeads();
    if (act === "save") return save();
    if (act === "discard") { draft = null; return redraw(); }
    if (act === "reset") { draft = defaultIds(); return redraw(); }
    if (i < 0) return;
    if (act === "up" && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    else if (act === "down" && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
    else if (act === "remove") ids.splice(i, 1);
    draft = ids;
    redraw();
    const again = document.querySelector(`#tts-card [data-id="${CSS.escape(row.dataset.id)}"] [data-tts="${act}"]`);
    if (again && !again.disabled) again.focus();
  });
  document.addEventListener("change", e => {
    if (!e.target.matches || !e.target.matches("#tts-add") || !e.target.value) return;
    draft = current().concat(e.target.value);
    redraw();
  });

  window.FAV_TTSHOP = { renderCard, _test: { current, dirty, save } };
})();
