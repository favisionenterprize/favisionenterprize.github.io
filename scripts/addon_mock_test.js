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
//       FX_ONLY=1 node scripts/addon_mock_test.js   only the Fix all + quality gate checks (fast)
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
// Dialog injector (shared dialog handler tests): localStorage "dlg-plan" = [{at: "load"|"compose"|"post", html, once}].
// "load" = when the page opens, "compose" = when a composer/caption box appears, "post" = right after a Post/Share click.
// Clicks on dialog buttons are logged in "dlg-clicks"; a dialog's button with data-bad marks a violation.
const DLG = `(() => { const plan = JSON.parse(localStorage.getItem("dlg-plan") || "[]"); if (!plan.length) return;
  const used = JSON.parse(localStorage.getItem("dlg-used") || "[]");
  const show = at => plan.forEach((d, i) => { if (d.at !== at || used.includes(i)) return; used.push(i); localStorage.setItem("dlg-used", JSON.stringify(used));
    setTimeout(() => { const w = document.createElement("div"); w.setAttribute("role", d.role || "dialog"); w.innerHTML = d.html; w.dataset.mockDlg = i; document.body.appendChild(w);
      w.querySelectorAll("button,[role=button]").forEach(b => b.addEventListener("click", () => { const c = JSON.parse(localStorage.getItem("dlg-clicks") || "[]"); c.push(i + ":" + (b.innerText || b.getAttribute("aria-label") || "").trim()); localStorage.setItem("dlg-clicks", JSON.stringify(c)); if (b.dataset.bad) localStorage.setItem("dlg-violation", b.dataset.bad); if (!b.dataset.keep) w.remove(); })); }, d.delay || 50); });
  addEventListener("DOMContentLoaded", () => { show("load");
    let composeShown = false; new MutationObserver(() => { if (!composeShown && document.querySelector("[contenteditable=true],[data-testid=tweetTextarea_0]")) { composeShown = true; show("compose"); } }).observe(document.body, { childList: true, subtree: true, attributes: true });
    document.addEventListener("click", e => { const b = e.target.closest("button,[role=button]"); if (b && /^(post|share|tweet)$/i.test((b.innerText || "").trim()) && !b.closest("[data-mock-dlg]")) show("post"); }, true); });
})();`;
const page = (body, script) => `<!doctype html><html><head><meta charset="utf-8"><title>Facebook</title><script>${DLG}</script></head><body>${body}<script>${script || ""}</script></body></html>`;
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

// TikTok Studio → Posts as seen live (15 Oct 2026, read only): a VIRTUAL table. The scroller is
// [data-tt=components_PostTable_Container] (overflow-y: scroll), holding an inner container whose height
// is 100 px × rows loaded; only the ~8 rows in view exist, as [data-tt=components_PostTable_Absolute]
// elements that are REUSED as it scrolls. 20 rows load first, 10 more (after a short delay) when it nears
// the bottom. A row with a description links to /@user/video/<id>; a row without one shows the grey
// "No description" with NO link and no id anywhere in the DOM: the id is only in React's props
// (item.item_id), mocked here as a __reactFiber$ expando. Pencil = [data-icon=Pen] in an ActionCell.
// localStorage "tt-empty": the table shows no rows at all (the scan finds nothing).
const TT_SEED = (() => {
  const D = { "7400000000000000001": "Luxury leather sofa set now in stock at Odorkor", "7400000000000000002": "", "7400000000000000003": "#fyp #accra" };
  for (let k = 4; k <= 60; k++) D["74000000000000000" + String(k).padStart(2, "0")] = k % 7 === 0 ? "" : k % 11 === 0 ? "#furniture #ghana" : k % 5 === 0 ? "Executive director chair, leather high back, now at our Odorkor showroom with delivery…" : "Dining set with 6 chairs, glass top, delivered across Accra post " + k;
  return D;
})();
const TT_CONTENT = page(`<main style="height:100vh;overflow:hidden"><h1>Posts 60</h1><div data-tt="components_PostTable_FlexColumn">
  <div data-tt="components_PostTable_Container" id="sc" style="height:520px;overflow-y:scroll"><div data-tt="components_PostTable_Container" id="inner" style="position:relative"></div></div></div></main>`, `
  const D = JSON.parse(localStorage.getItem("tt-desc") || "null") || ${JSON.stringify(TT_SEED)};
  localStorage.setItem("tt-desc", JSON.stringify(D));
  const ids = localStorage.getItem("tt-empty") ? [] : Object.keys(D);
  const sc = document.getElementById("sc"), inner = document.getElementById("inner");
  let loaded = Math.min(20, ids.length), busy = false;
  const pool = [];
  const now = Math.floor(Date.now() / 1000);
  function fill(r, k) {
    const id = ids[k], d = D[id], kind = k % 3 ? "photo" : "video";
    r.style.cssText = "position:absolute;left:0;right:0;height:100px;top:" + (k * 100) + "px;border-bottom:1px solid #ddd;display:flex;gap:8px";
    r.innerHTML = '<div data-tt="components_RowLayout_FlexRow"><img alt="" width="40" height="60"><div data-tt="components_PostInfoCell_FlexColumn"><span data-tt="components_PostInfoCell_TUXText"></span><span class="date"></span></div></div>' +
      '<div><button data-tt="components_PrivacyCell_TUXButton">Everyone</button></div><div>0</div><div>0</div><div>0</div>' +
      '<div data-tt="components_ActionCell_FlexRow_7"><div data-tt="components_ActionCell_Container" class="pen"><span role="img" data-icon="Pen" data-testid="Pen">✎</span></div><div data-tt="components_ActionCell_Container"><span data-icon="ChartRise">📈</span></div><div data-tt="components_ActionCell_Container" class="more"><svg></svg>…</div></div>';
    r.querySelector("img").src = "https://p16-common-sign.tiktokcdn.com/" + id + ".webp";
    r.querySelector("img").alt = k === 1 ? "student desk and chair in a classroom" : "";
    const cell = r.querySelector("[data-tt=components_PostInfoCell_TUXText]");
    if (d) { const a = document.createElement("a"); a.setAttribute("data-tt", "components_PostInfoCell_a"); a.href = "/@favision/video/" + id; a.target = "_blank"; a.textContent = d; const c = document.createElement("div"); c.setAttribute("data-tt", "components_PostInfoCell_Container"); c.appendChild(a); cell.appendChild(c); }
    else { const c = document.createElement("div"); c.setAttribute("data-tt", "components_PostInfoCell_Container"); c.style.color = "grey"; c.textContent = "No description"; cell.appendChild(c); }
    r.querySelector(".date").textContent = "Oct 15, 6:" + String(10 + (k % 50)).padStart(2, "0") + " AM";
    const item = { item_id: id, desc: d, item_type: kind === "photo" ? 2 : 1, create_time: String(now - k * 600), permissions: { can_edit: { reason: "", show_type: 2 } } };
    r["__reactFiber$mock"] = { memoizedProps: { width: "100%" }, child: { memoizedProps: { children: [] }, child: null, sibling: { memoizedProps: { item }, child: null, sibling: null } }, sibling: null };
    r.querySelector(".pen").onclick = () => { location.href = "/tiktokstudio/content/" + id + "/edit"; };
    r.querySelector(".more").onclick = () => { const m = document.createElement("div"); m.setAttribute("role", "menu");
      m.innerHTML = '<div role="menuitem">Edit</div><div role="menuitem">Delete</div>';
      m.firstChild.onclick = () => localStorage.setItem("tt-violation", "opened the ••• menu");
      m.lastChild.onclick = () => localStorage.setItem("tt-violation", "delete");
      document.body.appendChild(m); };
  }
  function render() {
    inner.style.height = (loaded * 100) + "px";
    const first = Math.max(0, Math.floor(sc.scrollTop / 100) - 1), last = Math.min(loaded, first + 8);
    while (pool.length < last - first) { const r = document.createElement("div"); r.setAttribute("data-tt", "components_PostTable_Absolute"); r.setAttribute("height", "100px"); inner.appendChild(r); pool.push(r); }
    pool.forEach((r, i) => { const k = first + i; if (k < last) { r.hidden = false; if (r.__k !== k) { r.__k = k; fill(r, k); } } else r.hidden = true; });
  }
  render();
  sc.addEventListener("scroll", () => { render();
    if (busy || loaded >= ids.length || sc.scrollTop + sc.clientHeight < sc.scrollHeight - 200) return;
    busy = true; setTimeout(() => { loaded = Math.min(ids.length, loaded + 10); busy = false; window.__loads = (window.__loads || 0) + 1; render(); }, 300); });`);
