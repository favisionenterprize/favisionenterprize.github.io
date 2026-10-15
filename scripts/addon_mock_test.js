#!/usr/bin/env node
// Add-on mock test: runs extension/marketplace.js and extension/profile.js (plus autopilot.js and
// engage.js, to check they leave these jobs alone) against LOCAL MOCK pages that copy the structure
// of Facebook's "Your listings", "Create item", Marketplace inbox / Messenger threads, and the
// Facebook Page / X profile screens. Nothing goes to the real sites: every request is answered here.
// The add-on's background (job per tab, photos, sleep) is replaced by a stub in this script, and
// time runs fast. The mock selectors are our best guess at the live pages, so passing here does
// NOT mean it works live; it checks the job logic (never publish without photos, no groups/boost,
// stop on warnings, PIN-locked chats skipped, results returned to the admin).
//
// Run:  node scripts/addon_mock_test.js        (needs Playwright, like admin_smoke.js)
const fs = require("fs");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) {
  ({ chromium } = require(path.join(require("child_process").execSync("npm root -g").toString().trim(), "playwright")));
}
const ROOT = path.resolve(__dirname, "..") + "/";
const code = f => fs.readFileSync(ROOT + "extension/" + f, "utf8");
const BACK = "https://favisionenterprize.github.io/admin/";
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

// ------------------------------------------------------------------ mock pages
const page = (body, script) => `<!doctype html><html><head><meta charset="utf-8"><title>Facebook</title></head><body>${body}<script>${script || ""}</script></body></html>`;
const SELLING = page(`<div role="main"><h1>Your listings</h1><div id="list"></div></div>`, `
  const seed = [{ id: "1001", t: "Student Desk Chair Set", price: 650, listed: "9/1", renew: "Renew listing" },
                { id: "1002", t: "Dinning Set with Chairs", price: 12000, listed: "9/2", renew: "Renew (3 days)" },
                { id: "1003", t: "Dinning Set with Chairs", price: 12600, listed: "9/3", renew: "Renew listing", status: "Sold" }];
  let L = JSON.parse(localStorage.getItem("mock-listings") || "null"); if (!L) { L = seed; localStorage.setItem("mock-listings", JSON.stringify(L)); }
  if (localStorage.getItem("mock-warn")) document.body.insertAdjacentHTML("beforeend", '<div role="dialog">You’re temporarily blocked from using this feature</div>');
  const list = document.getElementById("list");
  L.forEach(x => {
    const c = document.createElement("div"); c.className = "card";
    c.innerHTML = '<a href="/marketplace/item/' + x.id + '/"><span></span></a><div>GH₵' + x.price.toLocaleString() + '</div><div>' + (x.status || "Active") + '</div><div>Listed on ' + x.listed + '</div><div role="button" tabindex="0">⋯</div>';
    c.querySelector("span").textContent = x.t; c.lastChild.setAttribute("aria-label", "More options for " + x.t);
    c.lastChild.onclick = () => {
      const old = document.querySelector("[role=menu]"); if (old) { old.remove(); return; }
      const m = document.createElement("div"); m.setAttribute("role", "menu");
      m.innerHTML = '<div role="menuitem"></div><a role="menuitem" href="/marketplace/edit/?listing_id=' + x.id + '">Edit listing</a><div role="menuitem">Mark as sold</div>';
      m.firstChild.textContent = x.renew || "Renew listing";
      m.firstChild.onclick = () => { localStorage.setItem("mock-clicked-renew", "1"); };
      document.body.appendChild(m);
    };
    list.appendChild(c);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { const m = document.querySelector("[role=menu]"); if (m) m.remove(); } });`);
