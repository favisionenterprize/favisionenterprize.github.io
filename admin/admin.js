// F.A Vision admin: post, edit and remove products.
//
// There is no server. Products and photos are committed straight to the
// GitHub repository through the GitHub REST API, using a fine-grained token
// the owner pastes in once. Every save writes data/products.json and the
// generated assets/js/products-data.js in one commit, and GitHub Pages
// republishes the site about a minute later.
(function () {
  const OWNER = "favisionenterprize";
  const REPO = "favisionenterprize.github.io";
  const BRANCH = "main";
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/`;
  const MAX_PHOTOS = 10;
  const PHOTO_WIDTH = 1600;      // uploaded photos are 1600 x 1200 (4:3), finished by the photo studio
  const TOKEN_KEY = "fav_admin_token";       // backup sign-in: GitHub token kept in this browser
  const SESSION_KEY = "fav_admin_session";   // email sign-in: session from the Apps Script backend
  const EMAIL_KEY = "fav_admin_email";
  const ORDERS_KEY = "fav-orders-key";       // ADMIN_KEY shared with orders.js, customers.js, invoices.js

  const C = window.FAV_CONFIG;
  const esc = C.escapeHtml;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  let token = "";      // set only for the backup GitHub-token sign-in
  let session = "";    // set for email + password sign-in; GitHub calls go through the backend
  let endpoint = "";   // Apps Script web app URL (data/business.json → enquiry_endpoint)
  let business = null;
  let products = [];

  const signedIn = () => !!(token || session);

  // =========================================================== utilities
  function store(key, get, value, remember) {
    try {
      if (get) return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      if (value) (remember ? localStorage : sessionStorage).setItem(key, value);
    } catch (e) { /* storage blocked: it lives in memory for this visit */ }
    return "";
  }

  function toast(msg, bad) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("bad", !!bad);
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), bad ? 6000 : 2600);
  }

  function busy(msg) {
    $("#overlay").hidden = !msg;
    if (msg) $("#overlay-msg").textContent = msg;
  }

  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const utf8ToB64 = s => bytesToB64(new TextEncoder().encode(s));
  const b64ToUtf8 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), c => c.charCodeAt(0)));

  const imgUrl = path => /^https?:/.test(path) ? path : RAW + path;
  const siteUrl = () => (business.website || `https://${OWNER.toLowerCase()}.github.io/${REPO}/`).replace(/\/?$/, "/");
  const productUrl = p => `${siteUrl()}#product/${p.id}`;

  // =========================================================== backend (Apps Script)
  async function loadEndpoint() {
    if (endpoint) return endpoint;
    const biz = await fetch("../data/business.json", { cache: "no-store" }).then(r => r.json());
    endpoint = biz.enquiry_endpoint || "";
    return endpoint;
  }

  async function backend(payload) {
    if (!(await loadEndpoint())) throw Object.assign(new Error("The backend isn't connected yet (no enquiry_endpoint in data/business.json)."), { status: 0 });
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },   // simple request: no CORS preflight
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    return res.json();
  }

  // =========================================================== GitHub API
  async function gh(path, opts = {}) {
    if (session) {
      // Email sign-in: the backend adds the GitHub token, which never reaches this browser.
      const r = await backend({ action: "github", session, method: opts.method || "GET", path, body: opts.body || null });
      if (!r.ok) {
        const err = new Error(r.error || "error");
        err.status = r.error === "signed_out" ? "signed_out" : r.error === "no_github_token" ? "no_github_token" : 500;
        throw err;
      }
      if (r.status >= 300) {
        const err = new Error((r.body && r.body.message) || "GitHub error " + r.status);
        err.status = r.status;
        throw err;
      }
      return r.body;
    }
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {})
      },
      cache: "no-store"
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).message || ""; } catch (e) { /* not JSON */ }
      const err = new Error(detail || res.statusText);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  function friendly(err) {
    if (err.status === "signed_out") { expireSession(); return "You've been signed out. Please sign in again."; }
    if (err.status === "no_github_token") return "Sign-in worked, but the backend has no GitHub token yet. In Apps Script → Project Settings → Script properties, add GITHUB_TOKEN.";
    if (session && (err.status === 401 || err.status === 403 || err.status === 404)) return "The GitHub token saved in Apps Script (GITHUB_TOKEN) was rejected or has expired. Make a new one and replace it there.";
    if (err.status === 401) return "Your token was rejected. It may have expired: sign out and paste a new one.";
    if (err.status === 403) return "Your token can't save changes. On GitHub, give it Contents: Read and write for this repository.";
    if (err.status === 404) return "Couldn't find the repository with this token. Check that the token has access to favisionenterprize.github.io.";
    if (!navigator.onLine) return "You're offline. Check your internet connection and try again.";
    return "Something went wrong: " + err.message;
  }

  async function readJson(path, ref) {
    const f = await gh(`/contents/${path}?ref=${ref || BRANCH}`);
    return JSON.parse(b64ToUtf8(f.content));
  }

  async function load() {
    const ref = (await gh(`/git/ref/heads/${BRANCH}`)).object.sha;
    [business, products] = await Promise.all([readJson("data/business.json", ref), readJson("data/products.json", ref)]);
  }

  function siteDataJs(biz, list) {
    // Same output as site_data_js() in scripts/generate_listings.py.
    return "// Generated from data/business.json and data/products.json. Do not edit by hand.\n" +
      `window.FAV_DATA = ${JSON.stringify({ business: biz, products: list }, null, 2)};\n`;
  }

  // Apply `mutate` to the latest products.json and commit it, plus any new
  // photos and photo deletions, as one commit. Retries if someone else
  // committed in between.
  async function commit({ mutate, uploads = [], deletes = [], message }) {
    const blobShas = {};
    for (let i = 0; i < uploads.length; i++) {
      busy(`Uploading photo ${i + 1} of ${uploads.length}…`);
      const blob = await gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: uploads[i].b64, encoding: "base64" }) });
      blobShas[uploads[i].path] = blob.sha;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      busy("Saving to your website…");
      const head = (await gh(`/git/ref/heads/${BRANCH}`)).object.sha;
      const baseTree = (await gh(`/git/commits/${head}`)).tree.sha;
      const [biz, latest] = await Promise.all([readJson("data/business.json", head), readJson("data/products.json", head)]);
      const next = mutate(latest);
      const tree = [
        { path: "data/products.json", mode: "100644", type: "blob", content: JSON.stringify(next, null, 2) + "\n" },
        { path: "assets/js/products-data.js", mode: "100644", type: "blob", content: siteDataJs(biz, next) },
        ...Object.entries(blobShas).map(([path, sha]) => ({ path, mode: "100644", type: "blob", sha })),
        ...deletes.map(path => ({ path, mode: "100644", type: "blob", sha: null }))
      ];
      const newTree = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree }) });
      const newCommit = await gh("/git/commits", { method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }) });
      try {
        await gh(`/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: newCommit.sha }) });
        business = biz;
        products = next;
        return next;
      } catch (err) {
        if (err.status !== 422 || attempt === 2) throw err;   // 422 = branch moved; rebuild on the new head
      }
    }
  }

  // Read any JSON file from the repo (latest commit). Returns `fallback` if it doesn't exist yet.
  async function readJsonFile(path, fallback) {
    try { return await readJson(path); }
    catch (err) { if (fallback !== undefined && (err.status === 404 || /not found/i.test(err.message))) return fallback; throw err; }
  }

  // Upload files (base64) and update one JSON file in a single commit (used by the
  // Videos library). `deletes` = repo paths to remove in the same commit.
  async function commitFiles({ files = [], deletes = [], jsonPath, mutate, message, fallback }) {
    const blobs = [];
    for (let i = 0; i < files.length; i++) {
      busy(`Uploading ${files[i].label || "file"} (${i + 1} of ${files.length})…`);
      const b = await gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: files[i].b64, encoding: "base64" }) });
      blobs.push({ path: files[i].path, mode: "100644", type: "blob", sha: b.sha });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      busy("Saving to your website…");
      const head = (await gh(`/git/ref/heads/${BRANCH}`)).object.sha;
      const baseTree = (await gh(`/git/commits/${head}`)).tree.sha;
      let current;
      try { current = await readJson(jsonPath, head); }
      catch (err) { if (fallback === undefined) throw err; current = JSON.parse(JSON.stringify(fallback)); }
      const next = mutate(current);
      const tree = [{ path: jsonPath, mode: "100644", type: "blob", content: JSON.stringify(next, null, 1) + "\n" }, ...blobs,
        ...deletes.map(path => ({ path, mode: "100644", type: "blob", sha: null }))];
      const newTree = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree }) });
      const newCommit = await gh("/git/commits", { method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }) });
      try {
        await gh(`/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: newCommit.sha }) });
        return next;
      } catch (err) {
        if (err.status !== 422 || attempt === 2) throw err;
      }
    }
  }

  // Apply `mutate` to the latest copy of one JSON file and commit it on its own
  // (used by the Facebook autopilot log). Retries if the branch moved meanwhile.
  async function saveJson(path, mutate, message, fallback) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = (await gh(`/git/ref/heads/${BRANCH}`)).object.sha;
      const baseTree = (await gh(`/git/commits/${head}`)).tree.sha;
      let current;
      try { current = await readJson(path, head); }
      catch (err) { if (fallback === undefined) throw err; current = JSON.parse(JSON.stringify(fallback)); }
      const next = mutate(current);
      const newTree = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: [{ path, mode: "100644", type: "blob", content: JSON.stringify(next, null, 1) + "\n" }] }) });
      const newCommit = await gh("/git/commits", { method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }) });
      try {
        await gh(`/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: newCommit.sha }) });
        return next;
      } catch (err) {
        if (err.status !== 422 || attempt === 2) throw err;
      }
    }
  }

  // =========================================================== captions
  const phones = () => (business.phones || [business.whatsapp]).map(C.localPhone).join(" / ");
  const priceText = p => p.price_ghs ? C.formatPrice(p.price_ghs) + (p.negotiable ? " (negotiable)" : "") : "Price on request";

  function marketplaceText(p) {
    return [
      `${p.name}${p.custom_order ? " - Made to Order" : ""}`,
      `Price: ${priceText(p)}`,
      "",
      p.description,
      "",
      ...(p.highlights || []).map(h => `✔ ${h}`),
      p.material && `Material: ${p.material}`,
      p.dimensions && `Size: ${p.dimensions}`,
      (p.colors || []).length && `Colours: ${p.colors.join(", ")}`,
      p.custom_order && "Custom sizes, colours and finishes available.",
      "",
      `📍 Showroom: ${business.address}`,
      `🚚 ${business.delivery_note}`,
      `💬 WhatsApp: ${C.localPhone(business.whatsapp)}`,
      `📞 Call: ${phones()}`,
      `🌐 See it here: ${productUrl(p)}`,
      `Ref: ${p.id}`
    ].filter(x => x !== false && x !== undefined && x !== null && x !== 0).join("\n").replace(/\n{3,}/g, "\n\n");
  }

  function groupText(p) {
    const bullets = (p.highlights || []).map(h => `• ${h}`).join("\n");
    return `🛋️ ${p.name} available now!\n${bullets ? bullets + "\n" : ""}💰 ${priceText(p)}\n📍 Odorkor, Accra, delivery available\n📞 WhatsApp ${C.localPhone(business.whatsapp)}\n👉 ${productUrl(p)}\n${(business.hashtags || []).slice(0, 4).join(" ")}`;
  }

  const statusText = p => `${p.name} 🔥\n${priceText(p)}\nOrder: ${productUrl(p)}`;

  // =========================================================== routing
  function show(screen) {
    $$(".screen").forEach(s => { s.hidden = s.id !== "screen-" + screen; });
    $("#top-actions").hidden = screen === "login";
    window.scrollTo(0, 0);
  }

  document.addEventListener("click", e => {
    const go = e.target.closest("[data-go]");
    if (!go) return;
    e.preventDefault();
    if (!signedIn()) return show("login");
    if (go.dataset.go === "post") startPost(null);
    else { renderDash(); show("dash"); }
  });

  // =========================================================== sign in
  // Email + password (checked by the Apps Script backend). "Forgot password"
  // emails a 6-digit code to the admin email; the code sets a new password.
  function authStep(which) {
    ["login", "forgot", "reset"].forEach(s => { $("#auth-" + s).hidden = s !== which; });
    $("#auth-token").hidden = which !== "login";
    $$("#screen-login .error").forEach(e => { e.hidden = true; });
    const focus = { login: $("#login-email").value ? "#login-password" : "#login-email", forgot: "#forgot-email", reset: "#reset-code" }[which];
    setTimeout(() => $(focus) && $(focus).focus(), 50);
  }

  function showError(id, msg) { const el = $(id); el.textContent = msg; el.hidden = false; }

  const AUTH_ERRORS = {
    wrong: "That email or password isn't right.",
    locked: "Too many tries. Wait 15 minutes, or use \"Forgot password\".",
    no_password: "No password has been set yet. Tap \"Forgot password? · First time? Set a password\" below.",
    wait: "A code was sent less than a minute ago. Check your email, or wait a minute and try again.",
    expired: "That code has expired. Tap \"Send a new code\".",
    bad_code: "That code isn't right. Check the latest email and try again.",
    short: "Use at least 8 characters for your password.",
    "bad request": "The backend doesn't know email sign-in yet. Paste the latest Code.gs into Apps Script and deploy a new version (see backend/README.md)."
  };
  AUTH_ERRORS["name required"] = AUTH_ERRORS["bad request"];   // what the older backend answers
  const authMessage = r => AUTH_ERRORS[r.error] || "Something went wrong: " + (r.error || "unknown error");

  async function finishSignIn(r, remember) {
    session = r.session;
    token = "";
    store(TOKEN_KEY, false, "");
    store(SESSION_KEY, false, session, remember);
    if (r.email) store(EMAIL_KEY, false, r.email, true);
    // One sign-in also unlocks Orders, Customers and Invoices.
    if (r.key) store(ORDERS_KEY, false, r.key, true);
    busy("Loading your products…");
    await load();
    renderDash();
    show("dash");
  }

  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const remember = $("#remember").checked;
    busy("Signing in…");
    try {
      const r = await backend({ action: "login", email: $("#login-email").value.trim(), password: $("#login-password").value, remember });
      if (!r.ok) return showError("#login-error", authMessage(r));
      $("#login-password").value = "";
      await finishSignIn(r, remember);
    } catch (ex) {
      showError("#login-error", ex.status ? friendly(ex) : navigator.onLine ? "Couldn't reach the backend. " + ex.message : "You're offline. Check your internet connection and try again.");
    } finally { busy(null); }
  });

  $("#forgot-link").addEventListener("click", () => {
    $("#forgot-email").value = $("#login-email").value || store(EMAIL_KEY, true);
    authStep("forgot");
  });
  $$("[data-auth]").forEach(b => b.addEventListener("click", () => authStep(b.dataset.auth)));

  async function sendCode() {
    const email = $("#forgot-email").value.trim();
    busy("Sending the code…");
    try {
      const r = await backend({ action: "forgot", email });
      if (!r.ok) { showError($("#auth-reset").hidden ? "#forgot-error" : "#reset-error", authMessage(r)); return false; }
      $("#reset-sub").textContent = `If ${email} is the admin email, a 6-digit code is on its way. Check your inbox (and Spam), then enter it below.`;
      return true;
    } catch (ex) {
      showError($("#auth-reset").hidden ? "#forgot-error" : "#reset-error", ex.status === 0 ? ex.message : "Couldn't reach the backend. Check your connection and try again.");
      return false;
    } finally { busy(null); }
  }

  $("#forgot-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (await sendCode()) authStep("reset");
  });
  $("#resend-code").addEventListener("click", async () => {
    if (await sendCode()) toast("New code sent. Use the latest email.");
  });

  $("#reset-code").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });

  $("#reset-form").addEventListener("submit", async e => {
    e.preventDefault();
    const code = $("#reset-code").value.replace(/\D/g, "");
    const pw = $("#reset-password").value, pw2 = $("#reset-password2").value;
    if (code.length !== 6) return showError("#reset-error", "Enter the 6-digit code from the email.");
    if (pw.length < 8) return showError("#reset-error", AUTH_ERRORS.short);
    if (pw !== pw2) return showError("#reset-error", "The two passwords don't match.");
    const remember = $("#remember").checked;
    busy("Saving your new password…");
    try {
      const r = await backend({ action: "reset", email: $("#forgot-email").value.trim(), code, password: pw, remember });
      if (!r.ok) return showError("#reset-error", authMessage(r));
      ["#reset-code", "#reset-password", "#reset-password2"].forEach(s => { $(s).value = ""; });
      $("#login-email").value = $("#forgot-email").value.trim();
      authStep("login");
      toast("Password saved. You're signed in.");
      await finishSignIn(r, remember);
    } catch (ex) {
      showError("#reset-error", ex.status ? friendly(ex) : "Couldn't reach the backend. Check your connection and try again.");
    } finally { busy(null); }
  });

  $$("[data-eye]").forEach(b => b.addEventListener("click", () => {
    const input = document.getElementById(b.dataset.eye);
    const showIt = input.type === "password";
    input.type = showIt ? "text" : "password";
    b.textContent = showIt ? "Hide" : "Show";
  }));

  // Backup: sign in with a GitHub token kept in this browser (the old way).
  $("#token-form").addEventListener("submit", async e => {
    e.preventDefault();
    session = "";
    token = $("#token").value.trim();
    busy("Signing in…");
    try {
      await load();
      store(TOKEN_KEY, false, token, $("#remember").checked);
      $("#token").value = "";
      renderDash();
      show("dash");
    } catch (ex) {
      token = "";
      showError("#token-error", friendly(ex));
    } finally { busy(null); }
  });

  function expireSession() {
    session = "";
    store(SESSION_KEY, false, "");
  }

  $("#signout").addEventListener("click", () => {
    if (session) backend({ action: "logout", session }).catch(() => {});
    token = "";
    session = "";
    store(TOKEN_KEY, false, "");
    store(SESSION_KEY, false, "");
    store(ORDERS_KEY, false, "");
    $("#login-email").value = store(EMAIL_KEY, true);
    authStep("login");
    show("login");
  });

  // =========================================================== dashboard
  let dashFilter = "all";

  // Unsaved inline edits, keyed by product id: { id: { name, price_ghs, ... } }.
  // Everything edited on the list is saved together in one commit.
  const pending = {};
  const openMore = new Set();
  const view = p => ({ ...p, ...(pending[p.id] || {}) });

  function thumb(p) {
    const imgs = p.images || [];
    const full = imgs.length >= MAX_PHOTOS;
    const inner = imgs.length
      ? `<img src="${esc(imgUrl(imgs[0]))}" alt="" loading="lazy">${imgs.length > 1 ? `<span class="count">${imgs.length} photos</span>` : ""}`
      : C.iconSvg(C.categoryIcon(p)) + `<span class="nophoto">Add photo</span>`;
    if (full) return `<div class="thumb has-photo">${inner}</div>`;
    return `<button type="button" class="thumb ${imgs.length ? "has-photo" : ""}" data-act="addphoto" title="${imgs.length ? "Add more photos" : "Add a photo"}" aria-label="Add photos to ${esc(p.name)}">${inner}<span class="plus" aria-hidden="true">+</span></button>`;
  }

  function catOptions(p) {
    const cat = C.CATEGORIES.find(c => c.id === p.category);
    const cats = C.CATEGORIES.map(c => c.id);
    if (p.category && !cats.includes(p.category)) cats.unshift(p.category);
    const types = cat ? (cat.types.includes(p.type) || !p.type ? cat.types : [p.type, ...cat.types]) : (p.type ? [p.type] : []);
    return {
      cats: cats.map(c => `<option ${c === p.category ? "selected" : ""}>${esc(c)}</option>`).join(""),
      types: types.map(t => `<option ${t === p.type ? "selected" : ""}>${esc(t)}</option>`).join("")
    };
  }

  function itemHtml(orig) {
    const p = view(orig);
    const o = catOptions(p);
    const more = openMore.has(p.id);
    return `
      <div class="item ${pending[p.id] ? "dirty" : ""}" data-id="${esc(p.id)}">
        ${thumb(p)}
        <div class="item-main">
          <input class="ie ie-name" data-field="name" value="${esc(p.name)}" maxlength="70" aria-label="Product name">
          <div class="item-meta">${esc(p.id)} ·
            <select class="ie" data-field="category" aria-label="Category">${o.cats}</select> ·
            <select class="ie" data-field="type" aria-label="Type">${o.types}</select>
            ${p.in_stock ? `<span class="pill ok">Live</span>` : `<span class="pill sold">Sold out</span>`}
            ${p.placeholder ? `<span class="pill est">Price not confirmed</span>` : ""}</div>
          <div class="item-price"><span class="cur">GH₵</span>
            <input class="ie ie-price" data-field="price_ghs" type="number" min="0" step="1" inputmode="numeric" value="${p.price_ghs || ""}" placeholder="On request" aria-label="Price in cedis">
            <label class="neg"><input type="checkbox" data-field="negotiable" ${p.negotiable ? "checked" : ""}> Negotiable</label>
            <button type="button" class="more-toggle" data-act="more" aria-expanded="${more}">${more ? "Less ▴" : "More details ▾"}</button>
          </div>
        </div>
        <div class="item-actions">
          <button class="btn btn-ghost btn-sm" data-act="edit">Full edit</button>
          <button class="btn btn-ghost btn-sm" data-act="share">Share</button>
          <button class="btn btn-ghost btn-sm" data-act="stock">${p.in_stock ? "Mark sold" : "Back in stock"}</button>
          <button class="btn btn-danger btn-sm" data-act="delete">Delete</button>
        </div>
        ${more ? `<div class="item-more">
          <label class="full">Description<textarea data-field="description" maxlength="1000">${esc(p.description || "")}</textarea></label>
          <label>Material<input data-field="material" value="${esc(p.material || "")}"></label>
          <label>Size<input data-field="dimensions" value="${esc(p.dimensions || "")}"></label>
          <label class="full">Highlights (one per line, up to 5)<textarea data-field="highlights">${esc((p.highlights || []).join("\n"))}</textarea></label>
        </div>` : ""}
      </div>`;
  }

  function renderDash() {
    const total = products.length;
    const inStock = products.filter(p => p.in_stock).length;
    const noPhoto = products.filter(p => !(p.images || []).length).length;
    $("#dash-sub").textContent = `${total} product${total === 1 ? "" : "s"} on your website`;
    const stat = (key, n, label, warn) => `<button class="stat ${warn && n ? "warn" : ""}" data-filter="${key}" aria-pressed="${dashFilter === key}"><b>${n}</b><span>${label}</span></button>`;
    $("#stats").innerHTML = stat("all", total, "Total products") + stat("instock", inStock, "In stock") +
      stat("sold", total - inStock, "Sold out") + stat("nophoto", noPhoto, "Missing photos", true);
    $("#dash-filter").value = dashFilter;

    const q = $("#dash-search").value.trim().toLowerCase();
    const list = products.filter(p =>
      (dashFilter === "all" || (dashFilter === "instock" && p.in_stock) || (dashFilter === "sold" && !p.in_stock) || (dashFilter === "nophoto" && !(p.images || []).length)) &&
      (!q || `${view(p).name} ${p.type} ${p.category} ${p.id}`.toLowerCase().includes(q))
    ).slice().reverse();   // newest first

    $("#list").innerHTML = list.length ? list.map(itemHtml).join("") : `<div class="empty-state">No products here yet. <button class="btn btn-sell" data-go="post">+ Post a product</button></div>`;
    updateSavebar();
  }

  function rerenderItem(id) {
    const row = $(`#list .item[data-id="${CSS.escape(id)}"]`);
    const p = products.find(x => x.id === id);
    if (row && p) row.outerHTML = itemHtml(p);
  }

  $("#stats").addEventListener("click", e => {
    const b = e.target.closest("[data-filter]");
    if (b) { dashFilter = b.dataset.filter; renderDash(); }
  });
  $("#dash-filter").addEventListener("change", e => { dashFilter = e.target.value; renderDash(); });
  $("#dash-search").addEventListener("input", renderDash);

  // ---- inline editing
  function readField(el) {
    const f = el.dataset.field;
    if (f === "negotiable") return el.checked;
    if (f === "price_ghs") { const n = parseInt(el.value, 10); return n > 0 ? n : null; }
    if (f === "highlights") return el.value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 5);
    return f === "description" ? el.value : el.value.trim();
  }

  function setPending(id, field, value) {
    const orig = products.find(x => x.id === id);
    if (!orig) return;
    const patch = { ...(pending[id] || {}), [field]: value };
    if (field === "category") {
      const cat = C.CATEGORIES.find(c => c.id === value);
      if (cat && !cat.types.includes(view(orig).type)) patch.type = cat.types[0];
    }
    if (field === "price_ghs") patch.placeholder = false;   // a price typed in by the owner is confirmed
    // Drop fields that are back to their saved value.
    for (const k of Object.keys(patch)) if (JSON.stringify(patch[k]) === JSON.stringify(orig[k] ?? (k === "highlights" ? [] : k === "negotiable" ? false : ""))) delete patch[k];
    if (Object.keys(patch).length) pending[id] = patch; else delete pending[id];
    const row = $(`#list .item[data-id="${CSS.escape(id)}"]`);
    if (row) row.classList.toggle("dirty", !!pending[id]);
    if (field === "category") rerenderItem(id);
    updateSavebar();
  }

  $("#list").addEventListener("input", e => {
    const el = e.target.closest("[data-field]");
    if (el && el.tagName !== "SELECT" && el.type !== "checkbox") setPending(el.closest(".item").dataset.id, el.dataset.field, readField(el));
  });
  $("#list").addEventListener("change", e => {
    const el = e.target.closest("[data-field]");
    if (el) setPending(el.closest(".item").dataset.id, el.dataset.field, readField(el));
  });
  $("#list").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("input.ie")) { e.preventDefault(); saveAll(); }
    if (e.key === "Escape" && e.target.matches(".ie")) e.target.blur();
  });

  function updateSavebar() {
    const n = Object.keys(pending).length;
    $("#savebar").hidden = !n;
    $("#savebar-msg").textContent = `${n} product${n === 1 ? "" : "s"} changed. Not saved yet.`;
  }

  async function saveAll() {
    const ids = Object.keys(pending);
    if (!ids.length) return;
    for (const id of ids) {
      const p = view(products.find(x => x.id === id) || {});
      if (!p.name || p.name.length < 3) {
        const row = $(`#list .item[data-id="${CSS.escape(id)}"] .ie-name`);
        if (row) row.focus();
        return toast(`Product ${id} needs a name (at least 3 letters)`, true);
      }
    }
    const patches = JSON.parse(JSON.stringify(pending));
    try {
      await commit({
        message: ids.length === 1 ? `Quick edit: ${view(products.find(x => x.id === ids[0])).name} (${ids[0]})` : `Quick edit ${ids.length} products: ${ids.join(", ")}`,
        mutate: list => list.map(x => {
          const patch = patches[x.id];
          if (!patch) return x;
          const next = { ...x, ...patch };
          if (!next.price_ghs) next.negotiable = false;
          if ("type" in patch) next.marketplace_category = C.marketplaceCategory(next.type);
          return next;
        })
      });
      ids.forEach(id => delete pending[id]);
      toast(`Saved. Your website updates in about a minute.`);
      renderDash();
      // A price change leaves the linked Facebook listings behind: point straight at Price sync.
      if (ids.some(id => patches[id] && "price_ghs" in patches[id]) && window.FAV_PRICESYNC) window.FAV_PRICESYNC.nudge(ids);
    } catch (err) {
      toast(friendly(err), true);
    } finally { busy(null); }
  }

  $("#save-all").addEventListener("click", saveAll);
  $("#discard-all").addEventListener("click", () => {
    if (!confirm("Discard your unsaved changes?")) return;
    Object.keys(pending).forEach(id => delete pending[id]);
    renderDash();
  });
  window.addEventListener("beforeunload", e => {
    if (Object.keys(pending).length) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---- quick add photos from the list
  let photoTarget = null;

  async function quickAddPhotos(id, files) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    const room = MAX_PHOTOS - (p.images || []).length;
    if (room <= 0) return toast(`This product already has ${MAX_PHOTOS} photos`, true);
    const list = [...files].filter(f => f.type.startsWith("image/")).slice(0, room);
    if (!list.length) return toast("Please choose a photo file", true);
    const stamp = Date.now().toString(36);
    const uploads = [];
    try {
      for (let i = 0; i < list.length; i++) {
        busy(`Preparing photo ${i + 1} of ${list.length}…`);
        const photo = await PhotoStudio.fromFile(list[i]);
        const blob = await PhotoStudio.toJpeg(photo, PHOTO_WIDTH);
        const n = (p.images || []).length + i + 1;
        uploads.push({ path: `assets/images/products/${id.toLowerCase()}-${stamp}-${n}.jpg`, b64: bytesToB64(new Uint8Array(await blob.arrayBuffer())) });
      }
      const paths = uploads.map(u => u.path);
      await commit({
        message: `Add ${paths.length} photo${paths.length === 1 ? "" : "s"}: ${p.name} (${id})`,
        uploads,
        mutate: all => all.map(x => x.id === id ? { ...x, images: [...(x.images || []), ...paths].slice(0, MAX_PHOTOS) } : x)
      });
      toast(`${paths.length} photo${paths.length === 1 ? "" : "s"} added. Live on the website in about a minute.`);
      if (files.length > room) toast(`Only ${room} photo(s) added (max ${MAX_PHOTOS})`, true);
      renderDash();
    } catch (err) {
      toast(err.status ? friendly(err) : err.message, true);
    } finally { busy(null); }
  }

  $("#quick-photo").addEventListener("change", e => {
    const files = [...e.target.files];
    e.target.value = "";
    if (photoTarget && files.length) quickAddPhotos(photoTarget, files);
  });
  const listEl = $("#list");
  ["dragenter", "dragover"].forEach(ev => listEl.addEventListener(ev, e => {
    const t = e.target.closest("button.thumb");
    if (t && e.dataTransfer.types.includes("Files")) { e.preventDefault(); t.classList.add("drag"); }
  }));
  ["dragleave", "drop"].forEach(ev => listEl.addEventListener(ev, e => { const t = e.target.closest("button.thumb"); if (t) t.classList.remove("drag"); }));
  listEl.addEventListener("drop", e => {
    const t = e.target.closest("button.thumb");
    if (t && e.dataTransfer.files.length) { e.preventDefault(); quickAddPhotos(t.closest(".item").dataset.id, e.dataTransfer.files); }
  });

  $("#list").addEventListener("click", async e => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest(".item").dataset.id;
    const p = products.find(x => x.id === id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === "addphoto") { photoTarget = id; return $("#quick-photo").click(); }
    if (act === "more") { openMore.has(id) ? openMore.delete(id) : openMore.add(id); return rerenderItem(id); }
    if (act === "edit") { const v = view(p); delete pending[id]; updateSavebar(); return startPost(v); }
    if (act === "share") return showDone(view(p), false);
    try {
      if (act === "stock") {
        await commit({
          message: `${p.in_stock ? "Mark sold out" : "Back in stock"}: ${p.name} (${p.id})`,
          mutate: list => list.map(x => x.id === id ? { ...x, in_stock: !x.in_stock } : x)
        });
        toast(p.in_stock ? "Marked as sold out" : "Back in stock");
      }
      if (act === "delete") {
        if (!confirm(`Delete "${p.name}" from your website? This removes its photos too.`)) return;
        await commit({
          message: `Remove product: ${p.name} (${p.id})`,
          mutate: list => list.filter(x => x.id !== id),
          deletes: (p.images || []).filter(src => src.startsWith("assets/images/products/"))
        });
        delete pending[id];
        toast("Product deleted");
      }
      renderDash();
    } catch (err) {
      toast(friendly(err), true);
    } finally { busy(null); }
  });

  // =========================================================== post / edit form
  let draft = null;     // { editing, category, type, condition, colors:Set, photos:[] }
  let step = 1;

  function startPost(p) {
    draft = {
      editing: p ? p.id : null,
      category: p ? p.category : "",
      type: p ? p.type || "" : "",
      condition: p ? p.condition || "Brand New" : "Brand New",
      colors: new Set(p ? p.colors || [] : []),
      photos: p ? (p.images || []).map(path => ({ kind: "existing", path, url: imgUrl(path) })) : []
    };
    $("#post-heading").textContent = p ? `Edit: ${p.name}` : "Post a product";
    $("#publish").textContent = p ? "Save changes" : "Post product";
    $("#f-name").value = p ? p.name : "";
    $("#f-material").value = p ? p.material || "" : "";
    $("#f-dimensions").value = p ? p.dimensions || "" : "";
    $("#f-description").value = p ? p.description || "" : "";
    $("#f-highlights").value = p ? (p.highlights || []).join("\n") : "";
    $("#f-price").value = p && p.price_ghs ? p.price_ghs : "";
    $("#f-onrequest").checked = !!(p && !p.price_ghs);
    $$('input[name="neg"]').forEach(r => { r.checked = r.value === (p && p.negotiable === false ? "0" : "1"); });
    $("#f-custom").checked = p ? !!p.custom_order : true;
    $("#f-stock").checked = p ? !!p.in_stock : true;
    $$(".error[data-err]").forEach(e => { e.hidden = true; });
    renderCats();
    renderPhotos();
    renderPills();
    syncPrice();
    updateCounters();
    goStep(1);
    show("post");
  }

  function renderCats() {
    $("#cat-grid").innerHTML = C.CATEGORIES.map(c => `
      <button type="button" class="cat" data-cat="${esc(c.id)}" aria-pressed="${draft.category === c.id}">${C.iconSvg(C.ICONS[c.icon])}${esc(c.id)}</button>`).join("");
    const cat = C.CATEGORIES.find(c => c.id === draft.category);
    $("#type-wrap").hidden = !cat;
    if (cat) {
      const types = cat.types.includes(draft.type) || !draft.type ? cat.types : [draft.type, ...cat.types];
      $("#type-pills").innerHTML = types.map(t => `<button type="button" data-type="${esc(t)}" aria-pressed="${draft.type === t}">${esc(t)}</button>`).join("");
    }
  }

  $("#cat-grid").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    if (draft.category !== b.dataset.cat) draft.type = "";
    draft.category = b.dataset.cat;
    $('[data-err="category"]').hidden = true;
    renderCats();
  });
  $("#type-pills").addEventListener("click", e => {
    const b = e.target.closest("[data-type]");
    if (!b) return;
    draft.type = b.dataset.type;
    $('[data-err="type"]').hidden = true;
    renderCats();
  });

  function renderPills() {
    $("#cond-pills").innerHTML = C.CONDITIONS.map(c => `<button type="button" data-cond="${esc(c)}" aria-pressed="${draft.condition === c}">${esc(c)}</button>`).join("");
    const colours = [...new Set([...C.COLOURS, ...draft.colors])];
    $("#colour-pills").innerHTML = colours.map(c => `<button type="button" data-colour="${esc(c)}" aria-pressed="${draft.colors.has(c)}">${esc(c)}</button>`).join("");
  }
  $("#cond-pills").addEventListener("click", e => {
    const b = e.target.closest("[data-cond]");
    if (b) { draft.condition = b.dataset.cond; renderPills(); }
  });
  $("#colour-pills").addEventListener("click", e => {
    const b = e.target.closest("[data-colour]");
    if (!b) return;
    const c = b.dataset.colour;
    draft.colors.has(c) ? draft.colors.delete(c) : draft.colors.add(c);
    renderPills();
  });

  // ---- photos
  // Each new photo keeps its original plus its studio edits (admin/photo-studio.js);
  // the finished 4:3 JPEG is only produced when the product is posted.
  async function thumbUrl(ph) {
    const blob = await new Promise(r => PhotoStudio.render(ph.photo, 480, "preview").toBlob(r, "image/jpeg", 0.8));
    if (ph.url && ph.url.startsWith("blob:")) URL.revokeObjectURL(ph.url);
    ph.url = URL.createObjectURL(blob);
  }

  async function addFiles(files) {
    const room = MAX_PHOTOS - draft.photos.length;
    if (!room) return toast(`You can add up to ${MAX_PHOTOS} photos`, true);
    const list = [...files].slice(0, room);
    busy("Preparing photos…");
    for (const f of list) {
      try {
        const ph = { kind: "new", photo: await PhotoStudio.fromFile(f) };
        await thumbUrl(ph);
        draft.photos.push(ph);
      } catch (err) { toast(err.message, true); }
    }
    busy(null);
    if (files.length > room) toast(`Only the first ${room} photo(s) were added (max ${MAX_PHOTOS})`, true);
    $('[data-err="photos"]').hidden = true;
    renderPhotos();
  }

  $("#photo-input").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
  const addTile = $("#photo-add");
  ["dragenter", "dragover"].forEach(ev => addTile.addEventListener(ev, e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); addTile.classList.add("drag"); } }));
  ["dragleave", "drop"].forEach(ev => addTile.addEventListener(ev, () => addTile.classList.remove("drag")));
  addTile.addEventListener("drop", e => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

  function renderPhotos() {
    $$("#photos .photo").forEach(n => n.remove());
    const html = draft.photos.map((ph, i) => `
      <div class="photo" draggable="true" data-i="${i}">
        <img src="${esc(ph.url)}" alt="Photo ${i + 1}">
        ${i === 0 ? `<span class="main-tag">Main</span>` : ""}
        <button type="button" class="del" data-del="${i}" aria-label="Remove photo">×</button>
        <button type="button" class="edit" data-edit-photo="${i}">✎ Edit</button>
        <div class="moves">
          <button type="button" data-move="${i}" data-dir="-1" aria-label="Move left" ${i === 0 ? "disabled" : ""}>◀</button>
          <button type="button" data-move="${i}" data-dir="1" aria-label="Move right" ${i === draft.photos.length - 1 ? "disabled" : ""}>▶</button>
        </div>
      </div>`).join("");
    addTile.insertAdjacentHTML("beforebegin", html);
    addTile.hidden = draft.photos.length >= MAX_PHOTOS;
  }

  function movePhoto(from, to) {
    if (to < 0 || to >= draft.photos.length || from === to) return;
    const [ph] = draft.photos.splice(from, 1);
    draft.photos.splice(to, 0, ph);
    renderPhotos();
  }

  const photosEl = $("#photos");
  photosEl.addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) { draft.photos.splice(+del.dataset.del, 1); return renderPhotos(); }
    const mv = e.target.closest("[data-move]");
    if (mv) return movePhoto(+mv.dataset.move, +mv.dataset.move + +mv.dataset.dir);
    const ed = e.target.closest("[data-edit-photo]") || (e.target.closest(".photo") && !e.target.closest("button") && e.target.closest(".photo"));
    if (ed) editPhoto(+(ed.dataset.editPhoto || ed.dataset.i));
  });

  async function editPhoto(i) {
    const ph = draft.photos[i];
    if (ph.kind === "existing") {
      // Already-uploaded photos are reloaded and become a new upload once edited.
      busy("Opening photo…");
      try { ph.photo = await PhotoStudio.fromUrl(ph.url); }
      catch (err) { busy(null); return toast(err.message, true); }
      busy(null);
    }
    const others = draft.photos.filter((o, j) => j !== i && o.photo).map(o => o.photo);
    const result = await PhotoEditor.open(ph.photo, { others });
    if (result === "cancel") return;
    busy("Updating photos…");
    const changed = result === "all" ? draft.photos.filter(o => o.photo) : [ph];
    for (const o of changed) {
      if (o.kind === "existing") { o.kind = "new"; delete o.path; }
      await thumbUrl(o);
    }
    busy(null);
    renderPhotos();
  }
  let dragFrom = null;
  photosEl.addEventListener("dragstart", e => {
    const ph = e.target.closest(".photo");
    if (!ph) return;
    dragFrom = +ph.dataset.i;
    ph.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  photosEl.addEventListener("dragover", e => {
    const ph = e.target.closest(".photo");
    if (dragFrom === null || !ph) return;
    e.preventDefault();
    $$(".photo.over").forEach(n => n.classList.remove("over"));
    ph.classList.add("over");
  });
  photosEl.addEventListener("drop", e => {
    const ph = e.target.closest(".photo");
    if (dragFrom === null || !ph) return;
    e.preventDefault();
    movePhoto(dragFrom, +ph.dataset.i);
  });
  photosEl.addEventListener("dragend", () => { dragFrom = null; $$(".photo").forEach(n => n.classList.remove("dragging", "over")); });

  // ---- details
  function updateCounters() {
    $$(".counter").forEach(c => {
      const input = document.getElementById(c.dataset.for);
      c.textContent = `${input.value.length} / ${input.maxLength}`;
    });
  }
  ["f-name", "f-description"].forEach(id => document.getElementById(id).addEventListener("input", updateCounters));

  function syncPrice() {
    const onReq = $("#f-onrequest").checked;
    $("#f-price").disabled = onReq;
    $$('input[name="neg"]').forEach(r => { r.disabled = onReq; });
    if (onReq) $('[data-err="price"]').hidden = true;
  }
  $("#f-onrequest").addEventListener("change", syncPrice);

  function readForm() {
    const onReq = $("#f-onrequest").checked;
    const price = parseInt($("#f-price").value, 10);
    return {
      name: $("#f-name").value.trim(),
      category: draft.category,
      type: draft.type,
      marketplace_category: C.marketplaceCategory(draft.type),
      price_ghs: onReq || !(price > 0) ? null : price,
      negotiable: !onReq && $('input[name="neg"]:checked').value === "1",
      icon: "",
      description: $("#f-description").value.trim(),
      condition: draft.condition,
      material: $("#f-material").value.trim(),
      dimensions: $("#f-dimensions").value.trim(),
      colors: [...draft.colors],
      custom_order: $("#f-custom").checked,
      in_stock: $("#f-stock").checked,
      images: draft.photos.map(ph => ph.path || ph.url),
      highlights: $("#f-highlights").value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 5),
      placeholder: false
    };
  }

  function validate(n) {
    const errs = {};
    if (n === 1) {
      if (!draft.category) errs.category = true;
      if (draft.category && !draft.type) errs.type = true;
      // New products need a photo, like Jiji. Existing ones can be saved without, to fix other details first.
      if (!draft.photos.length && !draft.editing) errs.photos = true;
    }
    if (n === 2) {
      const f = readForm();
      if (f.name.length < 5) errs.name = true;
      if (f.description.length < 20) errs.description = true;
      if (!$("#f-onrequest").checked && !f.price_ghs) errs.price = true;
    }
    $$(`.step[data-step="${n}"] .error[data-err]`).forEach(e => { e.hidden = !errs[e.dataset.err]; });
    const first = $(`.step[data-step="${n}"] .error[data-err]:not([hidden])`);
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    return !first;
  }

  function goStep(n) {
    step = n;
    $$(".step").forEach(s => { s.hidden = +s.dataset.step !== n; });
    $$("#stepper li").forEach(li => {
      const k = +li.dataset.step;
      li.classList.toggle("active", k === n);
      li.classList.toggle("done", k < n);
    });
    if (n === 3) renderReview();
    window.scrollTo(0, 0);
  }

  $$("[data-next]").forEach(b => b.addEventListener("click", () => {
    const to = +b.dataset.next;
    if (to > step && !validate(step)) return;
    goStep(to);
  }));

  function previewCard(p, photoUrl) {
    const badges = [p.custom_order && `<span>Made to order</span>`, p.negotiable && p.price_ghs && `<span class="gold">Negotiable</span>`, !p.in_stock && `<span>Sold out</span>`].filter(Boolean).join("");
    return `
      <div class="pcard">
        <div class="pmedia">${photoUrl ? `<img src="${esc(photoUrl)}" alt="">` : C.iconSvg(C.categoryIcon(p))}<div class="pbadges">${badges}</div></div>
        <div class="pbody">
          <div class="ptype">${esc(p.type || p.category)}</div>
          <div class="pname">${esc(p.name)}</div>
          <div class="pdesc">${esc(p.description)}</div>
          <div class="pprice">${p.price_ghs ? C.formatPrice(p.price_ghs) : "Price on request"}</div>
        </div>
      </div>`;
  }

  function renderReview() {
    const f = readForm();
    const id = draft.editing || "FAV-###";
    const facts = [
      ["Category", `${f.category} · ${f.type}`], ["Condition", f.condition], ["Price", priceText(f)],
      ["Material", f.material], ["Size", f.dimensions], ["Colours", f.colors.join(", ")],
      ["Photos", String(draft.photos.length)], ["Availability", f.in_stock ? (f.custom_order ? "Made to order" : "In stock") : "Sold out"]
    ].filter(([, v]) => v);
    $("#review").innerHTML = previewCard(f, draft.photos[0] && draft.photos[0].url) +
      `<dl class="review-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
    $("#review-caption").textContent = marketplaceText({ ...f, id });
  }

  function nextId(list) {
    const max = list.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ""), 10) || 0), 0);
    return "FAV-" + String(max + 1).padStart(3, "0");
  }

  $("#publish").addEventListener("click", async () => {
    if (!validate(1)) return goStep(1);
    if (!validate(2)) return goStep(2);
    const form = readForm();
    const editing = draft.editing;
    const old = editing ? products.find(p => p.id === editing) : null;
    // Reserve the id now so photo file names match it; commit() re-checks against the latest list.
    let id = editing || nextId(products);
    const stamp = Date.now().toString(36);
    const uploads = [];
    const images = [];
    busy("Finishing photos…");
    mainPhotoPreview = null;
    for (let i = 0; i < draft.photos.length; i++) {
      const ph = draft.photos[i];
      if (ph.kind === "existing") { images.push(ph.path); continue; }
      const path = `assets/images/products/${id.toLowerCase()}-${stamp}-${i + 1}.jpg`;
      const blob = await PhotoStudio.toJpeg(ph.photo, PHOTO_WIDTH);
      uploads.push({ path, b64: bytesToB64(new Uint8Array(await blob.arrayBuffer())) });
      if (i === 0) mainPhotoPreview = URL.createObjectURL(blob);
      images.push(path);
    }
    const deletes = old ? (old.images || []).filter(src => src.startsWith("assets/images/products/") && !images.includes(src)) : [];
    try {
      const saved = await commit({
        message: `${editing ? "Update" : "Add"} product: ${form.name} (${id})`,
        uploads,
        deletes,
        mutate: list => {
          if (editing) return list.map(p => p.id === editing ? { ...p, ...form, id: editing, images, icon: p.icon || "" } : p);
          if (list.some(p => p.id === id)) id = nextId(list);   // someone else took this id meanwhile
          return [...list, { id, ...form, images }];
        }
      });
      const product = saved.find(p => p.id === id);
      draft.photos.forEach(ph => ph.kind === "new" && URL.revokeObjectURL(ph.url));
      showDone(product, true, editing, mainPhotoPreview);
    } catch (err) {
      toast(friendly(err), true);
    } finally { busy(null); }
  });

  // =========================================================== done / share
  let shareProduct = null, sharePhoto = null, mainPhotoPreview = null;

  // localPhoto: the just-rendered main photo, used until GitHub serves the uploaded copy.
  function showDone(p, justSaved, wasEdit, localPhoto) {
    shareProduct = p;
    sharePhoto = localPhoto || ((p.images || [])[0] && imgUrl(p.images[0]));
    $("#done-title").textContent = justSaved ? (wasEdit ? "Changes saved!" : "Your product is posted!") : `Share: ${p.name}`;
    $("#done-sub").textContent = justSaved ? "It will appear on the website in about a minute." : "Copy a ready-made post for Facebook or send it straight to a client.";
    $(".done-ico").hidden = !justSaved;
    $("#done-card").innerHTML = previewCard(p, sharePhoto);
    $("#share-wa").href = "https://wa.me/?text=" + encodeURIComponent(`${p.name} · ${priceText(p)}\n${productUrl(p)}`);
    $("#share-view").href = productUrl(p);
    show("done");
  }

  $("#screen-done").addEventListener("click", async e => {
    if (e.target.closest("#make-promo") && shareProduct) return PromoMaker.open(shareProduct, business, sharePhoto, {
      link: productUrl(shareProduct),
      captions: { status: statusText(shareProduct), post: groupText(shareProduct) }
    });
    const b = e.target.closest("[data-copy]");
    if (!b || !shareProduct) return;
    const text = { link: productUrl(shareProduct), marketplace: marketplaceText(shareProduct), group: groupText(shareProduct), status: statusText(shareProduct) }[b.dataset.copy];
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Now paste it on Facebook or WhatsApp.");
    } catch (err) {
      prompt("Copy this text:", text);
    }
  });

  // Shared with admin/pricesync.js (Facebook price sync screen).
  window.FAV_ADMIN = {
    commit: opts => commit(opts),
    readJsonFile, saveJson, commitFiles, productUrl, friendly,
    // backend call with this browser's sign-in (email sign-in only; GitHub-token sign-in has none)
    backendSigned: payload => session ? backend({ ...payload, session }) : Promise.resolve({ ok: false, error: "no_session" }),
    products: () => products,
    business: () => business,
    signedIn,
    toast, busy, marketplaceText, show,
    refreshDash: () => renderDash(),
    reload: async () => { await load(); renderDash(); }
  };

  // =========================================================== start
  (async function init() {
    // Deep links: /admin/#invoices, #orders, #customers and #leads open those screens directly.
    const deepLink = () => {
      const sel = { "#invoices": "[data-invoices]", "#orders": "[data-orders]", "#customers": "[data-customers]", "#leads": "[data-leads]" }[location.hash];
      const el = sel && document.querySelector(sel);
      if (el) el.click();
      return !!el;
    };
    session = store(SESSION_KEY, true);
    token = session ? "" : store(TOKEN_KEY, true);
    $("#login-email").value = store(EMAIL_KEY, true);
    if (!signedIn()) { show("login"); authStep("login"); setTimeout(deepLink); return; } // after invoices.js / orders.js have loaded
    busy("Loading your products…");
    try {
      await load();
      renderDash();
      show("dash");
      deepLink();
    } catch (err) {
      const msg = friendly(err);
      token = "";
      session = "";   // kept in storage (unless it expired), so a reload can try again
      show("login");
      authStep("login");
      showError("#login-error", msg);
    } finally { busy(null); }
  })();
})();
