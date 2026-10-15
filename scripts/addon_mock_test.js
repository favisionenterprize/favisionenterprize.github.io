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
      const m = document.createElement("div"); m.setAttribute("role", "menu"); m.innerHTML = '<div role="menuitem">Pin to your profile</div>';
      m.firstChild.onclick = () => { m.remove(); const d = document.createElement("div"); d.setAttribute("role", "dialog"); d.innerHTML = '<div role="button" data-testid="confirmationSheetConfirm">Pin</div>';
        d.firstChild.onclick = () => { localStorage.setItem("x-pinned", p.k); d.remove(); }; document.body.appendChild(d); };
      document.body.appendChild(m);
    };
    document.getElementById("tl").appendChild(a);
  });`);
const X_EDIT = page(`<div role="main"><textarea name="description">Quality furniture in Accra (bio stays)</textarea><input name="url" value=""><div role="button" data-testid="Profile_Save_Button">Save</div></div>`, `
  const u = document.querySelector("input[name=url]"); u.value = localStorage.getItem("x-url") || "example.com";
  document.querySelector("[data-testid=Profile_Save_Button]").onclick = () => { localStorage.setItem("x-url", u.value); localStorage.setItem("x-bio", document.querySelector("textarea").value); };`);

const TT_SEED = { "7400000000000000001": "Luxury leather sofa set now in stock at Odorkor", "7400000000000000002": "", "7400000000000000003": "#fyp #accra" };
const TT_CONTENT = page(`<main><h1>Posts</h1><div id="rows"></div></main>`, `
  const D = JSON.parse(localStorage.getItem("tt-desc") || "null") || ${JSON.stringify(TT_SEED)};
  localStorage.setItem("tt-desc", JSON.stringify(D));
  Object.keys(D).forEach((id, k) => {
    const r = document.createElement("div"); r.setAttribute("role", "row");
    r.innerHTML = '<img src="https://p16.tiktokcdn.com/' + id + '.jpg" alt="' + (k === 1 ? "student desk and chair in a classroom" : "") + '" width="40" height="60"><a href="/@favision/' + (k ? "photo" : "video") + '/' + id + '">open</a><div class="desc"></div><div>1.2K</div><div>Public</div><div role="button" aria-label="More">…</div>';
    r.querySelector(".desc").textContent = D[id];
    r.querySelector("[aria-label=More]").onclick = () => { const m = document.createElement("div"); m.setAttribute("role", "menu");
      m.innerHTML = '<div role="menuitem">Edit</div><div role="menuitem">Delete</div>';
      m.firstChild.onclick = () => { location.href = "/tiktokstudio/content/" + id + "/edit"; };
      m.lastChild.onclick = () => localStorage.setItem("tt-violation", "delete");
      document.body.appendChild(m); };
    document.getElementById("rows").appendChild(r);
  });`);
const TT_EDIT = id => page(`<main><div class="public-DraftEditor-content" contenteditable="true" role="textbox"></div><div role="button" id="save">Save</div><div role="button">Post</div></main>`, `
  const D = JSON.parse(localStorage.getItem("tt-desc") || "{}");
  document.querySelector("[contenteditable]").textContent = D[${JSON.stringify(id)}] || "";
  document.querySelector("#save").onclick = () => { D[${JSON.stringify(id)}] = document.querySelector("[contenteditable]").innerText; localStorage.setItem("tt-desc", JSON.stringify(D)); location.href = "/tiktokstudio/content"; };
  document.querySelectorAll("[role=button]")[1].onclick = () => localStorage.setItem("tt-violation", "repost");`);

function serve(url) {
  const u = new URL(url);
  if (u.hostname === "favisionenterprize.github.io") return page("<p>admin</p>");
  if (u.hostname === "www.tiktok.com") { const e = u.pathname.match(/\/tiktokstudio\/content\/(\d+)\/edit/); return e ? TT_EDIT(e[1]) : TT_CONTENT; }
  if (u.hostname === "x.com") return u.pathname.startsWith("/settings/profile") ? X_EDIT : X_PROFILE;
  const p = u.pathname;
  if (p.startsWith("/marketplace/you/selling")) return SELLING;
  if (p.startsWith("/marketplace/create/item")) return CREATE;
  if (p.startsWith("/marketplace/inbox")) return INBOX;
  const t = p.match(/^\/messages\/t\/(\d+)/); if (t) return THREAD(t[1]);
  if (p.startsWith("/FaVisionEnterprise")) return FB_PAGE;
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
  await ctx.route(/^https:\/\/(www\.facebook\.com|x\.com|www\.tiktok\.com|favisionenterprize\.github\.io)\//, r => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: serve(r.request().url()) }));
  const scripts = { fb: ["autopilot.js", "engage.js", "marketplace.js", "profile.js"], x: ["engage.js", "profile.js", "social.js"], tt: ["engage.js", "profile.js", "social.js", "ttcaptions.js"] };
  const wrap = (host, files) => `if (location.hostname === ${JSON.stringify(host)} && !/^\\/(setup|state)$/.test(location.pathname)) {
    window.chrome = window.chrome || {}; chrome.runtime = { lastError: null, sendMessage: (m, cb) => { window.__bg(m).then(r => cb && cb(r)); } };
    document.addEventListener("DOMContentLoaded", () => setTimeout(() => { ${files.map(f => `try { ${code(f)} } catch (e) { console.error(e); }`).join("\n")} }, 0));
  }`;
  await ctx.addInitScript(wrap("www.facebook.com", scripts.fb));
  await ctx.addInitScript(wrap("x.com", scripts.x));
  await ctx.addInitScript(wrap("www.tiktok.com", scripts.tt));
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", e => errors.push(e.message));
  if (setup) { await pg.goto(startUrl.replace(/(https:\/\/[^/]+).*/, "$1/setup")); await pg.evaluate(setup); }
  await pg.goto(startUrl);
  pg.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  try { await pg.waitForURL(u => String(u).startsWith(BACK + "#favauto-done="), { timeout: 150000 }); }
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
  want(posts.length === 3 && posts[1].id === "7400000000000000002" && posts[1].desc === "" && /student desk/.test(posts[1].alt) && /^https:/.test(posts[1].thumb) && /Luxury/.test(posts[0].desc), "reads all posts with id, description, thumbnail and alt: " + JSON.stringify(posts).slice(0, 400));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("ttfix (2 posts: one empty, one that has a description now)");
  r = await run(browser, { kind: "ttfix", min: 1, max: 2, q: [{ id: "7400000000000000002", text: "The desk that ends homework fights.\nGH₵650 · Delivered across Accra, Tema & Kasoa.\nComment 'MINE' 👇" }, { id: "7400000000000000001", text: "should not be used" }] }, "https://www.tiktok.com/tiktokstudio/content");
  const D = JSON.parse(r.state["tt-desc"] || "{}");
  want(r.out.res.length === 2 && r.out.res[0].ok && !r.out.res[1].ok && /already has/.test(r.out.res[1].why), "adds the caption to the empty post, leaves the other: " + JSON.stringify(r.out.res));
  want(/homework fights/.test(D["7400000000000000002"]) && /Luxury/.test(D["7400000000000000001"]), "TikTok mock shows the new caption saved, the old one untouched");
  want(!r.state["tt-violation"], "never clicks Delete or Post: " + r.state["tt-violation"]);
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s):\n  ✗ ` + problems.join("\n  ✗ ") : "\nAll add-on mock checks passed.");
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
