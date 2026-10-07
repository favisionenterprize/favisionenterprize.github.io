// Seek (admin → Seek): fresh photos and copy from the web for the products on the website.
// Press Seek → the backend searches free-to-use photo libraries (Openverse public domain/CC0,
// Pexels) and asks the AI, with web search, for new descriptions held to the product's own
// facts. You look at everything first; nothing changes on the website until you tick what
// you like and press "Approve & publish". Approved photos go first in the product's gallery
// (the "recycling": older photos move back, and anything past 10 drops off the website,
// though the file is kept). Approved texts can replace the website description and are kept
// as extra post texts that the social posts rotate through (admin/captions.js).
// Log: data/seek.json { runs: [{ d, pid, images, texts }], approved: [{ d, pid, kind, ... }] }.
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  const $ = s => document.querySelector(s);
  const screen = $("#screen-seek");
  if (!A || !screen) return;
  const esc = C.escapeHtml;
  const FILE = "data/seek.json";
  const EMPTY = { runs: [], approved: [] };
  const MAX_PHOTOS = 10;
  const REMIND_DAYS = 14;
  const today = () => new Date().toLocaleDateString("en-CA");
  const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const short = p => String(p.name).split(" — ")[0];
  const RAW = "../";
  let log = null, pid = null, query = "", res = null, busyNow = false;
  let pick = { imgs: new Set(), drop: new Set(), desc: -1, hl: new Set(), keep: true };

  async function loadLog(force) {
    if (!log || force) { log = await A.readJsonFile(FILE, EMPTY); log.runs = log.runs || []; log.approved = log.approved || []; }
    return log;
  }
  const lastSeek = id => log && log.runs.filter(r => !id || r.pid === id).map(r => r.d).sort().pop();
  const products = () => A.products().filter(p => !p.placeholder);
  const productOf = id => products().find(p => p.id === id);
  // Next product to refresh: never sought first, then the longest ago, then fewest photos.
  function nextProduct() {
    return products().slice().sort((a, b) => (lastSeek(a.id) || "").localeCompare(lastSeek(b.id) || "") || (a.images || []).length - (b.images || []).length)[0];
  }
  function defaultQuery(p) {
    const colour = [].concat(p.colors || [])[0] || "";
    const mat = String(p.material || "").split(/[,;]/)[0].replace(/\b(top|frame|base|legs?)\b/gi, "").trim();
    return [colour, mat, p.type || short(p)].filter(Boolean).join(" ").replace(/\s+/g, " ").toLowerCase().slice(0, 80);
  }
  function updateBadge() {
    const b = $("#seek-badge");
    if (!b || !log) return;
    const last = lastSeek();
    const due = !last || days(last, today()) >= REMIND_DAYS;
    b.hidden = !due; b.textContent = "!";
    b.title = due ? "Time to refresh your photos and descriptions" : "";
  }

  // ------------------------------------------------------------------ search
  async function seek() {
    const p = productOf(pid);
    if (!p || busyNow) return;
    busyNow = true; res = null;
    pick = { imgs: new Set(), drop: new Set(), desc: -1, hl: new Set(), keep: true };
    render();
    try {
      const r = await A.backendSigned({ action: "seek", query: query || defaultQuery(p), product: {
        name: p.name, type: p.type, category: p.category, material: p.material, dimensions: p.dimensions, colors: p.colors,
        price_ghs: p.price_ghs, condition: p.condition, description: p.description, highlights: p.highlights, seller: p.seller ? { name: p.seller.name } : null } });
      if (!r.ok) throw new Error(r.error === "no_session" ? "Seek needs the email sign-in (sign out, then sign in with your email and password)." : r.error === "busy" ? "Seek is busy, try again in a few minutes." : r.error === "signed_out" ? "Your sign-in expired: sign in again." : (r.error || "Seek failed"));
      const seen = new Set((p.image_credits || []).map(c => c.page).filter(Boolean));
      r.images = (r.images || []).filter(x => x.url && !seen.has(x.page));
      res = r;
      try {
        await A.saveJson(FILE, s => { s = { ...EMPTY, ...s }; s.runs = (s.runs || []).concat([{ d: today(), pid: p.id, q: r.query, images: r.images.length, texts: (r.descriptions || []).length }]).slice(-500); return s; }, `Seek: ${p.id}`, EMPTY);
        await loadLog(true);
      } catch (e) { /* the log is only a reminder */ }
    } catch (err) { res = { error: A.friendly ? A.friendly(err) : String(err) }; }
    finally { busyNow = false; render(); updateBadge(); }
  }

  // ------------------------------------------------------------------ approve
  function toJpeg(b64, type) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/jpeg", 0.86).split(",")[1]);
      };
      img.onerror = () => fail(new Error("The photo couldn't be read"));
      img.src = `data:${type};base64,${b64}`;
    });
  }
  async function approve() {
    const p = productOf(pid);
    if (!p || !res) return;
    const chosen = [...pick.imgs].map(i => res.images[i]).filter(Boolean);
    const desc = pick.desc >= 0 ? res.descriptions[pick.desc] : null;
    const hls = [...pick.hl].map(i => res.highlights[i]).filter(Boolean);
    const extras = pick.keep ? (res.descriptions || []).filter(d => d !== desc) : [];
    if (!chosen.length && !pick.drop.size && !desc && !hls.length && !extras.length) return A.toast("Tick at least one photo or text first.", true);
    A.busy("Downloading the photos you approved…");
    try {
      const stamp = Date.now().toString(36), uploads = [], credits = [];
      for (let i = 0; i < chosen.length; i++) {
        A.busy(`Downloading photo ${i + 1} of ${chosen.length}…`);
        const f = await A.backendSigned({ action: "seek_fetch", url: chosen[i].url });
        if (!f.ok) { A.toast(`One photo couldn't be downloaded (${f.error}); skipped.`, true); continue; }
        const path = `assets/images/products/${p.id.toLowerCase()}-web-${stamp}-${i + 1}.jpg`;
        uploads.push({ path, b64: await toJpeg(f.b64, f.type) });
        credits.push({ path, src: chosen[i].src, creator: chosen[i].creator || "", page: chosen[i].page || "", license: chosen[i].license || "" });
      }
      const newPaths = uploads.map(u => u.path);
      const drop = new Set([...pick.drop]);
      await A.commit({
        uploads,
        message: `Seek: refresh ${p.id} (${plural(newPaths.length, "new photo")}${desc ? ", new description" : ""})`,
        mutate: all => all.map(x => {
          if (x.id !== p.id) return x;
          const kept = (x.images || []).filter(src => !drop.has(src));
          const images = newPaths.concat(kept).slice(0, MAX_PHOTOS);
          const next = { ...x, images };
          const cr = (x.image_credits || []).concat(credits).filter(c => images.includes(c.path));
          if (cr.length) next.image_credits = cr; else delete next.image_credits;
          if (desc) next.description = desc;
          if (hls.length) next.highlights = [...new Set(hls.concat(x.highlights || []))].slice(0, 6);
          if (extras.length || desc) next.copy_variants = [...new Set([].concat(extras, desc && x.description ? [x.description] : [], x.copy_variants || []))].filter(t => t !== next.description).slice(0, 8);
          return next;
        })
      });
      try {
        await A.saveJson(FILE, s => {
          s = { ...EMPTY, ...s };
          const add = credits.map(c => ({ d: today(), pid: p.id, kind: "photo", ...c }))
            .concat(desc ? [{ d: today(), pid: p.id, kind: "description" }] : [], hls.length ? [{ d: today(), pid: p.id, kind: "highlights", n: hls.length }] : []);
          s.approved = (s.approved || []).concat(add).slice(-1000);
          return s;
        }, `Seek: approved for ${p.id}`, EMPTY);
        await loadLog(true);
      } catch (e) { /* log only */ }
      A.toast(`Published ✓ ${[newPaths.length && plural(newPaths.length, "new photo"), drop.size && `${plural(drop.size, "photo")} taken off`, desc && "new description", hls.length && "new highlights", extras.length && "extra post texts saved"].filter(Boolean).join(", ")}. The website updates in about a minute; the ads and listings rebuild by themselves.`);
      res = null; pick.drop.clear();
      if (A.refreshDash) A.refreshDash();
    } catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); render(); }
  }

  // ------------------------------------------------------------------ screen
  function render() {
    const body = $("#seek-body");
    if (!body) return;
    const list = products();
    if (!pid || !productOf(pid)) { const n = nextProduct(); pid = n && n.id; query = ""; }
    const p = productOf(pid);
    if (!p) { body.innerHTML = `<p class="muted">No products yet.</p>`; return; }
    const last = lastSeek(p.id), lastAny = lastSeek();
    const imgs = p.images || [];
    const credit = path => (p.image_credits || []).find(c => c.path === path);
    let out = `<section class="fa-card">
      <header><h2>Seek fresh photos and descriptions</h2>${lastAny ? `<span class="muted fa-small">Last seek: ${esc(lastAny)}</span>` : ""}</header>
      <p class="muted">Pick a product and press <b>Seek</b>. Photos come from free-to-use libraries (Openverse public-domain photos, and Pexels once its free key is added), so you're allowed to use them on your website. Descriptions are researched on the web but kept to your own product facts. <b>Nothing changes until you approve.</b> Seek every ${REMIND_DAYS} days or so to keep the website fresh.</p>
      <div class="seek-bar">
        <label>Product <select id="seek-product">${list.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? "selected" : ""}>${esc(x.id)} · ${esc(short(x))}${lastSeek(x.id) ? "" : " · never sought"}</option>`).join("")}</select></label>
        <label>Search words <input id="seek-query" type="text" value="${esc(query || defaultQuery(p))}" maxlength="80"></label>
        <button class="btn btn-sell" id="seek-go" ${busyNow ? "disabled" : ""}>${busyNow ? "Seeking…" : "🔎 Seek"}</button>
        <button class="btn btn-ghost" id="seek-next" ${busyNow ? "disabled" : ""}>Next product due</button>
      </div>
      <p class="muted fa-small">${last ? `${esc(p.id)} was last sought on ${esc(last)}.` : `${esc(p.id)} has never been sought.`} ${plural(imgs.length, "photo")} on the website now (max ${MAX_PHOTOS}).</p>
    </section>
    <section class="fa-card">
      <header><h2>On the website now</h2><span class="muted fa-small">Tick a photo to take it off when you approve</span></header>
      <div class="seek-grid">${imgs.map(src => `<label class="seek-img ${pick.drop.has(src) ? "drop" : ""}"><img src="${esc(/^https?:/.test(src) ? src : RAW + src)}" alt="" loading="lazy"><span><input type="checkbox" data-seek-drop="${esc(src)}" ${pick.drop.has(src) ? "checked" : ""}> Take off${credit(src) ? ` · ${esc(credit(src).src)}` : ""}</span></label>`).join("") || `<p class="muted">No photos yet.</p>`}</div>
      <p class="seek-desc"><b>Description:</b> ${esc(p.description || "")}</p>
    </section>`;
    if (busyNow) out += `<section class="fa-card"><p>Searching the web for ${esc(short(p))}… this takes 10–30 seconds.</p></section>`;
    else if (res && res.error) out += `<section class="fa-card"><p class="fa-ext bad">${esc(res.error)}</p></section>`;
    else if (res) {
      const notes = (res.notes || []).filter(n => n !== "no_pexels_key" && n !== "no_ai_key");
      out += `<section class="fa-card">
        <header><h2>Photos found</h2><span class="fa-big">${res.images.length}</span></header>
        <p class="muted fa-small">Tick only the ones that really look like your ${esc(short(p).toLowerCase())}. Approved photos go first on the website.${(res.notes || []).includes("no_pexels_key") ? " Tip: add a free Pexels key (Script property PEXELS_API_KEY) for many more furniture photos." : ""}</p>
        <div class="seek-grid">${res.images.map((x, i) => `<label class="seek-img ${pick.imgs.has(i) ? "on" : ""}"><img src="${esc(x.thumb)}" alt="${esc(x.title || "")}" loading="lazy" referrerpolicy="no-referrer"><span><input type="checkbox" data-seek-img="${i}" ${pick.imgs.has(i) ? "checked" : ""}> ${esc(x.src)} · ${esc(x.license)}${x.page ? ` · <a href="${esc(x.page)}" target="_blank" rel="noopener">source</a>` : ""}</span></label>`).join("") || `<p class="muted">No photos found for “${esc(res.query)}”. Try simpler search words (e.g. “${esc(p.type || short(p))}”).</p>`}</div>
      </section>
      <section class="fa-card">
        <header><h2>New descriptions</h2></header>
        ${(res.descriptions || []).length ? `<div class="seek-texts">
          <label class="seek-text"><input type="radio" name="seek-desc" value="-1" ${pick.desc === -1 ? "checked" : ""}> Keep the current website description</label>
          ${res.descriptions.map((t, i) => `<label class="seek-text"><input type="radio" name="seek-desc" value="${i}" ${pick.desc === i ? "checked" : ""}> ${esc(t)}</label>`).join("")}
        </div>
        ${(res.highlights || []).length ? `<p><b>Highlights</b> <small class="muted">(tick to add)</small></p><div class="seek-hl">${res.highlights.map((h, i) => `<label class="fa-check"><input type="checkbox" data-seek-hl="${i}" ${pick.hl.has(i) ? "checked" : ""}> ${esc(h)}</label>`).join("")}</div>` : ""}
        <label class="fa-check"><input type="checkbox" id="seek-keep" ${pick.keep ? "checked" : ""}> Keep the other descriptions as extra texts for social posts (they rotate so posts don't repeat)</label>
        ${(res.sources || []).length ? `<p class="muted fa-small">Researched on: ${res.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || (String(s.url).split("/")[2] || "link"))}</a>`).join(" · ")}</p>` : ""}`
        : `<p class="muted">${(res.notes || []).includes("no_ai_key") ? "No AI key is set on your backend yet, so no new texts. Add GEMINI_API_KEY (free at aistudio.google.com) in Apps Script → Project settings → Script properties." : "No new texts this time."}</p>`}
        ${notes.length ? `<p class="muted fa-small">${esc(notes.join(" · "))}</p>` : ""}
      </section>
      <section class="fa-card seek-approve">
        <p><b>Your choice:</b> ${plural(pick.imgs.size, "new photo")}, ${plural(pick.drop.size, "photo")} off, ${pick.desc >= 0 ? "new description" : "same description"}, ${plural(pick.hl.size, "highlight")}.</p>
        <div class="fa-actions">
          <button class="btn btn-sell" id="seek-approve">✓ Approve & publish</button>
          <button class="btn btn-ghost" id="seek-discard">Discard all</button>
        </div>
      </section>`;
    }
    body.innerHTML = out;
  }

  async function open() {
    A.show("seek");
    if (location.hash !== "#seek") history.replaceState(null, "", "#seek");
    $("#seek-body").innerHTML = `<p class="muted">Loading…</p>`;
    try { await loadLog(); } catch (e) { log = { ...EMPTY }; }
    render(); updateBadge();
  }

  document.addEventListener("click", e => {
    const b = e.target.closest("[data-seek]");
    if (b) { e.preventDefault(); return open(); }
    if (screen.hidden) return;
    if (e.target.closest("#seek-go")) { query = ($("#seek-query") || {}).value || ""; return seek(); }
    if (e.target.closest("#seek-next")) { const n = nextProduct(); pid = n && n.id; query = ""; res = null; return render(); }
    if (e.target.closest("#seek-approve")) return approve();
    if (e.target.closest("#seek-discard")) { res = null; pick.drop.clear(); return render(); }
  });
  screen.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "seek-product") { pid = t.value; query = ""; res = null; pick.drop.clear(); return render(); }
    if (t.id === "seek-query") { query = t.value; return; }
    if (t.dataset.seekImg != null) { const i = +t.dataset.seekImg; t.checked ? pick.imgs.add(i) : pick.imgs.delete(i); return render(); }
    if (t.dataset.seekDrop != null) { const s = t.dataset.seekDrop; t.checked ? pick.drop.add(s) : pick.drop.delete(s); return render(); }
    if (t.dataset.seekHl != null) { const i = +t.dataset.seekHl; t.checked ? pick.hl.add(i) : pick.hl.delete(i); return render(); }
    if (t.name === "seek-desc") { pick.desc = +t.value; return render(); }
    if (t.id === "seek-keep") { pick.keep = t.checked; return; }
  });

  const wait = setInterval(async () => {
    if (!A.signedIn() || !A.products().length) return;
    clearInterval(wait);
    try { await loadLog(); updateBadge(); } catch (e) { /* ignore */ }
    if (location.hash === "#seek") open();
  }, 400);
  setTimeout(() => clearInterval(wait), 60000);

  window.FAV_SEEK = { open, _test: { set: (l, r, id) => { log = l; res = r; pid = id; }, render, approve, pick: () => pick, defaultQuery } };
})();
