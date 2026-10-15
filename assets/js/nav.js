/* Top nav: Shop ▾ / Services ▾ / About ▾ dropdowns (desktop) and accordions (mobile panel).
   Shared by index.html, studio/ and videos/. The hamburger toggle itself stays in each page's script. */
(function () {
  "use strict";
  const nav = document.getElementById("nav-links");
  if (!nav) return;
  const toggle = document.getElementById("nav-toggle");
  const groups = Array.from(nav.querySelectorAll(".nav-group"));
  const desk = window.matchMedia("(min-width: 761px)");
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
  const btnOf = g => g.querySelector(".nav-cat");
  const shown = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const itemsOf = g => Array.from(g.querySelectorAll(".nav-menu a")).filter(shown);
  const timers = new WeakMap();

  // ---------- Products ▾ mega-menu, built from window.FAV_DATA (assets/js/products-data.js) ----------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => "GH₵ " + Number(n).toLocaleString("en-GH");
  const CAT_ORDER = ["School", "Office", "Dining", "Living Room", "Bedroom", "Walls & Decor", "Electronics", "Printing & Stationery", "Custom"];
  const PARTNERS = "From our partners";
  // Groups products by their real category; partner products (p.seller) go in their own group last.
  function groupProducts(list) {
    const map = new Map();
    list.forEach(p => {
      const k = p.seller ? PARTNERS : (p.category || "Other");
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    });
    const rank = k => k === PARTNERS ? 1e6 : (CAT_ORDER.indexOf(k) + 1 || 1000);
    return Array.from(map.keys()).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map(k => ({ name: k, items: map.get(k) }));
  }
  function priceText(p) {
    if (!p.price_ghs) return "Price on request";
    return (p.custom_order ? "From " : "") + money(p.price_ghs);
  }
  const searchText = p => [p.name, p.category, p.type, p.id, p.seller && p.seller.name, p.material].join(" ").toLowerCase();
  window.FAV_NAV = { groupProducts, priceText, money, esc, searchText, PARTNERS };

  const mega = nav.querySelector(".nav-mega");
  const megaMenu = mega && mega.querySelector(".nav-menu");
  const root = megaMenu ? (megaMenu.dataset.root || "") : "";
  let megaBuilt = false, thumbsLoaded = false;
  function buildMega() {
    if (!mega || megaBuilt) return;
    const data = window.FAV_DATA;
    if (!data || !data.products) return;
    megaBuilt = true;
    const body = mega.querySelector(".pm-body");
    body.innerHTML = groupProducts(data.products).map((g, i) => `
      <section class="pm-cat" data-cat="${esc(g.name)}">
        <button type="button" class="pm-cat-h" aria-expanded="false" aria-controls="pm-list-${i}">
          <span>${esc(g.name)} <span class="pm-n">${g.items.length}</span></span><span class="nav-caret" aria-hidden="true">▾</span>
        </button>
        <div class="pm-list" id="pm-list-${i}">
          ${g.items.map(p => {
            const img = (p.images || [])[0];
            return `<a class="pm-item" href="${esc(root)}p/${esc(p.id)}.html" data-q="${esc(searchText(p))}">
              <span class="pm-thumb">${img ? `<img data-src="${esc(root + img)}" alt="" width="44" height="44" loading="lazy" decoding="async">` : `<span class="pm-ph" aria-hidden="true">${esc(p.icon || "▢")}</span>`}</span>
              <span class="pm-txt"><span class="pm-name">${esc(p.name)}</span><span class="pm-price">${esc(priceText(p))}</span></span>
            </a>`;
          }).join("")}
        </div>
      </section>`).join("");
    syncHeads();
  }
  function loadThumbs() {
    if (thumbsLoaded || !mega) return;
    thumbsLoaded = true;
    mega.querySelectorAll("img[data-src]").forEach(img => { img.src = img.dataset.src; img.removeAttribute("data-src"); });
  }
  // Category headings are accordion buttons on mobile, plain headings on desktop.
  function syncHeads() {
    if (!mega) return;
    mega.querySelectorAll(".pm-cat-h").forEach(b => {
      if (desk.matches) { b.tabIndex = -1; b.setAttribute("aria-disabled", "true"); }
      else { b.tabIndex = 0; b.removeAttribute("aria-disabled"); }
    });
  }
  function filterMega(q) {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let total = 0;
    mega.querySelectorAll(".pm-cat").forEach(cat => {
      let n = 0;
      cat.querySelectorAll(".pm-item").forEach(a => {
        const hit = words.every(w => a.dataset.q.includes(w));
        a.hidden = !hit; if (hit) n++;
      });
      cat.hidden = n === 0; total += n;
    });
    mega.querySelector(".pm-body").classList.toggle("searching", words.length > 0);
    mega.querySelector(".pm-empty").hidden = total > 0;
  }
  if (mega) {
    if (window.FAV_DATA) buildMega();
    else {
      // Page doesn't load the product data itself: fetch it the first time the menu is needed.
      const s = document.createElement("script");
      s.src = root + "assets/js/products-data.js";
      s.onload = () => { buildMega(); if (mega.classList.contains("open")) loadThumbs(); };
      document.head.appendChild(s);
    }
    const q = mega.querySelector(".pm-search input");
    q.addEventListener("input", () => filterMega(q.value));
    q.addEventListener("focus", () => { mega.dataset.pinned = "1"; });
    q.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); const it = itemsOf(mega); if (it[0]) it[0].focus(); }
      else if (e.key === "Enter") { e.preventDefault(); const it = itemsOf(mega).filter(a => a.classList.contains("pm-item")); if (it.length === 1) it[0].click(); else if (it[0]) it[0].focus(); }
      else if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation(); // let Home/End/arrows edit the text
    });
    mega.querySelector(".pm-body").addEventListener("click", e => {
      const h = e.target.closest(".pm-cat-h");
      if (!h || desk.matches) return;
      const cat = h.closest(".pm-cat"), open = !cat.classList.contains("open");
      cat.classList.toggle("open", open);
      h.setAttribute("aria-expanded", String(open));
    });
  }

  function setOpen(g, open) {
    g.classList.toggle("open", open);
    btnOf(g).setAttribute("aria-expanded", String(open));
    if (!open) delete g.dataset.pinned;
    if (open && g === mega) { buildMega(); loadThumbs(); }
  }
  function closeAll(except) { groups.forEach(g => { if (g !== except) setOpen(g, false); }); }
  function closePanel() {
    nav.classList.remove("open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }
  function focusItem(g, idx) {
    const items = itemsOf(g);
    if (!items.length) return;
    items[(idx + items.length) % items.length].focus();
  }

  groups.forEach((g, gi) => {
    const btn = btnOf(g);

    btn.addEventListener("click", () => {
      const isOpen = g.classList.contains("open");
      if (desk.matches) {
        // Opened by hover: a click pins it open. Pinned (or closed): a click toggles.
        if (isOpen && !g.dataset.pinned && canHover.matches && g.matches(":hover")) { g.dataset.pinned = "1"; return; }
        closeAll(g);
      }
      setOpen(g, !isOpen);
      if (!isOpen && desk.matches) g.dataset.pinned = "1";
    });

    g.addEventListener("mouseenter", () => {
      if (!desk.matches || !canHover.matches) return;
      clearTimeout(timers.get(g));
      if (!g.classList.contains("open")) { closeAll(g); setOpen(g, true); }
    });
    g.addEventListener("mouseleave", () => {
      if (!desk.matches || !canHover.matches || g.dataset.pinned) return;
      timers.set(g, setTimeout(() => setOpen(g, false), 180));
    });

    btn.addEventListener("keydown", e => {
      const k = e.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        closeAll(g); setOpen(g, true); g.dataset.pinned = "1";
        const search = g.querySelector(".pm-search input");
        if (search && k === "ArrowDown" && shown(search)) search.focus();
        else focusItem(g, k === "ArrowDown" ? 0 : -1);
      } else if (desk.matches && (k === "ArrowRight" || k === "ArrowLeft")) {
        e.preventDefault();
        const next = groups[(gi + (k === "ArrowRight" ? 1 : -1) + groups.length) % groups.length];
        const wasOpen = g.classList.contains("open");
        closeAll();
        if (wasOpen) { setOpen(next, true); next.dataset.pinned = "1"; }
        btnOf(next).focus();
      }
    });

    g.querySelector(".nav-menu").addEventListener("keydown", e => {
      const items = itemsOf(g), i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); focusItem(g, i + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(g, i - 1); }
      else if (e.key === "Home") { e.preventDefault(); focusItem(g, 0); }
      else if (e.key === "End") { e.preventDefault(); focusItem(g, -1); }
    });

    // Tabbing out of a desktop dropdown closes it.
    g.addEventListener("focusout", e => {
      if (desk.matches && !g.contains(e.relatedTarget)) setOpen(g, false);
    });
  });

  // Any link in the nav: close menus and the mobile panel (anchors then scroll as before).
  nav.addEventListener("click", e => {
    if (e.target.closest("a")) { closeAll(); closePanel(); }
  });

  document.addEventListener("click", e => {
    if (desk.matches && !nav.contains(e.target)) closeAll();
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const openG = groups.find(g => g.classList.contains("open") && g.contains(document.activeElement));
    if (desk.matches || openG) {
      const anyOpen = groups.some(g => g.classList.contains("open"));
      if (desk.matches) closeAll(); else if (openG) setOpen(openG, false);
      if (openG) btnOf(openG).focus();
      if (anyOpen) return;
    }
    if (nav.classList.contains("open")) { closePanel(); if (toggle) toggle.focus(); }
  });

  const onBp = () => { closeAll(); syncHeads(); };
  if (desk.addEventListener) desk.addEventListener("change", onBp); else if (desk.addListener) desk.addListener(onBp);

  // Current section: the page's own link (aria-current) plus scroll-spy for #anchors on this page.
  const here = location.pathname;
  const spies = [];
  nav.querySelectorAll(".nav-menu a").forEach(a => {
    let u;
    try { u = new URL(a.getAttribute("href"), location.href); } catch (_) { return; }
    if (u.pathname === here && u.hash.length > 1) {
      const el = document.getElementById(decodeURIComponent(u.hash.slice(1)));
      if (el) spies.push({ a, el });
    }
  });

  function markCurrent() {
    let best = null, bestTop = -Infinity;
    const line = 130;
    spies.forEach(s => {
      const r = s.el.getBoundingClientRect();
      if (r.top <= line && r.bottom > line && r.top > bestTop) { best = s; bestTop = r.top; }
    });
    spies.forEach(s => s.a.classList.toggle("is-current", s === best));
    groups.forEach(g => {
      const on = !!g.querySelector('.nav-menu a[aria-current="page"], .nav-menu a.is-current');
      g.classList.toggle("is-current", on);
    });
  }
  let raf = 0;
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; markCurrent(); }); };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  window.addEventListener("hashchange", onScroll);
  markCurrent();
})();
