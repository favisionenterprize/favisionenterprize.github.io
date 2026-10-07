// FA Vision Autopilot: X (Twitter) and TikTok. Runs on x.com and tiktok.com, but only in a
// tab the FA Vision admin opened with a job (kept per tab by background.js). Job kinds:
//   x      – x.com/compose/post: caption → photo → Post, one post per queued item
//   tiktok – TikTok Studio photo post: photo → title + description → Post
// Pauses between posts; stops at once on any warning; returns to the admin with the results.
// Checked live on TikTok Studio (Oct 2026): Photos tab = ?tab=photo, image input accepts jpg/png/webp,
// the description is a Draft.js box (execCommand insertText works, paste doesn't), button "Post".
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const bg = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r || {})); } catch (e) { res({}); } });

  let job = null;
  try { job = (await bg({ type: "getJob" })).job || null; } catch (e) { job = null; }
  if (!job || (job.kind !== "x" && job.kind !== "tiktok")) return;   // not an autopilot tab
  const NET = job.kind === "x" ? "X" : "TikTok";
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
    d.style.background = bad ? "#c62828" : (job.kind === "x" ? "#111" : "#fe2c55");
    document.getElementById("favautomsg").textContent = `FA Vision · ${NET} · ${msg}`;
  }
  async function finish(stopped) {
    const out = { kind: job.kind, id: job.id, res: job.res, stopped: stopped || null, then: job.then || null, dry: !!job.dry, mode: job.mode || null };
    await bg({ type: "clearJob" });
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }

  const WARN = /try again later|rate limit|temporarily (blocked|restricted|locked|limited)|your account (is|has been) (locked|suspended|restricted)|suspicious activity|confirm (it('|’)s you|your identity)|verify (you('|’)re|that you are) (human|not a robot)|too many (attempts|requests)|daily limit|something went wrong/i;
  const visible = el => !!el && el.getClientRects().length > 0;
  function warning() {
    const t = [...document.querySelectorAll('[role=dialog],[role=alert],[data-testid=toast]')].filter(visible).map(d => d.innerText || "").join("\n");
    const hit = t.match(WARN);
    return hit ? hit[0] : null;
  }
  function findBtn(re, root) {
    return [...(root || document).querySelectorAll("button,[role=button]")]
      .find(b => visible(b) && (re.test((b.innerText || "").trim()) || re.test((b.getAttribute("aria-label") || "").trim())));
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
  async function fileFor(url) {
    const blob = await fetch(await getImage(url)).then(r => r.blob());
    return new File([blob], "fa-vision.jpg", { type: blob.type || "image/jpeg" });
  }
  async function arrive(url) {
    if (job.navFor === job.i) return true;
    job.navFor = job.i;
    await save();
    location.href = url;
    return false;
  }
  // Type into a Draft.js / contenteditable box, line by line.
  function typeInto(ed, text) {
    ed.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    const lines = String(text).split("\n");
    lines.forEach((line, i) => {
      if (line) document.execCommand("insertText", false, line);
      if (i < lines.length - 1) document.execCommand("insertParagraph", false, null) || document.execCommand("insertLineBreak", false, null);
    });
  }
  function setInput(input, value) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const composeUrl = () => job.kind === "x" ? "https://x.com/compose/post" : "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo";
  const record = (it, ok, why) => { job.res.push({ k: it.k, p: it.p || null, ok, why: why || "", t: new Date().toISOString() }); job.i++; return save(); };
  async function next(ok) {
    if (job.i >= job.q.length) { box("All done. Going back to your admin…"); await sleep(1500); return finish(); }
    if (ok) await countdown(rand(job.min || 90, job.max || 240), `Posted ✓ (${job.res.filter(r => r.ok).length} so far). Next in`);
    else await sleep(3000);
    if (stopAsked) return;
    await arrive(composeUrl());
  }

  await sleep(2500);
  if (job.i >= job.q.length) return finish();
  const it = job.q[job.i];
  if (!(await arrive(composeUrl()))) return;
  const n = `Post ${job.i + 1} of ${job.q.length}`;
  box(`${n}: opening…`);
  await sleep(rand(2500, 4000));
  let w = warning(); if (w) return finish(`${NET} showed "${w}". Nothing more was posted.`);

  // ============================================================= X
  if (job.kind === "x") {
    if (/\/(i\/flow\/)?login|\/i\/flow\/signup/.test(location.pathname)) return finish("X isn't logged in. Log in as @" + (job.account || "FaVisionEnt") + " in this browser, then run again.");
    const ed = await waitFor(() => [...document.querySelectorAll('[data-testid=tweetTextarea_0][contenteditable=true],[data-testid=tweetTextarea_0] [contenteditable=true]')].find(visible), 25000);
    if (!ed) { await record(it, false, "Couldn't find X's post box"); box(`${n}: post box didn't open. Skipping…`, true); return next(false); }
    const dialog = ed.closest("[role=dialog]") || document;
    box(`${n}: typing the caption…`);
    typeInto(ed, it.text);
    await sleep(800);
    if (!ed.innerText.trim()) {
      const dt = new DataTransfer(); dt.setData("text/plain", it.text);
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(800);
    }
    if (!ed.innerText.trim()) { await record(it, false, "Couldn't type the caption"); return next(false); }
    let photoNote = "";
    try {
      box(`${n}: adding the photo…`);
      const input = dialog.querySelector("input[data-testid=fileInput]") || document.querySelector("input[data-testid=fileInput],input[type=file][accept*=image]");
      if (!input) throw new Error("no file input");
      const dt = new DataTransfer(); dt.items.add(await fileFor(it.img));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (!(await waitFor(() => dialog.querySelector("[data-testid=attachments] img"), 20000))) photoNote = "Posted without photo";
    } catch (e) { photoNote = "Posted without photo"; }
    w = warning(); if (w) return finish(`X showed "${w}". Nothing more was posted.`);
    const post = await waitFor(() => { const b = dialog.querySelector("[data-testid=tweetButton]") || document.querySelector("[data-testid=tweetButton],[data-testid=tweetButtonInline]"); return b && b.getAttribute("aria-disabled") !== "true" && !b.disabled ? b : null; }, 30000);
    if (!post) { await record(it, false, "Post button stayed off"); return next(false); }
    await sleep(rand(800, 1600));
    if (job.dry) {
      box(`${n}: test passed ✓ (caption typed${photoNote ? ", photo NOT attached" : ", photo attached"}). Not posting.`);
      await sleep(2500);
      const close = findBtn(/^close$/i, dialog === document ? undefined : dialog);
      if (close) { close.click(); await sleep(1000); const discard = findBtn(/^discard$/i); if (discard) discard.click(); }
      await record(it, true, "Test only, not posted" + (photoNote ? " · photo didn't attach" : ""));
      return next(false);
    }
    post.click();
    box(`${n}: posting…`);
    const sent = await waitFor(() => !document.contains(ed) || !visible(ed) || /your post was sent/i.test((document.querySelector("[data-testid=toast]") || {}).innerText || ""), 45000);
    await sleep(1500);
    w = warning(); if (w) { await record(it, false, w); return finish(`X showed "${w}". Nothing more was posted.`); }
    await record(it, !!sent, sent ? photoNote : "X didn't confirm the post");
    return next(!!sent);
  }

  // ============================================================= TikTok (photo post)
  if (/\/login/.test(location.pathname)) return finish("TikTok isn't logged in. Log in to FA Vision Enterprise's TikTok in this browser, then run again.");
  box(`${n}: opening the Photos upload…`);
  const photosTab = await waitFor(() => [...document.querySelectorAll("[role=tab],button")].find(b => visible(b) && (b.innerText || "").trim() === "Photos"), 15000);
  if (photosTab && photosTab.getAttribute("aria-selected") !== "true") { photosTab.click(); await sleep(1500); }
  const input = await waitFor(() => [...document.querySelectorAll("input[type=file]")].find(i => /image/.test(i.accept || "")), 20000);
  if (!input) { await record(it, false, "Couldn't find TikTok's photo upload"); return next(false); }
  try {
    box(`${n}: uploading the photo…`);
    const dt = new DataTransfer(); dt.items.add(await fileFor(it.img));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (e) { await record(it, false, "Couldn't load the photo"); return next(false); }
  const ed = await waitFor(() => [...document.querySelectorAll("[data-e2e=caption_container] [contenteditable=true],.public-DraftEditor-content")].find(visible), 45000);
  if (!ed) { await record(it, false, "TikTok didn't open the post details"); return next(false); }
  await sleep(1500);
  box(`${n}: writing the title and description…`);
  const title = [...document.querySelectorAll("input")].find(i => visible(i) && /catchy title/i.test(i.placeholder || ""));
  if (title && it.title) setInput(title, it.title.slice(0, 90));
  typeInto(ed, it.text);
  await sleep(1200);
  ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));   // close the #hashtag suggestions
  if (!ed.innerText.trim()) { await record(it, false, "Couldn't type the description"); return next(false); }
  w = warning(); if (w) return finish(`TikTok showed "${w}". Nothing more was posted.`);
  const post = await waitFor(() => { const b = [...document.querySelectorAll("button")].find(x => visible(x) && (x.innerText || "").trim() === "Post"); return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null; }, 30000);
  if (!post) { await record(it, false, "Post button stayed off"); return next(false); }
  await sleep(rand(1000, 2000));
  if (job.dry) {
    box(`${n}: test passed ✓ (photo uploaded, description typed, Post ready). Not posting.`);
    await sleep(2500);
    const discard = findBtn(/^discard$/i);
    if (discard) { discard.click(); const sure = await waitFor(() => findBtn(/^discard edits$/i), 5000); if (sure) sure.click(); }
    await record(it, true, "Test only, not posted");
    return next(false);
  }
  post.scrollIntoView({ block: "center" });
  post.click();
  box(`${n}: posting…`);
  // Possible follow-up questions ("Continue to post?", content-check prompts): go ahead.
  const extra = await waitFor(() => { const d = [...document.querySelectorAll("[role=dialog]")].find(visible); return d && findBtn(/^(post now|continue|post|got it|ok)$/i, d); }, 6000);
  if (extra) { extra.click(); await sleep(1500); }
  const done = await waitFor(() => /\/tiktokstudio\/content/.test(location.pathname) || /(post(ed)? successfully|your (photo|post)s? (is|are|has been) (being )?(uploaded|posted|published)|manage your posts)/i.test(document.body.innerText.slice(0, 4000)), 90000);
  await sleep(1500);
  w = warning(); if (w) { await record(it, false, w); return finish(`TikTok showed "${w}". Nothing more was posted.`); }
  await record(it, !!done, done ? "" : "TikTok didn't confirm the post (check TikTok Studio → Posts)");
  return next(!!done);
})();
