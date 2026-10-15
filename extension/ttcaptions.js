// FA Vision Autopilot: TikTok captions. Runs on tiktok.com, but only in a tab the FA Vision admin opened
// with one of these jobs (kept per tab by background.js):
//   ttscan – TikTok Studio → Posts (tiktokstudio/content): read EVERY post (up to job.max, 500) from the
//            virtual table (rows [data-tt=components_PostTable_Absolute], scroller
//            [data-tt=components_PostTable_Container], checked live 15 Oct 2026). Ids come from the row's
//            link or, for "No description" rows (no link), from data-fav-id set by the page-world helper
//            ttids.js. The grey "No description" placeholder counts as EMPTY. The admin flags posts with
//            under 15 characters of non-hashtag text.
//   ttfix  – for each queued post (oldest first): open its edit page by URL
//            (/tiktokstudio/upload/post/photo|video?item_id=<id>&from=creator_center, verified live 15 Oct
//            2026; fallback: the list's pencil [data-icon=Pen], never the ••• menu, which holds Delete), check
//            it still has no real description (else skip, res.skip), paste the caption into the Draft.js
//            description (title box left alone), check it's there, press Save. One post at a time, 20–40 s
//            apart; stops at once on any warning. With job.cont it hands back to the admin every job.batch (5)
//            posts so the log is committed, and the admin starts the next batch. Never deletes or re-posts.
// Results (with VERSION) go back to the admin (admin/ttcaptions.js).
(async () => {
  const VERSION = "2026-10-15.3";     // reported back to the admin with every result
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
    // A batch of the fix run ends early (job.more = posts still queued) so the admin saves the log
    // every few posts; it then starts the next batch (job.cont, e.g. "ttcaps:fixall") before job.then.
    const more = job.kind === "ttfix" && !stopped && job.q ? job.q.length - job.i : 0;
    const out = { kind: job.kind, id: job.id, v: VERSION, res: job.res, n: job.q ? job.q.length : job.res.length, stopped: stopped || null,
      then: more > 0 && Array.isArray(job.cont) ? job.cont.concat(job.then || []) : job.then || null,
      ...(more > 0 ? { more } : {}), ...(job.kind === "ttscan" ? { helper: job.helper || document.documentElement.dataset.favTtids || "", noid: job.noid || 0 } : {}) };
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
  const meaningful = t => { const m = String(t || "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim(); return /^no description\.?$/i.test(m) ? "" : m; };
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

  // TikTok Studio → Posts, checked live 15 Oct 2026 (read only): a virtual table. Each row is
  // [data-tt=components_PostTable_Absolute] (100 px, only ~8 rendered at a time, reused as it scrolls)
  // inside the scroller [data-tt=components_PostTable_Container] (overflow-y: scroll; 10 more rows load
  // when it nears the bottom; 151 of 152 posts read in ~70 steps of 500 px). The description cell is
  // [data-tt=components_PostInfoCell_Container]: an <a href="/@user/video/<id>"> when there IS a
  // description, a plain div with the grey placeholder "No description" when there isn't (no link, no id
  // in the DOM). The id is only in React's props, which the page-world helper ttids.js copies onto the row
  // (data-fav-id / -desc / -type / -time). Pencil = [data-icon=Pen] in [data-tt=components_ActionCell_Container].
  const ROW = "[data-tt=components_PostTable_Absolute]";
  const SCROLLER = "[data-tt=components_PostTable_Container]";
  const POST_LINK = 'a[href*="/video/"],a[href*="/photo/"]';
  const idOf = a => { const m = String((a && a.getAttribute("href")) || "").match(/\/(?:video|photo)\/(\d{6,})/); return m ? m[1] : null; };
  const PLACEHOLDER = /^(no description|add (a )?description)\.?$/i;
  const DATE = /^([A-Z][a-z]{2} \d{1,2}(, \d{4})?, \d{1,2}:\d{2} ?[AP]M)$/;
  function rowInfo(row) {
    const d = row.dataset;
    const a = row.querySelector(POST_LINK);
    const id = d.favId || idOf(a) || "";
    const cell = row.querySelector("[data-tt=components_PostInfoCell_Container]");
    let desc = d.favId ? d.favDesc || "" : clip(cell ? cell.innerText : a ? a.innerText : "", 300);
    if (PLACEHOLDER.test(clip(desc, 40))) desc = "";
    const im = row.querySelector("img");
    const when = (row.innerText || "").split("\n").map(x => x.trim()).find(x => DATE.test(x)) || "";
    const kind = d.favType ? (d.favType === "2" ? "photo" : "video") : a && /\/photo\//.test(a.getAttribute("href")) ? "photo" : "";
    return { id, url: a ? a.href.split("?")[0] : "", desc, thumb: im && /^https:/.test(im.currentSrc || im.src) ? (im.currentSrc || im.src).slice(0, 600) : "", alt: clip(im && im.alt, 200), kind, when, time: Number(d.favTime) || 0, row };
  }
  const rows = () => [...document.querySelectorAll(ROW)].map(rowInfo);
  const scroller = () => [...document.querySelectorAll(SCROLLER)].find(el => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) ||
    [...document.querySelectorAll(SCROLLER)].find(el => /auto|scroll/.test(getComputedStyle(el).overflowY)) || null;
  // Next part of the list: scroll the table's own scroller 500 px (the window doesn't scroll).
  async function loadMore() {
    const sc = scroller();
    if (sc) { sc.scrollTop = Math.min(sc.scrollTop + 500, sc.scrollHeight); sc.dispatchEvent(new Event("scroll", { bubbles: true })); }
    else window.scrollBy(0, 500);
    await sleep(700);
    return sc ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5 : true;     // at the bottom?
  }

  await sleep(3000);
  if (/\/login/.test(location.pathname)) return finish("TikTok isn't logged in in this browser. Log in, then press the button again.");
  let w = warning(); if (w) return finish(`TikTok showed "${w}". Stopped.`);

  // ============================================================= scan
  if (job.kind === "ttscan") {
    if (!onContent()) return go(CONTENT);
    const cap = job.max || 500;
    box("reading your posts…");
    await waitFor(() => document.querySelector(ROW), 20000);
    await waitFor(() => document.documentElement.dataset.favTtids, 4000);     // the id helper (ttids.js)
    const helper = document.documentElement.dataset.favTtids || "";
    const sc = scroller();
    if (sc) { sc.scrollTop = 0; await sleep(800); }
    const all = new Map();
    let noid = 0;
    const collect = () => {
      for (const r of rows()) {
        if (!r.id) { noid++; continue; }
        if (all.has(r.id) || all.size >= cap) continue;
        delete r.row;
        all.set(r.id, r);
      }
    };
    collect();
    let idle = 0;
    for (let t = 0; t < 1500 && idle < 8 && all.size < cap && !stopAsked; t++) {
      const before = all.size;
      if (t % 5 === 0) box(`reading your posts… ${all.size} found`);
      const bottom = await loadMore();
      collect();
      idle = all.size > before ? 0 : bottom ? idle + 1 : 0;
      if (bottom && idle) await sleep(1200);                 // the next 10 are loading
      w = warning(); if (w) { job.res = [...all.values()]; return finish(`TikTok showed "${w}". Stopped.`); }
      if (t % 20 === 19) { job.res = [...all.values()]; await save(); }
    }
    if (stopAsked) return;
    job.res = [...all.values()];
    job.helper = helper;
    job.noid = noid;
    await save();
    box(`Read ${job.res.length} posts${all.size >= cap ? ` (the first ${cap})` : ""}. Going back to your admin…`);
    await sleep(1000);
    return finish(job.res.length ? null : noid ? "Posts were on screen but their ids couldn't be read (the add-on's TikTok helper ttids.js isn't running)." : "No posts found in TikTok Studio → Posts.");
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
  if (job.wait_first && !job.waited) {          // a later batch: keep the 20–40 s gap between posts
    job.waited = true; await save();
    await countdown(rand(job.min || 20, job.max || 40), "Next post in");
    if (stopAsked) return;
  }
  const n = `Fixing ${job.i + 1} of ${job.q.length}`;
  const record = (ok, why, skip) => { job.res.push({ id: it.id, ok, why: why || "", ...(skip ? { skip: true } : {}), t: new Date().toISOString() }); job.i++; job.stage = "open"; job.alt = 0; };
  const batch = job.batch || 5;
  const next = async ok => {
    await save();
    if (job.i >= job.q.length) return done();
    if (job.res.length >= batch && Array.isArray(job.cont)) { box(`${job.res.length} done: saving the log in your admin, then the next ${batch}…`); await sleep(1000); return finish(null); }
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
    const kind = cur.kind === "video" || cur.kind === "photo" ? cur.kind : /\/video\//.test(cur.url || "") ? "video" : "photo";
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
    await waitFor(() => document.querySelector(ROW), 20000);
    await waitFor(() => document.documentElement.dataset.favTtids, 4000);
    const sc = scroller(); if (sc) { sc.scrollTop = 0; await sleep(800); }
    // Scroll the table until this post's row shows (it may be far down), stopping at the bottom.
    const seen = new Set();
    const look = () => { const all = rows(); all.forEach(x => x.id && seen.add(x.id)); return all.find(x => x.id === it.id) || null; };
    let r = look();
    for (let t = 0, idle = 0; t < 600 && !r && idle < 6 && !stopAsked; t++) {
      const before = seen.size;
      const bottom = await loadMore();
      r = look();
      idle = seen.size > before ? 0 : bottom ? idle + 1 : 0;
      if (bottom && idle) await sleep(1200);
      if (t % 5 === 0) box(`${n}: finding the post… (${seen.size} read)`);
    }
    if (!r) { record(false, "post not found in TikTok Studio → Posts"); return next(false); }
    r.row.scrollIntoView({ block: "center" });
    await sleep(800);
    if (look() && look().row !== r.row) r = look();
    // Pencil only (data-icon "Pen"), never the ••• menu, which holds Delete.
    const pen = r.row.querySelector('[data-icon=Pen],[data-testid=Pen]');
    const edit = (pen && (pen.closest("[data-tt=components_ActionCell_Container]") || pen.closest("[role=button],button") || pen)) ||
      findBtn(/^edit$|^edit (post|details|description|caption)$/i, r.row);
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
  if (meaningful(now).length >= 15 && !job.overwrite) { record(false, "already has a description now, left as it is", true); return next(false); }
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
