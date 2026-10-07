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
  const sleep = ms => new Promise(r => setTimeout(r, ms));
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
    const record = (ok, why) => { job.res.push({ k: it.k, p: it.p || null, ok, why: why || "", t: new Date().toISOString() }); job.i++; return save(); };
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
      ft.items.add(new File([blob], "fa-vision.jpg", { type: blob.type || "image/jpeg" }));
      input.files = ft.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { await fail("Couldn't load the photo"); continue; }
    const next1 = await waitFor(() => { const d = document.querySelector("[role=dialog]"); return d && findBtn(/^next$/i, d); }, 20000);
    if (!next1) { await fail("Instagram didn't take the photo"); continue; }

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
    const done = await waitFor(() => /your (post|reel) has been shared|post shared/i.test((document.querySelector("[role=dialog]") || {}).innerText || "") || warning(), 90000);
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
