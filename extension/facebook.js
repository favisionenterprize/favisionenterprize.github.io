// FA Vision Price Sync: runs on Facebook Marketplace pages.
// Only acts when the FA Vision admin opened this tab with a sync queue
// (#favsync=… on the first listing, then kept in this tab's sessionStorage).
// For each queued listing it types the new price, taps Update, opens the next
// listing, and at the end returns to the admin with what it saved.
(async () => {
  const KEY = "favsync";
  const box = (msg, bad) => {
    let d = document.getElementById("favsyncbox");
    if (!d) {
      d = document.createElement("div");
      d.id = "favsyncbox";
      d.style.cssText = "position:fixed;z-index:2147483647;left:16px;bottom:16px;max-width:380px;padding:14px 18px;border-radius:12px;font:600 15px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35)";
      document.body.appendChild(d);
    }
    d.style.background = bad ? "#c62828" : "#0d55af";
    d.textContent = "FA Vision sync · " + msg;
  };
  const m = location.hash.match(/favsync=([^&]+)/);
  let s = null;
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) || "null");
    const fresh = m ? JSON.parse(decodeURIComponent(m[1])) : null;
    s = fresh && !(stored && JSON.stringify(stored.q) === JSON.stringify(fresh.q)) ? fresh : stored;
  } catch (e) { s = null; }
  if (!s || !s.q) return;                       // not a sync tab: do nothing
  s.done = s.done || []; s.skip = s.skip || [];
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(s));
  save();
  const finish = () => {
    const result = { done: s.q.filter(j => s.done.includes(j.id)).map(j => [j.id, j.price]), skip: s.skip };
    sessionStorage.removeItem(KEY);
    location.href = s.back + "#pricesync-done=" + encodeURIComponent(JSON.stringify(result));
  };
  const next = () => {
    const n = s.q.find(j => !s.done.includes(j.id) && !s.skip.includes(j.id));
    if (n) { save(); location.href = `${location.origin}/marketplace/edit/?listing_id=${n.id}`; return; }
    finish();
  };
  if (!location.pathname.startsWith("/marketplace/edit")) { box("Continuing…"); setTimeout(next, 500); return; }
  const id = new URLSearchParams(location.search).get("listing_id");
  const job = s.q.find(j => j.id === id);
  if (!job || s.done.includes(id) || s.skip.includes(id)) { next(); return; }
  const nth = s.done.length + s.skip.length + 1;
  box(`listing ${nth} of ${s.q.length}: setting GH₵${Number(job.price).toLocaleString()}…`);
  let pi = null;
  const dlg = () => { const r = window.FAV_DIALOGS && window.FAV_DIALOGS.tick(); return r && r.stop; };   // shared dialog handler (extension/dialogs.js)
  for (let t = 0; t < 80 && !pi; t++) {
    const st = dlg(); if (st) { box("Stopped: " + st, true); return; }
    pi = [...document.querySelectorAll("input[type=text]")].find(i => ((i.closest("label") || {}).innerText || "").trim().startsWith("Price"));
    if (!pi) await new Promise(r => setTimeout(r, 250));
  }
  const skip = why => { s.skip.push(id); save(); box(why + " Skipped; fix it by hand. Moving on…", true); setTimeout(next, 2500); };
  if (!pi) return skip("The price box didn't load.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(pi, String(job.price));
  pi.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  if (pi.value.replace(/\D/g, "") !== String(job.price) || !/^GH/.test(pi.value)) return skip(`This listing shows "${pi.value}" (check its currency).`);
  const btn = [...document.querySelectorAll('[role=button],button')].find(b => (b.innerText || "").trim() === "Update");
  if (!btn) return skip("No Update button on this page.");
  { const st = dlg(); if (st) { box("Stopped: " + st, true); return; } }
  btn.click();
  box(`listing ${nth} of ${s.q.length}: saving…`);
  for (let t = 0; t < 100 && location.pathname.includes("/edit"); t++) { const st = dlg(); if (st) { box("Stopped: " + st, true); return; } await new Promise(r => setTimeout(r, 250)); }
  if (location.pathname.includes("/edit")) return skip("Facebook didn't confirm the save.");
  s.done.push(id); save();
  box(`saved ${s.done.length} of ${s.q.length}.`);
  setTimeout(next, 700);
})();
