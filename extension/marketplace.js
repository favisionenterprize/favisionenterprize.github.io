// FA Vision Autopilot: Marketplace sync. Runs on facebook.com, but only in a tab the FA Vision admin
// opened with one of these jobs (kept per tab by background.js, never in the address):
//   mkscan  – open "Your listings" (marketplace/you/selling), scroll until everything is loaded and read
//             every listing: title, price, status, listed date, item id, and (job.menus) whether its
//             "More options" menu says "Renew listing" (ready) or "Renew (N days)".
//   mklist  – list products on Marketplace, one at a time: open marketplace/create/item, attach the
//             photos (fetched by the add-on's background, because Facebook's page blocks downloads from
//             other sites), fill title, price, category, condition New, description and location, keep
//             groups unticked and Boost off, Next → Publish, then check the listing shows on Your
//             listings. Never publishes when the photos didn't attach. 30–60 s between listings.
//   mkinbox – read the Marketplace inbox (selling side): each thread's name, listing and last messages,
//             so the admin can draft replies. Nothing is ever sent. Messenger PIN-locked chats are only
//             counted. The admin keeps these threads in the browser only (never in the repo).
// Stops at once on any Facebook warning and returns to the admin with what happened (admin/mkauto.js).
// Selectors follow Facebook's pages as of Oct 2026 but were NOT checked live (only on local mock pages).
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
  const rand = (a, b) => Math.round(a + Math.random() * (b - a));
  const bg = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r || {})); } catch (e) { res({}); } });
  let job = null;
  // Dialog handler context: "Discard post?" may discard only OUR unsent text from this job.
  const DCTX = () => ({ ours: () => { try { const it = job && job.q && job.q[job.i]; const want = it && String(it.text || it.description || "").slice(0, 30).trim(); const box = [...document.querySelectorAll("[contenteditable=true],textarea")].map(e => e.innerText || e.value || "").join(" "); return !!want && box.includes(want); } catch (e) { return false; } } });
  try { job = (await bg({ type: "getJob" })).job || null; } catch (e) { job = null; }
  if (!job || !/^mk(scan|list|inbox)$/.test(job.kind)) return;   // not a Marketplace tab: do nothing
  job.i = job.i || 0;
  job.res = job.res || [];
  job.hops = job.hops || 0;
  const save = () => bg({ type: "saveJob", job });
  const WHAT = { mkscan: "reading your listings", mklist: "listing on Marketplace", mkinbox: "reading buyer messages" }[job.kind];

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
    d.style.background = bad ? "#c62828" : "#1565c0";
    document.getElementById("favautomsg").textContent = `FA Vision · Marketplace · ${msg}`;
  }
  async function finish(stopped) {
    const out = { kind: job.kind, id: job.id, res: job.res, stopped: stopped || null, then: job.then || null, dry: !!job.dry };
    if (job.kind === "mkinbox") { out.threads = job.threads || []; out.locked = job.locked || 0; out.res = []; }
    if (window.FAV_DIALOGS) { const dl = window.FAV_DIALOGS.log(); if (dl.length) out.dialogs = dl; }
    await bg({ type: "clearJob" });
    if (window.FAV_DIALOGS) window.FAV_DIALOGS.leaving();
    location.href = job.back + "#favauto-done=" + encodeURIComponent(JSON.stringify(out));
  }
  const WARN = /temporarily blocked|temporarily restricted|you('|’)re restricted|your account (has been |is )?restricted|we limit how often|you can('|’)t use this feature|you can('|’)t (post|sell|list) right now|try again later|suspicious activity|confirm your identity|your listing (was|has been) (removed|rejected)|doesn('|’)t follow our commerce policies/i;
  function warning() {
    { const dg = window.FAV_DIALOGS && window.FAV_DIALOGS.tick(DCTX()); if (dg && dg.stop) return dg.stop; }   // shared dialog handler (extension/dialogs.js)
    const t = [...document.querySelectorAll("[role=dialog],[role=alert]")].map(d => d.innerText || "").join("\n") + "\n" + ((document.querySelector("[role=main]") || {}).innerText || "").slice(0, 3000);
    const hit = t.match(WARN);
    return hit ? hit[0] : null;
  }
  // Quality gate (same rule as admin/captions.js ensure): never post a blank description. Real text =
  // what's left without hashtags, @mentions and links; 15+ characters needed.
  const realLen = t => { const m = String(t || "").replace(/https?:\/\/\S+/g, "").replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim(); return /^(no description|add (a )?description)\.?$/i.test(m) ? 0 : m.length; };
  const tagged = t => /(^|\s)#[\p{L}\p{N}_]{2,}/u.test(String(t || ""));
  const BLANK = "blank description — not posted";
  const NOSTAMP = "no brand stamp — not posted";   // rule P1: every picture shows the posting brand's name + logo (admin/brandstamp.js sets it.stamp)
  const visible = el => !!el && el.getClientRects().length > 0;
  const textOf = el => ((el && (el.innerText || el.getAttribute("aria-label"))) || "").trim();
  function findBtn(re, root) {
    return [...(root || document).querySelectorAll('[role=button],button,[role=menuitem],[role=link]')].find(b => visible(b) && (re.test((b.getAttribute("aria-label") || "").trim()) || re.test((b.innerText || "").trim())));
  }
  const enabled = b => b && b.getAttribute("aria-disabled") !== "true" && !b.disabled;
  async function waitFor(fn, ms) {
    if (window.FAV_DIALOGS) window.FAV_DIALOGS.tick(DCTX());
    for (let t = 0; t < ms; t += 250) { if (stopAsked) return null; const v = fn(); if (v) return v; await sleep(250); }
    return null;
  }
  async function countdown(secs, text) {
    for (let s = secs; s > 0 && !stopAsked; s--) { box(`${text} ${s} s…`); await sleep(1000); }
  }
  // Open `url` (full page load). Counts the trips so a redirect loop can't run forever.
  async function go(url) {
    job.hops++;
    await save();
    if (job.hops > (job.maxHops || 80)) return finish("Facebook kept sending the tab to another page. Stopped.");
    if (window.FAV_DIALOGS) window.FAV_DIALOGS.leaving();
    location.href = url;
  }
  function getImage(url) {
    return new Promise((res, rej) => { try { chrome.runtime.sendMessage({ type: "image", url }, r => (r && r.dataUrl ? res(r.dataUrl) : rej(new Error((r && r.error) || "no image")))); } catch (e) { rej(e); } });
  }

  const SELLING = "https://www.facebook.com/marketplace/you/selling";
  const CREATE = "https://www.facebook.com/marketplace/create/item";
  const INBOX = "https://www.facebook.com/marketplace/inbox/";
  const onSelling = () => /\/marketplace\/you\/selling/.test(location.pathname);
  const onCreate = () => /\/marketplace\/create\/item/.test(location.pathname);

  await sleep(2500);
  box(WHAT + "…");
  if (/\/login/.test(location.pathname) || document.querySelector("input[name=pass]")) return finish("Facebook isn't logged in in this browser. Log in (personal profile), then press the button again.");
  if (/\/marketplace\/ineligible/.test(location.pathname) || /pages can('|’)t use marketplace/i.test((document.body.innerText || "").slice(0, 3000))) {
    return finish("Facebook is using your F.A Vision Page, and Pages can't use Marketplace. Switch to your personal profile in Facebook, then press the button again.");
  }
  let w = warning(); if (w) return finish(`Facebook showed "${w}". Stopped.`);

  // ------------------------------------------------------------- listing cards on "Your listings"
  const MORE = '[role=button][aria-label^="More options for"]';
  const parseListed = s => {
    const now = new Date(); let d;
    const m1 = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (m1) {
      const y = m1[3] ? (+m1[3] < 100 ? 2000 + +m1[3] : +m1[3]) : now.getFullYear();
      d = new Date(y, +m1[1] - 1, +m1[2]);
      if (!m1[3] && d > now) d.setFullYear(y - 1);
    } else if (/today|hour|minute|just now/i.test(s)) d = now;
    else if (/yesterday/i.test(s)) d = new Date(now - 864e5);
    else {
      d = new Date(s.replace(/,/g, "") + " " + now.getFullYear());
      if (isNaN(d)) return null;
      if (d > now) d.setFullYear(d.getFullYear() - 1);
    }
    return d.toLocaleDateString("en-CA");
  };
  const priceOf = text => {
    if (/(^|\n)\s*Free\s*(\n|$)/i.test(text)) return 0;
    const m = text.match(/(?:GH[₵S¢]|GHS|₵|GH)\s?([\d,]+(?:\.\d+)?)/i);
    return m ? Math.round(parseFloat(m[1].replace(/,/g, ""))) : null;
  };
  function cards() {
    return [...document.querySelectorAll(MORE)].filter(visible).map(more => {
      let c = more;
      for (let i = 0; i < 14 && c; i++) { c = c.parentElement; if (c && /(Listed|Renewed) on/.test(c.innerText || "") && c.querySelectorAll(MORE).length === 1) break; }
      const text = (c && c.innerText) || "";
      const title = more.getAttribute("aria-label").replace(/^More options for /, "").trim();
      const lm = text.match(/(?:Listed|Renewed) on ([^\n·|]+)/);
      const a = c && [...c.querySelectorAll("a[href]")].find(x => /\/marketplace\/item\/\d+/.test(x.href));
      const im = a && a.href.match(/\/marketplace\/item\/(\d+)/);
      return {
        t: title, price: priceOf(text), listed: lm ? parseListed(lm[1].trim()) : null,
        status: (text.match(/\n(Active|In stock|Pending|Sold|Out of stock|Draft)\n/) || [])[1] || "",
        id: im ? im[1] : null, more
      };
    });
  }
  async function loadAll() {
    let last = -1;
    for (let t = 0; t < 40 && !stopAsked; t++) {
      if (window.FAV_DIALOGS && t % 1000 < 300) window.FAV_DIALOGS.tick(DCTX());
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(1500);
      const n = document.querySelectorAll(MORE).length;
      box(`${WHAT}… ${n} found`);
      if (n === last) break;
      last = n;
    }
    window.scrollTo(0, 0);
  }
  const plusDays = n => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA");
  // Open the card's "More options" menu just to read it (never clicks anything inside), then close it.
  async function readMenu(c) {
    c.more.scrollIntoView({ block: "center" });
    await sleep(rand(500, 900));
    c.more.click();
    const menu = await waitFor(() => [...document.querySelectorAll("[role=menu]")].find(visible), 3000);
    const items = menu ? [...menu.querySelectorAll("[role=menuitem]")].filter(visible) : [];
    const renew = items.find(x => /^renew/i.test(textOf(x)));
    const label = renew ? (renew.innerText || "").trim() : "";
    const edit = items.find(x => x.tagName === "A" && /listing_id=\d+/.test(x.href || "")) || (menu && menu.querySelector('a[href*="listing_id="]'));
    const em = edit && String(edit.href).match(/listing_id=(\d+)/);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    await sleep(300);
    if ([...document.querySelectorAll("[role=menu]")].some(visible)) { c.more.click(); await sleep(300); }
    const wait = label.match(/\((\d+)\s*day/i);
    return {
      renew: !renew ? "none" : /^renew listing$/i.test(label) && renew.getAttribute("aria-disabled") !== "true" ? "ready" : "wait",
      next: wait ? plusDays(+wait[1]) : null, id: em ? em[1] : null
    };
  }

  // ============================================================= scan
  if (job.kind === "mkscan") {
    if (!onSelling()) return go(SELLING);
    await waitFor(() => document.querySelector(MORE), 15000);
    await loadAll();
    const list = cards();
    if (!list.length) return finish("No listings found on Your listings. Make sure Facebook is on your personal profile.");
    let n = 0;
    for (const c of list) {
      if (stopAsked) return;
      const row = { t: c.t, price: c.price, status: c.status, listed: c.listed, id: c.id };
      if (job.menus && !/sold/i.test(c.status)) {
        box(`checking renewals… ${++n} of ${list.length}`);
        Object.assign(row, await readMenu(c), c.id ? { id: c.id } : {});
        if (!row.id) delete row.id;
        w = warning(); if (w) { job.res.push(row); return finish(`Facebook showed "${w}". Stopped.`); }
      }
      if (row.id) row.url = `https://www.facebook.com/marketplace/item/${row.id}/`;
      job.res.push(row);
    }
    await save();
    box(`Read ${job.res.length} listings. Going back to your admin…`);
    await sleep(1200);
    return finish();
  }

  // ============================================================= list products
  // job.q: [{ p, title, price, cats: ["Furniture", …], cond: "New", text, imgs: [urls], loc }]
  if (job.kind === "mklist") {
    const done = async why => { box(`Done: ${job.res.filter(r => r.ok).length} listed. Going back…`); await sleep(1200); return finish(why); };
    if (job.i >= job.q.length) return done();
    const it = job.q[job.i];
    const n = `Listing ${job.i + 1} of ${job.q.length}`;
    const record = (ok, why, extra) => { job.res.push({ p: it.p, title: it.title, price: it.price, ok, why: why || "", t: new Date().toISOString(), ...(extra || {}) }); job.i++; job.stage = "fill"; };
    const nextItem = async waitFirst => {
      await save();
      if (job.i >= job.q.length) return done();
      if (waitFirst) await countdown(rand(job.min || 30, job.max || 60), `${n} done. Next listing in`);
      if (stopAsked) return;
      return go(CREATE);
    };

    // ---- after Publish: check it shows on Your listings
    if (job.stage === "verify") {
      if (onCreate()) {   // back on the form after Publish: Facebook didn't take it. Never fill it again for this product.
        record(false, "Facebook didn't confirm the listing (check Your listings before listing it again)");
        return nextItem(false);
      }
      if (!onSelling()) return go(SELLING);
      box(`${n}: checking it shows on Your listings…`);
      await waitFor(() => document.querySelector(MORE), 15000);
      const probe = it.title.toLowerCase().slice(0, 30);
      let found = null;
      for (let t = 0; t < 4 && !found; t++) {
        found = cards().find(c => c.t.toLowerCase().startsWith(probe));
        if (!found) { window.scrollBy(0, 1500); await sleep(1500); }
      }
      let id = found && found.id;
      if (found && !id) { const m = await readMenu(found); id = m.id; }
      record(true, found ? "" : "published, but not on Your listings yet (Facebook may still be reviewing it)", { verified: !!found, ...(id ? { id } : {}) });
      return nextItem(true);
    }

    // ---- fill the form
    if (!onCreate()) return go(CREATE);
    box(`${n}: opening the form for ${it.title}…`);
    const label = re => [...document.querySelectorAll("label,[role=combobox]")].filter(visible).find(l => re.test((l.getAttribute("aria-label") || "").trim()) || re.test(((l.innerText || "").trim().split("\n")[0] || "")));
    const field = re => { const l = label(re); return l && (l.matches("input,textarea") ? l : l.querySelector("input:not([type=file]):not([type=checkbox]),textarea")); };
    const form = await waitFor(() => field(/^title$/i), 20000);
    if (!form) { record(false, "the Marketplace form didn't open"); return nextItem(false); }
    w = warning(); if (w) return finish(`Facebook showed "${w}". Nothing more was listed.`);
    const skip = async why => { record(false, why); box(`${n}: ${why}. Not published.`, true); await sleep(3000); return nextItem(false); };

    function typeIn(el, value) {
      el.focus();
      if (el.select) el.select(); else document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, String(value));
      if ((el.value || "").replace(/[^\w]/g, "") !== String(value).replace(/[^\w]/g, "")) {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(value));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      el.blur();
    }
    // Drop-down fields (Category, Condition): open, pick the first wanted option that exists.
    async function choose(re, wanted) {
      const trig = label(re);
      if (!trig) return null;
      const now = (trig.innerText || "").toLowerCase();
      const already = wanted.find(x => now.split("\n").slice(1).some(l => l.trim() === x.toLowerCase()));
      if (already) return already;
      trig.scrollIntoView({ block: "center" });
      trig.click();
      await sleep(900);
      const opts = () => [...document.querySelectorAll('[role=option],[role=menuitemradio],[role=radio],[role=listbox] [role=button],[role=dialog] [role=button],[role=menu] [role=menuitem],[role=button]')].filter(o => visible(o) && !trig.contains(o));
      for (const want of wanted) {
        const o = await waitFor(() => opts().find(x => (x.innerText || "").trim().split("\n")[0].toLowerCase() === want.toLowerCase()), want === wanted[0] ? 5000 : 800);
        if (o) {
          o.click(); await sleep(800);
          const t = trig.isConnected ? trig : label(re);
          return t && (t.innerText || "").toLowerCase().includes(want.toLowerCase()) ? want : null;
        }
      }
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      return null;
    }

    // 1. photos: fetched by the add-on's background, attached through the form's file input
    box(`${n}: adding ${it.imgs.length} photo${it.imgs.length === 1 ? "" : "s"}…`);
    const main = document.querySelector("[role=main]") || document.body;
    const previews = () => {
      const m = (main.innerText || "").match(/Photos?\s*·\s*(\d+)\s*\/\s*\d+/i);
      const imgs = [...main.querySelectorAll("img")].filter(i => /^blob:|^data:|scontent|fbcdn/.test(i.src) && visible(i)).length;
      return Math.max(m ? +m[1] : 0, imgs);
    };
    const before = previews();
    const files = [];
    for (const [k, url] of it.imgs.entries()) {
      try {
        const blob = await fetch(await getImage(url)).then(r => r.blob());
        files.push(new File([blob], `${it.p}-${k + 1}.jpg`, { type: blob.type || "image/jpeg" }));
      } catch (e) { /* that photo couldn't be fetched: the others still go */ }
    }
    if (!files.length) return skip("couldn't fetch the photos from the website");
    const input = [...document.querySelectorAll('input[type=file]')].find(i => /image/.test(i.accept || "image"));
    if (!input) return skip("no photo upload box on the form");
    const dt = new DataTransfer();
    files.slice(0, input.multiple === false ? 1 : 10).forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const attached = await waitFor(() => previews() > before ? previews() - before : 0, 25000);
    if (!attached) return skip("the photos didn't attach");

    // 2. title, price, category, condition, description, location
    box(`${n}: filling in the details…`);
    const title = field(/^title$/i), price = field(/^price$/i);
    if (!title || !price) return skip("couldn't find the Title or Price box");
    typeIn(title, it.title); await sleep(rand(400, 800));
    typeIn(price, String(it.price)); await sleep(rand(400, 800));
    if (String(price.value || "").replace(/\D/g, "") !== String(it.price)) return skip(`the price box shows "${price.value}"`);
    const cat = await choose(/^category$/i, it.cats || ["Furniture"]);
    if (!cat) return skip("couldn't pick the category");
    const cond = await choose(/^condition$/i, [it.cond || "New"]);
    if (!cond) return skip("couldn't pick the condition");
    if (realLen(it.text) < 15) return skip(BLANK);
    if ((it.imgs || []).length && !it.stamp) return skip(NOSTAMP);
    const desc = field(/^description$/i);
    if (desc) { typeIn(desc, it.text); await sleep(rand(500, 900)); }
    if (desc && realLen(desc.value || desc.innerText) < 15) { typeIn(desc, it.text); await sleep(rand(500, 900)); }
    if (!desc || realLen(desc.value || desc.innerText) < 15) return skip(BLANK);
    if (!(desc.value || desc.innerText || "").includes("favisionenterprize.github.io/p/")) return skip("couldn't type the description");
    const loc = field(/^location$/i);
    if (loc && !/odorkor|accra/i.test(loc.value || "")) {
      typeIn(loc, it.loc || "Odorkor");
      const opt = await waitFor(() => [...document.querySelectorAll("[role=option]")].find(o => visible(o) && /odorkor|accra/i.test(o.innerText || "")), 8000);
      if (opt) { opt.click(); await sleep(800); }
      if (!/odorkor|accra/i.test(loc.value || "")) return skip("couldn't set the location to Odorkor, Accra");
    }
    w = warning(); if (w) return finish(`Facebook showed "${w}". Nothing more was listed.`);

    // 3. Next → (no groups, no boost) → Publish
    const next = await waitFor(() => { const b = findBtn(/^next$/i, main); return enabled(b) ? b : null; }, 15000);
    if (next) { next.click(); await sleep(rand(2500, 4000)); }
    const pub = await waitFor(() => { const b = findBtn(/^publish$/i); return enabled(b) ? b : null; }, 20000);
    if (!pub) return skip(next ? "the Publish button stayed off" : "the Next button stayed off (a field is missing)");
    for (const cb of [...document.querySelectorAll('[role=checkbox][aria-checked=true],input[type=checkbox]:checked')].filter(visible)) { cb.click(); await sleep(rand(200, 400)); }
    for (const sw of [...document.querySelectorAll('[role=switch][aria-checked=true],input[role=switch]:checked')].filter(visible)) {
      let c = sw; for (let k = 0; k < 5 && c && !/boost/i.test(c.innerText || c.getAttribute("aria-label") || ""); k++) c = c.parentElement;
      if (c && /boost/i.test(c.innerText || c.getAttribute("aria-label") || "")) { sw.click(); await sleep(400); }
    }
    if ([...document.querySelectorAll('[role=checkbox][aria-checked=true],input[type=checkbox]:checked')].some(visible)) return skip("couldn't untick the groups");
    if (job.dry) {
      record(true, "Test only, not published (photos attached, details filled, Publish ready)", { dry: true });
      box(`${n}: test passed ✓. Not publishing.`);
      await sleep(2500);
      await save();
      return job.i >= job.q.length ? done() : go(CREATE);
    }
    await sleep(rand(800, 1600));
    const d2 = field(/^description$/i);      // still on screen after Next? then it must still hold the text
    if (d2 && realLen(d2.value || d2.innerText) < 15) return skip(BLANK);
    // Saved BEFORE the click: if Publish reloads the page, the next page carries on with the check
    // instead of filling the form again (which would list the product twice).
    job.stage = "verify";
    await save();
    pub.click();
    box(`${n}: publishing…`);
    const gone = await waitFor(() => !onCreate() || !document.contains(pub) || /your listing (is|has been) (published|live)|listing published/i.test(document.body.innerText.slice(0, 4000)), 45000);
    await sleep(2000);
    w = warning(); if (w) { record(false, w); await save(); return finish(`Facebook showed "${w}". Nothing more was listed.`); }
    if (!gone) return skip("Facebook didn't confirm the listing");
    return go(SELLING);
  }

  // ============================================================= buyer messages (read only, never sends)
  if (job.kind === "mkinbox") {
    const LOCK = /enter (your )?pin|restore (your )?(chat )?history|create a pin|chats? (are|is) locked|messages? (are|is) (being )?(restored|synced)|end-to-end encrypted.{0,40}(pin|restore)/i;
    const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
    job.threads = job.threads || [];
    job.stage = job.stage || "list";
    if (job.stage === "list") {
      if (!/\/marketplace\/inbox/.test(location.pathname)) return go(INBOX);
      const tab = await waitFor(() => [...document.querySelectorAll("[role=tab]")].find(t => visible(t) && /^selling$/i.test(textOf(t))), 6000);
      if (tab && tab.getAttribute("aria-selected") !== "true") { tab.click(); await sleep(2500); }
      const rows = () => {
        const seen = new Set(), out = [];
        for (const a of (document.querySelector("[role=main]") || document).querySelectorAll('a[href*="/messages/t/"],a[href*="/marketplace/t/"],a[href*="/t/"]')) {
          if (!visible(a)) continue;
          const url = a.href.split("?")[0];
          if (seen.has(url)) continue;
          seen.add(url);
          const lines = (a.innerText || "").split("\n").map(x => x.trim()).filter(x => x && !/^(·|\d+[smhdw]|now|yesterday)$/i.test(x));
          if (!lines.length) continue;
          const [who, listing] = (lines[0].includes("·") ? lines[0].split("·") : [lines[0], lines[1] || ""]).map(x => clip(x, 80));
          out.push({ url, name: who, listing, snippet: clip(lines.slice(lines[0].includes("·") ? 1 : 2).join(" · "), 200), unread: /unread/i.test(a.getAttribute("aria-label") || "") || !!a.querySelector("[aria-label*=nread]") });
        }
        return out;
      };
      await waitFor(() => rows().length, 15000);
      for (let t = 0; t < 4 && !stopAsked; t++) { (document.querySelector("[role=main] [role=grid],[role=main] [role=list]") || window).scrollBy(0, 1500); await sleep(1200); }
      job.threads = rows().slice(0, job.max || 20).map(r => ({ ...r, msgs: [] }));
      if (LOCK.test((document.body.innerText || "").slice(0, 4000)) && !job.threads.length) { job.locked = 1; return finish(); }
      job.stage = "read"; job.i = 0;
      await save();
      if (!job.threads.length) return finish();
      return go(job.threads[0].url);
    }
    // stage "read": on one thread
    const th = job.threads[job.i];
    if (!th) return finish();
    box(`reading ${job.i + 1} of ${job.threads.length}…`);
    await sleep(rand(2500, 4000));
    w = warning(); if (w) return finish(`Facebook showed "${w}". Stopped.`);
    const page = (document.body.innerText || "").slice(0, 6000);
    if (LOCK.test(page)) { th.locked = true; job.locked = (job.locked || 0) + 1; }
    else {
      const rows = await waitFor(() => { const r = [...document.querySelectorAll('[role=main] [role=row], [role=main] [data-testid="message-container"]')].filter(visible); return r.length ? r : null; }, 10000) || [];
      const msgs = [];
      for (const r of rows) {
        const raw = (r.innerText || "").split("\n").map(x => x.trim()).filter(Boolean);
        const me = raw.some(x => /^you sent$/i.test(x)) || /^you sent/i.test(r.getAttribute("aria-label") || "");
        const text = raw.filter(x => !/^(you sent|enter|seen|delivered|sent|\d{1,2}:\d\d( [ap]m)?|today|yesterday|.{1,40} sent)$/i.test(x) && x !== th.name).join(" ");
        if (text) msgs.push({ me, text: clip(text, 300) });
      }
      th.msgs = msgs.slice(-6);
      if (!th.listing) { const l = (document.querySelector("[role=main] a[href*='/marketplace/item/']") || {}).innerText; if (l) th.listing = clip(l.split("\n")[0], 80); }
    }
    job.i++;
    await save();
    if (job.i >= job.threads.length || stopAsked) { box("Done. Going back to your admin…"); await sleep(1000); return finish(); }
    await sleep(rand(1500, 3000));
    return go(job.threads[job.i].url);
  }
})();
