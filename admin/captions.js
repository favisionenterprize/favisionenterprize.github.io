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
  const TAGS = {
    brand: ["#FAVisionEnterprise", "#FAVision"],
    home: ["#FurnitureGhana", "#AccraFurniture", "#GhanaFurniture", "#HomeDecorGhana", "#AccraHomes", "#InteriorDesignGhana", "#OdorkorAccra", "#HomeGoals", "#LivingRoomIdeas", "#FurnitureAccra"],
    tiktok: ["#fyp", "#foryou", "#ghanatiktok", "#accra", "#furniture", "#homedecor"],
    partner: ["#Ghana", "#Accra", "#GhanaBusiness", "#ShopGhana", "#BuyGhana"]
  };
  function tags(p, net, extra) {
    if (net === "fb" || net === "share") return pick([0, 1]) ? "" : shuffle(TAGS.home).slice(0, 2).join(" ");
    const s = p && p.seller;
    const pool = s ? TAGS.partner : TAGS.home;
    const n = net === "x" ? 2 : net === "youtube" ? 4 : 5;
    let t = shuffle(pool).slice(0, n);
    if (net === "tiktok") t = t.concat(shuffle(TAGS.tiktok).slice(0, 3));
    if (net === "youtube") t.unshift("#Shorts");
    if (!s) t.push(pick(TAGS.brand));
    if (extra) t = String(extra).split(/\s+/).filter(Boolean).slice(0, 4).concat(t);
    return [...new Set(t)].join(" ");
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
      const tg = tags(p, "x");
      if ((t + " " + tg).length <= 280) t += " " + tg;
      return t.length <= 280 ? t : `${name}: ${price}. WhatsApp ${f.wa} to order 👉 ${f.link}`.slice(0, 280);
    }
    const body = shuffle([blurb, hl.map(h => `${bullet} ${h}`).join("\n")]).filter(Boolean);
    return [hook, "", ...body.flatMap(b => [b, ""]), priceLine, extra, place, pay, "", cta(p, o), link, "", tags(p, net, o.tags)].join("\n");
  }

  // ---------------------------------------------------------------- AI Studio and general (brand) posts
  function studio(o) {
    const net = o.net || "fb";
    const link = inBio(net) ? "link in bio" : site() + "studio/";
    if (net === "x") return `${pick(["See your room before you buy ✨", "Design your room free 🎨"])} Try F.A Vision AI Studio, then order only what you love. ${site()}studio/ ${cta(null, o)}`.slice(0, 280);
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
    if (net === "x") return `${what || pick(["Quality furniture for every home 🛋️", "New pieces in the showroom ✨"])} ${cta(null, o)} ${site()}`.slice(0, 280);
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
  function write(p, o) {
    o = o || {};
    let t = "";
    for (let i = 0; i < 6; i++) {
      t = tidy(o.studio ? studio(o) : p ? product(p, o) : general(o), o.net);
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
  window.FAV_CAPTIONS = { write, title, cta, tags };
})();
