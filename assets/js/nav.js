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
  const itemsOf = g => Array.from(g.querySelectorAll(".nav-menu a"));
  const timers = new WeakMap();

  function setOpen(g, open) {
    g.classList.toggle("open", open);
    btnOf(g).setAttribute("aria-expanded", String(open));
    if (!open) delete g.dataset.pinned;
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
        focusItem(g, k === "ArrowDown" ? 0 : -1);
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

  const onBp = () => { closeAll(); };
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
