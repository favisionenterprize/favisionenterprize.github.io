// FA Vision Autopilot: Engagement. Runs on facebook.com, instagram.com, x.com and tiktok.com, but
// only in a tab the FA Vision admin opened with an "engage" job (kept per tab by background.js).
// For one network per job:
//   1. collect – open the profile/Page, read the follower count, scroll and list every post;
//   2. visit   – open each post, read its likes / comments / shares (views where shown) and, when
//                the job carries a comment, add it (skipped if that post already has it), pausing
//                between comments so the account isn't flagged.
// Stops at once on any warning and returns to the admin with the results (admin/engage.js).
// Facebook commenting was checked live (Oct 2026, as the Page: "Comment as F.A Vision Enterprise",
// type, Enter). Instagram, X and TikTok selectors follow their current pages but weren't checked live.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const bg = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r || {})); } catch (e) { res({}); } });
  let job = null;
  try { job = (await bg({ type: "getJob" })).job || null; } catch (e) { job = null; }
  if (!job || job.kind !== "engage") return;
  const NET = job.net;
  const NAME = { fb: "Facebook", ig: "Instagram", x: "X", tiktok: "TikTok" }[NET] || NET;
  job.stage = job.stage || "collect";
  job.urls = job.urls || [];
  job.i = job.i || 0;
  job.res = job.res || [];
  const save = () => bg({ type: "saveJob", job });

  // ------------------------------------------------------------- status box with a Stop button
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
    d.style.background = bad ? "#c62828" : "#6a1b9a";
    document.getElementById("favautomsg").textContent = `FA Vision · ${NAME} engagement · ${msg}`;
  }
  async function finish(stopped) {
    const out = { kind: "engage", net: NET, id: job.id, res: job.res, followers: job.followers == null ? null : job.followers, posts: job.urls.length,
      stopped: stopped || null, then: job.then || null, commenting: !!job.text && !job.statsOnly, handle: job.handle || null };
    await bg({ type: "clearJob" });
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }
  const WARN = /temporarily blocked|temporarily restricted|you('|’)re restricted|we limit how often|you can('|’)t (use this feature|comment|post) right now|try again later|suspicious activity|confirm (your identity|it('|’)s you)|action blocked|rate limit|too many (comments|requests)/i;
  function warning() {
    const t = [...document.querySelectorAll("[role=dialog],[role=alert],[data-testid=toast]")].map(d => d.innerText || "").join("\n");
    const hit = t.match(WARN);
    return hit ? hit[0] : null;
  }
  const visible = el => !!el && el.getClientRects().length > 0;
  async function waitFor(fn, ms) {
    for (let t = 0; t < ms; t += 300) { if (stopAsked) return null; const v = fn(); if (v) return v; await sleep(300); }
    return null;
  }
  async function countdown(secs, text) {
    for (let s = secs; s > 0 && !stopAsked; s--) { box(`${text} ${s} s…`); await sleep(1000); }
  }
  // "1,234" "1.2K" "3M" → number
  function num(s) {
    if (s == null) return null;
    const m = String(s).replace(/\s/g, "").match(/([\d.,]+)\s*([KkMm])?/);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(n)) return null;
    if (/k/i.test(m[2] || "")) n *= 1000;
    if (/m/i.test(m[2] || "")) n *= 1000000;
    return Math.round(n);
  }
  const textNum = (re, txt) => { const m = (txt || document.body.innerText).match(re); return m ? num(m[1]) : null; };
  const go = url => { location.href = url; };

  // ------------------------------------------------------------- per network
  const handle = job.handle || "";
  const PROFILE = {
    fb: `https://www.facebook.com/${handle || "FaVisionEnterprise"}/`,
    ig: `https://www.instagram.com/${handle || "favisionent"}/`,
    x: `https://x.com/${handle || "FaVisionEnt"}`,
    tiktok: handle ? `https://www.tiktok.com/@${handle.replace(/^@/, "")}` : "https://www.tiktok.com/"
  }[NET];

  function followers() {
    const t = document.body.innerText;
    if (NET === "fb") return textNum(/([\d.,]+\s*[KkMm]?)\s+followers/i, t);
    if (NET === "ig") {
      const a = [...document.querySelectorAll("a[href$='/followers/'], header li, header section span")].map(e => e.innerText || e.getAttribute("title") || "").find(x => /followers/i.test(x));
      const v = num((a || "").replace(/followers/i, ""));
      return v != null ? v : textNum(/([\d.,]+\s*[KkMm]?)\s+followers/i, t);
    }
    if (NET === "x") {
      const a = [...document.querySelectorAll("a[href$='/verified_followers'], a[href$='/followers']")].map(e => e.innerText).find(x => /followers/i.test(x || ""));
      const v = num(a);
      return v != null ? v : textNum(/([\d.,]+\s*[KkMm]?)\s+Followers/i, t);
    }
    if (NET === "tiktok") { const e = document.querySelector("[data-e2e='followers-count']"); return e ? num(e.innerText) : textNum(/([\d.,]+\s*[KkMm]?)\s+Followers/i, t); }
    return null;
  }
  function links() {
    const out = new Set();
    const as = [...document.querySelectorAll("a[href]")];
    if (NET === "fb") {
      as.forEach(a => { a.dispatchEvent(new FocusEvent("focus")); a.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
      const own = new RegExp(`/${handle || "FaVisionEnterprise"}/(posts|videos)/`, "i");
      as.forEach(a => {
        const h = a.href.split("?")[0];
        if (own.test(h)) out.add(h.replace(/\/\/(web|m)\.facebook/, "//www.facebook"));
        else { const m = a.href.match(/set=pcb\.(\d+)/); if (m) out.add("https://www.facebook.com/" + m[1]); }
      });
    } else if (NET === "ig") {
      as.forEach(a => { const m = (a.getAttribute("href") || "").match(/^\/(?:[\w.]+\/)?(p|reel)\/([\w-]+)/); if (m) out.add(`https://www.instagram.com/${m[1]}/${m[2]}/`); });
    } else if (NET === "x") {
      const re = new RegExp(`^/${handle || "FaVisionEnt"}/status/(\\d+)$`, "i");
      as.forEach(a => { const m = (a.getAttribute("href") || "").match(re); if (m) out.add(`https://x.com/${handle || "FaVisionEnt"}/status/${m[1]}`); });
    } else if (NET === "tiktok") {
      as.forEach(a => { if (/\/@[\w.]+\/(video|photo)\/\d+/.test(a.href)) out.add(a.href.split("?")[0]); });
    }
    return [...out];
  }
  function stats() {
    const t = document.body.innerText;
    const s = { likes: null, comments: null, shares: null, views: null };
    if (NET === "fb") {
      s.likes = textNum(/All reactions:\s*\n?\s*([\d.,]+\s*[KkMm]?)/i, t);
      if (s.likes == null) { const l = [...document.querySelectorAll("[aria-label]")].map(e => e.getAttribute("aria-label")).find(x => /^(Like|Reactions?):?\s*[\d.,]+/i.test(x || "")); s.likes = l ? num(l.replace(/^\D+/, "")) : null; }
      s.comments = textNum(/([\d.,]+\s*[KkMm]?)\s+comments?\b/i, t);
      s.shares = textNum(/([\d.,]+\s*[KkMm]?)\s+shares?\b/i, t);
      s.views = textNum(/([\d.,]+\s*[KkMm]?)\s+views?\b/i, t);
    } else if (NET === "ig") {
      s.likes = textNum(/([\d.,]+\s*[KkMm]?)\s+likes?\b/i, t);
      s.views = textNum(/([\d.,]+\s*[KkMm]?)\s+(views|plays)\b/i, t);
      s.comments = textNum(/View all ([\d.,]+) comments/i, t);
    } else if (NET === "x") {
      const g = [...document.querySelectorAll("article [role=group][aria-label]")].map(e => e.getAttribute("aria-label"))[0] || "";
      s.comments = textNum(/([\d.,]+)\s+repl/i, g); s.shares = textNum(/([\d.,]+)\s+repost/i, g); s.likes = textNum(/([\d.,]+)\s+like/i, g); s.views = textNum(/([\d.,]+)\s+view/i, g);
    } else if (NET === "tiktok") {
      const v = sel => { const e = document.querySelector(sel); return e ? num(e.innerText) : null; };
      s.likes = v("[data-e2e='like-count'],[data-e2e='browse-like-count']"); s.comments = v("[data-e2e='comment-count'],[data-e2e='browse-comment-count']");
      s.shares = v("[data-e2e='share-count']"); s.views = v("[data-e2e='video-views']");
    }
    return s;
  }
  // True when this post already shows our comment (this text, or the standard "where are you seeing this from" ask).
  function hasOurs(text) {
    const t = document.body.innerText;
    const probe = String(text || "").replace(/^[^\w]+/, "").slice(0, 36);
    return (probe && t.includes(probe)) || /where are you (seeing|watching) this|which town are you seeing|where you're watching this|where you're seeing this/i.test(t);
  }
  function typeInto(el, text) {
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    if (el.tagName === "TEXTAREA" && !el.value) {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  const contentOf = el => (el.tagName === "TEXTAREA" ? el.value : el.innerText || "").trim();
  async function comment(text) {
    let input = null, send = null;
    if (NET === "fb") {
      const all = () => [...document.querySelectorAll("[contenteditable=true][role=textbox]")].filter(visible).filter(e => /comment/i.test(e.getAttribute("aria-label") || e.getAttribute("aria-placeholder") || ""));
      input = await waitFor(() => all().find(e => /Comment as F\.A Vision/i.test(e.getAttribute("aria-label") || "")) || all()[0], 8000);
      if (!input) return "no comment box";
      input.scrollIntoView({ block: "center" }); await sleep(600);
      typeInto(input, text); await sleep(800);
      if (!contentOf(input)) return "couldn't type";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    } else if (NET === "ig") {
      input = await waitFor(() => [...document.querySelectorAll("textarea")].find(e => visible(e) && /comment/i.test(e.getAttribute("aria-label") || e.placeholder || "")), 8000);
      if (!input) return "no comment box (comments may be off)";
      input.scrollIntoView({ block: "center" }); input.click(); await sleep(600);
      typeInto(input, text); await sleep(800);
      if (!contentOf(input)) return "couldn't type";
      send = await waitFor(() => [...(input.closest("form") || document).querySelectorAll("[role=button],button")].find(b => visible(b) && /^post$/i.test((b.innerText || "").trim()) && b.getAttribute("aria-disabled") !== "true"), 6000);
      if (!send) return "Post button stayed off";
      send.click();
    } else if (NET === "x") {
      const box2 = await waitFor(() => [...document.querySelectorAll("[data-testid=tweetTextarea_0]")].find(visible), 8000);
      if (!box2) return "no reply box";
      box2.scrollIntoView({ block: "center" }); box2.click(); await sleep(600);
      input = box2.querySelector("[contenteditable=true]") || box2;
      typeInto(input, text); await sleep(900);
      send = await waitFor(() => { const b = document.querySelector("[data-testid=tweetButtonInline]"); return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null; }, 6000);
      if (!send) return "Reply button stayed off";
      send.click();
    } else if (NET === "tiktok") {
      input = await waitFor(() => document.querySelector("[data-e2e='comment-input'] [contenteditable=true], [data-e2e='comment-input'] .public-DraftEditor-content"), 8000);
      if (!input) return "no comment box";
      input.scrollIntoView({ block: "center" }); input.click(); await sleep(600);
      typeInto(input, text); await sleep(900);
      if (!contentOf(input)) return "couldn't type";
      send = await waitFor(() => { const b = document.querySelector("[data-e2e='comment-post']"); return b && b.getAttribute("aria-disabled") !== "true" ? b : null; }, 6000);
      if (!send) return "Post button stayed off";
      send.click();
    }
    const cleared = await waitFor(() => !contentOf(input), 10000);
    await sleep(1500);
    const w = warning(); if (w) return "warning: " + w;
    return cleared ? "" : "not confirmed";
  }

  await sleep(3500);
  if (/\/login|accounts\/login|i\/flow\/login/.test(location.pathname)) return finish(`${NAME} isn't logged in in this browser. Log in, then press the button again.`);
  let w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);

  // ------------------------------------------------------------- 1. collect
  if (job.stage === "collect") {
    if (!job.navved) { job.navved = 1; await save(); return go(PROFILE); }
    if (NET === "tiktok" && !handle) {
      const me = await waitFor(() => document.querySelector("a[data-e2e='nav-profile'][href*='/@']"), 10000);
      if (!me) return finish("Couldn't find your TikTok profile. Type your TikTok username in the Engagement settings, then try again.");
      job.handle = me.getAttribute("href").match(/@([\w.]+)/)[1];
      await save();
      return go(`https://www.tiktok.com/@${job.handle}`);
    }
    box("reading followers and listing your posts…");
    await sleep(2500);
    job.followers = followers();
    const found = new Set(links());
    let same = 0;
    for (let i = 0; i < (job.scrolls || 60) && same < 5 && !stopAsked && found.size < (job.limit || 200); i++) {
      window.scrollBy(0, Math.round(innerHeight * 1.6));
      await sleep(rand(1800, 2800));
      const before = found.size;
      links().forEach(u => found.add(u));
      same = found.size === before ? same + 1 : 0;
      box(`listing your posts… ${found.size} found${job.followers != null ? ` · ${job.followers} followers` : ""}`);
      w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);
    }
    if (stopAsked) return;
    job.urls = [...found].slice(0, job.limit || 200);
    job.stage = "visit"; job.i = 0; job.at = -1;
    await save();
    if (!job.urls.length) return finish(`No posts found on your ${NAME} profile.`);
  }

  // ------------------------------------------------------------- 2. visit each post
  if (job.i >= job.urls.length) { box("All done. Going back to your admin…"); await sleep(1200); return finish(); }
  const url = job.urls[job.i];
  if (job.at !== job.i) { job.at = job.i; await save(); return go(url); }
  const n = `Post ${job.i + 1} of ${job.urls.length}`;
  box(`${n}: reading likes and comments…`);
  await sleep(rand(2500, 4000));
  w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);
  const title = (document.title || "").replace(/\s*[|·-]\s*(Facebook|Instagram|X|TikTok).*$/i, "").replace(/^\(\d+\)\s*/, "").slice(0, 90);
  const ours = NET !== "fb" || /F\.A Vision|FaVision/i.test(document.title);
  const s = stats();
  let commented = false, why = "";
  if (job.text && !job.statsOnly) {
    if (!ours) why = "not our post (shared)";
    else if (hasOurs(job.text)) why = "already has our comment";
    else if ((job.done || 0) >= (job.max_comments || 60)) why = "comment limit for this run reached";
    else {
      box(`${n}: commenting…`);
      const err = await comment(job.text);
      if (err.startsWith("warning:")) { job.res.push({ url, title, ...s, commented: false, why: err }); job.i++; await save(); return finish(`${NAME} showed "${err.slice(9)}". Stopped so the account stays safe.`); }
      commented = !err; why = err;
      if (commented) { job.done = (job.done || 0) + 1; if (s.comments != null) s.comments++; }
    }
  }
  job.res.push({ url, title, ...s, commented, why, t: new Date().toISOString() });
  job.i++;
  await save();
  if (job.i >= job.urls.length) { box("All done. Going back to your admin…"); await sleep(1200); return finish(); }
  if (commented) await countdown(rand(job.min || 20, job.max || 45), `${n}: commented ✓ (${job.done} so far). Next post in`);
  else await sleep(rand(1200, 2200));
  if (stopAsked) return;
  job.at = job.i; await save();
  go(job.urls[job.i]);
})();
