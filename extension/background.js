// FA Vision Autopilot background: once an hour it reads your live site's data,
// shows on the add-on's icon how many things are waiting (listings due for
// renewal, plus 1 if today's group posts haven't run, plus 1 for Instagram), sends one reminder a day,
// and starts the daily run at the time set in the admin (if switched on).
//
// Self-updating: the scripts that do the work on Facebook and Instagram are not
// taken from this folder but downloaded from the live website (the list is in
// extension/live.json) and run as browser "user scripts" (Edge and Chrome). So every change pushed to
// the website reaches this add-on within the hour, and always before a run starts,
// with no download or reload. If user scripts are switched off in the browser, or the
// site can't be reached, the copies in this folder are used instead.
const SITE = "https://favisionenterprize.github.io/";
const ADMIN = SITE + "admin/";

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
function setup() {
  chrome.alarms.create("check", { delayInMinutes: 1, periodInMinutes: 60 });
  install(true);
  check();
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === "check") { install(false); check(); awake(); } });
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: ADMIN + "#fbauto" }));
chrome.notifications.onClicked.addListener(id => { chrome.notifications.clear(id); chrome.tabs.create({ url: ADMIN + "#fbauto" }); });

const today = () => new Date().toLocaleDateString("en-CA");
const days = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 864e5);
const getJson = path => fetch(SITE + path + "?t=" + Date.now(), { cache: "no-store" }).then(r => r.json());

async function check() {
  let ap;
  try { ap = await getJson("data/facebook-autopilot.json"); }
  catch (e) { return; }
  const s = Object.assign({ daily_limit: 20, renew_after_days: 7, auto_run: false, auto_time: "09:00" }, ap.settings || {});
  const d = today();

  // Renewals: from what the add-on last read on Facebook's "Your listings" page.
  const sel = ap.selling && ap.selling.cards;
  const needsCheck = !sel;
  const due = sel ? sel.filter(c => !/sold|pending|out of stock/i.test(c.status || "") && (c.next ? c.next <= d : (c.listed && days(c.listed, d) >= s.renew_after_days)) && c.none !== d).length : 0;
  const groups = (ap.groups || []).filter(g => g.active !== false).length;
  const postsToday = (ap.posts || []).filter(x => x.d === d).length;
  const postsWaiting = groups > 0 && postsToday < s.daily_limit;
  let igWaiting = false;
  try {
    const ig = await getJson("data/instagram-autopilot.json");
    const is = Object.assign({ on: true, daily_posts: 3 }, ig.settings || {});
    igWaiting = is.on && (ig.posts || []).filter(x => x.d === d && x.ok).length < is.daily_posts;
  } catch (e) { /* no Instagram file yet */ }
  const n = (needsCheck ? 1 : due) + (postsWaiting ? 1 : 0) + (igWaiting ? 1 : 0);

  chrome.action.setBadgeBackgroundColor({ color: "#e0245e" });
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
  chrome.action.setTitle({ title: n ? `FA Vision: ${[needsCheck ? "listings not checked yet" : due && due + " to renew", postsWaiting && "group posts waiting", igWaiting && "Instagram posts waiting"].filter(Boolean).join(", ")}` : "FA Vision: all done for today" });

  const st = await chrome.storage.local.get(["notified", "autorun"]);
  const now = new Date().toTimeString().slice(0, 5);
  if (s.auto_run && (needsCheck || due || postsWaiting || igWaiting) && now >= s.auto_time && st.autorun !== d) {
    await chrome.storage.local.set({ autorun: d, notified: d });
    chrome.tabs.create({ url: ADMIN + "#fbauto-run" });
    return;
  }
  if (n && st.notified !== d && now >= "08:00") {
    await chrome.storage.local.set({ notified: d });
    chrome.notifications.create("fav-" + d, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "FA Vision autopilot",
      message: [needsCheck ? "Your Marketplace listings haven't been checked for renewal yet." : due && `${due} Marketplace listing${due === 1 ? " is" : "s are"} ready to renew.`, postsWaiting && "Today's group posts haven't run yet.", igWaiting && "Today's Instagram posts haven't run yet."].filter(Boolean).join(" ") + " Tap to open."
    });
  }
}

