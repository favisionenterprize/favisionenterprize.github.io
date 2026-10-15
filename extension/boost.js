// FA Vision Autopilot: Boost. Runs on ads.tiktok.com, instagram.com and facebook.com, but only in a tab
// the FA Vision admin opened with one of these jobs (kept per tab by background.js):
//   sounds – read today's trending sounds: TikTok Creative Center → Trends → Songs, region Ghana, only
//            songs approved for business use (the Commercial Music Library), then Instagram Reels' audio
//            (the audio links on reels shown, trending ones first). Names only: no music is downloaded.
//            Creative Center needs add-on 5.4 (permission for ads.tiktok.com, one manual reload).
//   story  – Facebook story from a product photo: stories/create → photo story → photo → a short text with
//            the product link (Facebook's web story editor has no link sticker) → Share to story.
// Results go back to the admin (admin/boost.js). Selectors were NOT checked live (only on mock pages).
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
  try { job = (await bg({ type: "getJob" })).job || null; } catch (e) { job = null; }
  if (!job || (job.kind !== "sounds" && job.kind !== "story")) return;
  job.res = job.res || [];
  job.notes = job.notes || [];
  job.hops = job.hops || 0;
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
    d.style.background = bad ? "#c62828" : "#ef6c00";
    document.getElementById("favautomsg").textContent = `FA Vision · Boost · ${msg}`;
  }
  async function finish(stopped) {
    const out = { kind: job.kind, id: job.id, res: job.res, notes: job.notes, stopped: stopped || null, then: job.then || null };
    await bg({ type: "clearJob" });
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }
  const WARN = /temporarily blocked|temporarily restricted|you('|’)re restricted|we limit how often|try again later|suspicious activity|confirm (your identity|it('|’)s you)|action blocked/i;
  const warning = () => { const t = [...document.querySelectorAll("[role=dialog],[role=alert]")].map(d => d.innerText || "").join("\n"); const m = t.match(WARN); return m ? m[0] : null; };
  const visible = el => !!el && el.getClientRects().length > 0;
  const findBtn = (re, root) => [...(root || document).querySelectorAll("[role=button],button,[role=tab],[role=checkbox],[role=switch],label,[role=menuitem]")].find(b => visible(b) && (re.test((b.getAttribute("aria-label") || "").trim()) || re.test((b.innerText || "").trim())));
  async function waitFor(fn, ms) { for (let t = 0; t < ms; t += 300) { if (stopAsked) return null; const v = fn(); if (v) return v; await sleep(300); } return null; }
  async function go(url, stage) {
    job.stage = stage; job.hops++;
    await save();
    if (job.hops > 15) return finish("The page kept changing. Stopped.");
    location.href = url;
  }
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  function getImage(url) {
    return new Promise((res, rej) => { try { chrome.runtime.sendMessage({ type: "image", url }, r => (r && r.dataUrl ? res(r.dataUrl) : rej(new Error((r && r.error) || "no image")))); } catch (e) { rej(e); } });
  }

  await sleep(3000);
  let w = warning(); if (w) return finish(`The site showed "${w}". Stopped.`);

  // ============================================================= trending sounds
  if (job.kind === "sounds") {
    const CC = "https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en?countryCode=GH&period=7";
    job.stage = job.stage || "start";
    if (job.stage === "start") return job.cc === false ? go("https://www.instagram.com/reels/", "ig") : go(CC, "cc");
    if (job.stage === "cc") {
      box("reading TikTok's trending business sounds for Ghana…");
      await waitFor(() => document.body && (document.body.innerText || "").length > 400, 20000);
      // Region Ghana + "Approved for business use" (Commercial Music Library) if they aren't set yet
      if (!/ghana/i.test((document.querySelector("[class*=region],[class*=Region],[class*=country]") || document.body).innerText.slice(0, 3000))) job.notes.push("couldn't confirm the Ghana region on Creative Center");
      const biz = findBtn(/approved for business use|commercial music|business use/i);
      if (biz && biz.getAttribute("aria-checked") !== "true" && !(biz.querySelector("input:checked"))) { biz.click(); await sleep(3000); }
      else if (!biz) job.notes.push("no 'Approved for business use' filter seen: check the sounds are in TikTok's Commercial Music Library");
      for (let i = 0; i < 4; i++) { const more = findBtn(/^view more$|^load more$/i); if (!more) break; more.click(); await sleep(2500); }
      const cards = [...document.querySelectorAll('[class*="ItemCard"],[class*="itemCard"],[class*="CardPc_container"],[class*="musicItem"],[class*="MusicItem"],[data-testid*="music"]')].filter(visible);
      const seen = new Set();
      let rank = 0;
      for (const c of cards) {
        if (c.parentElement && c.parentElement.closest('[class*="ItemCard"],[class*="itemCard"],[class*="CardPc_container"],[class*="musicItem"],[class*="MusicItem"]')) continue;
        const lines = (c.innerText || "").split("\n").map(x => x.trim()).filter(x => x && !/^\d+$|^#?\d+$|^(new|details|see analytics|approved for business use|play|\d{1,2}:\d\d)$/i.test(x));
        const name = clip(lines[0], 80), artist = clip(lines[1], 60);
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        job.res.push({ name, artist, platform: "tiktok", rank: ++rank, commercial: true });
        if (rank >= 20) break;
      }
      if (!rank) job.notes.push("couldn't read the Creative Center song list");
      await save();
      return go("https://www.instagram.com/reels/", "ig");
    }
    if (job.stage === "ig") {
      if (/\/accounts\/login/.test(location.pathname)) { job.notes.push("Instagram isn't logged in"); return finish(); }
      box("reading Instagram's trending audio on Reels…");
      const found = new Map();
      for (let i = 0; i < 12 && !stopAsked; i++) {
        for (const a of document.querySelectorAll('a[href*="/reels/audio/"]')) {
          const text = clip((a.innerText || a.getAttribute("aria-label") || "").replace(/·/g, " · "), 120);
          if (!text || /original audio/i.test(text)) continue;
          const trend = !!a.querySelector("svg[aria-label*='rend'],[aria-label*='rending']") || /trending/i.test(a.getAttribute("aria-label") || "");
          const [artist, name] = text.includes(" · ") ? text.split(" · ").map(x => x.trim()) : ["", text];
          const key = (name || text).toLowerCase();
          const have = found.get(key);
          if (have) { have.n++; have.trend = have.trend || trend; }
          else found.set(key, { name: clip(name || text, 80), artist: clip(artist, 60), n: 1, trend });
        }
        window.scrollBy(0, Math.round(innerHeight * 0.9));
        await sleep(2200);
        w = warning(); if (w) break;
      }
      const list = [...found.values()].sort((a, b) => (b.trend - a.trend) || (b.n - a.n)).slice(0, 20);
      list.forEach((x, i) => job.res.push({ name: x.name, artist: x.artist, platform: "ig", rank: i + 1, trending: x.trend }));
      if (!list.length) job.notes.push("no Instagram audio seen on Reels");
      box(`Found ${job.res.length} sounds. Going back…`);
      await sleep(1000);
      return finish(w ? `Instagram showed "${w}".` : null);
    }
    return finish();
  }

  // ============================================================= Facebook story (photo + text)
  if (job.kind === "story") {
    if (job.stage === "shared") {   // Share reloaded the page: the story went out. Never make it again.
      job.res.push({ net: "fb", ok: !/\/stories\/create/.test(location.pathname), why: /\/stories\/create/.test(location.pathname) ? "Facebook didn't confirm the story" : "" });
      return finish();
    }
    if (!/\/stories\/create/.test(location.pathname)) return go("https://www.facebook.com/stories/create", "story");
    box("making the story…");
    const photo = await waitFor(() => findBtn(/create a photo story|photo story/i), 15000);
    if (!photo) return finish("Facebook didn't show “Create a photo story” (switch Facebook to your Page, then try again).");
    const input = [...document.querySelectorAll("input[type=file]")].find(i => /image/.test(i.accept || "image"));
    try {
      const blob = await fetch(await getImage(job.img)).then(r => r.blob());
      const f = new File([blob], "fa-vision-story.jpg", { type: blob.type || "image/jpeg" });
      const dt = new DataTransfer(); dt.items.add(f);
      const inp = input || (photo.click(), await waitFor(() => [...document.querySelectorAll("input[type=file]")].find(i => /image/.test(i.accept || "image")), 5000));
      if (!inp) return finish("No photo upload on the story page.");
      inp.files = dt.files;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return finish("Couldn't load the photo."); }
    const share = await waitFor(() => findBtn(/^share to story$/i), 20000);
    if (!share) return finish("The story editor didn't open (photo not taken).");
    const addText = findBtn(/^add text$/i);
    if (addText && job.text) {
      addText.click(); await sleep(1200);
      const ed = [...document.querySelectorAll("textarea,[contenteditable=true]")].find(visible);
      if (ed) { ed.focus(); document.execCommand("insertText", false, job.text); await sleep(800); }
      else job.notes.push("couldn't add the text");
    }
    w = warning(); if (w) return finish(`Facebook showed "${w}". Stopped.`);
    if (job.dry) { job.res.push({ net: "fb", ok: true, why: "Test only, not shared" }); return finish(); }
    job.stage = "shared";   // saved before the click, so a reload can't share it twice
    await save();
    share.click();
    box("sharing…");
    const ok = await waitFor(() => !/\/stories\/create/.test(location.pathname) || /story (was )?shared|your story/i.test(document.body.innerText.slice(0, 3000)), 45000);
    w = warning();
    job.res.push({ net: "fb", ok: !!ok && !w, why: w || (ok ? "" : "Facebook didn't confirm the story") });
    await save();
    return finish(w ? `Facebook showed "${w}".` : null);
  }
})();
