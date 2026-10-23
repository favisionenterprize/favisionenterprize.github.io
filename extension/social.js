// FA Vision Autopilot: X (Twitter) and TikTok. Runs on x.com and tiktok.com, but only in a
// tab the FA Vision admin opened with a job (kept per tab by background.js). Job kinds:
//   x      – x.com/compose/post: caption → photo → Post, one post per queued item
//   tiktok – TikTok Studio photo post: photo → title + description → Post
// Pauses between posts; stops at once on any warning; returns to the admin with the results.
// Checked live on TikTok Studio (Oct 2026): Photos tab = ?tab=photo, image input accepts jpg/png/webp,
// the description is a Draft.js box, button "Post". Oct 15 2026: posts had been going out with an EMPTY
// description (only the "catchy title" was filled): execCommand text showed in the box but Draft.js's own
// state stayed blank. Now the description goes in with a synthetic paste event (ClipboardEvent + DataTransfer
// text/plain, line breaks kept: verified live on the edit page), falls back to execCommand insertText, is
// checked again right before Post, and the run STOPS rather than post a blank description.
// Post sometimes reloads the tab into TikTok Studio → Posts: job.posted marks the click so that reload
// counts as posted (it used to be logged as a failure, e.g. FAV-006 on 15 Oct).
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
    const type = blob.type || "image/jpeg";
    return new File([blob], "fa-vision." + (/video/.test(type) ? "mp4" : /png/.test(type) ? "png" : "jpg"), { type });
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
  // TikTok's description box sometimes copies the hashtag line over the first line when
  // the text is inserted (seen live Oct 2026). Put the first line back if that happened.
  async function fixFirstLine(ed, text) {
    const want = (String(text).split("\n").find(l => l.trim()) || "").trim();
    for (let tries = 0; tries < 2; tries++) {
      const blk = ed.querySelector('[data-block="true"]');
      if (!want || !blk || blk.innerText.trim() === want) return;
      const r = document.createRange(); r.selectNodeContents(blk);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.execCommand("insertText", false, want);
      await sleep(600);
    }
  }
  // Paste text into a Draft.js editor the way a person would (Ctrl+V): Draft.js updates its own state.
  function pasteInto(ed, text) {
    ed.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    const dt = new DataTransfer();
    dt.setData("text/plain", String(text));
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }
  const flat = t => String(t || "").replace(/\s+/g, " ").trim();
  const probeOf = text => flat((String(text).split("\n").find(l => l.trim()) || "")).slice(0, 25);
  const ttEditor = () => [...document.querySelectorAll("[data-e2e=caption_container] [contenteditable=true],.public-DraftEditor-content[contenteditable=true],.public-DraftEditor-content")].find(visible);
  const hasText = (text, ed) => { ed = ed || ttEditor(); const p = probeOf(text); return !!ed && !!p && flat(ed.innerText).includes(p); };
  // Description in: paste first, then execCommand typing. true when the text is really in the box.
  async function setDescription(text) {
    let ed = ttEditor(); if (!ed) return false;
    pasteInto(ed, text);
    await sleep(1200);
    if (hasText(text)) return "paste";
    ed = ttEditor(); if (!ed) return false;
    typeInto(ed, text);
    await sleep(1200);
    ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));   // close the #hashtag suggestions
    await fixFirstLine(ttEditor() || ed, text);
    await sleep(600);
    return hasText(text) ? "type" : false;
  }
  function setInput(input, value) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Quality gate (same rule as admin/captions.js ensure): never post a blank description. Real text =
  // what's left without hashtags, @mentions and links; 15+ characters needed.
  const realLen = t => { const m = String(t || "").replace(/https?:\/\/\S+/g, "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim(); return /^(no description|add (a )?description)\.?$/i.test(m) ? 0 : m.length; };
  const tagged = t => /(^|\s)#[\p{L}\p{N}_]{2,}/u.test(String(t || ""));
  const BLANK = "blank description — not posted";
  const NOSTAMP = "no brand stamp — not posted";   // rule P1: every picture shows the posting brand's name + logo (admin/brandstamp.js sets it.stamp)
  const composeUrl = () => job.kind === "x" ? "https://x.com/compose/post" : "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo";
  const record = (it, ok, why) => { job.res.push({ k: it.k, p: it.p || null, ok, why: [why, it.soundNote].filter(Boolean).join(" · "), sound: it.soundUsed || null, ...(it.soundFav ? { fav: it.soundFav, fav_found: !!it.soundFavFound, fav_tried: !!it.soundFavTried } : {}), t: new Date().toISOString() }); job.i++; return save(); };
  // Boost: sounds only from TikTok's own picker (business accounts only see the Commercial Music Library
  // there). it.sound = { name: trending sound, fav: favourite artist to try first, avoid: tracks used lately }.
  // Picker safety: everything after opening it happens inside the picker dialog; no dialog → no sound.
  // Never fails the post. Selectors NOT checked live.
  const NOT_FOR_BUSINESS = /not available for (business|commercial)|unavailable for business|isn('|’)t available for business|only available for personal|not available in your (region|country)/i;
  const escKey = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const pickerSearch = d => [...d.querySelectorAll("input")].find(i => visible(i) && /search/i.test(i.placeholder || i.getAttribute("aria-label") || ""));
  const soundDialog = () => [...document.querySelectorAll("[role=dialog],[class*=sound-panel],[class*=SoundPanel],[class*=music-panel]")].filter(visible).reverse().find(pickerSearch) || null;
  function pickerRows(d) {
    const all = [...d.querySelectorAll("[class*=item],[class*=Item],li,[role=listitem],[role=option]")].filter(visible);
    return all.filter(r => !all.some(o => o !== r && r.contains(o)));   // innermost rows
  }
  const rowOk = r => r.getAttribute("aria-disabled") !== "true" && !/\bunavailable\b|not available/i.test(r.innerText || "");
  function trackOf(r, artist) {
    const lines = String(r.innerText || "").split(/\n|·|•| - /).map(x => x.trim()).filter(x => x && !/^(use|add|\+|use sound|\d+:\d+)$/i.test(x));
    return (lines.find(x => x.toLowerCase() !== String(artist || "").toLowerCase()) || lines[0] || "").slice(0, 80);
  }
  async function pickerQuery(q) {
    const d = soundDialog(), s = d && pickerSearch(d);
    if (!s) return false;
    s.focus(); setInput(s, q);
    s.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    await sleep(2500);
    return true;
  }
  async function useRow(row) {
    const d = soundDialog();
    if (!d || !d.contains(row)) return false;
    row.scrollIntoView({ block: "center" }); row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); await sleep(600);
    const use = findBtn(/^(use|add|use sound|use this sound|\+)$/i, row) || row.querySelector("button");
    (use || row).click(); await sleep(2000);
    const d2 = soundDialog(); const c = d2 && findBtn(/^(close|done|save|confirm)$/i, d2); if (c) { c.click(); await sleep(1000); }
    return true;
  }
  async function closePicker() {
    const d = soundDialog(); if (!d) return;
    const c = findBtn(/^(close|cancel|back)$/i, d);
    if (c) c.click(); else escKey();
    await sleep(800);
  }
  async function addSound(it) {
    const s = it.sound;
    if (!s || (!s.name && !s.fav)) { if (job.kind === "tiktok" && !job.dry) it.soundNote = "no sound (no trending sound picked for this post)"; return; }
    const notes = [];
    try {
      box(`opening TikTok's sound picker…`);
      let d = soundDialog();
      if (!d) {
        const open = findBtn(/^(add sound|sounds?|music|add music)$/i) || document.querySelector("[data-e2e*=sound] [role=button],[data-e2e*=music] button,[class*=sound-entry],[class*=SoundEntry]");
        if (!open) { it.soundNote = "no sound: TikTok showed no sound button"; return; }
        open.click();
        d = await waitFor(soundDialog, 8000);
      }
      if (!d) { escKey(); it.soundNote = "no sound: no sound picker dialog (nothing else clicked)"; return; }
      if (s.fav) {
        it.soundFav = s.fav;
        box(`looking for a ${s.fav} song in TikTok's picker…`);
        if (await pickerQuery(s.fav)) {
          const avoid = new Set((s.avoid || []).map(x => String(x).toLowerCase()));
          const probe = s.fav.toLowerCase().slice(0, 18);
          const hit = await waitFor(() => {
            const dd = soundDialog(); if (!dd) return null;
            if (NOT_FOR_BUSINESS.test(dd.innerText || "")) return { na: true };
            const rows = pickerRows(dd).filter(r => (r.innerText || "").toLowerCase().includes(probe) && rowOk(r));
            const row = rows.find(r => !avoid.has(trackOf(r, s.fav).toLowerCase()));
            return row ? { row } : rows.length ? { all: true } : null;
          }, 6000);
          if (hit && hit.row) {
            const track = trackOf(hit.row, s.fav);
            if (await useRow(hit.row)) { it.soundUsed = track; it.soundFavFound = true; return; }
            notes.push(`${s.fav}: the picker closed before the song was added`);
          } else if (hit && hit.all) notes.push(`${s.fav}: only tracks used lately`);
          else { it.soundFavTried = true; notes.push(`artist not available in picker: ${s.fav}`); }
        }
      }
      if (!s.name) { await closePicker(); it.soundNote = notes.concat("no sound").join(" · "); return; }
      if (!soundDialog() || !(await pickerQuery(s.name))) { it.soundNote = notes.concat("no sound: no search box in the sound picker").join(" · "); escKey(); return; }
      const probe = s.name.toLowerCase().slice(0, 18);
      const row = await waitFor(() => { const dd = soundDialog(); return dd && pickerRows(dd).find(r => (r.innerText || "").toLowerCase().includes(probe) && rowOk(r)); }, 10000);
      if (!row || !(await useRow(row))) { await closePicker(); it.soundNote = notes.concat(`no sound: “${s.name}” not found in TikTok's library`).join(" · "); return; }
      it.soundUsed = s.name;
      if (notes.length) it.soundNote = notes.concat(`trending sound instead: ${s.name}`).join(" · ");
    } catch (e) { it.soundNote = notes.concat("no sound: " + String(e.message || e).slice(0, 60)).join(" · "); }
  }
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
  if (job.kind === "tiktok" && job.posted === job.i) {    // the tab reloaded after we pressed Post
    job.posted = -1;
    await record(it, true, "posted (TikTok opened Posts)");
    return next(true);
  }
  if (realLen(it.text) < 15) { await record(it, false, BLANK); return next(false); }
  if (it.img && !it.stamp) { await record(it, false, NOSTAMP); return next(false); }
  if (!(await arrive(composeUrl()))) return;
  // Brand posts (🏷 Brands): a post that belongs to another brand is only posted when this browser is
  // signed in to that brand's own account. X knows the handle from the job; on TikTok we read it off
  // the page, and when it can't be read the post waits rather than going out under the wrong name.
  if (it.as) {
    const want = it.as.replace(/^@/, "").toLowerCase();
    const link = document.querySelector('a[href^="/@"]');
    const signed = (job.kind === "x" ? String(job.account || "").replace(/^@/, "")
      : (((link && link.getAttribute("href")) || "").match(/^\/@([^/?#]+)/) || [, ""])[1] || "").toLowerCase();
    if (signed !== want) {
      await record(it, false, `this post belongs to @${want}, and ${NET} is ${signed ? "signed in as @" + signed : "signed in to another account"} — not posted`);
      return next(false);
    }
  }
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
    // Right before Post: the caption must still be there, with its hashtags; else type it again, else don't post.
    if (realLen(ed.innerText) < 15 || (tagged(it.text) && !tagged(ed.innerText))) {
      box(`${n}: the caption went missing, putting it back…`);
      typeInto(ed, it.text); await sleep(800);
      if (realLen(ed.innerText) < 15) { const dt = new DataTransfer(); dt.setData("text/plain", it.text); ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); await sleep(800); }
    }
    if (realLen(ed.innerText) < 15) { await record(it, false, BLANK); return next(false); }
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
  await sleep(600);
  if (!(await setDescription(it.text))) { await record(it, false, BLANK + " (the description box stayed empty)"); return finish("TikTok's description box stayed empty: " + BLANK + ". Stopped rather than post without a description."); }
  await addSound(it);
  w = warning(); if (w) return finish(`TikTok showed "${w}". Nothing more was posted.`);
  const post = await waitFor(() => { const b = [...document.querySelectorAll("button")].find(x => visible(x) && (x.innerText || "").trim() === "Post"); return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null; }, 30000);
  if (!post) { await record(it, false, "Post button stayed off"); return next(false); }
  await sleep(rand(1000, 2000));
  // Last check right before Post (the sound picker or the title can re-render the editor).
  const edNow = () => (ttEditor() || {}).innerText || "";
  if ((!hasText(it.text) || (tagged(it.text) && !tagged(edNow()))) && !(await setDescription(it.text))) { await record(it, false, BLANK + " (the description was empty right before Post)"); return finish("TikTok's description box was empty right before Post: " + BLANK + ". Stopped rather than post without a description."); }
  if (realLen(edNow()) < 15) { await record(it, false, BLANK); return finish("TikTok's description box was empty right before Post: " + BLANK + "."); }
  if (job.dry) {
    box(`${n}: test passed ✓ (photo uploaded, description typed, Post ready). Not posting.`);
    await sleep(2500);
    const discard = findBtn(/^discard$/i);
    if (discard) { discard.click(); const sure = await waitFor(() => findBtn(/^discard edits$/i), 5000); if (sure) sure.click(); }
    await record(it, true, "Test only, not posted");
    return next(false);
  }
  post.scrollIntoView({ block: "center" });
  job.posted = job.i;               // if Post reloads the tab, the next page load counts it as posted
  await save();
  post.click();
  box(`${n}: posting…`);
  // Possible follow-up questions ("Continue to post?", content-check prompts): go ahead.
  const extra = await waitFor(() => { const d = [...document.querySelectorAll("[role=dialog]")].find(visible); return d && findBtn(/^(post now|continue|post|got it|ok)$/i, d); }, 6000);
  if (extra) { extra.click(); await sleep(1500); }
  const done = await waitFor(() => /\/tiktokstudio\/content/.test(location.pathname) || /(post(ed)? successfully|your (photo|post)s? (is|are|has been) (being )?(uploaded|posted|published)|manage your posts)/i.test(document.body.innerText.slice(0, 4000)), 90000);
  await sleep(1500);
  w = warning(); if (w) { await record(it, false, w); return finish(`TikTok showed "${w}". Nothing more was posted.`); }
  job.posted = -1;
  await record(it, !!done, done ? "" : "TikTok didn't confirm the post (check TikTok Studio → Posts)");
  return next(!!done);
})();