const CREATE = page(`<div role="main"><h1>Item for sale</h1>
  <div id="photos">Photos · 0 / 10</div><div id="prev"></div><input type="file" accept="image/*,image/heif,image/heic" multiple style="display:none">
  <label><span>Title</span><input type="text" id="title"></label>
  <label><span>Price</span><input type="text" id="price"></label>
  <label role="combobox" aria-label="Category" tabindex="0" id="cat"><span>Category</span></label>
  <label role="combobox" aria-label="Condition" tabindex="0" id="cond"><span>Condition</span></label>
  <label><span>Description</span><textarea id="desc"></textarea></label>
  <label><span>Location</span><input type="text" id="loc" value="Kumasi, Ghana"></label>
  <div id="step2" hidden><div><span>Boost listing after publish</span><div role="switch" aria-checked="true" id="boost"></div></div>
    <p>List in more places</p><div role="checkbox" aria-checked="true" id="g1">Accra Buy and Sell</div><div role="checkbox" aria-checked="false" id="g2">Ghana Market</div>
    <div role="button" id="publish">Publish</div></div>
  <div role="button" aria-disabled="true" id="next">Next</div></div>`, `
  const $ = s => document.querySelector(s);
  let photos = 0;
  $("input[type=file]").addEventListener("change", e => {
    if (localStorage.getItem("mock-nophotos")) return;          // simulates Facebook ignoring the files
    for (const f of e.target.files) { const i = document.createElement("img"); i.src = URL.createObjectURL(f); i.width = 80; i.height = 60; $("#prev").appendChild(i); photos++; }
    $("#photos").textContent = "Photos · " + photos + " / 10"; check();
  });
  $("#price").addEventListener("input", e => { const d = e.target.value.replace(/\\D/g, ""); e.target.value = d ? "GH₵" + d : ""; check(); });
  ["#title", "#desc"].forEach(s => $(s).addEventListener("input", check));
  function drop(trig, opts) {
    trig.onclick = () => {
      const lb = document.createElement("div"); lb.setAttribute("role", "listbox");
      opts.forEach(o => { const d = document.createElement("div"); d.setAttribute("role", "option"); d.textContent = o; d.onclick = () => { trig.innerHTML = "<div>" + trig.getAttribute("aria-label") + "</div><div>" + o + "</div>"; lb.remove(); check(); }; lb.appendChild(d); });
      document.body.appendChild(lb);
    };
  }
  drop($("#cat"), ["Tools", "Furniture", "Household", "Electronics & computers"]);
  drop($("#cond"), ["New", "Used - Like New", "Used - Good"]);
  $("#loc").addEventListener("input", () => { const old = document.querySelector("#locopts"); if (old) old.remove();
    const lb = document.createElement("div"); lb.id = "locopts"; lb.setAttribute("role", "listbox");
    lb.innerHTML = '<div role="option">Odorkor, Accra, Ghana</div><div role="option">Odorkor Junction</div>';
    lb.firstChild.onclick = () => { $("#loc").value = "Odorkor, Accra, Ghana"; lb.remove(); };
    document.body.appendChild(lb); });
  function check() {
    const ok = photos && $("#title").value && $("#price").value && /\\n/.test($("#cat").innerText) && /\\n/.test($("#cond").innerText);
    $("#next").setAttribute("aria-disabled", ok ? "false" : "true");
  }
  $("#next").onclick = () => { if ($("#next").getAttribute("aria-disabled") === "true") return; $("#step2").hidden = false; $("#next").remove(); };
  ["#boost", "#g1", "#g2"].forEach(s => $(s).onclick = e => e.currentTarget.setAttribute("aria-checked", e.currentTarget.getAttribute("aria-checked") === "true" ? "false" : "true"));
  $("#publish").onclick = () => {
    const bad = $("#boost").getAttribute("aria-checked") === "true" || $("#g1").getAttribute("aria-checked") === "true" || !photos;
    if (bad) localStorage.setItem("mock-violation", "boost/groups/photos");
    const L = JSON.parse(localStorage.getItem("mock-listings") || "[]");
    L.push({ id: String(2000 + L.length), t: $("#title").value, price: +$("#price").value.replace(/\\D/g, ""), listed: "10/15", renew: "Renew (7 days)",
      cat: $("#cat").innerText.split("\\n").pop(), cond: $("#cond").innerText.split("\\n").pop(), loc: $("#loc").value, desc: $("#desc").value, photos });
    localStorage.setItem("mock-listings", JSON.stringify(L));
    location.href = "/marketplace/you/selling/";
  };`);
const INBOX = page(`<div role="main"><div role="tab" aria-selected="false" id="buy">Buying</div><div role="tab" aria-selected="true">Selling</div><div role="list">
  <a href="/messages/t/111/" aria-label="Unread conversation"><div>Ama Mensah · Student Desk Chair Set</div><div>Is this available?</div><div>2h</div></a>
  <a href="/messages/t/222/"><div>Kojo · Dinning Set with Chairs</div><div>How much last?</div><div>1d</div></a></div></div>`);
const THREAD = id => page(id === "222" ? `<div role="main"><p>Enter your PIN to restore your chat history</p></div>`
  : `<div role="main"><a href="/marketplace/item/1001/">Student Desk Chair Set</a><div role="grid">
     <div role="row"><div>Ama Mensah</div><div>Hello, is this still available? Do you deliver to Kasoa?</div></div>
     <div role="row"><div>You sent</div><div>Yes it is</div></div>
     <div role="row"><div>Ama Mensah</div><div>&lt;img src=x onerror=alert(1)&gt; ok how much for 60?</div></div></div></div>`);
const FB_PAGE = page(`<div role="main"><div id="intro"><h2>Intro</h2><a href="https://l.facebook.com/l.php?u=x">favisionenterprize.github.io</a><div role="button">Edit details</div></div>
  <div role="article"><div>Pinned post</div><div>Customer Service Week 2026: thank you to all our customers</div></div>
  <div role="article"><div>Fresh stock, just arrived! Student desk chair sets GH₵650</div><div role="button" aria-label="Actions for this post">⋯</div></div></div>`);
const X_PROFILE = page(`<div role="main"><div data-testid="UserUrl"></div><div id="tl"></div></div>`, `
  document.querySelector("[data-testid=UserUrl]").textContent = localStorage.getItem("x-url") || "example.com";
  const pinned = localStorage.getItem("x-pinned") || "old";
  const posts = [{ k: "old", t: "Old promo from last year, sofas on sale" }, { k: "desk", t: "Fresh stock, just arrived! Student desk chair sets" }];
  posts.sort((a, b) => (b.k === pinned) - (a.k === pinned)).forEach(p => {
    const a = document.createElement("article"); a.setAttribute("data-testid", "tweet");
    a.innerHTML = (p.k === pinned ? '<div data-testid="socialContext">Pinned</div>' : "") + '<div data-testid="tweetText"></div><div role="button" data-testid="caret">⋯</div>';
    a.querySelector("[data-testid=tweetText]").textContent = p.t;
    a.querySelector("[data-testid=caret]").onclick = () => {
      const pinned = localStorage.getItem("x-pinned") || "old";
      const m = document.createElement("div"); m.setAttribute("role", "menu"); m.innerHTML = '<div role="menuitem">' + (p.k === pinned ? "Unpin from profile" : "Pin to your profile") + '</div>';
      m.firstChild.onclick = () => { m.remove(); const d = document.createElement("div"); d.setAttribute("role", "dialog"); d.innerHTML = '<div role="button" data-testid="confirmationSheetConfirm">Pin</div>';
        d.firstChild.onclick = () => { localStorage.setItem("x-pinned", p.k === pinned ? "none" : p.k); d.remove(); }; document.body.appendChild(d); };
      document.body.appendChild(m);
    };
    document.getElementById("tl").appendChild(a);
  });`);
