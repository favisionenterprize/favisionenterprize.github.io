// FA Vision side panel (opens when you click the add-on's icon).
//  🤖 Agent: you type a task; it reads the open tab (numbered buttons, links and boxes + page text),
//     asks your AI (Code.gs "muse" action, the same key as Muse) for ONE next step, does it, and repeats
//     until done. It can search the web (Bing), open pages, click, type, choose, scroll and go back.
//     Asks you first before anything that posts, sends, pays, submits or deletes; never types passwords.
//  📚 Scripts: searchable library (extension/scripts.json from the live site) + "Write a new script".
// Needs "Allow on all sites" once (button in the panel) so it can work on any tab.
const SITE = "https://favisionenterprize.github.io/";
const BACKEND = "https://script.google.com/macros/s/AKfycbz1P-CLRGiswKLWYDJMPTaOZNhtwH55qIhhCfqNKJllNRZ5Dpro_wcbR7NAVmDFVdjU2w/exec";
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ tabs
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", x === b));
  $("#tab-agent").hidden = b.dataset.tab !== "agent";
  $("#tab-scripts").hidden = b.dataset.tab !== "scripts";
  if (b.dataset.tab === "scripts") loadLibrary();
}));
$("#open-auto").addEventListener("click", () => chrome.tabs.create({ url: SITE + "admin/#fbauto" }));

