// FA Vision Autopilot: Profile check (bio link + pinned post). Runs on facebook.com, instagram.com,
// x.com and tiktok.com, but only in a tab the FA Vision admin opened with a "profile" job (kept per
// tab by background.js). One network per job:
//   mode "check" – open the profile, read the website/link shown and which post is pinned;
//   mode "pinswap" – pin the post containing job.pin, then unpin the one containing job.unpin (Boost →
//                  "Refresh pinned"); nothing is ever deleted;
//   mode "fix"   – set ONLY the link field to job.link (the bio text is kept) and pin the post whose
//                  text contains job.pin (found by its first line), then read the profile again.
// Returns { net, link, pinned, linkOk, pinOk, why } to the admin (admin/profiles.js).
// Best effort: these selectors follow the networks' pages as of Oct 2026 but were NOT checked live.
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
  const bg = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r || {})); } catch (e) { res({}); } });
  let job = null;
  // Dialog handler context: "Discard post?" may discard only OUR unsent text from this job.
  const DCTX = () => ({ ours: () => { try { const it = job && job.q && job.q[job.i]; const want = it && String(it.text || it.description || "").slice(0, 30).trim(); const box = [...document.querySelectorAll("[contenteditable=true],textarea")].map(e => e.innerText || e.value || "").join(" "); return !!want && box.includes(want); } catch (e) { return false; } } });
  try { job = (await bg({ type: "getJob" })).job || null; } catch (e) { job = null; }
  if (!job || job.kind !== "profile") return;
  const NET = job.net;
  const NAME = { fb: "Facebook Page", ig: "Instagram", x: "X", tiktok: "TikTok" }[NET] || NET;
  job.step = job.step || "open";
  job.notes = job.notes || [];
  job.hops = job.hops || 0;
  const save = () => bg({ type: "saveJob", job });
  const norm = t => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();

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
    d.style.background = bad ? "#c62828" : "#00695c";
    document.getElementById("favautomsg").textContent = `FA Vision · ${NAME} profile · ${msg}`;
  }
  async function finish(stopped) {
    const r = job.read || {};
    const want = String(job.link || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    const has = String(r.link || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    const pinProbe = norm(job.pin).slice(0, 30);
    const out = {
      kind: "profile", net: NET, mode: job.mode, id: job.id, pin: job.pin || null, then: job.then || null, stopped: stopped || null,
      res: [{ link: r.link || null, pinned: r.pinned || null, linkOk: !!want && has === want, pinOk: !!pinProbe && norm(r.pinned).includes(pinProbe), why: job.notes.join(" · ") }]
    };
    if (window.FAV_DIALOGS) { const dl = window.FAV_DIALOGS.log(); if (dl.length) out.dialogs = dl; }
    await bg({ type: "clearJob" });
    if (window.FAV_DIALOGS) window.FAV_DIALOGS.leaving();
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }
  const WARN = /temporarily blocked|temporarily restricted|you('|’)re restricted|we limit how often|try again later|suspicious activity|confirm (your identity|it('|’)s you)|action blocked|rate limit/i;
  const warning = () => { const dg = window.FAV_DIALOGS && window.FAV_DIALOGS.tick(DCTX()); if (dg && dg.stop) return dg.stop; const t = [...document.querySelectorAll("[role=dialog],[role=alert],[data-testid=toast]")].map(d => d.innerText || "").join("\n"); const m = t.match(WARN); return m ? m[0] : null; };
  const visible = el => !!el && el.getClientRects().length > 0;
  const textOf = el => ((el && (el.innerText || el.getAttribute("aria-label"))) || "").trim();
  const findBtn = (re, root) => [...(root || document).querySelectorAll('[role=button],button,[role=menuitem],[role=link],a')].find(b => visible(b) && (re.test((b.getAttribute("aria-label") || "").trim()) || re.test((b.innerText || "").trim())));
  async function waitFor(fn, ms) { for (let t = 0; t < ms; t += 300) { if (stopAsked) return null; if (window.FAV_DIALOGS) window.FAV_DIALOGS.tick(DCTX()); const v = fn(); if (v) return v; await sleep(300); } return null; }
  async function go(url, step) {
    job.step = step; job.hops++;
    await save();
    if (job.hops > 12) return finish("The page kept changing. Stopped.");
    if (window.FAV_DIALOGS) window.FAV_DIALOGS.leaving();
    location.href = url;
  }
  function typeIn(el, value) {
    el.focus();
    if (el.select) el.select(); else document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, value);
    if ((el.value != null ? el.value : el.innerText) !== value) {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") { Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
    }
  }
  const pinProbe = norm(job.pin).slice(0, 30);
  const looksLikeLink = s => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(String(s || "").trim());

  const handle = String(job.handle || "").replace(/^@/, "");
  const PROFILE = {
    fb: `https://www.facebook.com/${handle || "FaVisionEnterprise"}/`,
    ig: `https://www.instagram.com/${handle || "favisionent"}/`,
    x: `https://x.com/${handle || "FaVisionEnt"}`,
    tiktok: handle ? `https://www.tiktok.com/@${handle}` : "https://www.tiktok.com/"
  }[NET];

  // ------------------------------------------------------------- reading the profile
  function readProfile() {
    const r = { link: null, pinned: null };
    const first = el => (el && (el.innerText || "").split("\n").map(x => x.trim()).filter(x => x && !/^(pinned( post| tweet)?|featured)$/i.test(x)).join(" ").replace(/\s+/g, " ").slice(0, 200)) || null;
    if (NET === "fb") {
      const intro = [...document.querySelectorAll("a[href]")].filter(a => visible(a) && looksLikeLink(a.innerText) && !/facebook\.com|fb\.me|instagram\.com\/?$/i.test(a.innerText));
      r.link = intro.length ? intro[0].innerText.trim() : null;
      const pinned = [...document.querySelectorAll("[role=article]")].find(a => /(^|\n)\s*(Pinned post|Pinned|Featured)\s*(\n|$)/i.test(a.innerText || "") || a.querySelector("[aria-label='Pinned post'],[aria-label='Pinned']"));
      r.pinned = first(pinned);
    } else if (NET === "ig") {
      const a = [...document.querySelectorAll("header a[href]")].find(x => /l\.instagram\.com|^https?:\/\/(?!www\.instagram)/.test(x.href) && looksLikeLink((x.innerText || "").split("\n").pop()));
      r.link = a ? (a.innerText || "").split("\n").pop().trim() : null;
      const pin = [...document.querySelectorAll("a[href*='/p/'],a[href*='/reel/']")].find(x => x.querySelector("svg[aria-label*='inned'],[aria-label*='inned post']"));
      r.pinned = pin ? (pin.querySelector("img") || {}).alt || pin.getAttribute("href") : null;
      if (r.pinned) r.pinned = String(r.pinned).slice(0, 120);
    } else if (NET === "x") {
      const u = document.querySelector("[data-testid=UserUrl]");
      r.link = u ? (u.innerText || "").trim() : null;
      const pin = [...document.querySelectorAll("article[data-testid=tweet]")].find(a => /pinned/i.test(textOf(a.querySelector("[data-testid=socialContext]"))));
      r.pinned = pin ? first(pin.querySelector("[data-testid=tweetText]") || pin) : null;
    } else if (NET === "tiktok") {
      const u = document.querySelector("[data-e2e=user-link]");
      r.link = u ? (u.innerText || "").trim() : null;
      const pin = [...document.querySelectorAll("[data-e2e=user-post-item]")].find(x => /pinned/i.test(textOf(x.querySelector("[data-e2e=video-card-badge]")) || ""));
      r.pinned = pin ? ((pin.querySelector("img") || {}).alt || (pin.querySelector("a") || {}).href || "pinned video").slice(0, 120) : null;
    }
    return r;
  }

  // ------------------------------------------------------------- fixing the link (only the link field)
  async function fixLink() {
    if (NET === "fb") {
      const edit = await waitFor(() => findBtn(/^edit (details|intro)$/i), 8000);
      if (!edit) return "couldn't find Edit details on the Page (set the website under About → Contact info)";
      edit.click(); await sleep(2000);
      const dlg = () => [...document.querySelectorAll("[role=dialog]")].filter(visible).pop();
      const web = await waitFor(() => { const d = dlg(); return d && [...d.querySelectorAll("input")].find(i => /website/i.test(i.getAttribute("aria-label") || i.placeholder || (i.closest("label") || {}).innerText || "")); }, 8000);
      if (!web) { const add = findBtn(/^add (a )?website$/i, dlg()); if (add) { add.click(); await sleep(1200); } }
      const input = web || await waitFor(() => { const d = dlg(); return d && [...d.querySelectorAll("input")].find(i => /website/i.test(i.getAttribute("aria-label") || i.placeholder || (i.closest("label") || {}).innerText || "")); }, 5000);
      if (!input) return "couldn't find the Website box";
      typeIn(input, job.link); await sleep(800);
      const saveBtn = await waitFor(() => { const b = findBtn(/^save$/i, dlg()); return b && b.getAttribute("aria-disabled") !== "true" ? b : null; }, 6000);
      if (!saveBtn) return "the Save button stayed off";
      saveBtn.click(); await sleep(3000);
      return "";
    }
    if (NET === "x") {
      const url = await waitFor(() => document.querySelector("input[name=url]"), 12000);
      if (!url) return "couldn't find the Website box in Edit profile";
      typeIn(url, job.link); await sleep(800);
      const s = await waitFor(() => { const b = document.querySelector("[data-testid=Profile_Save_Button]"); return b && b.getAttribute("aria-disabled") !== "true" ? b : null; }, 6000);
      if (!s) return "the Save button stayed off";
      s.click(); await sleep(3000);
      return "";
    }
    if (NET === "ig") {
      const web = await waitFor(() => document.querySelector("input#pepWebsite,input[name=external_url],input[placeholder='Website']"), 12000);
      if (!web) return "Instagram lets you change the website link only in its phone app (Edit profile → Links)";
      if (web.disabled || web.readOnly) return "Instagram lets you change the website link only in its phone app (Edit profile → Links)";
      typeIn(web, job.link); await sleep(800);
      const s = await waitFor(() => findBtn(/^submit$|^save$/i), 6000);
      if (!s) return "no Submit button";
      s.click(); await sleep(3000);
      return "";
    }
    if (NET === "tiktok") {
      const edit = await waitFor(() => document.querySelector("[data-e2e=edit-profile-entrance]") || findBtn(/^edit profile$/i), 10000);
      if (!edit) return "couldn't find Edit profile";
      edit.click(); await sleep(2000);
      const web = await waitFor(() => [...document.querySelectorAll("[role=dialog] input")].find(i => /website|link/i.test(i.placeholder || i.getAttribute("aria-label") || "")), 6000);
      if (!web) { const c = findBtn(/^cancel$|^close$/i); if (c) c.click(); return "TikTok shows the website box only for business accounts with 1,000+ followers: add it in the TikTok app (Edit profile → Website)"; }
      typeIn(web, job.link); await sleep(800);
      const s = await waitFor(() => { const b = findBtn(/^save$/i); return b && b.getAttribute("aria-disabled") !== "true" && !b.disabled ? b : null; }, 6000);
      if (!s) return "the Save button stayed off";
      s.click(); await sleep(3000);
      return "";
    }
    return "not supported";
  }

  // ------------------------------------------------------------- pinning / unpinning a post found by its text
  // act: "pin" or "unpin". Opens the post's own ••• menu and picks Pin / Unpin. Never deletes anything.
  async function menuOn(text, act) {
    const probe = norm(text).slice(0, 60);
    if (!probe) return "no post text to look for";
    const has = el => norm(el.innerText).includes(probe);
    const PIN = act === "pin" ? /^(pin post|pin to top of page|feature|pin to your profile|pin to profile|pin)$/i : /^(unpin post|unpin from top of page|unfeature|remove from featured|unpin from profile|unpin)$/i;
    const pick = async () => {
      const item = await waitFor(() => [...document.querySelectorAll("[role=menuitem],[role=dialog] button,[role=dialog] [role=button],[role=menu] li,[role=menu] [role=button]")].find(m => visible(m) && PIN.test((m.innerText || "").trim().split("\n")[0])), 5000);
      if (!item) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return `no “${act === "pin" ? "Pin" : "Unpin"}” in the post's menu`; }
      item.click(); await sleep(1500);
      const ok = document.querySelector("[data-testid=confirmationSheetConfirm]") || findBtn(/^(pin|unpin|save|confirm|feature)$/i, [...document.querySelectorAll("[role=dialog]")].filter(visible).pop());
      if (ok) { ok.click(); await sleep(1500); }
      return "";
    };
    if (NET === "fb" || NET === "x") {
      const posts = () => NET === "x" ? [...document.querySelectorAll("article[data-testid=tweet]")] : [...document.querySelectorAll("[role=article]")].filter(a => !a.closest("[role=article] [role=article]"));
      let post = null;
      for (let i = 0; i < 25 && !post && !stopAsked; i++) {
        post = posts().find(a => visible(a) && has(a));
        if (!post) { window.scrollBy(0, Math.round(innerHeight * 1.5)); await sleep(1800); }
      }
      window.scrollTo(0, 0);
      if (!post) return `couldn't find a post with “${text.split("\n")[0].slice(0, 40)}” on the profile`;
      post.scrollIntoView({ block: "center" }); await sleep(900);
      const menu = NET === "x" ? post.querySelector("[data-testid=caret]") : [...post.querySelectorAll("[role=button][aria-label]")].find(b => /^actions for this post$/i.test(b.getAttribute("aria-label")));
      if (!menu) return "no ••• menu on the post";
      menu.click(); await sleep(1200);
      return pick();
    }
    // Instagram / TikTok: open the newest posts one by one (they open over the profile) and check the text.
    const tiles = () => NET === "ig" ? [...document.querySelectorAll("main a[href*='/p/'],main a[href*='/reel/']")] : [...document.querySelectorAll("[data-e2e=user-post-item] a")];
    await waitFor(() => tiles().length, 10000);
    for (const a of tiles().slice(0, 12)) {
      if (stopAsked) return "stopped";
      a.click(); await sleep(2500);
      const view = [...document.querySelectorAll("[role=dialog]")].filter(visible).pop() || document.querySelector("[data-e2e=browse-video-desc]") && document.body;
      const descEl = NET === "ig" ? view : document.querySelector("[data-e2e=browse-video-desc],[data-e2e=video-desc]");
      if (view && descEl && has(descEl)) {
        const more = NET === "ig" ? findIcon(/^more options$/i, view) : (document.querySelector("[data-e2e=video-setting],[data-e2e=browse-more],[aria-label='More options']"));
        if (!more) return `no ••• menu on the post (${NAME} may only allow this in its app)`;
        more.click(); await sleep(1200);
        return pick();
      }
      const close = NET === "ig" ? findIcon(/^close$/i) : document.querySelector("[data-e2e=browse-close]");
      if (close) close.click(); else history.back();
      await sleep(1500);
    }
    return `couldn't find the post on ${NAME} (pin it in the app: open the post → ••• → ${act === "pin" ? "Pin" : "Unpin"})`;
  }
  function findIcon(re, root) {
    const svg = [...(root || document).querySelectorAll("svg[aria-label]")].find(x => re.test(x.getAttribute("aria-label")) && visible(x));
    return svg ? (svg.closest("[role=button],button,a") || svg.parentElement) : null;
  }
  const pinPost = () => menuOn(job.pin, "pin");

  // ------------------------------------------------------------- steps
  await sleep(3000);
  if (/\/login|accounts\/login|i\/flow\/login/.test(location.pathname)) return finish(`${NAME} isn't logged in in this browser. Log in, then press the button again.`);
  let w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);

  if (job.step === "open") {
    if (NET === "tiktok" && !handle) {
      const me = await waitFor(() => document.querySelector("a[data-e2e='nav-profile'][href*='/@']"), 10000);
      if (!me) return finish("Couldn't find your TikTok profile. Type your TikTok username in Engagement → Settings, then try again.");
      job.handle = me.getAttribute("href").match(/@([\w.]+)/)[1];
      return go(`https://www.tiktok.com/@${job.handle}`, "read");
    }
    return go(PROFILE, "read");
  }
  if (job.step === "read") {
    box("reading the link and the pinned post…");
    await sleep(2500);
    job.read = readProfile();
    await save();
    if (job.mode === "pinswap") {
      box("pinning the new post…");
      const e1 = await menuOn(job.pin, "pin"); if (e1) job.notes.push("pin: " + e1);
      w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);
      if (!e1 && job.unpin && job.unpin !== job.pin) { if (NET !== "fb" && NET !== "x") await go(PROFILE, "unpin"); else { const e2 = await menuOn(job.unpin, "unpin"); if (e2) job.notes.push("unpin: " + e2); } }
      if (job.step !== "unpin") return go(PROFILE, "reread");
      return;
    }
    if (job.mode !== "fix") { box("Done. Going back to your admin…"); await sleep(1000); return finish(); }
    const want = String(job.link || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    const linkOk = String(job.read.link || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase() === want;
    job.needLink = !!want && !linkOk;
    job.needPin = !!pinProbe && !norm(job.read.pinned).includes(pinProbe);
    if (job.needPin) {
      box("pinning the chosen post…");
      const err = await pinPost();
      if (err) job.notes.push(err);
      w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);
      await save();
    }
    if (job.needLink) {
      const editUrl = { x: "https://x.com/settings/profile", ig: "https://www.instagram.com/accounts/edit/" }[NET];
      if (editUrl) return go(editUrl, "link");
      job.step = "link";
    } else return go(PROFILE, "reread");
  }
  if (job.step === "unpin") {
    box("unpinning the old post (it stays on your profile)…");
    const e2 = await menuOn(job.unpin, "unpin"); if (e2) job.notes.push("unpin: " + e2);
    return go(PROFILE, "reread");
  }
  if (job.step === "link") {
    box("setting the link (the bio text stays as it is)…");
    const err = await fixLink();
    if (err) job.notes.push(err);
    w = warning(); if (w) return finish(`${NAME} showed "${w}". Stopped.`);
    return go(PROFILE, "reread");
  }
  if (job.step === "reread") {
    box("checking again…");
    await sleep(2500);
    job.read = readProfile();
    await save();
    return finish();
  }
  return finish();
})();