// ============================================================= self-update from the website
const BUNDLED = [   // fallback: the copies in this folder
  { id: "fb-autopilot", file: "autopilot.js", matches: ["https://*.facebook.com/*"] },
  { id: "fb-pricesync", file: "facebook.js", matches: ["https://*.facebook.com/marketplace/*"], world: "MAIN" },
  { id: "instagram", file: "instagram.js", matches: ["https://www.instagram.com/*"] }
];
const nocache = url => fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
async function sha(text) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(b)].slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("");
}
// Latest scripts from the website (cached for 10 minutes unless forced).
async function liveScripts(force) {
  const st = await chrome.storage.local.get("live");
  if (!force && st.live && Date.now() - st.live.at < 10 * 60e3) return st.live;
  try {
    const man = await nocache(SITE + "extension/live.json").then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    const scripts = await Promise.all((man.scripts || []).map(async x => {
      if (!/^[a-z0-9-]+\.js$/.test(String(x.file || ""))) throw new Error("bad script name in live.json");
      const r = await nocache(SITE + "extension/" + x.file);
      if (!r.ok) throw new Error(x.file + ": HTTP " + r.status);
      return { ...x, code: await r.text() };
    }));
    if (!scripts.length) throw new Error("no scripts listed");
    const live = { at: Date.now(), version: man.version || "", hash: await sha(scripts.map(x => x.id + x.code).join("\n")), scripts };
    await chrome.storage.local.set({ live, liveError: null });
    return live;
  } catch (e) {
    await chrome.storage.local.set({ liveError: String(e.message || e) });
    return st.live || null;     // keep using the last good download
  }
}
async function userScriptsOn() {
  try { if (!chrome.userScripts) return false; await chrome.userScripts.getScripts(); return true; } catch (e) { return false; }
}
let installing = null;
function install(force) { installing = installing || doInstall(force).finally(() => { installing = null; }); return installing; }
async function doInstall(force) {
  const live = await liveScripts(force);
  const us = await userScriptsOn();
  const st = await chrome.storage.local.get("installed");
  const want = us && live ? "live:" + live.hash : "bundled:" + chrome.runtime.getManifest().version + ":" + us;
  if (st.installed === want && !force) return status();
  try {
    if (us) {
      await chrome.userScripts.configureWorld({ messaging: true });
      const old = await chrome.userScripts.getScripts();
      if (old.length) await chrome.userScripts.unregister({ ids: old.map(x => x.id) });
    }
    const oldCs = await chrome.scripting.getRegisteredContentScripts();
    if (oldCs.length) await chrome.scripting.unregisterContentScripts({ ids: oldCs.map(x => x.id) });
    if (us && live) {
      await chrome.userScripts.register(live.scripts.map(x => ({
        id: x.id, matches: x.matches, js: [{ code: x.code }], runAt: x.runAt || "document_idle", world: x.world === "MAIN" ? "MAIN" : "USER_SCRIPT"
      })));
    } else {
      await chrome.scripting.registerContentScripts(BUNDLED.map(x => ({
        id: x.id, matches: x.matches, js: [x.file], runAt: "document_idle", world: x.world === "MAIN" ? "MAIN" : "ISOLATED", persistAcrossSessions: true
      })));
    }
    await chrome.storage.local.set({ installed: want });
  } catch (e) {
    await chrome.storage.local.set({ installed: null, liveError: "install: " + String(e.message || e) });
  }
  return status();
}
async function status() {
  const st = await chrome.storage.local.get(["installed", "live", "liveError"]);
  const live = String(st.installed || "").startsWith("live:");
  return {
    mode: live ? "live" : "bundled",
    userScripts: await userScriptsOn(),
    version: live && st.live ? st.live.version : chrome.runtime.getManifest().version,
    checked: st.live ? new Date(st.live.at).toISOString() : null,
    error: st.liveError || null,
    shell: chrome.runtime.getManifest().version
  };
}
// The user may switch "Allow user scripts" on later: notice it when the admin opens.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "hello") return;
  install(!!msg.force).then(reply, () => status().then(reply));
  return true;
});