// ------------------------------------------------------------------ AI (through your backend)
async function session() { return (await chrome.storage.local.get("adminSession")).adminSession || ""; }
async function ai(messages, mode) {
  const s = await session();
  if (!s) throw new Error("Open your FA Vision admin and sign in once, so the panel can use your AI.");
  const r = await fetch(BACKEND, { method: "POST", body: JSON.stringify({ action: "muse", mode: mode || "assistant", session: s, messages }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    if (j.error === "signed_out") throw new Error("Your admin sign-in has expired. Open the admin and sign in again.");
    if (j.error === "no_ai_key") throw new Error("Your backend has no AI key (GEMINI_API_KEY or ANTHROPIC_API_KEY in Apps Script).");
    if (j.error === "busy") throw new Error("Too many AI requests this hour. Try again in a few minutes.");
    throw new Error(j.error || "The AI didn't answer.");
  }
  return j.text || "";
}
const allSites = () => chrome.permissions.contains({ origins: ["<all_urls>"] });
const askAllSites = () => chrome.permissions.request({ origins: ["<all_urls>"] });
async function notes() {
  const out = [];
  if (!(await session())) out.push(`<div class="note bad">Open your <a href="#" data-open-admin>FA Vision admin</a> and sign in once. The panel uses the same AI as Muse.</div>`);
  if (!(await allSites())) out.push(`<div class="note">To work on any website the agent needs permission once. <button class="btn small gold" data-allow>Allow on all sites</button></div>`);
  $("#agent-notes").innerHTML = out.join("");
}
document.addEventListener("click", async e => {
  if (e.target.closest("[data-open-admin]")) { e.preventDefault(); chrome.tabs.create({ url: SITE + "admin/" }); }
  if (e.target.closest("[data-allow]")) { await askAllSites(); notes(); }
});
chrome.storage.onChanged.addListener(ch => { if (ch.adminSession) notes(); });
notes();

// ------------------------------------------------------------------ agent: page reading and actions (run inside the tab)
function snapshotInPage() {
  const SEL = "a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=switch],[role=combobox],[role=textbox],[contenteditable=true],summary";
  document.querySelectorAll("[data-fav-id]").forEach(e => e.removeAttribute("data-fav-id"));
  const lines = [];
  let id = 0;
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < -50 || r.top > innerHeight * 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") continue;
    const tag = el.tagName.toLowerCase(), role = el.getAttribute("role") || "", type = (el.getAttribute("type") || "").toLowerCase();
    let label = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || el.title || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ");
    if (!label && tag === "a") label = (el.querySelector("img") || {}).alt || "";
    if (type === "password") label = "[password box: the user must type this]";
    const ph = el.getAttribute("placeholder");
    id++;
    el.setAttribute("data-fav-id", id);
    let line = `[${id}] ${role || tag}${tag === "input" && type ? ":" + type : ""} "${String(label).slice(0, 70)}"`;
    if (ph && ph !== label) line += ` placeholder="${ph.slice(0, 40)}"`;
    if (tag === "a") line += ` -> ${String(el.getAttribute("href")).slice(0, 70)}`;
    if (tag === "select") line += ` options: ${[...el.options].slice(0, 8).map(o => o.text.trim()).join(" | ")}`;
    if (el.checked) line += " (checked)";
    lines.push(line);
    if (id >= 140) break;
  }
  const text = (document.body ? document.body.innerText : "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  return { url: location.href, title: document.title, elements: lines.join("\n").slice(0, 5200), text: text.slice(0, 2600), more: Math.max(0, document.body.scrollHeight - innerHeight - scrollY) > 200 };
}
function actInPage(a) {
  if (a.type === "scroll") { window.scrollBy(0, (a.direction === "up" ? -1 : 1) * innerHeight * 0.8); return "scrolled " + (a.direction || "down"); }
  const el = a.id != null ? document.querySelector(`[data-fav-id="${a.id}"]`) : null;
  if (!el) return "error: element " + a.id + " is gone (the page changed). Look at the new list.";
  el.scrollIntoView({ block: "center" });
  if (a.type === "click") { el.click(); return "clicked [" + a.id + "]"; }
  if (a.type === "type") {
    if ((el.getAttribute("type") || "").toLowerCase() === "password") return "refused: password boxes are typed by the user";
    el.focus();
    if (el.isContentEditable) {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, a.text || "");
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, a.text || "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (a.enter) {
      const k = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", k));
      el.dispatchEvent(new KeyboardEvent("keypress", k));
      el.dispatchEvent(new KeyboardEvent("keyup", k));
      if (el.form && el.tagName === "INPUT") { try { el.form.requestSubmit(); } catch (e) { /* no submit */ } }
    }
    return "typed into [" + a.id + "]" + (a.enter ? " and pressed Enter" : "");
  }
  if (a.type === "select") {
    const opt = [...(el.options || [])].find(o => o.text.trim().toLowerCase() === String(a.value).toLowerCase() || o.value === a.value);
    if (!opt) return "error: no option " + a.value;
    el.value = opt.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return "chose " + opt.text.trim();
  }
  return "error: unknown action";
}
function labelInPage(id) {
  const el = document.querySelector(`[data-fav-id="${id}"]`);
  if (!el) return null;
  return { label: (el.getAttribute("aria-label") || el.innerText || el.value || "").trim().slice(0, 80), editable: el.isContentEditable || el.tagName === "TEXTAREA" };
}
async function inTab(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
  return res ? res.result : null;
}
async function settle(tabId) {
  for (let i = 0; i < 30; i++) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t || t.status === "complete") break;
    await sleep(500);
  }
  await sleep(900);
}