const X_EDIT = page(`<div role="main"><textarea name="description">Quality furniture in Accra (bio stays)</textarea><input name="url" value=""><div role="button" data-testid="Profile_Save_Button">Save</div></div>`, `
  const u = document.querySelector("input[name=url]"); u.value = localStorage.getItem("x-url") || "example.com";
  document.querySelector("[data-testid=Profile_Save_Button]").onclick = () => { localStorage.setItem("x-url", u.value); localStorage.setItem("x-bio", document.querySelector("textarea").value); };`);

// 60 posts. The list is an inner scroller (the window doesn't scroll): 20 rows at first, 20 more each time
// it's scrolled to the bottom. Some have no description or only hashtags; rows alternate role=row and
// plain divs so the row finder's fallbacks are used too.
const TT_SEED = (() => {
  const D = { "7400000000000000001": "Luxury leather sofa set now in stock at Odorkor", "7400000000000000002": "", "7400000000000000003": "#fyp #accra" };
  for (let k = 4; k <= 60; k++) D["74000000000000000" + String(k).padStart(2, "0")] = k % 7 === 0 ? "" : k % 11 === 0 ? "#furniture #ghana" : k % 5 === 0 ? "Executive director chair, leather high back, now at our Odorkor showroom with delivery…" : "Dining set with 6 chairs, glass top, delivered across Accra post " + k;
  return D;
})();
const TT_CONTENT = page(`<main style="height:100vh;overflow:hidden"><h1>Posts</h1><div id="rows" style="height:520px;overflow-y:auto"></div></main>`, `
  const D = JSON.parse(localStorage.getItem("tt-desc") || "null") || ${JSON.stringify(TT_SEED)};
  localStorage.setItem("tt-desc", JSON.stringify(D));
  const ids = Object.keys(D); let shown = 0;
  const add = id => { const k = ids.indexOf(id);
    const r = document.createElement("div"); if (k % 2 === 0) r.setAttribute("role", "row"); else r.className = "post-card";
    r.style.cssText = "height:90px;border-bottom:1px solid #ddd";
    r.innerHTML = '<img src="https://p16.tiktokcdn.com/' + id + '.jpg" alt="' + (k === 1 ? "student desk and chair in a classroom" : "") + '" width="40" height="60"><a href="/@favision/' + (k % 3 ? "photo" : "video") + '/' + id + '">open</a><div class="desc"></div><div>1.2K</div><div>Public</div><div role="button" aria-label="Edit" class="pencil">✎</div><div role="button" aria-label="More">…</div>';
    r.querySelector(".pencil").onclick = () => { location.href = "/tiktokstudio/content/" + id + "/edit"; };
    r.querySelector(".desc").textContent = D[id];
    r.querySelector("[aria-label=More]").onclick = () => { const m = document.createElement("div"); m.setAttribute("role", "menu");
      m.innerHTML = '<div role="menuitem">Edit</div><div role="menuitem">Delete</div>';
      m.firstChild.onclick = () => localStorage.setItem("tt-violation", "opened the ••• menu");
      m.lastChild.onclick = () => localStorage.setItem("tt-violation", "delete");
      document.body.appendChild(m); };
    document.getElementById("rows").appendChild(r); };
  const more = () => { ids.slice(shown, shown + 20).forEach(add); shown = Math.min(ids.length, shown + 20); };
  more();
  let busy = false;
  document.getElementById("rows").addEventListener("scroll", e => { const el = e.target;
    if (busy || shown >= ids.length || el.scrollTop + el.clientHeight < el.scrollHeight - 20) return;
    busy = true; setTimeout(() => { more(); busy = false; window.__loads = (window.__loads || 0) + 1; }, 20); });`);
// Edit page, opened by URL (/tiktokstudio/upload/post/photo|video?item_id=…, only the post's own kind has
// an editor; post …14's edit URL is broken, so the list's pencil → /tiktokstudio/content/<id>/edit is
// used) or by the pencil. Draft.js-like description: only a paste event updates its state; the title box
// and TikTok's standing "once a day" note are there too.
const TT_EDIT = id => page(`<main><p class="tip-note">Captions can only be edited once a day, within 7 days of posting.</p><input placeholder="Add a catchy title" value="">
  <div data-e2e="caption_container"><div class="public-DraftEditor-content" contenteditable="true" role="textbox"></div></div><div role="button" id="save">Save</div><div role="button">Post</div></main>`, `
  const D = JSON.parse(localStorage.getItem("tt-desc") || "{}");
  const ed = document.querySelector("[contenteditable]");
  let model = D[${JSON.stringify(id)}] || ""; ed.innerText = model;
  ed.addEventListener("paste", e => { e.preventDefault(); model = e.clipboardData.getData("text/plain"); ed.innerText = model; });
  ed.addEventListener("input", () => setTimeout(() => { ed.innerText = model; }, 50));
  document.querySelector("#save").onclick = () => { D[${JSON.stringify(id)}] = model; localStorage.setItem("tt-desc", JSON.stringify(D)); if (document.querySelector("input").value) localStorage.setItem("tt-violation", "title changed"); location.href = "/tiktokstudio/content"; };
  document.querySelectorAll("[role=button]")[1].onclick = () => localStorage.setItem("tt-violation", "repost");`);
