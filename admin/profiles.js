// Profile check (Social autopilot → Engagement tab, top card): bio link + pinned post on the
// Facebook Page, Instagram, X and TikTok.
//   Check – the add-on (extension/profile.js, job "profile", mode "check") opens each profile and reads
//           the website/link it shows and which post is pinned.
//   Fix   – mode "fix": sets ONLY the link field (the bio text stays) and pins the chosen post, found by
//           its text (default: the student desk FAV-014 post "Fresh stock, just arrived"), then reads again.
// One network after the other (runStep "profile:<net>:<mode>"). Log: data/profiles.json (only our own
// public profile details). Best effort: the selectors weren't checked live; anything a network only
// allows in its phone app is reported as such.
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/profiles.json";
  const SITE = "https://favisionenterprize.github.io/";
  const NETS = { fb: "Facebook Page", ig: "Instagram", x: "X", tiktok: "TikTok" };
  const EMPTY = {
    settings: {
      links: { fb: SITE, ig: SITE, x: SITE, tiktok: SITE + "tiktok/" },
      pin: { p: "FAV-014", text: "Fresh stock, just arrived" },
      nets: { fb: true, ig: true, x: true, tiktok: true }
    },
    status: {}, runs: []
  };
  const F = () => window.FAV_FBAUTO;
  const today = () => new Date().toLocaleDateString("en-CA");
  const bare = u => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  let S = null;

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    const st = s.settings || {};
    s.settings = { ...EMPTY.settings, ...st, links: { ...EMPTY.settings.links, ...(st.links || {}) }, pin: { ...EMPTY.settings.pin, ...(st.pin || {}) }, nets: { ...EMPTY.settings.nets, ...(st.nets || {}) } };
    s.status = s.status || {}; s.runs = s.runs || [];
    return s;
  }
  async function load(force) { if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY)); return S; }
  async function save(mutate, message) { S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY)); }
  const handles = () => { const e = window.FAV_ENGAGE && window.FAV_ENGAGE.state && window.FAV_ENGAGE.state(); return (e && e.settings && e.settings.handles) || {}; };

  function start(net, mode, then) {
    const f = F();
    if (!f || f.needExt()) return;
    if (!f.liveAddon()) { A.toast("Profile check needs the add-on's automatic updates switched on (Today tab, top).", true); if (then && then.length) setTimeout(() => f.runStep(then, true), 1500); return; }
    const st = S.settings;
    f.launch({ fb: "https://www.facebook.com/", ig: "https://www.instagram.com/", x: "https://x.com/", tiktok: "https://www.tiktok.com/" }[net], {
      kind: "profile", net, mode: mode === "fix" ? "fix" : "check", handle: handles()[net] || "", link: st.links[net] || "", pin: st.pin.text || "",
      then: then && then.length ? then : null
    });
  }
  function runAll(mode) {
    const nets = Object.keys(NETS).filter(n => S.settings.nets[n]);
    if (!nets.length) return A.toast("Tick at least one network.", true);
    F().runStep(nets.map(n => `profile:${n}:${mode}`));
  }
  async function receive(out) {
    const r = (out.res || [])[0] || {};
    const d = today(), net = out.net;
    await save(s => {
      s.status[net] = { d, link: r.link || null, pinned: r.pinned || null, linkOk: !!r.linkOk, pinOk: !!r.pinOk, why: [r.why, out.stopped].filter(Boolean).join(" · ") || "", mode: out.mode };
      s.runs = s.runs.concat([{ d, net, mode: out.mode, linkOk: !!r.linkOk, pinOk: !!r.pinOk, ...(out.stopped ? { stopped: out.stopped } : {}) }]).slice(-100);
      return s;
    }, `Profile check: ${NETS[net]} (${out.mode})`);
    const bits = [r.linkOk ? "link ✓" : "link ✗", r.pinOk ? "pinned post ✓" : "pinned post ✗"];
    return { text: `${NETS[net]}: ${bits.join(", ")}${r.why ? " · " + r.why : ""}${out.stopped ? " · " + out.stopped : ""}`, bad: !!out.stopped };
  }

  function renderCard() {
    if (!S) return "";
    const st = S.settings;
    const prods = A.products().filter(p => !p.placeholder);
    const row = net => {
      const s = S.status[net];
      const want = st.links[net];
      return `<tr><td><b>${NETS[net]}</b><br><label class="fa-check"><input type="checkbox" name="pnet_${net}" ${st.nets[net] ? "checked" : ""}> include</label></td>
        <td><input type="url" name="link_${net}" value="${esc(want)}" aria-label="${NETS[net]} link"><br><small class="${s ? (s.linkOk ? "up" : "down") : "muted"}">${s ? (s.linkOk ? "✓ shows this link" : `✗ shows ${s.link ? esc(s.link) : "no link"}`) : "not checked yet"}</small></td>
        <td><small class="${s ? (s.pinOk ? "up" : "down") : "muted"}">${s ? (s.pinOk ? "✓ pinned" : `✗ ${s.pinned ? "pinned: " + esc(String(s.pinned).slice(0, 60)) : "nothing pinned"}`) : "–"}</small>${s && s.why ? `<br><small class="muted">${esc(s.why)}</small>` : ""}${s ? `<br><small class="muted">${esc(s.d)}</small>` : ""}</td></tr>`;
    };
    return `<section class="fa-card" id="prof-card">
        <header><h2>Profile check: bio link &amp; pinned post</h2></header>
        <form class="fa-settings" id="prof-form">
          <div class="eng-table-wrap"><table class="eng-table"><thead><tr><th>Network</th><th>Link it should show</th><th>Pinned post</th></tr></thead>
            <tbody>${Object.keys(NETS).map(row).join("")}</tbody></table></div>
          <label>Pinned post: product <select name="pin_p">${prods.map(p => `<option value="${esc(p.id)}" ${p.id === st.pin.p ? "selected" : ""}>${esc(p.id)} · ${esc(String(p.name).split(" — ")[0])}</option>`).join("")}</select></label>
          <label>…found by this text in the post <input name="pin_text" type="text" maxlength="120" value="${esc(st.pin.text)}"></label>
          <div class="fa-actions"><button class="btn btn-ghost" type="submit" data-prof="check">🔍 Check profiles</button><button class="btn btn-sell" type="submit" data-prof="fix">🛠 Fix link &amp; pin</button></div>
          <p class="muted fa-small"><b>Fix</b> changes only the link field (your bio text stays) and pins the post that contains the text above. Instagram and TikTok only let some of this be done in their phone apps; the check then says so. Facebook: set Edge to act as your Page first. Not yet checked on the live sites.</p>
        </form>
      </section>`;
  }

  document.addEventListener("submit", async e => {
    const f = e.target;
    if (!f || f.id !== "prof-form" || !S) return;
    e.preventDefault();
    const el = f.elements, mode = e.submitter && e.submitter.dataset.prof === "fix" ? "fix" : "check";
    const fixUrl = u => { u = String(u || "").trim(); return /^https:\/\/[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(u) ? u : ""; };
    const next = {
      ...S.settings,
      links: Object.fromEntries(Object.keys(NETS).map(n => [n, fixUrl(el["link_" + n].value) || EMPTY.settings.links[n]])),
      nets: Object.fromEntries(Object.keys(NETS).map(n => [n, el["pnet_" + n].checked])),
      pin: { p: el.pin_p.value, text: el.pin_text.value.trim() || EMPTY.settings.pin.text }
    };
    A.busy("Saving…");
    try { await save(s => { s.settings = next; return s; }, "Profile check: settings"); }
    catch (err) { A.busy(null); return A.toast(A.friendly(err), true); }
    A.busy(null);
    runAll(mode);
  });

  window.FAV_PROFILES = { load, state: () => S, renderCard, receive, start, NETS, _test: { bare, set: s => { S = normalise(s); } } };
})();