// ------------------------------------------------------------------ agent: the loop
const RISKY = /\b(post|publish|send|submit|pay|buy|purchase|order|checkout|check out|delete|remove|confirm|share|transfer|withdraw|sign up|create account|leave group|unfriend|block|report)\b/i;
const INSTRUCTIONS = `You are FA Vision Agent. You control the user's own web browser (Microsoft Edge) to finish their task, one step at a time, like a careful human assistant.
Each turn you get the current page: URL, title, a numbered list of the buttons, links and boxes you can use, and some page text.
Reply with ONLY one JSON object, no markdown: {"thought":"short reasoning about what you see and what to do next","action":{...}}
Actions:
{"type":"search","query":"words"}            search the web (opens Bing results; then read and click them)
{"type":"navigate","url":"https://..."}      open a web address
{"type":"click","id":12}
{"type":"type","id":7,"text":"...","enter":false}   enter:true presses Enter afterwards (e.g. in a search box)
{"type":"select","id":9,"value":"option text"}
{"type":"scroll","direction":"down"}         or "up", to see more of the page
{"type":"back"}
{"type":"wait","seconds":3}
{"type":"ask","question":"..."}              when you need the user (a login, a choice, missing details)
{"type":"done","answer":"..."}               the task is finished: say clearly what you did and give any information found (lists, prices, links)
Rules: one action per turn; only use ids from the newest list; never type passwords, PINs, card or bank numbers (ask the user to type them); if a page needs login, ask the user to log in; if an action fails twice, try another way; use search for anything you don't know a web address for; keep text you type short and natural; when you have the answer, use done straight away.`;

let running = false, stopAsked = false;
function log(html, cls) {
  const d = document.createElement("div");
  d.className = "step" + (cls ? " " + cls : "");
  d.innerHTML = html;
  $("#log").prepend(d);
  return d;
}
function parse(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
}
function confirmStep(question) {
  return new Promise(res => {
    const d = log(`⚠️ <b>Check before I do this</b>\n${esc(question)}\n<div class="row"><button class="btn small main" data-yes>Yes, do it</button><button class="btn small" data-skip>Skip it</button><button class="btn small" data-stopnow>Stop</button></div>`, "ask");
    d.addEventListener("click", e => {
      const v = e.target.closest("[data-yes]") ? "yes" : e.target.closest("[data-skip]") ? "skip" : e.target.closest("[data-stopnow]") ? "stop" : null;
      if (!v) return;
      d.querySelector(".row").remove();
      d.insertAdjacentHTML("beforeend", `<span class="t">${v === "yes" ? "You said yes." : v === "skip" ? "Skipped." : "Stopped."}</span>`);
      res(v);
    });
  });
}
function askUser(question) {
  return new Promise(res => {
    const d = log(`🙋 <b>${esc(question)}</b>\n<textarea rows="2" placeholder="Your answer (or do it in the tab, then press Continue)"></textarea><div class="row"><button class="btn small main" data-cont>Continue</button><button class="btn small" data-stopnow>Stop</button></div>`, "ask");
    d.addEventListener("click", e => {
      if (e.target.closest("[data-cont]")) { const v = d.querySelector("textarea").value.trim(); d.querySelector(".row").remove(); res(v || "(the user pressed Continue)"); }
      if (e.target.closest("[data-stopnow]")) { d.querySelector(".row").remove(); res(null); }
    });
  });
}