const TT_NOEDIT = page(`<main><p>Something went wrong. This post isn't available.</p></main>`);

const CC = page(`<main><div class="region">Ghana</div><div role="checkbox" aria-checked="false" id="biz">Approved for business use</div><div id="list"></div></main>`, `
  const render = biz => { document.getElementById("list").innerHTML = (biz ? [["Afro Vibes Commercial", "CML Artist"], ["Highlife Groove", "CML Band"]] : [["Hit Song (not licensed)", "Star"]])
    .map((x, i) => '<div class="ItemCard_container"><div>' + (i + 1) + '</div><div>' + x[0] + '</div><div>' + x[1] + '</div><div>Details</div></div>').join(""); };
  render(false);
  document.getElementById("biz").onclick = e => { e.currentTarget.setAttribute("aria-checked", "true"); render(true); };`);
const IG_REELS = page(`<main>
  <a href="/reels/audio/1/">Original audio</a><a href="/reels/audio/2/"><span>Meta Artist · Reel Tune</span><svg aria-label="Trending"></svg></a>
  <a href="/reels/audio/3/">Other Artist · Second Tune</a><a href="/reels/audio/2/">Meta Artist · Reel Tune</a></main>`);
const FB_STORY = page(`<div role="main"><div role="button" id="ph">Create a photo story</div><input type="file" accept="image/*" style="display:none"><div id="ed" hidden><div role="button" id="addt">Add text</div><div role="button" id="share">Share to story</div></div></div>`, `
  document.querySelector("input[type=file]").addEventListener("change", () => { document.getElementById("ed").hidden = false; });
  document.getElementById("addt").onclick = () => { const t = document.createElement("textarea"); t.id = "txt"; document.getElementById("ed").appendChild(t); };
  document.getElementById("share").onclick = () => { localStorage.setItem("story", (document.getElementById("txt") || {}).value || ""); location.href = "/"; };`);
// The description box acts like live Draft.js (Oct 2026): what gets posted is the editor's own state,
// which a paste event updates; text put in the DOM another way is wiped on the next render. With
// localStorage "tt-blank" set, nothing gets in at all (the run must stop instead of posting blank).
// The 2nd post's Post reloads the tab into TikTok Studio → Posts (a real navigation), like live.
const TT_UPLOAD = page(`<main><div role="tab" aria-selected="true">Photos</div><input type="file" accept="image/jpeg,image/png,image/webp" style="display:none"><div id="form" hidden>
  <input placeholder="Add a catchy title"><div data-e2e="caption_container"><div class="public-DraftEditor-content" contenteditable="true"></div></div>
  <button id="snd">Sounds</button><span id="chip"></span><button id="post">Post</button></div></main>`, `
  let model = "";
  const ed = document.querySelector("[contenteditable]");
  ed.addEventListener("paste", e => { e.preventDefault(); if (localStorage.getItem("tt-blank")) return; model = e.clipboardData.getData("text/plain"); ed.innerText = model; });
  ed.addEventListener("input", () => setTimeout(() => { ed.innerText = model; }, 50));   // re-render from state
  document.querySelector("input[type=file]").addEventListener("change", () => { document.getElementById("form").hidden = false; });
  // Sound picker: "groove" → the trending sound; "Davido" → two songs; "Hillsong Worship" → none.
  // With localStorage "tt-nodialog" the Sounds button opens nothing, and every later click is logged.
  let afterSnd = false;
  document.addEventListener("click", e => { if (afterSnd && localStorage.getItem("tt-nodialog") && e.target.id !== "post") localStorage.setItem("tt-outside", (localStorage.getItem("tt-outside") || "") + (e.target.id || e.target.tagName) + ";"); }, true);
  document.getElementById("snd").onclick = () => { if (localStorage.getItem("tt-nodialog")) { setTimeout(() => { afterSnd = true; }, 0); return; }
    const d = document.createElement("div"); d.setAttribute("role", "dialog");
    d.innerHTML = '<input placeholder="Search sounds"><div id="res"></div><button>Close</button>';
    const row = (t, a) => '<div class="music-item"><div>' + t + '</div><div>' + a + '</div><button data-t="' + t + '">Use</button></div>';
    d.querySelector("input").addEventListener("input", e => { const v = e.target.value;
      d.querySelector("#res").innerHTML = /groove/i.test(v) ? row("Highlife Groove", "CML Band") : /davido/i.test(v) ? row("Fall", "Davido") + row("Feel", "Davido") : "";
      d.querySelectorAll(".music-item button").forEach(u => { u.onclick = () => { document.getElementById("chip").textContent = u.dataset.t; d.remove(); }; }); });
    d.lastChild.onclick = () => d.remove(); document.body.appendChild(d); };
  document.getElementById("post").onclick = () => { const all = JSON.parse(localStorage.getItem("tt-posts") || "[]"); const p = { sound: document.getElementById("chip").textContent, title: document.querySelector("input[placeholder]").value, text: model };
    all.push(p); localStorage.setItem("tt-posts", JSON.stringify(all)); localStorage.setItem("tt-post", JSON.stringify(p));
    if (all.length === 2) { location.href = "/tiktokstudio/content"; return; }
    history.pushState(null, "", "/tiktokstudio/content"); document.body.insertAdjacentHTML("beforeend", "<p>Manage your posts</p>"); };`);

