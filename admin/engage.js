// Engagement (Social autopilot → "Engagement" tab).
// Type one comment, tick the networks, press "Comment on all my posts": the FA Vision add-on
// (extension/engage.js) opens each network, lists every post, comments on each one that doesn't
// have it yet (one network after the other), and reads likes / comments / shares / views and the
// follower count on the way. "Check stats only" does the same without commenting.
// The tab also shows what the autopilot posted (from the Facebook, Instagram and X/TikTok logs),
// followers over time per network (Instagram also from igauto's profile readings), and the best posts.
// Log: data/engagement.json { settings, followers: [{ d, net, n }], posts: { url: {...} }, runs: [] }.
(function () {
  const C = window.FAV_CONFIG;
  const A = window.FAV_ADMIN;
  if (!A) return;
  const esc = C.escapeHtml;
  const FILE = "data/engagement.json";
  const NETS = { fb: "Facebook Page", ig: "Instagram", x: "X", tiktok: "TikTok" };
  const PAGE = "facebook.com/FaVisionEnterprise", SITE = "favisionenterprize.github.io";
  const LINKS = ` 👉 Page: ${PAGE} · 🌐 Shop: ${SITE}`;
  const EMPTY = {
    settings: {
      text: "📍 Where are you seeing this from? Tell us in the comments 👇 Then like, share and follow F.A Vision Enterprise for more.",
      links: true, nets: { fb: true, ig: true, x: true, tiktok: true },
      handles: { fb: "FaVisionEnterprise", ig: "favisionent", x: "FaVisionEnt", tiktok: "" },
      limit: 200, max_comments: 60, min: 20, max: 45
    },
    followers: [], posts: {}, runs: []
  };
  const F = () => window.FAV_FBAUTO;
  const today = () => new Date().toLocaleDateString("en-CA");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const fmt = n => n == null ? "–" : Number(n).toLocaleString("en-GB");
  let S = null;

  function normalise(s) {
    s = s || JSON.parse(JSON.stringify(EMPTY));
    const st = s.settings || {};
    s.settings = { ...EMPTY.settings, ...st, nets: { ...EMPTY.settings.nets, ...(st.nets || {}) }, handles: { ...EMPTY.settings.handles, ...(st.handles || {}) } };
    s.followers = s.followers || []; s.posts = s.posts || {}; s.runs = s.runs || [];
    return s;
  }
  async function load(force) { if (!S || force) S = normalise(await A.readJsonFile(FILE, EMPTY)); return S; }
  async function save(mutate, message) { S = normalise(await A.saveJson(FILE, s => mutate(normalise(s)), message, EMPTY)); }

  // The comment that goes out: your text, plus the Page and website links (if ticked and not already in it).
  function commentText(st) {
    st = st || S.settings;
    let t = String(st.text || "").trim();
    if (st.links && !t.includes(SITE)) t += LINKS;
    return t;
  }

  // ------------------------------------------------------------------ run (one network after the other)
  const RUN_KEY = "fa-engage-run";
  function start(net, then) {
    const fb = F();
    if (!fb || fb.needExt()) return;
    if (!fb.liveAddon()) return A.toast("Engagement needs the add-on's automatic updates switched on (Today tab, top).", true);
    let run = {};
    try { run = JSON.parse(localStorage.getItem(RUN_KEY) || "{}"); } catch (e) { run = {}; }
    const st = S.settings;
    fb.launch({ fb: "https://www.facebook.com/", ig: "https://www.instagram.com/", x: "https://x.com/", tiktok: "https://www.tiktok.com/" }[net], {
      kind: "engage", net, handle: st.handles[net] || "", text: run.statsOnly ? "" : (run.text || commentText()), statsOnly: !!run.statsOnly,
      limit: st.limit, max_comments: st.max_comments, min: st.min, max: st.max, then: then && then.length ? then : null
    });
  }
  function runAll(statsOnly) {
    const nets = Object.keys(NETS).filter(n => S.settings.nets[n]);
    if (!nets.length) return A.toast("Tick at least one network.", true);
    if (!statsOnly && !String(S.settings.text || "").trim()) return A.toast("Type the comment first.", true);
    try { localStorage.setItem(RUN_KEY, JSON.stringify({ text: statsOnly ? "" : commentText(), statsOnly: !!statsOnly, d: today() })); } catch (e) { /* private mode */ }
    F()._test.runStep(nets.map(n => "engage:" + n));
  }
  async function receive(out) {
    const d = today(), res = out.res || [];
    const net = out.net;
    let text = "";
    try { text = JSON.parse(localStorage.getItem(RUN_KEY) || "{}").text || ""; } catch (e) { /* ignore */ }
    await save(s => {
      if (out.followers != null) s.followers = s.followers.filter(f => !(f.d === d && f.net === net)).concat([{ d, net, n: out.followers }]).slice(-2000);
      if (out.handle && net === "tiktok" && !s.settings.handles.tiktok) s.settings.handles.tiktok = out.handle;
      for (const r of res) {
        const p = s.posts[r.url] || { net, url: r.url, first: d, commented: [] };
        p.title = r.title || p.title; p.checked = d;
        ["likes", "comments", "shares", "views"].forEach(k => { if (r[k] != null) p[k] = r[k]; });
        if (r.commented) p.commented = (p.commented || []).concat([{ d, text: Array.from(text).slice(0, 60).join("") }]).slice(-10);
        if (r.why === "already has our comment" && !(p.commented || []).length) p.commented = [{ d: "before", text: "" }];
        s.posts[r.url] = p;
      }
      s.runs = s.runs.concat([{ d, t: new Date().toISOString(), net, posts: out.posts || res.length, checked: res.length, commented: res.filter(r => r.commented).length, followers: out.followers, stopped: out.stopped || null, commenting: !!out.commenting }]).slice(-300);
      return s;
    }, `Engagement: ${NETS[net]} (${res.filter(r => r.commented).length} comments, ${res.length} posts checked)`);
    const c = res.filter(r => r.commented).length;
    const fails = res.filter(r => !r.commented && r.why && !/already|not our|limit/.test(r.why)).length;
    return { text: `${NETS[net]}: ${out.commenting ? `${plural(c, "comment")} added, ` : ""}${plural(res.length, "post")} checked${out.followers != null ? `, ${fmt(out.followers)} followers` : ""}${fails ? ` · ${fails} couldn't be commented` : ""}${out.stopped ? ". " + out.stopped : " ✓"}`, bad: !!out.stopped };
  }

  // ------------------------------------------------------------------ numbers
  function followerList(net) {
    let list = S.followers.filter(f => f.net === net);
    if (net === "ig" && window.FAV_IGAUTO && window.FAV_IGAUTO.state && window.FAV_IGAUTO.state()) {
      const prof = (window.FAV_IGAUTO.state().profile || []).filter(p => p.followers != null).map(p => ({ d: p.d, net, n: p.followers }));
      const have = new Set(list.map(f => f.d));
      list = list.concat(prof.filter(p => !have.has(p.d)));
    }
    return list.sort((a, b) => a.d.localeCompare(b.d));
  }
  function followerRow(net) {
    const list = followerList(net);
    const last = list[list.length - 1];
    if (!last) return { now: null, week: null };
    const weekAgo = new Date(Date.now() - 7 * 864e5).toLocaleDateString("en-CA");
    const before = list.filter(f => f.d <= weekAgo).pop() || list[0];
    return { now: last.n, week: last.n - before.n };
  }
  function postTotals(net) {
    const ps = Object.values(S.posts).filter(p => p.net === net);
    const sum = k => ps.reduce((a, p) => a + (p[k] || 0), 0);
    return { n: ps.length, likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), views: sum("views"), commented: ps.filter(p => (p.commented || []).length).length };
  }
  // What the autopilot posted in the last 7 days (from its own logs).
  function autopilotPosts() {
    const since = new Date(Date.now() - 7 * 864e5).toLocaleDateString("en-CA");
    const fbS = F() && F()._test && F()._test.state ? F()._test.state() : null;
    const ig = window.FAV_IGAUTO && window.FAV_IGAUTO.state ? window.FAV_IGAUTO.state() : null;
    const so = window.FAV_SOCAUTO && window.FAV_SOCAUTO.state ? window.FAV_SOCAUTO.state() : null;
    const ok = (arr, f) => (arr || []).filter(p => p.ok && (p.d || String(p.t || "").slice(0, 10)) >= since && (!f || f(p))).length;
    return { groups: fbS ? ok(fbS.posts) : 0, ig: ig ? ok(ig.posts) : 0, x: so ? ok(so.posts, p => p.net === "x") : 0, tiktok: so ? ok(so.posts, p => p.net === "tiktok") : 0 };
  }
  function spark(net) {
    const list = followerList(net).slice(-30);
    if (list.length < 2) return "";
    const lo = Math.min(...list.map(f => f.n)), hi = Math.max(...list.map(f => f.n)), w = 80, h = 20;
    const pts = list.map((f, i) => `${Math.round(i * w / (list.length - 1))},${Math.round(h - (hi === lo ? h / 2 : (f.n - lo) * h / (hi - lo)))}`).join(" ");
    return `<svg class="eng-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  }

  // ------------------------------------------------------------------ screen
  function renderTab() {
    if (!S) return `<p class="muted">Loading…</p>`;
    const st = S.settings;
    const ap = autopilotPosts();
    const top = Object.values(S.posts).map(p => ({ ...p, score: (p.likes || 0) + 2 * (p.comments || 0) + 3 * (p.shares || 0) })).filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 15);
    const lastRun = S.runs[S.runs.length - 1];
    return `<section class="fa-card">
        <header><h2>Followers and engagement</h2>${lastRun ? `<span class="muted fa-small">Last check: ${esc(lastRun.d)}</span>` : ""}</header>
        <div class="eng-table-wrap"><table class="eng-table">
          <thead><tr><th>Network</th><th>Followers</th><th>7 days</th><th>Posts</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Our comment</th></tr></thead>
          <tbody>${Object.keys(NETS).map(net => { const f = followerRow(net), t = postTotals(net); return `<tr>
            <td><b>${NETS[net]}</b></td><td>${fmt(f.now)} ${spark(net)}</td><td class="${f.week > 0 ? "up" : f.week < 0 ? "down" : ""}">${f.week == null ? "–" : (f.week > 0 ? "+" : "") + fmt(f.week)}</td>
            <td>${fmt(t.n)}</td><td>${fmt(t.likes)}</td><td>${fmt(t.comments)}</td><td>${fmt(t.shares)}</td><td>${t.n ? `${t.commented}/${t.n}` : "–"}</td></tr>`; }).join("")}</tbody>
        </table></div>
        <p class="muted fa-small">Posted by the autopilot in the last 7 days: ${plural(ap.groups, "Facebook group post")}, ${plural(ap.ig, "Instagram post")}, ${plural(ap.x, "X post")}, ${plural(ap.tiktok, "TikTok post")}. The numbers above update each time you comment or press “Check stats only”.</p>
      </section>
      <section class="fa-card">
        <header><h2>Comment on all my posts</h2></header>
        <form class="fa-settings" id="eng-form">
          <label>Your comment (goes under every post that doesn't have it yet)
            <textarea name="text" rows="4" maxlength="900">${esc(st.text)}</textarea></label>
          <label class="fa-check"><input type="checkbox" name="links" ${st.links ? "checked" : ""}> Add the Page and website links</label>
          <div class="eng-nets">${Object.entries(NETS).map(([k, t]) => `<label class="fa-check"><input type="checkbox" name="net_${k}" ${st.nets[k] ? "checked" : ""}> ${t}</label>`).join("")}</div>
          <p class="muted fa-small">What will be posted: <span class="eng-preview">${esc(commentText())}</span></p>
          <details><summary>Settings</summary>
            <label>Facebook Page username <input name="h_fb" type="text" value="${esc(st.handles.fb)}"></label>
            <label>Instagram username <input name="h_ig" type="text" value="${esc(st.handles.ig)}"></label>
            <label>X username <input name="h_x" type="text" value="${esc(st.handles.x)}"></label>
            <label>TikTok username <small class="muted">(empty: found automatically)</small> <input name="h_tiktok" type="text" value="${esc(st.handles.tiktok)}"></label>
            <label>Most comments per network per run <input name="max_comments" type="number" min="1" max="200" value="${st.max_comments}"></label>
            <label>Seconds between comments, from <input name="min" type="number" min="10" max="600" value="${st.min}"></label>
            <label>… to <input name="max" type="number" min="10" max="900" value="${st.max}"></label>
          </details>
          <div class="fa-actions">
            <button class="btn btn-sell" type="submit" data-eng="comment">💬 Comment on all my posts</button>
            <button class="btn btn-ghost" type="submit" data-eng="stats">📊 Check stats only</button>
          </div>
          <p class="muted fa-small">Comments go out as F.A Vision Enterprise, ${st.min}–${st.max} s apart, at most ${st.max_comments} per network per run, so the accounts don't get flagged. Posts that already have it, and posts you shared from other people, are skipped. Press again later to carry on where it stopped. Make sure Facebook is set to act as your Page.</p>
        </form>
      </section>
      ${top.length ? `<section class="fa-card"><header><h2>Best posts</h2></header><div class="eng-table-wrap"><table class="eng-table">
        <thead><tr><th>Post</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Views</th></tr></thead>
        <tbody>${top.map(p => `<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(NETS[p.net] || p.net)} · ${esc((p.title || p.url).slice(0, 60))}</a></td><td>${fmt(p.likes)}</td><td>${fmt(p.comments)}</td><td>${fmt(p.shares)}</td><td>${fmt(p.views)}</td></tr>`).join("")}</tbody>
      </table></div></section>` : ""}
      ${S.runs.length ? `<section class="fa-card"><header><h2>Recent runs</h2></header><ul class="fa-list">${S.runs.slice(-12).reverse().map(r => `<li class="${r.stopped ? "bad" : ""}"><span>${esc(NETS[r.net] || r.net)} · ${r.commenting ? `${plural(r.commented, "comment")}, ` : ""}${plural(r.checked || 0, "post")} checked${r.followers != null ? ` · ${fmt(r.followers)} followers` : ""}</span><small>${esc(r.d)}${r.stopped ? " · " + esc(r.stopped) : ""}</small></li>`).join("")}</ul></section>` : ""}`;
  }

  function readForm(f) {
    const e = f.elements, st = S.settings;
    const min = Math.max(10, parseInt(e.min.value, 10) || 20);
    return {
      ...st, text: e.text.value.trim(), links: e.links.checked,
      nets: Object.fromEntries(Object.keys(NETS).map(k => [k, e["net_" + k].checked])),
      handles: { fb: e.h_fb.value.trim().replace(/^@/, "") || "FaVisionEnterprise", ig: e.h_ig.value.trim().replace(/^@/, "") || "favisionent", x: e.h_x.value.trim().replace(/^@/, "") || "FaVisionEnt", tiktok: e.h_tiktok.value.trim().replace(/^@/, "") },
      max_comments: Math.min(200, Math.max(1, parseInt(e.max_comments.value, 10) || 60)),
      min, max: Math.max(min, parseInt(e.max.value, 10) || 45)
    };
  }
  document.addEventListener("submit", async e => {
    const f = e.target;
    if (!f || f.id !== "eng-form" || !S) return;
    e.preventDefault();
    const which = e.submitter && e.submitter.dataset.eng;
    const next = readForm(f);
    A.busy("Saving…");
    try { await save(s => { s.settings = next; return s; }, "Engagement: settings"); }
    catch (err) { A.busy(null); return A.toast(A.friendly(err), true); }
    A.busy(null);
    runAll(which === "stats");
  });
  const preview = f => { const p = f.querySelector(".eng-preview"); if (p) p.textContent = commentText({ text: f.elements.text.value, links: f.elements.links.checked }); };
  document.addEventListener("input", e => { const f = e.target.closest && e.target.closest("#eng-form"); if (f && S) preview(f); });
  document.addEventListener("change", e => { const f = e.target.closest && e.target.closest("#eng-form"); if (f && S) preview(f); });

  window.FAV_ENGAGE = { load, state: () => S, renderTab, receive, start, commentText, _set: s => { S = normalise(s); } };
})();
