// FA Vision Autopilot: YouTube. Runs on youtube.com / studio.youtube.com, but only in a tab
// the FA Vision admin opened with a job (kept per tab by background.js). Job kind "youtube":
// for each queued video: youtube.com/upload → choose the file → title → description →
// "No, it's not made for kids" → Next ×3 → Public → Publish → read the video's link.
// Test mode (dry) only checks that the upload window opens and stops before choosing a file,
// so nothing is uploaded. Stops at once on any warning; returns to the admin with the results.
// Not yet checked live on YouTube Studio (Oct 2026): selectors follow Studio's upload dialog.
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
  const bg = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r || {})); } catch (e) { res({}); } });

  let job = null;
  try { job = (await bg({ type: "getJob" })).job || null; } catch (e) { job = null; }
  if (!job || job.kind !== "youtube") return;
  job.i = job.i || 0;
  job.res = job.res || [];
  const save = () => bg({ type: "saveJob", job });

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
    d.style.background = bad ? "#c62828" : "#cc0000";
    document.getElementById("favautomsg").textContent = "FA Vision · YouTube · " + msg;
  }
  async function finish(stopped) {
    const out = { kind: "youtube", id: job.id, res: job.res, stopped: stopped || null, then: job.then || null, dry: !!job.dry, mode: job.mode || null };
    await bg({ type: "clearJob" });
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }
  const visible = el => !!el && el.getClientRects().length > 0;
  const WARN = /daily upload limit|upload limit reached|too many uploads|verify (it('|’)s you|your account)|account (is|has been) (suspended|terminated)|community guidelines strike/i;
  function warning() {
    const t = [...document.querySelectorAll("tp-yt-paper-dialog,ytcp-dialog,[role=dialog],[role=alert]")].filter(visible).map(d => d.innerText || "").join("\n");
    const hit = t.match(WARN);
    return hit ? hit[0] : null;
  }
  async function waitFor(fn, ms) {
    for (let t = 0; t < ms; t += 400) {
      if (stopAsked) return null;
      const v = fn();
      if (v) return v;
      await sleep(400);
    }
    return null;
  }
  function getFile(url, name) {
    return new Promise((res, rej) => chrome.runtime.sendMessage({ type: "image", url }, async r => {
      if (!r || !r.dataUrl) return rej(new Error((r && r.error) || "no file"));
      const blob = await fetch(r.dataUrl).then(x => x.blob());
      res(new File([blob], name, { type: "video/mp4" }));
    }));
  }
  function typeInto(el, text) {
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    String(text).split("\n").forEach((line, i, all) => {
      if (line) document.execCommand("insertText", false, line);
      if (i < all.length - 1) document.execCommand("insertLineBreak", false, null) || document.execCommand("insertParagraph", false, null);
    });
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const btn = sel => { const b = document.querySelector(sel); return b && visible(b) && b.getAttribute("aria-disabled") !== "true" && !b.disabled ? b : null; };

  await sleep(3000);
  if (/accounts\.google\.com/.test(location.host)) return finish("YouTube isn't logged in. Log in to the F.A Vision Enterprise channel in this browser, then try again.");
  if (job.i >= job.q.length) return finish();
  if (!/studio\.youtube\.com/.test(location.host) && !/\/upload/.test(location.pathname)) { location.href = "https://www.youtube.com/upload"; return; }
  const it = job.q[job.i];
  const record = (ok, why, url) => { job.res.push({ k: it.k, ok, why: why || "", url: url || "", t: new Date().toISOString() }); job.i++; return save(); };
  const next = async () => { if (job.i >= job.q.length) { box("All done. Going back to your admin…"); await sleep(1500); return finish(); } await sleep(4000); location.href = "https://www.youtube.com/upload"; };

  box(`Video ${job.i + 1} of ${job.q.length}: opening the upload window…`);
  if (await waitFor(() => /create (a )?channel/i.test((document.querySelector("[role=dialog],tp-yt-paper-dialog") || {}).innerText || ""), 3000)) return finish("This Google account has no YouTube channel yet. Create the F.A Vision Enterprise channel, then try again.");
  const input = await waitFor(() => document.querySelector("ytcp-uploads-file-picker input[type=file], input[type=file][name=Filedata], input[type=file]"), 40000);
  if (!input) { await record(false, "The upload window didn't open"); return next(); }
  if (job.dry) {
    box("Test passed ✓: the upload window opened and the file box is there. Nothing was uploaded.");
    await record(true, "Upload window opened; nothing uploaded");
    await sleep(2500);
    return finish();
  }
  let w = warning(); if (w) return finish(`YouTube showed "${w}". Nothing more was uploaded.`);
  try {
    box(`Video ${job.i + 1}: loading the file…`);
    const dt = new DataTransfer(); dt.items.add(await getFile(it.file, (it.k || "fa-vision") + ".mp4"));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (e) { await record(false, "Couldn't load the video file"); return next(); }

  const title = await waitFor(() => [...document.querySelectorAll("#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea [contenteditable=true]")].find(visible), 90000);
  if (!title) { await record(false, "YouTube didn't open the video details"); return next(); }
  await sleep(1500);
  box(`Video ${job.i + 1}: writing the title and description…`);
  typeInto(title, (it.title || "").slice(0, 100));
  await sleep(600);
  const desc = [...document.querySelectorAll("#description-textarea #textbox, ytcp-social-suggestions-textbox#description-textarea [contenteditable=true]")].find(visible);
  if (desc) { typeInto(desc, (it.description || "").slice(0, 4900)); await sleep(600); }
  const notKids = await waitFor(() => document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]'), 10000);
  if (notKids) { notKids.scrollIntoView({ block: "center" }); notKids.click(); await sleep(800); }
  for (let step = 0; step < 3 && !stopAsked; step++) {
    const nb = await waitFor(() => btn("#next-button"), 20000);
    if (!nb) break;
    nb.click();
    await sleep(2000);
  }
  w = warning(); if (w) { await record(false, w); return finish(`YouTube showed "${w}". Nothing more was uploaded.`); }
  const pub = await waitFor(() => document.querySelector('tp-yt-paper-radio-button[name="PUBLIC"]'), 20000);
  if (!pub) { await record(false, "Couldn't reach the visibility step (video saved as a draft in YouTube Studio)"); return next(); }
  pub.click();
  await sleep(1000);
  const link = (document.querySelector(".video-url-fadeable a, a.ytcp-video-info, ytcp-video-info a") || {}).href || "";
  box(`Video ${job.i + 1}: waiting for the upload to finish, then publishing…`);
  const done = await waitFor(() => btn("#done-button"), 600000);
  if (!done) { await record(false, "The upload didn't finish in 10 minutes (it is saved as a draft in YouTube Studio)", link); return next(); }
  done.click();
  const ok = await waitFor(() => /video published|published|processing/i.test(((document.querySelector("ytcp-video-share-dialog, ytcp-prechecks-warning-dialog, tp-yt-paper-dialog") || {}).innerText) || ""), 60000);
  const shared = (document.querySelector("ytcp-video-share-dialog #share-url, ytcp-video-share-dialog a[href*='youtu']") || {});
  const url = shared.href || shared.textContent || link;
  w = warning(); if (w) { await record(false, w, url); return finish(`YouTube showed "${w}".`); }
  await record(!!ok, ok ? "" : "YouTube didn't confirm (check YouTube Studio → Content)", (url || "").trim());
  const close = [...document.querySelectorAll("ytcp-button#close-button, #close-button, [aria-label=Close]")].find(visible);
  if (close) close.click();
  return next();
})();
