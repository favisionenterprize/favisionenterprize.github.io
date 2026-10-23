// Go-viral settings (Social autopilot → Engagement tab, card under the Profile check): the 7 account
// settings from the reel "7 SETTINGS TO GO VIRAL IN 2026" (Joshua Aboukhater), as a checklist per brand
// account (Instagram + the Facebook equivalents where they really exist).
//   Guidance + tracking only: nothing here changes a setting. "Open" goes to the nearest web page; rows
//   the web doesn't have say "do this in the app". Alexander changes it himself, then ticks it.
//   Shadow-ban check = MANUAL: Instagram's Account Status page has no known direct web address (Settings →
//   More info and support → Account Status) and its green/red ticks are icons we've never seen in the web
//   DOM, so no add-on job reads it. Alexander looks and records "All green" or "Issue found" + a note.
//   Log: data/viral-settings.json {checked: {"<brand>:<net>:<key>": "YYYY-MM-DD"}, shadow: {"<brand>:<net>": {d, ok, note}}}.
//   Reminder badge: a setting not confirmed in 30 days, or a shadow check older than 7 days.
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/viral-settings.json";
  const EMPTY = { checked: {}, shadow: {} };
  const RECHECK_DAYS = 30, SHADOW_DAYS = 7, PICK = "fa-viral-acct";
  const NETS = { ig: { label: "Instagram", acct: "instagram", app: "Instagram app" }, fb: { label: "Facebook Page", acct: "facebook", app: "Facebook app" } };
  const IG_SET = "https://www.instagram.com/accounts/edit/";          // Edit profile; the settings side menu is next to it
  const FB_SET = "https://www.facebook.com/settings/";                // act as the Page first
  // where: "web" = the link opens the right page · "menu" = opens settings, find it in the side menu (else the app) · "app" = phone app only
  const SETTINGS = [
    { key: "review", title: "Account suggestions (“flag for review”)",
      ig: { where: "menu", url: IG_SET, open: "Open Edit profile",
        what: "Web: Edit profile → tick “Show account suggestions on profiles”. App: Settings and activity → Follow and invite friends → turn on the recommend / review option the reel shows.",
        why: "Lets Instagram suggest your account to new people on other profiles.",
        note: "Instagram doesn't document a setting called “flag for review”; account suggestions is the real switch we know." },
      fb: null, fbNa: "No Facebook equivalent." },
    { key: "reshare", title: "Allow reshare & remix",
      ig: { where: "menu", url: IG_SET, open: "Open settings",
        what: "Settings and activity → Sharing and reuse → turn ON sharing posts and reels to stories, sharing to messages, remixing and reusing your audio.",
        why: "Every reshare or remix shows your post to the other person's followers: free reach." },
      fb: { where: "menu", url: FB_SET, open: "Open Facebook settings",
        what: "As the Page: Settings & privacy → Settings → Privacy → Stories: allow people to share your stories. On each Reel: Remix ON.",
        why: "Shares to stories and remixes spread the post beyond the Page's followers." } },
    { key: "status", title: "Shadow-ban check (account status)", shadow: true,
      ig: { where: "menu", url: IG_SET, open: "Open settings",
        what: "Settings → Account Status (web: Settings → More info and support → Account Status). Removed content and messaging issues, Features you can't use, Limits to your reach and Monetization should all be green.",
        why: "A red mark means Instagram is limiting who sees your posts; fix it before posting more." },
      fb: { where: "web", url: "https://business.facebook.com/accountquality", open: "Open Account Quality",
        what: "Meta Account Quality (or Professional dashboard → Page status): the Page should have no restrictions and be eligible for recommendations.",
        why: "A restricted Page is shown to fewer people, whatever you post." } },
    { key: "embeds", title: "Website embeds, audio reuse & business requests",
      ig: { where: "menu", url: IG_SET, open: "Open settings",
        what: "Sharing and reuse → scroll down: Website embeds ON, Reels / original audio reuse ON. In the app: allow businesses to reach out and featured content requests ON.",
        why: "Blogs and sites can embed your posts, other creators can use your sound, and brands can feature you." },
      fb: null, fbNa: "Public Facebook posts can already be embedded." },
    { key: "crosspost", title: "Crossposting (Instagram ↔ Facebook Page)",
      ig: { where: "web", url: "https://accountscenter.instagram.com/", open: "Open Accounts Center",
        what: "Edit profile → Page → connect the brand's own Facebook Page. Then Accounts Center → Sharing across profiles: share posts and reels to that Page.",
        why: "One post reaches both audiences.",
        note: "Share to the Page, not to the Alexander Awuku profile (that switch stays off)." },
      fb: { where: "menu", url: FB_SET, open: "Open Facebook settings",
        what: "As the Page: Settings → Linked accounts → Instagram → connect the brand's Instagram account.",
        why: "The same link seen from the Page side; needed for crossposting and shared insights." } },
    { key: "hq", title: "Upload at highest quality",
      ig: { where: "app",
        what: "Settings and activity → Data usage and media quality → “Upload at highest quality” ON.",
        why: "Sharper photos and videos look better and are watched for longer." },
      fb: { where: "app",
        what: "Facebook app → Menu → Settings & privacy → Settings → Media → upload photos and videos in HD / best quality.",
        why: "Facebook squeezes uploads hard unless HD is on." } },
    { key: "pro", title: "Professional account & dashboard",
      ig: { where: "menu", url: IG_SET, open: "Open settings",
        what: "Settings → For professionals → Account type and tools → switch to a Professional (Business) account. Look at the Professional dashboard once a week.",
        why: "Unlocks insights, contact buttons and the tools Instagram's recommendations are built around." },
      fb: { where: "menu", url: "https://www.facebook.com/professional_dashboard", open: "Open Professional dashboard",
        what: "Pages are already professional: act as the Page and use the Professional dashboard (insights, Page status) once a week.",
        why: "Shows what's working and warns you early about problems." } }
  ];
  const today = () => new Date().toLocaleDateString("en-CA");
  const ageDays = d => d ? Math.floor((Date.parse(today()) - Date.parse(d)) / 864e5) : Infinity;
  let S = null, busy = false;

  function normalise(s) { s = s && typeof s === "object" ? s : {}; return { ...s, checked: s.checked || {}, shadow: s.shadow || {} }; }
  async function load(force) { if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY)); return S; }
  async function save(mutate, message) { S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY)); }

  // Every brand × network; live = the account exists (status live + a handle) in 🏷 Brands.
  function accounts() {
    let list = (window.FAV_BRANDS && window.FAV_BRANDS.list && window.FAV_BRANDS.list()) || [];
    if (!list.length) list = [{ id: "fa-vision", short: "F.A Vision", accounts: { instagram: { handle: "favisionent", status: "live" }, facebook: { handle: "F.A Vision Enterprise", status: "live" } } }];
    const out = [];
    list.forEach(b => Object.keys(NETS).forEach(net => {
      const a = (b.accounts || {})[NETS[net].acct] || {};
      out.push({ id: `${b.id}:${net}`, brand: b.id, net, name: b.short || b.name || b.id, handle: a.handle || "", live: a.status === "live" && !!a.handle });
    }));
    return out;
  }
  const rowsFor = net => SETTINGS.filter(s => s[net]);
  function progress(acc) {
    const rows = rowsFor(acc.net), done = rows.filter(s => S.checked[`${acc.id}:${s.key}`]).length;
    const stale = rows.filter(s => ageDays(S.checked[`${acc.id}:${s.key}`]) > RECHECK_DAYS).length;
    const sh = S.shadow[acc.id], shadowDue = ageDays(sh && sh.d) > SHADOW_DAYS;
    return { done, total: rows.length, stale, shadowDue, due: stale + (shadowDue ? 1 : 0) };
  }
  function due() { if (!S) return 0; return accounts().filter(a => a.live).reduce((n, a) => n + progress(a).due, 0); }
  function picked(accs) {
    let id = null; try { id = localStorage.getItem(PICK); } catch (e) {}
    const live = accs.filter(a => a.live);
    return live.find(a => a.id === id) || live[0] || null;
  }

  function renderCard() {
    if (!S) return "";
    const accs = accounts(), cur = picked(accs), n = due();
    const chip = a => {
      if (!a.live) return `<button type="button" disabled title="Create it in 🏷 Brands first">${esc(a.name)} · ${NETS[a.net].label} <small>(account not created yet)</small></button>`;
      const p = progress(a);
      return `<button type="button" data-vs-acct="${esc(a.id)}" aria-pressed="${cur && cur.id === a.id}">${esc(a.name)} · ${NETS[a.net].label} <small>${p.done}/${p.total}</small>${p.due ? ` <span class="pill sold">${p.due}</span>` : ""}</button>`;
    };
    let body = `<p class="muted">No live Instagram or Facebook account yet: set one to Live in 🏷 Brands.</p>`;
    if (cur) {
      const p = progress(cur), sh = S.shadow[cur.id];
      const row = s => {
        const g = s[cur.net], k = `${cur.id}:${s.key}`, d = S.checked[k], old = ageDays(d) > RECHECK_DAYS;
        const where = g.where === "app" ? `<span class="pill est">📱 Do this in the ${NETS[cur.net].app}</span>`
          : `<a class="btn btn-ghost" href="${esc(g.url)}" target="_blank" rel="noopener">↗ ${esc(g.open)}</a>${g.where === "menu" ? ` <small class="muted">find it in the settings side menu; if it isn't there, use the ${NETS[cur.net].app}</small>` : ""}`;
        const shadowBox = s.shadow ? `<div class="vs-shadow">
            <b>Last check:</b> ${sh ? `<span class="pill ${sh.ok ? "ok" : "sold"}">${sh.ok ? "✓ all green" : "✗ issue found"}</span> ${esc(sh.d)}${sh.note ? ` · ${esc(sh.note)}` : ""}${ageDays(sh.d) > SHADOW_DAYS ? ` <span class="pill sold">older than ${SHADOW_DAYS} days</span>` : ""}` : `<span class="pill sold">never checked</span>`}
            <div class="fa-actions"><input type="text" name="vs_note" maxlength="200" placeholder="Note (what was red, what you did)" aria-label="Shadow check note"><button type="button" class="btn btn-sell" data-vs-shadow="ok">✓ All green</button><button type="button" class="btn btn-ghost" data-vs-shadow="issue">✗ Issue found</button></div>
            <small class="muted">Manual check: the add-on doesn't read this page (no direct web address, and its ticks are icons).</small></div>` : "";
        return `<li class="vs-row${d ? " done" : ""}">
            <label class="fa-check"><input type="checkbox" data-vs-tick="${esc(k)}" ${d ? "checked" : ""} ${busy ? "disabled" : ""}> <b>${esc(s.title)}</b></label>
            ${d ? `<small class="${old ? "down" : "up"}">${old ? "confirmed " + esc(d) + ": check again" : "✓ " + esc(d)}</small>` : `<small class="muted">not done yet</small>`}
            <p>${esc(g.what)}</p><p class="muted fa-small"><b>Why:</b> ${esc(g.why)}${g.note ? ` ${esc(g.note)}` : ""}</p>
            <div class="fa-actions">${where}</div>${shadowBox}</li>`;
      };
      const na = SETTINGS.filter(s => !s[cur.net]).map(s => `${esc(s.title)}: ${esc(s.fbNa || "not on this network")}`);
      body = `<div class="st-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}"><div style="width:${Math.round(100 * p.done / p.total)}%"></div><span>${p.done} of ${p.total} done · ${esc(cur.name)} ${NETS[cur.net].label}${cur.handle ? " (" + esc(cur.handle) + ")" : ""}</span></div>
        <ol class="vs-list">${rowsFor(cur.net).map(row).join("")}</ol>
        ${na.length ? `<p class="muted fa-small">Not on Facebook: ${na.join(" · ")}</p>` : ""}`;
    }
    return `<section class="fa-card" id="vs-card">
        <header><h2>Go-viral settings${n ? ` <span class="pill sold" id="vs-badge">${n} to check</span>` : ` <span class="pill ok">all confirmed</span>`}</h2></header>
        <p class="muted fa-small">The 7 settings from “7 settings to go viral in 2026”. Nothing changes automatically: open it, change it yourself, then tick. Ticks older than ${RECHECK_DAYS} days and a shadow check older than ${SHADOW_DAYS} days come back as reminders.</p>
        <div class="pills vs-accts">${accs.filter(a => a.live).map(chip).join("")}</div>
        ${accs.some(a => !a.live) ? `<p class="muted fa-small vs-notyet">Account not created yet (set it to Live in 🏷 Brands): ${accs.filter(a => !a.live).map(a => esc(a.name + " " + NETS[a.net].label)).join(" · ")}</p>` : ""}
        ${body}
      </section>`;
  }
  const rerender = () => { if (window.FAV_FBAUTO && window.FAV_FBAUTO.render) window.FAV_FBAUTO.render(); };

  async function store(mutate, msg) {
    if (busy) return;
    busy = true;
    try { await save(mutate, msg); } catch (err) { A.toast(A.friendly(err), true); }
    busy = false; rerender();
  }
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("#vs-card [data-vs-acct], #vs-card [data-vs-shadow]");
    if (!t || !S) return;
    if (t.dataset.vsAcct) { try { localStorage.setItem(PICK, t.dataset.vsAcct); } catch (err) {} return rerender(); }
    const cur = picked(accounts()); if (!cur) return;
    const ok = t.dataset.vsShadow === "ok", noteEl = document.querySelector("#vs-card [name=vs_note]");
    const note = String(noteEl && noteEl.value || "").trim().slice(0, 200), d = today();
    if (!ok && !note) return A.toast("Say what was red in the note first.", true);
    store(s => { s.shadow[cur.id] = { d, ok, ...(note ? { note } : {}) }; if (ok) s.checked[`${cur.id}:status`] = d; else delete s.checked[`${cur.id}:status`]; return s; },
      `Go-viral settings: ${cur.name} ${NETS[cur.net].label} account status ${ok ? "all green" : "issue found"}`);
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.vsTick || !S) return;
    const k = t.dataset.vsTick, on = t.checked, d = today();
    store(s => { if (on) s.checked[k] = d; else delete s.checked[k]; return s; }, `Go-viral settings: ${k} ${on ? "done" : "not done"}`);
  });

  window.FAV_VIRAL = { load, state: () => S, renderCard, due, accounts, SETTINGS, _test: { set: s => { S = normalise(s); }, progress } };
})();
