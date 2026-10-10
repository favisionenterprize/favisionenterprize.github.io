// Dynamic descriptions for every posting feature in the admin (Facebook groups, Instagram,
// X, TikTok, YouTube, videos, share buttons). Each call builds a fresh text from random
// parts (hook, body, price, place, payment, call to action, hashtags), so posts never carry
// the same description twice, and every text ends with a call to action.
// window.FAV_CAPTIONS.write(p, { net, ad, studio, full, tags, subject })  → text
// window.FAV_CAPTIONS.title(p, { net })                                   → short title (YouTube / TikTok)
// window.FAV_CAPTIONS.cta(p, { net })                                     → one call to action
// net: "fb" | "ig" | "x" | "tiktok" | "youtube" | "share"; p can be null (brand / AI Studio / general video).
(function () {
  const C = window.FAV_CONFIG || {};
  const A = () => window.FAV_ADMIN;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const recent = [];   // texts made this session: never hand out the same one twice
  const site = () => location.origin + "/";
  const biz = () => { try { return (A() && A().business()) || {}; } catch (e) { return {}; } };
  const local = n => (C.localPhone ? C.localPhone(n) : n);
  const money = n => (C.formatPrice ? C.formatPrice(n) : "GH₵" + Number(n).toLocaleString("en-GB"));
  const short = p => String(p.name).split(" — ")[0];
  const a_ = name => (/s$/i.test(name) ? "" : /^[aeiou]/i.test(name) ? "an " : "a ");
  const inBio = net => net === "ig" || net === "tiktok";

  function facts(p) {
    const B = biz(), s = p && p.seller;
    const wa = local((s && s.whatsapp) || B.whatsapp || "0572646176");
    const calls = [].concat((s && s.phones) || B.phones || []).map(local).filter(Boolean);
    const link = p ? `${site()}p/${p.id}.html` : site();
    return { B, s, wa, calls, link };
  }

  // ---------------------------------------------------------------- calls to action (always one)
  function cta(p, o) {
    o = o || {};
    const f = facts(p), net = o.net || "fb";
    const link = inBio(net) ? "the link in our bio" : f.link;
    const call = f.calls[1] || f.calls[0] || f.wa;
    const it = p ? `the ${short(p).toLowerCase()}` : "yours";
    const list = [
      `📲 WhatsApp ${f.wa} now to order ${it}.`,
      `👉 Order today: WhatsApp ${f.wa} or tap ${link}`,
      `Don't wait, stock moves fast! Message ${f.wa} on WhatsApp to reserve ${it}.`,
      `📞 Call ${call} or WhatsApp ${f.wa}. We deliver across Accra.`,
      `Send "I want it" to ${f.wa} on WhatsApp and we'll sort the rest 🙌`,
      `Tap ${link} to see every photo, then WhatsApp ${f.wa} to order.`,
      `Comment "PRICE" or DM us, or WhatsApp ${f.wa} for a quick reply.`,
      `Ready to upgrade your space? WhatsApp ${f.wa} today ✅`,
      `Reserve ${it} with 50% now: WhatsApp ${f.wa}.`,
      `Save this post and share it with someone who needs it! Orders: WhatsApp ${f.wa}.`
    ];
    if (!f.s) list.push(`Visit our showroom at Odorkor (Tarazzo Road, opposite Pacific) or WhatsApp ${f.wa}.`, `Follow us for more and WhatsApp ${f.wa} to order 🛋️`);
    return pick(list);
  }

  // ---------------------------------------------------------------- hashtags
  // Our own tags + today's trending tags (data/trends.json, refreshed once a day by the backend
  // "trends" action with web search, kept only when safe and relevant for a home/furniture brand)
  // + audience tags so posts reach Ghanaians first, then expats in Ghana, Ghanaians abroad and
  // travellers to Ghana. X gets the fewest tags (2–3 work best there), trending tag first.
  const TAGS = {
    brand: ["#FAVisionEnterprise", "#FAVision"],
    home: ["#FurnitureGhana", "#AccraFurniture", "#GhanaFurniture", "#HomeDecorGhana", "#AccraHomes", "#InteriorDesignGhana", "#OdorkorAccra", "#HomeGoals", "#LivingRoomIdeas", "#FurnitureAccra"],
    tiktok: ["#fyp", "#foryou", "#ghanatiktok", "#accra", "#furniture", "#homedecor"],
    partner: ["#Ghana", "#Accra", "#GhanaBusiness", "#ShopGhana", "#BuyGhana"]
  };
  // Who we want to reach (always available, even before the first trend check).
  const AUDIENCE = {
    ghana: ["#Ghana", "#Accra", "#AccraGhana", "#GhanaToTheWorld", "#ShopGhana", "#Kasoa", "#Kumasi"],
    expats: ["#ExpatsInGhana", "#LivingInGhana", "#AccraExpats", "#MovingToGhana", "#ExpatLife"],
    diaspora: ["#GhanaDiaspora", "#GhanaiansAbroad", "#HomeInGhana", "#BuildingInGhana", "#ReturnToGhana"],
    travel: ["#VisitGhana", "#ExploreGhana", "#GhanaTravel", "#AccraTravel", "#Akwaaba"]
  };
  let TR = null;   // today's trends: { d, nets: { x, tiktok, instagram, facebook }, audiences: {...} }
  const okTag = t => /^#[\p{L}\p{N}_]{2,40}$/u.test(String(t || ""));
  const clean = a => [].concat(a || []).map(t => String(t).trim()).map(t => t.startsWith("#") ? t : "#" + t).filter(okTag);
  const NETKEY = { x: "x", tiktok: "tiktok", ig: "instagram", fb: "facebook", share: "facebook", youtube: "tiktok" };
  function trending(net) {
    if (!TR || !TR.nets) return [];
    return clean(TR.nets[NETKEY[net] || "x"]);
  }
  function audience(k) { return clean(((TR && TR.audiences) || {})[k]).concat(AUDIENCE[k]); }
  // Ghanaians first (half the time), the other three audiences take turns.
  function audienceTags(n) {
    const order = [Math.random() < 0.5 ? "ghana" : pick(["expats", "diaspora", "travel"])].concat(shuffle(["ghana", "expats", "diaspora", "travel"]));
    const out = [];
    for (const k of order) { if (out.length >= n) break; const t = shuffle(audience(k)).find(x => !out.includes(x)); if (t) out.push(t); }
    return out;
  }
  function tags(p, net, extra) {
    const s = p && p.seller;
    const tr = shuffle(trending(net));
    if (net === "fb" || net === "share") {
      if (Math.random() < 0.3) return "";
      return [...new Set(tr.slice(0, 1).concat(audienceTags(1), shuffle(s ? TAGS.partner : TAGS.home).slice(0, 1)))].join(" ");
    }
    if (net === "x") {   // trending first so it survives the 280-character trim
      return [...new Set(tr.slice(0, 1).concat(audienceTags(1), shuffle(s ? TAGS.partner : TAGS.home).slice(0, 1)))].join(" ");
    }
    const pool = s ? TAGS.partner : TAGS.home;
    const n = net === "youtube" ? 3 : 4;
    let t = shuffle(pool).slice(0, n).concat(tr.slice(0, 3), audienceTags(net === "youtube" ? 1 : 2));
    if (net === "tiktok") t = t.concat(shuffle(TAGS.tiktok).slice(0, 2));
    if (net === "youtube") t.unshift("#Shorts");
    if (!s) t.push(pick(TAGS.brand));
    if (extra) t = String(extra).split(/\s+/).filter(Boolean).slice(0, 4).concat(t);
    return [...new Set(t)].slice(0, net === "ig" ? 15 : 12).join(" ");
  }

  // ---------------------------------------------------------------- trends (data/trends.json)
  const TFILE = "data/trends.json";
  let refreshing = null;
  async function loadTrends(force) {
    const a = A(); if (!a) return TR;
    try { TR = await a.readJsonFile(TFILE, null); } catch (e) { TR = TR || null; }
    const day = new Date().toLocaleDateString("en-CA");
    if ((force || !TR || TR.d !== day) && a.backendSigned && !refreshing) {
      refreshing = (async () => {
        try {
          const r = await a.backendSigned({ action: "trends", day });
          if (r && r.ok && r.nets) {
            const next = { d: day, t: new Date().toISOString(), nets: {}, audiences: {}, topics: (r.topics || []).slice(0, 20), sources: (r.sources || []).slice(0, 10) };
            for (const k of ["x", "tiktok", "instagram", "facebook"]) next.nets[k] = clean(r.nets[k]).slice(0, 10);
            for (const k of ["ghana", "expats", "diaspora", "travel"]) next.audiences[k] = clean((r.audiences || {})[k]).slice(0, 8);
            await a.saveJson(TFILE, () => next, "Trends: today's hashtags", {});
            TR = next;
          } else if (force) throw new Error((r && r.error) || "no_trends");
        } finally { refreshing = null; }
      })();
      if (force) await refreshing; else refreshing.catch(() => null);
    }
    return TR;
  }

  // ---------------------------------------------------------------- random order that stays the same all day
  // dayRank("FAV-012") gives a number 0..1, different every day, the same all day (so plans don't jump on reload).
  function dayRank(key, day) {
    const str = (day || new Date().toLocaleDateString("en-CA")) + "|" + key;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  // Sort for the daily plans: anything not posted in the last `fresh` days comes first in a random
  // order (new every day); recently posted things wait at the back, oldest first.
  function dailyOrder(items, keyOf, lastOf, fresh) {
    const cut = new Date(Date.now() - (fresh || 7) * 864e5).toLocaleDateString("en-CA");
    const bucket = it => { const l = String(lastOf(it) || "").slice(0, 10); return !l || l < cut ? "" : l; };
    return items.slice().sort((a, b) => bucket(a).localeCompare(bucket(b)) || dayRank(keyOf(a)) - dayRank(keyOf(b)));
  }

  // ---------------------------------------------------------------- one product
  function product(p, o) {
    const f = facts(p), net = o.net || "fb", name = short(p);
    let price = money(p.price_ghs) + (p.negotiable ? pick([" (negotiable)", ", price negotiable", " (we can talk)"]) : "");
    if (p.id === "FAV-014") price += pick([" a set · GH₵640 each from 50 sets", " per set (GH₵640 each for 50+)"]);
    const head = o.ad && o.ad.headline ? `${o.ad.headline} ${o.ad.accent || ""}`.trim() : null;
    const emoji = pick(["🛋️", "🔥", "✨", "😍", "🏠", "💯", "👌"]);
    const hooks = [
      head && `${head} ${emoji}`,
      `${emoji} ${name} available now!`,
      `Looking for ${a_(name)}${name.toLowerCase()}? 👀`,
      `NEW IN STOCK: ${name}`,
      `Your space deserves this ${name.toLowerCase()} ${emoji}`,
      `POV: you just found the perfect ${name.toLowerCase()} ${emoji}`,
      `Just landed: ${name}`,
      `Quality you can see and feel: ${name}`,
      `${name} at a price that makes sense 💰`,
      `Upgrade alert 🚨 ${name}`,
      `Still searching for ${a_(name)}${name.toLowerCase()}? Stop here 👇`,
      p.custom_order ? `Made to order for you: ${name}` : `Ready to go: ${name}`
    ].filter(Boolean);
    if (f.s) hooks.push(`${name} from ${f.s.name} ${emoji}`);
    const hook = pick(hooks);
    const bullet = pick(["✔", "•", "✅", "👉", "▪️"]);
    const hl = shuffle(p.highlights || []).slice(0, net === "x" ? 1 : 2 + Math.floor(Math.random() * 2));
    const base = pick([p.description].concat(p.copy_variants || []).filter(Boolean)) || "";   // approved web texts (admin → Seek) rotate in
    const paras = String(base).split(/\n\s*\n/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    const sentences = (paras[0] || "").split(/(?<=[.!?])\s+/).filter(Boolean);
    const blurb = o.full ? (paras[0] || "").slice(0, 600) : sentences.slice(0, 1 + Math.floor(Math.random() * 2)).join(" ");
    const priceLine = pick([`💰 ${price}`, `Price: ${price}`, `Only ${price}`, `💵 ${price}`, `Going for ${price}`]);
    const place = f.s
      ? pick([`🏪 Sold by ${f.s.name}${f.s.address ? " · " + f.s.address : ""}`, `Sold by ${f.s.name}`])
      : pick(["📍 Showroom: Tarazzo Road, Odorkor (opposite Pacific), Accra", "📍 Odorkor, Accra · delivery available", "🚚 Delivery across Accra and beyond", "📍 Visit us at Odorkor, Accra. We deliver too.", "🚚 Fast delivery in Accra, Kasoa and beyond"]);
    const pay = f.s ? "" : pick(["💳 Pay 50% now and the rest on delivery (MoMo, GhanaPay or card).", "Pay 50% to book, balance on delivery.", "MoMo, GhanaPay or card accepted.", ""]);
    const extra = o.full ? [p.dimensions && `Size: ${p.dimensions}`, p.material && `Material: ${p.material}`, [].concat(p.colors || []).length && `Colours: ${[].concat(p.colors).join(", ")}`].filter(Boolean).join("\n") : "";
    const link = inBio(net) ? "" : pick([`👉 ${f.link}`, `See all photos: ${f.link}`, `More photos: ${f.link}`]);

    if (net === "x") {
      let t = [hook, `${name}: ${price}.`, hl[0] && hl[0] + ".", cta(p, o)].filter(Boolean).join(" ");
      if (!t.includes(f.link)) t += " " + f.link;
      const ROOM = 200;   // leave room for the "where are you seeing this from" ask (withAsk)
      if (t.length > ROOM) t = [hook, `${name}: ${price}.`, cta(p, o), f.link].join(" ");
      if (t.length > ROOM) t = `${name}: ${price}. WhatsApp ${f.wa} to order 👉 ${f.link}`;
      return xTags(t, p);
    }
    const body = shuffle([blurb, hl.map(h => `${bullet} ${h}`).join("\n")]).filter(Boolean);
    return [hook, "", ...body.flatMap(b => [b, ""]), priceLine, extra, place, pay, "", cta(p, o), link, "", tags(p, net, o.tags)].join("\n");
  }

  // X: add as many of the hashtags (trending one first) as fit in 200 characters, leaving room for the ask.
  function xTags(t, p) {
    const ROOM = 200;
    t = String(t).trim();
    if (t.length > ROOM) t = t.slice(0, ROOM).replace(/\s+\S*$/, "");
    const tg = tags(p, "x").split(" ").filter(Boolean);
    for (let k = tg.length; k > 0; k--) { const add = tg.slice(0, k).join(" "); if ((t + " " + add).length <= ROOM) return t + " " + add; }
    return t;
  }

  // ---------------------------------------------------------------- AI Studio and general (brand) posts
  function studio(o) {
    const net = o.net || "fb";
    const link = inBio(net) ? "link in bio" : site() + "studio/";
    if (net === "x") return xTags(`${pick(["See your room before you buy ✨", "Design your room free 🎨"])} Try F.A Vision AI Studio, then order only what you love. ${site()}studio/ ${cta(null, o)}`, null);
    return [
      pick(["See your room before you buy it ✨", "Design your dream room for FREE 🎨", "Not sure what fits your space? Try it first 👀", "Plan your room in minutes with AI ✨"]),
      "",
      pick(["Pick sofas, dining sets, wardrobes and wallpaper in the free F.A Vision AI Studio and see them in your space.", "Our free AI Studio shows our furniture and wallpaper in your own room before you spend a cedi.", "Try our furniture in your room first, and only order what you love."]),
      "",
      pick([`🔗 ${link}`, `Try it free: ${link}`]),
      cta(null, o),
      "",
      tags(null, net, o.tags)
    ].join("\n");
  }
  function general(o) {
    const net = o.net || "fb";
    const what = o.subject ? String(o.subject).trim() : "";
    if (net === "x") return xTags(`${what || pick(["Quality furniture for every home 🛋️", "New pieces in the showroom ✨"])} ${cta(null, o)} ${site()}`, null);
    return [
      what || pick(["Quality furniture for every home and office 🛋️", "Comfort, style and durability, at prices that make sense ✨", "Turning houses into homes across Accra 🏠", "Sofas, beds, dining sets, wardrobes and more 🔥"]),
      "",
      pick(["F.A Vision Enterprise sells quality, affordable furniture from our showroom in Odorkor, Accra.", "From living rooms to bedrooms and offices, we have pieces built to last.", "Every piece is checked before delivery, and we deliver across Accra and beyond."]),
      "",
      cta(null, o),
      inBio(net) ? "" : pick([`👉 ${site()}`, `Shop online: ${site()}`]),
      "",
      tags(null, net, o.tags)
    ].join("\n");
  }

  function tidy(t, net) {
    t = String(t).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (net === "tiktok") t = t.slice(0, 2000);
    if (net === "youtube") t = t.slice(0, 4900);
    return t;
  }
  // Engagement ask under every post: where are you seeing this from, then like, share and follow.
  const ASK_LINKS = " 👉 Page: facebook.com/FaVisionEnterprise · 🌐 Shop: favisionenterprize.github.io";
  function comment(net, kind) {
    const base = commentBase(net, kind);
    return net === "x" ? base : base + ASK_LINKS;
  }
  function commentBase(net, kind) {
    const what = kind || pick(["this", "this ad", "this post", "this video"]);
    const page = net === "x" ? "us" : pick(["our page", "the page", "F.A Vision Enterprise"]);
    if (net === "x") return pick([`📍 Where are you seeing ${what} from? Reply, then like, share & follow ${page}!`, `Where are you watching ${what} from? 👇 Like, share & follow ${page}!`, `📍 Tell us where you're seeing ${what} from, then like, share & follow!`]);
    return pick([
      `📍 Where are you seeing ${what} from? Tell us in the comments 👇 Then like, share and follow ${page} for more.`,
      `👀 Where are you watching ${what} from? Drop your town or city below, then hit like, share and follow ${page}!`,
      `Quick question: where are you seeing ${what} from? 🌍 Comment your location, then like, share and follow ${page} ❤️`,
      `Comment where you're watching ${what} from 📍 (Accra? Kasoa? Kumasi? abroad?) and don't forget to like, share and follow ${page}!`,
      `Which town are you seeing ${what} from? Let us know in the comments, then like 👍 share and follow ${page} for new arrivals.`
    ]);
  }
  // Put the ask after the call to action, before the hashtags (X: keep within 280 characters).
  function withAsk(t, net) {
    const ask = comment(net);
    if (net === "x") {
      if ((t + " " + ask).length <= 280) return t + " " + ask;
      const bare = t.replace(/(\s#\w+)+\s*$/, "");
      if ((bare + " " + ask).length <= 280) return bare + " " + ask;
      return bare.slice(0, 279 - ask.length).replace(/\s+\S*$/, "") + " " + ask;
    }
    const lines = t.split("\n");
    const last = lines[lines.length - 1] || "";
    if (/^#/.test(last.trim())) { lines.splice(lines.length - 1, 0, ask, ""); return lines.join("\n"); }
    return t + "\n\n" + ask;
  }
  function write(p, o) {
    o = o || {};
    let t = "";
    for (let i = 0; i < 6; i++) {
      t = tidy(withAsk(o.studio ? studio(o) : p ? product(p, o) : general(o), o.net), o.net);
      if (!recent.includes(t)) break;
    }
    recent.push(t); if (recent.length > 300) recent.shift();
    return t;
  }
  function title(p, o) {
    o = o || {};
    const sh = o.net === "youtube" ? " #Shorts" : "";
    if (!p && o.studio) return pick(["Design your room free before you buy", "See your room before you buy it ✨", "Free AI room designer in Ghana", "Try furniture in your room first"]) + sh;
    if (!p) return pick(["Quality furniture in Accra", "Inside F.A Vision Enterprise", "Furniture deals in Ghana", "Make your house a home", "New furniture, fair prices"]) + sh;
    const name = short(p), price = money(p.price_ghs);
    return pick([`${name} – ${price} in Ghana`, `${name} for ${price} 🔥`, `Look at this ${name.toLowerCase()} 😍`, `${name} | Furniture in Accra`, `${name}: worth ${price}?`, `${name} at F.A Vision, Odorkor`]).slice(0, 100 - sh.length) + sh;
  }
  window.FAV_CAPTIONS = { write, title, cta, tags, comment, loadTrends, trends: () => TR, trending, audienceTags, AUDIENCE, dayRank, dailyOrder };
})();
