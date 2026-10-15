// FA Vision Autopilot: TikTok captions. Runs on tiktok.com, but only in a tab the FA Vision admin opened
// with one of these jobs (kept per tab by background.js):
//   ttscan – TikTok Studio → Posts (tiktokstudio/content): read EVERY post (up to job.max, 500): scrolls the
//            list's inner scroller (and the window), brings the last row into view, clicks "Load more" /
//            pagination Next, until no new post appears 3 rounds running. One entry per post id (links to
//            /video/<id> or /photo/<id>): description (a truncated one still counts), thumbnail + alt text.
//            The admin flags the ones with no real description (under 15 characters, or hashtags only).
//   ttfix  – for each queued post (oldest first): open its edit page by URL
//            (/tiktokstudio/upload/post/photo|video?item_id=<id>&from=creator_center, verified live 15 Oct
//            2026; fallback: the list's pencil, never the ••• menu, which holds Delete), check it still has
//            no real description, paste the caption into the Draft.js description (title box left alone),
//            check it's there, press Save. One post at a time, 20–40 s apart; stops at once on any warning.
//            Never deletes or re-posts anything.
// Results go back to the admin (admin/ttcaptions.js). The edit URL + paste + Save flow was checked live
// (15 Oct 2026); the Posts list selectors (rows, scrolling) are a defensive best guess.
(async () => {
  let bgSleepOk = true;
  const sleep = ms => new Promise(done => {
    const end = Date.now() + ms;
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0) return done();
      if (!bgSleepOk) return setTimeout(done, left);
      try {
        chrome.runtime.sendMessage({ type: "sleep", ms: Math.min(left, 20000) }, r => {
          if (chrome.runtime.lastError || !r || !r.slept) bgSleepOk = false;
          tick();
        });
      } catch (e) { bgSleepOk = false; tick(); }
    };
    tick();
  });
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const bg = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r || {})); } catch (e) { res({}); } });
  let job = null;
  try { job = (await bg({ type: "getJob" })).job || null; } catch (e) { job = null; }
  if (!job || (job.kind !== "ttscan" && job.kind !== "ttfix")) return;
  job.i = job.i || 0;
  job.res = job.res || [];
  job.hops = job.hops || 0;
  job.stage = job.stage || (job.kind === "ttfix" ? "open" : "list");
  const save = () => bg({ type: "saveJob", job });

  let stopAsked = false;
  function box(msg, bad) {
    let d = document.getElementById("favautobox");
    if (!d) {
      d = document.createElement("div");
      d.id = "favautobox";
      d.style.cssText = "position:fixed;z-index:2147483647;left:16px;bottom:16px;max-width:420px;padding:14px 16px;border-radius:12px;font:600 14px/1.45 system-ui,sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;gap:12px;align-items:flex-start";
      const t = document.createElement("span"); t.id = "favautomsg"; t.style.flex = "1";
      const b = document.createElement("button");
      b.textContent = "Stop";
      b.style.cssText = "flex:0 0 auto;border:0;border-radius:8px;padding:6px 12px;font:700 13px system-ui;background:#fff;color:#c62828;cursor:pointer";
      b.onclick = () => { stopAsked = true; finish("Stopped by you."); };
      d.append(t, b);
      document.body.appendChild(d);
    }
    d.style.background = bad ? "#c62828" : "#fe2c55";
    document.getElementById("favautomsg").textContent = `FA Vision · TikTok captions · ${msg}`;
  }
  async function finish(stopped) {
    const out = { kind: job.kind, id: job.id, res: job.res, n: job.q ? job.q.length : job.res.length, stopped: stopped || null, then: job.then || null };
    await bg({ type: "clearJob" });
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }
  const WARN = /temporarily blocked|temporarily restricted|you('|’)re restricted|we limit how often|try again later|suspicious activity|too many (attempts|requests)|violat(es|ion)|community guidelines|account (is )?(banned|suspended)/i;
  const warning = () => { const t = [...document.querySelectorAll("[role=dialog],[role=alert],[class*=toast],[class*=Toast]")].map(d => d.innerText || "").join("\n"); const m = t.match(WARN); return m ? m[0] : null; };
  const visible = el => !!el && el.getClientRects().length > 0;
  const findBtn = (re, root) => [...(root || document).querySelectorAll("[role=button],button,[role=menuitem],a")].find(b => visible(b) && (re.test((b.getAttribute("aria-label") || "").trim()) || re.test((b.innerText || "").trim())));
  async function waitFor(fn, ms) { for (let t = 0; t < ms; t += 300) { if (stopAsked) return null; const v = fn(); if (v) return v; await sleep(300); } return null; }
  async function countdown(secs, text) { for (let s = secs; s > 0 && !stopAsked; s--) { box(`${text} ${s} s…`); await sleep(1000); } }
  async function go(url) {
    job.hops++;
    await save();
    if (job.hops > (job.maxHops || 80)) return finish("TikTok kept sending the tab to another page. Stopped.");
    location.href = url;
  }
  const CONTENT = "https://www.tiktok.com/tiktokstudio/content";
  const onContent = () => /\/tiktokstudio\/content\/?$/.test(location.pathname);
  // Meaningful text: what's left without hashtags, mentions and spaces.
  const meaningful = t => String(t || "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim();
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  // Rows of the Posts list, written defensively (the live structure isn't verified): every link to one
  // post (/video/<id> or /photo/<id>, or a Studio /content/<id> link), and the row around it: a known row
  // element (data-tt PostTable…, role=row, tr, …) that holds no other post, else the biggest ancestor that
  // still holds only this post. One entry per post id.
  const POST_LINK = 'a[href*="/video/"],a[href*="/photo/"],a[href*="/tiktokstudio/content/"]';
  const idOf = a => { const h = a.getAttribute("href") || ""; const m = h.match(/\/(?:video|photo)\/(\d{6,})/) || h.match(/\/tiktokstudio\/content\/(\d{6,})/); return m ? m[1] : null; };
  const idsIn = el => new Set([...el.querySelectorAll(POST_LINK)].map(idOf).filter(Boolean));
  const ROW_SEL = '[data-tt*="PostTable"][data-tt*="Row"],[data-tt*="PostTable"][data-tt*="Item"],[data-tt*="post_table"],[data-tt*="PostItem"],[data-e2e*="post-item"],[data-e2e*="content-item"],[role=row],tr,[class*="PostItem"],[class*="post-item"],[class*="TableRow"],[class*="table-row"],[class*="content-item"]';
  const DESC_SEL = '[data-tt*="Desc"],[data-tt*="desc"],[data-tt*="Caption"],[data-tt*="caption"],[data-tt*="Title"],[data-e2e*="desc"],[data-e2e*="caption"],[class*="desc"],[class*="Desc"],[class*="caption"],[class*="Caption"],[class*="title"],[class*="Title"]';
  const NOISE = /^(\d[\d.,]*\s*[KkMm]?|public|everyone|friends|only me|private|followers|edit|delete|more|more options|\.\.\.|…|pinned|views?|likes?|comments?|shares?|open|video|photo|posts?|\d{1,2}[:/]\d{1,2}.*|[A-Z][a-z]{2,8} \d{1,2}(, \d{4})?.*|\d{4}-\d{2}-\d{2}.*)$/i;
  function rowOf(a, id) {
    for (let el = a.parentElement, k = 0; el && k < 12; el = el.parentElement, k++) {
      if (el.matches && el.matches(ROW_SEL)) { const ids = idsIn(el); if (ids.size === 1 && ids.has(id)) return el; break; }
    }
    let row = a;
    for (let k = 0; k < 10 && row.parentElement; k++) {
      const up = row.parentElement;
      const ids = idsIn(up);
      if (ids.size > 1 || up === document.body) break;
      row = up;
    }
    return row;
  }
  function descOf(row, a) {
    const cands = [...row.querySelectorAll(DESC_SEL)].filter(el => el !== row && !el.querySelector(DESC_SEL));
    for (const el of cands) {
      const t = clip(el.getAttribute("title") && el.getAttribute("title").length > (el.innerText || "").length ? el.getAttribute("title") : el.innerText || el.textContent, 300);
      if (t && !NOISE.test(t)) return t;
    }
    const at = clip(a.getAttribute("title") || a.getAttribute("aria-label") || a.innerText, 300);
    if (at && at.length > 3 && !NOISE.test(at)) return at;
    const lines = (row.innerText || "").split("\n").map(x => x.trim()).filter(x => x && !NOISE.test(x) && /[\p{L}\p{N}]/u.test(x));   // icons like ✎ / ⋯ aren't text
    return clip(lines[0] || "", 300);    // a truncated caption ("Student desk…") still counts as a description
  }
  function rows() {
    const out = [], seen = new Set();
    for (const a of document.querySelectorAll(POST_LINK)) {
      const id = idOf(a);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const row = rowOf(a, id);
      const im = row.querySelector("img");
      const href = a.href.split("?")[0];
      out.push({ id, url: /\/(video|photo)\//.test(href) ? href : "", desc: descOf(row, a), thumb: im && /^https:/.test(im.src) ? im.src.slice(0, 600) : "", alt: clip(im && im.alt, 200), row });
    }
    return out;
  }
  // Load the next part of the list: scroll every scroller holding posts (TikTok Studio scrolls an inner
  // box, not the window), bring the last row into view (for "load when visible" lists), click
  // "Load more" if there is one, or the pagination's Next.
  function scrollers() {
    return [...document.querySelectorAll("div,main,section,ul,ol,tbody,table,[role=grid],[role=table],[role=rowgroup]")]
      .filter(el => el.scrollHeight > el.clientHeight + 40 && /auto|scroll|overlay/.test(getComputedStyle(el).overflowY));
  }
  async function loadMore() {
    const links = document.querySelectorAll(POST_LINK);
    if (links.length) links[links.length - 1].scrollIntoView({ block: "end" });   // first, so the scrolls below end at the very bottom
    const se = document.scrollingElement || document.documentElement;
    window.scrollTo(0, se.scrollHeight);
    const withPosts = scrollers().filter(el => el.querySelector(POST_LINK));
    for (const el of (withPosts.length ? withPosts : scrollers())) {
      el.scrollTop = el.scrollHeight;
      try { el.dispatchEvent(new WheelEvent("wheel", { deltaY: 1200, bubbles: true })); } catch (e) { /* old browser */ }
    }
    await sleep(400);
    const more = findBtn(/^(load more|view more|show more posts|load more posts|more posts|view more posts)$/i);
    if (more && more.getAttribute("aria-disabled") !== "true" && !more.disabled) { more.click(); return "more"; }
    const next = [...document.querySelectorAll('[class*="agination"] [aria-label],[role=navigation] [aria-label]')].find(b => visible(b) && /^next( page)?$/i.test(b.getAttribute("aria-label").trim()) && b.getAttribute("aria-disabled") !== "true" && !b.disabled && !/disabled/i.test(b.className || ""));
    if (next) { next.click(); return "next"; }
    return "scroll";
  }

  await sleep(3000);
  if (/\/login/.test(location.pathname)) return finish("TikTok isn't logged in in this browser. Log in, then press the button again.");
  let w = warning(); if (w) return finish(`TikTok showed "${w}". Stopped.`);

  // ============================================================= scan
  if (job.kind === "ttscan") {
    if (!onContent()) return go(CONTENT);
    const cap = job.max || 500;
    box("reading your posts…");
    await waitFor(() => rows().length, 20000);
    const all = new Map();
    const collect = () => {
      for (const r of rows()) {
        const had = all.get(r.id);
        if (had) { if (!had.desc && r.desc) had.desc = r.desc; if (!had.thumb && r.thumb) { had.thumb = r.thumb; had.alt = r.alt; } continue; }
        if (all.size < cap) all.set(r.id, { id: r.id, url: r.url, desc: r.desc, thumb: r.thumb, alt: r.alt });
      }
    };
    collect();
    let idle = 0;
    for (let t = 0; t < 600 && idle < 3 && all.size < cap && !stopAsked; t++) {
      const before = all.size;
      box(`reading your posts… ${all.size} found`);
      await loadMore();
      await waitFor(() => { collect(); return all.size > before; }, rand(5000, 7000));   // give the next page time to load
      collect();
      idle = all.size > before ? 0 : idle + 1;
      w = warning(); if (w) { job.res = [...all.values()]; return finish(`TikTok showed "${w}". Stopped.`); }
      if (t % 10 === 9) { job.res = [...all.values()]; await save(); }
    }
    if (stopAsked) return;
    job.res = [...all.values()];
    await save();
    box(`Read ${job.res.length} posts${all.size >= cap ? ` (the first ${cap})` : ""}. Going back to your admin…`);
    await sleep(1000);
    return finish(job.res.length ? null : "No posts found in TikTok Studio → Posts.");
  }

  // ============================================================= fix: one post at a time
  // job.q: [{ id, url, text }] (oldest first). Verified live 15 Oct 2026: a post's edit page is
  // /tiktokstudio/upload/post/photo?item_id=<id>&from=creator_center (videos: /upload/post/video?…);
  // the caption goes into the Draft.js description with a paste event (line breaks kept); the separate
  // "Add a catchy title" box is left alone; Save goes back to the Posts list. TikTok allows one caption
  // edit per post per day, and only within 7 days of posting. Fallback when the edit URL doesn't open:
  // the list's pencil (Edit). The ••• menu holds Delete, so it is never opened.
  const done = async why => { const ok = job.res.filter(r => r.ok).length, had = job.res.filter(r => !r.ok && /already has/.test(r.why)).length; box(`Done: ${ok} of ${job.q.length} descriptions added${had ? `, ${had} already had one` : ""}${job.res.length - ok - had ? `, ${job.res.length - ok - had} not` : ""}. Going back…`); await sleep(1500); return finish(why); };
  if (job.i >= job.q.length) return done();
  const it = job.q[job.i];
  const n = `Fixing ${job.i + 1} of ${job.q.length}`;
  const record = (ok, why) => { job.res.push({ id: it.id, ok, why: why || "", t: new Date().toISOString() }); job.i++; job.stage = "open"; job.alt = 0; };
  const next = async ok => {
    await save();
    if (job.i >= job.q.length) return done();
    if (ok) await countdown(rand(job.min || 20, job.max || 40), `${n.replace("Fixing", "Fixed")}. Next post in`);
    else await sleep(rand(3000, 5000));
    if (stopAsked) return;
    job.stage = "open";
    await save();
    return openEdit();
  };
  const editor = () => [...document.querySelectorAll('[data-e2e=caption_container] [contenteditable=true],.public-DraftEditor-content[contenteditable=true],[contenteditable=true][role=textbox],[contenteditable=true]')].find(el => visible(el) && !el.closest("[role=dialog]"));
  const onEditPage = () => /\/tiktokstudio\/upload\/post\//.test(location.pathname) || /\/tiktokstudio\/content\/\d+\/edit/.test(location.pathname);
  // A refusal, not the page's standing note ("captions can only be edited once a day, within 7 days").
  const LOCKED = /can(no|'|’)t (be )?edit|no longer (be )?edit|editing (is )?(not available|unavailable)|already (been )?edited (it )?today|reached the edit limit|edit limit reached/i;
  const editUrl = (cur, alt) => {
    const kind = /\/video\//.test(cur.url || "") ? "video" : "photo";
    const k = alt ? (kind === "photo" ? "video" : "photo") : kind;
    return `https://www.tiktok.com/tiktokstudio/upload/post/${k}?item_id=${encodeURIComponent(cur.id)}&from=creator_center`;
  };
  async function openEdit() {
    const cur = job.q[job.i];
    job.stage = "edit";
    return go(editUrl(cur, job.alt === 1));
  }
  const flat = t => String(t || "").replace(/\s+/g, " ").trim();
  const probe = flat(it.text.split("\n").find(l => l.trim()) || "").slice(0, 25);
  const hasText = () => { const ed = editor(); return !!ed && !!probe && flat(ed.innerText).includes(probe); };
  function paste(ed, text) {
    ed.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }

  if (job.stage === "after") {   // the page changed after Save (TikTok goes back to the Posts list)
    record(true, "saved");
    return next(true);
  }
  if (job.stage === "open" || !job.stage) return openEdit();

  if (job.stage === "list") {    // fallback: the pencil (Edit) on the post's row in the Posts list
    if (!onContent()) return go(CONTENT);
    box(`${n}: finding the post in the list…`);
    await waitFor(() => rows().length, 20000);
    // Load the list until this post shows (it may be far down), stopping when nothing new loads 3 times.
    const seen = new Set();
    const look = () => { const all = rows(); all.forEach(x => seen.add(x.id)); return all.find(x => x.id === it.id) || null; };
    let r = look();
    for (let t = 0, idle = 0; t < 300 && !r && idle < 3 && !stopAsked; t++) {
      const before = seen.size;
      await loadMore();
      await waitFor(() => look() || seen.size > before, 6000);
      r = look();
      idle = seen.size > before ? 0 : idle + 1;
      box(`${n}: finding the post… (${seen.size} read)`);
    }
    if (!r) { record(false, "post not found in TikTok Studio → Posts"); return next(false); }
    r.row.scrollIntoView({ block: "center" });
    await sleep(800);
    // Pencil only: a button/link labelled Edit, or an icon button whose label/tooltip/test id says edit.
    const edit = findBtn(/^edit$|^edit (post|details|description|caption)$/i, r.row) ||
      [...r.row.querySelectorAll('[aria-label*="edit" i],[data-tt*="Edit"],[data-e2e*="edit"],[title*="edit" i]')].find(b => visible(b) && !/delete|more/i.test((b.getAttribute("aria-label") || "") + (b.getAttribute("title") || "")));
    if (!edit) { record(false, "couldn't find the Edit pencil for this post"); return next(false); }
    job.stage = "edit2";
    await save();
    edit.click();
    if (!(await waitFor(editor, 15000))) {
      if (onContent()) { record(false, "the edit page didn't open"); return next(false); }
      return;                     // a new page is loading the editor: this script carries on there (stage "edit2")
    }
  }

  // stage "edit" (opened by URL) or "edit2" (opened with the pencil)
  box(`${n}: adding the description…`);
  const ed = await waitFor(() => editor() || (onContent() && "list"), 20000);
  if (!ed || ed === "list") {
    if (LOCKED.test(document.body.innerText.slice(0, 6000))) { record(false, "TikTok won't allow an edit now (once a day, within 7 days of posting)"); return next(false); }
    if (job.stage === "edit" && !job.alt) { job.alt = 1; return go(editUrl(it, true)); }       // try the other kind (photo ↔ video)
    if (job.stage === "edit") { job.alt = 2; job.stage = "list"; return go(CONTENT); }           // then the list's pencil
    record(false, "the edit page didn't open"); return next(false);
  }
  w = warning(); if (w) return finish(`TikTok showed "${w}". Stopped.`);
  await sleep(1500);
  const lockMsg = [...document.querySelectorAll("[role=alert],[role=dialog],[class*=toast],[class*=Toast],[class*=tip],[class*=Tip],[class*=notice],[class*=Notice]")].map(x => x.innerText || "").join("\n");
  if (LOCKED.test(lockMsg)) { record(false, "TikTok won't allow an edit now (once a day, within 7 days of posting)"); return next(false); }
  const now = editor().innerText || "";
  if (meaningful(now).length >= 15 && !job.overwrite) { record(false, "already has a description now, left as it is"); return next(false); }
  paste(editor(), it.text);
  await sleep(1200);
  if (!hasText()) {             // fallback: type it
    const e2 = editor(); e2.focus();
    document.execCommand("selectAll", false, null); document.execCommand("delete", false, null);
    it.text.split("\n").forEach((line, i, all) => { if (line) document.execCommand("insertText", false, line); if (i < all.length - 1) document.execCommand("insertParagraph", false, null) || document.execCommand("insertLineBreak", false, null); });
    await sleep(1200);
  }
  if (!hasText()) { record(false, "couldn't put the description in (nothing saved)"); return next(false); }
  const btn = await waitFor(() => { const b = findBtn(/^(save|save changes|update)$/i); return b && b.getAttribute("aria-disabled") !== "true" && !b.disabled ? b : null; }, 10000);
  if (!btn) { record(false, "no Save button (nothing was changed)"); return next(false); }
  await sleep(rand(800, 1500));
  if (!hasText()) { record(false, "the description vanished before Save (nothing saved)"); return next(false); }
  job.stage = "after";            // saved before the click, in case Save reloads the page
  await save();
  btn.click();
  box(`${n}: saving…`);
  const ok = await waitFor(() => /saved|updated|changes (have been )?saved/i.test([...document.querySelectorAll("[role=alert],[class*=toast],[class*=Toast]")].map(x => x.innerText || "").join(" ")) || !document.contains(btn) || onContent(), 20000);
  await sleep(1500);
  w = warning(); if (w) { record(false, w); await save(); return finish(`TikTok showed "${w}". Stopped.`); }
  const lock2 = [...document.querySelectorAll("[role=alert],[role=dialog],[class*=toast],[class*=Toast]")].map(x => x.innerText || "").join("\n");
  if (!ok && LOCKED.test(lock2)) { record(false, "TikTok won't allow an edit now (once a day, within 7 days of posting)"); return next(false); }
  record(!!ok, ok ? "" : "TikTok didn't confirm the save");
  return next(!!ok);
})();
