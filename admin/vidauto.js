// Videos & YouTube (Social autopilot → "Videos & YouTube" tab).
// Every video (Shorts made by scripts/make_shorts.py, old TikTok videos and anything you add
// from your computer or phone) waits here until you post it:
//   - Website: shows it on favisionenterprize.github.io/videos/ (or takes it off again);
//   - YouTube: the FA Vision add-on uploads it in YouTube Studio (extension/youtube.js), or
//     mark it posted if you uploaded it yourself;
//   - TikTok: copies a fresh description, downloads the video and opens TikTok Studio.
// Each posting gets a new description with a call to action (admin/captions.js), so no two
// posts read the same. Library: data/videos.json { videos: [...], removed: [ids] }.
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/videos.json";
  const EMPTY = { videos: [], removed: [] };
  const MAX_MB = 20;   // per video: the upload goes through your backend, which can't take much more
  const F = () => window.FAV_FBAUTO;
  const CAP = () => window.FAV_CAPTIONS;
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const NETS = { website: "Website", youtube: "YouTube", tiktok: "TikTok" };
  const SRC = { all: "All", tiktok: "My TikTok videos", generated: "Made from ads", upload: "Added by me" };
  let S = null, view = "waiting", src = "all", armed = null;
  const drafts = {};   // id → { text, edited }: the description shown on each card (a fresh one after every posting)

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    s.videos = (s.videos || []).map(v => ({ ...v, website: v.website || { status: "waiting" }, youtube: v.youtube || { status: "waiting" }, tiktok: v.tiktok || { status: "waiting" } }));
    s.removed = s.removed || [];
    return s;
  }
  async function load(force) { if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY)); return S; }
  async function save(mutate, message) { S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY)); }
  const rerender = () => { if (F() && F().render) F().render(); };
  const product = v => (v.product && A.products().find(p => p.id === v.product)) || null;
  const isStudio = v => /^ai-studio/.test(v.id);
  const junkName = t => !t || /^(vid|img|video|pxl|mov|snaptik|ssstik|tiktok)?[\s_-]*\d[\d\s_-]*$/i.test(String(t).replace(/\.\w+$/, "")) || /^[0-9a-f]{12,}$/i.test(t);

  // ------------------------------------------------------------------ descriptions (fresh each time)
  function describe(v, net) {
    const p = product(v);
    return CAP() ? CAP().write(p, { net, studio: isStudio(v), subject: p ? null : (junkName(v.title) ? null : v.title) }) : (v.description || "");
  }
  function draft(v) {
    if (!drafts[v.id]) drafts[v.id] = { text: describe(v, "tiktok"), edited: false };
    return drafts[v.id];
  }
  // The text for one posting: your own edits if you changed the box (plus a call to action if it
  // has none), otherwise a brand-new description written for that network.
  function textFor(v, net) {
    const d = draft(v);
    if (!d.edited) return describe(v, net);
    const t = d.text.trim();
    return /whatsapp|call|\b0\d{2}\s?\d{3}\s?\d{4}\b|order|dm us/i.test(t) || !CAP() ? t : t + "\n\n" + CAP().cta(product(v), { net });
  }
  function titleFor(v, net) {
    if (!junkName(v.title) && v.source !== "generated") return String(v.title).slice(0, 100);
    return CAP() ? CAP().title(product(v), { net, studio: isStudio(v) }) : String(v.title || "F.A Vision Enterprise").slice(0, 100);
  }
  const reroll = v => { drafts[v.id] = { text: describe(v, "tiktok"), edited: false }; };

  // ------------------------------------------------------------------ adding videos from the computer / phone
  const toB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
  function grabFrame(f) {
    return new Promise(res => {
      const url = URL.createObjectURL(f), vid = document.createElement("video");
      const done = x => { clearTimeout(t); URL.revokeObjectURL(url); res(x); };
      const t = setTimeout(() => done(null), 8000);
      vid.muted = true; vid.preload = "auto"; vid.playsInline = true; vid.src = url;
      vid.onloadeddata = () => { vid.currentTime = Math.min(1, (vid.duration || 2) / 3); };
      vid.onseeked = () => {
        try {
          const w = 540, h = Math.round(w * (vid.videoHeight || 960) / (vid.videoWidth || 540));
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(vid, 0, 0, w, h);
          done(c.toDataURL("image/jpeg", 0.8).split(",")[1]);
        } catch (e) { done(null); }
      };
      vid.onerror = () => done(null);
    });
  }
  const slug = s => String(s).replace(/\.\w+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";

  async function addFiles(list) {
    const form = document.getElementById("vid-add");
    const source = (form && form.source.value) || "tiktok";
    const pid = (form && form.product.value) || "";
    const files = [...list].filter(f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    const big = files.filter(f => f.size > MAX_MB * 1048576);
    const ok = files.filter(f => f.size <= MAX_MB * 1048576);
    if (!files.length) return A.toast("Pick video files (MP4, MOV or WEBM).", true);
    let added = 0;
    try {
      for (let i = 0; i < ok.length; i++) {
        const f = ok[i];
        A.busy(`Adding ${f.name} (${i + 1} of ${ok.length})…`);
        const ext = ((f.name.match(/\.(mp4|mov|m4v|webm)$/i) || [, "mp4"])[1]).toLowerCase();
        const base = `${slug(f.name)}-${Date.now().toString(36)}`;
        const [b64, poster] = await Promise.all([toB64(f), grabFrame(f)]);
        const up = [{ path: `assets/videos/uploads/${base}.${ext}`, b64, label: f.name }];
        if (poster) up.push({ path: `assets/videos/uploads/${base}.jpg`, b64: poster, label: f.name + " (cover)" });
        const p = pid && A.products().find(x => x.id === pid);
        const entry = {
          id: base, title: junkName(f.name) ? "" : f.name.replace(/\.\w+$/, "").replace(/[_-]+/g, " ").trim(),
          description: "", file: up[0].path, poster: poster ? up[1].path : (p && p.images && p.images[0]) || "",
          product: pid || null, kind: "video", source, created: today(), size_mb: +(f.size / 1048576).toFixed(1),
          website: { status: "waiting" }, youtube: { status: "waiting" }, tiktok: source === "tiktok" ? { status: "posted", d: "before" } : { status: "waiting" }
        };
        S = normalise(await A.commitFiles({ files: up, jsonPath: FILE, fallback: EMPTY, message: `Videos: add ${f.name}`, mutate: s => { s = normalise(s); s.videos.push(entry); return s; } }));
        added++;
      }
    } catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); }
    view = "waiting"; rerender();
    const msg = [added && `${plural(added, "video")} added ✓ They wait here until you post them.`, big.length && `${plural(big.length, "video")} skipped: bigger than ${MAX_MB} MB (${big.map(f => f.name).join(", ")}). Trim or compress them (e.g. in CapCut, export 720p), then add again.`].filter(Boolean).join(" ");
    if (msg) A.toast(msg, !added);
  }

  // ------------------------------------------------------------------ posting
  async function setNet(id, net, rec, msg) {
    await save(s => { const v = s.videos.find(x => x.id === id); if (v) v[net] = { ...rec, d: today() }; return s; }, msg);
  }
  async function toWebsite(v, on) {
    A.busy(on ? "Putting the video on your website…" : "Taking the video off your website…");
    try {
      if (on) await setNet(v.id, "website", { status: "posted", title: titleFor(v, "website"), description: textFor(v, "share") }, `Videos: show ${v.id} on the website`);
      else await setNet(v.id, "website", { status: "waiting" }, `Videos: hide ${v.id} from the website`);
      reroll(v);
      A.toast(on ? "On your website ✓ (live at /videos/ in about a minute)" : "Taken off the website ✓");
    } catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); rerender(); }
  }
  const shellOk = () => {
    const v = String(document.documentElement.dataset.favautoShell || "0").split(".").map(Number);
    return v[0] > 5 || (v[0] === 5 && (v[1] || 0) >= 1);
  };
  function toYouTube(ids, dry) {
    const fb = F();
    if (!fb || !fb.launch) return;
    if (fb.needExt()) return;
    if (!fb.liveAddon()) return A.toast("YouTube needs the add-on's automatic updates switched on (Today tab, top).", true);
    if (!shellOk()) return A.toast("Reload the add-on once in edge://extensions (it needs permission for YouTube), then refresh this page and try again.", true);
    const vids = ids.map(id => S.videos.find(v => v.id === id)).filter(Boolean);
    if (!vids.length) return A.toast("No videos to upload.", true);
    const q = vids.map(v => ({ k: v.id, file: location.origin + "/" + v.file, title: titleFor(v, "youtube"), description: textFor(v, "youtube") }));
    vids.forEach(reroll);
    fb.launch("https://www.youtube.com/upload", { kind: "youtube", q: dry ? q.slice(0, 1) : q, dry: !!dry, then: null });
  }
  async function receive(out) {
    const res = out.res || [];
    if (out.dry) return { text: out.stopped ? "YouTube test: " + out.stopped : res[0] && res[0].ok ? "YouTube test passed ✓ The upload window opened; nothing was uploaded." : "YouTube test failed: " + ((res[0] && res[0].why) || "no result"), bad: !(res[0] && res[0].ok) };
    if (res.length) {
      await save(s => {
        for (const r of res) {
          const v = s.videos.find(x => x.id === r.k);
          if (v) v.youtube = r.ok ? { status: "posted", url: r.url || "", d: today() } : { status: "failed", why: r.why || "", d: today() };
        }
        return s;
      }, `Videos: YouTube results (${res.filter(r => r.ok).length}/${res.length})`);
    }
    const ok = res.filter(r => r.ok).length;
    return { text: `YouTube: ${ok} of ${plural(res.length, "video")} published${out.stopped ? ". " + out.stopped : " ✓"}`, bad: !!out.stopped || ok < res.length };
  }
  async function copy(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok; }
  }
  async function toTikTok(v) {
    await copy(textFor(v, "tiktok"));
    const a = document.createElement("a");
    a.href = "../" + v.file; a.download = v.file.split("/").pop();
    document.body.appendChild(a); a.click(); a.remove();
    window.open("https://www.tiktok.com/tiktokstudio/upload?from=webapp", "_blank", "noopener");
    reroll(v); rerender();
    A.toast("Description copied ✓ and the video is downloading. In TikTok Studio: Select video → pick it → paste the description → Post. Then tap “Mark posted on TikTok” (under More). Tip: it already has an Afrobeat + voice-over; to ride a trend, tap Sounds in TikTok and add a hit at low volume.");
  }

  // ------------------------------------------------------------------ screen
  function badge(v, net) {
    const r = v[net];
    if (r.status === "posted") return `<span class="vid-tag ok">✓ ${NETS[net]}${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">open</a>` : ""}</span>`;
    if (r.status === "failed") return `<span class="vid-tag bad" title="${esc(r.why || "")}">✗ ${NETS[net]}</span>`;
    return `<span class="vid-tag">${NETS[net]}: waiting</span>`;
  }
  const productOptions = sel => A.products().map(x => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.id)} · ${esc(String(x.name).split(" — ")[0])}</option>`).join("");
  function card(v) {
    const p = product(v), d = draft(v);
    return `<article class="vid-card" data-vid-card="${esc(v.id)}">
      <video src="../${esc(v.file)}" ${v.poster ? `poster="../${esc(v.poster)}"` : ""} controls preload="none" playsinline></video>
      <div class="vid-info">
        <h3>${esc(junkName(v.title) ? (p ? String(p.name).split(" — ")[0] : "Video " + (v.created || "")) : v.title)}</h3>
        <p class="muted fa-small">${esc(SRC[v.source] || v.source || "")} · ${esc(v.created || "")}${p ? " · " + esc(p.id) : ""}${v.size_mb ? " · " + v.size_mb + " MB" : ""}</p>
        ${v.audio ? `<p class="fa-small vid-audio">♪ ${esc(String(v.audio.music || "").replace("fa-afrobeat-", "Afrobeat beat "))}${v.audio.voiceover ? ` · 🎙 “${esc(v.audio.voiceover)}”` : v.audio.own_sound ? " under your own sound" : ""}</p>` : `<p class="fa-small muted">♪ Afrobeat + voice-over are being added (a few minutes after upload)</p>`}
        <div class="vid-tags">${badge(v, "website")}${badge(v, "youtube")}${badge(v, "tiktok")}</div>
        <label class="vid-desc">Description for the next posting <small class="muted">(a new one is written after each posting; edit it if you like)</small>
          <textarea rows="6" data-vid-draft="${esc(v.id)}">${esc(d.text)}</textarea></label>
        <div class="vid-actions">
          <button class="btn btn-ghost btn-sm" data-vid="reroll" data-id="${esc(v.id)}">🔄 New description</button>
          <button class="btn btn-ghost btn-sm" data-vid="copy" data-id="${esc(v.id)}">Copy description</button>
          <a class="btn btn-ghost btn-sm" href="../${esc(v.file)}" download>Download</a>
        </div>
        <div class="vid-actions">
          ${v.website.status === "posted" ? `<button class="btn btn-ghost btn-sm" data-vid="web-off" data-id="${esc(v.id)}">Remove from website</button>` : `<button class="btn btn-sell btn-sm" data-vid="web-on" data-id="${esc(v.id)}">Post to website</button>`}
          <button class="btn btn-sell btn-sm" data-vid="yt" data-id="${esc(v.id)}">${v.youtube.status === "posted" ? "Post to YouTube again" : "Post to YouTube"}</button>
          <button class="btn btn-ghost btn-sm" data-vid="tt" data-id="${esc(v.id)}">TikTok (copy + download)</button>
        </div>
        <details class="vid-more"><summary>More</summary>
          <div class="vid-actions">
            ${v.youtube.status !== "posted" ? `<button class="btn btn-ghost btn-sm" data-vid="yt-mark" data-id="${esc(v.id)}">Mark posted on YouTube</button>` : `<button class="btn btn-ghost btn-sm" data-vid="yt-unmark" data-id="${esc(v.id)}">Mark not on YouTube</button>`}
            ${v.tiktok.status !== "posted" ? `<button class="btn btn-ghost btn-sm" data-vid="tt-mark" data-id="${esc(v.id)}">Mark posted on TikTok</button>` : `<button class="btn btn-ghost btn-sm" data-vid="tt-unmark" data-id="${esc(v.id)}">Mark not on TikTok</button>`}
          </div>
          <form class="vid-edit" data-vid-edit="${esc(v.id)}">
            <label>Title <input name="title" type="text" maxlength="100" value="${esc(v.title || "")}" placeholder="Empty: a catchy title is written for each posting"></label>
            <label>Product in the video <select name="product"><option value="">No product (general video)</option>${productOptions(v.product)}</select></label>
            <button class="btn btn-ghost btn-sm" type="submit">Save</button>
          </form>
          <button class="btn btn-danger btn-sm" data-vid="del" data-id="${esc(v.id)}">${armed === v.id ? "Tap again to delete for good" : "Delete video"}</button>
        </details>
      </div>
    </article>`;
  }
  const isWaiting = v => v.website.status !== "posted" && v.youtube.status !== "posted";
  const inSrc = v => src === "all" || (v.source || "upload") === src;
  function renderTab() {
    if (!S) return `<p class="muted">Loading…</p>`;
    const all = S.videos.filter(inSrc);
    const waiting = all.filter(isWaiting);
    const done = all.filter(v => !isWaiting(v));
    const list = (view === "waiting" ? waiting : view === "posted" ? done : all).slice().reverse();
    const hasExt = !!document.documentElement.dataset.favautoExt;
    return `<section class="fa-card">
        <header><h2>Videos waiting for you</h2><span class="fa-big ${waiting.length ? "hot" : ""}">${waiting.length}</span></header>
        <p class="muted">Every video you make or add waits here until you post it to your <b>website</b> (favisionenterprize.github.io/videos), <b>YouTube</b> or <b>TikTok</b>. Each posting gets a new description with a call to action.</p>
        ${hasExt && !shellOk() ? `<p class="fa-ext bad">For YouTube, reload the add-on once: edge://extensions → FA Vision Autopilot → ↻ Reload, then refresh this page.</p>` : ""}
        <div class="fa-actions">
          <button class="btn btn-sell" data-vid="yt-all" ${waiting.length ? "" : "disabled"}>Post all ${waiting.length} waiting to YouTube</button>
          <button class="btn btn-ghost" data-vid="yt-test">Test YouTube (no posting)</button>
        </div>
      </section>
      <section class="fa-card">
        <header><h2>Add videos from your computer or phone</h2></header>
        <form class="fa-settings" id="vid-add">
          <label>What are they? <select name="source"><option value="tiktok">Old videos I posted on TikTok</option><option value="upload">New videos</option></select></label>
          <label>Product in them (optional) <select name="product"><option value="">No product / several</option>${productOptions(null)}</select></label>
          <label class="btn btn-primary vid-pick">Choose videos… <input id="vid-files" type="file" accept="video/*" multiple hidden></label>
        </form>
        <p class="muted fa-small">Pick several at once (Ctrl+A in your TikTok videos folder). Up to ${MAX_MB} MB each; export at 720p in CapCut if one is bigger.</p>
      </section>
      <nav class="fa-tabs vid-view" role="tablist">${[["waiting", `Waiting (${waiting.length})`], ["posted", `Posted (${done.length})`], ["all", `All (${all.length})`]].map(([k, t]) => `<button type="button" role="tab" aria-selected="${view === k}" data-vid-view="${k}">${t}</button>`).join("")}</nav>
      <p class="vid-src">${Object.entries(SRC).map(([k, t]) => `<button type="button" class="vid-chip ${src === k ? "on" : ""}" data-vid-src="${k}">${t}</button>`).join("")}</p>
      ${list.length ? `<div class="vid-grid">${list.map(card).join("")}</div>` : `<p class="muted">${view === "waiting" ? "Nothing waiting ✓" : "No videos here yet."}</p>`}`;
  }

  // ------------------------------------------------------------------ events
  const vidOf = id => S && S.videos.find(v => v.id === id);
  document.addEventListener("click", async e => {
    const vw = e.target.closest("[data-vid-view]");
    if (vw) { view = vw.dataset.vidView; return rerender(); }
    const sc = e.target.closest("[data-vid-src]");
    if (sc) { src = sc.dataset.vidSrc; return rerender(); }
    const b = e.target.closest("[data-vid]");
    if (!b || !S) return;
    e.preventDefault();
    const k = b.dataset.vid, v = vidOf(b.dataset.id);
    if (k === "yt-all") return toYouTube(S.videos.filter(x => isWaiting(x) && inSrc(x)).map(x => x.id), false);
    if (k === "yt-test") return toYouTube([(S.videos[0] || {}).id], true);
    if (!v) return;
    if (k !== "del") armed = null;
    if (k === "reroll") { reroll(v); return rerender(); }
    if (k === "copy") { await copy(textFor(v, "tiktok")); reroll(v); rerender(); return A.toast("Description copied ✓ (a new one is ready for next time)"); }
    if (k === "web-on" || k === "web-off") return toWebsite(v, k === "web-on");
    if (k === "yt") return toYouTube([v.id], false);
    if (k === "tt") return toTikTok(v);
    if (/^(yt|tt)-(un)?mark$/.test(k)) {
      const net = k.startsWith("yt") ? "youtube" : "tiktok", on = !k.includes("unmark");
      A.busy("Saving…");
      try { await setNet(v.id, net, { status: on ? "posted" : "waiting" }, `Videos: ${v.id} ${on ? "posted on" : "not on"} ${NETS[net]}`); if (on) reroll(v); }
      catch (err) { A.toast(A.friendly(err), true); }
      finally { A.busy(null); rerender(); }
      return;
    }
    if (k === "del") {
      if (armed !== v.id) { armed = v.id; return rerender(); }
      armed = null;
      A.busy("Deleting the video…");
      try {
        const deletes = [v.file].concat(v.poster && v.poster.startsWith("assets/videos/") ? [v.poster] : []);
        S = normalise(await A.commitFiles({ files: [], deletes, jsonPath: FILE, fallback: EMPTY, message: `Videos: delete ${v.id}`, mutate: s => { s = normalise(s); s.videos = s.videos.filter(x => x.id !== v.id); s.removed = [...new Set(s.removed.concat(v.id))]; return s; } }));
        A.toast("Video deleted");
      } catch (err) { A.toast(A.friendly(err), true); }
      finally { A.busy(null); rerender(); }
    }
  });
  document.addEventListener("input", e => {
    const t = e.target.closest && e.target.closest("[data-vid-draft]");
    if (t) drafts[t.dataset.vidDraft] = { text: t.value, edited: true };
  });
  document.addEventListener("change", e => {
    if (e.target && e.target.id === "vid-files" && e.target.files.length) addFiles(e.target.files);
  });
  document.addEventListener("submit", async e => {
    const f = e.target.closest && e.target.closest("[data-vid-edit]");
    if (!f) return;
    e.preventDefault();
    const id = f.dataset.vidEdit, title = f.elements.title.value.trim(), pid = f.elements.product.value || null;
    A.busy("Saving…");
    try {
      await save(s => { const v = s.videos.find(x => x.id === id); if (v) { v.title = title; v.product = pid; } return s; }, `Videos: edit ${id}`);
      const v = vidOf(id); if (v) reroll(v);
      A.toast("Saved ✓");
    } catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); rerender(); }
  });

  window.FAV_VIDAUTO = { load, state: () => S, renderTab, receive, describe, textFor, titleFor, _set: s => { S = normalise(s); } };
})();
