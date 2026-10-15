// FA Vision Autopilot: Fix all (Social autopilot → Fix all tab, admin/fixall.js). Runs on facebook.com,
// instagram.com and x.com, but only in a tab the FA Vision admin opened with one of these jobs (kept per
// tab by background.js):
//   fxscan  – read recent posts (up to job.max, 100): net "fb" = the Facebook Page (facebook.com/FaVisionEnterprise,
//             acting as the Page), "ig" = @favisionent (grid, then each post's caption), "x" = @FaVisionEnt.
//             Returns { id, url, text, kind } per post; the admin flags empty / very short captions and
//             captions without hashtags.
//   fxfix   – Facebook Page or Instagram: for each queued post, open it, use ONLY "Edit post" (Facebook:
//             "Actions for this post" menu) / "Edit" (Instagram: "More options"), never Delete / Archive /
//             Move to trash. Empty or very short caption → paste the new caption; caption without hashtags
//             (mode "tags") → paste the hashtag mix at the end, keeping the text. Re-reads the box before Save
//             (never saves a blank caption), Save / Done, 20–40 s apart, stops on any warning, hands back every
//             job.batch (5) so the admin commits the log (job.cont), never deletes or re-posts.
//   fxreply – X can't edit posts: a self-reply with the caption + hashtags under each post Alexander confirmed.
//   mkedit  – Facebook Marketplace: open marketplace/edit/?listing_id=<id>, read the Description; if it's short
//             or missing the website link, write the fresh description (ends "Order or see more: …/p/ID.html"),
//             press Update / Save. Nothing else on the listing is touched.
// Selectors follow the sites as of Oct 2026 but were NOT checked live (only on local mock pages).
(async () => {
  const VERSION = "2026-10-15.4";     // reported back to the admin with every result (= extension/live.json version)
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
  if (!job || !/^(fxscan|fxfix|fxreply|mkedit)$/.test(job.kind)) return;    // not a Fix all tab: do nothing
  const host = location.hostname;
  const onHost = /facebook\.com$/.test(host) ? "fb" : /instagram\.com$/.test(host) ? "ig" : /(^|\.)x\.com$/.test(host) ? "x" : "";
  const NET = job.kind === "mkedit" ? "mk" : job.net;
  if ((NET === "mk" ? "fb" : NET) !== onHost) return;                        // another site's script in this tab
  job.i = job.i || 0;
  job.res = job.res || [];
  job.hops = job.hops || 0;
  const save = () => bg({ type: "saveJob", job });
  const NAME = { fb: "Facebook Page", ig: "Instagram", x: "X", mk: "Marketplace" }[NET];

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
    d.style.background = bad ? "#c62828" : "#6d28d9";
    document.getElementById("favautomsg").textContent = `FA Vision · Fix all · ${NAME} · ${msg}`;
  }
  async function finish(stopped) {
    const q = job.q || [];
    const more = /^(fxfix|mkedit|fxreply)$/.test(job.kind) && !stopped ? q.length - job.i : 0;
    const out = { kind: job.kind, net: NET, id: job.id, v: VERSION, res: job.res, n: q.length || job.res.length, stopped: stopped || null,
      then: more > 0 && Array.isArray(job.cont) ? job.cont.concat(job.then || []) : job.then || null, ...(more > 0 ? { more } : {}) };
    await bg({ type: "clearJob" });
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }
  const WARN = /temporarily blocked|temporarily restricted|you('|’)re restricted|your account (has been |is )?restricted|we limit how often|you can('|’)t use this feature|try again later|suspicious activity|confirm your identity|too many (attempts|requests)|action blocked|community (guidelines|standards)/i;
  function warning() {
    const t = [...document.querySelectorAll("[role=dialog],[role=alert],[data-testid=toast]")].map(d => d.innerText || "").join("\n");
    const m = t.match(WARN);
    return m ? m[0] : null;
  }
  const visible = el => !!el && el.getClientRects().length > 0;
  const label = el => ((el.getAttribute("aria-label") || "") + " " + (el.innerText || "")).trim();
  function findBtn(re, root) {
    return [...(root || document).querySelectorAll('[role=button],button,[role=menuitem],[role=link],a')].find(b => visible(b) && (re.test((b.getAttribute("aria-label") || "").trim()) || re.test((b.innerText || "").trim())));
  }
  // Never these: the menus that hold them are only read, and only "Edit post" / "Edit" is ever clicked.
  const DANGER = /delete|trash|remove|archive|discard post|turn off commenting|hide from profile/i;
  const enabled = b => b && b.getAttribute("aria-disabled") !== "true" && !b.disabled;
  async function waitFor(fn, ms) { for (let t = 0; t < ms; t += 300) { if (stopAsked) return null; const v = fn(); if (v) return v; await sleep(300); } return null; }
  async function countdown(secs, text) { for (let s = secs; s > 0 && !stopAsked; s--) { box(`${text} ${s} s…`); await sleep(1000); } }
  async function go(url) {
    job.hops++;
    await save();
    if (job.hops > (job.maxHops || 300)) return finish("The site kept sending the tab to another page. Stopped.");
    location.href = url;
  }
  const escKey = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  // Quality gate (admin/captions.js ensure): real text = without hashtags, @mentions and links; 15+ characters.
  const realLen = t => { const m = String(t || "").replace(/https?:\/\/\S+/g, "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim(); return /^(no description|add (a )?description|write a caption\W*)$/i.test(m) ? 0 : m.length; };
  const tagged = t => /(^|\s)#[\p{L}\p{N}_]{2,}/u.test(String(t || ""));
  const BLANK = "blank description — not saved";
  const flat = t => String(t || "").replace(/\s+/g, " ").trim();
  const clip = (t, n) => flat(t).slice(0, n);
  function paste(ed, text, append) {
    ed.focus();
    if (append) {
      const rg = document.createRange(); rg.selectNodeContents(ed); rg.collapse(false);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
    } else { document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); }
    const dt = new DataTransfer(); dt.setData("text/plain", String(text));
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }
  const edText = ed => (ed && (ed.tagName === "TEXTAREA" || ed.tagName === "INPUT") ? ed.value : ed && ed.innerText) || "";

  await sleep(2500);
  if (document.querySelector("input[name=pass]") || /\/login|\/accounts\/login|\/i\/flow\/login/.test(location.pathname)) return finish(`${NAME === "Marketplace" ? "Facebook" : NAME} isn't logged in in this browser. Log in, then press the button again.`);
  let w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);

  // ============================================================= scan
  if (job.kind === "fxscan") {
    const cap = job.max || 100;
    const all = new Map((job.found || []).map(p => [p.id, p]));
    const keep = () => { job.found = [...all.values()]; };
    // ---------- Facebook Page: top-level posts in the feed
    if (NET === "fb") {
      if (!/^\/(FaVisionEnterprise|profile\.php)/i.test(location.pathname)) return go(job.page || "https://www.facebook.com/FaVisionEnterprise");
      box("reading your Page's posts…");
      await waitFor(() => document.querySelector("[role=article]"), 20000);
      const idOf = href => { const s = String(href || ""); const m = s.match(/\/posts\/([\w-]+)|story_fbid=(\d+)|\/videos\/(\d+)|\/reel\/(\d+)|fbid=(\d+)|\/permalink\/(\d+)/); return m ? m.slice(1).find(Boolean) : ""; };
      const read = () => {
        for (const a of document.querySelectorAll("[role=article]")) {
          if (a.parentElement && a.parentElement.closest("[role=article]")) continue;          // a comment, not a post
          const link = [...a.querySelectorAll("a[href]")].find(l => idOf(l.getAttribute("href")));
          const id = link && idOf(link.getAttribute("href"));
          if (!id || all.has(id) || all.size >= cap) continue;
          const msg = a.querySelector('[data-ad-preview="message"],[data-ad-comet-preview="message"],[data-testid=post_message]');
          const head = clip(a.innerText, 300);
          const shared = /\bshared (a|an|their|his|her) (post|link|memory|reel|video|photo)\b/i.test(head) && !msg;
          const href = link.href.split("?")[0].replace(/^https:\/\/web\./, "https://www.");
          all.set(id, { id, url: /story_fbid|fbid=/.test(link.href) ? link.href.replace(/^https:\/\/web\./, "https://www.") : href, text: msg ? clip(msg.innerText, 600) : "", kind: /\/videos\/|\/reel\//.test(href) ? "video" : shared ? "shared" : "post" });
        }
      };
      let idle = 0;
      for (let t = 0; t < 400 && idle < 6 && all.size < cap && !stopAsked; t++) {
        const before = all.size;
        read();
        if (t % 3 === 0) box(`reading your Page's posts… ${all.size} found`);
        window.scrollBy(0, 1400);
        await sleep(1500);
        idle = all.size > before ? 0 : idle + 1;
        w = warning(); if (w) { keep(); job.res = job.found; return finish(`Facebook showed "${w}". Stopped.`); }
      }
      read();
      keep(); job.res = job.found.slice(0, cap); await save();
      box(`Read ${job.res.length} posts. Going back to your admin…`); await sleep(1000);
      return finish(job.res.length ? null : "No posts found on the Page (is Facebook switched to the F.A Vision Page?).");
    }
    // ---------- Instagram: the grid's links, then each post's caption
    if (NET === "ig") {
      const profile = `https://www.instagram.com/${job.account || "favisionent"}/`;
      job.stage = job.stage || "grid";
      if (job.stage === "grid") {
        if (location.pathname.replace(/\/$/, "") !== "/" + (job.account || "favisionent")) return go(profile);
        box("reading your Instagram posts…");
        await waitFor(() => document.querySelector('a[href*="/p/"],a[href*="/reel/"]'), 20000);
        const links = new Map();
        let idle = 0;
        for (let t = 0; t < 200 && idle < 5 && links.size < cap && !stopAsked; t++) {
          const before = links.size;
          for (const a of document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]')) {
            const m = (a.getAttribute("href") || "").match(/\/(p|reel)\/([\w-]+)/);
            if (m && !links.has(m[2]) && links.size < cap) links.set(m[2], { id: m[2], url: `https://www.instagram.com/${m[1]}/${m[2]}/`, kind: m[1] === "reel" ? "video" : "post", alt: clip((a.querySelector("img") || {}).alt, 200) });
          }
          window.scrollBy(0, 1400); await sleep(1500);
          idle = links.size > before ? 0 : idle + 1;
          if (t % 3 === 0) box(`reading your Instagram posts… ${links.size} found`);
        }
        job.list = [...links.values()]; job.j = 0; job.stage = "read"; job.maxHops = job.list.length + 40;
        if (!job.list.length) { job.res = []; return finish("No posts found on your Instagram profile."); }
        await save();
      }
      // stage "read": one post page per load
      if (job.j < job.list.length) {
        const cur = job.list[job.j];
        if (!location.pathname.includes(cur.id)) return go(cur.url);
        box(`reading captions… ${job.j + 1} of ${job.list.length}`);
        const cap1 = await waitFor(() => document.querySelector("article h1, [role=dialog] h1, main h1, h1[dir=auto]"), 6000);
        all.set(cur.id, { id: cur.id, url: cur.url, kind: cur.kind, text: cap1 ? clip(cap1.innerText, 600) : "" });
        keep(); job.j++; await save();
        w = warning(); if (w) { job.res = job.found; return finish(`Instagram showed "${w}". Stopped.`); }
        if (job.j < job.list.length) { await sleep(rand(1200, 2500)); return go(job.list[job.j].url); }
      }
      job.res = job.found || [];
      box(`Read ${job.res.length} captions. Going back to your admin…`); await sleep(1000);
      return finish(null);
    }
    // ---------- X: own posts on the profile
    if (NET === "x") {
      const handle = job.account || "FaVisionEnt";
      if (location.pathname.replace(/\/$/, "").toLowerCase() !== "/" + handle.toLowerCase()) return go("https://x.com/" + handle);
      box("reading your X posts…");
      await waitFor(() => document.querySelector("article[data-testid=tweet]"), 20000);
      let idle = 0;
      const read = () => {
        for (const a of document.querySelectorAll("article[data-testid=tweet]")) {
          const sc = (a.querySelector("[data-testid=socialContext]") || {}).innerText || "";
          if (/reposted/i.test(sc)) continue;
          const link = [...a.querySelectorAll('a[href*="/status/"]')].find(l => new RegExp("^/" + handle + "/status/\\d+", "i").test(l.getAttribute("href") || ""));
          const m = link && link.getAttribute("href").match(/\/status\/(\d+)/);
          if (!m || all.has(m[1]) || all.size >= cap) continue;
          all.set(m[1], { id: m[1], url: `https://x.com/${handle}/status/${m[1]}`, text: clip((a.querySelector("[data-testid=tweetText]") || {}).innerText, 600), kind: "post" });
        }
      };
      for (let t = 0; t < 300 && idle < 6 && all.size < cap && !stopAsked; t++) {
        const before = all.size;
        read(); window.scrollBy(0, 1400); await sleep(1500);
        idle = all.size > before ? 0 : idle + 1;
        if (t % 3 === 0) box(`reading your X posts… ${all.size} found`);
        w = warning(); if (w) { keep(); job.res = job.found; return finish(`X showed "${w}". Stopped.`); }
      }
      read(); keep(); job.res = job.found; await save();
      box(`Read ${job.res.length} posts. Going back…`); await sleep(1000);
      return finish(job.res.length ? null : "No posts found on your X profile.");
    }
    return finish("Unknown network.");
  }

  // ============================================================= one item at a time (fix, reply, Marketplace edit)
  const done = async why => { const ok = job.res.filter(r => r.ok).length; box(`Done: ${ok} of ${job.q.length} fixed. Going back…`); await sleep(1200); return finish(why); };
  if (job.i >= job.q.length) return done();
  const it = job.q[job.i];
  const n = `${job.i + 1} of ${job.q.length}`;
  const record = (ok, why, skip) => { job.res.push({ id: it.id, ok, why: why || "", ...(skip ? { skip: true } : {}), ...(it.mode ? { mode: it.mode } : {}), t: new Date().toISOString() }); job.i++; job.stage = "open"; };
  const batch = job.batch || 5;
  const next = async ok => {
    await save();
    if (job.i >= job.q.length) return done();
    if (job.res.length >= batch && Array.isArray(job.cont)) { box(`${job.res.length} done: saving the log in your admin, then the next ${batch}…`); await sleep(1000); return finish(null); }
    if (ok) await countdown(rand(job.min || 20, job.max || 40), `${n} done. Next in`);
    else await sleep(rand(3000, 5000));
    if (stopAsked) return;
    job.stage = "open"; await save();
    return go(job.q[job.i].url);
  };
  if (job.wait_first && !job.waited) {          // a later batch: keep the 20–40 s gap
    job.waited = true; await save();
    await countdown(rand(job.min || 20, job.max || 40), "Next in");
    if (stopAsked) return;
  }
  job.stage = job.stage || "open";
  if (job.stage === "open") {
    job.stage = "work"; await save();
    const here = location.href.split("#")[0].replace(/^https:\/\/web\./, "https://www.");
    if (here !== it.url) return go(it.url);
  }
  if (job.stage === "after") { record(true, "saved"); return next(true); }

  // Put the new caption in (or the hashtags at the end) and check it really is there.
  async function fill(ed) {
    const now = edText(ed);
    const mode = realLen(now) < 15 ? "set" : !tagged(now) ? "tags" : "fine";
    if (mode === "fine") return "fine";
    const text = mode === "set" ? it.text : "\n\n" + String(it.tags || "").trim();
    if (mode === "tags" && !tagged(text)) return "fine";
    paste(ed, text, mode === "tags");
    await sleep(1000);
    const probe = mode === "set" ? clip(String(it.text).split("\n").find(l => l.trim()) || "", 25) : (text.match(/#[\p{L}\p{N}_]+/u) || [""])[0];
    if (!flat(edText(ed)).includes(probe)) {          // fallback: type it
      if (mode === "set") { ed.focus(); document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); }
      document.execCommand("insertText", false, text);
      await sleep(900);
    }
    if (!flat(edText(ed)).includes(probe) || realLen(edText(ed)) < 15) return "failed";
    it.mode = mode;
    return mode;
  }

  // ---------- Facebook Page post: "Actions for this post" → "Edit post" → caption → Save
  if (job.kind === "fxfix" && NET === "fb") {
    box(`${n}: opening the post…`);
    const art = await waitFor(() => [...document.querySelectorAll("[role=article]")].find(a => visible(a) && !(a.parentElement && a.parentElement.closest("[role=article]"))), 20000);
    if (!art) { record(false, "the post didn't open (deleted, or not visible to the Page?)"); return next(false); }
    const act = [...art.querySelectorAll("[role=button][aria-label]")].find(b => /^actions for this post$/i.test(b.getAttribute("aria-label")));
    if (!act) { record(false, "no “Actions for this post” button (switch Facebook to the F.A Vision Page)"); return next(false); }
    act.click();
    const edit = await waitFor(() => [...document.querySelectorAll("[role=menu] [role=menuitem],[role=dialog] [role=menuitem]")].find(m => visible(m) && /^edit post$/i.test(flat(m.innerText || m.getAttribute("aria-label")))), 6000);
    if (!edit || DANGER.test(label(edit))) { escKey(); record(false, "no “Edit post” in the post's menu (shared posts and some reels can't be edited)"); return next(false); }
    edit.click();
    const ed = await waitFor(() => [...document.querySelectorAll("[role=dialog] [contenteditable=true][role=textbox]")].find(visible), 12000);
    if (!ed) { escKey(); record(false, "the Edit post box didn't open"); return next(false); }
    const dialog = ed.closest("[role=dialog]");
    await sleep(800);
    const r = await fill(ed);
    if (r === "fine") { const c = findBtn(/^close$/i, dialog); if (c) c.click(); else escKey(); record(false, "already has a description and hashtags, left as it is", true); return next(false); }
    if (r === "failed") { const c = findBtn(/^close$/i, dialog); if (c) c.click(); else escKey(); await sleep(800); const dsc = findBtn(/^(discard|leave)$/i); if (dsc && !DANGER.test(label(dsc).replace(/discard/i, ""))) dsc.click(); record(false, "couldn't put the caption in (nothing saved)"); return next(false); }
    const sv = await waitFor(() => { const b = findBtn(/^save$/i, dialog); return enabled(b) ? b : null; }, 10000);
    if (!sv) { record(false, "no Save button (nothing was changed)"); return next(false); }
    await sleep(rand(800, 1500));
    if (realLen(edText(ed)) < 15) { record(false, BLANK); return next(false); }
    w = warning(); if (w) return finish(`Facebook showed "${w}". Stopped.`);
    job.stage = "after"; await save();
    sv.click();
    box(`${n}: saving…`);
    const ok = await waitFor(() => !document.contains(ed) || !visible(ed), 30000);
    await sleep(1500);
    w = warning(); if (w) { job.stage = "open"; record(false, w); await save(); return finish(`Facebook showed "${w}". Stopped.`); }
    job.stage = "open";
    record(!!ok, ok ? (it.mode === "tags" ? "hashtags added" : "caption added") : "Facebook didn't confirm the save");
    return next(!!ok);
  }

  // ---------- Instagram post: "More options" → "Edit" → caption → Done
  if (job.kind === "fxfix" && NET === "ig") {
    box(`${n}: opening the post…`);
    const more = await waitFor(() => { const svg = [...document.querySelectorAll('svg[aria-label="More options"]')].find(visible); return svg ? svg.closest("[role=button],button") || svg : null; }, 15000);
    if (!more) { record(false, "no “More options” button on the post"); return next(false); }
    more.click();
    const edit = await waitFor(() => [...document.querySelectorAll("[role=dialog] button,[role=dialog] [role=button]")].find(b => visible(b) && /^edit$/i.test(flat(b.innerText))), 6000);
    if (!edit || DANGER.test(label(edit))) { escKey(); record(false, "no “Edit” in the post's menu"); return next(false); }
    edit.click();
    const ed = await waitFor(() => [...document.querySelectorAll("[role=dialog] [contenteditable=true],[role=dialog] textarea")].find(visible), 12000);
    if (!ed) { escKey(); record(false, "the caption box didn't open"); return next(false); }
    const dialog = ed.closest("[role=dialog]") || document;
    await sleep(800);
    const r = await fill(ed);
    const cancel = async () => { const c = findBtn(/^cancel$/i, dialog); if (c) c.click(); else escKey(); await sleep(800); };
    if (r === "fine") { await cancel(); record(false, "already has a caption and hashtags, left as it is", true); return next(false); }
    if (r === "failed") { await cancel(); record(false, "couldn't put the caption in (nothing saved)"); return next(false); }
    const dn = await waitFor(() => { const b = findBtn(/^done$/i, dialog); return enabled(b) ? b : null; }, 10000);
    if (!dn) { await cancel(); record(false, "no Done button (nothing was changed)"); return next(false); }
    await sleep(rand(800, 1500));
    if (realLen(edText(ed)) < 15) { await cancel(); record(false, BLANK); return next(false); }
    job.stage = "after"; await save();
    dn.click();
    box(`${n}: saving…`);
    const ok = await waitFor(() => !document.contains(ed) || !visible(ed), 30000);
    await sleep(1500);
    w = warning(); if (w) { job.stage = "open"; record(false, w); await save(); return finish(`Instagram showed "${w}". Stopped.`); }
    job.stage = "open";
    record(!!ok, ok ? (it.mode === "tags" ? "hashtags added" : "caption added") : "Instagram didn't confirm the save");
    return next(!!ok);
  }

  // ---------- X: reply to our own post with the caption + hashtags (X posts can't be edited)
  if (job.kind === "fxreply") {
    box(`${n}: opening the post…`);
    if (realLen(it.text) < 15 || String(it.text).length > 280) { record(false, "blank description — not posted"); return next(false); }
    const art = await waitFor(() => [...document.querySelectorAll("article[data-testid=tweet]")].find(a => [...a.querySelectorAll('a[href*="/status/"]')].some(l => (l.getAttribute("href") || "").includes("/status/" + it.id))), 20000);
    if (!art) { record(false, "the post didn't open"); return next(false); }
    const rb = art.querySelector("[data-testid=reply]");
    if (!rb) { record(false, "no Reply button"); return next(false); }
    rb.click();
    const ed = await waitFor(() => [...document.querySelectorAll('[role=dialog] [data-testid=tweetTextarea_0][contenteditable=true],[role=dialog] [data-testid=tweetTextarea_0] [contenteditable=true]')].find(visible), 12000);
    if (!ed) { record(false, "the reply box didn't open"); return next(false); }
    const dialog = ed.closest("[role=dialog]");
    paste(ed, it.text); await sleep(900);
    if (realLen(edText(ed)) < 15) { ed.focus(); document.execCommand("insertText", false, it.text); await sleep(800); }
    if (realLen(edText(ed)) < 15) { const c = findBtn(/^close$/i, dialog); if (c) c.click(); record(false, "blank description — not posted"); return next(false); }
    const post = await waitFor(() => { const b = dialog.querySelector("[data-testid=tweetButton]"); return enabled(b) ? b : null; }, 15000);
    if (!post) { record(false, "Reply button stayed off"); return next(false); }
    await sleep(rand(800, 1500));
    w = warning(); if (w) return finish(`X showed "${w}". Stopped.`);
    post.click();
    const ok = await waitFor(() => !document.contains(ed) || !visible(ed), 30000);
    await sleep(1500);
    w = warning(); if (w) { record(false, w); await save(); return finish(`X showed "${w}". Stopped.`); }
    record(!!ok, ok ? "reply added" : "X didn't confirm the reply");
    return next(!!ok);
  }

  // ---------- Marketplace listing: Description only, then Update
  if (job.kind === "mkedit") {
    if (document.querySelector("input[name=pass]")) return finish("Facebook isn't logged in. Log in (personal profile), then try again.");
    if (/pages can('|’)t use marketplace/i.test((document.body.innerText || "").slice(0, 3000))) return finish("Facebook is using your F.A Vision Page, and Pages can't use Marketplace. Switch to your personal profile, then try again.");
    box(`${n}: opening the listing…`);
    const lab = re => [...document.querySelectorAll("label")].filter(visible).find(l => re.test((l.getAttribute("aria-label") || "").trim()) || re.test(((l.innerText || "").trim().split("\n")[0] || "")));
    const field = re => { const l = lab(re); return l && (l.matches("input,textarea") ? l : l.querySelector("textarea,input:not([type=file]):not([type=checkbox])")); };
    const desc = await waitFor(() => field(/^description$/i), 20000);
    if (!desc) { record(false, "the listing's edit form didn't open (sold, removed, or not your listing?)"); return next(false); }
    const now = desc.value || "";
    const link = "favisionenterprize.github.io/p/";
    if (realLen(now) >= (job.min_len || 60) && now.includes(link)) { record(false, "already has a full description with the website link", true); return next(false); }
    if (realLen(it.text) < 15) { record(false, "blank description — not saved"); return next(false); }
    desc.focus(); desc.select();
    document.execCommand("insertText", false, it.text);
    if ((desc.value || "").replace(/\W/g, "") !== String(it.text).replace(/\W/g, "")) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(desc, it.text);
      desc.dispatchEvent(new Event("input", { bubbles: true })); desc.dispatchEvent(new Event("change", { bubbles: true }));
    }
    desc.blur();
    await sleep(rand(600, 1000));
    if (realLen(desc.value) < 15 || !desc.value.includes(link)) { record(false, "couldn't put the description in (nothing saved)"); return next(false); }
    const up = await waitFor(() => { const b = findBtn(/^(update|save|save changes)$/i); return enabled(b) && !DANGER.test(label(b)) ? b : null; }, 15000);
    if (!up) { record(false, "no Update button (nothing was changed)"); return next(false); }
    await sleep(rand(800, 1500));
    w = warning(); if (w) return finish(`Facebook showed "${w}". Stopped.`);
    job.stage = "after"; await save();
    up.click();
    box(`${n}: saving…`);
    const ok = await waitFor(() => !/\/marketplace\/edit/.test(location.pathname) || !document.contains(desc) || /listing (was )?updated|changes saved/i.test(document.body.innerText.slice(0, 3000)), 30000);
    await sleep(1500);
    w = warning(); if (w) { job.stage = "open"; record(false, w); await save(); return finish(`Facebook showed "${w}". Stopped.`); }
    job.stage = "open";
    record(!!ok, ok ? "description updated" : "Facebook didn't confirm the update");
    return next(!!ok);
  }
  return finish("Unknown job.");
})();
