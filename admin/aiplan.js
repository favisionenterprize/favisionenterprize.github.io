// "🧭 AI Plan" screen (dashboard button, deep link #aiplan): the rules register from the
// "FA Vision AI Operating System Blueprint". Alexander Awuku is the final say on every rule.
// Data: data/ai-plan.json { owner, paused, paused_at, updated, rules: [{ id, dept, task, line, setting, status, steps[] }] }
//   line    : ai | draft | human        (AI does it alone / AI drafts, Alexander sends / Human only)
//   setting : allow | approve | block   (Always allow / Needs approval / Blocked)
//   status  : proposed | approved | retired
//   steps   : Social autopilot runStep keys this rule governs ("ig", "x", "engage:" = any key starting with it)
// Gate (window.FAV_AIPLAN.gate(stepKey)) is used by fbauto.js runStep() and launch():
//   paused → skip everything · rule not approved, retired, blocked or human-only → skip
//   needs approval / AI drafts → confirm box once per run · otherwise go. Steps no rule covers → go.
// Edits save through FAV_ADMIN.saveJson. Skips/asks are kept in localStorage "fa-aiplan-log" (last 60).
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const A = () => window.FAV_ADMIN || {};
  const FILE = "data/ai-plan.json";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, bad) => { if (A().toast) A().toast(m, bad); };
  const LINES = { ai: "AI does it alone", draft: "AI drafts, Alexander sends", human: "Human only" };
  const SETTINGS = { allow: "Always allow", approve: "Needs approval", block: "Blocked" };
  const STATUS = { proposed: "Proposed", approved: "Approved", retired: "Retired" };
  const DEPTS = ["Sales", "Marketing", "Support", "Finance", "Workshop", "Staff"];
  const EMPTY = { owner: "Alexander Awuku", paused: false, paused_at: null, rules: [] };
  let P = null, dirty = false, loading = null, asked = {};

  // ---------------------------------------------------------------- data
  function normalise(p) {
    p = p && typeof p === "object" ? p : JSON.parse(JSON.stringify(EMPTY));
    p.rules = Array.isArray(p.rules) ? p.rules : [];
    p.rules.forEach(r => {
      if (!LINES[r.line]) r.line = "draft";
      if (!SETTINGS[r.setting]) r.setting = "approve";
      if (!STATUS[r.status]) r.status = "proposed";
      r.steps = Array.isArray(r.steps) ? r.steps : [];
    });
    p.paused = !!p.paused;
    return p;
  }
  async function load(force) {
    if (P && !force) return P;
    if (!loading) loading = (async () => {
      try { P = normalise(await A().readJsonFile(FILE, EMPTY)); }
      catch (e) { P = P || normalise(null); }
      finally { loading = null; }
      return P;
    })();
    return loading;
  }
  async function save(message, mutate) {
    if (A().busy) A().busy("Saving your AI plan…");
    try {
      P = normalise(await A().saveJson(FILE, cur => {
        const next = mutate(normalise(cur));
        next.updated = new Date().toISOString().slice(0, 10);
        return next;
      }, message, EMPTY));
      dirty = false;
      toast("AI plan saved ✓");
    } catch (e) { toast(A().friendly ? A().friendly(e) : String(e), true); }
    finally { if (A().busy) A().busy(null); render(); }
  }

  // ---------------------------------------------------------------- gate
  function ruleFor(key) {
    if (!P) return null;
    let best = null, len = -1;
    for (const r of P.rules) for (const s of r.steps) {
      const hit = s.endsWith(":") ? key.startsWith(s) : key === s;
      if (hit && s.length > len) { best = r; len = s.length; }
    }
    return best;
  }
  function log(entry) {
    try {
      const L = JSON.parse(localStorage.getItem("fa-aiplan-log") || "[]");
      L.unshift(Object.assign({ t: new Date().toISOString() }, entry));
      localStorage.setItem("fa-aiplan-log", JSON.stringify(L.slice(0, 60)));
    } catch (e) { /* storage off: no log */ }
  }
  // { v: "go" | "skip" | "ask", r?, why? }
  function decide(key) {
    if (!P) return { v: "go" };
    if (P.paused) return { v: "skip", why: "Pause All is on" };
    const r = ruleFor(key);
    if (!r) return { v: "go" };
    if (r.status !== "approved") return { v: "skip", r, why: `${r.id} is ${STATUS[r.status]}` };
    if (r.setting === "block" || r.line === "human") return { v: "skip", r, why: `${r.id} is ${r.setting === "block" ? "Blocked" : "Human only"}` };
    if (r.setting === "approve" || r.line === "draft") return { v: "ask", r };
    return { v: "go", r };
  }
  // true = run the step. runId groups the "Needs approval" question so it's asked once per run.
  function gate(key, runId) {
    const d = decide(String(key || ""));
    if (d.v === "skip") { log({ key, v: "skipped", why: d.why }); return false; }
    if (d.v === "ask") {
      const k = (runId || "") + "|" + d.r.id;
      if (asked[k] === undefined) asked[k] = window.confirm(`${d.r.id} needs your approval:\n\n${d.r.task}\n\nRun it now?`);
      log({ key, v: asked[k] ? "you approved" : "you declined", why: d.r.id });
      return asked[k];
    }
    return true;
  }
  const paused = () => !!(P && P.paused);

  // ---------------------------------------------------------------- screen
  let screen = $("#screen-aiplan");
  if (!screen) {
    screen = document.createElement("main");
    screen.className = "screen"; screen.id = "screen-aiplan"; screen.hidden = true;
    screen.innerHTML = `<div class="dash-head"><div><h1>🧭 AI Plan</h1>
      <p class="muted">Your rules for every department. <b>You are the final say</b>: a rule runs only when its Status is Approved. Retired, Blocked or Human only rules never run, and Needs approval asks you first. Pause All stops every automation at once.</p></div>
      <div class="dash-head-actions"><button class="btn btn-ghost btn-sm" data-go="dash">← My products</button></div></div>
      <div id="ap-body"><p class="muted">Loading…</p></div>`;
    const last = [...document.querySelectorAll("main.screen")].pop();
    (last ? last.parentNode : document.body).insertBefore(screen, last ? last.nextSibling : null);
    const st = document.createElement("style");
    st.textContent = `#ap-body{display:grid;gap:16px}
.ap-pause{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 16px;border-radius:14px;background:#e3f4ea;border:1px solid #bfe3cc}
.ap-pause.on{background:#fdecea;border-color:#f5c2bd}.ap-pause b{font-size:16px}
.ap-sum{display:flex;flex-wrap:wrap;gap:8px}.ap-pill{font-size:12px;padding:3px 10px;border-radius:99px;background:#eef1f5}
.ap-dept{background:#fff;border:1px solid #e3e7ee;border-radius:14px;overflow:hidden}
.ap-dept h2{font-size:15px;margin:0;padding:10px 14px;background:#f8fafd;border-bottom:1px solid #eceff3}
.ap-rule{display:grid;grid-template-columns:44px 1fr;gap:10px;padding:12px 14px;border-top:1px solid #f1f3f6}
.ap-rule:first-of-type{border-top:0}.ap-id{font-weight:700;color:#0d55af;padding-top:6px}
.ap-rule textarea{width:100%;box-sizing:border-box;font:inherit;font-size:14px;min-height:48px;padding:7px;border:1px solid #dadce0;border-radius:8px;resize:vertical}
.ap-ctl{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center}
.ap-ctl select{font:inherit;font-size:13px;padding:5px 6px;border:1px solid #dadce0;border-radius:8px;background:#fff;max-width:100%}
.ap-ctl select.s-approved{background:#e3f4ea;border-color:#9fd4b2}.ap-ctl select.s-retired{background:#fdecea;border-color:#f0b3ac}.ap-ctl select.s-proposed{background:#fff6e0;border-color:#f0d58c}
.ap-steps{font-size:12px;color:#5f6368}.ap-bar{position:sticky;bottom:0;display:flex;gap:10px;justify-content:flex-end;padding:10px;background:rgba(255,255,255,.95);border-top:1px solid #e3e7ee}
.ap-log{font-size:12px;color:#3c4043;max-height:220px;overflow:auto;margin:0;padding-left:18px}
@media (max-width:600px){.ap-rule{grid-template-columns:1fr}.ap-id{padding:0}}`;
    document.head.appendChild(st);
  }
  if (!document.querySelector("[data-aiplan]")) {
    const bar = document.querySelector("#screen-dash .dash-head-actions");
    if (bar) bar.insertAdjacentHTML("afterbegin", `<button class="btn btn-ghost" data-aiplan>🧭 AI Plan <span class="ps-badge" id="ap-badge" hidden></span></button>`);
  }

  async function show() {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s !== screen; });
    const top = $("#top-actions"); if (top) top.hidden = false;
    window.scrollTo(0, 0);
    if (location.hash !== "#aiplan") history.replaceState(null, "", "#aiplan");
    $("#ap-body").innerHTML = `<p class="muted">Loading…</p>`;
    if (!dirty) await load(true);
    render();
  }
  const opts = (map, cur) => Object.keys(map).map(k => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(map[k])}</option>`).join("");
  function badge() {
    const b = $("#ap-badge"); if (!b || !P) return;
    const n = P.rules.filter(r => r.status === "proposed").length;
    b.hidden = !(P.paused || n);
    b.textContent = P.paused ? "paused" : String(n);
  }
  function render() {
    badge();
    if (screen.hidden || !P) return;
    const count = s => P.rules.filter(r => r.status === s).length;
    const depts = DEPTS.concat([...new Set(P.rules.map(r => r.dept))].filter(d => !DEPTS.includes(d)));
    let logRows = [];
    try { logRows = JSON.parse(localStorage.getItem("fa-aiplan-log") || "[]"); } catch (e) { /* none */ }
    $("#ap-body").innerHTML = `
      <div class="ap-pause${P.paused ? " on" : ""}">
        <div><b>${P.paused ? "⏸ Everything is paused" : "▶ Automations are running"}</b><br>
        <span class="muted">${P.paused ? `Paused ${esc(String(P.paused_at || "").replace("T", " ").slice(0, 16))}. No autopilot step runs until you resume.` : "Each autopilot step checks its rule below before it runs."}</span></div>
        <button class="btn ${P.paused ? "btn-sell" : "btn-ghost"}" data-ap-pause>${P.paused ? "▶ Resume all" : "⏸ Pause All"}</button>
      </div>
      <div class="ap-sum"><span class="ap-pill">${P.rules.length} rules</span><span class="ap-pill">✓ ${count("approved")} approved</span><span class="ap-pill">● ${count("proposed")} proposed</span><span class="ap-pill">✕ ${count("retired")} retired</span><span class="ap-pill">Final say: ${esc(P.owner || "Alexander Awuku")}</span>${P.updated ? `<span class="ap-pill">Saved ${esc(P.updated)}</span>` : ""}</div>
      ${depts.map(d => {
        const rs = P.rules.filter(r => r.dept === d);
        if (!rs.length) return "";
        return `<section class="ap-dept"><h2>${esc(d)}</h2>${rs.map(r => `
          <div class="ap-rule" data-rid="${esc(r.id)}">
            <div class="ap-id">${esc(r.id)}</div>
            <div><textarea data-f="task" aria-label="Rule ${esc(r.id)}">${esc(r.task)}</textarea>
              <div class="ap-ctl">
                <select data-f="line" aria-label="Line">${opts(LINES, r.line)}</select>
                <select data-f="setting" aria-label="Action setting">${opts(SETTINGS, r.setting)}</select>
                <select data-f="status" class="s-${esc(r.status)}" aria-label="Status">${opts(STATUS, r.status)}</select>
                <span class="ap-steps">${r.steps.length ? "Controls: " + esc(r.steps.join(", ")) : "Not automated yet"}</span>
              </div></div>
          </div>`).join("")}</section>`;
      }).join("")}
      <section class="ap-dept"><h2>Add a rule</h2><div class="ap-rule"><div class="ap-id">+</div><div>
        <textarea id="ap-new" placeholder="What should happen?"></textarea>
        <div class="ap-ctl"><select id="ap-new-dept" aria-label="Department">${depts.map(d => `<option>${esc(d)}</option>`).join("")}</select>
        <button class="btn btn-ghost btn-sm" data-ap-add>+ Add (starts as Proposed)</button></div></div></div></section>
      <section class="ap-dept"><h2>What the plan stopped or asked (this browser)</h2><div style="padding:10px 14px">
        ${logRows.length ? `<ol class="ap-log">${logRows.map(l => `<li>${esc(String(l.t).replace("T", " ").slice(0, 16))} · ${esc(l.key)} · ${esc(l.v)}${l.why ? " (" + esc(l.why) + ")" : ""}</li>`).join("")}</ol>` : `<p class="muted">Nothing yet.</p>`}
      </div></section>
      <div class="ap-bar"><span class="muted" id="ap-state" style="margin-right:auto;align-self:center">${dirty ? "Unsaved changes" : "All changes saved"}</span>
        <button class="btn btn-sell" data-ap-save${dirty ? "" : " disabled"}>Save my rules</button></div>`;
  }

  // ---------------------------------------------------------------- events
  document.addEventListener("click", async e => {
    if (e.target.closest("[data-aiplan]")) { e.preventDefault(); show(); return; }
    if (screen.hidden || !P) return;
    if (e.target.closest("[data-ap-pause]")) {
      const on = !P.paused;
      if (on && !window.confirm("Pause every automation now? Nothing will post, reply or renew until you press Resume.")) return;
      await save(on ? "AI plan: Pause All" : "AI plan: resume", cur => { cur.paused = on; cur.paused_at = on ? new Date().toISOString() : null; return cur; });
      return;
    }
    if (e.target.closest("[data-ap-save]")) {
      const mine = JSON.parse(JSON.stringify(P.rules));
      await save("AI plan: rules updated by Alexander", cur => {
        const byId = Object.fromEntries(mine.map(r => [r.id, r]));
        cur.rules = cur.rules.map(r => byId[r.id] ? Object.assign(r, byId[r.id]) : r);
        mine.forEach(r => { if (!cur.rules.some(x => x.id === r.id)) cur.rules.push(r); });
        return cur;
      });
      return;
    }
    if (e.target.closest("[data-ap-add]")) {
      const task = ($("#ap-new").value || "").trim();
      if (!task) return toast("Type what the rule should do first.", true);
      const dept = $("#ap-new-dept").value;
      const pre = (dept[0] || "X").toUpperCase();
      let n = 1; while (P.rules.some(r => r.id === pre + n)) n++;
      P.rules.push({ id: pre + n, dept, task, line: "draft", setting: "approve", status: "proposed", steps: [] });
      dirty = true; render();
    }
  });
  function edit(e) {
    if (screen.hidden || !P) return;
    const row = e.target.closest && e.target.closest("[data-rid]"), f = e.target.dataset && e.target.dataset.f;
    if (!row || !f) return;
    const r = P.rules.find(x => x.id === row.dataset.rid);
    if (!r) return;
    r[f] = e.target.value;
    if (f === "status") e.target.className = "s-" + r.status;
    if (!dirty) {
      dirty = true;
      const b = $("[data-ap-save]"); if (b) b.disabled = false;
      const s = $("#ap-state"); if (s) s.textContent = "Unsaved changes";
    }
  }
  document.addEventListener("input", edit);
  document.addEventListener("change", edit);
  window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  // Load once the admin is ready, so the autopilot can check the rules without opening this screen.
  (function warm(tries) {
    if (A().readJsonFile) load().then(badge).catch(() => {});
    else if (tries < 40) setTimeout(() => warm(tries + 1), 500);
  })(0);

  window.FAV_AIPLAN = { open: show, load, gate, decide, paused, render, _test: { set: p => { P = normalise(p); asked = {}; }, state: () => P } };
})();