function serve(url) {
  const u = new URL(url);
  if (u.hostname === "favisionenterprize.github.io") return page("<p>admin</p>");
  if (u.hostname === "ads.tiktok.com") return CC;
  if (u.hostname === "www.instagram.com") return IG_REELS;
  if (u.hostname === "www.tiktok.com" && u.pathname.startsWith("/tiktokstudio/upload/post/")) {
    const id = u.searchParams.get("item_id") || "", k = Object.keys(TT_SEED).indexOf(id), kind = k % 3 ? "photo" : "video";
    return k >= 0 && !id.endsWith("14") && u.pathname.endsWith("/" + kind) ? TT_EDIT(id) : TT_NOEDIT;
  }
  if (u.hostname === "www.tiktok.com" && u.pathname.startsWith("/tiktokstudio/upload")) return TT_UPLOAD;
  if (u.hostname === "www.tiktok.com") { const e = u.pathname.match(/\/tiktokstudio\/content\/(\d+)\/edit/); return e ? TT_EDIT(e[1]) : TT_CONTENT; }
  if (u.hostname === "x.com") return u.pathname.startsWith("/settings/profile") ? X_EDIT : X_PROFILE;
  const p = u.pathname;
  if (p.startsWith("/marketplace/you/selling")) return SELLING;
  if (p.startsWith("/marketplace/create/item")) return CREATE;
  if (p.startsWith("/marketplace/inbox")) return INBOX;
  const t = p.match(/^\/messages\/t\/(\d+)/); if (t) return THREAD(t[1]);
  if (p.startsWith("/FaVisionEnterprise")) return FB_PAGE;
  if (p.startsWith("/stories/create")) return FB_STORY;
  return page("<div role=main>facebook home</div>");
}