// Sites a run may open: the add-on's own scripts' sites.
async function allowedStart(url) {
  const st = await chrome.storage.local.get("live");
  const patterns = BUNDLED.concat((st.live && st.live.scripts) || []).flatMap(x => x.matches);
  return patterns.some(p => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(url));
}

// Messages come from the add-on's own content scripts (bundled mode) and from
// the downloaded user scripts (live mode); both go to the same handlers.
const handlers = [];
const listen = h => { handlers.push(h); chrome.runtime.onMessage.addListener(h); if (chrome.runtime.onUserScriptMessage) chrome.runtime.onUserScriptMessage.addListener(h); };

// Photos for group posts: fetched here (this script may read your site) and handed to the Facebook tab.
listen((msg, sender, reply) => {
  if (!msg || msg.type !== "image" || !String(msg.url).startsWith(SITE)) return;
  fetch(msg.url).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
    .then(b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); }))
    .then(dataUrl => reply({ dataUrl }), err => reply({ error: String(err) }));
  return true;   // reply comes later
});

// Jobs from the admin (Facebook and Instagram): kept per tab here, so a redirect (www → web.facebook.com) can't lose them.
listen((msg, sender, reply) => {
  const tabId = sender.tab && sender.tab.id;
  if (!msg || tabId == null) return;
  const key = "job" + tabId;
  if (msg.type === "start") {
    if (!msg.job || !msg.job.kind) { reply({ ok: false }); return; }
    // Fetch the latest scripts first, so every run uses what's on the website now.
    install(false)
      .then(() => allowedStart(String(msg.url)))
      .then(ok => { if (!ok) throw new Error("not an autopilot site"); return chrome.storage.session.set({ [key]: msg.job }); })
      .then(() => chrome.tabs.update(tabId, { url: msg.url }))
      .then(() => reply({ ok: true }), err => reply({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "getJob") { chrome.storage.session.get(key).then(o => reply({ job: o[key] || null })); return true; }
  if (msg.type === "saveJob") { chrome.storage.session.set({ [key]: msg.job }).then(() => reply({ ok: true })); return true; }
  if (msg.type === "clearJob") { chrome.storage.session.remove(key).then(() => reply({ ok: true })); return true; }
});
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove("job" + tabId).then(awake));

// Keep running when Edge is minimised or the screen is locked (5.2+):
//  - while any run is going, ask Windows to keep the screen and PC awake (no sleep, no screen-off lock);
//  - run tabs are never put to sleep / discarded by the browser;
//  - "sleep" messages: the run scripts wait here in short steps, because the browser slows timers in
//    hidden tabs to once a minute (each message also keeps this background awake).
async function awake() {
  if (!chrome.power) return;
  const all = await chrome.storage.session.get(null);
  const running = Object.keys(all).some(k => /^job\d+$/.test(k) && all[k]);
  if (running) chrome.power.requestKeepAwake("display"); else chrome.power.releaseKeepAwake();
}
listen((msg, sender, reply) => {
  if (!msg || msg.type !== "sleep") return;
  const ms = Math.max(0, Math.min(Number(msg.ms) || 0, 25000));
  setTimeout(() => reply({ slept: true }), ms);
  return true;
});
listen((msg, sender) => {
  if (!msg || !/^(start|saveJob|clearJob)$/.test(msg.type) || !sender.tab) return;
  if (msg.type !== "clearJob") { try { chrome.tabs.update(sender.tab.id, { autoDiscardable: false }); } catch (e) { /* older browser */ } }
  setTimeout(awake, 500);   // after the job is stored or removed
});