async function runAgent() {
  const task = $("#task").value.trim();
  if (!task || running) return;
  if (!(await allSites()) && !(await askAllSites())) { log("I need permission to work on websites. Press Allow on all sites.", "err"); return; }
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || /^(edge|chrome|about|chrome-extension|extension):/.test(tab.url || "")) tab = await chrome.tabs.create({ url: "https://www.bing.com/" });
  const tabId = tab.id;
  running = true; stopAsked = false;
  $("#go").disabled = true; $("#stop").disabled = false;
  $("#log").innerHTML = "";
  log(`🎯 <b>${esc(task)}</b>`);
  const history = [];
  const MAX = 30;
  try {
    for (let step = 1; step <= MAX && !stopAsked; step++) {
      await settle(tabId);
      let snap;
      try { snap = await inTab(tabId, snapshotInPage); }
      catch (e) { const t = await chrome.tabs.get(tabId).catch(() => ({})); snap = { url: t.url || "", title: "", elements: "(this page can't be read: browser pages and the add-on store are off limits; navigate or search instead)", text: "", more: false }; }
      if (!snap) snap = { url: "", title: "", elements: "", text: "", more: false };
      const thinking = log(`<span class="t">Step ${step}: thinking…</span>`);
      const page = `Step ${step} of at most ${MAX}.\nPrevious steps:\n${history.slice(-14).join("\n") || "(none yet)"}\n\nCURRENT PAGE\nURL: ${snap.url}\nTitle: ${snap.title}\nElements:\n${snap.elements || "(none)"}\n${snap.more ? "(more below: scroll down to see it)\n" : ""}\nPage text (start):\n${snap.text}`;
      let reply;
      try {
        reply = await ai([{ role: "user", text: INSTRUCTIONS + "\n\nTASK: " + task }, { role: "assistant", text: "Understood. Show me the page." }, { role: "user", text: page.slice(0, 7900) }]);
      } catch (e) { thinking.remove(); log("⚠️ " + esc(e.message), "err"); break; }
      thinking.remove();
      if (stopAsked) break;
      const j = parse(reply);
      if (!j || !j.action) { history.push(`${step}. (my reply wasn't one JSON object; reply with exactly one)`); log(`<span class="t">Step ${step}: unclear answer, trying again…</span>`); continue; }
      const a = j.action;
      const said = j.thought ? `💭 ${esc(j.thought)}\n` : "";
      if (a.type === "done") { log(`${said}✅ <b>Done</b>\n${esc(a.answer || "")}`, "done"); break; }
      if (a.type === "ask") {
        if (said) log(said.trim());
        const ans = await askUser(a.question || "What should I do?");
        if (ans == null) { stopAsked = true; break; }
        history.push(`${step}. asked the user "${a.question}" → user: ${ans}`);
        continue;
      }
      let what = "", result = "";
      if (a.type === "search") {
        what = `🔎 search: ${a.query || task}`;
        await chrome.tabs.update(tabId, { url: "https://www.bing.com/search?q=" + encodeURIComponent(a.query || task) });
        result = "opened search results";
      } else if (a.type === "navigate") {
        const url = /^https?:\/\//.test(a.url || "") ? a.url : "https://" + String(a.url || "").replace(/^\/+/, "");
        what = `🌐 open ${url}`;
        await chrome.tabs.update(tabId, { url });
        result = "opened " + url;
      } else if (a.type === "back") {
        what = "⬅ back"; await chrome.tabs.goBack(tabId).catch(() => null); result = "went back";
      } else if (a.type === "wait") {
        const s = Math.min(15, Math.max(1, Number(a.seconds) || 2)); what = `⏳ wait ${s}s`; await sleep(s * 1000); result = "waited";
      } else if (["click", "type", "select", "scroll"].includes(a.type)) {
        const info = a.id != null ? await inTab(tabId, labelInPage, [a.id]).catch(() => null) : null;
        what = a.type === "click" ? `👆 click [${a.id}] ${info ? `"${info.label}"` : ""}`
          : a.type === "type" ? `⌨️ type into [${a.id}] ${info ? `"${info.label}"` : ""}: ${a.text || ""}${a.enter ? " ⏎" : ""}`
          : a.type === "select" ? `☑️ choose "${a.value}" in [${a.id}]` : `↕ scroll ${a.direction || "down"}`;
        const risky = (a.type === "click" && info && RISKY.test(info.label)) || (a.type === "type" && a.enter && info && info.editable);
        if (a.type === "type" && /\b\d{12,19}\b/.test(String(a.text || ""))) result = "refused: that looks like a card or account number";
        else if (risky) {
          log(said + esc(what));
          const v = await confirmStep(`${what}\n(on ${snap.url})`);
          if (v === "stop") { stopAsked = true; break; }
          result = v === "yes" ? await inTab(tabId, actInPage, [a]).catch(e => "error: " + e.message) : "the user said skip this; choose another way or finish";
          history.push(`${step}. ${what} → ${result}`);
          continue;
        } else result = await inTab(tabId, actInPage, [a]).catch(e => "error: " + e.message);
      } else { what = "?"; result = "unknown action type " + a.type; }
      result = String(result);
      log(`${said}${esc(what)}\n<span class="t">${esc(result)}</span>`, /^(error|refused)/.test(result) ? "err" : "");
      history.push(`${step}. ${what} → ${result}`);
      if (step === MAX) log("I stopped after 30 steps. Press Start again to carry on.", "err");
    }
  } finally {
    running = false;
    $("#go").disabled = false; $("#stop").disabled = true;
    if (stopAsked) log("■ Stopped.");
  }
}
$("#go").addEventListener("click", runAgent);
$("#stop").addEventListener("click", () => { stopAsked = true; });
$("#task").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runAgent(); });

