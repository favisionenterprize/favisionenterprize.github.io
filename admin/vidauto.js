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
  const SEARCH_CONSOLE = "https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Afavisionenterprize.github.io";
  const CONTENT_KEY = "fa-weekly-content";
  const CONTENT_STAGES = [["idea", "Idea"], ["scripted", "Script & storyboard"], ["recording", "Record / edit"], ["review", "Review"], ["approved", "Approved for manual posting"]];
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const NETS = { website: "Website", youtube: "YouTube", tiktok: "TikTok" };
  const SRC = { all: "All", tiktok: "My TikTok videos", generated: "Made from ads", upload: "Added by me", desk: "FAV-014 school campaign" };
  let S = null, view = "waiting", src = "all", armed = null;
  const drafts = {};   // id → { text, edited }: the description shown on each card (a fresh one after every posting)
  let contentPlanError = "";
  let contentPlans = readContentPlans();
  const productById = id => A.products().find(p => p.id === id) || null;

  function readContentPlans() {
    try {
      const value = JSON.parse(localStorage.getItem(CONTENT_KEY) || "[]");
      if (!Array.isArray(value)) { contentPlanError = "The saved weekly plan is not a list. It was left unchanged; fix or remove the fa-weekly-content entry in this browser's local storage before editing."; return []; }
      return value.filter(x => x && typeof x.id === "string").slice(-30);
    } catch (e) { contentPlanError = "Couldn't read the saved weekly plan from this browser. It was left unchanged."; return []; }
  }
  function saveContentPlans() {
    if (contentPlanError) { A.toast(contentPlanError, true); return false; }
    try { localStorage.setItem(CONTENT_KEY, JSON.stringify(contentPlans.slice(-30))); }
    catch (e) { contentPlanError = "Couldn't save the weekly content plan in this browser."; A.toast(contentPlanError, true); return false; }
    return true;
  }
  const contentPlan = id => contentPlans.find(x => x.id === id);
  const saveContentPlan = plan => {
    if (!plan) return false;
    plan.updated = today();
    return saveContentPlans();
  };

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
  const postingHold = v => String(v && v.audio && v.audio.hold_reason || "");
  // Facebook videos too long to copy (e.g. the desk offloading videos) play from Facebook itself.
  const fbFrame = u => /^https:\/\/www\.facebook\.com\/FaVisionEnterprise\/videos\/\d+\/?$/.test(String(u || ""))
    ? `<iframe class="vid-embed" src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u)}&show_text=false" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen style="border:0;width:100%;aspect-ratio:9/16;max-height:420px"></iframe>`
    : "";
  const junkName = t =>!t || /^(vid|img|video|pxl|mov|snaptik|ssstik|tiktok)?[\s_-]*\d[\d\s_-]*$/i.test(String(t).replace(/\.\w+$/, "")) || /^[0-9a-f]{12,}$/i.test(t);

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
    if (CAP() && CAP().ensure) return CAP().ensure(t, product(v), { net });   // quality gate: description, hashtags, call to action
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

  // opts (🎬 Trend video card, admin/trendvideo.js): { source, product, kind, title, description } instead of the form.
  async function addFiles(list, opts) {
    const form = document.getElementById("vid-add");
    const source = (opts && opts.source) || (form && form.source.value) || "tiktok";
    const pid = opts ? (opts.product || "") : (form && form.product.value) || "";
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
          id: base, title: (opts && opts.title) || (junkName(f.name) ? "" : f.name.replace(/\.\w+$/, "").replace(/[_-]+/g, " ").trim()),
          description: (opts && opts.description) || "", file: up[0].path, poster: poster ? up[1].path : (p && p.images && p.images[0]) || "",
          product: pid || null, kind: (opts && opts.kind) || "video", source, created: today(), size_mb: +(f.size / 1048576).toFixed(1),
          ...(opts && opts.trend ? { trend: opts.trend } : {}),
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
    if (on && postingHold(v)) return A.toast(`Replace this video before posting: ${postingHold(v)}`, true);
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
    const selected = ids.map(id => S.videos.find(v => v.id === id)).filter(v => v && v.file);
    const held = selected.filter(postingHold);
    if (held.length) A.toast(`${plural(held.length, "video")} held back until the source audio is replaced.`, true);
    const vids = selected.filter(v => !postingHold(v));
    if (!vids.length) return;
    if (!vids.length) return A.toast("No videos to upload.", true);
    const q = vids.map(v => ({ k: v.id, file: location.origin + "/" + v.file, title: titleFor(v, "youtube"), description: textFor(v, "youtube") }));
    vids.forEach(reroll);
    fb.launch("https://www.youtube.com/upload", { kind: "youtube", q: dry ? q.slice(0, 1) : q, dry: !!dry, then: null });
  }
  // ⚡ Prime / AI Fix: every waiting video with a file → YouTube in one add-on job, then the rest of the steps.
  function postWaiting(then) {
    const fb = F(), go = () => { if (then && then.length && fb) setTimeout(() => fb.runStep(then, true), 300); };
    const ids = S ? S.videos.filter(v => v.file && v.youtube.status !== "posted").map(v => v.id) : [];
    if (!fb || !ids.length || !fb.liveAddon() || !shellOk()) return go();
    const vids = ids.map(id => S.videos.find(v => v.id === id));
    const q = vids.map(v => ({ k: v.id, file: location.origin + "/" + v.file, title: titleFor(v, "youtube"), description: textFor(v, "youtube") }));
    vids.forEach(reroll);
    fb.launch("https://www.youtube.com/upload", { kind: "youtube", q, then: then && then.length ? then : null });
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
    if (postingHold(v)) return A.toast(`Replace this video before posting: ${postingHold(v)}`, true);
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
    if (r.status === "n/a") return "";
    if (r.status === "posted") return `<span class="vid-tag ok">✓ ${NETS[net]}${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">open</a>` : ""}</span>`;
    if (r.status === "failed") return `<span class="vid-tag bad" title="${esc(r.why || "")}">✗ ${NETS[net]}</span>`;
    return `<span class="vid-tag">${NETS[net]}: waiting</span>`;
  }
  const productOptions = sel => A.products().map(x => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.id)} · ${esc(String(x.name).split(" — ")[0])}</option>`).join("");
  function card(v) {
    const p = product(v), d = draft(v), hold = postingHold(v);
    return `<article class="vid-card" data-vid-card="${esc(v.id)}">
      ${v.embed ? fbFrame(v.embed) : `<video src="../${esc(v.file)}" ${v.poster ? `poster="../${esc(v.poster)}"` : ""} controls preload="none" playsinline></video>`}
      <div class="vid-info">
        <h3>${esc(junkName(v.title) ? (p ? String(p.name).split(" — ")[0] : "Video " + (v.created || "")) : v.title)}</h3>
        <p class="muted fa-small">${esc(SRC[v.source] || v.source || "")} · ${esc(v.created || "")}${p ? ` · <a href="../p/${encodeURIComponent(p.id)}.html" target="_blank" rel="noopener">${esc(p.id)} product page ↗</a>` : ""}${v.size_mb ? " · " + v.size_mb + " MB" : ""}</p>
        ${v.audio ? `<p class="fa-small vid-audio">♪ ${esc(String(v.audio.music || "").replace("fa-afrobeat-", "Afrobeat beat "))}${v.audio.voiceover ? ` · 🎙 “${esc(v.audio.voiceover)}”` : v.audio.own_sound ? " under your own sound" : ""}</p>` : `<p class="fa-small muted">♪ Afrobeat + voice-over are being added (a few minutes after upload)</p>`}
        ${hold ? `<p class="fa-small bad vid-hold">On hold: ${esc(hold)}</p>` : ""}
        <div class="vid-tags">${badge(v, "website")}${badge(v, "youtube")}${badge(v, "tiktok")}</div>
        <label class="vid-desc">Description for the next posting <small class="muted">(a new one is written after each posting; edit it if you like)</small>
          <textarea rows="6" data-vid-draft="${esc(v.id)}">${esc(d.text)}</textarea></label>
        <div class="vid-actions">
          <button class="btn btn-ghost btn-sm" data-vid="reroll" data-id="${esc(v.id)}">🔄 New description</button>
          <button class="btn btn-ghost btn-sm" data-vid="copy" data-id="${esc(v.id)}">Copy description</button>
          ${v.embed ? `<a class="btn btn-ghost btn-sm" href="${esc(v.embed)}" target="_blank" rel="noopener">Open on Facebook</a>` : `<a class="btn btn-ghost btn-sm" href="../${esc(v.file)}" download>Download</a>`}
        </div>
        <div class="vid-actions">
          ${v.website.status === "posted" ? `<button class="btn btn-ghost btn-sm" data-vid="web-off" data-id="${esc(v.id)}">Remove from website</button>` : `<button class="btn btn-sell btn-sm" data-vid="web-on" data-id="${esc(v.id)}" ${hold ? `disabled title="${esc(hold)}"` : ""}>Post to website</button>`}
          ${v.embed ? "" : `<button class="btn btn-sell btn-sm" data-vid="yt" data-id="${esc(v.id)}" ${hold ? `disabled title="${esc(hold)}"` : ""}>${v.youtube.status === "posted" ? "Post to YouTube again" : "Post to YouTube"}</button>
          <button class="btn btn-ghost btn-sm" data-vid="tt" data-id="${esc(v.id)}" ${hold ? `disabled title="${esc(hold)}"` : ""}>TikTok (copy + download)</button>`}
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
  // ------------------------------------------------- grow your views (free / organic)
  // data/youtube-growth.json: learning links (e.g. videos on growing views) + a no-ad-spend checklist.
  // Ticks are a per-browser convenience (localStorage): Daily resets each day, Weekly each Monday.
  const GFILE = "data/youtube-growth.json", GEMPTY = { references: [], checklist: [] };
  let G = null, gLoading = false;
  function loadGrowth() {
    if (G || gLoading) return;
    gLoading = true;
    A.readJsonFile(GFILE, GEMPTY).then(g => { G = { ...GEMPTY, ...g }; }).catch(() => { G = { ...GEMPTY }; }).finally(() => { gLoading = false; rerender(); });
  }
  const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toLocaleDateString("en-CA"); };
  const tickKey = c => `fa-ytgrow:${c.id}:${c.when === "Daily" ? today() : c.when === "Weekly" ? monday() : "x"}`;
  const ticked = c => { try { return localStorage.getItem(tickKey(c)) === "1"; } catch (_) { return false; } };
  function renderGrowth() {
    loadGrowth();
    if (!G) return `<section class="fa-card"><header><h2>Grow your views (free)</h2></header><p class="muted">Loading…</p></section>`;
    const groups = ["Daily", "Each upload", "Weekly", "Never"];
    const refs = (G.references || []).map(r => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">▶ ${esc(r.title || r.url)}</a>${r.note ? ` <span class="muted fa-small">${esc(r.note)}</span>` : ""}</li>`).join("");
    const daily = (G.checklist || []).filter(c => c.when === "Daily"), dDone = daily.filter(ticked).length;
    return `<section class="fa-card" id="yt-grow">
        <header><h2>Grow your views (free, no paid promotion)</h2><span class="fa-big ${dDone < daily.length ? "hot" : ""}">${dDone}/${daily.length}</span></header>
        ${G.goal ? `<p class="yt-grow-goal"><b>Goal:</b> ${esc(G.goal)}</p>` : ""}
        <h3 class="yt-grow-h">Learning videos</h3>
        ${refs ? `<ul class="yt-grow-refs">${refs}</ul>` : `<p class="muted">None yet.</p>`}
        <form class="fa-settings yt-grow-add" id="yt-grow-add">
          <label>Add a link <input name="url" type="url" placeholder="https://…" required></label>
          <label>What is it? <input name="title" placeholder="e.g. How to grow your views"></label>
          <button class="btn btn-ghost btn-sm" type="submit">+ Add</button>
        </form>
        ${groups.map(g => { const items = (G.checklist || []).filter(c => c.when === g); return items.length ? `<details class="fa-more yt-grow-group${g === "Never" ? " never" : ""}" ${g === "Daily" ? "open" : ""}><summary>${g === "Never" ? "Never do (breaks YouTube rules)" : g}</summary><ul class="yt-grow-list">${items.map(c => g === "Never"
          ? `<li>✗ ${esc(c.text)}</li>`
          : `<li><label><input type="checkbox" data-ytgrow="${esc(c.id)}" ${ticked(c) ? "checked" : ""}> ${esc(c.text)}</label></li>`).join("")}</ul></details>` : ""; }).join("")}
        ${(G.sources || []).length ? `<p class="muted fa-small">Sources: ${G.sources.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</a>`).join(" · ")}</p>` : ""}
      </section>`;
  }
  document.addEventListener("change", e => {
    const cb = e.target.closest && e.target.closest("[data-ytgrow]");
    if (!cb || !G) return;
    const c = G.checklist.find(x => x.id === cb.dataset.ytgrow);
    if (!c) return;
    try { cb.checked ? localStorage.setItem(tickKey(c), "1") : localStorage.removeItem(tickKey(c)); } catch (_) {}
    rerender();
  });
  document.addEventListener("submit", async e => {
    const f = e.target.closest && e.target.closest("#yt-grow-add");
    if (!f) return;
    e.preventDefault();
    const url = f.elements.url.value.trim(), title = f.elements.title.value.trim();
    if (!/^https?:\/\//.test(url)) return A.toast("Paste a full link starting with https://", true);
    A.busy("Saving…");
    try {
      G = { ...GEMPTY, ...(await A.saveJson(GFILE, g => { g = { ...GEMPTY, ...g }; g.references = (g.references || []).filter(r => r.url !== url).concat({ title: title || url, url, added: today() }); return g; }, "YouTube growth: add learning link", GEMPTY)) };
      A.toast("Link added ✓");
    } catch (err) { A.toast(A.friendly(err), true); }
    finally { A.busy(null); rerender(); }
  });

  const isWaiting = v => v.website.status !== "posted" && v.youtube.status !== "posted";
  const inSrc = v => src === "all" || (src === "desk" ? v.product === "FAV-014" : (v.source || "upload") === src);
  function renderWeekly() {
    const netNames = { fb: "Facebook", ig: "Instagram", x: "X", tiktok: "TikTok" };
    const cards = contentPlans.slice().reverse().map(plan => {
      const p = productById(plan.product), linked = vidOf(plan.video), stage = CONTENT_STAGES.some(x => x[0] === plan.stage) ? plan.stage : "idea";
      const caps = plan.captions || {};
      return `<article class="cw-plan" data-content-plan="${esc(plan.id)}">
        <header><div><b>${esc(p ? String(p.name).split(" — ")[0] : "General video idea")}</b><small class="muted"> · updated ${esc(plan.updated || plan.created || "")}</small></div>
          <label>Stage <select data-plan-field="stage">${CONTENT_STAGES.map(([k, label]) => `<option value="${k}" ${stage === k ? "selected" : ""}>${label}</option>`).join("")}</select></label></header>
        <label>Common customer question or search intent <input data-plan-field="question" maxlength="180" value="${esc(plan.question || "")}" placeholder="Use a generalised question, not someone's private details"></label>
        <label>Video idea / useful takeaway <textarea data-plan-field="idea" rows="2">${esc(plan.idea || "")}</textarea></label>
        <label>Opening hook <textarea data-plan-field="hook" rows="2">${esc(plan.hook || "")}</textarea></label>
        <label>Storyboard / shots to record <textarea data-plan-field="storyboard" rows="3">${esc(plan.storyboard || "")}</textarea></label>
        <label>Related video <select data-plan-field="video"><option value="">Not attached yet</option>${S.videos.map(v => `<option value="${esc(v.id)}" ${v.id === plan.video ? "selected" : ""}>${esc(junkName(v.title) ? v.id : v.title)}</option>`).join("")}</select></label>
        ${linked ? `<p class="cw-related">Video library: <b>${esc(junkName(linked.title) ? linked.id : linked.title)}</b> · <a href="#videos" data-plan-videos>Open Videos &amp; YouTube</a></p>` : ""}
        ${p ? `<p class="cw-links">SEO landing page: <a href="../p/${encodeURIComponent(p.id)}.html" target="_blank" rel="noopener">${esc(p.id)} product page ↗</a></p>` : `<p class="cw-links">Choose a product to link this post to an indexable product page.</p>`}
        <div class="fa-actions">${Object.entries(netNames).map(([net, label]) => `<button type="button" class="btn btn-ghost btn-sm" data-plan-caption="${net}">Draft ${label} caption</button>`).join("")}
          <a class="btn btn-ghost btn-sm" href="${SEARCH_CONSOLE}" target="_blank" rel="noopener">Check Google Search performance ↗</a>
          <button type="button" class="btn btn-danger btn-sm" data-plan-delete>Remove idea</button></div>
        ${Object.entries(caps).filter(([net]) => netNames[net]).map(([net, text]) => `<label>${netNames[net]} caption draft <textarea data-plan-caption-text="${net}" rows="4">${esc(text)}</textarea><button type="button" class="btn btn-ghost btn-sm" data-plan-copy="${net}">Copy ${netNames[net]} draft</button></label>`).join("")}
        <p class="muted fa-small">Captions are drafts only. Approved means ready for your review and manual posting; it does not schedule or publish anything.</p>
      </article>`;
    }).join("");
    return `<section class="fa-card" id="weekly-content">
      <header><h2>Weekly content workflow</h2><span class="fa-big">${contentPlans.length}</span></header>
      <p class="muted">Turn a common buyer question into one useful idea, a hook and a simple storyboard. Record or animate original footage, attach it from this library, review network-specific captions, then mark it approved. Product links are indexable landing pages; use Search Console to measure organic clicks and impressions rather than assuming a social post ranks. Plans and drafts stay in this browser.</p>
      ${contentPlanError ? `<p class="error">${esc(contentPlanError)}</p>` : ""}
      <form class="fa-settings cw-add" id="weekly-plan-add">
        <label>Product or topic <select name="product"><option value="">General / no product</option>${productOptions(null)}</select></label>
        <label>Common customer question or search intent <input name="question" maxlength="180" required placeholder="e.g. What should a school check before buying student desks?"></label>
        <label>One useful takeaway / video idea <textarea name="idea" rows="2" required></textarea></label>
        <label>Opening hook <input name="hook" maxlength="180" placeholder="First 1–2 seconds"></label>
        <label>Storyboard / shots to record <textarea name="storyboard" rows="3" placeholder="Show the real product, key detail, and closing shot"></textarea></label>
        <button class="btn btn-primary" type="submit" ${contentPlanError ? "disabled" : ""}>+ Add to this week's plan</button>
      </form>
      ${cards ? `<div class="cw-list">${cards}</div>` : `<p class="muted">No ideas planned yet. Add the first audience question above.</p>`}
    </section>`;
  }
  if (!document.getElementById("weekly-content-style")) {
    const st = document.createElement("style"); st.id = "weekly-content-style";
    st.textContent = `.cw-add,.cw-list{display:grid;gap:10px}.cw-plan{display:grid;gap:8px;padding:12px;border:1px solid #e3e7ee;border-radius:10px;background:#fff}.cw-plan header{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.cw-plan label{display:grid;gap:4px;font-size:13px;color:#5f6368}.cw-plan input,.cw-plan textarea,.cw-plan select{font:inherit;font-size:14px;padding:7px 9px;border:1px solid #dadce0;border-radius:8px;min-width:0;width:100%;box-sizing:border-box;background:#fff}.cw-plan textarea{resize:vertical}.cw-related,.cw-links{margin:0;font-size:13px}`;
    document.head.appendChild(st);
  }
  function renderTab() {
    if (!S) return `<p class="muted">Loading…</p>`;
    const all = S.videos.filter(inSrc);
    const waiting = all.filter(isWaiting);
    const ytReady = waiting.filter(v => v.file && !postingHold(v));
    const done = all.filter(v => !isWaiting(v));
    const list = (view === "waiting" ? waiting : view === "posted" ? done : all).slice().reverse();
    const hasExt = !!document.documentElement.dataset.favautoExt;
    return `<section class="fa-card">
        <header><h2>Videos waiting for you</h2><span class="fa-big ${waiting.length ? "hot" : ""}">${waiting.length}</span></header>
        <p class="muted">Every video you make or add waits here until you post it to your <b>website</b> (favisionenterprize.github.io/videos), <b>YouTube</b> or <b>TikTok</b>. Each posting gets a new description with a call to action.</p>
        ${hasExt && !shellOk() ? `<p class="fa-ext bad">For YouTube, reload the add-on once: edge://extensions → FA Vision Autopilot → ↻ Reload, then refresh this page.</p>` : ""}
        <div class="fa-actions">
          <button class="btn btn-sell" data-vid="yt-all" ${ytReady.length ? "" : "disabled"}>Post ${ytReady.length} ready to YouTube</button>
          <button class="btn btn-ghost" data-vid="yt-test">Test YouTube (no posting)</button>
        </div>
      </section>
      ${renderWeekly()}
      ${renderGrowth()}
      ${src === "desk" ? `<section class="fa-card"><header><h2>FAV-014 · Student desk campaign</h2><span class="muted">Website reel: already published</span></header>
        <p class="muted">The Facebook container-offload reel is already embedded on the website. It is a Facebook embed, not a local video file; add a rights-cleared source file below before preparing uploads for other networks. Keep school outreach relevant and reviewed—do not repeat promotional comments under unrelated posts.</p>
        <a class="btn btn-ghost btn-sm" href="../p/FAV-014.html" target="_blank" rel="noopener">Open the student desk page</a>
      </section>` : ""}
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
  const planOf = el => { const card = el.closest("[data-content-plan]"); return card && contentPlan(card.dataset.contentPlan); };
  document.addEventListener("click", async e => {
    const b = e.target.closest && e.target.closest("[data-plan-caption],[data-plan-copy],[data-plan-delete],[data-plan-videos]");
    if (!b) return;
    if (b.matches("[data-plan-videos]")) {
      e.preventDefault();
      if (F() && F().open) await F().open("videos");
      return;
    }
    const plan = planOf(b);
    if (!plan) return;
    if (b.matches("[data-plan-delete]")) {
      if (!window.confirm("Remove this local content idea and its caption drafts?")) return;
      contentPlans = contentPlans.filter(x => x.id !== plan.id); saveContentPlans(); return rerender();
    }
    const net = b.dataset.planCaption || b.dataset.planCopy;
    if (!net || !["fb", "ig", "x", "tiktok"].includes(net)) return;
    if (b.matches("[data-plan-copy]")) {
      const box = b.closest(".cw-plan").querySelector(`[data-plan-caption-text="${net}"]`);
      if (!box || !box.value.trim()) return A.toast("Generate a caption draft first.", true);
      return copy(box.value);
    }
    const writer = CAP();
    if (!writer || !writer.write) return A.toast("Caption tools are not loaded.", true);
    try {
      const p = productById(plan.product);
      plan.captions = plan.captions || {};
      plan.captions[net] = writer.write(p, { net, subject: plan.idea || plan.question || "" });
      if (saveContentPlan(plan) !== false) rerender();
    } catch (err) { A.toast(A.friendly(err), true); }
  });
  document.addEventListener("input", e => {
    const t = e.target.closest && e.target.closest("[data-plan-field],[data-plan-caption-text]");
    const plan = t && planOf(t);
    if (!plan) return;
    if (t.dataset.planCaptionText) {
      plan.captions = plan.captions || {};
      plan.captions[t.dataset.planCaptionText] = t.value;
    } else plan[t.dataset.planField] = t.value;
    saveContentPlan(plan);
  });
  document.addEventListener("change", e => {
    const t = e.target.closest && e.target.closest("[data-plan-field]");
    const plan = t && planOf(t);
    if (!plan) return;
    plan[t.dataset.planField] = t.value;
    saveContentPlan(plan);
    rerender();
  });
  document.addEventListener("submit", e => {
    const form = e.target.closest && e.target.closest("#weekly-plan-add");
    if (!form) return;
    e.preventDefault();
    const question = form.elements.question.value.trim(), idea = form.elements.idea.value.trim();
    if (!question || !idea) return A.toast("Add a buyer question and one useful idea first.", true);
    contentPlans.push({
      id: Date.now().toString(36), product: form.elements.product.value,
      question: question.slice(0, 180), idea: idea.slice(0, 1000),
      hook: form.elements.hook.value.trim().slice(0, 180), storyboard: form.elements.storyboard.value.trim().slice(0, 2000),
      stage: "idea", created: today(), updated: today(), captions: {}
    });
    contentPlans = contentPlans.slice(-30);
    saveContentPlans(); rerender();
    A.toast("Added to this week's content plan. Nothing was posted.");
  });
  document.addEventListener("click", async e => {
    const vw = e.target.closest("[data-vid-view]");
    if (vw) { view = vw.dataset.vidView; return rerender(); }
    const sc = e.target.closest("[data-vid-src]");
    if (sc) { src = sc.dataset.vidSrc; if (src === "desk") view = "all"; return rerender(); }
    const b = e.target.closest("[data-vid]");
    if (!b || !S) return;
    e.preventDefault();
    const k = b.dataset.vid, v = vidOf(b.dataset.id);
    if (k === "yt-all") return toYouTube(S.videos.filter(x => isWaiting(x) && inSrc(x) && !postingHold(x)).map(x => x.id), false);
    if (k === "yt-test") return toYouTube([(S.videos[0] || {}).id], true);
    if (!v) return;
    if (k !== "del") armed = null;
    if (k === "reroll") { reroll(v); return rerender(); }
    if (k === "copy") { await copy(textFor(v, "tiktok")); reroll(v); rerender(); return A.toast("Description copied ✓ (a new one is ready for next time)"); }
    if (k === "web-on" || k === "web-off") return toWebsite(v, k === "web-on");
    if (k === "yt") return toYouTube([v.id], false);
    if (k === "tt") return v.file ? toTikTok(v) : null;
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
        const deletes = [v.file].filter(Boolean).concat(v.poster && v.poster.startsWith("assets/videos/") ? [v.poster] : []);
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

  window.FAV_VIDAUTO = { load, state: () => S, renderTab, addFiles, postWaiting, receive, describe, textFor, titleFor, _set: s => { S = normalise(s); } };
})();