// Edit page, opened by URL (/tiktokstudio/upload/post/photo|video?item_id=…, only the post's own kind has
// an editor; post …14's edit URL is broken, so the list's pencil → /tiktokstudio/content/<id>/edit is
// used) or by the pencil. Draft.js-like description: only a paste event updates its state; the title box
// and TikTok's standing "once a day" note are there too.
const TT_EDIT = id => page(`<main><p class="tip-note">Captions can only be edited once a day, within 7 days of posting.</p><input placeholder="Add a catchy title" value="">
  <div data-e2e="caption_container"><div class="public-DraftEditor-content" contenteditable="true" role="textbox"></div></div><div role="button" id="save">Save</div><div role="button">Post</div></main>`, `
  const D = JSON.parse(localStorage.getItem("tt-desc") || "{}");
  const ed = document.querySelector("[contenteditable]");
  let model = D[${JSON.stringify(id)}] || ""; ed.innerText = model;
  ed.addEventListener("paste", e => { e.preventDefault(); const t = e.clipboardData.getData("text/plain"); model = ed.innerText.trim() ? model + t : t; ed.innerText = model; });
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


// Instagram home with Create → file input → Next → Next → caption → Share (dialog-handler tests).
const IG_HOME = page(`<main><h2>favisionent</h2><header>12 posts 300 followers 10 following</header><a role="button" href="#">Edit profile</a><div role="button"><svg aria-label="New post"></svg>+</div></main>`, `
  document.querySelector("[role=button] svg[aria-label='New post']").parentElement.onclick = () => {
    const d = document.createElement("div"); d.setAttribute("role", "dialog"); d.id = "create";
    d.innerHTML = '<input type="file" accept="image/*">'; document.body.appendChild(d);
    d.querySelector("input").addEventListener("change", () => {
      d.innerHTML = '<div role="button" id="n1">Next</div>';
      d.querySelector("#n1").onclick = () => { d.innerHTML = '<div role="button" id="n2">Next</div>';
        d.querySelector("#n2").onclick = () => { d.innerHTML = '<div contenteditable="true" aria-label="Write a caption..." id="cap"></div><label><span>Share to Facebook</span><div role="switch" aria-checked="true" id="fbsw"></div></label><div role="button" id="share">Share</div>';
          const cap = d.querySelector("#cap"); let model = "";
          cap.addEventListener("paste", e => { e.preventDefault(); model = e.clipboardData.getData("text/plain"); cap.innerText = model; });
          d.querySelector("#fbsw").onclick = e => e.currentTarget.setAttribute("aria-checked", e.currentTarget.getAttribute("aria-checked") === "true" ? "false" : "true");
          d.querySelector("#share").onclick = () => { const all = JSON.parse(localStorage.getItem("ig-shared") || "[]"); all.push({ text: model, fb: d.querySelector("#fbsw").getAttribute("aria-checked") }); localStorage.setItem("ig-shared", JSON.stringify(all));
            setTimeout(() => { d.innerHTML = "<p>Your post has been shared.</p><div role='button' aria-label='Close'><svg aria-label='Close'></svg>x</div>"; }, 400); };
        };
      };
    });
  };`);
// X compose page: tweetTextarea_0 (contenteditable), fileInput, tweetButton.
const X_COMPOSE = page(`<div role="dialog" id="cmp"><div data-testid="tweetTextarea_0" contenteditable="true" role="textbox"></div><input type="file" data-testid="fileInput"><div data-testid="attachments"></div><div role="button" data-testid="tweetButton">Post</div></div>`, `
  const ed = document.querySelector("[data-testid=tweetTextarea_0]");
  document.querySelector("[data-testid=fileInput]").addEventListener("change", () => { document.querySelector("[data-testid=attachments]").innerHTML = "<img>"; });
  document.querySelector("[data-testid=tweetButton]").onclick = () => { const all = JSON.parse(localStorage.getItem("x-posts") || "[]"); all.push(ed.innerText); localStorage.setItem("x-posts", JSON.stringify(all)); setTimeout(() => { ed.remove(); }, 300); };`);

// ------------------------------------------------------------------ Fix all mocks (extension/fixall.js) + quality gate
// Facebook Page feed (?fxmock): top-level posts [role=article] with the caption in [data-ad-preview=message] (none =
// empty caption), a link to the post, a "shared a post" one, and a comment article nested inside a post.
const FB_FEED = page(`<div role="main"><h1>F.A Vision Enterprise</h1><div role="feed" id="feed"></div></div>`, `
  const P = JSON.parse(localStorage.getItem("fb-posts") || "null") || { "111": "", "112": "Luxury leather sofa set now in stock at our Odorkor showroom", "113": "Great sofa deals this week at Odorkor #AccraFurniture", "114": null };
  localStorage.setItem("fb-posts", JSON.stringify(P));
  for (const id of Object.keys(P)) {
    const a = document.createElement("div"); a.setAttribute("role", "article");
    a.innerHTML = (P[id] === null ? '<div>F.A Vision Enterprise shared a post</div>' : '<div>F.A Vision Enterprise</div>') + '<a href="/FaVisionEnterprise/posts/' + id + '?__cft__=x">Oct 1</a>' + (P[id] ? '<div data-ad-preview="message"></div>' : '') + '<div role="button" aria-label="Actions for this post">⋯</div>';
    if (P[id]) a.querySelector("[data-ad-preview]").textContent = P[id];
    if (id === "113") a.insertAdjacentHTML("beforeend", '<div role="article"><a href="/FaVisionEnterprise/posts/999">comment</a>Nice!</div>');
    document.getElementById("feed").appendChild(a);
  }`);
// One Page post (permalink): "Actions for this post" → menu (Save post / Edit post / Move to trash) → Edit post dialog
// (Draft-like: only a paste event changes the text; a paste at the end appends) → Save. "fb-blank": pastes are ignored.
const FB_POST = id => page(`<div role="main"><div role="article"><div>F.A Vision Enterprise</div><a href="/FaVisionEnterprise/posts/${id}">Oct 1</a><div data-ad-preview="message" id="msg"></div><div role="button" aria-label="Actions for this post" id="act">⋯</div></div></div>`, `
  const P = JSON.parse(localStorage.getItem("fb-posts") || "{}"), id = ${JSON.stringify(id)};
  document.getElementById("msg").textContent = P[id] || "";
  document.getElementById("act").onclick = () => {
    const m = document.createElement("div"); m.setAttribute("role", "menu");
    m.innerHTML = '<div role="menuitem">Save post</div><div role="menuitem">Edit post</div><div role="menuitem">Move to trash</div>';
    m.children[0].onclick = () => localStorage.setItem("fx-violation", "save post");
    m.children[2].onclick = () => localStorage.setItem("fx-violation", "trash");
    m.children[1].onclick = () => { m.remove();
      const d = document.createElement("div"); d.setAttribute("role", "dialog");
      d.innerHTML = '<h2>Edit post</h2><div contenteditable="true" role="textbox" id="ed"></div><div role="button" aria-label="Close">×</div><div role="button" id="save">Save</div>';
      document.body.appendChild(d);
      const ed = d.querySelector("#ed"); let model = P[id] || ""; ed.innerText = model;
      ed.addEventListener("paste", e => { e.preventDefault(); if (localStorage.getItem("fb-blank")) return; const t = e.clipboardData.getData("text/plain"); model = ed.innerText.trim() ? model + t : t; ed.innerText = model; });
      ed.addEventListener("input", () => setTimeout(() => { ed.innerText = model; }, 50));
      d.querySelector("[aria-label=Close]").onclick = () => d.remove();
      d.querySelector("#save").onclick = () => { P[id] = model; localStorage.setItem("fb-posts", JSON.stringify(P)); d.remove(); };
    };
    document.body.appendChild(m);
  };`);
// Instagram profile grid and post pages: caption in h1 (none = empty), "More options" → Delete / Edit / Cancel,
// Edit → caption box (contenteditable) + Done.
const IG_GRID = page(`<main><h2>favisionent</h2><div id="grid"><a href="/p/Cabc1/"><img alt="Photo by F.A Vision"></a><a href="/p/Cabc2/"><img alt=""></a><a href="/reel/Cabc3/"><img alt=""></a></div></main>`);
const IG_POST = code => page(`<main><article><h1 id="cap"></h1><div role="button"><svg aria-label="More options"></svg>…</div></article></main>`, `
  const P = JSON.parse(localStorage.getItem("ig-posts") || "null") || { Cabc1: "#fyp", Cabc2: "Red glass dining set, six chairs, in stock now", Cabc3: "" };
  localStorage.setItem("ig-posts", JSON.stringify(P));
  const code = ${JSON.stringify(code)};
  if (P[code]) document.getElementById("cap").textContent = P[code]; else document.getElementById("cap").remove();
  document.querySelector("[role=button]").onclick = () => {
    const m = document.createElement("div"); m.setAttribute("role", "dialog");
    m.innerHTML = '<button>Delete</button><button>Edit</button><button>Cancel</button>';
    m.children[0].onclick = () => localStorage.setItem("fx-violation", "delete");
    m.children[2].onclick = () => m.remove();
    m.children[1].onclick = () => { m.remove();
      const d = document.createElement("div"); d.setAttribute("role", "dialog");
      d.innerHTML = '<div role="button">Cancel</div><div contenteditable="true" aria-label="Write a caption..." id="ed"></div><div role="button" id="done">Done</div>';
      document.body.appendChild(d);
      const ed = d.querySelector("#ed"); let model = P[code] || ""; ed.innerText = model;
      ed.addEventListener("paste", e => { e.preventDefault(); const t = e.clipboardData.getData("text/plain"); model = ed.innerText.trim() ? model + t : t; ed.innerText = model; });
      ed.addEventListener("input", () => setTimeout(() => { ed.innerText = model; }, 50));
      d.children[0].onclick = () => d.remove();
      d.querySelector("#done").onclick = () => { P[code] = model; localStorage.setItem("ig-posts", JSON.stringify(P)); d.remove(); };
    };
    document.body.appendChild(m);
  };`);
// Marketplace "Edit listing" form: Title, Price, Description, Update, Delete listing.
const MK_EDIT = id => page(`<div role="main"><h1>Edit listing</h1><label><span>Title</span><input id="t" value="Listing ${id}"></label><label><span>Price</span><input id="pr" value="GH₵650"></label>
  <label><span>Description</span><textarea id="desc"></textarea></label><div role="button" id="del">Delete listing</div><div role="button" id="up">Update</div></div>`, `
  const D = JSON.parse(localStorage.getItem("mk-desc") || "null") || { "1001": "Desk", "1002": "Student desk and chair set with a steel frame, laminated top and delivery in Accra. Order or see more: https://favisionenterprize.github.io/p/FAV-014.html" };
  localStorage.setItem("mk-desc", JSON.stringify(D));
  const id = ${JSON.stringify(id)};
  document.getElementById("desc").value = D[id] || "";
  document.getElementById("del").onclick = () => localStorage.setItem("fx-violation", "delete listing");
  document.getElementById("up").onclick = () => { D[id] = document.getElementById("desc").value; localStorage.setItem("mk-desc", JSON.stringify(D)); localStorage.setItem("mk-title-" + id, document.getElementById("t").value); location.href = "/marketplace/you/selling/"; };`);
// A Facebook group (autopilot.js "post"): Draft-like post box; with "fb-wipe" the photo paste wipes the caption
// (the gate must put it back before Post).
// Facebook home with the profile switcher (Your profile → See all profiles → pick one → reload as that profile).
const FB_HOME = page(`<div role="main">facebook home</div><div role="button" aria-label="Your profile" id="me">AA</div>`, `
  const actor = localStorage.getItem("fb-actor") || "Alexander Awuku";
  document.getElementById("me").onclick = () => {
    const m = document.createElement("div"); m.setAttribute("role", "menu");
    m.innerHTML = '<div role="button">' + actor + '</div><div role="button" id="all">See all profiles</div>';
    document.body.appendChild(m);
    m.querySelector("#all").onclick = () => {
      const d = document.createElement("div"); d.setAttribute("role", "dialog");
      d.innerHTML = ["Alexander Awuku", "Fa Vision Furnitures", "F.A Vision Enterprise", "Oteng Furniture", "Agoodmann Ventures", "Manye Oye Rehoboth"].map(n => '<div role="radio" aria-checked="' + (n === actor) + '">' + n + '</div>').join("") + '<div role="button">Create new profile or Page</div>';
      document.body.appendChild(d);
      d.querySelectorAll("[role=radio]").forEach(r => r.onclick = () => { localStorage.setItem("fb-actor", r.innerText); location.reload(); });
    };
  };`);
const FB_GROUP = page(`<div role="main"><h1>Accra Buy and Sell</h1><div role="button" id="open">Write something...</div></div>`, `
  if (localStorage.getItem("fb-noaccess") && localStorage.getItem("fb-actor") !== "F.A Vision Enterprise") document.querySelector("[role=main]").innerHTML = "<h1>Accra Buy and Sell</h1><p>Only admins can post in this group.</p>";
  if (document.getElementById("open")) document.getElementById("open").onclick = () => {
    const d = document.createElement("div"); d.setAttribute("role", "dialog");
    d.innerHTML = '<div contenteditable="true" role="textbox" id="ed"></div><div id="att"></div><div role="button" id="post">Post</div>';
    document.body.appendChild(d);
    const ed = d.querySelector("#ed"); let model = "";
    ed.addEventListener("paste", e => { e.preventDefault(); const f = e.clipboardData.files; if (f && f.length) { if (localStorage.getItem("fb-wipe")) { model = ""; ed.innerText = ""; } return; } model = e.clipboardData.getData("text/plain"); ed.innerText = model; });
    ed.addEventListener("input", () => setTimeout(() => { ed.innerText = model; }, 50));
    d.querySelector("#post").onclick = () => { const all = JSON.parse(localStorage.getItem("group-posts") || "[]"); all.push(model); localStorage.setItem("group-posts", JSON.stringify(all)); const who = JSON.parse(localStorage.getItem("group-posters") || "[]"); who.push(localStorage.getItem("fb-actor") || "Alexander Awuku"); localStorage.setItem("group-posters", JSON.stringify(who)); d.remove(); };
  };`);

// Facebook group search (autopilot.js grow + Profile relay): result rows with "Join"; some groups ask membership
// questions in a dialog. mock-limit-<profile> → that profile gets "You can't join more groups right now".
const FB_SEARCH = page(`<div role="main" id="res"></div>`, `
  const actor = localStorage.getItem("fb-actor") || "Alexander Awuku";
  const G = [["101", "Accra Buy and Sell Market", "380K members", ""], ["102", "Ghana Furniture Deals", "1.2M members", "private"], ["103", "Home Decor Ideas Worldwide", "5.7M members", "private-bad"],
    ["104", "Kasoa Buy and Sell", "60K members", ""], ["105", "Accra Rentals and Rooms", "500K members", ""], ["106", "Interior Design Lovers", "2.1M members", "private-rules"], ["107", "Tiny Group", "900 members", ""], ["108", "Furniture For Sale Ghana", "120K members", ""]];
  const res = document.getElementById("res");
  G.forEach(([id, name, mem, kind]) => {
    const row = document.createElement("div"); row.className = "row";
    row.innerHTML = '<a href="/groups/' + id + '/">' + name + '</a><div>' + (kind ? "Private group · " : "Public group · ") + mem + '</div><div role="button">Join</div>';
    const btn = row.lastChild;
    btn.onclick = () => {
      if (localStorage.getItem("mock-limit-" + actor)) { const d = document.createElement("div"); d.setAttribute("role", "dialog"); d.innerHTML = "You can't join more groups right now<div role=button>OK</div>"; d.lastChild.onclick = () => d.remove(); document.body.appendChild(d); return; }
      const log = JSON.parse(localStorage.getItem("joins") || "[]");
      if (!kind) { btn.textContent = "Visit"; row.lastChild.insertAdjacentHTML("beforebegin", "<div>Joined</div>"); log.push(actor + ":" + id); localStorage.setItem("joins", JSON.stringify(log)); return; }
      const d = document.createElement("div"); d.setAttribute("role", "dialog");
      const qs = kind === "private-bad"
        ? '<div><span>Please answer: What is your MoMo number for the membership fee?</span><input type="text" aria-required="true"></div>'
        : kind === "private-rules" ? '<div role="checkbox" aria-checked="false">I agree to the group rules</div>'
        : '<div><span id="q1">Why do you want to join this group?</span><textarea aria-labelledby="q1"></textarea></div>' +
          '<div><span id="q2">Where are you from?</span><input type="text" aria-labelledby="q2"></div>' +
          '<div><span id="q3">What is your WhatsApp number?</span><input type="text" aria-labelledby="q3"></div>' +
          '<div role="radiogroup" aria-label="Are you a buyer or a seller?"><div role="radio" aria-checked="false">Buyer</div><div role="radio" aria-checked="false">Seller</div><div role="radio" aria-checked="false">Both</div></div>' +
          '<div role="radiogroup" aria-label="Will you follow the rules (no spam)?"><div role="radio" aria-checked="false">No</div><div role="radio" aria-checked="false">Yes</div></div>' +
          '<div role="checkbox" aria-checked="false">I agree to the group rules</div>';
      d.innerHTML = '<h2>Answer questions</h2><p>The admins want to know more about you.</p>' + qs + '<div role="button" id="cancel">Cancel</div><div role="button" id="submit">Submit</div><div role="button" id="pay">Pay now</div>';
      d.querySelectorAll("[role=radio]").forEach(r => r.onclick = () => { r.parentElement.querySelectorAll("[role=radio]").forEach(x => x.setAttribute("aria-checked", "false")); r.setAttribute("aria-checked", "true"); });
      d.querySelectorAll("[role=checkbox]").forEach(c => c.onclick = () => c.setAttribute("aria-checked", c.getAttribute("aria-checked") === "true" ? "false" : "true"));
      d.querySelector("#pay").onclick = () => localStorage.setItem("mock-violation", "pay");
      d.querySelector("#cancel").onclick = () => d.remove();
      d.querySelector("#submit").onclick = () => {
        const ans = [...d.querySelectorAll("textarea,input")].map(x => x.value);
        const all = JSON.parse(localStorage.getItem("answers") || "{}"); all[actor + ":" + id] = { ans, radios: [...d.querySelectorAll("[role=radio][aria-checked=true]")].map(x => x.innerText), boxes: [...d.querySelectorAll("[role=checkbox][aria-checked=true]")].length };
        localStorage.setItem("answers", JSON.stringify(all)); log.push(actor + ":" + id + ":req"); localStorage.setItem("joins", JSON.stringify(log));
        d.remove(); btn.textContent = "Cancel request";
      };
      document.body.appendChild(d);
    };
    res.appendChild(row);
  });`);
// Your groups (import): the groups this profile is in (mock: all of 101–108 joined by anyone, plus 201/202).
const FB_JOINS = page(`<div role="main" id="list"></div>`, `
  const actor = localStorage.getItem("fb-actor") || "Alexander Awuku";
  const mine = JSON.parse(localStorage.getItem("member-" + actor) || '["201","202"]');
  const l = document.getElementById("list");
  mine.forEach(id => { const a = document.createElement("a"); a.href = "/groups/" + id + "/"; a.textContent = "Group " + id + " (" + actor + ")"; l.appendChild(a); });`);

function serve(url) {
  const u = new URL(url);
  if (u.hostname === "favisionenterprize.github.io") return page("<p>admin</p>");
  if (u.hostname === "ads.tiktok.com") return CC;
  if (u.hostname === "www.instagram.com") { const m = u.pathname.match(/^\/(?:p|reel)\/([\w-]+)/); return m ? IG_POST(m[1]) : /^\/favisionent\/?$/.test(u.pathname) ? (IG_PROFILE_HOME ? IG_HOME : IG_GRID) : u.pathname === "/" ? IG_HOME : IG_REELS; }
  if (u.hostname === "www.tiktok.com" && u.pathname.startsWith("/tiktokstudio/upload/post/")) {
    const id = u.searchParams.get("item_id") || "", k = Object.keys(TT_SEED).indexOf(id), kind = k % 3 ? "photo" : "video";
    return k >= 0 && !id.endsWith("14") && u.pathname.endsWith("/" + kind) ? TT_EDIT(id) : TT_NOEDIT;
  }
  if (u.hostname === "www.tiktok.com" && u.pathname.startsWith("/tiktokstudio/upload")) return TT_UPLOAD;
  if (u.hostname === "www.tiktok.com") { const e = u.pathname.match(/\/tiktokstudio\/content\/(\d+)\/edit/); return e ? TT_EDIT(e[1]) : TT_CONTENT; }
  if (u.hostname === "x.com") return u.pathname.startsWith("/settings/profile") ? X_EDIT : u.pathname.startsWith("/compose/post") ? X_COMPOSE : X_PROFILE;
  const p = u.pathname;
  if (p.startsWith("/marketplace/you/selling")) return SELLING;
  if (p.startsWith("/marketplace/create/item")) return CREATE;
  if (p.startsWith("/marketplace/inbox")) return INBOX;
  const t = p.match(/^\/messages\/t\/(\d+)/); if (t) return THREAD(t[1]);
  const fp = p.match(/^\/FaVisionEnterprise\/posts\/(\w+)/); if (fp) return FB_POST(fp[1]);
  if (p.startsWith("/FaVisionEnterprise") && u.searchParams.has("fxmock")) return FB_FEED;
  if (p.startsWith("/FaVisionEnterprise")) return FB_PAGE;
  const me = p.startsWith("/marketplace/edit") && u.searchParams.get("listing_id"); if (me) return MK_EDIT(me);
  if (p.startsWith("/search/groups")) return FB_SEARCH;
  if (p.startsWith("/groups/joins")) return FB_JOINS;
  if (p.startsWith("/groups/")) return FB_GROUP;
  if (p.startsWith("/stories/create")) return FB_STORY;
  if (p === "/" || p === "") return FB_HOME;
  return page("<div role=main>facebook home</div>");
}

let IG_PROFILE_HOME = false;   // dialog tests: the profile page is the posting home (Edit profile + New post)
// ------------------------------------------------------------------ one job run
async function run(browser, job, startUrl, setup, skip) {
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
  const scripts = { fb: ["dialogs.js", "autopilot.js", "engage.js", "marketplace.js", "profile.js", "boost.js", "fixall.js"], cc: ["dialogs.js", "boost.js"], ig: ["dialogs.js", "instagram.js", "engage.js", "profile.js", "boost.js", "fixall.js"], x: ["dialogs.js", "engage.js", "profile.js", "social.js", "fixall.js"], tt: ["dialogs.js", "engage.js", "profile.js", "social.js", "ttcaptions.js", "ttids.js"].filter(f => !(skip || []).includes(f)) };
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
    text: `${title} in stock. WhatsApp 0572646176\n\nOrder or see more: https://favisionenterprize.github.io/p/${p}.html`, imgs, stamp: "fa-vision" });
  const S = "https://favisionenterprize.github.io/assets/images/";
  let r;

  // ================================================================ Fix all + quality gate (extension/fixall.js, autopilot.js, boost.js)
  if (!process.env.RELAY_ONLY && !process.env.DLG_ONLY) {
  console.log("fxscan (Facebook Page: posts, empty captions, shared post, comments ignored)");
  r = await run(browser, { kind: "fxscan", net: "fb", max: 100, page: "https://www.facebook.com/FaVisionEnterprise?fxmock=1" }, "https://www.facebook.com/FaVisionEnterprise?fxmock=1");
  const fbs = r.out.res || [];
  want(fbs.length === 4 && fbs.map(x => x.id).join() === "111,112,113,114" && !fbs.some(x => x.id === "999"), "reads the 4 posts, not the comment inside one: " + JSON.stringify(fbs.map(x => x.id)));
  want(fbs[0].text === "" && /Luxury/.test(fbs[1].text) && /#AccraFurniture/.test(fbs[2].text) && fbs[3].kind === "shared" && /\/FaVisionEnterprise\/posts\/111$/.test(fbs[0].url) && r.out.v, "empty caption read as empty, shared post marked, clean post links, script version: " + JSON.stringify(fbs).slice(0, 400));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("fxfix (Facebook Page: Edit post only; caption into an empty post, hashtags onto one with text, fine one left; batches)");
  const fbCap = "Quiet luxury for your living room.\nGH₵8,500 · WhatsApp 0572646176 to order.\n\n#AccraFurniture #FurnitureGhana";
  const fbQ = [{ id: "111", url: "https://www.facebook.com/FaVisionEnterprise/posts/111", text: fbCap, tags: "#AccraFurniture #FAVision", mode: "set" },
    { id: "112", url: "https://www.facebook.com/FaVisionEnterprise/posts/112", text: fbCap, tags: "#AccraFurniture #FAVision", mode: "tags" },
    { id: "113", url: "https://www.facebook.com/FaVisionEnterprise/posts/113", text: fbCap, tags: "#AccraFurniture", mode: "tags" }];
  const seedFb = () => localStorage.setItem("fb-posts", JSON.stringify({ "111": "", "112": "Luxury leather sofa set now in stock at our Odorkor showroom", "113": "Great sofa deals this week at Odorkor #AccraFurniture" }));
  r = await run(browser, { kind: "fxfix", net: "fb", min: 1, max: 2, q: fbQ, batch: 5, cont: ["fx:fix:fb"], then: ["report"] }, fbQ[0].url, seedFb);
  const FP = JSON.parse(r.state["fb-posts"] || "{}"), fr2 = r.out.res || [];
  want(fr2.length === 3 && fr2[0].ok && fr2[1].ok && !fr2[2].ok && fr2[2].skip && !r.out.more && (r.out.then || []).join() === "report", "2 fixed, the complete one skipped, then the rest of the run: " + JSON.stringify(fr2));
  want(FP["111"] === fbCap && FP["112"] === "Luxury leather sofa set now in stock at our Odorkor showroom\n\n#AccraFurniture #FAVision" && FP["113"] === "Great sofa deals this week at Odorkor #AccraFurniture", "Facebook saved the caption, the hashtags at the end (text kept), the fine one untouched: " + JSON.stringify(FP));
  want(!r.state["fx-violation"], "only “Edit post” is ever clicked (never Save post / Move to trash): " + r.state["fx-violation"]);
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));
  r = await run(browser, { kind: "fxfix", net: "fb", min: 1, max: 2, q: fbQ, batch: 2, cont: ["fx:fix:fb"], then: ["report"] }, fbQ[0].url, seedFb);
  want((r.out.res || []).length === 2 && r.out.more === 1 && (r.out.then || []).join() === "fx:fix:fb,report", "hands back after the batch so the admin saves the log: " + JSON.stringify([r.out.res && r.out.res.length, r.out.more, r.out.then]));
  r = await run(browser, { kind: "fxfix", net: "fb", min: 1, max: 2, q: fbQ.slice(0, 1) }, fbQ[0].url, () => { localStorage.setItem("fb-posts", JSON.stringify({ "111": "", "112": "Luxury leather sofa set now in stock at our Odorkor showroom" })); localStorage.setItem("fb-blank", "1"); });
  want(!r.out.res[0].ok && /nothing saved|blank/.test(r.out.res[0].why) && JSON.parse(r.state["fb-posts"] || "{}")["111"] === "", "never saves a blank caption: " + JSON.stringify(r.out.res));

  console.log("fxscan + fxfix (Instagram: captions from each post, Edit only)");
  r = await run(browser, { kind: "fxscan", net: "ig", account: "favisionent", max: 100 }, "https://www.instagram.com/favisionent/");
  const igs = r.out.res || [];
  want(igs.length === 3 && igs.find(x => x.id === "Cabc1").text === "#fyp" && /Red glass/.test(igs.find(x => x.id === "Cabc2").text) && igs.find(x => x.id === "Cabc3").text === "" && igs.find(x => x.id === "Cabc3").kind === "video", "reads every post's caption (none = empty, reels marked): " + JSON.stringify(igs));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));
  const igQ = [{ id: "Cabc1", url: "https://www.instagram.com/p/Cabc1/", text: "Bold colour, warm welcomes. Red Glass Dining Set GH₵12,600.\nLink in bio 🔗\n\n#AccraHomes #FAVision", tags: "#AccraHomes", mode: "set" },
    { id: "Cabc2", url: "https://www.instagram.com/p/Cabc2/", text: "x", tags: "#DiningGhana #FAVision", mode: "tags" }];
  r = await run(browser, { kind: "fxfix", net: "ig", min: 1, max: 2, q: igQ }, igQ[0].url);
  const IP = JSON.parse(r.state["ig-posts"] || "{}");
  want(r.out.res.every(x => x.ok) && IP.Cabc1 === igQ[0].text && IP.Cabc2 === "Red glass dining set, six chairs, in stock now\n\n#DiningGhana #FAVision" && !r.state["fx-violation"], "Instagram: caption set / hashtags added via Edit → Done, never Delete: " + JSON.stringify([r.out.res, IP, r.state["fx-violation"]]));

  console.log("mkedit (Marketplace: rewrite a short description, leave a full one, never delete)");
  const mkText = "Student desk and chair set, steel frame, laminated top.\nWhatsApp 0572646176 to order.\n\nOrder or see more: https://favisionenterprize.github.io/p/FAV-014.html";
  const mkQ = [{ id: "1001", p: "FAV-014", url: "https://www.facebook.com/marketplace/edit/?listing_id=1001", text: mkText }, { id: "1002", p: "FAV-014", url: "https://www.facebook.com/marketplace/edit/?listing_id=1002", text: mkText }];
  r = await run(browser, { kind: "mkedit", min: 1, max: 2, q: mkQ, min_len: 60 }, mkQ[0].url);
  const MD = JSON.parse(r.state["mk-desc"] || "{}");
  want(r.out.res.length === 2 && r.out.res[0].ok && r.out.res[1].skip && MD["1001"] === mkText && /steel frame, laminated top and delivery/.test(MD["1002"]) && r.state["mk-title-1001"] === "Listing 1001" && !r.state["fx-violation"], "short one rewritten (title untouched), full one left, never Delete listing: " + JSON.stringify([r.out.res, MD, r.state["fx-violation"]]));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("quality gate in a group post (autopilot.js): blank never posted; caption wiped by the photo is put back with its hashtags");
  const gq = [{ g: "1", name: "Accra Buy and Sell", url: "https://www.facebook.com/groups/1/", p: "FAV-014", text: "   #fyp  ", img: S + "a.jpg", stamp: "fa-vision" },
    { g: "2", name: "Ghana Market", url: "https://www.facebook.com/groups/2/", p: "FAV-014", text: "Student desk and chair set GH₵650. WhatsApp 0572646176 to order.\n\n#AccraFurniture #FurnitureGhana", img: S + "a.jpg", stamp: "fa-vision" }];
  r = await run(browser, { kind: "post", mode: "now", q: gq, min: 1, max: 2 }, gq[0].url, () => localStorage.setItem("fb-wipe", "1"));
  const GP = JSON.parse(r.state["group-posts"] || "[]");
  want(r.out.res.length === 2 && !r.out.res[0].ok && /blank description — not posted/.test(r.out.res[0].why) && r.out.res[1].ok, "blank caption skipped with the reason, the other posted: " + JSON.stringify(r.out.res));
  want(GP.length === 1 && GP[0] === gq[1].text, "what Facebook got is the full caption WITH its hashtags (re-pasted before Post): " + JSON.stringify(GP));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("no access to post (autopilot.js): switches to the chosen Page and posts there; stops when no profile is left");
  const swq = [{ g: "3", name: "Accra Buy and Sell", url: "https://www.facebook.com/groups/3/", p: "FAV-014", text: gq[1].text, img: S + "a.jpg", stamp: "fa-vision" }];
  r = await run(browser, { kind: "post", mode: "now", q: swq, min: 1, max: 2, sw_on: true, sw_profiles: ["F.A Vision Enterprise"], sw_max: 3 }, swq[0].url, () => localStorage.setItem("fb-noaccess", "1"));
  const SP = JSON.parse(r.state["group-posts"] || "[]");
  want(r.out.res.length === 1 && r.out.res[0].ok && /posted as F\.A Vision Enterprise/.test(r.out.res[0].why) && SP.length === 1 && r.state["fb-actor"] === "F.A Vision Enterprise", "posted in the group after switching to the Page: " + JSON.stringify([r.out.res, r.state["fb-actor"]]));
  want((r.out.switched || []).length === 1 && r.out.switched[0].to === "F.A Vision Enterprise" && /only admins/i.test(r.out.switched[0].why), "the switch is reported with its reason: " + JSON.stringify(r.out.switched));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));
  r = await run(browser, { kind: "post", mode: "now", q: swq, min: 1, max: 2, sw_on: true, sw_profiles: ["Nobody Here"], sw_max: 3 }, swq[0].url, () => localStorage.setItem("fb-noaccess", "1"));
  want(r.out.res.length === 1 && !r.out.res[0].ok && /couldn't switch/.test(r.out.res[0].why) && /Nothing more was posted/.test(r.out.stopped || "") && !r.state["group-posts"], "no chosen profile left → that group fails with the reason and the run stops: " + JSON.stringify([r.out.res, r.out.stopped]));
  r = await run(browser, { kind: "post", mode: "now", q: swq, min: 1, max: 2, sw_on: false }, swq[0].url, () => localStorage.setItem("fb-noaccess", "1"));
  want(r.out.res.length === 1 && !r.out.res[0].ok && /No access to post: Only admins can post/i.test(r.out.res[0].why) && !r.state["fb-actor"], "switching off → the group is skipped with the reason, no profile change: " + JSON.stringify(r.out.res));

  console.log("brand posts (autopilot.js): F.A Vision posts as you, Oteng's post as the Oteng Furniture Page, then back to you");
  const otText = "Oteng Furniture: 3-seater sofa GH₵5,000, delivered across Accra. WhatsApp 024 000 0000 to order.\n\n#OtengFurniture #FurnitureGhana";
  const bq = [{ g: "4", name: "Accra Buy and Sell", url: "https://www.facebook.com/groups/4/", p: "FAV-014", text: gq[1].text, img: S + "a.jpg", stamp: "fa-vision" },
    { g: "5", name: "Ghana Market", url: "https://www.facebook.com/groups/5/", p: "FAV-001", text: otText, img: S + "a.jpg", as: "Oteng Furniture", brand: "oteng-furniture", stamp: "oteng-furniture" }];
  r = await run(browser, { kind: "post", mode: "now", q: bq, min: 1, max: 2, sw_on: true, sw_max: 3 }, bq[0].url);
  const BP = JSON.parse(r.state["group-posters"] || "[]");
  want(r.out.res.length === 2 && r.out.res.every(x => x.ok) && JSON.stringify(BP) === JSON.stringify(["Alexander Awuku", "Oteng Furniture"]), "each post went out as its own brand: " + JSON.stringify([r.out.res, BP]));
  want((r.state["fb-actor"] || "Alexander Awuku") === "Alexander Awuku" && (r.out.switched || []).filter(x => x.brand && x.to).length === 2, "switched to the brand Page and back to the main profile at the end: " + JSON.stringify([r.state["fb-actor"], r.out.switched]));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));
  const bq2 = [bq[0], Object.assign({}, bq[1], { as: "Nobody's Page" })];
  r = await run(browser, { kind: "post", mode: "now", q: bq2, min: 1, max: 2, sw_on: true, sw_max: 3 }, bq2[0].url);
  const BP2 = JSON.parse(r.state["group-posters"] || "[]");
  want(r.out.res.length === 2 && r.out.res[0].ok && !r.out.res[1].ok && /not posted/.test(r.out.res[1].why) && BP2.length === 1, "a brand Page that isn't there → that post is skipped, never posted under another name: " + JSON.stringify([r.out.res, BP2]));

  console.log("quality gate in a story (boost.js): no text → nothing shared");
  r = await run(browser, { kind: "story", img: S + "a.jpg", text: "  ", stamp: "fa-vision" }, "https://www.facebook.com/stories/create");
  want(r.out.res[0] && !r.out.res[0].ok && /blank description — not posted/.test(r.out.res[0].why) && !("story" in r.state), "a story without text is never shared: " + JSON.stringify(r.out));

  console.log("ttfix hashtags mode (TikTok: hashtags added at the end of a post that has text)");
  r = await run(browser, { kind: "ttfix", min: 1, max: 2, q: [{ id: "7400000000000000001", url: "https://www.tiktok.com/@favision/video/7400000000000000001", kind: "video", mode: "tags", tags: "#AccraFurniture #fyp", text: "#AccraFurniture #fyp" }, { id: "7400000000000000003", url: "", kind: "photo", mode: "tags", tags: "#AccraFurniture", text: "#AccraFurniture" }] }, "https://www.tiktok.com/tiktokstudio/content");
  const TD = JSON.parse(r.state["tt-desc"] || "{}");
  want(r.out.res[0].ok && r.out.res[0].mode === "tags" && TD["7400000000000000001"] === "Luxury leather sofa set now in stock at Odorkor\n\n#AccraFurniture #fyp", "hashtags appended, the text kept: " + JSON.stringify([r.out.res[0], TD["7400000000000000001"]]));
  want(!r.out.res[1].ok && /no description/.test(r.out.res[1].why) && TD["7400000000000000003"] === "#fyp #accra", "a post with only hashtags isn't touched in hashtags mode: " + JSON.stringify(r.out.res[1]));
  want(!r.state["tt-violation"], "never ••• / Post: " + r.state["tt-violation"]);
  }
  console.log("brand stamp gate (rule P1): a picture without the brand stamp is never posted (group post, story)");
  const nsq = [{ g: "7", name: "Accra Buy and Sell", url: "https://www.facebook.com/groups/7/", p: "FAV-014", text: "Student desk and chair set GH₵650. WhatsApp 0572646176 to order.\n\n#AccraFurniture #FurnitureGhana", img: S + "a.jpg" }, { g: "8", name: "Ghana Market", url: "https://www.facebook.com/groups/8/", p: "FAV-014", text: "Student desk and chair set GH₵650. WhatsApp 0572646176 to order.\n\n#AccraFurniture #FurnitureGhana", img: S + "a.jpg", stamp: "fa-vision" }];
  r = await run(browser, { kind: "post", mode: "now", q: nsq, min: 1, max: 2 }, nsq[0].url);
  const NS = JSON.parse(r.state["group-posts"] || "[]");
  want(r.out.res.length === 2 && !r.out.res[0].ok && /no brand stamp — not posted/.test(r.out.res[0].why) && r.out.res[1].ok && NS.length === 1, "unstamped picture skipped with the reason, the stamped one posted: " + JSON.stringify([r.out.res, NS.length]));
  r = await run(browser, { kind: "story", img: S + "a.jpg", text: "Student Desk · GH₵650\nfavisionenterprize.github.io/p/FAV-014.html" }, "https://www.facebook.com/stories/create");
  want(r.out.res[0] && !r.out.res[0].ok && /no brand stamp/.test(r.out.res[0].why) && !("story" in r.state), "a story picture without the stamp is never shared: " + JSON.stringify(r.out));

  if (!process.env.DLG_ONLY) {
  // membership answers as the admin sends them (admin/brands.js qa())
  const QA = { qa: { "Alexander Awuku": { name: "F.A Vision Enterprise", what: "quality furniture: sofas, beds, dining sets and student desks", place: "Odorkor, Accra, Ghana", wa: "057 264 6176", email: "favisionenterprise1@gmail.com" },
    "F.A Vision Enterprise": { name: "F.A Vision Enterprise", what: "quality furniture", place: "Odorkor, Accra, Ghana", wa: "057 264 6176" },
    "Agoodmann Ventures": { name: "AGOODMANN VENTURES", what: "TWYFORD water closets, tiles and bathroom fittings", place: "Kantamanto, Accra, Ghana", wa: "027 747 7752" } },
    qa_default: { name: "F.A Vision Enterprise", what: "quality furniture: sofas, beds, dining sets and student desks", place: "Odorkor, Accra, Ghana", wa: "057 264 6176", email: "favisionenterprise1@gmail.com" } };
  const SQ = kw => ({ kw, url: "https://www.facebook.com/search/groups/?q=" + encodeURIComponent(kw) });
  console.log("daily grow (autopilot.js): membership questions answered from the profile's brand, submitted; MoMo/fee question → needs a manual answer; rules box ticked");
  r = await run(browser, { kind: "grow", q: [SQ("furniture ghana")], skip: [], limit: 5, min: 10000, minGlobal: 100000, deny: "rent|rooms?\\b", pmin: 1, pmax: 1, ...QA }, SQ("x").url);
  const GJ = r.out.res, ans = JSON.parse(r.state.answers || "{}");
  const st = id => (GJ.find(x => x.g === id) || {}).status;
  want(st("103") === "manual" && /private, payment/.test((GJ.find(x => x.g === "103") || {}).why || "") && /MoMo/.test(((GJ.find(x => x.g === "103") || {}).qs || [])[0] || ""), "the MoMo / fee question is never answered: join cancelled, question kept for Alexander: " + JSON.stringify(GJ.find(x => x.g === "103")));
  const a102 = ans["Alexander Awuku:102"] || {};
  want(st("102") === "pending" && a102.ans && /F\.A Vision Enterprise sells|We sell|F\.A Vision Enterprise here/.test(a102.ans[0]) && a102.ans[1] === "Odorkor, Accra, Ghana" && a102.ans[2] === "057 264 6176" && a102.radios.join() === "Both,Yes" && a102.boxes === 1, "questions answered truthfully from F.A Vision's data and submitted (pending until accepted): " + JSON.stringify([st("102"), a102]));
  want(((GJ.find(x => x.g === "102") || {}).qa || []).length >= 5, "every question + answer is logged: " + JSON.stringify((GJ.find(x => x.g === "102") || {}).qa));
  want(st("106") === "pending" && (ans["Alexander Awuku:106"] || {}).boxes === 1, "a rules-only dialog: box ticked, submitted: " + JSON.stringify([st("106"), ans["Alexander Awuku:106"]]));
  want(st("101") === "joined" && !GJ.some(x => x.g === "105" || x.g === "107"), "public group joined; rentals and small groups never joined: " + JSON.stringify(GJ.map(x => x.g + ":" + x.status)));
  want(!r.state["mock-violation"], "never pressed Pay / anything outside the join dialog: " + r.state["mock-violation"]);
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("Profile relay join (autopilot.js grow relay): profiles take turns, a limited profile is dropped, different groups, stops at the target");
  r = await run(browser, { kind: "grow", relay: true, rb: "t1", q: [SQ("furniture ghana"), SQ("accra market")], skip: [], limit: 3, batch: 10, profiles: ["Alexander Awuku", "F.A Vision Enterprise", "Agoodmann Ventures"], min: 10000, minGlobal: 100000, deny: "rent|rooms?\\b", pmin: 1, pmax: 1, ...QA }, SQ("x").url, () => localStorage.setItem("mock-limit-F.A Vision Enterprise", "1"));
  const RJ = r.out.res.filter(x => !x.drop), joinsLog = JSON.parse(r.state.joins || "[]"), ra = JSON.parse(r.state.answers || "{}");
  want(r.out.relay && r.out.rb === "t1" && (r.out.dropped || []).includes("F.A Vision Enterprise") && r.out.res.some(x => x.drop && /can't join more groups/i.test(x.why)), "the limited Page is dropped for the day with the reason: " + JSON.stringify([r.out.dropped, r.out.res.filter(x => x.drop)]));
  const asSeq = RJ.filter(x => x.status !== "failed").map(x => x.as);
  want(asSeq.includes("Alexander Awuku") && asSeq.includes("Agoodmann Ventures") && asSeq.every((a, i) => !i || a !== asSeq[i - 1]), "the profiles took turns (never the same one twice in a row): " + JSON.stringify(asSeq));
  want(RJ.filter(x => x.status === "joined").length === 3 && new Set(RJ.map(x => x.g)).size === RJ.length, "stopped at the 3 joined target; every join a different group: " + JSON.stringify(RJ.map(x => x.as + ":" + x.g + ":" + x.status)));
  const agAns = Object.entries(ra).find(([k]) => k.startsWith("Agoodmann Ventures:"));
  want(!agAns || (/AGOODMANN|TWYFORD/.test(agAns[1].ans[0]) && agAns[1].ans[2] === "027 747 7752" && !/057 264 6176/.test(agAns[1].ans.join(" "))), "Agoodmann's answers use its own business and number: " + JSON.stringify(agAns));
  want((r.state["fb-actor"] || "Alexander Awuku") === "Alexander Awuku", "switched back to the main profile at the end: " + r.state["fb-actor"]);
  want(!r.state["mock-violation"] && !r.errors.length, "no Pay click, no page errors: " + [r.state["mock-violation"], ...r.errors].join("; "));

  console.log("Profile relay test (dry): questions are filled but never submitted; nothing else is joined");
  r = await run(browser, { kind: "grow", relay: true, rb: "t2", dry: true, test_join: true, q: [SQ("furniture ghana")], skip: ["103", "106"], limit: 40, batch: 3, profiles: ["Alexander Awuku", "Agoodmann Ventures"], min: 10000, minGlobal: 100000, deny: "rent", pmin: 1, pmax: 1, ...QA }, SQ("x").url);
  const DJ = r.out.res;
  want(DJ.filter(x => x.status === "test" && (x.qa || []).length >= 5 && /Submit not pressed/.test(x.why)).length === 1 && !r.state.answers && !(JSON.parse(r.state.joins || "[]")).length && !r.out.more, "test fills ONE group's questions (5 answers), submits nothing, joins nothing: " + JSON.stringify([DJ.map(x => x.g + ":" + x.status), r.state.answers, r.state.joins]));

  console.log("Profile relay: read one Page's groups (import as a Page), then switch back");
  r = await run(browser, { kind: "import", as: "Agoodmann Ventures", rb: "t3" }, "https://www.facebook.com/groups/joins/?nav_source=tab", () => localStorage.setItem("member-Agoodmann Ventures", '["301","302"]'));
  want(r.out.as === "Agoodmann Ventures" && (r.out.groups || []).map(g => g.id).join() === "301,302" && (r.state["fb-actor"] || "Alexander Awuku") === "Alexander Awuku", "read Agoodmann's own groups as Agoodmann, then back to you: " + JSON.stringify([r.out.groups, r.state["fb-actor"], r.out.stopped]));

  }
  if (process.env.RELAY_ONLY) { await browser.close(); console.log(problems.length ? `\n${problems.length} problem(s):\n  ✗ ` + problems.join("\n  ✗ ") : "\nAll relay mock checks passed."); process.exit(problems.length ? 1 : 0); }
  // ================================================================ shared dialog handler (extension/dialogs.js)
  if (!process.env.RELAY_ONLY) {
  const DL = (at, html, extra) => Object.assign({ at, html }, extra || {});
  const NOTIF = DL("load", '<p>Turn on notifications</p><button>Not now</button><button data-bad="turned on notifications">Turn on</button>');
  const tour = DL("compose", "<p>What's new: try our new editor</p><button>Got it</button>");
  const boostDlg = DL("post", '<p>Boost this post? Get more views with Boost</p><button>Not now</button><button data-bad="boosted">Boost post</button>', { delay: 30 });
  const SECURITY = DL("compose", '<p>Security check: confirm your identity to continue</p><button data-bad="clicked through security">Continue</button>');
  const setPlan = plan => `localStorage.setItem("dlg-plan", ${JSON.stringify(JSON.stringify(plan))}); localStorage.removeItem("dlg-used"); localStorage.removeItem("dlg-clicks"); localStorage.removeItem("dlg-violation");`;
  const dlgOk = (r, label, n) => {
    const clicks = JSON.parse(r.state["dlg-clicks"] || "[]"), dl = r.out.dialogs || [];
    want(!r.state["dlg-violation"] && clicks.length >= n && dl.length >= n, label + ": " + JSON.stringify({ clicks, viol: r.state["dlg-violation"], dialogs: dl.map(d => d.kind + ":" + d.clicked), stopped: r.out.stopped }));
  };

  console.log("dialogs: Facebook group post with a notification prompt before, a tour during and a Boost offer after posting");
  let dq = [{ g: "1", name: "Accra Buy and Sell", url: "https://www.facebook.com/groups/1/", p: "FAV-014", text: "Student desk and chair set GH₵650. WhatsApp 0572646176 to order.\n\n#AccraFurniture #FurnitureGhana", img: S + "a.jpg", stamp: "fa-vision" }];
  r = await run(browser, { kind: "post", mode: "now", q: dq, min: 1, max: 2 }, dq[0].url, setPlan([NOTIF, tour, boostDlg]));
  want(r.out.res.length === 1 && r.out.res[0].ok && JSON.parse(r.state["group-posts"] || "[]").length === 1 && /#AccraFurniture/.test(JSON.parse(r.state["group-posts"] || "[]")[0] || ""), "posted with its caption and hashtags: " + JSON.stringify([r.out.res, r.state["group-posts"]]));
  dlgOk(r, "Not now / Got it / Boost declined, all logged in dialogs[]", 2);
  console.log("dialogs: Facebook group post stops on a security check (never clicked through)");
  r = await run(browser, { kind: "post", mode: "now", q: dq, min: 1, max: 2 }, dq[0].url, setPlan([SECURITY]));
  want(/security|identity/i.test(r.out.stopped || "") && !JSON.parse(r.state["group-posts"] || "[]").length && !r.state["dlg-violation"], "stopped, nothing posted: " + JSON.stringify([r.out.stopped, r.state["group-posts"], r.state["dlg-violation"]]));

  console.log("dialogs: X post with a cookie banner before, an image-description prompt during, a slow-down notice after");
  const xq = [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", stamp: "fa-vision", text: "Student desk & chair sets GH₵650. WhatsApp 0572646176 #AccraFurniture" }];
  r = await run(browser, { kind: "x", account: "FaVisionEnt", q: xq, min: 1, max: 2 }, "https://x.com/compose/post", setPlan([
    DL("load", '<p>We use cookies to improve X.</p><button data-bad="accepted all cookies">Accept all cookies</button><button>Refuse non-essential cookies</button>'.replace("Refuse non-essential cookies", "Reject optional cookies")),
    DL("compose", "<p>Add image description so more people can enjoy it</p><button>Not this time</button><button data-bad=\"added alt\">Add</button>"),
    DL("post", "<p>You're posting a lot. Slow down a little.</p><button>OK</button>", { delay: 20 })]));
  want(r.out.res.length === 1 && r.out.res[0].ok && JSON.parse(r.state["x-posts"] || "[]").length === 1, "posted on X: " + JSON.stringify([r.out.res, r.out.stopped]));
  dlgOk(r, "cookies essential only / Not this time / OK", 2);
  console.log("dialogs: X stops on a payment / subscription prompt");
  r = await run(browser, { kind: "x", account: "FaVisionEnt", q: xq, min: 1, max: 2 }, "https://x.com/compose/post", setPlan([DL("compose", '<p>Subscribe to X Premium to keep posting</p><button data-bad="subscribed">Subscribe</button><button>Maybe later</button>')]));
  want(/payment|subscription/i.test(r.out.stopped || "") && !JSON.parse(r.state["x-posts"] || "[]").length && !r.state["dlg-violation"], "stopped, nothing posted, nothing paid: " + JSON.stringify([r.out.stopped, r.state["dlg-violation"]]));

  console.log("dialogs: TikTok post with a Studio tip before, a notification prompt during, a 'what's new' after");
  const tq = [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", stamp: "fa-vision", text: "The desk that ends homework fights.\nGH₵650 #AccraFurniture", title: "Student desk" }];
  r = await run(browser, { kind: "tiktok", q: tq, min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo", setPlan([
    DL("load", "<p>Tips for TikTok Studio: welcome to the new upload page</p><button>Got it</button>"),
    DL("compose", '<p>Turn on notifications to know when your post is live</p><button>Not now</button>'),
    DL("post", "<p>What's new: scheduling</p><button>Got it</button>", { delay: 20 })]));
  want(r.out.res.length === 1 && r.out.res[0].ok && JSON.parse(r.state["tt-posts"] || "[]").length === 1 && /homework/.test((JSON.parse(r.state["tt-posts"] || "[]")[0] || {}).text || ""), "posted on TikTok with its description: " + JSON.stringify([r.out.res, r.out.stopped]));
  dlgOk(r, "tip / notifications / what's new closed", 2);
  console.log("dialogs: TikTok 'Discard post?' that isn't ours → Keep editing (the user's draft is never discarded)");
  r = await run(browser, { kind: "tiktok", q: tq, min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo", setPlan([DL("load", '<p>Discard post? Your unsaved draft will be lost.</p><button data-bad="discarded the user\'s draft">Discard</button><button>Keep editing</button>')]));
  want(!r.state["dlg-violation"] && r.out.res[0] && r.out.res[0].ok, "kept the user's draft and posted ours: " + JSON.stringify([r.state["dlg-violation"], r.out.res, r.out.stopped]));

  console.log("dialogs: Instagram post with Save login before, Share-to-Facebook on during, notifications after");
  IG_PROFILE_HOME = true;
  const iq = [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", stamp: "fa-vision", text: "Student desk & chair sets GH₵650. WhatsApp 0572646176 #AccraFurniture" }];
  r = await run(browser, { kind: "ig", account: "favisionent", q: iq, min: 1, max: 2 }, "https://www.instagram.com/favisionent/", setPlan([
    DL("load", "<p>Save your login info?</p><button>Not now</button><button data-bad=\"saved login\">Save info</button>"),
    DL("compose", "<p>Turn on notifications</p><button>Not now</button>"),
    DL("post", "<p>Add Instagram to your home screen</p><button>Cancel</button>", { delay: 20 })]));
  const ish = JSON.parse(r.state["ig-shared"] || "[]");
  want(ish.length === 1 && ish[0].fb === "false" && /#AccraFurniture/.test(ish[0].text), "shared on Instagram with Share-to-Facebook OFF: " + JSON.stringify([ish, r.out.res, r.out.stopped]));
  dlgOk(r, "Save login / notifications / home screen declined", 2);
  console.log("dialogs: Instagram stops on a policy warning");
  r = await run(browser, { kind: "ig", account: "favisionent", q: iq, min: 1, max: 2 }, "https://www.instagram.com/favisionent/", setPlan([DL("compose", '<p>Your post goes against our Community Guidelines</p><button data-bad="clicked OK on policy">OK</button>')]));
  want(/policy|guidelines|goes against/i.test(r.out.stopped || "") && !JSON.parse(r.state["ig-shared"] || "[]").length && !r.state["dlg-violation"], "stopped, nothing shared: " + JSON.stringify([r.out.stopped, r.state["dlg-violation"]]));
  IG_PROFILE_HOME = false;
  }

  if (process.env.FX_ONLY || process.env.DLG_ONLY) { await browser.close(); console.log(problems.length ? `\n${problems.length} problem(s):\n  ✗ ` + problems.join("\n  ✗ ") : "\nAll Fix all mock checks passed."); process.exit(problems.length ? 1 : 0); }

  console.log("mkscan (Your listings, renew menus)");
  r = await run(browser, { kind: "mkscan", menus: true }, "https://www.facebook.com/marketplace/you/selling");
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

  console.log("ttscan (TikTok Studio posts: virtual table, 'No description' rows, lazy loading)");
  r = await run(browser, { kind: "ttscan" }, "https://www.tiktok.com/tiktokstudio/content");
  const posts = r.out.res || [];
  const realLen = t => t.replace(/#\w+/g, "").trim().length;
  const empties = Object.values(TT_SEED).filter(t => realLen(t) < 15).length;
  want(posts.length === 60 && new Set(posts.map(p => p.id)).size === 60, "reads all 60 posts (20 at first, 10 more each time the table's scroller nears the bottom, rows reused): got " + posts.length);
  want(posts.filter(p => realLen(p.desc) < 15).length === empties && posts.filter(p => p.desc === "").length === Object.values(TT_SEED).filter(t => !t).length, "finds every post without a real description, \"No description\" read as empty (" + empties + "): " + posts.filter(p => realLen(p.desc) < 15).map(p => p.id.slice(-2)).join());
  want(!posts.some(p => /no description/i.test(p.desc)), "the grey placeholder never counts as a description");
  const p2 = posts.find(p => p.id === "7400000000000000002") || {}, p1 = posts.find(p => p.id === "7400000000000000001") || {};
  want(p2.desc === "" && /student desk/.test(p2.alt) && /^https:/.test(p2.thumb) && p2.kind === "photo" && /Luxury/.test(p1.desc) && p1.kind === "video", "reads id (from the helper), description, thumbnail, alt and photo/video kind: " + JSON.stringify([p1, p2]).slice(0, 400));
  want(r.out.v && r.out.helper && !r.out.noid, "reports its script version and the helper's: " + JSON.stringify([r.out.v, r.out.helper, r.out.noid]));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("ttscan without the id helper (ttids.js not running)");
  r = await run(browser, { kind: "ttscan" }, "https://www.tiktok.com/tiktokstudio/content", null, ["ttids.js"]);
  want(r.out.noid > 0 && !r.out.helper && (r.out.res || []).every(p => p.desc) && (r.out.res || []).length === Object.values(TT_SEED).filter(t => t).length, "only rows with a link get an id; the rest are counted (noid) so the admin can say the helper isn't running: " + JSON.stringify([r.out.noid, r.out.helper, (r.out.res || []).length]));

  console.log("ttscan when the table is empty");
  r = await run(browser, { kind: "ttscan" }, "https://www.tiktok.com/tiktokstudio/content", () => localStorage.setItem("tt-empty", "1"));
  want(!(r.out.res || []).length && /No posts found/.test(r.out.stopped || ""), "returns to the admin with a reason: " + r.out.stopped);

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

  console.log("ttfix with prepared ids while the list shows nothing (batches of 5)");
  const prepQ = ["7400000000000000021", "7400000000000000028", "7400000000000000035", "7400000000000000042", "7400000000000000049", "7400000000000000056", "7400000000000000002"]
    .map((id, i) => ({ id, url: "", kind: "", text: "Prepared caption " + i + "\nComment 'MINE' 👇" }));
  r = await run(browser, { kind: "ttfix", min: 1, max: 2, q: prepQ, batch: 5, cont: ["ttcaps:fixall"], then: ["report"] }, "https://www.tiktok.com/tiktokstudio/content", () => localStorage.setItem("tt-empty", "1"));
  const D2 = JSON.parse(r.state["tt-desc"] || "{}");
  want((r.out.res || []).length === 5 && r.out.res.every(x => x.ok) && r.out.more === 2 && (r.out.then || []).join() === "ttcaps:fixall,report" && r.out.v, "hands back after 5 (log saved), 2 more queued, next batch chained before the rest: " + JSON.stringify([r.out.res, r.out.more, r.out.then]));
  want(prepQ.slice(0, 5).every((x, i) => D2[x.id] === x.text) && !/Prepared/.test(D2["7400000000000000002"] || ""), "the 5 prepared captions were saved on TikTok by edit URL (photo or video), the rest untouched: " + JSON.stringify(prepQ.map(x => D2[x.id])));
  r = await run(browser, { kind: "ttfix", min: 1, max: 2, q: prepQ.slice(5), batch: 5, cont: ["ttcaps:fixall"], wait_first: true, then: ["report"] }, "https://www.tiktok.com/tiktokstudio/content", () => localStorage.setItem("tt-empty", "1"));
  want((r.out.res || []).length === 2 && r.out.res.every(x => x.ok) && !r.out.more && (r.out.then || []).join() === "report", "last batch finishes the queue and goes on with the rest of the run: " + JSON.stringify([r.out.res, r.out.more, r.out.then]));
  want(!r.state["tt-violation"], "never opens ••• (Delete), never Posts: " + r.state["tt-violation"]);

  console.log("sounds (Creative Center business songs + Instagram Reels audio)");
  r = await run(browser, { kind: "sounds", stage: "cc", cc: true }, "https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en?countryCode=GH&period=7");
  const tt = r.out.res.filter(x => x.platform === "tiktok"), ig = r.out.res.filter(x => x.platform === "ig");
  want(tt.length === 2 && tt[0].name === "Afro Vibes Commercial" && tt[0].artist === "CML Artist" && tt.every(x => x.commercial) && !r.out.res.some(x => /not licensed/.test(x.name)), "TikTok: switches on 'Approved for business use' and reads the list: " + JSON.stringify(tt));
  want(ig.length === 2 && ig[0].name === "Reel Tune" && ig[0].trending && !ig.some(x => /original audio/i.test(x.name)), "Instagram: trending audio first, no 'Original audio': " + JSON.stringify(ig));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));

  console.log("story (Facebook photo story with the product link)");
  r = await run(browser, { kind: "story", stamp: "fa-vision", img: S + "a.jpg", text: "Student Desk · GH₵650\nfavisionenterprize.github.io/p/FAV-014.html" }, "https://www.facebook.com/stories/create");
  want(r.out.res[0] && r.out.res[0].ok && /FAV-014\.html/.test(r.state.story || ""), "shares the story with the link text: " + JSON.stringify(r.out));

  console.log("tiktok post with a trending sound (social.js)");
  r = await run(browser, { kind: "tiktok", q: [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", stamp: "fa-vision", text: "The desk that ends homework fights.\nGH₵650", title: "Student desk", sound: { name: "Highlife Groove", artist: "CML Band" } }, { k: "card:FAV-016", p: "FAV-016", img: S + "b.jpg", stamp: "fa-vision", text: "Quiet luxury.\nGH₵8,500", title: "Sofa", sound: { name: "Unknown Tune" } }], min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo");
  want(r.out.res.length === 2 && r.out.res[0].ok && r.out.res[0].sound === "Highlife Groove" && r.out.res[1].ok && !r.out.res[1].sound && /no sound/.test(r.out.res[1].why), "picks the sound in TikTok's picker; posts without one when it isn't found: " + JSON.stringify(r.out.res));
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));
  const posted = JSON.parse(r.state["tt-posts"] || "[]");
  want(posted.length === 2 && posted[0].text === "The desk that ends homework fights.\nGH₵650" && posted[1].text === "Quiet luxury.\nGH₵8,500", "the DESCRIPTION is posted (Draft.js state, line breaks kept), not just the title: " + JSON.stringify(posted));
  want(r.out.res[1].ok && /posted/.test(r.out.res[1].why), "a Post that reloads the tab into Posts counts as posted: " + JSON.stringify(r.out.res[1]));

  console.log("tiktok favourite artists (social.js): Davido found (skips a track used lately), Hillsong Worship not → trending; no dialog → no sound");
  r = await run(browser, { kind: "tiktok", q: [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", stamp: "fa-vision", text: "The desk that ends homework fights.\nGH₵650", title: "Student desk", sound: { name: "Highlife Groove", artist: "CML Band", fav: "Davido", avoid: ["Fall"] } }, { k: "card:FAV-016", p: "FAV-016", img: S + "b.jpg", stamp: "fa-vision", text: "Quiet luxury.\nGH₵8,500", title: "Sofa", sound: { name: "Highlife Groove", fav: "Hillsong Worship" } }], min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo");
  const fr = r.out.res;
  want(fr.length === 2 && fr[0].ok && fr[0].sound === "Feel" && fr[0].fav === "Davido" && fr[0].fav_found, "Davido found in the picker, a track not used lately: " + JSON.stringify(fr[0]));
  want(fr[1] && fr[1].ok && fr[1].sound === "Highlife Groove" && fr[1].fav === "Hillsong Worship" && !fr[1].fav_found && fr[1].fav_tried && /artist not available in picker: Hillsong Worship/.test(fr[1].why), "Hillsong Worship not in the picker → trending sound, logged: " + JSON.stringify(fr[1]));
  want(JSON.parse(r.state["tt-posts"] || "[]").map(p => p.sound).join() === "Feel,Highlife Groove", "TikTok got the picked sounds: " + r.state["tt-posts"]);
  want(!r.errors.length, "no page errors: " + r.errors.join("; "));
  r = await run(browser, { kind: "tiktok", q: [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", stamp: "fa-vision", text: "The desk that ends homework fights.\nGH₵650", title: "Student desk", sound: { name: "Highlife Groove", fav: "Davido" } }], min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo", () => localStorage.setItem("tt-nodialog", "1"));
  const nd = r.out.res[0] || {};
  want(nd.ok && !nd.sound && !nd.fav_tried && /no sound picker dialog/.test(nd.why) && JSON.parse(r.state["tt-posts"] || "[]")[0].sound === "", "no picker dialog → posts with no sound: " + JSON.stringify(nd));
  want(!r.state["tt-outside"], "nothing outside the picker clicked: " + r.state["tt-outside"]);

  console.log("tiktok post when the description box stays empty (social.js)");
  r = await run(browser, { kind: "tiktok", q: [{ k: "card:FAV-014", p: "FAV-014", img: S + "a.jpg", stamp: "fa-vision", text: "The desk that ends homework fights.\nGH₵650", title: "Student desk" }, { k: "card:FAV-016", p: "FAV-016", img: S + "b.jpg", stamp: "fa-vision", text: "Quiet luxury.", title: "Sofa" }], min: 1, max: 2 }, "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=photo", () => localStorage.setItem("tt-blank", "1"));
  want(!r.state["tt-posts"] && r.out.res.length === 1 && !r.out.res[0].ok && /empty/.test(r.out.stopped || ""), "never posts a blank description, stops the run: " + JSON.stringify(r.out).slice(0, 300));

  console.log("pinswap (X: pin the new post, unpin the old one)");
  r = await run(browser, { kind: "profile", net: "x", mode: "pinswap", handle: "FaVisionEnt", pin: "Fresh stock, just arrived! Student desk chair sets", unpin: "Old promo from last year" }, "https://x.com/");
  want(r.out.res[0].pinOk && r.state["x-pinned"] === "desk", "new post pinned (old one not deleted): " + JSON.stringify(r.out.res[0]) + " " + r.state["x-pinned"]);

  await browser.close();
  console.log(problems.length ? `\n${problems.length} problem(s):\n  ✗ ` + problems.join("\n  ✗ ") : "\nAll add-on mock checks passed.");
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