// ------------------------------------------------------------------ scripts library
let LIB = null;
const LANG = { page: "This page", python: "Python", "python-selenium": "Selenium", "python-playwright": "Playwright", "node-puppeteer": "Puppeteer" };
async function loadLibrary() {
  if (!LIB) {
    let data;
    try { data = await (await fetch(SITE + "extension/scripts.json", { cache: "no-store" })).json(); $("#lib-note").textContent = ""; }
    catch (e) { data = await (await fetch(chrome.runtime.getURL("scripts.json"))).json().catch(() => ({ scripts: [] })); $("#lib-note").textContent = "Offline: showing the copy saved in the add-on."; }
    const mine = (await chrome.storage.local.get("myScripts")).myScripts || [];
    LIB = mine.map(s => ({ ...s, mine: true })).concat(data.scripts || []);
  }
  render();
}
function render() {
  const words = $("#q").value.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = LIB.filter(s => { const hay = [s.title, s.about, s.lang, LANG[s.lang], (s.tags || []).join(" ")].join(" ").toLowerCase(); return words.every(w => hay.includes(w)); });
  $("#results").innerHTML = hits.map(s => `<li data-id="${esc(s.id)}"><span class="badge ${s.lang === "page" ? "page" : ""}">${esc(LANG[s.lang] || s.lang)}</span>${s.mine ? `<span class="badge mine">mine</span>` : ""}<b>${esc(s.title)}</b><div class="muted">${esc(s.about || "")}</div></li>`).join("") || `<li class="muted">Nothing found. Try other words, or write a new script below.</li>`;
  $("#detail").hidden = true;
  $("#results").hidden = false;
}
$("#q").addEventListener("input", () => LIB && render());
$("#results").addEventListener("click", e => {
  const li = e.target.closest("li[data-id]");
  if (li) show(LIB.find(s => s.id === li.dataset.id));
});
function scriptCard(s, opts) {
  opts = opts || {};
  return `${opts.back ? `<button class="btn small" data-back>← All scripts</button>` : ""}
    <h3>${esc(s.title)}</h3><span class="badge ${s.lang === "page" ? "page" : ""}">${esc(LANG[s.lang] || s.lang)}</span>
    <p class="muted">${esc(s.about || "")}</p>
    ${s.how ? `<pre class="how">${esc(s.how)}</pre>` : ""}
    <div class="row">
      ${s.lang === "page" ? `<button class="btn small main" data-run>▶ Run on this page</button>` : ""}
      <button class="btn small" data-copy>Copy</button>
      <button class="btn small" data-dl>Download${s.file ? " " + esc(s.file) : ""}</button>
      ${opts.save ? `<button class="btn small gold" data-save>Save to my scripts</button>` : ""}
      ${s.mine ? `<button class="btn small" data-del>Remove</button>` : ""}
    </div>
    <div class="out muted"></div>
    <pre class="code">${esc(s.code)}</pre>`;
}
function show(s) {
  if (!s) return;
  $("#results").hidden = true;
  const d = $("#detail");
  d.hidden = false;
  d.innerHTML = scriptCard(s, { back: true });
  wire(d, s);
}
function wire(box, s) {
  box.onclick = async e => {
    const out = box.querySelector(".out");
    if (e.target.closest("[data-back]")) return render();
    if (e.target.closest("[data-copy]")) { await navigator.clipboard.writeText(s.code); out.textContent = "Copied ✓"; }
    if (e.target.closest("[data-dl]")) {
      const ext = { page: ".js", python: ".py", "python-selenium": ".py", "python-playwright": ".py", "node-puppeteer": ".js" }[s.lang] || ".txt";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([s.code], { type: "text/plain" }));
      a.download = s.file || (s.id || "script") + ext;
      a.click();
    }
    if (e.target.closest("[data-run]")) { out.textContent = "Running…"; out.textContent = await runPage(s.code); }
    if (e.target.closest("[data-save]")) {
      const mine = (await chrome.storage.local.get("myScripts")).myScripts || [];
      await chrome.storage.local.set({ myScripts: [{ ...s, id: "mine-" + Date.now() }].concat(mine).slice(0, 200) });
      LIB = null; out.textContent = "Saved to your scripts ✓ (search finds it)";
    }
    if (e.target.closest("[data-del]")) {
      const mine = ((await chrome.storage.local.get("myScripts")).myScripts || []).filter(x => x.id !== s.id);
      await chrome.storage.local.set({ myScripts: mine });
      LIB = null; loadLibrary();
    }
  };
}
// Runs a page script in the open tab. User scripts (allowed for this add-on) get past sites' code rules.
async function runPage(code) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return "No tab open.";
  if (!(await allSites()) && !(await askAllSites())) return "Allow on all sites first.";
  try {
    if (chrome.userScripts && chrome.userScripts.execute) {
      const res = await chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code }] });
      const r = res && res[0];
      return r && r.error ? "Error: " + r.error : "✓ " + (r && r.result != null ? String(r.result) : "Done");
    }
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: c => { try { return String((0, eval)(c)); } catch (e) { return "Error: " + e.message; } }, args: [code] });
    return "✓ " + (r && r.result != null ? r.result : "Done");
  } catch (e) {
    return "Couldn't run here: " + e.message + (/user ?scripts/i.test(e.message) ? " (turn on Allow user scripts in edge://extensions → FA Vision → Details)" : "");
  }
}

