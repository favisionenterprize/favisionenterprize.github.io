// "🏷 Brands" screen (dashboard button, deep link #brands): Alexander's brands from data/brands.json —
// brand kit (colours, fonts, logo/avatar/cover downloads from assets/brands/<id>/), contacts, the words that
// mark a post as that brand's, and every social account with a setup pack for the ones still to create
// (handle, name, bio, link, profile picture, cover, signup link). Alexander creates accounts himself; the
// admin only prepares them and records the handle + status.
// FAV_BRANDS.detect(text) → the brand a post belongs to: a post that names another brand (its `match` words
// or contacts) and does NOT carry F.A Vision's name or contacts belongs to that brand; otherwise F.A Vision.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const FILE = "data/brands.json";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, bad) => { if (A().toast) A().toast(m, bad); };
  const NETS = {
    facebook: { label: "Facebook Page", signup: "https://www.facebook.com/pages/create" },
    instagram: { label: "Instagram", signup: "https://www.instagram.com/accounts/emailsignup/", note: "Switch to a Professional (Business) account, then link it to the Facebook Page in Meta Business Suite." },
    tiktok: { label: "TikTok", signup: "https://www.tiktok.com/signup", note: "Settings → Account → Switch to Business Account." },
    x: { label: "X (Twitter)", signup: "https://x.com/i/flow/signup" },
    youtube: { label: "YouTube", signup: "https://www.youtube.com/create_channel", note: "Use a brand account so it isn't tied to your personal name." },
    threads: { label: "Threads", signup: "https://www.threads.net/", note: "Sign in with the brand's Instagram account; no separate signup." },
    pinterest: { label: "Pinterest", signup: "https://www.pinterest.com/business/create/" },
    linkedin: { label: "LinkedIn Page", signup: "https://www.linkedin.com/company/setup/new/" },
    snapchat: { label: "Snapchat", signup: "https://accounts.snapchat.com/accounts/v2/signup", note: "Then create a Public Profile for the business." },
    whatsapp_business: { label: "WhatsApp Business", signup: "https://business.whatsapp.com/download", note: "Needs the brand's own phone number (the app, on the phone)." }
  };
  const STATUS = { to_create: "To create", live: "Live", skip: "Not needed" };
  let B = null, dirty = false;

  // ---------------------------------------------------------------- data + brand detection
  const digits = s => String(s || "").replace(/\D/g, "").replace(/^233/, "0");
  function norm(b) {
    b = b && typeof b === "object" ? b : { brands: [] };
    b.brands = Array.isArray(b.brands) ? b.brands : [];
    b.brands.forEach(x => { x.accounts = x.accounts || {}; for (const n of Object.keys(NETS)) x.accounts[n] = x.accounts[n] || { handle: "", status: "to_create" }; x.match = x.match || []; x.phones = x.phones || []; });
    return b;
  }
  async function load(force) { if (!B || force) { try { B = norm(await A().readJsonFile(FILE, { brands: [] })); } catch (e) { B = B || norm(null); } } return B; }
  function signals(b) {
    const words = (b.match || []).map(w => String(w).toLowerCase()).filter(w => w && !/^\+?\d[\d ]+$/.test(w));
    const nums = [...(b.phones || []), b.whatsapp, ...(b.match || []).filter(w => /^\+?\d[\d ]+$/.test(w))].map(digits).filter(x => x.length >= 9);
    return { words, nums };
  }
  function detect(text, list) {
    const all = list ? norm({ brands: JSON.parse(JSON.stringify(list)) }).brands : (B ? B.brands : []);
    const home = all.find(b => b.default) || all[0];
    if (!home) return null;
    const t = String(text || ""), low = t.toLowerCase();
    const numbers = (t.match(/\+?\d[\d\s-]{7,}\d/g) || []).map(digits);
    const hits = b => { const s = signals(b); return s.words.some(w => low.includes(w)) || s.nums.some(n => numbers.includes(n)); };
    if (hits(home)) return home;                    // carries F.A Vision's name or contacts → F.A Vision
    return all.find(b => b !== home && hits(b)) || home;
  }

  // ---------------------------------------------------------------- screen
  let screen = $("#screen-brands");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-brands"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>🏷 Brands</h1>
      <p class="muted">Each of your businesses, its brand kit and its social accounts. Posting is brand-specific: a post that names another brand and doesn't carry F.A Vision's contacts goes out on that brand's own Page and accounts. You create new accounts yourself; each one below has everything ready to copy.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button></div></div>
      <div id="br-body"><p class="muted">Loading…</p></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `#br-body{display:grid;gap:18px}.br-card{background:#fff;border:1px solid #e3e7ee;border-radius:14px;overflow:hidden}
.br-head{display:flex;gap:14px;align-items:center;padding:14px 16px;border-bottom:1px solid #eceff3;flex-wrap:wrap}
.br-head img{width:64px;height:64px;border-radius:50%;object-fit:cover}.br-head h2{margin:0;font-size:18px}.br-head .muted{margin:2px 0 0}
.br-sw{display:flex;gap:6px;margin-left:auto}.br-sw span{width:28px;height:28px;border-radius:8px;border:1px solid #0002}
.br-sec{padding:12px 16px;display:grid;gap:8px;border-bottom:1px solid #f1f3f6}.br-sec h3{margin:0;font-size:14px;color:#3c4043}
.br-kit{display:flex;flex-wrap:wrap;gap:10px}.br-kit a{display:grid;gap:4px;font-size:12px;color:#3c4043;text-decoration:none;text-align:center}
.br-kit img{height:72px;border-radius:8px;border:1px solid #e3e7ee;background:#f8fafd}
.br-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.br-row label{display:grid;gap:3px;font-size:12px;color:#5f6368;flex:1 1 220px}
.br-row input,.br-acc input,.br-acc select{font:inherit;font-size:13px;padding:6px 8px;border:1px solid #dadce0;border-radius:8px;min-width:0;box-sizing:border-box}
.br-row input{width:100%}.br-acc{display:grid;grid-template-columns:140px 1fr 120px auto;gap:6px;align-items:center;font-size:13px}
.br-acc .st-live{background:#e3f4ea}.br-acc .st-to_create{background:#fff6e0}
.br-pack{grid-column:1/-1;background:#f8fafd;border:1px solid #e3e7ee;border-radius:10px;padding:10px;font-size:13px;display:grid;gap:6px}
.br-warn{background:#fff6e0;border:1px solid #f0d58c;border-radius:10px;padding:8px 10px;font-size:13px}
.br-bar{position:sticky;bottom:0;display:flex;gap:10px;justify-content:flex-end;padding:10px;background:rgba(255,255,255,.95);border-top:1px solid #e3e7ee}
@media (max-width:640px){.br-acc{grid-template-columns:1fr 1fr}}`;
    document.head.appendChild(st);
  }
  if (!document.querySelector("[data-brands]")) {
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-brands>🏷 Brands</button>`);
  }
  async function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    window.scrollTo(0, 0);
    if (location.hash !== "#brands") history.replaceState(null, "", "#brands");
    if (!dirty) await load(true);
    render();
  }
  const KIT = [["avatar.png", "Profile picture"], ["logo-light.png", "Logo (light)"], ["logo-dark.png", "Logo (dark)"], ["logo-mark.png", "Logo mark"], ["facebook-cover.jpg", "Facebook cover"], ["x-header.jpg", "X header"], ["youtube-banner.jpg", "YouTube banner"], ["linkedin-cover.jpg", "LinkedIn cover"]];
  const coverFor = { facebook: "facebook-cover.jpg", x: "x-header.jpg", youtube: "youtube-banner.jpg", linkedin: "linkedin-cover.jpg" };
  const kitPath = b => b.kit && /^assets\//.test(b.kit) ? "../" + b.kit : null;
  function pack(b, n) {
    const a = b.accounts[n], kit = kitPath(b), bio = (b.bio && b.bio.short) || "";
    const text = n === "x" || n === "tiktok" ? bio.slice(0, 80) : (["facebook", "linkedin", "youtube"].includes(n) && b.bio && b.bio.long) || bio;
    return `<div class="br-pack"><b>Setup pack: ${esc(NETS[n].label)}</b>
      <div>Name: <b>${esc(b.name)}</b>${a.handle ? ` · Handle: <b>@${esc(String(a.handle).replace(/^@/, ""))}</b>` : ""} · Category: ${esc(b.category || "Shopping &amp; retail")}</div>
      ${text ? `<div>Bio: ${esc(text)} <button class="btn btn-ghost btn-sm" data-br-copy="${esc(text)}">Copy</button></div>` : ""}
      ${b.whatsapp ? `<div>Contact: WhatsApp ${esc(b.whatsapp)}</div>` : `<div class="br-warn">Add this brand's phone/WhatsApp above first: the accounts and posts need it.</div>`}
      ${kit ? `<div>Profile picture: <a href="${esc(kit)}avatar.png" download>avatar.png</a>${coverFor[n] ? ` · Cover: <a href="${esc(kit + coverFor[n])}" download>${coverFor[n]}</a>` : ""}</div>` : ""}
      ${NETS[n].note ? `<div class="muted">${esc(NETS[n].note)}</div>` : ""}
      <div><a class="btn btn-sell btn-sm" href="${esc(NETS[n].signup)}" target="_blank" rel="noopener">Open ${esc(NETS[n].label)} signup ↗</a> then type the handle here and set it to Live.</div></div>`;
  }
  function render() {
    if (screen.hidden || !B) return;
    $("#br-body").innerHTML = B.brands.map((b, i) => {
      const kit = kitPath(b), c = b.colors || {};
      const todo = Object.keys(NETS).filter(n => b.accounts[n].status === "to_create").length;
      return `<section class="br-card" data-bi="${i}">
        <div class="br-head">${kit ? `<img src="${esc(kit)}avatar.png" alt="">` : ""}<div><h2>${esc(b.name)}${b.default ? " · main brand" : b.partner ? " · partner business" : ""}</h2>
          <p class="muted">${esc(b.tagline || "")}${b.fonts ? ` · ${esc(b.fonts.heading)} / ${esc(b.fonts.body)}` : ""}${todo ? ` · ${todo} account${todo === 1 ? "" : "s"} to create` : ""}</p></div>
          ${b.colors ? `<div class="br-sw">${Object.entries(c).map(([k, v]) => `<span title="${esc(k)} ${esc(v)}" style="background:${esc(v)}"></span>`).join("")}</div>` : ""}</div>
        ${kit ? `<div class="br-sec"><h3>Brand kit</h3><div class="br-kit">${KIT.map(([f, l]) => `<a href="${esc(kit + f)}" download><img src="${esc(kit + f)}" alt="">${esc(l)}</a>`).join("")}</div>
          ${b.voice ? `<div class="muted" style="font-size:13px">Voice: ${esc(b.voice)}</div>` : ""}</div>` : b.default ? "" : `<div class="br-sec"><div class="br-warn">No brand kit yet. Ask Claude to design one for ${esc(b.name)}.</div></div>`}
        <div class="br-sec"><h3>Contacts and how its posts are recognised</h3><div class="br-row">
          <label>Phones (comma-separated)<input data-f="phones" value="${esc((b.phones || []).join(", "))}" placeholder="e.g. 024 000 0000"></label>
          <label>WhatsApp<input data-f="whatsapp" value="${esc(b.whatsapp || "")}" placeholder="e.g. +233240000000"></label>
          <label>Words that mark a post as ${esc(b.short || b.name)}'s<input data-f="match" value="${esc((b.match || []).join(", "))}"></label></div>
          ${!b.default && !b.whatsapp ? `<div class="br-warn">${esc(b.name)} has no phone/WhatsApp yet, so its posts can't carry its own contact. Add it here.</div>` : ""}</div>
        <div class="br-sec"><h3>Social accounts</h3>${Object.keys(NETS).map(n => { const a = b.accounts[n]; return `<div class="br-acc" data-net="${n}">
          <span>${esc(NETS[n].label)}</span><input data-a="handle" value="${esc(a.handle || "")}" placeholder="handle or Page name">
          <select data-a="status" class="st-${esc(a.status)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === a.status ? " selected" : ""}>${v}</option>`).join("")}</select>
          ${a.status === "to_create" ? `<button class="btn btn-ghost btn-sm" data-br-pack>Setup pack</button>` : "<span></span>"}
          ${a.status === "to_create" && b.__open === n ? pack(b, n) : ""}</div>`; }).join("")}</div>
      </section>`;
    }).join("") + `<div class="br-bar"><span class="muted" id="br-state" style="margin-right:auto;align-self:center">${dirty ? "Unsaved changes" : "All changes saved"}</span><button class="btn btn-sell" data-br-save${dirty ? "" : " disabled"}>Save brands</button></div>`;
  }
  const brandOf = el => { const c = el.closest("[data-bi]"); return c ? B.brands[+c.dataset.bi] : null; };
  function mark() { if (!dirty) { dirty = true; const b = $("[data-br-save]"); if (b) b.disabled = false; const s = $("#br-state"); if (s) s.textContent = "Unsaved changes"; } }
  document.addEventListener("click", async e => {
    if (e.target.closest("[data-brands]")) { e.preventDefault(); show(); return; }
    if (screen.hidden || !B) return;
    const cp = e.target.closest("[data-br-copy]");
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.brCopy); toast("Copied ✓"); } catch (x) { toast("Couldn't copy: select the text instead.", true); } return; }
    if (e.target.closest("[data-br-pack]")) { const b = brandOf(e.target), n = e.target.closest("[data-net]").dataset.net; B.brands.forEach(x => { if (x !== b) delete x.__open; }); b.__open = b.__open === n ? null : n; render(); return; }
    if (e.target.closest("[data-br-save]")) {
      const mine = JSON.parse(JSON.stringify(B.brands, (k, v) => k === "__open" ? undefined : v));
      if (A().busy) A().busy("Saving brands…");
      try {
        B = norm(await A().saveJson(FILE, cur => { cur = norm(cur); const by = Object.fromEntries(mine.map(b => [b.id, b])); cur.brands = cur.brands.map(b => by[b.id] ? Object.assign(b, by[b.id]) : b); return cur; }, "Brands: updated by Alexander", { brands: [] }));
        dirty = false; toast("Brands saved ✓");
      } catch (x) { toast(A().friendly ? A().friendly(x) : String(x), true); }
      finally { if (A().busy) A().busy(null); render(); }
    }
  });
  function edit(e) {
    if (screen.hidden || !B) return;
    const b = e.target.closest && brandOf(e.target); if (!b) return;
    const f = e.target.dataset.f, a = e.target.dataset.a;
    if (f === "phones" || f === "match") b[f] = e.target.value.split(",").map(x => x.trim()).filter(Boolean);
    else if (f === "whatsapp") { b.whatsapp = e.target.value.trim(); if (b.whatsapp) delete b.contacts_pending; }
    else if (a) { const n = e.target.closest("[data-net]").dataset.net; b.accounts[n][a] = e.target.value.trim(); if (a === "status") { e.target.className = "st-" + e.target.value; if (e.type === "change") { mark(); return render(); } } }
    else return;
    mark();
  }
  document.addEventListener("input", edit);
  document.addEventListener("change", edit);
  (function warm(t) { if (A().readJsonFile) load().catch(() => {}); else if (t < 40) setTimeout(() => warm(t + 1), 500); })(0);
  window.FAV_BRANDS = { open: show, load, detect, list: () => (B ? B.brands : []), _test: { set: b => { B = norm(b); }, state: () => B } };
})();
