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
      stopped: stopped || null, then: job.then || null, commenting: !!job.text && !job.statsOnly && job.mode !== "reply" && job.mode !== "invite" && job.mode !== "likers", mode: job.mode || "comment", handle: job.handle || null };
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

  // ------------------------------------------------------------- replies to everyone who commented
  const OWN = new RegExp(`F\\.A Vision|FaVision|^@?${(handle || "favisionent").replace(/[.]/g, "\\.")}$`, "i");
  const firstName = nm => String(nm || "").replace(/^@/, "").trim().split(/\s+/)[0] || "there";
  const replyText = nm => String(job.reply_text || "Thank you {name}! 🙏").replace(/\{name\}/g, firstName(nm));
  async function expandComments() {
    for (let i = 0; i < 6; i++) {
      const more = [...document.querySelectorAll("[role=button],button")].find(b => visible(b) && /^(View (more|all|previous|\d+ more) (comments?|replies)|View \d+ repl(y|ies)|See more comments|Load more comments|View more replies)/i.test((b.innerText || "").trim()));
      if (!more) break;
      more.click(); await sleep(rand(1500, 2500));
    }
  }
  // Returns [{ name, el }] for comments by other people, in page order.
  function commenters() {
    const out = [], seen = new Set();
    if (NET === "fb") {
      document.querySelectorAll("[role=article][aria-label^='Comment by'], [role=article][aria-label^='Reply by']").forEach(a => {
        const label = a.getAttribute("aria-label");
        const name = label.replace(/^(Comment|Reply) by /, "").replace(/\s+(about\s+)?(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i, "").trim();
        const key = label + "|" + (a.innerText || "").slice(0, 80);
        if (seen.has(key) || OWN.test(name) || !visible(a)) return;
        seen.add(key); out.push({ name, el: a });
      });
    } else if (NET === "ig") {
      [...document.querySelectorAll("[role=button],button")].filter(b => visible(b) && /^Reply$/i.test((b.innerText || "").trim())).forEach(b => {
        let c = b; for (let i = 0; i < 8 && c && !c.querySelector("a[href^='/'][role=link], h3 a, span a[href^='/']"); i++) c = c.parentElement;
        const a = c && c.querySelector("a[href^='/'][role=link], h3 a, span a[href^='/']");
        const name = a ? (a.getAttribute("href") || "").replace(/\//g, "") : "";
        const key = name + "|" + (c.innerText || "").slice(0, 80);
        if (!name || seen.has(key) || OWN.test(name)) return;
        seen.add(key); out.push({ name, el: c, btn: b });
      });
    } else if (NET === "x") {
      [...document.querySelectorAll("article[data-testid=tweet]")].slice(1).forEach(a => {
        const h = ([...a.querySelectorAll("[data-testid='User-Name'] a span")].map(x => x.innerText).find(t => /^@/.test(t)) || "").trim();
        const key = h + "|" + (a.innerText || "").slice(0, 80);
        if (!h || seen.has(key) || OWN.test(h)) return;
        seen.add(key); out.push({ name: h, el: a });
      });
    } else if (NET === "tiktok") {
      document.querySelectorAll("[data-e2e='comment-username-1']").forEach(u => {
        let c = u; for (let i = 0; i < 8 && c && !c.querySelector("[data-e2e^='comment-reply']"); i++) c = c.parentElement;
        const name = (u.innerText || "").trim();
        const key = name + "|" + ((c && c.innerText) || "").slice(0, 80);
        if (!c || !name || seen.has(key) || OWN.test(name)) return;
        seen.add(key); out.push({ name, el: c });
      });
    }
    return out;
  }
  async function replyTo(cm, text) {
    let input, send;
    cm.el.scrollIntoView({ block: "center" }); await sleep(700);
    if (NET === "fb") {
      const b = [...cm.el.querySelectorAll("[role=button]")].find(x => /^Reply$/i.test((x.innerText || "").trim()) && x.closest("[role=article]") === cm.el);
      if (!b) return "no Reply button";
      const replyBoxes = () => [...document.querySelectorAll("[contenteditable=true][role=textbox]")].filter(e => visible(e) && /^Reply to/i.test(e.getAttribute("aria-label") || ""));
      const before = new Set(replyBoxes());
      b.click();
      // the box that opened for this person: labelled with their name, or new since the click, or inside their comment
      input = await waitFor(() => { const all = replyBoxes(); return all.find(e => (e.getAttribute("aria-label") || "") === "Reply to " + cm.name && !(e.innerText || "").trim()) || all.find(e => !before.has(e)) || all.find(e => cm.el.contains(e) && !(e.innerText || "").trim()); }, 6000);
      if (!input) return "reply box didn't open";
      input.focus(); await sleep(400);
      document.execCommand("insertText", false, text); await sleep(700);
      if (!contentOf(input)) return "couldn't type";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    } else if (NET === "ig") {
      cm.btn.click(); await sleep(800);
      input = await waitFor(() => [...document.querySelectorAll("textarea")].find(e => visible(e) && /comment/i.test(e.getAttribute("aria-label") || e.placeholder || "")), 6000);
      if (!input) return "no comment box";
      input.focus(); input.setSelectionRange(input.value.length, input.value.length);
      document.execCommand("insertText", false, (input.value && !/\s$/.test(input.value) ? " " : "") + text); await sleep(700);
      send = await waitFor(() => [...(input.closest("form") || document).querySelectorAll("[role=button],button")].find(b => visible(b) && /^post$/i.test((b.innerText || "").trim()) && b.getAttribute("aria-disabled") !== "true"), 6000);
      if (!send) return "Post button stayed off";
      send.click();
    } else if (NET === "x") {
      const b = cm.el.querySelector("[data-testid=reply]");
      if (!b) return "no reply button";
      b.click();
      const dlg = await waitFor(() => [...document.querySelectorAll("[role=dialog] [data-testid=tweetTextarea_0]")].find(visible), 8000);
      if (!dlg) return "reply box didn't open";
      dlg.click(); await sleep(500);
      input = dlg.querySelector("[contenteditable=true]") || dlg;
      input.focus(); document.execCommand("insertText", false, text); await sleep(900);
      send = await waitFor(() => { const x = document.querySelector("[role=dialog] [data-testid=tweetButton]"); return x && x.getAttribute("aria-disabled") !== "true" && !x.disabled ? x : null; }, 6000);
      if (!send) return "Reply button stayed off";
      send.click();
      const closed = await waitFor(() => !document.querySelector("[role=dialog] [data-testid=tweetTextarea_0]"), 10000);
      await sleep(1200);
      return closed ? "" : "not confirmed";
    } else if (NET === "tiktok") {
      const b = cm.el.querySelector("[data-e2e^='comment-reply']");
      if (!b) return "no Reply button";
      b.click(); await sleep(900);
      input = await waitFor(() => [...cm.el.querySelectorAll("[contenteditable=true]")].find(visible) || [...document.querySelectorAll("[data-e2e='comment-input'] [contenteditable=true]")].find(visible), 6000);
      if (!input) return "reply box didn't open";
      input.focus(); document.execCommand("insertText", false, text); await sleep(900);
      send = await waitFor(() => { const x = [...cm.el.querySelectorAll("[data-e2e='comment-post']")].find(visible) || document.querySelector("[data-e2e='comment-post']"); return x && x.getAttribute("aria-disabled") !== "true" ? x : null; }, 6000);
      if (!send) return "Post button stayed off";
      send.click();
    }
    const cleared = await waitFor(() => !contentOf(input) || !document.contains(input), 10000);
    await sleep(1200);
    const w2 = warning(); if (w2) return "warning: " + w2;
    return cleared ? "" : "not confirmed";
  }

  // ------------------------------------------------------------- invite your Facebook friends to like/follow the Page
  async function inviteFriends() {
    if (!job.navved) { job.navved = 1; await save(); go(PROFILE); return; }
    box("opening “Invite people to connect”…");
    await sleep(3000);
    const menuBtn = await waitFor(() => [...document.querySelectorAll("[role=button][aria-label]")].find(b => visible(b) && /^(Profile settings see more options|See options|See more options)$/i.test(b.getAttribute("aria-label"))), 15000);
    if (!menuBtn) return finish("Couldn't find the Page's ••• menu.");
    menuBtn.click(); await sleep(1500);
    const item = await waitFor(() => [...document.querySelectorAll("[role=menuitem],[role=menu] [role=button],[role=dialog] [role=button],[role=listitem]")].find(e => visible(e) && /^(Invite people to connect|Invite friends)$/i.test((e.innerText || "").trim())), 8000);
    if (!item) return finish("Facebook didn't show “Invite people to connect” in the Page menu.");
    item.click(); await sleep(3500);
    const dlg = () => { const ds = [...document.querySelectorAll("[role=dialog]")].filter(visible); return ds[ds.length - 1]; };
    let d = await waitFor(dlg, 8000);
    if (!d) return finish("The invite window didn't open.");
    if (/switch profiles|switch to .* for more features/i.test(d.innerText || "")) return finish("Facebook is acting as your Page. Switch to your personal profile (Alexander Awuku) in this browser, then press “Invite my Facebook friends” again.");
    const max = job.max_invites || 100;
    let picked = 0;
    const unchecked = () => [...d.querySelectorAll("[role=checkbox][aria-checked=false], input[type=checkbox]:not(:checked)")].filter(visible);
    const scroller = () => [...d.querySelectorAll("div")].filter(x => x.scrollHeight > x.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(x).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    let idle = 0;
    while (picked < max && idle < 4 && !stopAsked) {
      const list = unchecked();
      if (!list.length) { const sc = scroller(); if (!sc) break; sc.scrollTop += sc.clientHeight; await sleep(1500); idle++; continue; }
      idle = 0;
      for (const c of list) { if (picked >= max) break; c.click(); picked++; if (picked % 10 === 0) box(`selected ${picked} friends…`); await sleep(rand(150, 350)); }
      const sc = scroller(); if (sc) { sc.scrollTop += sc.clientHeight; await sleep(1500); }
    }
    if (!picked) return finish("No friends left to invite (everyone may already be invited or connected).");
    const send = await waitFor(() => [...d.querySelectorAll("[role=button],button")].find(b => visible(b) && /^(Send invites?|Send Invites|Invite|Send)$/i.test((b.innerText || b.getAttribute("aria-label") || "").trim()) && b.getAttribute("aria-disabled") !== "true"), 6000);
    if (!send) return finish(`Selected ${picked} friends but Facebook's Send button didn't appear. Nothing was sent.`);
    send.click(); await sleep(3000);
    const w3 = warning();
    job.res.push({ url: PROFILE, title: "Invite friends", invited: w3 ? 0 : picked, why: w3 || "", t: new Date().toISOString() });
    await save();
    return finish(w3 ? `Facebook showed "${w3}".` : null);
  }

  // ------------------------------------------------------------- thank-you comments with @mentions (all networks)
  // On each post: open the comments, @mention the people seen there (not thanked before) in a thank-you
  // for viewing, liking and sharing; if nobody new is there, leave one general thank-you (once per post).
  const MAXLEN = { tiktok: 150, x: 280, ig: 2200, fb: 2000 }[NET] || 150;
  const thanksTpl = () => String(job.likers_text || "{names} thank you for viewing, liking and sharing 🙏 Follow us and like the page!");
  function thanksGeneral() {
    const t = thanksTpl().replace("{names}", "").replace(/\s+/g, " ").trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function mentionsFor(users) {
    const build = list => thanksTpl().replace("{names}", list.map(u => "@" + u).join(" ")).trim();
    const per = Math.max(1, job.likers_per_comment || 4);
    const chunks = [];
    let cur = [];
    users.forEach(u => {
      if (cur.length && (cur.length >= per || Array.from(build(cur.concat(u))).length > MAXLEN)) { chunks.push(cur); cur = []; }
      if (Array.from(build([u])).length <= MAXLEN) cur.push(u);
    });
    if (cur.length) chunks.push(cur);
    return chunks.map(list => ({ users: list, text: build(list) }));
  }

  await sleep(3500);
  if (/\/login|accounts\/login|i\/flow\/login/.test(location.pathname)) return finish(`${NAME} isn't logged in in this browser. Log in, then press the button again.`);
  let w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);

  if (job.mode === "invite") { if (NET === "fb") return inviteFriends(); return finish(`${NAME} has no invite-friends feature.`); }

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
  if (job.text && !job.statsOnly && (job.mode || "comment") === "comment") {
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
  let thanked = [];
  if (job.mode === "likers" && ours) {
    box(`${n}: opening the comments…`);
    await expandComments();
    const skip = new Set((job.skip || []).map(u => u.toLowerCase()));
    const names = [];
    commenters().forEach(cm => { const u = String(cm.name || "").replace(/^@/, "").trim(); const k = u.toLowerCase(); if (u && !skip.has(k) && !names.some(x => x.toLowerCase() === k)) names.push(u); });
    const room = Math.max(0, (job.max_likers || 60) - (job.tdone || 0));
    const chunks = mentionsFor(names.slice(0, room));
    if (!chunks.length && !document.body.innerText.includes(thanksGeneral().replace(/^[^\w]+/, "").slice(0, 30)) && room > 0) chunks.push({ users: [], text: thanksGeneral() });
    if (!chunks.length) why = room ? "everyone here was thanked before" : "thank-you limit for this run reached";
    for (const ch of chunks) {
      if (stopAsked) return;
      box(`${n}: thanking ${ch.users.length ? ch.users.map(u => "@" + u).join(" ") : "everyone"}…`);
      const err = await comment(ch.text);
      if (err.startsWith("warning:")) { job.res.push({ url, title, ...s, thanked, commented, why: err }); job.i++; await save(); return finish(`${NAME} showed "${err.slice(9)}". Stopped so the account stays safe.`); }
      if (err) { why = err; continue; }
      commented = true; thanked = thanked.concat(ch.users); job.tdone = (job.tdone || 0) + Math.max(1, ch.users.length);
      ch.users.forEach(u => (job.skip = job.skip || []).push(u));
      await save();
      await countdown(rand(job.min || 20, job.max || 45), `${n}: thank-you posted ✓. Next in`);
    }
  }
  let replied = 0;
  if (job.mode === "reply" && ours) {
    box(`${n}: opening the comments…`);
    await expandComments();
    const list = commenters();
    for (const cm of list) {
      if (stopAsked) return;
      if ((job.rdone || 0) >= (job.max_replies || 60)) { why = "reply limit for this run reached"; break; }
      box(`${n}: replying to ${cm.name} (${replied + 1} of ${list.length})…`);
      const err = await replyTo(cm, replyText(cm.name));
      if (err.startsWith("warning:")) { job.res.push({ url, title, ...s, commented, replied, why: err }); job.i++; await save(); return finish(`${NAME} showed "${err.slice(9)}". Stopped so the account stays safe.`); }
      if (!err) { replied++; job.rdone = (job.rdone || 0) + 1; await save(); await countdown(rand(job.rmin || 12, job.rmax || 25), `${n}: replied to ${cm.name} ✓. Next reply in`); }
      else why = err;
    }
    if (!list.length) why = "no comments from other people";
  }
  job.res.push({ url, title, ...s, commented, replied, thanked, why, t: new Date().toISOString() });
  job.i++;
  await save();
  if (job.i >= job.urls.length) { box("All done. Going back to your admin…"); await sleep(1200); return finish(); }
  if (commented) await countdown(rand(job.min || 20, job.max || 45), `${n}: commented ✓ (${job.done} so far). Next post in`);
  else await sleep(rand(1200, 2200));
  if (stopAsked) return;
  job.at = job.i; await save();
  go(job.urls[job.i]);
})();
