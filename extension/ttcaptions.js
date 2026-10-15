// FA Vision Autopilot: TikTok captions. Runs on tiktok.com, but only in a tab the FA Vision admin opened
// with one of these jobs (kept per tab by background.js):
//   ttscan – TikTok Studio → Posts (tiktokstudio/content): scroll through every post and read its id,
//            description and thumbnail (with its alt text, which often says what the photo/video shows).
//            The admin flags the ones with no real description (under 15 characters, or hashtags only).
//   ttfix  – for each queued post: open its Edit from the Posts list, check it still has no real
//            description, type the new caption into the description box and press Save. One post at a
//            time, 20–40 s apart; stops at once on any warning. Never deletes or re-posts anything.
// Results go back to the admin (admin/ttcaptions.js). Selectors are a best guess at TikTok Studio as of
// Oct 2026 and were NOT checked live (only on local mock pages).
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
  job.stage = job.stage || "list";
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
    const out = { kind: job.kind, id: job.id, res: job.res, stopped: stopped || null, then: job.then || null };
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

  // Rows of the Posts list: anything holding a link to one post (video or photo) and its thumbnail.
  function rows() {
    const out = [], seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/video/"],a[href*="/photo/"],a[href*="/tiktokstudio/content/"]')) {
      const m = (a.getAttribute("href") || "").match(/\/(?:video|photo|content)\/(\d{6,})/);
      if (!m || seen.has(m[1])) continue;
      let row = a;
      for (let k = 0; k < 8 && row.parentElement; k++) {
        const up = row.parentElement;
        const ids = new Set([...up.querySelectorAll('a[href*="/video/"],a[href*="/photo/"],a[href*="/tiktokstudio/content/"]')].map(x => ((x.getAttribute("href") || "").match(/\/(?:video|photo|content)\/(\d{6,})/) || [])[1]).filter(Boolean));
        if (ids.size > 1) break;
        row = up;
        if (row.getAttribute("role") === "row" || row.querySelector("img") && (row.innerText || "").length > 20) break;
      }
      seen.add(m[1]);
      const im = row.querySelector("img");
      const descEl = row.querySelector('[data-tt*="Desc"],[class*="desc"],[class*="Desc"],[class*="caption"],[class*="title"]');
      const lines = (row.innerText || "").split("\n").map(x => x.trim()).filter(Boolean)
        .filter(x => !/^(\d[\d.,]*[KkMm]?|public|everyone|friends|only me|private|edit|\.\.\.|…|pinned|views?|likes?|comments?|shares?|\d{1,2}[:/]\d{1,2}.*|[A-Z][a-z]{2} \d{1,2}(, \d{4})?.*)$/i.test(x));
      out.push({ id: m[1], url: a.href.split("?")[0], desc: clip(descEl ? descEl.innerText : lines[0] || "", 300), thumb: im && /^https:/.test(im.src) ? im.src.slice(0, 600) : "", alt: clip(im && im.alt, 200), row });
    }
    return out;
  }

  await sleep(3000);
  if (/\/login/.test(location.pathname)) return finish("TikTok isn't logged in in this browser. Log in, then press the button again.");
  let w = warning(); if (w) return finish(`TikTok showed "${w}". Stopped.`);

  // ============================================================= scan
  if (job.kind === "ttscan") {
    if (!onContent()) return go(CONTENT);
    box("reading your posts…");
    await waitFor(() => rows().length, 20000);
    const all = new Map();
    let same = 0;
    for (let t = 0; t < (job.scrolls || 80) && same < 5 && !stopAsked; t++) {
      const before = all.size;
      rows().forEach(r => { if (!all.has(r.id)) all.set(r.id, { id: r.id, url: r.url, desc: r.desc, thumb: r.thumb, alt: r.alt }); });
      box(`reading your posts… ${all.size} found`);
      const sc = [...document.querySelectorAll("main, [role=main], div")].filter(x => x.scrollHeight > x.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(x).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      (sc || window).scrollBy(0, 1400);
      await sleep(rand(1500, 2400));
      same = all.size === before ? same + 1 : 0;
      w = warning(); if (w) { job.res = [...all.values()]; return finish(`TikTok showed "${w}". Stopped.`); }
    }
    if (stopAsked) return;
    job.res = [...all.values()];
    await save();
    box(`Read ${job.res.length} posts. Going back to your admin…`);
    await sleep(1000);
    return finish(job.res.length ? null : "No posts found in TikTok Studio → Posts.");
  }

  // ============================================================= fix: one post at a time
  // job.q: [{ id, url, text }]
  const done = async why => { box(`Done: ${job.res.filter(r => r.ok).length} captions added. Going back…`); await sleep(1000); return finish(why); };
  if (job.i >= job.q.length) return done();
  const it = job.q[job.i];
  const n = `Post ${job.i + 1} of ${job.q.length}`;
  const record = (ok, why) => { job.res.push({ id: it.id, ok, why: why || "", t: new Date().toISOString() }); job.i++; job.stage = "list"; };
  const next = async ok => {
    await save();
    if (job.i >= job.q.length) return done();
    if (ok) await countdown(rand(job.min || 20, job.max || 40), `${n} done. Next post in`);
    if (stopAsked) return;
    return go(CONTENT);
  };
  const editor = () => [...document.querySelectorAll('.public-DraftEditor-content[contenteditable=true],[contenteditable=true][role=textbox],[contenteditable=true]')].find(visible);

  if (job.stage === "after") {   // the page changed after Save
    record(true, "saved (page reloaded before TikTok confirmed)");
    return next(true);
  }
  if (job.stage === "list") {
    if (!onContent()) return go(CONTENT);
    box(`${n}: finding the post…`);
    await waitFor(() => rows().length, 20000);
    let r = null;
    for (let t = 0; t < 40 && !r && !stopAsked; t++) {
      r = rows().find(x => x.id === it.id);
      if (!r) { (document.querySelector("main") || window).scrollBy(0, 1400); window.scrollBy(0, 1400); await sleep(1500); }
    }
    if (!r) { record(false, "post not found in TikTok Studio → Posts"); return next(false); }
    r.row.scrollIntoView({ block: "center" });
    await sleep(800);
    let edit = findBtn(/^edit$|^edit (post|details|description)$/i, r.row);
    if (!edit) {
      const more = [...r.row.querySelectorAll("[role=button],button")].find(b => visible(b) && /^(more|more options|\.\.\.|…)$/i.test((b.getAttribute("aria-label") || b.innerText || "").trim()));
      if (more) { more.click(); await sleep(1000); edit = await waitFor(() => [...document.querySelectorAll("[role=menuitem],[role=option],li,[role=button],button")].find(x => visible(x) && /^edit( post| details| description)?$/i.test((x.innerText || "").trim())), 5000); }
    }
    if (!edit) { record(false, "couldn't find Edit for this post"); return next(false); }
    job.stage = "edit";
    await save();
    edit.click();
    const box1 = await waitFor(editor, 15000);
    if (!box1) {
      if (onContent()) { record(false, "the edit page didn't open"); return next(false); }
      return;                     // the page is loading the editor: this script carries on there (stage "edit")
    }
  }
  // stage "edit"
  box(`${n}: adding the caption…`);
  const ed = await waitFor(editor, 20000);
  if (!ed) { record(false, "the edit page didn't open"); return next(false); }
  w = warning(); if (w) return finish(`TikTok showed "${w}". Stopped.`);
  const now = ed.innerText || "";
  if (meaningful(now).length >= 15 && !job.overwrite) { record(false, "already has a description now, left as it is"); return next(false); }
  ed.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);
  await sleep(400);
  document.execCommand("insertText", false, it.text);
  await sleep(1200);
  const probe = it.text.split("\n")[0].slice(0, 20);
  if (!(ed.innerText || "").includes(probe)) { record(false, "couldn't type the caption"); return next(false); }
  const btn = await waitFor(() => { const b = findBtn(/^(save|save changes|update)$/i); return b && b.getAttribute("aria-disabled") !== "true" && !b.disabled ? b : null; }, 10000);
  if (!btn) { record(false, "no Save button (nothing was changed)"); return next(false); }
  await sleep(rand(800, 1500));
  job.stage = "after";            // saved before the click, in case Save reloads the page
  await save();
  btn.click();
  box(`${n}: saving…`);
  const ok = await waitFor(() => /saved|updated|changes (have been )?saved/i.test([...document.querySelectorAll("[role=alert],[class*=toast],[class*=Toast]")].map(x => x.innerText || "").join(" ")) || !document.contains(btn) || onContent(), 20000);
  await sleep(1500);
  w = warning(); if (w) { record(false, w); await save(); return finish(`TikTok showed "${w}". Stopped.`); }
  record(!!ok, ok ? "" : "TikTok didn't confirm the save");
  return next(!!ok);
})();
