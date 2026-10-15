// FA Vision Autopilot: TikTok Studio post ids (page world, "MAIN" in live.json). READ ONLY.
// Checked live 15 Oct 2026: TikTok Studio → Posts is a virtual table; each row is
// [data-tt=components_PostTable_Absolute] (100 px high, ~8 rendered at a time) inside the scroller
// [data-tt=components_PostTable_Container] (overflow-y: scroll; 10 more rows load near the bottom).
// Rows WITH a description link to /@user/video/<id>; rows showing the grey "No description" have no
// link and no id in the DOM at all: the id is only in the row's React props (item.item_id). The
// ttcaptions.js job runs in the add-on's own world, which can't see React's props, so this helper
// copies them onto each row as attributes: data-fav-id, data-fav-desc, data-fav-type (2 = photo
// post, else video), data-fav-time (Unix seconds), data-fav-edit (1/0 = TikTok's can_edit).
// It never clicks or changes anything.
(() => {
  const VERSION = "2026-10-15.4";
  if (!/^\/tiktokstudio\//.test(location.pathname) || window.__favTtids) return;
  window.__favTtids = true;
  const ROW = "[data-tt=components_PostTable_Absolute]";
  function itemOf(row) {
    const k = Object.keys(row).find(x => x.startsWith("__reactFiber"));
    if (!k) return null;
    const root = row[k], stack = [root];
    for (let n = 0; stack.length && n < 800; n++) {
      const f = stack.pop();
      const p = f && f.memoizedProps;
      if (p && p.item && p.item.item_id) return p.item;
      if (f.child) stack.push(f.child);
      if (f.sibling && f !== root) stack.push(f.sibling);
    }
    return null;
  }
  function tag() {
    if (!/^\/tiktokstudio\/content/.test(location.pathname)) return;
    document.documentElement.dataset.favTtids = VERSION;
    for (const row of document.querySelectorAll(ROW)) {
      let it = null;
      try { it = itemOf(row); } catch (e) { it = null; }
      if (!it) continue;
      const id = String(it.item_id);
      if (row.dataset.favId === id && row.dataset.favDesc === String(it.desc || "").slice(0, 300)) continue;
      row.dataset.favId = id;                                   // rows are reused as the list scrolls: always rewrite
      row.dataset.favDesc = String(it.desc || "").slice(0, 300);
      row.dataset.favType = String(it.item_type == null ? "" : it.item_type);
      row.dataset.favTime = String(it.create_time || "");
      const ce = it.permissions && it.permissions.can_edit;
      row.dataset.favEdit = ce && typeof ce === "object" ? (ce.reason ? "0" : "1") : ce === false ? "0" : "1";
    }
  }
  setInterval(tag, 300);
  tag();
})();
