// "🪪 Profile kit" screen (dashboard button, deep link #profilekit, data data/profile-kits.json).
// The 8 "profile rebuild" prompts, run per brand (data/brands.json) × platform with that brand's own facts only:
//   rebuild (full profile rebuild plan), bio (bio lab: 10 options, top 3 ranked, each = promise + proof + reason
//   to follow + CTA, within the platform's limit: IG 150, TikTok 80, X 160, Facebook 101, YouTube 1000),
//   highlights (IG highlights / YouTube playlists / TikTok playlists map), pinned (pinned trio: authority anchor,
//   best walkthrough, lead-magnet bridge to /studio or /tiktok/, each with a 15-second hook), banner (cover brief:
//   colour contrast from the brand kit, 3-word value line, mobile safe zone), audit (titles + thumbnails audit),
//   keywords (keyword clusters), funnel (pinned-comment funnel: 3 lines to WhatsApp + site).
// AI = backend `muse` (mode content), gated by the AI Plan (step "profilekit:<prompt>", rule M6). Without AI, or
// with M6 not approved, each card still shows the ready prompt (Copy prompt) to paste into Muse or any AI.
// Output cards: Copy, and for bios "Save to brand" = writes that bio into brands.json accounts.<net>.bio via
// FAV_ADMIN.saveJson, only when clicked. "Save kit" stores the outputs in data/profile-kits.json. Nothing here
// ever changes a live account: Alexander pastes the bio in the app himself.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const FILE = "data/profile-kits.json", BFILE = "data/brands.json";
  const EMPTY = { updated: null, extra_profiles: [], kits: {} };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, bad) => { if (A().toast) A().toast(m, bad); };
  const SITE = "favisionenterprize.github.io";
  const NETS = {
    instagram: { label: "Instagram", limit: 150 }, tiktok: { label: "TikTok", limit: 80 }, x: { label: "X", limit: 160 },
    facebook: { label: "Facebook Page", limit: 101 }, youtube: { label: "YouTube", limit: 1000 }
  };
  const PROMPTS = [
    ["rebuild", "Profile rebuild", "A full plan to rebuild this profile: name field, handle, category, bio, link, profile picture, highlights/playlists, pinned posts, first 9 posts. Numbered, one line each."],
    ["bio", "Bio lab", "10 bio options, ranked; each = promise + proof + reason to follow + call to action, inside the platform's character limit."],
    ["highlights", "Highlights / playlists map", "The highlight covers (Instagram), playlists (YouTube/TikTok) or sections this profile should have, in order, with what goes in each."],
    ["pinned", "Pinned trio", "3 posts to pin: authority anchor, best walkthrough, lead-magnet bridge to the free Room Designer (/studio) or the TikTok shop page (/tiktok/), each with a 15-second hook."],
    ["banner", "Banner brief", "Cover/banner brief: colour contrast from the brand kit, a 3-word value line, what sits in the mobile safe zone, what to leave out."],
    ["audit", "Title & thumbnail audit", "A checklist to audit post titles and thumbnails/covers on this profile, with 5 better title patterns for this brand."],
    ["keywords", "Keyword clusters", "4–6 keyword clusters (search words buyers in Ghana use) for this brand's bio, captions and alt text."],
    ["funnel", "Pinned-comment funnel", "3 short lines to pin as the first comment on posts: interest → WhatsApp → website (or the brand's own contact)."]
  ];
  let K = null, B = null, dirty = false, sel = { brand: "fa-vision", net: "instagram" }, busyKey = "";
  try { sel = Object.assign(sel, JSON.parse(localStorage.getItem("fa-profilekit-sel") || "{}")); } catch (e) { /* storage off */ }

  function norm(k) {
    k = k && typeof k === "object" ? k : JSON.parse(JSON.stringify(EMPTY));
    k.kits = k.kits && typeof k.kits === "object" ? k.kits : {};
    k.extra_profiles = Array.isArray(k.extra_profiles) ? k.extra_profiles : [];
    return k;
  }
  async function load(force) {
    if (!K || force) { try { K = norm(await A().readJsonFile(FILE, EMPTY)); } catch (e) { K = K || norm(null); } }
    if (!B || force) { try { B = await A().readJsonFile(BFILE, { brands: [] }); } catch (e) { B = B || { brands: [] }; } }
    return K;
  }
  // Profiles = every brand + extra profiles of a brand (e.g. Fa Vision Furnitures, Instagram @favisionfurnitures_).
  function profiles() {
    const out = [];
    for (const b of (B && B.brands) || []) out.push({ key: b.id, brand: b, name: b.name, handles: Object.fromEntries(Object.entries(b.accounts || {}).map(([n, a]) => [n, a && a.handle || ""])) });
    for (const x of K ? K.extra_profiles : []) {
      const b = ((B && B.brands) || []).find(y => y.id === x.brand);
      if (b) out.push({ key: x.id, brand: b, name: x.name, extra: x, handles: x.handles || {} });
    }
    return out;
  }
  const cur = () => profiles().find(p => p.key === sel.brand) || profiles()[0] || null;
  const kitKey = () => sel.brand + ":" + sel.net;
  const kit = () => (K.kits[kitKey()] = K.kits[kitKey()] || { outputs: {} });

  // Only this brand's own facts go to the AI (no other brand's names or contacts).
  function facts(pr) {
    const b = pr.brand, lp = n => (window.FAV_CONFIG && window.FAV_CONFIG.localPhone && n ? window.FAV_CONFIG.localPhone(n) : n || "");
    const prods = ((A().products && A().products()) || []).filter(p => !p.placeholder && (b.default ? !p.seller : p.seller && new RegExp((b.short || b.name).split(" ")[0], "i").test(p.seller.name)));
    const lines = [
      `Brand: ${pr.name}${pr.name !== b.name ? ` (a profile of ${b.name})` : ""}`,
      `Sells: ${b.sells || b.category || ""}`, `Place: ${b.place || ""}`, b.tagline ? `Tagline: ${b.tagline}` : "",
      b.voice ? `Voice: ${b.voice}` : "", b.whatsapp ? `WhatsApp: ${lp(b.whatsapp)}` : "", b.email ? `Email: ${b.email}` : "",
      pr.handles[sel.net] ? `Handle on ${NETS[sel.net].label}: ${pr.handles[sel.net]}` : `No ${NETS[sel.net].label} account yet`,
      b.colors ? `Brand colours: ${Object.entries(b.colors).map(([k, v]) => k + " " + v).join(", ")}` : "",
      b.default ? `Website: ${SITE} · free Room Designer: ${SITE}/studio/ · TikTok shop page: ${SITE}/tiktok/ · showroom Tarazzo Road, opposite Pacific, Odorkor` : "Website: none of its own (do not use F.A Vision's links)",
      prods.length ? `Products (name, price): ${prods.slice(0, 12).map(p => `${String(p.name).split(" — ")[0]} GH₵${p.price_ghs}${p.id === "FAV-014" ? " a set, GH₵640 each from 50" : ""}`).join("; ")}` : "",
      (b.hashtags || []).length ? `Own hashtags: ${b.hashtags.join(" ")}` : ""
    ];
    return lines.filter(Boolean).join("\n");
  }
  function promptFor(id, pr) {
    const n = NETS[sel.net], def = PROMPTS.find(p => p[0] === id);
    const rules = `Rules: use ONLY the facts below; never invent awards, years, customer numbers, reviews, prices or discounts. Say "we sell", never "we make". British English. Plain text, no markdown tables.`;
    let ask = def[2];
    if (id === "bio") ask = `Write 10 ${n.label} bio options for this profile. Each must fit in ${n.limit} characters (count emojis as 2) and contain a promise, a proof (a real fact below), a reason to follow and a call to action. Rank them best first. Reply with JSON only: {"options":[{"text":"...","why":"one short line"}]}`;
    return `${ask}\nPlatform: ${n.label} (bio limit ${n.limit} characters).\n${rules}\n\nFacts:\n${facts(pr)}`;
  }
  const len = t => [...String(t || "")].reduce((s, ch) => s + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);

  // ---------------------------------------------------------------- screen
  let screen = $("#screen-profilekit");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-profilekit"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>🪪 Profile kit</h1>
      <p class="muted">Rebuild each brand's profile on every platform: bios that fit, highlights, pinned posts, banner brief, keywords and a pinned-comment funnel, written from that brand's own facts. Nothing here changes a live account: you copy what you like and paste it in the app.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button><button class="btn btn-ghost btn-sm" data-brands>🏷 Brands</button></div></div>
      <div id="pk-body"><p class="muted">Loading…</p></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `#pk-body{display:grid;gap:14px}.pk-pick{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:10px}
.pk-pick label{display:grid;gap:4px;font-size:13px;color:#5f6368}.pk-pick select{font:inherit;font-size:14px;padding:7px 9px;border:1px solid #dadce0;border-radius:8px;background:#fff;width:100%}
.pk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px}
.pk-out{white-space:pre-wrap;background:#f6f8fc;border-radius:8px;padding:10px;font-size:14px;max-height:360px;overflow:auto;word-break:break-word}
.pk-opt{border:1px solid #e3e7ee;border-radius:10px;padding:8px 10px;display:grid;gap:6px;font-size:14px;overflow-wrap:anywhere;min-width:0}.pk-opt.top{border-color:#0d55af;background:#f3f7fd}
.pk-opt .pk-n{font-size:12px;color:#5f6368}.pk-opt .pk-n.over{color:#d32f2f;font-weight:700}.pk-row{display:flex;flex-wrap:wrap;gap:6px}`;
    document.head.appendChild(st);
  }
  if (!document.querySelector("[data-profilekit]")) {
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-profilekit>🪪 Profile kit</button>`);
  }
  async function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#profilekit") history.replaceState(null, "", "#profilekit");
    if (!dirty) await load(true);
    render();
  }
  function gateWhy(id) {
    const AP = window.FAV_AIPLAN;
    if (!AP || !AP.decide) return "";
    const d = AP.decide("profilekit:" + id);
    return d.v === "skip" ? d.why : "";
  }
  function bioCard(out, pr) {
    const n = NETS[sel.net];
    const saved = sel.net && pr && (pr.extra ? ((pr.extra.bios || {})[sel.net] || "") : (((pr.brand.accounts || {})[sel.net] || {}).bio || ""));
    return `${saved ? `<p class="fa-small">Saved bio: “${esc(saved)}”</p>` : ""}
      ${(out.options || []).map((o, i) => { const l = len(o.text), over = l > n.limit; return `<div class="pk-opt${i < 3 ? " top" : ""}">
        <div>${i < 3 ? `<b>#${i + 1}</b> ` : `${i + 1}. `}${esc(o.text)}</div>
        <div class="pk-n${over ? " over" : ""}">${l} / ${n.limit}${over ? " · too long for " + esc(n.label) : ""}${o.why ? " · " + esc(o.why) : ""}</div>
        <div class="pk-row"><button class="btn btn-ghost btn-sm" data-pk-copy="${esc(o.text)}">Copy</button>${over ? "" : `<button class="btn btn-ghost btn-sm" data-pk-savebio="${i}">Save to brand</button>`}</div></div>`; }).join("")}`;
  }
  function render() {
    if (screen.hidden || !K) return;
    const pr = cur();
    if (!pr) { $("#pk-body").innerHTML = `<div class="fa-card"><p class="muted">No brands in data/brands.json yet: add them in 🏷 Brands.</p></div>`; return; }
    if (!profiles().some(p => p.key === sel.brand)) sel.brand = pr.key;
    const k = kit(), acc = pr.handles[sel.net], status = pr.extra ? (acc ? "live" : "") : ((pr.brand.accounts || {})[sel.net] || {}).status;
    $("#pk-body").innerHTML = `
      <section class="fa-card">
        <div class="pk-pick">
          <label>Brand / profile<select data-pk-sel="brand">${profiles().map(p => `<option value="${esc(p.key)}" ${p.key === sel.brand ? "selected" : ""}>${esc(p.name)}${p.extra && p.handles.instagram ? " (Instagram @" + esc(p.handles.instagram) + ")" : ""}</option>`).join("")}</select></label>
          <label>Platform<select data-pk-sel="net">${Object.entries(NETS).map(([n, x]) => `<option value="${n}" ${n === sel.net ? "selected" : ""}>${esc(x.label)} · bio ≤ ${x.limit}</option>`).join("")}</select></label>
        </div>
        <p class="fa-small">${acc ? `Account: <b>${esc(acc)}</b>${status === "live" ? "" : ` (${esc(status || "not live")})`}` : `${esc(pr.name)} has no ${esc(NETS[sel.net].label)} account yet: the kit is ready for when you create it in 🏷 Brands.`} · Uses only ${esc(pr.name)}'s own facts.</p>
        ${gateWhy("bio") ? `<p class="fa-small" style="color:var(--err)">AI writing is off: ${esc(gateWhy("bio"))}. Approve rule <b>M6</b> in <a href="#aiplan" data-aiplan>🧭 AI Plan</a>. Meanwhile each card's “Copy prompt” works in Muse or any AI.</p>` : ""}
        <div class="fa-actions"><button class="btn btn-sell btn-sm" data-pk-save ${dirty ? "" : "disabled"}>${dirty ? "Save kit" : "Kit saved ✓"}</button>${k.d ? `<span class="muted fa-small" style="align-self:center">last written ${esc(k.d)}</span>` : ""}</div>
      </section>
      <div class="pk-grid">${PROMPTS.map(([id, title, what]) => { const out = k.outputs[id]; return `<section class="fa-card" data-pk="${id}">
        <header><h2>${esc(title)}</h2>${out ? `<span class="pill ok">ready</span>` : ""}</header>
        <p class="muted fa-small">${esc(what)}</p>
        <div class="fa-actions"><button class="btn btn-primary btn-sm" data-pk-run="${id}" ${busyKey === id ? "disabled" : ""}>${busyKey === id ? "Writing…" : out ? "↻ Write again" : "✨ Write it"}</button><button class="btn btn-ghost btn-sm" data-pk-prompt="${id}">Copy prompt</button>${out && out.text ? `<button class="btn btn-ghost btn-sm" data-pk-copy="${esc(out.text)}">Copy</button>` : ""}</div>
        ${out ? (id === "bio" && out.options ? bioCard(out, pr) : `<div class="pk-out">${esc(out.text || "")}</div>`) : ""}
      </section>`; }).join("")}</div>`;
  }

  async function run(id) {
    const pr = cur(); if (!pr) return;
    const why = gateWhy(id);
    if (why) return toast(`AI writing is off: ${why}. Approve rule M6 in 🧭 AI Plan, or use Copy prompt.`, true);
    if (window.FAV_AIPLAN && !window.FAV_AIPLAN.gate("profilekit:" + id, "profilekit-" + new Date().toISOString().slice(0, 13))) return;
    busyKey = id; render();
    try {
      const r = await A().backendSigned({ action: "muse", mode: "content", messages: [{ role: "user", text: promptFor(id, pr) }] });
      if (!r || !r.ok || !r.text) { toast(r && r.error === "no_session" ? "AI needs the email sign-in. Use Copy prompt instead." : r && r.error === "no_ai_key" ? "Your backend has no AI key: use Copy prompt." : "The AI didn't answer: " + ((r && r.error) || "unknown"), true); return; }
      const k = kit(), t = String(r.text).trim();
      if (id === "bio") {
        let opts = [];
        try { const m = t.match(/\{[\s\S]*\}/); opts = (JSON.parse(m ? m[0] : "{}").options || []).map(o => ({ text: String(o.text || o || "").trim(), why: String(o.why || "").slice(0, 120) })).filter(o => o.text); } catch (e) { opts = []; }
        if (!opts.length) opts = t.split(/\n+/).map(x => x.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(x => x.length > 10).slice(0, 10).map(text => ({ text, why: "" }));
        // Keep the AI's ranking, but anything over the limit drops below the ones that fit.
        const lim = NETS[sel.net].limit;
        k.outputs.bio = { options: opts.slice(0, 10).map((o, i) => ({ ...o, i })).sort((a, b) => (len(a.text) > lim) - (len(b.text) > lim) || a.i - b.i).map(({ i, ...o }) => o) };
      } else k.outputs[id] = { text: t };
      k.d = new Date().toISOString().slice(0, 10); dirty = true;
    } catch (e) { toast("Couldn't reach the backend: " + (A().friendly ? A().friendly(e) : e), true); }
    finally { busyKey = ""; render(); }
  }
  async function saveKit() {
    const mine = JSON.parse(JSON.stringify(K));
    if (A().busy) A().busy("Saving the profile kit…");
    try {
      K = norm(await A().saveJson(FILE, c => { c = norm(c); Object.assign(c.kits, mine.kits); c.updated = new Date().toISOString().slice(0, 10); return c; }, "Profile kit: saved by Alexander", EMPTY));
      dirty = false; toast("Profile kit saved ✓");
    } catch (e) { toast(A().friendly ? A().friendly(e) : String(e), true); }
    finally { if (A().busy) A().busy(null); render(); }
  }
  // Writes ONE chosen bio into data/brands.json (accounts.<net>.bio; extra profiles: data/profile-kits.json). Click only.
  async function saveBio(i) {
    const pr = cur(), o = ((kit().outputs.bio || {}).options || [])[i];
    if (!pr || !o) return;
    if (len(o.text) > NETS[sel.net].limit) return toast("That bio is too long for " + NETS[sel.net].label + ".", true);
    if (!window.confirm(`Save this as ${pr.name}'s ${NETS[sel.net].label} bio in 🏷 Brands?\n\n${o.text}\n\n(Your live account isn't changed: paste it in the app yourself.)`)) return;
    if (A().busy) A().busy("Saving the bio…");
    try {
      if (pr.extra) {
        K = norm(await A().saveJson(FILE, c => { c = norm(c); const x = c.extra_profiles.find(y => y.id === pr.key); if (x) { x.bios = x.bios || {}; x.bios[sel.net] = o.text; } return c; }, `Profile kit: ${pr.name} ${sel.net} bio`, EMPTY));
      } else {
        B = await A().saveJson(BFILE, c => { const b = (c.brands || []).find(y => y.id === pr.brand.id); if (b) { b.accounts = b.accounts || {}; b.accounts[sel.net] = Object.assign({ handle: "", status: "to_create" }, b.accounts[sel.net] || {}, { bio: o.text }); } return c; }, `Brands: ${pr.brand.name} ${sel.net} bio from the profile kit`, { brands: [] });
        if (window.FAV_BRANDS && window.FAV_BRANDS.load) window.FAV_BRANDS.load(true).catch(() => {});
      }
      toast("Bio saved to the brand ✓ Paste it in " + NETS[sel.net].label + " yourself.");
    } catch (e) { toast(A().friendly ? A().friendly(e) : String(e), true); }
    finally { if (A().busy) A().busy(null); render(); }
  }

  document.addEventListener("click", async e => {
    if (e.target.closest("[data-profilekit]")) { e.preventDefault(); show(); return; }
    if (screen.hidden || !K) return;
    const t = e.target;
    const cp = t.closest("[data-pk-copy]");
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.pkCopy); toast("Copied ✓"); } catch (x) { window.prompt("Copy this:", cp.dataset.pkCopy); } return; }
    const pp = t.closest("[data-pk-prompt]");
    if (pp) { const txt = promptFor(pp.dataset.pkPrompt, cur()); try { await navigator.clipboard.writeText(txt); toast("Prompt copied ✓ Paste it in Muse or any AI."); } catch (x) { window.prompt("Copy this prompt:", txt); } return; }
    const rn = t.closest("[data-pk-run]"); if (rn) return run(rn.dataset.pkRun);
    const sb = t.closest("[data-pk-savebio]"); if (sb) return saveBio(Number(sb.dataset.pkSavebio));
    if (t.closest("[data-pk-save]")) return saveKit();
  });
  document.addEventListener("change", e => {
    const s = e.target.dataset && e.target.dataset.pkSel;
    if (!s || screen.hidden) return;
    sel[s] = e.target.value;
    try { localStorage.setItem("fa-profilekit-sel", JSON.stringify(sel)); } catch (x) { /* storage off */ }
    render();
  });

  window.FAV_PROFILEKIT = { open: show, load, NETS, PROMPTS, _test: { promptFor: id => promptFor(id, cur()), facts: () => facts(cur()), state: () => K, brands: () => B, len, sel: v => { Object.assign(sel, v); render(); } } };
})();
