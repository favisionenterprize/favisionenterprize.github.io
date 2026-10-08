// Meta Pixel for the F.A Vision catalog ("Fa Vision Enterprise pixel").
// Sends the same product IDs as the catalog feed (FAV-001 …), so Commerce Manager
// can match website visits to catalog products. That match is what lets catalog ads
// show people the exact furniture they looked at.
//   PageView          every page
//   ViewContent       a product is opened (#product/FAV-001)
//   Contact           WhatsApp or Call tapped (on a product it carries that product's ID)
//   InitiateCheckout  "Buy now" tapped on a product
(function () {
  var PIXEL_ID = "418736689184304";
  if (window.fbq) return;
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  fbq("init", PIXEL_ID);
  fbq("track", "PageView");

  function products() { return (window.FAV_DATA && window.FAV_DATA.products) || []; }
  function current() {
    var m = location.hash.match(/^#product\/(.+)$/);
    if (!m) return null;
    var id = decodeURIComponent(m[1]);
    for (var i = 0, l = products(); i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function data(p) {
    var d = { content_ids: [p.id], content_type: "product", content_name: p.name, content_category: p.category || "", currency: "GHS" };
    if (p.price_ghs) d.value = p.price_ghs;
    return d;
  }

  var lastViewed = null;
  function view() {
    var p = current();
    if (!p) { lastViewed = null; return; }
    if (p.id === lastViewed) return;
    lastViewed = p.id;
    fbq("track", "ViewContent", data(p));
  }
  window.addEventListener("hashchange", view);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", view); else view();

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href*='wa.me'], a[href*='whatsapp'], a[href^='tel:'], #pd-buy");
    if (!a) return;
    var p = current();
    if (a.id === "pd-buy") { if (p) fbq("track", "InitiateCheckout", Object.assign(data(p), { num_items: 1 })); return; }
    fbq("track", "Contact", p ? data(p) : {});
  }, true);
})();
