// Brand stamp on every post picture (rule P1, 🧭 AI Plan). Every picture the Social autopilot posts must
// show the posting brand's NAME and LOGO. scripts/make_brand_stamps.py makes the stamped copies
// (assets/images/stamped/<brand>/…: the clean product photo with a band holding that brand's logo, name and
// own WhatsApp) and lists them in data/brand-stamps.json, with the pictures that already show F.A Vision's
// brand (its strategy, tile, presence and box ads, deal cards, seasonal and AI Studio ads).
//
// FAV_STAMP.apply(job) runs in fbauto launch() on every job with pictures (FB group / Page posts, Instagram,
// X, TikTok, Facebook story, Marketplace listing): for each item it works out the brand (item.brand → the
// product's seller → FAV_BRANDS.detect(text) → F.A Vision), keeps a picture that already shows that brand,
// swaps any other for that brand's stamped copy of the product photo (a picture showing a DIFFERENT brand is
// never used), and marks the item `stamp: <brand id>`. No stamped picture → the item is dropped and the
// reason logged (job.refused, toast, localStorage "fa-stamp-log"). The add-on scripts refuse any picture item
// without `stamp` ("no brand stamp — not posted"), the same way they refuse a blank description.
// Videos (.mp4: our Shorts with their own F.A Vision ad frames) carry `stamp: "video"` and aren't re-stamped.
(function () {
  "use strict";
  const A = () => window.FAV_ADMIN || {};
  const FILE = "data/brand-stamps.json";
  const SITE = "https://favisionenterprize.github.io/";
  let D = null;
  async function load(force) {
    if (D && !force) return D;
    try { D = await A().readJsonFile(FILE, { brands: {}, own: {}, videos: {} }); } catch (e) { D = D || { brands: {}, own: {}, videos: {} }; }
    D.brands = D.brands || {}; D.own = D.own || {}; D.videos = D.videos || {};
    return D;
  }
  const brands = () => (window.FAV_BRANDS && window.FAV_BRANDS.list()) || [];
  const home = () => brands().find(b => b.default) || { id: "fa-vision", name: "F.A Vision Enterprise", default: true };
  const byId = id => brands().find(b => b.id === id) || null;
  const product = id => (id && ((A().products && A().products()) || []).find(p => p.id === id)) || null;
  const sellerBrand = p => {
    if (!p || !p.seller) return null;
    const n = String(p.seller.name || "").toLowerCase();
    return brands().find(b => !b.default && (String(b.name).toLowerCase() === n || (b.match || []).some(m => String(m).toLowerCase() === n))) || null;
  };
  // The brand an item goes out as.
  function brandOf(it, p) {
    if (it && it.brand && byId(it.brand)) return byId(it.brand);
    const s = sellerBrand(p);
    if (s) return s;
    const BR = window.FAV_BRANDS;
    const d = BR && it && it.text ? BR.detect(it.text) : null;
    return d || home();
  }
  const pathOf = url => String(url || "").replace(location.origin + "/", "").replace(SITE, "").replace(/^\.\.\//, "").replace(/^\//, "").replace(/[?#].*$/, "");
  let base = null;   // the site the job's own picture URLs point at (live site or this admin's origin)
  const full = path => (base || location.origin + "/") + path;
  const baseOf = url => { const m = String(url || "").match(/^(https?:\/\/[^/]+\/)/); return m ? m[1] : null; };
  const isVideo = url => /\.(mp4|mov|webm)(\?|$)/i.test(String(url || ""));
  // A picture that shows this brand for product p: the same picture when it already does, else the brand's
  // stamped copy of the product's first photo that has one. null = nothing to post.
  function imageFor(url, b, p) {
    if (!D || !b) return null;
    const path = pathOf(url), map = D.brands[b.id] || {}, own = D.own[b.id] || [];
    if (path && (own.includes(path) || Object.values(map).includes(path))) return full(path);
    if (path && map[path]) return full(map[path]);
    for (const src of ((p && p.images) || [])) if (map[pathOf(src)]) return full(map[pathOf(src)]);
    return null;
  }
  // Every picture that may go out for product p as brand b: its own ad designs first (F.A Vision's "just arrived"
  // ad for the desk), then its stamped product photos. Paths relative to the site.
  function choices(p, b) {
    if (!D || !p || !b) return [];
    const own = D.own[b.id] || [], map = D.brands[b.id] || {}, id = p.id.toLowerCase();
    const ads = own.filter(x => new RegExp(`(^|/|-)${id}(-arrived)?\\.jpg$`).test(x)).sort((a, c) => (/arrived/.test(c) - /arrived/.test(a)));
    return ads.concat((p.images || []).map(x => map[pathOf(x)]).filter(Boolean));
  }
  const preview = (p, brandId) => { const b = byId(brandId) || home(); const u = imageFor(p && p.images && p.images[0], b, p); return u ? pathOf(u) : null; };
  function note(job, it, why) {
    job.refused = (job.refused || []).concat({ g: it.g || null, p: it.p || null, k: it.k || null, why });
    try { const L = JSON.parse(localStorage.getItem("fa-stamp-log") || "[]"); L.unshift({ t: new Date().toISOString(), kind: job.kind, p: it.p || null, why }); localStorage.setItem("fa-stamp-log", JSON.stringify(L.slice(0, 60))); } catch (e) { /* storage off */ }
  }
  // One item: sets it.img (or it.imgs[0]) to a stamped picture and it.stamp; false = drop it.
  function fixItem(job, it, field) {
    const p = product(it.p || job.p);
    const b = brandOf(field === "job" ? { text: job.text, brand: job.brand } : it, p);
    const key = field === "imgs" ? null : "img";
    const url = field === "imgs" ? (it.imgs || [])[0] : it.img;
    if (!url) return true;                                  // text-only post (e.g. X without a picture)
    if (isVideo(url) || it.video) { it.stamp = "video"; return true; }
    base = baseOf(url);
    const got = D ? imageFor(url, b, p) : null;
    if (!D) { note(job, it, "brand stamps not loaded yet — not posted (open the Social autopilot again)"); return false; }
    if (!got) { note(job, it, `no brand stamp for ${b.name}${p ? " on " + p.id : ""} — not posted (run scripts/make_brand_stamps.py)`); return false; }
    if (key) it.img = got; else it.imgs = [got].concat((it.imgs || []).slice(1).filter(x => x !== got));
    it.stamp = b.id; it.stamp_name = b.name;
    return true;
  }
  const IMG_KINDS = { post: "img", ig: "img", x: "img", tiktok: "img", mklist: "imgs" };
  function apply(job) {
    if (!job) return job;
    if (job.kind === "story" && job.img) {
      const holder = { img: job.img, p: job.p, text: job.text };
      if (fixItem(job, holder, "job")) { job.img = holder.img; job.stamp = holder.stamp; job.stamp_name = holder.stamp_name; }
      else { job.img = null; job.stamp = null; }
      return job;
    }
    const f = IMG_KINDS[job.kind];
    if (!f || !Array.isArray(job.q)) return job;
    job.q = job.q.filter(it => fixItem(job, it, f));
    return job;
  }
  window.FAV_STAMP = { load, apply, imageFor, brandOf, preview, choices, pathOf, state: () => D, _test: { set: d => { D = d; } } };
  if (A().readJsonFile) setTimeout(() => load().catch(() => null), 0);
})();
