// FA Vision Autopilot: runs on instagram.com, but only in a tab the FA Vision
// admin opened with an Instagram job (kept per tab by background.js, like the
// Facebook jobs). Job kind "ig":
//   1. checks Instagram is logged in as the right account (@favisionent) and
//      reads its follower / following / post counts for the daily report,
//   2. posts each queued photo: Create → Post → photo → 4:5 crop → caption →
//      "Share to Facebook" switched off → Share, pausing between posts,
//   3. returns to the admin with what happened.
// It stops at once if Instagram shows any warning ("Try again later", "Action blocked"…).
(async () => {
  // Sleep that keeps time when the tab is hidden, minimised or the screen is locked: the add-on's
  // background (5.2+) does the waiting in short steps, because the browser slows timers in hidden tabs
  // to once a minute. Older add-ons don't answer, so it falls back to a normal timer.
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
  if (!job || job.kind !== "ig") return;               // not an autopilot tab: do nothing
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
      d.style.cssText = "position:fixed;z-index:2147483647;left:16px;bottom:16px;max-width:400px;padding:14px 16px;border-radius:12px;font:600 14px/1.45 system-ui,sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;gap:12px;align-items:flex-start";
      const t = document.createElement("span"); t.id = "favautomsg"; t.style.flex = "1";
      const b = document.createElement("button");
      b.textContent = "Stop";
      b.style.cssText = "flex:0 0 auto;border:0;border-radius:8px;padding:6px 12px;font:700 13px system-ui;background:#fff;color:#c62828;cursor:pointer";
      b.onclick = () => { stopAsked = true; finish("Stopped by you."); };
      d.append(t, b);
      document.body.appendChild(d);
    }
    d.style.background = bad ? "#c62828" : "#c13584";
    document.getElementById("favautomsg").textContent = "FA Vision · Instagram · " + msg;
  }

  async function finish(stopped) {
    const out = { kind: "ig", id: job.id, res: job.res, stats: job.stats || null, spot: job.spot || [], stopped: stopped || null, then: job.then || null, dry: !!job.dry, mode: job.mode || null };
    await bg({ type: "clearJob" });
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }

  const WARN = /try again later|action blocked|we restrict certain activity|temporarily (blocked|restricted|locked)|suspicious (activity|login)|confirm (it('|’)s you|your identity)|your account has been (disabled|suspended)|we limit how often/i;
  function warning() {
    const t = [...document.querySelectorAll("[role=dialog]")].map(d => d.innerText || "").join("\n") || "";
    const hit = t.match(WARN);
    return hit ? hit[0] : null;
  }
  const visible = el => !!el && el.getClientRects().length > 0;
  function findBtn(re, root) {
    return [...(root || document).querySelectorAll('[role=button],button,a[role=link],a')]
      .find(b => visible(b) && (re.test((b.innerText || "").trim()) || re.test((b.getAttribute("aria-label") || "").trim())));
  }
  // Buttons that are just an icon: find the <svg aria-label> and click its button.
  function findIcon(re, root) {
    const svg = [...(root || document).querySelectorAll("svg[aria-label]")].find(s => re.test(s.getAttribute("aria-label")) && visible(s));
    return svg ? (svg.closest('[role=button],button,a') || svg.parentElement) : null;
  }
  async function waitFor(fn, ms) {
    for (let t = 0; t < ms; t += 250) {
      if (stopAsked) return null;
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    return null;
  }
  async function countdown(secs, text) {
    for (let s = secs; s > 0 && !stopAsked; s--) { box(`${text} ${s >= 60 ? Math.ceil(s / 60) + " min" : s + " s"}…`); await sleep(1000); }
  }
  function getImage(url) {
    return new Promise((res, rej) => chrome.runtime.sendMessage({ type: "image", url }, r => (r && r.dataUrl ? res(r.dataUrl) : rej(new Error((r && r.error) || "no image")))));
  }
  // Go to `url` once for step `step`, then carry on when that page loads.
  async function arrive(url, step) {
    if (job.navFor === step) return true;
    job.navFor = step;
    await save();
    location.href = url;
    return false;
  }
  const num = s => { const m = String(s).replace(/,/g, "").match(/([\d.]+)\s*([KkMm])?/); if (!m) return null; return Math.round(parseFloat(m[1]) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1)); };

  await sleep(2000);
  box("Starting…");
  if (/\/accounts\/login|\/challenge\//.test(location.pathname)) return finish(`Instagram isn't logged in. Log in as @${job.account} in this browser, then tap Run again.`);

  // ============================================================= 1. right account + profile counts
  const profile = `https://www.instagram.com/${job.account}/`;
  if (!job.stats) {
    if (!(await arrive(profile, "profile"))) return;
    box(`Checking you're logged in as @${job.account}…`);
    await waitFor(() => document.querySelector('meta[property="og:description"]') && document.querySelector("header"), 15000);
    await sleep(1500);
    const own = await waitFor(() => findBtn(/^edit profile$/i) || findBtn(/^professional dashboard$/i), 8000);
    if (!own) return finish(`Instagram is logged in to a different account. Switch to @${job.account}, then tap Run again.`);
    const og = (document.querySelector('meta[property="og:description"]') || {}).content || "";
    const head = (document.querySelector("header") || {}).innerText || "";
    const pick = (re1, re2) => { const m = og.match(re1) || head.match(re2); return m ? num(m[1]) : null; };
    job.stats = {
      followers: pick(/([\d.,]+[KkMm]?)\s+Followers/i, /([\d.,]+[KkMm]?)\s*\n?\s*followers/i),
      following: pick(/([\d.,]+[KkMm]?)\s+Following/i, /([\d.,]+[KkMm]?)\s*\n?\s*following/i),
      posts: pick(/([\d.,]+[KkMm]?)\s+Posts/i, /([\d.,]+[KkMm]?)\s*\n?\s*posts?/i),
      t: new Date().toISOString()
    };
    await save();
  }

  // ============================================================= 2. post each queued photo
  while (job.i < job.q.length && !stopAsked) {
    const it = job.q[job.i];
    const n = `Post ${job.i + 1} of ${job.q.length}`;
    if (!(await arrive("https://www.instagram.com/", "post" + job.i))) return;
    const record = (ok, why) => { job.res.push({ k: it.k, p: it.p || null, ok, why: [why, it.soundNote].filter(Boolean).join(" · "), sound: it.soundUsed || null, ...(it.soundFav ? { fav: it.soundFav, fav_found: !!it.soundFavFound, fav_tried: !!it.soundFavTried } : {}), t: new Date().toISOString() }); job.i++; return save(); };
    const fail = async why => { await record(false, why); box(`${n}: ${why}. Moving on…`, true); await sleep(4000); };

    box(`${n}: opening Create…`);
    await sleep(rand(2500, 4000));
    let w = warning(); if (w) return finish(`Instagram showed "${w}". Nothing more was posted.`);

    // Create (+) → Post
    const create = await waitFor(() => findIcon(/^new post$/i) || findBtn(/^create$/i), 15000);
    if (!create) { await fail("Couldn't find Create"); continue; }
    create.click();
    await sleep(1200);
    const fileInput = () => document.querySelector('[role=dialog] input[type=file]');
    let input = await waitFor(fileInput, 2500);
    if (!input) {   // newer Instagram: Create opens a small menu first (Post / Live video / Ad)
      const p = await waitFor(() => findBtn(/^post$/i) || findIcon(/^post$/i), 5000);
      if (p) p.click();
      input = await waitFor(fileInput, 8000);
    }
    if (!input) { await fail("The Create post window didn't open"); continue; }

    // Photo
    box(`${n}: adding the photo…`);
    try {
      const blob = await fetch(await getImage(it.img)).then(r => r.blob());
      const ft = new DataTransfer();
      const type = blob.type || "image/jpeg";
      ft.items.add(new File([blob], "fa-vision." + (/video/.test(type) ? "mp4" : "jpg"), { type }));
      input.files = ft.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { await fail("Couldn't load the photo"); continue; }
    const next1 = await waitFor(() => { const d = document.querySelector("[role=dialog]"); return d && findBtn(/^next$/i, d); }, 20000);
    if (!next1) { await fail("Instagram didn't take the photo"); continue; }
    // Videos: "Video posts are now shared as reels" notice
    const okReel = findBtn(/^ok$/i, document.querySelector("[role=dialog]") || undefined); if (it.video && okReel) { okReel.click(); await sleep(800); }

    // Crop: keep the full 4:5 photo (Instagram crops to a square by default)
    const crop = findIcon(/select crop/i);
    if (crop) {
      crop.click(); await sleep(800);
      const opt = findBtn(/^original$/i) || findBtn(/^4:5$/) || findIcon(/photo outline icon|crop portrait/i);
      if (opt) { opt.click(); await sleep(800); }
      crop.click(); await sleep(500);
    }
    next1.click();
    await sleep(1500);
    const next2 = await waitFor(() => { const d = document.querySelector("[role=dialog]"); return d && findBtn(/^next$/i, d); }, 10000);   // filters step
    if (next2) { next2.click(); await sleep(1500); }

    // Boost: audio only from Instagram's own (licensed) picker, when the web editor offers one. Favourite
    // artist first (it.sound.fav, skipping it.sound.avoid), then the trending name. Everything after opening
    // happens inside the audio picker (the dialog with a search box); no picker → no sound, nothing clicked.
    // Best effort, NOT checked live: the web editor often has no audio picker; then the Reel keeps its own
    // sound (our Afrobeats beat) and the note says so.
    if (it.sound && (it.sound.name || it.sound.fav)) {
      const s = it.sound, notes = [];
      const qOf = d => [...d.querySelectorAll("input")].find(i => visible(i) && /search/i.test(i.placeholder || i.getAttribute("aria-label") || ""));
      const picker = () => [...document.querySelectorAll("[role=dialog]")].filter(visible).reverse().find(d => qOf(d) && /audio|music|sound|song/i.test((d.innerText || "") + (d.getAttribute("aria-label") || "") + (qOf(d).placeholder || ""))) || null;
      const rows = d => { const all = [...d.querySelectorAll("[role=button],[role=listitem],li")].filter(r => visible(r) && !r.querySelector("input")); return all.filter(r => !all.some(o => o !== r && r.contains(o))); };
      const okRow = r => r.getAttribute("aria-disabled") !== "true" && !/\bunavailable\b|not available/i.test(r.innerText || "");
      const trackOf = (r, artist) => { const l = String(r.innerText || "").split(/\n|·|•/).map(x => x.trim()).filter(Boolean); return (l.find(x => x.toLowerCase() !== String(artist || "").toLowerCase()) || l[0] || "").slice(0, 80); };
      const search = async q => { const d = picker(), i = d && qOf(d); if (!i) return false; i.focus(); i.select && i.select(); document.execCommand("insertText", false, q); await sleep(2500); return true; };
      const take = async row => { const d = picker(); if (!d || !d.contains(row)) return false; row.click(); await sleep(1500); const d2 = picker(); const dn = d2 && findBtn(/^(done|add|use)$/i, d2); if (dn) { dn.click(); await sleep(1000); } return true; };
      const leave = async () => { const d = picker(); if (!d) return; const back = findIcon(/^back$/i, d) || findBtn(/^(cancel|back|close)$/i, d); if (back) { back.click(); await sleep(800); } else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); };
      try {
        const d0 = document.querySelector("[role=dialog]") || document;
        const audio = findBtn(/^(add audio|audio|music|add music)$/i, d0) || findIcon(/audio|music/i, d0);
        if (!audio) it.soundNote = "no sound: Instagram's web editor has no audio picker (kept the video's own sound)";
        else {
          audio.click();
          if (!(await waitFor(picker, 6000))) it.soundNote = "no sound: no audio picker dialog (kept the video's own sound)";
          else {
            let done = false;
            if (s.fav) {
              it.soundFav = s.fav;
              const avoid = new Set((s.avoid || []).map(x => String(x).toLowerCase())), probe = s.fav.toLowerCase().slice(0, 18);
              if (await search(s.fav)) {
                const hit = await waitFor(() => { const d = picker(); if (!d) return null; const rs = rows(d).filter(r => (r.innerText || "").toLowerCase().includes(probe) && okRow(r)); const row = rs.find(r => !avoid.has(trackOf(r, s.fav).toLowerCase())); return row ? { row } : rs.length ? { all: true } : null; }, 6000);
                if (hit && hit.row) { const track = trackOf(hit.row, s.fav); if (await take(hit.row)) { it.soundUsed = track; it.soundFavFound = true; done = true; } }
                else if (hit && hit.all) notes.push(`${s.fav}: only tracks used lately`);
                else { it.soundFavTried = true; notes.push(`artist not available in picker: ${s.fav}`); }
              }
            }
            if (!done && s.name && picker() && await search(s.name)) {
              const probe = s.name.toLowerCase().slice(0, 18);
              const row = await waitFor(() => { const d = picker(); return d && rows(d).find(r => (r.innerText || "").toLowerCase().includes(probe) && okRow(r)); }, 8000);
              if (row && await take(row)) { it.soundUsed = s.name; done = true; if (notes.length) notes.push(`trending sound instead: ${s.name}`); }
              else notes.push(`no sound: “${s.name}” not found`);
            } else if (!done) notes.push("no sound");
            if (!done) await leave();
            if (notes.length) it.soundNote = notes.join(" · ");
          }
        }
      } catch (e) { it.soundNote = notes.concat("no sound").join(" · "); }
    }
    // Caption
    box(`${n}: typing the caption…`);
    const editor = await waitFor(() => [...document.querySelectorAll('[role=dialog] [contenteditable=true]')].find(visible), 12000);
    if (!editor) { await fail("Caption box didn't open"); continue; }
    editor.focus();
    const dt = new DataTransfer(); dt.setData("text/plain", it.text);
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(800);
    if (!editor.innerText.trim()) { document.execCommand("insertText", false, it.text); await sleep(600); }
    if (!editor.innerText.trim()) { await fail("Couldn't type the caption"); continue; }

    // "Share to Facebook" must stay off (it would post to the personal Facebook profile)
    const dialog = editor.closest("[role=dialog]") || document;
    for (const sw of dialog.querySelectorAll('input[type=checkbox], [role=switch]')) {
      const row = sw.closest("label, [role=button], div");
      const txt = ((row && row.innerText) || "") + " " + (sw.getAttribute("aria-label") || "");
      const on = sw.checked === true || sw.getAttribute("aria-checked") === "true";
      if (/facebook/i.test(txt) && on) { sw.click(); await sleep(500); }
    }

    w = warning(); if (w) { await record(false, w); return finish(`Instagram showed "${w}". Nothing more was posted.`); }
    const share = await waitFor(() => findBtn(/^share$/i, dialog), 10000);
    if (!share) { await fail("No Share button"); continue; }
    if (job.dry) {
      box(`${n}: test passed ✓ (photo, crop and caption ready). Not sharing.`);
      await sleep(2500);
      const close = findIcon(/^close$/i); if (close) { close.click(); await sleep(1000); const discard = findBtn(/^discard$/i); if (discard) discard.click(); }
      await record(true, "Test only, not posted");
      break;
    }
    await sleep(rand(900, 1800));
    share.click();
    box(`${n}: sharing…`);
    const done = await waitFor(() => /your (post|reel) has been shared|(post|reel) shared/i.test((document.querySelector("[role=dialog]") || {}).innerText || "") || warning(), it.video ? 240000 : 90000);
    w = warning(); if (w) { await record(false, w); return finish(`Instagram showed "${w}". Nothing more was posted.`); }
    if (!done) { await fail("Instagram didn't confirm the post"); continue; }
    await record(true, "");
    const close = findIcon(/^close$/i); if (close) close.click();
    if (job.i < job.q.length) await countdown(rand(job.min || 120, job.max || 300), `Posted ✓ (${job.res.filter(r => r.ok).length} so far). Next post in`);
  }
  if (stopAsked) return;
  box("All done. Going back to your admin…");
  await sleep(1500);
  return finish();
})();