// ------------------------------------------------------------------ one job run
async function run(browser, job, startUrl, setup) {
  const ctx = await browser.newContext();
  let stored = { ...job, id: "t" + Date.now(), back: BACK };
  const images = [];
  await ctx.exposeBinding("__bg", (src, msg) => {
    if (msg.type === "getJob") return { job: stored };
    if (msg.type === "saveJob") { stored = msg.job; return { ok: true }; }
    if (msg.type === "clearJob") { stored = null; return { ok: true }; }
    if (msg.type === "sleep") return new Promise(r => setTimeout(() => r({ slept: true }), 2));
    if (msg.type === "image") { images.push(msg.url); return /missing/.test(msg.url) ? { error: "HTTP 404" } : { dataUrl: JPG }; }
    return {};
  });
  await ctx.route(/^https:\/\/(www\.facebook\.com|x\.com|www\.tiktok\.com|ads\.tiktok\.com|www\.instagram\.com|favisionenterprize\.github\.io)\//, r => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: serve(r.request().url()) }));
  const scripts = { fb: ["autopilot.js", "engage.js", "marketplace.js", "profile.js", "boost.js"], cc: ["boost.js"], ig: ["instagram.js", "engage.js", "profile.js", "boost.js"], x: ["engage.js", "profile.js", "social.js"], tt: ["engage.js", "profile.js", "social.js", "ttcaptions.js"] };
  const wrap = (host, files) => `if (location.hostname === ${JSON.stringify(host)} && !/^\\/(setup|state)$/.test(location.pathname)) {
    window.chrome = window.chrome || {}; chrome.runtime = { lastError: null, sendMessage: (m, cb) => { window.__bg(m).then(r => cb && cb(r)); } };
    document.addEventListener("DOMContentLoaded", () => setTimeout(() => { ${files.map(f => `try { ${code(f)} } catch (e) { console.error(e); }`).join("\n")} }, 0));
  }`;
  await ctx.addInitScript(wrap("www.facebook.com", scripts.fb));
  await ctx.addInitScript(wrap("x.com", scripts.x));
  await ctx.addInitScript(wrap("www.tiktok.com", scripts.tt));
  await ctx.addInitScript(wrap("ads.tiktok.com", scripts.cc));
  await ctx.addInitScript(wrap("www.instagram.com", scripts.ig));
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", e => errors.push(e.message));
  if (setup) { await pg.goto(startUrl.replace(/(https:\/\/[^/]+).*/, "$1/setup")); await pg.evaluate(setup); }
  await pg.goto(startUrl);
  pg.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  try { await pg.waitForURL(u => String(u).startsWith(BACK + "#favauto-done="), { timeout: 300000 }); }
  catch (e) {
    const msg = await pg.evaluate(() => (document.getElementById("favautomsg") || {}).textContent || "").catch(() => "");
    throw new Error(`${job.kind} didn't return to the admin. Last status: "${msg}" at ${pg.url()} · res ${JSON.stringify(stored && {i: stored.i, stage: stored.stage, hops: stored.hops, res: stored.res})} · ${errors.join("; ")}`);
  }
  const out = JSON.parse(decodeURIComponent(pg.url().split("#favauto-done=")[1]));
  // read the mock state on the site the job ended on
  const host = startUrl.replace(/(https:\/\/[^/]+).*/, "$1");
  await pg.goto(host + "/state");
  const state = await pg.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  await ctx.close();
  return { out, state, errors, images };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const problems = [];
  const want = (c, msg) => { if (!c) problems.push(msg); else console.log("  ✓ " + msg.replace(/:.*$/, "")); };
  const item = (p, title, price, imgs) => ({ p, title, price, cats: ["Furniture", "Household"], cond: "New", loc: "Odorkor",
    text: `${title} in stock. WhatsApp 0572646176\n\nOrder or see more: https://favisionenterprize.github.io/p/${p}.html`, imgs });
  const S = "https://favisionenterprize.github.io/assets/images/";

  console.log("mkscan (Your listings, renew menus)");
  let r = await run(browser, { kind: "mkscan", menus: true }, "https://www.facebook.com/marketplace/you/selling");
  want(r.out.kind === "mkscan" && r.out.res.length === 3, "reads all 3 listings: " + JSON.stringify(r.out).slice(0, 300));
  want(r.out.res[0].id === "1001" && r.out.res[0].price === 650 && r.out.res[0].renew === "ready" && r.out.res[0].listed, "listing 1: id, price, listed date, renew ready: " + JSON.stringify(r.out.res[0]));
  want(r.out.res[1].renew === "wait" && r.out.res[1].next && r.out.res[1].price === 12000, "listing 2: renew in 3 days: " + JSON.stringify(r.out.res[1]));
  want(r.out.res[2].status === "Sold" && !r.out.res[2].renew, "sold listing: status read, menu not opened: " + JSON.stringify(r.out.res[2]));
  want(!r.state["mock-clicked-renew"], "scan never clicks Renew");
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("mkscan with a Facebook warning on screen");
  r = await run(browser, { kind: "mkscan", menus: true }, "https://www.facebook.com/marketplace/you/selling", () => localStorage.setItem("mock-warn", "1"));
  want(/temporarily blocked/i.test(r.out.stopped || ""), "stops at once on a warning: " + r.out.stopped);

  console.log("mklist (3 products: ok, photos can't be fetched, ok)");
  r = await run(browser, { kind: "mklist", min: 2, max: 3, q: [item("FAV-014", "Student Desk Chair Set — Senior High", 650, [S + "a.jpg", S + "b.jpg"]), item("FAV-099", "Broken photo product", 100, [S + "missing.jpg"]), item("FAV-027", "3D Wallpaper per roll", 650, [S + "c.jpg"])] }, "https://www.facebook.com/marketplace/create/item");
  const L = JSON.parse(r.state["mock-listings"] || "[]").filter(x => +x.id >= 2000);
  want(r.out.res.length === 3 && r.out.res[0].ok && !r.out.res[1].ok && r.out.res[2].ok, "results ok / not published / ok: " + JSON.stringify(r.out.res.map(x => [x.p, x.ok, x.why, x.id])));
  want(/photos/.test(r.out.res[1].why), "the photo failure says why: " + r.out.res[1].why);
  want(L.length === 2 && L.every(x => x.photos > 0), "only the 2 with photos were published: " + L.length);
  want(!r.state["mock-violation"], "groups unticked and Boost off before Publish: " + r.state["mock-violation"]);
  want(L[0] && L[0].cat === "Furniture" && L[0].cond === "New" && /Odorkor/.test(L[0].loc) && L[0].price === 650 && /Order or see more: https:\/\/favisionenterprize\.github\.io\/p\/FAV-014\.html$/.test(L[0].desc) && L[0].photos === 2, "listing filled: title, price, Furniture, New, Odorkor, description, 2 photos: " + JSON.stringify(L[0]).slice(0, 300));
  want(r.out.res[0].verified && /^20\d\d$/.test(r.out.res[0].id), "checked on Your listings and got its item id: " + JSON.stringify(r.out.res[0]));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("mklist when Facebook doesn't take the photos");
  r = await run(browser, { kind: "mklist", q: [item("FAV-014", "Student Desk Chair Set", 650, [S + "a.jpg"])] }, "https://www.facebook.com/marketplace/create/item", () => localStorage.setItem("mock-nophotos", "1"));
  want(!r.out.res[0].ok && /didn't attach/.test(r.out.res[0].why) && !JSON.parse(r.state["mock-listings"] || "[]").some(x => +x.id >= 2000), "never publishes without photos: " + JSON.stringify(r.out.res[0]));

  console.log("mklist test mode");
  r = await run(browser, { kind: "mklist", dry: true, q: [item("FAV-014", "Student Desk Chair Set", 650, [S + "a.jpg"])] }, "https://www.facebook.com/marketplace/create/item");
  want(r.out.res[0].ok && r.out.res[0].dry && !JSON.parse(r.state["mock-listings"] || "[]").some(x => +x.id >= 2000), "test fills everything but doesn't publish: " + JSON.stringify(r.out.res[0]));

  console.log("mkinbox (read only)");
  r = await run(browser, { kind: "mkinbox", max: 20 }, "https://www.facebook.com/marketplace/inbox/");
  const th = r.out.threads || [];
  want(th.length === 2 && th[0].name === "Ama Mensah" && /Student Desk/.test(th[0].listing) && th[0].unread, "lists both threads with name and listing: " + JSON.stringify(th.map(t => [t.name, t.listing, t.unread])));
  want(th[0].msgs.length === 3 && !th[0].msgs[0].me && th[0].msgs[1].me && /Kasoa/.test(th[0].msgs[0].text), "reads the messages, ours marked as ours: " + JSON.stringify(th[0].msgs));
  want(th[1].locked && r.out.locked === 1 && !th[1].msgs.length, "PIN-locked chat only counted");
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("profile check (Facebook Page)");
  r = await run(browser, { kind: "profile", net: "fb", mode: "check", link: "https://favisionenterprize.github.io/", pin: "Fresh stock, just arrived" }, "https://www.facebook.com/");
  want(r.out.res[0].linkOk && !r.out.res[0].pinOk && /Customer Service Week/.test(r.out.res[0].pinned), "reads link ✓ and the other pinned post: " + JSON.stringify(r.out.res[0]));

  console.log("profile fix (X)");
  r = await run(browser, { kind: "profile", net: "x", mode: "fix", handle: "FaVisionEnt", link: "https://favisionenterprize.github.io/", pin: "Fresh stock, just arrived" }, "https://x.com/");
  want(r.out.res[0].linkOk && r.out.res[0].pinOk, "sets the link and pins the post: " + JSON.stringify(r.out.res[0]));
  want(r.state["x-bio"] === "Quality furniture in Accra (bio stays)", "bio text kept: " + r.state["x-bio"]);
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("ttscan (TikTok Studio posts)");
  r = await run(browser, { kind: "ttscan" }, "https://www.tiktok.com/tiktokstudio/content");
  const posts = r.out.res || [];
  const empties = Object.values(TT_SEED).filter(t => t.replace(/#\w+/g, "").trim().length < 15).length;
  want(posts.length === 60 && new Set(posts.map(p => p.id)).size === 60, "reads all 60 posts (20 at first, 20 more per scroll of the inner list): got " + posts.length);
  want(posts.filter(p => p.desc.replace(/#\w+/g, "").trim().length < 15).length === empties, "finds every post without a real description (" + empties + "): " + posts.filter(p => p.desc.replace(/#\w+/g, "").trim().length < 15).map(p => p.id.slice(-2)).join());
  want(posts.length && posts[1].id === "7400000000000000002" && posts[1].desc === "" && /student desk/.test(posts[1].alt) && /^https:/.test(posts[1].thumb) && /Luxury/.test(posts[0].desc), "reads all posts with id, description, thumbnail and alt: " + JSON.stringify(posts).slice(0, 400));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("ttfix (5 posts: by edit URL, one that has a description now, one far down, a video, a broken edit URL → pencil)");
  const cap = "The desk that ends homework fights.\nGH₵650 · Delivered across Accra, Tema & Kasoa.\nComment 'MINE' 👇";
  r = await run(browser, { kind: "ttfix", min: 1, max: 2, q: [
    { id: "7400000000000000002", url: "https://www.tiktok.com/@favision/photo/7400000000000000002", text: cap },
    { id: "7400000000000000001", url: "https://www.tiktok.com/@favision/video/7400000000000000001", text: "should not be used" },
    { id: "7400000000000000056", url: "https://www.tiktok.com/@favision/photo/7400000000000000056", text: "Furniture that makes a statement ✨\nShop the collection at favisionenterprize.github.io/tiktok/ · Comment 'MINE' 👇" },
    { id: "7400000000000000007", url: "", text: "Video post caption\nsecond line" },
    { id: "7400000000000000014", url: "https://www.tiktok.com/@favision/photo/7400000000000000014", text: "Pencil fallback caption" }] }, "https://www.tiktok.com/tiktokstudio/content");
  const D = JSON.parse(r.state["tt-desc"] || "{}");
  const rs = r.out.res || [];
  want(rs.length === 5 && rs[0].ok && !rs[1].ok && /already has/.test(rs[1].why) && rs[2].ok && rs[3].ok && rs[4].ok && r.out.n === 5, "adds the caption to every empty post (edit URL, other kind, pencil fallback), leaves the one with text: " + JSON.stringify(rs));
  want(D["7400000000000000002"] === cap && /Luxury/.test(D["7400000000000000001"]) && /makes a statement/.test(D["7400000000000000056"]) && D["7400000000000000007"] === "Video post caption\nsecond line" && D["7400000000000000014"] === "Pencil fallback caption", "TikTok mock saved the pasted captions (line breaks kept), the old one untouched: " + JSON.stringify([D["7400000000000000002"], D["7400000000000000007"], D["7400000000000000014"]]));
  want(!r.state["tt-violation"], "never opens ••• (Delete), never Posts, leaves the title alone: " + r.state["tt-violation"]);
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("sounds (Creative Center business songs + Instagram Reels audio)");
  r = await run(browser, { kind: "sounds", stage: "cc", cc: true }, "https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en?countryCode=GH&period=7");
  const tt = r.out.res.filter(x => x.platform === "tiktok"), ig = r.out.res.filter(x => x.platform === "ig");
  want(tt.length === 2 && tt[0].name === "Afro Vibes Commercial" && tt[0].artist === "CML Artist" && tt.every(x => x.commercial) && !r.out.res.some(x => /not licensed/.test(x.name)), "TikTok: switches on 'Approved for business use' and reads the list: " + JSON.stringify(tt));
  want(ig.length === 2 && ig[0].name === "Reel Tune" && ig[0].trending && !ig.some(x => /original audio/i.test(x.name)), "Instagram: trending audio first, no 'Original audio': " + JSON.stringify(ig));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("story (Facebook photo story with the product link)");
  r = await run(browser, { kind: "story", img: S + "a.jpg", text: "Student Desk · GH₵650\nfavisionenterprize.github.io/p/FAV-014.html" }, "https://www.facebook.com/stories/create");
  want(r.out.res[0] && r.out.res[0].ok && /FAV-014\.html/.test(r.state.story || ""), "shares the story with the link text: " + JSON.stringify(r.out));

  console.log("tiktok post with a trending sound (social.js)");
  r = await run(browser, { kind: "tiktok", q: [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", text: "The desk that ends homework fights.\nGH₵650", title: "Student desk", sound: { name: "Highlife Groove", artist: "CML Band" } }, { k: "card:FAV-016", p: "FAV-016", img: S + "b.jpg", text: "Quiet luxury.\nGH₵8,500", title: "Sofa", sound: { name: "Unknown Tune" } }], min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo");
  want(r.out.res.length === 2 && r.out.res[0].ok && r.out.res[0].sound === "Highlife Groove" && r.out.res[1].ok && !r.out.res[1].sound && /no sound/.test(r.out.res[1].why), "picks the sound in TikTok's picker; posts without one when it isn't found: " + JSON.stringify(r.out.res));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));
  const posted = JSON.parse(r.state["tt-posts"] || "[]");
  want(posted.length === 2 && posted[0].text === "The desk that ends homework fights.\nGH₵650" && posted[1].text === "Quiet luxury.\nGH₵8,500", "the DESCRIPTION is posted (Draft.js state, line breaks kept), not just the title: " + JSON.stringify(posted));
  want(r.out.res[1].ok && /posted/.test(r.out.res[1].why), "a Post that reloads the tab into Posts counts as posted: " + JSON.stringify(r.out.res[1]));

  console.log("tiktok favourite artists (social.js): Davido found (skips a track used lately), Hillsong Worship not → trending; no dialog → no sound");
  r = await run(browser, { kind: "tiktok", q: [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", text: "The desk that ends homework fights.\nGH₵650", title: "Student desk", sound: { name: "Highlife Groove", artist: "CML Band", fav: "Davido", avoid: ["Fall"] } }, { k: "card:FAV-016", p: "FAV-016", img: S + "b.jpg", text: "Quiet luxury.\nGH₵8,500", title: "Sofa", sound: { name: "Highlife Groove", fav: "Hillsong Worship" } }], min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo");
  const fr = r.out.res;
  want(fr.length === 2 && fr[0].ok && fr[0].sound === "Feel" && fr[0].fav === "Davido" && fr[0].fav_found, "Davido found in the picker, a track not used lately: " + JSON.stringify(fr[0]));
  want(fr[1] && fr[1].ok && fr[1].sound === "Highlife Groove" && fr[1].fav === "Hillsong Worship" && !fr[1].fav_found && fr[1].fav_tried && /artist not available in picker: Hillsong Worship/.test(fr[1].why), "Hillsong Worship not in the picker → trending sound, logged: " + JSON.stringify(fr[1]));
  want(JSON.parse(r.state["tt-posts"] || "[]").map(p => p.sound).join() === "Feel,Highlife Groove", "TikTok got the picked sounds: " + r.state["tt-posts"]);
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));
  r = await run(browser, { kind: "tiktok", q: [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", text: "The desk that ends homework fights.\nGH₵650", title: "Student desk", sound: { name: "Highlife Groove", fav: "Davido" } }], min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo", () => localStorage.setItem("tt-nodialog", "1"));
  const nd = r.out.res[0] || {};
  want(nd.ok && !nd.sound && !nd.fav_tried && /no sound picker dialog/.test(nd.why) && JSON.parse(r.state["tt-posts"] || "[]")[0].sound === "", "no picker dialog → posts with no sound: " + JSON.stringify(nd));
  want(!r.state["tt-outside"], "nothing outside the picker clicked: " + r.state["tt-outside"]);

  console.log("tiktok post when the description box stays empty (social.js)");
  r = await run(browser, { kind: "tiktok", q: [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", text: "The desk that ends homework fights.\nGH₵650", title: "Student desk" }, { k: "card:FAV-016", p: "FAV-016", img: S + "b.jpg", text: "Quiet luxury.", title: "Sofa" }], min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo", () => localStorage.setItem("tt-blank", "1"));
  want(!r.state["tt-posts"] && r.out.res.length === 1 && !r.out.res[0].ok && /empty/.test(r.out.stopped || ""), "never posts a blank description, stops the run: " + JSON.stringify(r.out).slice(0, 300));

  console.log("pinswap (X: pin the new post, unpin the old one)");
  r = await run(browser, { kind: "profile", net: "x", mode: "pinswap", handle: "FaVisionEnt", pin: "Fresh stock, just arrived! Student desk chair sets", unpin: "Old promo from last year" }, "https://x.com/");
  want(r.out.res[0].pinOk && r.state["x-pinned"] === "desk", "new post pinned (old one not deleted): " + JSON.stringify(r.out.res[0]) + " " + r.state["x-pinned"]);

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s):\n  ✗ ` + problems.join("\n  ✗ ") : "\nAll add-on mock checks passed.");
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