// write a new script with the AI (Muse code mode)
$("#write").addEventListener("click", async () => {
  const want = $("#ask").value.trim();
  if (!want) return;
  const lang = $("#lang").value;
  const how = {
    page: "Plain browser JavaScript that runs directly on the open page (no imports, no Node). It is run with eval, so end with an expression that describes the result as a string. Use only the DOM.",
    "python-selenium": "Python 3 with Selenium, attaching to the user's Edge started with --remote-debugging-port=9222 (Options.add_experimental_option('debuggerAddress','127.0.0.1:9222')).",
    "python-playwright": "Python 3 with Playwright sync API, attaching with p.chromium.connect_over_cdp('http://127.0.0.1:9222') and using browser.contexts[0].",
    "node-puppeteer": "Node.js with puppeteer-core, attaching with puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null }).",
    python: "Python 3 (requests and standard library only unless needed)."
  }[lang];
  const box = $("#written");
  box.innerHTML = `<p class="muted">Writing…</p>`;
  try {
    const text = await ai([{ role: "user", text: `Write one complete script.\nWhat it must do: ${want}\nKind: ${how}\nNever put passwords or keys in the code. Add short comments. After the code block, give 1-3 lines on how to run it.` }], "code");
    const m = text.match(/```[\w+-]*\n([\s\S]*?)```/);
    const code = m ? m[1] : text;
    const after = m ? text.slice(text.indexOf(m[0]) + m[0].length).trim() : "";
    const s = { id: "new", title: want.slice(0, 70), lang, about: want, how: after.slice(0, 600), code };
    box.innerHTML = scriptCard(s, { save: true });
    wire(box, s);
  } catch (e) { box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
});
