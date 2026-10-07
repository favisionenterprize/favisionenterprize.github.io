// Muse AI: the F.A Vision phone app (Android and iPhone, installed from the browser).
//   Create – ready-to-post captions, ads and scripts for any product, per platform
//   Ask    – personal assistant chat
//   Code   – writes working code (with copy, download and live preview)
//   Today  – the social autopilot at a glance (new groups, removed groups, posts)
// The AI runs in the Apps Script backend (action "muse"), so no key is on the phone.
// Self-updating: sw.js fetches the latest files from the website every time Muse opens,
// and this script checks version.json every 30 minutes and reloads itself when it changes.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const app = $("#app");
  const SITE = location.origin + "/";
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("muse." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("muse." + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const money = n => "GH₵" + Number(n).toLocaleString("en-GH");
  const mText = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n || "?");

  let endpoint = null, business = {}, products = [], auto = null, version = "";
  let tab = LS.get("tab", "create");
  let session = LS.get("session", null);

  function toast(msg, ms) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  }
  const getJson = path => fetch(SITE + path + "?t=" + Date.now(), { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(path + ": " + r.status); return r.json(); });
  async function backend(payload) {
    if (!endpoint) throw new Error("The backend isn't connected (no enquiry_endpoint in data/business.json).");
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), cache: "no-store" });
    return r.json();
  }

  // ------------------------------------------------------------------ self-update
  async function checkVersion(first) {
    try {
      const v = await getJson("muse/version.json");
      const seen = LS.get("version", "");
      if (first) {
        version = v.version;
        $("#ver").textContent = `F.A Vision · v${v.version}`;
        if (seen && seen !== v.version) toast(`Muse updated to v${v.version} ✓ ${v.notes || ""}`, 4500);
        LS.set("version", v.version);
      } else if (v.version !== version) {
        // A newer version is on the website: restart into it (unless something is being typed).
        const el = document.activeElement;
        if (!(el && /TEXTAREA|INPUT/.test(el.tagName) && el.value)) location.reload();
      }
    } catch (e) { /* offline: keep running the saved copy */ }
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
      setInterval(() => reg.update().catch(() => {}), 30 * 60e3);
    }).catch(() => {});
  }
  setInterval(() => checkVersion(false), 30 * 60e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(false); });

  // ------------------------------------------------------------------ install button (Android prompt; iPhone instructions)
  let deferred = null;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("#install").hidden = false; });
  if (ios && !standalone) $("#install").hidden = false;
  $("#install").addEventListener("click", async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; $("#install").hidden = true; return; }
    toast("On iPhone: open this page in Safari, tap the Share button, then “Add to Home Screen”.", 6000);
  });

  // ------------------------------------------------------------------ products and captions
  const sellable = () => products.filter(p => !p.placeholder && p.price_ghs && p.in_stock !== false);
  const shortName = p => String(p.name).split(" — ")[0];
  const pageUrl = p => `${SITE}p/${p.id}.html`;
  const contactOf = p => p.seller ? { name: p.seller.name, wa: p.seller.whatsapp || (p.seller.phones || [])[0] || "" } : { name: "F.A Vision Enterprise", wa: "057 264 6176" };
  function productContext(p) {
    const c = contactOf(p);
    return [
      `Product: ${p.name} (${p.id})`, `Price: ${money(p.price_ghs)}${p.negotiable ? " (negotiable)" : ""}`,
      p.highlights && p.highlights.length ? "Highlights: " + p.highlights.join("; ") : "",
      p.description ? "Description: " + String(p.description).slice(0, 600) : "",
      p.colors && p.colors.length ? "Colours: " + [].concat(p.colors).join(", ") : "",
      `Sold by: ${c.name}. WhatsApp: ${c.wa}`, `Link: ${pageUrl(p)}`,
      `Hashtags to use: ${(business.hashtags || []).slice(0, 5).join(" ")}`,
      "Payment: 50% deposit, MoMo, GhanaPay or card. Delivery across Accra and beyond. Showroom: Tarazzo Road, Odorkor (opposite Pacific)."
    ].filter(Boolean).join("\n");
  }
  const PLATFORMS = {
    group: { label: "FB group", ask: "a Facebook buy-and-sell group post (short, emojis, price, WhatsApp, link, 3 hashtags)" },
    market: { label: "Marketplace", ask: "a Facebook Marketplace listing: a title under 90 characters, then the description" },
    insta: { label: "Instagram", ask: "an Instagram caption with a strong first line, short paragraphs and 12 relevant hashtags" },
    tiktok: { label: "TikTok script", ask: "a 30-45 second TikTok/Reel video script with scene-by-scene shots, on-screen text and a voice-over, plus a caption" },
    status: { label: "WhatsApp status", ask: "3 short WhatsApp status texts (one per line) and one broadcast message to customers" },
    x: { label: "X post", ask: "an X (Twitter) post under 280 characters including the link" }
  };
  const TONES = { friendly: "Friendly", deal: "Urgent deal", premium: "Premium" };
  // Offline / no-AI fallback: templates built from the product data.
  function template(p, plat, tone) {
    const c = contactOf(p), name = shortName(p), price = money(p.price_ghs) + (p.negotiable ? " (negotiable)" : "");
    const hl = (p.highlights || []).slice(0, 3), tags = (business.hashtags || []).slice(0, 3).join(" ");
    const hook = tone === "deal" ? `🔥 DEAL ALERT: ${name}` : tone === "premium" ? `✨ ${name}: quality you can feel` : `🛋️ ${name} available now!`;
    if (plat === "market") return `${name} – ${price}\n\n${String(p.description || "").split("\n")[0]}\n${hl.map(h => "• " + h).join("\n")}\n\nPay 50% now, the rest on delivery. WhatsApp ${c.wa}.\nMore photos: ${pageUrl(p)}`;
    if (plat === "x") return `${hook} ${price}. WhatsApp ${c.wa} 👉 ${pageUrl(p)} ${tags}`.slice(0, 280);
    if (plat === "status") return `${name} in stock ✅\n${price} only. Delivery available 🚚\nWhatsApp ${c.wa} to order 📲\n\nHello! ${name} is in stock at ${price}. Reply to this message to order or see photos: ${pageUrl(p)}`;
    if (plat === "tiktok") return `Scene 1 (0-3s): Close-up of the ${name.toLowerCase()} · Text: "${price} only?!"\nScene 2 (3-15s): Slow pan showing ${hl[0] || "the finish"} · Voice: "This is our ${name}…"\nScene 3 (15-30s): Details: ${hl.slice(1).join(", ") || "size and colours"}\nScene 4 (30-40s): Showroom + delivery van · Text: "WhatsApp ${c.wa}"\n\nCaption: ${hook} ${price} · Link in bio ${tags}`;
    return `${hook}\n${hl.map(h => "✔ " + h).join("\n")}\n💰 ${price}\n📍 Odorkor, Accra · delivery available\n📞 WhatsApp ${c.wa}\n👉 ${pageUrl(p)}\n${plat === "insta" ? (business.hashtags || []).join(" ") : tags}`;
  }

  // ------------------------------------------------------------------ AI call
  async function askAI(mode, messages, context) {
    if (!session) throw Object.assign(new Error("Sign in first."), { code: "signed_out" });
    const r = await backend({ action: "muse", session, mode, messages, context: context || "" });
    // Posts are pasted into Facebook/WhatsApp, which don't render markdown: drop ** and # markers there.
    if (r.ok) return mode === "content" ? String(r.text).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s*/gm, "") : r.text;
    if (r.error === "signed_out") { session = null; LS.set("session", null); setTimeout(render, 1500); }
    const msg = {
      no_ai_key: "Muse's AI isn't switched on yet: add GEMINI_API_KEY (free) in Apps Script → Project settings → Script properties. Until then Create uses built-in templates.",
      busy: "Muse is busy (120 requests this hour). Try again in a few minutes.",
      signed_out: "Signed out. Sign in again.",
      "name required": "The backend needs the latest Code.gs pasted into Apps Script and deployed (backend/README.md)."
    }[r.error] || ("AI error: " + r.error);
    throw Object.assign(new Error(msg), { code: r.error });
  }

  // ------------------------------------------------------------------ rendering helpers
  // Light markdown: fenced code blocks get Copy / Download / Preview; **bold**; links.
  const codeStore = {};
  function richText(text) {
    const parts = String(text).split(/```([\w+-]*)\n?([\s\S]*?)```/g);
    let html = "";
    for (let i = 0; i < parts.length; i += 3) {
      html += esc(parts[i]).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      if (i + 2 < parts.length) {
        const lang = (parts[i + 1] || "text").toLowerCase(), code = parts[i + 2] || "";
        const id = "c" + Math.random().toString(36).slice(2, 8);
        codeStore[id] = { lang, code };
        const previewable = /^html?$/.test(lang) || (/<(html|body)\b/i.test(code));
        html += `<pre>${esc(code)}</pre><div class="codebar"><button class="btn sm ghost" data-copy-code="${id}">Copy</button><button class="btn sm ghost" data-dl-code="${id}">Download</button>${previewable ? `<button class="btn sm ghost" data-preview-code="${id}">Preview</button>` : ""}</div><div data-preview-slot="${id}"></div>`;
      }
    }
    return html;
  }
  const EXT = { html: "html", htm: "html", javascript: "js", js: "js", python: "py", py: "py", css: "css", json: "json", bash: "sh", sh: "sh", sql: "sql", gs: "gs", appsscript: "gs", csv: "csv", text: "txt" };
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    toast("Copied ✓");
  }

  // ------------------------------------------------------------------ views
  function viewSignIn(err) {
    return `<section class="card">
      <h2>Sign in to Muse</h2>
      <p class="muted">Use the same email and password as your F.A Vision admin. You stay signed in on this phone.</p>
      ${err ? `<div class="banner bad">${esc(err)}</div>` : ""}
      <form id="signin">
        <label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" required>
        <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
        <button class="btn block">Sign in</button>
      </form>
      <p class="muted">Forgot it? Reset it on the <a href="../admin/">admin sign-in page</a>.</p>
    </section>
    <section class="card"><h2>Put Muse on your home screen</h2>
      <p class="muted"><b>Android (Chrome):</b> tap <b>Install</b> at the top, or ⋮ → <b>Add to Home screen</b>.<br><b>iPhone (Safari):</b> tap Share → <b>Add to Home Screen</b>.<br>Muse then opens like an app and updates itself.</p></section>`;
  }

  const cState = LS.get("create", { p: "", plat: "group", tone: "friendly" });
  let lastOut = "";
  function viewCreate() {
    const list = sellable();
    if (!cState.p || !list.some(p => p.id === cState.p)) cState.p = (auto && auto.today && list.some(p => p.id === auto.today.p)) ? auto.today.p : (list[0] || {}).id || "";
    const chip = (group, k, label, on) => `<button type="button" class="chip" data-chip="${group}" data-val="${k}" aria-pressed="${on}">${esc(label)}</button>`;
    return `<section class="card">
      <h2>Create a post</h2>
      <p class="muted">Pick a product and where it's going. Muse writes it ready to paste.</p>
      <label for="cp">Product</label>
      <select id="cp">${list.map(p => `<option value="${esc(p.id)}" ${p.id === cState.p ? "selected" : ""}>${esc(shortName(p))} · ${money(p.price_ghs)}${p.seller ? " · " + esc(p.seller.name) : ""}</option>`).join("")}</select>
      <label>Platform</label><div class="chips">${Object.entries(PLATFORMS).map(([k, v]) => chip("plat", k, v.label, k === cState.plat)).join("")}</div>
      <label>Tone</label><div class="chips">${Object.entries(TONES).map(([k, v]) => chip("tone", k, v, k === cState.tone)).join("")}</div>
      <label for="cx">Anything to add? (optional)</label><input id="cx" placeholder="e.g. free delivery in Kasoa this week">
      <button class="btn block" id="gen">✨ Write it</button>
      <div id="gen-out">${lastOut ? outBlock(lastOut) : ""}</div>
    </section>
    <section class="card">
      <h2>Today's pack</h2>
      <p class="muted">One tap: a Facebook group post, Instagram caption, WhatsApp status lines and a TikTok script for today's listing.</p>
      <button class="btn ghost block" id="pack">Make today's pack</button>
      <div id="pack-out"></div>
    </section>`;
  }
  function outBlock(text) {
    const p = products.find(x => x.id === cState.p);
    return `<div class="out">${esc(text)}</div><div class="out-actions">
      <button class="btn sm" data-out="copy">Copy</button>
      <button class="btn sm wa" data-out="wa">WhatsApp</button>
      ${navigator.share ? `<button class="btn sm ghost" data-out="share">Share…</button>` : ""}
      ${p && (p.images || [])[0] ? `<a class="btn sm ghost" href="../${esc(p.images[0])}" download>Photo</a>` : ""}
    </div>`;
  }

  function viewChat(mode) {
    const msgs = (LS.get("chats", {})[mode]) || [];
    const intro = mode === "code"
      ? "Tell Muse what to build: a web page, an Excel formula, a Python or Apps Script tool. It writes the complete code with Copy, Download and Preview."
      : "Ask anything: plans, emails, prices, customer replies, reconciliation steps, ideas for the business.";
    const starters = mode === "code"
      ? ["A one-page price list for my furniture as HTML", "Excel formula: total sales by month from a date column", "Apps Script that emails me new rows in my Orders sheet"]
      : ["Write a polite reply to a customer asking for a discount", "Plan this week's posts for FA Vision", "How should I price a 6-seater dining set for profit?"];
    return `<section class="card"><h2>${mode === "code" ? "Code" : "Ask Muse"}</h2><p class="muted">${intro}</p>
      ${msgs.length ? `<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-clear="${mode}">New chat</button></div>` : `<div class="chips" style="margin-top:8px">${starters.map(s => `<button type="button" class="chip" data-starter="${esc(s)}">${esc(s)}</button>`).join("")}</div>`}
    </section>
    <div class="chat" id="chat">${msgs.map(m => `<div class="msg ${m.role === "user" ? "u" : "a"}">${m.role === "user" ? esc(m.text) : richText(m.text)}</div>`).join("")}</div>`;
  }

  function viewToday() {
    if (!auto) return `<section class="card"><p class="muted">Loading the autopilot…</p></section>`;
    const d = today(), s = Object.assign({ grow_daily: 20 }, auto.settings || {});
    const joins = (auto.joins || []).filter(j => j.d === d && j.status !== "failed");
    const removed = auto.removed || [];
    const removedToday = removed.filter(r => r.d === d);
    const posts = (auto.posts || []).filter(x => x.d === d);
    const active = (auto.groups || []).filter(g => g.active !== false).length;
    const pending = (auto.groups || []).filter(g => g.pending).length;
    const tp = auto.today && auto.today.d === d ? products.find(p => p.id === auto.today.p) : null;
    return `${joins.length >= s.grow_daily ? `<div class="banner good">🎉 ${joins.length} new big groups added today. Target reached.</div>` : joins.length ? `<div class="banner info">${joins.length}/${s.grow_daily} new groups so far today.</div>` : ""}
      ${removedToday.length ? `<div class="banner bad">${plural(removedToday.length, "group")} declined our posts today and ${removedToday.length === 1 ? "was" : "were"} removed.</div>` : ""}
      <section class="card"><h2>Facebook groups</h2>
        <div class="stat"><div><b>${active}</b><small>active</small></div><div><b>${joins.length}/${s.grow_daily}</b><small>new today</small></div><div><b>${removed.length}</b><small>removed</small></div></div>
        <p class="muted" style="margin-top:10px">${tp ? `Today's listing: <b>${esc(shortName(tp))}</b> · ` : ""}${posts.filter(x => x.ok).length} of ${posts.length} group posts done today${pending ? ` · ${plural(pending, "join request")} waiting` : ""}.</p>
        <a class="btn ghost block" style="display:block;text-align:center;text-decoration:none" href="../admin/#fbauto">Open the autopilot (computer)</a>
      </section>
      ${joins.length ? `<section class="card"><h2>New today</h2><ul class="list">${joins.map(j => `<li><span>${j.url ? `<a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.name)}</a>` : esc(j.name)}</span><small>${mText(j.members)} · ${j.status === "joined" ? "joined" : "waiting"}</small></li>`).join("")}</ul></section>` : ""}
      ${removed.length ? `<section class="card"><h2>Removed (declined our posts)</h2><ul class="list">${removed.slice(-15).reverse().map(r => `<li><span>${esc(r.name)}</span><small>${esc(r.d)} · ${r.left ? "left" : "to leave"}</small></li>`).join("")}</ul></section>` : ""}`;
  }

  function render() {
    const signed = !!session;
    const chatting = signed && (tab === "ask" || tab === "code");
    $("#tabs").hidden = !signed;
    $("#signout").hidden = !signed;
    $("#composer").hidden = !chatting;
    app.classList.toggle("chatting", chatting);
    document.querySelectorAll("#tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (!signed) { app.innerHTML = viewSignIn(); return; }
    app.innerHTML = tab === "ask" ? viewChat("assistant") : tab === "code" ? viewChat("code") : tab === "today" ? viewToday() : viewCreate();
    $("#ask-input").placeholder = tab === "code" ? "Describe the code you need…" : "Ask Muse…";
    if (chatting) window.scrollTo(0, document.body.scrollHeight);
  }

  // ------------------------------------------------------------------ actions
  async function generate() {
    const p = products.find(x => x.id === cState.p);
    if (!p) return;
    const extra = ($("#cx") || {}).value || "";
    const btn = $("#gen"); btn.disabled = true; btn.textContent = "Writing…";
    $("#gen-out").innerHTML = `<p class="thinking"></p>`;
    try {
      const prompt = `Write ${PLATFORMS[cState.plat].ask} for this product. Tone: ${TONES[cState.tone]}.${extra ? " Also: " + extra : ""} Reply with the post text only.`;
      lastOut = await askAI("content", [{ role: "user", text: prompt }], productContext(p));
    } catch (e) {
      lastOut = template(p, cState.plat, cState.tone);
      toast(e.code === "no_ai_key" ? "Built-in template used (AI not switched on yet)." : e.message, 4500);
    }
    $("#gen-out").innerHTML = outBlock(lastOut);
    btn.disabled = false; btn.textContent = "✨ Write another";
  }
  async function pack() {
    const list = sellable();
    const p = (auto && auto.today && list.find(x => x.id === auto.today.p)) || list.find(x => x.id === cState.p) || list[0];
    if (!p) return;
    const box = $("#pack-out"), btn = $("#pack");
    btn.disabled = true; box.innerHTML = `<p class="thinking"></p>`;
    let text;
    try {
      text = await askAI("content", [{ role: "user", text: "Make today's posting pack for this product, with clear headings: 1) Facebook group post 2) Instagram caption 3) Three WhatsApp status lines 4) TikTok script (30-45 s). Ready to paste." }], productContext(p));
    } catch (e) {
      text = ["FACEBOOK GROUP POST", template(p, "group", "friendly"), "", "INSTAGRAM", template(p, "insta", "premium"), "", "WHATSAPP STATUS", template(p, "status", "deal"), "", "TIKTOK SCRIPT", template(p, "tiktok", "friendly")].join("\n");
      if (e.code !== "no_ai_key") toast(e.message, 4500);
    }
    const id = "c" + Math.random().toString(36).slice(2, 8);
    codeStore[id] = { lang: "text", code: text };
    box.innerHTML = `<p class="muted" style="margin:10px 0 0">For <b>${esc(shortName(p))}</b></p><div class="out">${esc(text)}</div><div class="out-actions"><button class="btn sm" data-copy-code="${id}">Copy all</button><button class="btn sm wa" data-wa-code="${id}">WhatsApp</button></div>`;
    btn.disabled = false;
  }
  async function send(text) {
    const mode = tab === "code" ? "code" : "assistant";
    const chats = LS.get("chats", {});
    const msgs = (chats[mode] || []).concat([{ role: "user", text }]);
    chats[mode] = msgs; LS.set("chats", chats);
    render();
    const wait = document.createElement("div"); wait.className = "msg a thinking"; $("#chat").appendChild(wait);
    window.scrollTo(0, document.body.scrollHeight);
    $("#ask-send").disabled = true;
    let reply;
    try {
      const ctx = mode === "assistant" ? "Products in stock: " + sellable().map(p => `${shortName(p)} ${money(p.price_ghs)}`).join("; ") : "";
      reply = await askAI(mode, msgs.slice(-12), ctx);
    } catch (e) { reply = "⚠️ " + e.message; }
    const c2 = LS.get("chats", {});
    c2[mode] = (c2[mode] || []).concat([{ role: "assistant", text: reply }]).slice(-40);
    LS.set("chats", c2);
    $("#ask-send").disabled = false;
    if ((tab === "code" ? "code" : "assistant") === mode) render();
  }

  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab]");
    if (t) { tab = t.dataset.tab; LS.set("tab", tab); render(); if (tab !== "ask" && tab !== "code") window.scrollTo(0, 0); if (tab === "today") refreshAuto(); return; }
    const ch = e.target.closest("[data-chip]");
    if (ch) { cState[ch.dataset.chip] = ch.dataset.val; LS.set("create", cState); ch.parentElement.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === ch))); return; }
    if (e.target.closest("#gen")) return generate();
    if (e.target.closest("#pack")) return pack();
    const o = e.target.closest("[data-out]");
    if (o) {
      const p = products.find(x => x.id === cState.p);
      if (o.dataset.out === "copy") copy(lastOut);
      if (o.dataset.out === "wa") window.open("https://wa.me/?text=" + encodeURIComponent(lastOut), "_blank");
      if (o.dataset.out === "share") navigator.share({ text: lastOut, url: p ? pageUrl(p) : SITE }).catch(() => {});
      return;
    }
    const cc = e.target.closest("[data-copy-code]"); if (cc) return copy(codeStore[cc.dataset.copyCode].code);
    const wc = e.target.closest("[data-wa-code]"); if (wc) return window.open("https://wa.me/?text=" + encodeURIComponent(codeStore[wc.dataset.waCode].code), "_blank");
    const dl = e.target.closest("[data-dl-code]");
    if (dl) {
      const c = codeStore[dl.dataset.dlCode];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([c.code], { type: "text/plain" }));
      a.download = "muse-code." + (EXT[c.lang] || "txt");
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    const pv = e.target.closest("[data-preview-code]");
    if (pv) {
      const slot = document.querySelector(`[data-preview-slot="${pv.dataset.previewCode}"]`);
      if (slot.firstChild) { slot.innerHTML = ""; return; }
      const f = document.createElement("iframe");
      f.className = "preview"; f.setAttribute("sandbox", "allow-scripts allow-forms"); f.title = "Preview";
      f.srcdoc = codeStore[pv.dataset.previewCode].code;
      slot.appendChild(f);
      return;
    }
    const st = e.target.closest("[data-starter]"); if (st) return send(st.dataset.starter);
    const cl = e.target.closest("[data-clear]");
    if (cl) { const c = LS.get("chats", {}); delete c[cl.dataset.clear]; LS.set("chats", c); render(); }
  });
  document.addEventListener("change", e => { if (e.target.id === "cp") { cState.p = e.target.value; lastOut = ""; LS.set("create", cState); $("#gen-out").innerHTML = ""; } });
  document.addEventListener("submit", async e => {
    if (e.target.id === "ask-form") {
      e.preventDefault();
      const i = $("#ask-input"), text = i.value.trim();
      if (!text || $("#ask-send").disabled) return;
      i.value = ""; i.style.height = "";
      return send(text);
    }
    if (e.target.id !== "signin") return;
    e.preventDefault();
    const f = e.target.elements, b = e.target.querySelector("button");
    b.disabled = true; b.textContent = "Signing in…";
    try {
      const r = await backend({ action: "login", email: f.email.value.trim(), password: f.password.value, remember: true });
      if (!r.ok) throw new Error({ wrong: "Wrong email or password.", locked: "Too many tries. Wait 15 minutes.", no_password: "Set your admin password first on the admin page." }[r.error] || r.error);
      session = r.session; LS.set("session", session);
      toast("Signed in ✓");
      render();
    } catch (err) { app.innerHTML = viewSignIn(err.message || "Couldn't sign in."); }
  });
  $("#ask-input").addEventListener("input", e => { e.target.style.height = "auto"; e.target.style.height = Math.min(140, e.target.scrollHeight) + "px"; });
  $("#signout").addEventListener("click", async () => {
    try { await backend({ action: "logout", session }); } catch (e) { /* offline */ }
    session = null; LS.set("session", null); render();
  });

  async function refreshAuto() {
    try { auto = await getJson("data/facebook-autopilot.json"); } catch (e) { /* offline */ }
    if (tab === "today") render();
  }

  // ------------------------------------------------------------------ start
  (async () => {
    checkVersion(true);
    try {
      const [b, p] = await Promise.all([getJson("data/business.json"), getJson("data/products.json")]);
      business = b; products = Array.isArray(p) ? p : (p.products || []);
      endpoint = b.enquiry_endpoint || null;
    } catch (e) { toast("Offline: using the saved copy.", 3000); }
    render();
    refreshAuto();
  })();
})();
