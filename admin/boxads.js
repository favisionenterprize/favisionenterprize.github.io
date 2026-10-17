// "📦 What's in the Box ads" screen (dashboard button, deep link #boxads).
// Grid of every product's box ad (scripts/make_box_ads.py → assets/images/ads/box/box-<id>.jpg and
// -story.jpg, rebuilt by rebuild-ads.yml after every data change) with Download, Copy caption
// (FAV_CAPTIONS.write(p, {box: true}) → quality gate), share buttons like Post now (Facebook Page, X,
// WhatsApp, TikTok), "Edit contents" for in_the_box (+ box_title, box_note) and a "✓ Confirmed" toggle
// (in_the_box_confirmed); deep link #boxads is opened by admin.js deepLink(). Edits save through FAV_ADMIN.commit; the ad image is redrawn by the workflow
// about two minutes later. The same ads rotate into igauto / socauto (kind "Box ad") and FB group posts.
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const C = () => window.FAV_CONFIG || {};
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, bad) => { if (A().toast) A().toast(m, bad); };
  const short = p => String(p.name).split(" — ")[0];
  const img = (p, story) => `../assets/images/ads/box/box-${String(p.id).toLowerCase()}${story ? "-story" : ""}.jpg`;
  const ICONS = ["panel", "glass", "frame", "legs", "chair", "plastic_chair", "office_chair", "armrest", "gaslift", "base", "castor", "cushion", "pillow",
    "drawers", "mirror", "stool", "door", "shelf", "sofa", "table", "base_table", "tv", "remote", "battery", "cable", "ac_in", "ac_out", "plate", "toilet",
    "cistern", "toilet_seat", "tiles", "cards", "ream", "sack", "roll", "footrest", "bowl", "tap", "mattress", "caps", "screws", "allen", "booklet", "carton"];
  let editing = null, filter = "all", busyNow = false, ver = Date.now();

  // ---------------------------------------------------------------- screen
  let screen = $("#screen-boxads");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-boxads"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>📦 What's in the Box ads</h1>
      <p class="muted">One "What's in the Box?" ad per product: download it, copy a ready caption or share it. Check each list of contents, fix it with <b>Edit contents</b>, then tick <b>✓ Confirmed</b>. The pictures redraw about 2 minutes after you save.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button></div></div>
      <div id="bx-body"><p class="muted">Loading…</p></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `#bx-body{display:grid;gap:14px}.bx-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.bx-filters{display:flex;gap:6px;flex-wrap:wrap}.bx-chip{border:1px solid #dadce0;background:#fff;border-radius:99px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}
.bx-chip[aria-pressed=true]{background:#e8f0fe;border-color:#0d55af;color:#0d55af}
.bx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.bx-card{background:#fff;border:1px solid #e3e7ee;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.bx-card>a img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;background:#000}
.bx-info{padding:10px 12px;display:grid;gap:8px}.bx-name{font-weight:600;line-height:1.3}.bx-meta{font-size:12px;color:#5f6368}
.bx-row{display:flex;flex-wrap:wrap;gap:6px}.bx-row .btn{flex:1 1 auto}
.bx-badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:99px;background:#fff2dc;color:#8a5300;font-weight:600}.bx-badge.ok{background:#e3f4ea;color:#1f7a45}
.bx-list{margin:0;padding-left:18px;font-size:13px;color:#3c4043}
.bx-edit{border-top:1px solid #eceff3;padding:10px 12px;display:grid;gap:8px;background:#f8fafd}
.bx-it{display:grid;grid-template-columns:1fr 58px 96px 30px;gap:4px}.bx-it input,.bx-it select,.bx-edit input[type=text],.bx-edit textarea{font:inherit;font-size:13px;padding:6px;border:1px solid #dadce0;border-radius:6px;min-width:0;box-sizing:border-box;width:100%}
.bx-edit textarea{min-height:52px}.bx-edit label{font-size:12px;color:#5f6368;display:grid;gap:3px}
.bx-conf{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600}`;
    document.head.appendChild(st);
  }
  if (!document.querySelector("[data-boxads]")) {   // dashboard button (admin/index.html normally has it)
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-boxads>📦 What's in the Box ads</button>`);
  }

  function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#boxads") history.replaceState(null, "", "#boxads");
    render();
  }

  const products = () => (A().products ? A().products() : []).filter(p => !p.placeholder);

  // ---------------------------------------------------------------- captions
  function caption(p, net) {
    const W = window.FAV_CAPTIONS;
    if (W && W.write) return W.write(p, { net: net || "share", box: true });
    const items = (p.in_the_box || []).map(x => `✅ ${x.item} ×${x.qty}`).join("\n");
    const wa = (p.seller && p.seller.whatsapp) || (A().business ? A().business().whatsapp : "") || "0572646176";
    const t = `📦 What's in the box? ${short(p)}\n\n${items}\n\n💰 ${C().formatPrice ? C().formatPrice(p.price_ghs) : p.price_ghs}\n📲 WhatsApp ${wa} to order.\n#FAVisionEnterprise #AccraFurniture`;
    return W && W.ensure ? W.ensure(t, p, { net: net || "share" }) : t;
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { window.prompt("Copy this:", t); return false; }
  }
  function download(p, story) {
    const a = document.createElement("a");
    a.href = img(p, story); a.download = `fa-vision-box-${p.id}${story ? "-story" : ""}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function share(kind, p) {
    const page = location.origin + "/p/" + p.id + ".html";
    if (kind === "x") return window.open("https://x.com/intent/post?text=" + encodeURIComponent(caption(p, "x")), "_blank", "noopener");
    if (kind === "wa") return window.open("https://wa.me/?text=" + encodeURIComponent(caption(p, "share")), "_blank", "noopener");
    if (kind === "native" && navigator.share) {
      try {
        const blob = await fetch(img(p)).then(r => r.blob());
        const file = new File([blob], `fa-vision-box-${p.id}.jpg`, { type: "image/jpeg" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) return await navigator.share({ files: [file], text: caption(p, "share") });
      } catch (e) { /* dismissed or not allowed: fall through to copy */ }
    }
    await copyText(caption(p, kind === "tt" ? "tiktok" : kind === "ig" ? "ig" : "share"));
    if (kind === "copy") return toast("Caption copied ✓");
    if (kind === "page") { window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(page), "_blank", "width=680,height=640"); return toast("Caption copied: choose “Share to a Page”, paste it, then Post."); }
    if (kind === "tt") { download(p); window.open("https://www.tiktok.com/tiktokstudio/upload", "_blank", "noopener"); return toast("Caption copied and box ad saved: add them in TikTok Studio (Photos)."); }
    toast("Caption copied ✓");
  }

  // ---------------------------------------------------------------- saving
  async function save(id, change, message) {
    if (busyNow) return false;
    busyNow = true;
    try {
      await A().commit({ message, mutate: list => list.map(p => p.id === id ? change(JSON.parse(JSON.stringify(p))) : p) });
      toast("Saved ✓ The box ad redraws in about 2 minutes.");
      if (A().refreshDash) A().refreshDash();
      return true;
    } catch (err) {
      toast(A().friendly ? A().friendly(err) : String(err), true);
      return false;
    } finally {
      busyNow = false;
    }
  }
  function readEditor(card) {
    const items = [...card.querySelectorAll(".bx-it")].map(r => {
      const q = r.querySelector("[data-q]").value.trim();
      return { item: r.querySelector("[data-i]").value.trim(), qty: /^\d+$/.test(q) ? Number(q) : (q || 1), icon: r.querySelector("[data-c]").value };
    }).filter(x => x.item);
    return { items, title: card.querySelector("[data-bx-title]").value.trim(), note: card.querySelector("[data-bx-note]").value.trim() };
  }

  // ---------------------------------------------------------------- render
  function itemRow(x) {
    return `<div class="bx-it"><input data-i value="${esc(x.item || "")}" placeholder="Item" aria-label="Item">
      <input data-q value="${esc(x.qty == null ? 1 : x.qty)}" aria-label="Quantity">
      <select data-c aria-label="Icon">${ICONS.map(n => `<option ${n === (x.icon || "carton") ? "selected" : ""}>${n}</option>`).join("")}</select>
      <button class="btn btn-ghost btn-sm" type="button" data-bx-del aria-label="Remove">×</button></div>`;
  }
  function card(p) {
    const items = p.in_the_box || [];
    const ok = !!p.in_the_box_confirmed;
    const open = editing === p.id;
    return `<article class="bx-card" data-id="${esc(p.id)}">
      <a href="${esc(img(p))}?v=${ver}" target="_blank" rel="noopener"><img src="${esc(img(p))}?v=${ver}" alt="What's in the box: ${esc(short(p))}" loading="lazy" onerror="this.style.opacity=.2"></a>
      <div class="bx-info">
        <div class="bx-name">${esc(short(p))} <span class="bx-badge ${ok ? "ok" : ""}">${ok ? "✓ Confirmed" : "To check"}</span></div>
        <div class="bx-meta">${esc(p.id)} · ${esc(p.box_title || "What's in the Box?")}${p.seller ? " · sold by " + esc(p.seller.name) : ""}</div>
        ${items.length ? `<ul class="bx-list">${items.map(x => `<li>${esc(x.item)} ×${esc(x.qty)}${x.guess && !ok ? " <span class='bx-meta'>(guess)</span>" : ""}</li>`).join("")}</ul>` : `<p class="bx-meta">No contents yet: tap Edit contents.</p>`}
        <div class="bx-row"><button class="btn btn-ghost btn-sm" data-bx="dl">⬇ Download</button><button class="btn btn-ghost btn-sm" data-bx="dls">⬇ Story</button><button class="btn btn-ghost btn-sm" data-bx="copy">Copy caption</button></div>
        <div class="bx-row share-row"><button class="btn btn-ghost btn-sm" data-bx="page">Facebook Page</button><button class="btn btn-ghost btn-sm" data-bx="x">X</button><button class="btn btn-ghost btn-sm" data-bx="wa">WhatsApp</button><button class="btn btn-ghost btn-sm" data-bx="tt">TikTok</button>${navigator.share ? `<button class="btn btn-ghost btn-sm" data-bx="native">Share…</button>` : ""}</div>
        <div class="bx-row"><button class="btn btn-sm ${open ? "btn-ghost" : "btn-primary"}" data-bx="edit">${open ? "Close" : "Edit contents"}</button>
          <label class="bx-conf"><input type="checkbox" data-bx-confirm ${ok ? "checked" : ""}> ✓ Confirmed</label></div>
      </div>
      ${open ? `<div class="bx-edit">
        <label>Title<input type="text" data-bx-title value="${esc(p.box_title || "")}" placeholder="What's in the Box? (or Bag / Pack / Carton)"></label>
        <div data-bx-items>${(items.length ? items : [{ item: "", qty: 1, icon: "carton" }]).map(itemRow).join("")}</div>
        <button class="btn btn-ghost btn-sm" type="button" data-bx="add">+ Add item</button>
        <label>How it's packaged &amp; delivered (optional)<textarea data-bx-note>${esc(p.box_note || "")}</textarea></label>
        <div class="bx-row"><button class="btn btn-ok btn-sm" data-bx="save">Save contents</button><button class="btn btn-ghost btn-sm" data-bx="saveok">Save &amp; mark confirmed</button></div>
      </div>` : ""}
    </article>`;
  }
  function render() {
    const body = $("#bx-body"); if (!body) return;
    const all = products().filter(p => (p.images || []).length).sort((a, b) => (b.id === "FAV-014") - (a.id === "FAV-014"));   // the desk set leads
    const todo = all.filter(p => !p.in_the_box_confirmed).length;
    const list = all.filter(p => filter === "all" || (filter === "todo" ? !p.in_the_box_confirmed : p.in_the_box_confirmed));
    body.innerHTML = `<div class="bx-top"><p class="muted" style="margin:0"><b>${all.length}</b> box ads · <b>${todo}</b> still to check · ${all.length - todo} confirmed</p>
      <div class="bx-filters">${[["all", "All"], ["todo", "To check"], ["ok", "Confirmed"]].map(([k, l]) => `<button class="bx-chip" data-bx-filter="${k}" aria-pressed="${filter === k}">${l}</button>`).join("")}</div></div>
      <div class="bx-grid">${list.map(card).join("") || `<p class="muted">Nothing here.</p>`}</div>`;
  }

  // ---------------------------------------------------------------- events
  document.addEventListener("click", async e => {
    if (e.target.closest("[data-boxads]")) { e.preventDefault(); show(); return; }
    if (!screen.contains(e.target)) return;
    const f = e.target.closest("[data-bx-filter]");
    if (f) { filter = f.dataset.bxFilter; render(); return; }
    const cardEl = e.target.closest(".bx-card");
    const p = cardEl && products().find(x => x.id === cardEl.dataset.id);
    if (e.target.closest("[data-bx-del]")) { e.target.closest(".bx-it").remove(); return; }
    const b = e.target.closest("[data-bx]");
    if (!b || !p) return;
    const k = b.dataset.bx;
    if (k === "dl") return download(p);
    if (k === "dls") return download(p, true);
    if (k === "edit") { editing = editing === p.id ? null : p.id; render(); return; }
    if (k === "add") { cardEl.querySelector("[data-bx-items]").insertAdjacentHTML("beforeend", itemRow({ item: "", qty: 1, icon: "carton" })); return; }
    if (k === "save" || k === "saveok") {
      const ed = readEditor(cardEl);
      if (!ed.items.length) return toast("Add at least one item.", true);
      b.disabled = true;
      const done = await save(p.id, q => {
        q.in_the_box = ed.items;
        if (ed.title) q.box_title = ed.title; else delete q.box_title;
        if (ed.note) q.box_note = ed.note; else delete q.box_note;
        q.in_the_box_confirmed = k === "saveok" ? true : !!q.in_the_box_confirmed;
        return q;
      }, `What's in the box: ${p.id} contents${k === "saveok" ? " (confirmed)" : ""}`);
      if (done) { editing = null; ver = Date.now(); }
      render();
      return;
    }
    return share(k, p);
  });
  document.addEventListener("change", async e => {
    const c = e.target.closest && e.target.closest("[data-bx-confirm]");
    if (!c || !screen.contains(c)) return;
    const id = c.closest(".bx-card").dataset.id, on = c.checked;
    await save(id, q => { q.in_the_box_confirmed = on; if (on) (q.in_the_box || []).forEach(x => delete x.guess); return q; }, `What's in the box: ${id} ${on ? "confirmed" : "marked to check"}`);
    render();
  });
  window.FAV_BOXADS = { show, render, caption };
})();
