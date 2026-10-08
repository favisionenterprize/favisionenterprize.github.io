// Leads (admin → 📥 Leads): every lead in one list, an alert the moment a new one lands,
// and one tap to WhatsApp, text or call. Modelled on lead-inbox apps such as Privyr.
//  - Sources: website quote form, product enquiries, WhatsApp taps, AI Studio, Room Designer,
//    checkout orders and invoice requests (all from the backend Sheet, same admin key as
//    Orders/Customers), plus leads typed in here from Facebook Marketplace, Instagram, TikTok,
//    X, calls, walk-ins and referrals ("+ Add a lead" saves them to the same Enquiries tab).
//  - Alerts: while the admin is open, it checks every minute. A new lead plays a sound,
//    shows a browser notification, a toast and a red count on the dashboard button.
//  - Distribution: add team members (name + WhatsApp). Leads can be assigned by hand or
//    automatically in turn (round robin); "Send to <name>" forwards the lead on WhatsApp.
//    The assignment is saved as a note on the Sheet row ("Assigned to Ama").
// No customer details are written to the website repository (it is public): leads stay in the
// Sheet; the team list and "seen" markers stay in this browser.
(function () {
  const C = window.FAV_CONFIG;
  const $ = s => document.querySelector(s);
  const screen = $("#screen-leads");
  if (!C || !screen) return;
  const esc = C.escapeHtml;
  const money = n => C.formatPrice(Math.round((Number(n) || 0) * 100) / 100);
  const KEY_STORE = "fav-orders-key"; // shared with orders.js / customers.js
  const TEAM_STORE = "fa-leads-team", SEEN_STORE = "fa-leads-seen", RR_STORE = "fa-leads-rr";
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  const key = () => { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } };
  const POLL_MS = 60000;
  const STATUSES = ["New", "Contacted", "Quoted", "Won", "Lost"];
  const SOURCES = {
    website: "Website form", whatsapp: "WhatsApp tap", "ai-studio": "AI Studio", "room-designer": "Room Designer",
    order: "Website order", invoice: "Invoice request", facebook: "Facebook Marketplace", "facebook-page": "Facebook Page",
    instagram: "Instagram", tiktok: "TikTok", x: "X", call: "Phone call", "walk-in": "Walk-in (showroom)", referral: "Referral", other: "Other"
  };
  const MANUAL = ["facebook", "facebook-page", "instagram", "tiktok", "x", "call", "walk-in", "referral", "other"];
  const srcName = s => SOURCES[s] || (s ? String(s) : "Website form");
  const waNumber = p => String(p || "").replace(/\D/g, "").replace(/^0/, "233");
  const first = n => String(n || "").trim().split(/\s+/)[0] || "there";
  const today = () => new Date().toLocaleDateString("en-CA");
  const dayOf = w => { const d = new Date(w); return isNaN(d) ? String(w || "").slice(0, 10) : d.toLocaleDateString("en-CA"); };
  const ago = w => {
    const m = Math.round((Date.now() - new Date(w)) / 6e4);
    if (!(m >= 0)) return "";
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
  };

  let endpoint = "", site = "https://favisionenterprize.github.io/", leads = [], loaded = false, filter = "new", src = "all", query = "", timer = null, adding = false;

  async function settings() {
    if (endpoint) return;
    const b = (window.FAV_ADMIN && window.FAV_ADMIN.business && window.FAV_ADMIN.business()) ||
      await fetch("../data/business.json", { cache: "no-store" }).then(r => r.json());
    endpoint = b.enquiry_endpoint || "";
    site = b.website || site;
  }

  // Flatten the Customers feed into one row per lead.
  function flatten(customers) {
    const out = [];
    (customers || []).forEach(c => {
      const who = { name: c.name, org: c.organisation, phone: c.phone, email: c.email };
      (c.enquiries || []).forEach(e => {
        const all = String(e.notes || "").match(/Assigned to [^|]+/g) || [];
        const last = all.length ? all[all.length - 1].replace(/^Assigned to /, "").trim() : "";
        out.push(Object.assign({ k: "e:" + e.row, row: e.row, when: e.when, product: e.product, qty: e.quantity, message: e.message,
          source: e.source || "website", status: e.status || "New", notes: e.notes || "", followUp: String(e.followUp || "").slice(0, 10),
          assigned: last === "nobody" ? "" : last, editable: true }, who));
      });
      (c.orders || []).forEach(o => out.push(Object.assign({ k: "o:" + o.ref, when: o.when, product: o.product, qty: o.quantity,
        message: `Order ${o.ref} · ${money(o.total)}${Number(o.balance) > 0 ? " · balance " + money(o.balance) : ""}`,
        source: "order", status: o.progress === "New" ? "New" : o.progress === "Cancelled" ? "Lost" : "Won", progress: o.progress || "New" }, who)));
      (c.invoices || []).forEach(v => out.push(Object.assign({ k: "i:" + v.no, when: v.when, product: v.kind || "Invoice",
        message: `${v.kind || "Invoice"} ${v.no}${v.total ? " · " + money(v.total) : ""}`, source: "invoice",
        status: /sent|issued|paid/i.test(v.status || "") ? "Quoted" : "New", progress: v.status || "Requested" }, who)));
    });
    out.sort((a, b) => String(b.when).localeCompare(String(a.when)));
    return out;
  }

  async function fetchLeads() {
    await settings();
    if (!endpoint || !key()) return null;
    const res = await fetch(`${endpoint}?action=customers&key=${encodeURIComponent(key())}`).then(r => r.json());
    if (!res.ok) { if (res.error === "not allowed") throw new Error("key"); throw new Error(res.error || "error"); }
    return flatten(res.customers);
  }

  // ---------- alerts ----------
  function beep() {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((t, i) => {
        const o = a.createOscillator(), g = a.createGain();
        o.frequency.value = i ? 1046 : 784; g.gain.value = 0.15;
        o.connect(g); g.connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.15);
      });
    } catch (e) { /* no audio */ }
  }
  function badge(n) {
    const b = $("#leads-badge");
    if (b) { b.textContent = n; b.hidden = !n; }
    document.title = (n ? `(${n}) ` : "") + document.title.replace(/^\(\d+\) /, "");
  }
  const unseenNew = () => { const seen = new Set(ls.get(SEEN_STORE, [])); return leads.filter(l => l.status === "New" && !seen.has(l.k)); };
  function markSeen() { ls.set(SEEN_STORE, leads.map(l => l.k).slice(0, 3000)); badge(0); }

  // Throws on a bad key so refresh() can ask again; the timer swallows errors.
  async function poll(fromOpen) {
    const list = await fetchLeads();
    if (!list) return;
    const firstRun = !ls.get(SEEN_STORE, null);
    leads = list; loaded = true;
    if (firstRun) { markSeen(); return; } // don't alert for every old lead the first time
    const fresh = unseenNew();
    const known = new Set(ls.get("fa-leads-alerted", []));
    const toAlert = fresh.filter(l => !known.has(l.k));
    if (toAlert.length) {
      ls.set("fa-leads-alerted", [...known, ...toAlert.map(l => l.k)].slice(-500));
      await autoAssign(toAlert);
      if (!fromOpen) {
        beep();
        const l = toAlert[0];
        const msg = `New lead${toAlert.length > 1 ? "s (" + toAlert.length + ")" : ""}: ${l.name || "someone"} · ${l.product || srcName(l.source)}`;
        try { if (window.Notification && Notification.permission === "granted") new Notification("F.A Vision: " + msg, { body: l.message ? String(l.message).slice(0, 120) : srcName(l.source), icon: "../assets/images/logo.png", tag: l.k }); } catch (e) { /* ignore */ }
        if (window.FAV_ADMIN && window.FAV_ADMIN.toast) window.FAV_ADMIN.toast("📥 " + msg);
      }
    }
    badge(screen.hidden ? fresh.length : 0);
    if (!screen.hidden && !adding) { render(); markSeen(); }
  }
  function startPolling() {
    if (timer) return;
    timer = setInterval(() => poll(false).catch(() => {}), POLL_MS);
    setTimeout(() => poll(false).catch(() => {}), 4000);
  }

  // ---------- distribution ----------
  const team = () => ls.get(TEAM_STORE, { members: [], auto: false });
  async function saveNote(row, payload) {
    await fetch(endpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action: "update_enquiry", key: key(), row }, payload)) });
  }
  async function assign(l, name) {
    if (!l.editable) return;
    await saveNote(l.row, { note: "Assigned to " + (name || "nobody") });
    l.assigned = name;
  }
  async function autoAssign(list) {
    const t = team();
    if (!t.auto || !t.members.length) return;
    let i = Number(ls.get(RR_STORE, 0)) || 0;
    for (const l of list.filter(x => x.editable && !x.assigned)) {
      const m = t.members[i % t.members.length]; i++;
      try { await assign(l, m.name); } catch (e) { /* try next time */ }
    }
    ls.set(RR_STORE, i);
  }
  function forwardText(l) {
    return `New lead for you 📥\n${l.name || "Customer"}${l.org ? " (" + l.org + ")" : ""}\n📞 ${l.phone || "-"}\n🛋 ${l.product || "-"}${l.qty ? " × " + l.qty : ""}\n💬 ${String(l.message || "").slice(0, 300)}\nSource: ${srcName(l.source)}\nPlease reply them within 5 minutes on WhatsApp: https://wa.me/${waNumber(l.phone)}`;
  }
  const greet = l => `Hello ${first(l.name)}, thank you for contacting F.A Vision Enterprise${l.product ? " about the " + l.product : ""}. How can we help you? You can also see photos and prices here: ${site}`;

  // ---------- screen ----------
  const FILTERS = [
    ["new", "New", l => l.status === "New"],
    ["today", "Today", l => dayOf(l.when) === today()],
    ["follow", "Follow up due", l => l.followUp && l.followUp <= today() && !["Won", "Lost"].includes(l.status)],
    ["unassigned", "Not assigned", l => l.editable && !l.assigned && !["Won", "Lost"].includes(l.status)],
    ["won", "Won", l => l.status === "Won"],
    ["all", "All leads", () => true]
  ];

  function open() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#leads") history.replaceState(null, "", "#leads");
    refresh();
  }

  async function refresh() {
    const body = $("#leads-body");
    if (!loaded) body.innerHTML = `<p class="muted">Loading leads…</p>`;
    try { await settings(); } catch (e) { body.innerHTML = `<div class="card"><p class="error">Couldn't read the site settings. Check your connection and tap Refresh.</p></div>`; return; }
    if (!endpoint) { body.innerHTML = `<div class="card narrow"><h2>Connect the backend first</h2><p class="muted">Leads come from your Google Sheet backend (backend/README.md).</p></div>`; return; }
    if (!key()) return renderKey();
    try { await poll(true); render(); markSeen(); startPolling(); } catch (e) {
      if (String(e.message) === "key") { try { localStorage.removeItem(KEY_STORE); } catch (x) { /* */ } return renderKey("That admin key didn't work. Paste it again."); }
      body.innerHTML = `<div class="card"><p class="error">Couldn't load leads from the backend. Check your connection and tap Refresh.</p></div>`;
    }
  }

  function renderKey(msg) {
    $("#leads-body").innerHTML = `<div class="card narrow"><h2>Enter your admin key</h2>
      <p class="muted">Same key as Orders and Customers: Apps Script → <b>Project Settings → Script properties → ADMIN_KEY</b>.</p>
      <form id="leads-key-form" class="stack"><label class="field"><span>Admin key</span><input id="leads-key" type="password" autocomplete="off" required></label>
      ${msg ? `<p class="error">${esc(msg)}</p>` : ""}<button class="btn btn-primary btn-block" type="submit">Show my leads</button></form></div>`;
  }

  function render() {
    const f = FILTERS.find(x => x[0] === filter)[2];
    const q = query.trim().toLowerCase();
    const sources = [...new Set(leads.map(l => l.source))];
    const list = leads.filter(f).filter(l => src === "all" || l.source === src)
      .filter(l => !q || [l.name, l.org, l.phone, l.email, l.product, l.message, l.assigned].join(" ").toLowerCase().includes(q));
    const t = team();
    const notif = window.Notification ? Notification.permission : "unsupported";
    $("#leads-body").innerHTML = `
      <div class="leads-hero">
        <div><b>Never miss a lead.</b> New leads from your website, WhatsApp, Facebook, Instagram, TikTok and calls land here. This page checks every minute while the admin is open and alerts you at once.</div>
        <div class="leads-hero-actions">
          ${notif === "default" ? `<button class="btn btn-sell btn-sm" id="leads-notify">🔔 Turn on alerts</button>` : notif === "granted" ? `<span class="pill ok">🔔 Alerts on</span>` : notif === "denied" ? `<span class="pill sold">Alerts blocked in this browser</span>` : ""}
          <button class="btn btn-primary btn-sm" id="leads-add-btn">+ Add a lead</button>
        </div>
      </div>
      ${adding ? addForm() : ""}
      <div class="stats">${FILTERS.map(([id, label, fn]) => `<button class="stat${id === "new" && leads.some(fn) ? " warn" : ""}" data-lfilter="${id}" aria-pressed="${filter === id}"><b>${leads.filter(fn).length}</b><span>${label}</span></button>`).join("")}</div>
      <div class="dash-tools">
        <input type="search" id="leads-search" placeholder="Search name, phone, product…" value="${esc(query)}" aria-label="Search leads">
        <select id="leads-src" aria-label="Source"><option value="all">All sources</option>${sources.map(s => `<option value="${esc(s)}" ${s === src ? "selected" : ""}>${esc(srcName(s))} (${leads.filter(l => l.source === s).length})</option>`).join("")}</select>
      </div>
      ${list.length ? `<div class="orders">${list.slice(0, 200).map(card).join("")}</div>` :
        `<div class="card center"><p class="muted">${leads.length ? "No leads here right now." : "No leads yet. Share your lead forms below and they'll show up here."}</p></div>`}
      <div class="leads-grid">
        <section class="card">
          <h2>Team &amp; distribution</h2>
          <p class="muted small">Add the people who answer customers. Assign each lead, or let new leads go to them in turn. "Send to" forwards the lead on WhatsApp.</p>
          <ul class="fa-list">${t.members.map((m, i) => `<li><span>${esc(m.name)}${m.phone ? ` · ${esc(m.phone)}` : ""} · ${leads.filter(l => l.assigned === m.name && !["Won", "Lost"].includes(l.status)).length} open</span> <button class="btn btn-ghost btn-sm" data-ldel="${i}">Remove</button></li>`).join("") || `<li class="muted">Only you for now.</li>`}</ul>
          <form id="leads-team-form" class="leads-inline"><input name="name" placeholder="Name" required aria-label="Team member name"><input name="phone" placeholder="WhatsApp number" inputmode="tel" aria-label="Team member WhatsApp"><button class="btn btn-ghost btn-sm" type="submit">Add</button></form>
          <label class="fa-check"><input type="checkbox" id="leads-auto" ${t.auto ? "checked" : ""} ${t.members.length ? "" : "disabled"}> Share new leads automatically in turn (round robin)</label>
        </section>
        <section class="card">
          <h2>Lead forms</h2>
          <p class="muted small">Every form on your website already sends leads here. Share these links in posts, bios and replies.</p>
          <ul class="leads-forms">${[
            ["Quote / custom order form", site + "#custom"], ["Invoice request form", site + "#invoice"],
            ["AI Studio (Room Designer)", site + "studio/"], ["Shop: every product has Enquire, WhatsApp and checkout", site]
          ].map(([n, u]) => `<li><span>${esc(n)}</span> <button class="btn btn-ghost btn-sm" data-lcopy="${esc(u)}">Copy link</button> <a class="btn btn-ghost btn-sm" href="${esc(u)}" target="_blank" rel="noopener">Open</a></li>`).join("")}</ul>
        </section>
      </div>`;
    $("#leads-search").addEventListener("input", e => {
      query = e.target.value; const pos = e.target.selectionStart; render();
      const s = $("#leads-search"); s.focus(); try { s.setSelectionRange(pos, pos); } catch (x) { /* */ }
    });
  }

  function addForm() {
    return `<form id="leads-add" class="card stack leads-add">
      <h2>Add a lead</h2>
      <p class="muted small">From a Facebook Marketplace chat, an Instagram or TikTok DM, a call or a walk-in. It's saved in your Sheet with the others.</p>
      <div class="leads-inline">
        <label class="field"><span>Name</span><input name="name" required></label>
        <label class="field"><span>Phone / WhatsApp</span><input name="phone" inputmode="tel"></label>
      </div>
      <div class="leads-inline">
        <label class="field"><span>Product</span><input name="product" list="leads-products"></label>
        <label class="field"><span>Where from</span><select name="source">${MANUAL.map(s => `<option value="${s}">${esc(SOURCES[s])}</option>`).join("")}</select></label>
      </div>
      <datalist id="leads-products">${((window.FAV_ADMIN && window.FAV_ADMIN.products && window.FAV_ADMIN.products()) || []).map(p => `<option value="${esc(String(p.name).split(" — ")[0])}">`).join("")}</datalist>
      <label class="field"><span>What they said</span><textarea name="message" rows="2"></textarea></label>
      <div class="step-actions"><button class="btn btn-ghost btn-sm" type="button" id="leads-add-cancel">Cancel</button><button class="btn btn-primary btn-sm" type="submit">Save lead</button></div>
    </form>`;
  }

  function card(l) {
    const wa = waNumber(l.phone), t = team();
    const late = l.status === "New" && (Date.now() - new Date(l.when)) > 5 * 6e4;
    const mate = l.assigned && t.members.find(m => m.name === l.assigned);
    return `<article class="order lead${l.status === "New" ? " flag" : ""}" data-k="${esc(l.k)}">
      <div class="order-top"><div>
        <div class="item-name">${esc(l.name || "(no name)")} <span class="pill">${esc(srcName(l.source))}</span>${l.status === "New" ? ` <span class="pill sold">New</span>` : ""}${l.assigned ? ` <span class="pill ok">→ ${esc(l.assigned)}</span>` : ""}</div>
        <div class="item-meta">${esc([l.org, l.phone, l.email].filter(Boolean).join(" · "))}</div>
        <div class="item-meta">${esc(ago(l.when))}${late ? ` · <b class="due">reply now: fast replies win the sale</b>` : ""}</div>
      </div></div>
      <div class="small"><b>${esc(l.product || "Enquiry")}</b>${l.qty ? ` × ${esc(l.qty)}` : ""}</div>
      ${l.message ? `<div class="small muted">“${esc(String(l.message).slice(0, 240))}”</div>` : ""}
      ${l.notes ? `<div class="small">📝 ${esc(l.notes)}</div>` : ""}
      <div class="order-actions">
        ${wa.length >= 12 ? `<a class="btn btn-wa btn-sm" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(greet(l))}" target="_blank" rel="noopener" data-lcontact>WhatsApp</a>
        <a class="btn btn-ghost btn-sm" href="sms:${esc(l.phone)}?body=${encodeURIComponent(greet(l))}" data-lcontact>Text</a>
        <a class="btn btn-ghost btn-sm" href="tel:${esc(l.phone)}" data-lcontact>Call</a>` : l.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(l.email)}">Email</a>` : `<span class="muted small">No phone given</span>`}
        ${l.editable ? `<select class="lead-status" aria-label="Lead status">${STATUSES.map(s => `<option ${s === l.status ? "selected" : ""}>${s}</option>`).join("")}</select>
        <select class="lead-assign" aria-label="Assign to"><option value="">Assign to…</option>${t.members.map(m => `<option ${m.name === l.assigned ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
        ${mate && mate.phone ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(mate.phone))}?text=${encodeURIComponent(forwardText(l))}">Send to ${esc(l.assigned)}</a>` : ""}
        <label class="small">Follow up <input type="date" class="lead-follow" value="${esc(l.followUp || "")}"></label>
        <button class="btn btn-ghost btn-sm lead-note" type="button">+ Note</button>` : `<span class="small muted">${esc(l.progress || "")} · update in ${l.source === "invoice" ? "Invoices" : "Orders"}</span>`}
      </div>
    </article>`;
  }

  const leadOf = el => leads.find(l => l.k === el.closest("[data-k]").dataset.k);

  screen.addEventListener("click", async e => {
    const t = e.target;
    if (t.closest("[data-lfilter]")) { filter = t.closest("[data-lfilter]").dataset.lfilter; return render(); }
    if (t.closest("#leads-notify")) { try { await Notification.requestPermission(); } catch (x) { /* */ } return render(); }
    if (t.closest("#leads-add-btn")) { adding = !adding; render(); const n = $("#leads-add [name=name]"); if (n) n.focus(); return; }
    if (t.closest("#leads-add-cancel")) { adding = false; return render(); }
    if (t.closest("[data-lcopy]")) { const u = t.closest("[data-lcopy]").dataset.lcopy; try { await navigator.clipboard.writeText(u); t.textContent = "Copied ✓"; } catch (x) { prompt("Copy this link:", u); } return; }
    if (t.closest("[data-ldel]")) { const tm = team(); tm.members.splice(Number(t.closest("[data-ldel]").dataset.ldel), 1); if (!tm.members.length) tm.auto = false; ls.set(TEAM_STORE, tm); return render(); }
    if (t.closest("[data-lcontact]")) {
      // Replying counts as contacting: move it out of "New" (the link still opens).
      const l = leadOf(t);
      if (l && l.editable && l.status === "New") { l.status = "Contacted"; saveNote(l.row, { status: "Contacted" }).catch(() => {}); setTimeout(render, 300); }
      return;
    }
    const n = t.closest(".lead-note");
    if (n) {
      const note = prompt("Add a note to this lead (e.g. 'Sent price, wants 20 sets for January'):");
      if (!note) return;
      const l = leadOf(n); n.disabled = true;
      try { await saveNote(l.row, { note }); l.notes = [l.notes, new Date().toLocaleDateString([], { day: "numeric", month: "short" }) + ": " + note].filter(Boolean).join(" | "); render(); }
      catch (x) { n.disabled = false; alert("Couldn't save. Check your connection and try again."); }
    }
  });

  screen.addEventListener("change", async e => {
    const t = e.target;
    if (t.id === "leads-src") { src = t.value; return render(); }
    if (t.id === "leads-auto") { const tm = team(); tm.auto = t.checked; ls.set(TEAM_STORE, tm); if (tm.auto) await autoAssign(leads.filter(l => l.status === "New")); return render(); }
    const el = t.closest(".lead-status, .lead-assign, .lead-follow");
    if (!el) return;
    const l = leadOf(el); el.disabled = true;
    try {
      if (el.classList.contains("lead-status")) { await saveNote(l.row, { status: el.value }); l.status = el.value; }
      else if (el.classList.contains("lead-assign")) await assign(l, el.value);
      else { await saveNote(l.row, { followUp: el.value }); l.followUp = el.value; }
      render();
    } catch (x) { el.disabled = false; alert("Couldn't save. Check your connection and try again."); }
  });

  screen.addEventListener("submit", async e => {
    const f = e.target;
    if (f.id === "leads-key-form") {
      e.preventDefault();
      try { localStorage.setItem(KEY_STORE, $("#leads-key").value.trim()); } catch (x) { /* */ }
      return refresh();
    }
    if (f.id === "leads-team-form") {
      e.preventDefault();
      const tm = team(), name = f.elements.name.value.trim();
      if (name && !tm.members.some(m => m.name === name)) tm.members.push({ name, phone: f.elements.phone.value.trim() });
      ls.set(TEAM_STORE, tm); return render();
    }
    if (f.id === "leads-add") {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      const btn = f.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Saving…";
      try {
        await fetch(endpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ name: d.name, phone: d.phone, product: d.product, message: d.message, source: d.source }) });
        adding = false;
        if (window.FAV_ADMIN && window.FAV_ADMIN.toast) window.FAV_ADMIN.toast("Lead saved ✓");
        render();
        setTimeout(refresh, 2500);
      } catch (x) { btn.disabled = false; btn.textContent = "Save lead"; alert("Couldn't save. Check your connection and try again."); }
    }
  });

  const rb = $("#leads-refresh"); if (rb) rb.addEventListener("click", refresh);
  document.addEventListener("click", e => { if (e.target.closest("[data-leads]")) { e.preventDefault(); open(); } });
  // Check for new leads as soon as the admin has a key (saved once in Orders, Customers or here).
  if (key()) startPolling();

  window.FAV_LEADS = { open, refresh, _test: { flatten, poll, get: () => leads } };
})();
