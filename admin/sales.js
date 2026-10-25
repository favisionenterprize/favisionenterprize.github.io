// "📊 Sales" screen (dashboard button, deep link #sales): one lean, read-only screen (4 tiles, 2 charts, 1 table).
// Data: the same backend reads as Orders / Leads, with the same admin key (localStorage "fav-orders-key"):
//   GET ?action=orders     → every order row (Timestamp, Product, Quantity, TotalGHS, PaidNowGHS, BalanceGHS,
//                            PaymentOption, Progress, Notes …)
//   GET ?action=customers  → enquiries; "Won" leads per source are shown as a count (they carry no amount).
// Tiles: revenue, orders, average order, balances (deposits) outstanding, for the chosen period (30 / 90 days / all).
// Charts (plain SVG, no library): revenue per day for the last 30 days, revenue by channel. Table: by product.
// Channel of an order: "Channel: <x>" in its Notes (written by "Record a sale" below) → "· via TikTok" on the
// product (the /tiktok/ page) → TikTok; walk-in reservation plan → Walk-in; else Website.
// "Record a sale" (walk-in, WhatsApp, Marketplace, TikTok): uses the existing public `order` action (same as the
// website checkout, nothing paid online) and then `update_order` (admin key) to mark it Balance paid and add the
// channel note. The backend re-prices from the catalogue and sends its usual new-order SMS/email to Alexander.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => "GH₵" + Math.round(Number(n) || 0).toLocaleString("en-GH");
  const KEY_STORE = "fav-orders-key";
  const key = () => { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } };
  const CHANNELS = { website: "Website", marketplace: "Marketplace", tiktok: "TikTok", whatsapp: "WhatsApp", "walk-in": "Walk-in" };
  const LEAD_CH = { website: "website", order: "website", "ai-studio": "website", "room-designer": "website", facebook: "marketplace", "facebook-page": "marketplace", tiktok: "tiktok", whatsapp: "whatsapp", "walk-in": "walk-in", call: "whatsapp" };
  let endpoint = "", orders = null, won = {}, period = 30, recording = false, err = "";

  async function settings() {
    if (endpoint) return endpoint;
    const b = (A().business && A().business()) || await fetch("../data/business.json", { cache: "no-store" }).then(r => r.json());
    endpoint = (b && b.enquiry_endpoint) || "";
    return endpoint;
  }
  function channelOf(o) {
    const n = String(o.Notes || "").match(/Channel:\s*([a-z-]+)/i);
    if (n && CHANNELS[n[1].toLowerCase()]) return n[1].toLowerCase();
    const rec = String(o.PaymentOption || "").match(/^(.+?) sale \(recorded in admin\)/);   // in case the note didn't land
    if (rec) { const k = Object.keys(CHANNELS).find(c => CHANNELS[c] === rec[1]); if (k) return k; }
    if (/via TikTok/i.test(o.Product || "")) return "tiktok";
    if (/walk/i.test(o.PaymentOption || "")) return "walk-in";
    return "website";
  }
  const productName = o => String(o.Product || "").replace(/\s*\((FAV-\d+|SVC-[^)]*)\)\s*$/, "").replace(/\s*·\s*via TikTok/i, "").split(" — ")[0].split(":")[0].trim() || "(no product)";
  const live = o => o.Progress !== "Cancelled";
  const dayOf = w => { const d = new Date(w); return isNaN(d) ? "" : d.toLocaleDateString("en-CA"); };
  const since = days => days ? new Date(Date.now() - (days - 1) * 864e5).toLocaleDateString("en-CA") : "";

  function stats(list) {
    const cut = since(period);
    const rows = list.filter(live).filter(o => !cut || dayOf(o.Timestamp) >= cut);
    const revenue = rows.reduce((s, o) => s + (Number(o.TotalGHS) || 0), 0);
    const owed = list.filter(live).filter(o => o.Progress !== "Balance paid").reduce((s, o) => s + (Number(o.BalanceGHS) || 0), 0);
    const owedN = list.filter(live).filter(o => o.Progress !== "Balance paid" && Number(o.BalanceGHS) > 0).length;
    const byCh = {}, byP = {};
    for (const o of rows) {
      const c = channelOf(o); byCh[c] = byCh[c] || { n: 0, r: 0 }; byCh[c].n++; byCh[c].r += Number(o.TotalGHS) || 0;
      const p = productName(o); byP[p] = byP[p] || { n: 0, q: 0, r: 0 }; byP[p].n++; byP[p].q += Number(o.Quantity) || 0; byP[p].r += Number(o.TotalGHS) || 0;
    }
    const days = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toLocaleDateString("en-CA"); days.push({ d, r: 0, n: 0 }); }
    for (const o of list.filter(live)) { const x = days.find(y => y.d === dayOf(o.Timestamp)); if (x) { x.r += Number(o.TotalGHS) || 0; x.n++; } }
    return { rows, revenue, orders: rows.length, avg: rows.length ? revenue / rows.length : 0, owed, owedN, byCh, byP, days };
  }

  // ---------------------------------------------------------------- charts (SVG)
  function trend(days) {
    const W = 600, H = 170, P = 26, max = Math.max(1, ...days.map(d => d.r));
    const bw = (W - P) / days.length;
    const bars = days.map((d, i) => { const h = Math.round((d.r / max) * (H - 34)); return `<rect x="${(P + i * bw + 1).toFixed(1)}" y="${H - 18 - h}" width="${Math.max(2, bw - 3).toFixed(1)}" height="${h}" rx="2" fill="${d.r ? "#0d55af" : "#e3e7ee"}"><title>${esc(d.d)}: ${esc(money(d.r))} · ${d.n} order${d.n === 1 ? "" : "s"}</title></rect>`; }).join("");
    const lab = [0, 14, 29].map(i => `<text x="${(P + i * bw + bw / 2).toFixed(1)}" y="${H - 4}" font-size="11" text-anchor="middle" fill="#5f6368">${esc(new Date(days[i].d + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Revenue per day, last 30 days"><line x1="${P}" x2="${W}" y1="${H - 18}" y2="${H - 18}" stroke="#dadce0"/><text x="0" y="12" font-size="11" fill="#5f6368">${esc(money(max))}</text>${bars}${lab}</svg>`;
  }
  function channels(byCh) {
    const rows = Object.keys(CHANNELS).map(k => ({ k, ...(byCh[k] || { n: 0, r: 0 }) }));
    const max = Math.max(1, ...rows.map(r => r.r));
    return `<div class="sl-ch">${rows.map(r => `<div class="sl-chrow"><span>${esc(CHANNELS[r.k])}</span><div class="sl-bar"><i style="width:${Math.round((r.r / max) * 100)}%"></i></div><small>${esc(money(r.r))} · ${r.n}${won[r.k] ? ` <em title="won leads with no amount, from Leads">+${won[r.k]} won</em>` : ""}</small></div>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- screen
  let screen = $("#screen-sales");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-sales"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>📊 Sales</h1>
      <p class="muted">Revenue, orders and money still owed, by channel and product. Read from your Orders sheet; nothing here changes an order.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button><button class="btn btn-ghost btn-sm" data-orders>Orders</button><button class="btn btn-ghost btn-sm" id="sales-refresh">Refresh</button></div></div>
      <div id="sl-body"><p class="muted">Loading…</p></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `#sl-body{display:grid;gap:16px}#sl-body .stats{margin:0;grid-template-columns:repeat(auto-fit,minmax(min(140px,46%),1fr))}#sl-body .stat{cursor:default}
.sl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px}
.sl-ch{display:grid;gap:10px}.sl-chrow{display:grid;grid-template-columns:96px 1fr auto;gap:8px;align-items:center;font-size:14px}
.sl-bar{background:#eef1f6;border-radius:6px;height:14px;overflow:hidden}.sl-bar i{display:block;height:100%;background:#0d55af;border-radius:6px;min-width:2px}
.sl-chrow small{color:#5f6368;font-variant-numeric:tabular-nums;white-space:nowrap}.sl-chrow em{font-style:normal;color:#1f9d55}
.sl-table{width:100%;border-collapse:collapse;font-size:14px}.sl-table th,.sl-table td{padding:7px 6px;border-bottom:1px solid #eef0f4;text-align:left}
.sl-table td.n,.sl-table th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sl-period{display:flex;gap:6px;flex-wrap:wrap}.sl-period button{border:1px solid #dadce0;background:#fff;border-radius:99px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}
.sl-period button[aria-pressed=true]{background:#e8f0fe;border-color:#0d55af;color:#0d55af}
.sl-rec{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr));gap:8px}.sl-rec label{display:grid;gap:4px;font-size:13px;color:#5f6368}
.sl-rec input,.sl-rec select{font:inherit;font-size:14px;padding:7px 9px;border:1px solid #dadce0;border-radius:8px;width:100%;box-sizing:border-box;background:#fff}
@media (max-width:420px){.sl-chrow{grid-template-columns:78px 1fr}.sl-chrow small{grid-column:1/-1}}`;
    document.head.appendChild(st);
  }
  if (!document.querySelector("[data-sales]")) {
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-sales>📊 Sales</button>`);
  }
  function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#sales") history.replaceState(null, "", "#sales");
    refresh();
  }
  async function refresh() {
    const body = $("#sl-body");
    if (!orders) body.innerHTML = `<p class="muted">Loading sales…</p>`;
    err = "";
    try { await settings(); } catch (e) { body.innerHTML = `<div class="card"><p class="error">Couldn't read the site settings. Check your connection and tap Refresh.</p></div>`; return; }
    if (!endpoint) { body.innerHTML = `<div class="card narrow"><h2>Connect the backend first</h2><p class="muted">Sales come from your Google Sheet backend (backend/README.md).</p></div>`; return; }
    if (!key()) return renderKey();
    try {
      const k = encodeURIComponent(key());
      const [o, c] = await Promise.all([fetch(`${endpoint}?action=orders&key=${k}`).then(r => r.json()), fetch(`${endpoint}?action=customers&key=${k}`).then(r => r.json()).catch(() => null)]);
      if (!o.ok) { if (o.error === "not allowed") { try { localStorage.removeItem(KEY_STORE); } catch (x) { /* */ } return renderKey("That admin key didn't work. Paste it again."); } throw new Error(o.error || "error"); }
      orders = o.orders || [];
      won = {};
      const cut = since(period);
      for (const cu of (c && c.ok && c.customers) || []) for (const e of cu.enquiries || []) {
        if (e.status !== "Won" || (cut && dayOf(e.when) < cut)) continue;
        const ch = LEAD_CH[e.source]; if (ch) won[ch] = (won[ch] || 0) + 1;
      }
    } catch (e) { err = "Couldn't load sales from the backend. Check your connection and tap Refresh."; }
    render();
  }
  function renderKey(msg) {
    $("#sl-body").innerHTML = `<div class="card narrow"><h2>Enter your admin key</h2>
      <p class="muted">Same key as Orders and Leads: Apps Script → <b>Project Settings → Script properties → ADMIN_KEY</b>.</p>
      <form id="sales-key-form" class="stack"><label class="field"><span>Admin key</span><input id="sales-key" type="password" autocomplete="off" required></label>
      ${msg ? `<p class="error">${esc(msg)}</p>` : ""}<button class="btn btn-primary btn-block" type="submit">Show my sales</button></form></div>`;
  }
  function render() {
    if (screen.hidden) return;
    if (err && !orders) { $("#sl-body").innerHTML = `<div class="card"><p class="error">${esc(err)}</p></div>`; return; }
    const s = stats(orders || []);
    const prods = Object.entries(s.byP).sort((a, b) => b[1].r - a[1].r).slice(0, 12);
    const label = period ? `last ${period} days` : "all time";
    const P = ((A().products && A().products()) || []).filter(p => !p.placeholder && !p.seller && Number(p.price_ghs) > 0);
    $("#sl-body").innerHTML = `
      ${err ? `<p class="error">${esc(err)}</p>` : ""}
      <div class="sl-period" role="group" aria-label="Period">${[[30, "30 days"], [90, "90 days"], [0, "All time"]].map(([d, t]) => `<button type="button" data-sl-period="${d}" aria-pressed="${period === d}">${t}</button>`).join("")}
        <button type="button" data-sl-rec aria-pressed="${recording}" style="margin-left:auto">+ Record a sale</button></div>
      ${recording ? `<form class="fa-card" id="sl-rec-form">
        <header><h2>Record a walk-in, WhatsApp or Marketplace sale</h2></header>
        <div class="sl-rec">
          <label>Customer name<input name="name" required></label>
          <label>Phone (optional)<input name="phone" inputmode="tel"></label>
          <label>Product<select name="product">${P.map(p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(String(p.name).split(" — ")[0])} · ${esc(money(p.price_ghs))}</option>`).join("")}</select></label>
          <label>Quantity<input name="qty" type="number" min="1" max="500" value="1" required></label>
          <label>Channel<select name="channel">${["walk-in", "whatsapp", "marketplace", "tiktok"].map(k => `<option value="${k}">${CHANNELS[k]}</option>`).join("")}</select></label>
          <label>Paid?<select name="paid"><option value="full">Paid in full</option><option value="none">Not paid yet (balance owed)</option></select></label>
        </div>
        <p class="muted fa-small">Saved to your Orders sheet at the <b>catalogue price</b> (the backend re-prices every order; a different agreed price or a part payment can't be recorded here: add a note in the Sheet). You'll get the usual new-order SMS/email.</p>
        <div class="fa-actions"><button class="btn btn-primary btn-sm" type="submit">Save sale</button><button class="btn btn-ghost btn-sm" type="button" data-sl-rec>Cancel</button></div>
      </form>` : ""}
      <div class="stats">
        <div class="stat"><b>${esc(money(s.revenue))}</b><span>Revenue · ${esc(label)}</span></div>
        <div class="stat"><b>${s.orders}</b><span>Orders · ${esc(label)}</span></div>
        <div class="stat"><b>${esc(money(s.avg))}</b><span>Average order</span></div>
        <div class="stat${s.owed ? " warn" : ""}"><b>${esc(money(s.owed))}</b><span>Balances owed · ${s.owedN} order${s.owedN === 1 ? "" : "s"}</span></div>
      </div>
      <div class="sl-grid">
        <section class="fa-card"><header><h2>Last 30 days</h2></header>${trend(s.days)}</section>
        <section class="fa-card"><header><h2>By channel</h2><small class="muted">${esc(label)}</small></header>${channels(s.byCh)}
          <p class="muted fa-small">Website orders, TikTok page orders (“via TikTok”) and sales you record here. “+N won” = leads marked Won in Leads (no amount).</p></section>
      </div>
      <section class="fa-card"><header><h2>By product</h2><small class="muted">${esc(label)}</small></header>
        ${prods.length ? `<table class="sl-table"><thead><tr><th>Product</th><th class="n">Orders</th><th class="n">Qty</th><th class="n">Revenue</th></tr></thead><tbody>
          ${prods.map(([n, x]) => `<tr><td>${esc(n)}</td><td class="n">${x.n}</td><td class="n">${x.q}</td><td class="n">${esc(money(x.r))}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No orders in this period yet.</p>`}
      </section>`;
  }
  async function record(f) {
    const d = Object.fromEntries(new FormData(f).entries());
    const p = ((A().products && A().products()) || []).find(x => x.id === d.product);
    const qty = Math.max(1, Math.min(500, parseInt(d.qty, 10) || 1));
    if (!p || !d.name.trim()) return;
    const ref = "FAV-" + Date.now().toString(36).toUpperCase().slice(-8);
    const btn = f.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Saving…";
    const post = body => fetch(endpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    try {
      await post({ action: "order", source: d.channel, reference: ref, name: d.name.trim(), phone: d.phone.trim(), email: "", area: "Odorkor (main showroom)",
        plan: "walkin", plan_label: `${CHANNELS[d.channel]} sale (recorded in admin)`, method: "", product_id: p.id, product: p.name, quantity: qty,
        unit_price: p.price_ghs, total: p.price_ghs * qty, amount_due: 0, balance: d.paid === "full" ? 0 : p.price_ghs * qty,
        status: d.paid === "full" ? "Paid at showroom" : "Balance owed" });
      await new Promise(r => setTimeout(r, 1500));   // the order row must exist before update_order can find it
      await post({ action: "update_order", key: key(), reference: ref, progress: d.paid === "full" ? "Balance paid" : "Confirmed", note: `Channel: ${d.channel} · recorded in admin` });
      recording = false;
      if (A().toast) A().toast(`Sale ${ref} saved ✓`);
      setTimeout(refresh, 2500);
      render();
    } catch (e) { btn.disabled = false; btn.textContent = "Save sale"; alert("Couldn't save. Check your connection and try again."); }
  }

  document.addEventListener("click", e => {
    if (e.target.closest("[data-sales]")) { e.preventDefault(); show(); return; }
    if (screen.hidden) return;
    const p = e.target.closest("[data-sl-period]");
    if (p) { period = Number(p.dataset.slPeriod); return refresh(); }
    if (e.target.closest("[data-sl-rec]")) { recording = !recording; return render(); }
    if (e.target.closest("#sales-refresh")) refresh();
  });
  document.addEventListener("submit", e => {
    if (e.target.id === "sales-key-form") { e.preventDefault(); try { localStorage.setItem(KEY_STORE, $("#sales-key").value.trim()); } catch (x) { /* */ } return refresh(); }
    if (e.target.id === "sl-rec-form") { e.preventDefault(); record(e.target); }
  });

  window.FAV_SALES = { open: show, refresh, _test: { stats: list => stats(list), channelOf, productName, set: l => { orders = l; } } };
})();
