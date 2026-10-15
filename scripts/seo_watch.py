#!/usr/bin/env python3
"""Nightly SEO & AI-visibility watch for F.A Vision Enterprise.

Writes data/seo-report.json, shown in the admin's "SEO & AI" screen (admin/seo.js):
  1. Own-site audit: every page in sitemap.xml plus the p/<ID>.html product pages, read
     from the repo files (= what GitHub Pages serves). Title, meta description, canonical,
     Open Graph, H1, image alt text, JSON-LD (FurnitureStore/LocalBusiness, Product, FAQPage),
     broken internal links, page weight, viewport, robots.txt, sitemap.xml, llms.txt.
     Score 0-100 + issues (severity, message, concrete fix). Fixes carry ready-made text
     built from data/business.json and data/products.json only, for the admin's "Apply fix".
  2. Keyword targets (data/seo-competitors.json "keywords"): which page targets each one.
  3. Competitor watch (data/seo-competitors.json "competitors"): public homepage + a few
     category pages each, robots.txt respected, one request every few seconds, our own
     User-Agent. Only SEO signals are stored (no text or images are copied).
  4. AI visibility: asks Gemini (GEMINI_API_KEY, Google Search grounding) or Claude
     (ANTHROPIC_API_KEY, web search) the "questions" and records who gets named.

    python3 scripts/seo_watch.py              # everything
    python3 scripts/seo_watch.py --no-net     # own-site audit + keywords only
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seo_build import SITE, cedis, local_phone, short  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/seo-report.json"
NOW = datetime.now(timezone.utc)
SEV_COST = {"high": 8, "medium": 4, "low": 1.5}
US = re.compile(r"F\.?\s?A\.?\s?Vision|favisionenterpri[sz]e", re.I)


def load(path, fallback=None):
    try:
        return json.loads((ROOT / path).read_text())
    except (OSError, ValueError):
        return fallback


# ------------------------------------------------------------------ HTML reading
class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.meta, self.links, self.imgs, self.scripts, self.css = "", {}, [], [], [], []
        self.h1, self.h2, self.jsonld, self.canonical, self.lang, self.refresh = [], [], [], "", "", False
        self.text, self._in, self._buf, self._skip = [], None, [], 0

    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == "html":
            self.lang = a.get("lang") or ""
        elif tag == "meta":
            k = (a.get("name") or a.get("property") or a.get("http-equiv") or "").lower()
            if k:
                self.meta[k] = a.get("content") or ""
            if k == "refresh":
                self.refresh = True
        elif tag == "link":
            rel = (a.get("rel") or "").lower()
            if rel == "canonical":
                self.canonical = a.get("href") or ""
            elif rel == "stylesheet" and a.get("href"):
                self.css.append(a["href"])
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "img":
            self.imgs.append({"src": a.get("src") or "", "alt": a.get("alt")})
        elif tag == "script":
            if a.get("src"):
                self.scripts.append(a["src"])
            if (a.get("type") or "").lower() == "application/ld+json":
                self._in, self._buf = "ld", []
            else:
                self._skip += 1
        elif tag == "style":
            self._skip += 1
        elif tag in ("h1", "h2", "title"):
            self._in, self._buf = tag, []

    def handle_endtag(self, tag):
        if tag == "script":
            if self._in == "ld":
                self.jsonld.append("".join(self._buf))
                self._in = None
            else:
                self._skip = max(0, self._skip - 1)
        elif tag == "style":
            self._skip = max(0, self._skip - 1)
        elif tag == self._in:
            t = re.sub(r"\s+", " ", "".join(self._buf)).strip()
            if tag == "title":
                self.title = t
            elif tag == "h1":
                self.h1.append(t)
            elif tag == "h2":
                self.h2.append(t)
            self._in = None

    def handle_data(self, data):
        if self._in:
            self._buf.append(data)
        if not self._skip and self._in != "ld":
            self.text.append(data)

    def schema_types(self):
        types, nodes = set(), []

        def walk(x):
            if isinstance(x, dict):
                t = x.get("@type")
                for tt in (t if isinstance(t, list) else [t]):
                    if tt:
                        types.add(tt)
                if t:
                    nodes.append(x)
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        for raw in self.jsonld:
            try:
                walk(json.loads(raw))
            except ValueError:
                types.add("INVALID_JSON")
        return types, nodes

    def body_text(self):
        return re.sub(r"\s+", " ", " ".join(self.text)).strip()


def parse(doc):
    p = Page()
    try:
        p.feed(doc)
    except Exception:  # noqa: BLE001  (broken markup: keep what was read)
        pass
    return p


# ------------------------------------------------------------------ own site
def local_path(url_or_href, base_rel):
    """Map a site URL or relative href to a repo file (None for other sites)."""
    u = url_or_href.split("#")[0].split("?")[0]
    if not u or u.startswith(("mailto:", "tel:", "javascript:", "data:", "sms:", "whatsapp:")):
        return None
    if re.match(r"^https?://", u):
        if not u.startswith(SITE):
            return None
        rel = u[len(SITE):]
    elif u.startswith("//"):
        return None
    elif u.startswith("/"):
        rel = u.lstrip("/")
    else:
        rel = urljoin("/" + base_rel, u).lstrip("/")
    if rel == "" or rel.endswith("/"):
        rel += "index.html"
    return rel


def own_pages():
    pages = []
    sm = ROOT / "sitemap.xml"
    locs = re.findall(r"<loc>([^<]+)</loc>", sm.read_text()) if sm.exists() else [SITE]
    for loc in locs:
        if "/p/FAV-" in loc:
            continue
        rel = local_path(loc, "")
        if rel and (ROOT / rel).exists():
            pages.append({"url": loc, "file": rel, "in_sitemap": True})
    listed = {p["file"] for p in pages}
    for extra in ("desks/index.html", "videos/index.html", "products/index.html", "tiktok/index.html", "studio/index.html"):
        if extra not in listed and (ROOT / extra).exists():
            pages.append({"url": SITE + extra.replace("index.html", ""), "file": extra, "in_sitemap": False})
    for f in sorted((ROOT / "p").glob("FAV-*.html")):
        rel = f"p/{f.name}"
        pages.append({"url": SITE + rel, "file": rel, "in_sitemap": SITE + rel in locs, "product": f.stem})
    return pages


def asset_bytes(refs, base_rel):
    total, n = 0, 0
    for r in refs:
        rel = local_path(r, base_rel)
        if rel and (ROOT / rel).is_file():
            total += (ROOT / rel).stat().st_size
            n += 1
    return total, n


def has_keyword(text, kw):
    words = [w for w in re.findall(r"[a-z0-9]+", kw.lower()) if w not in ("in", "the", "a", "price", "shop")]
    t = text.lower()
    return all(re.search(r"\b" + re.escape(w.rstrip("s")), t) for w in words)


def page_label(f):
    return {"index.html": "Home page"}.get(f, "/" + f.replace("index.html", ""))


def issue(issues, sev, page, check, msg, fix=None, count=1):
    issues.append({"id": f"{check}:{page}", "sev": sev, "page": page, "check": check, "msg": msg,
                   "count": count, **({"fix": fix} if fix else {})})


def product_for_image(src, products):
    key = src.split("?")[0].lstrip("./").replace("../", "")
    for p in products:
        if any(key.endswith(i) or i.endswith(key) for i in p.get("images") or []):
            return p
    return None


def alt_for(src, products, page):
    p = product_for_image(src, products)
    if p:
        return f"{short(p['name'])}, {cedis(p['price_ghs']) if p.get('price_ghs') else 'price on request'}, F.A Vision Enterprise Accra"
    name = re.sub(r"[-_]+", " ", Path(src.split("?")[0]).stem)
    name = re.sub(r"\b(fav \d+|\d+|[a-z0-9]{8})\b", "", name, flags=re.I).strip() or "furniture"
    return f"{name.capitalize()}, F.A Vision Enterprise furniture, Odorkor Accra"


def faq_items(biz, products):
    desk = next((p for p in products if p["id"] == "FAV-014"), None)
    locs = ", ".join(l.get("area") for l in biz.get("locations") or [])
    items = [
        {"q": "Where is F.A Vision Enterprise in Accra?",
         "a": f"Our main showroom is at {biz.get('address')}. We also have branches in {locs}."},
        {"q": "How do I order furniture from F.A Vision Enterprise?",
         "a": f"WhatsApp {local_phone(biz.get('whatsapp'))} or call {', '.join(local_phone(x) for x in biz.get('phones') or [])}. You can also order on {SITE}."},
        {"q": "Do you deliver furniture?", "a": biz.get("delivery_note") or "Yes, we deliver across Accra, Tema and Kasoa."},
    ]
    if desk:
        items.append({"q": "How much is a student desk in Ghana at F.A Vision?",
                      "a": f"Our {short(desk['name'])} is {cedis(desk['price_ghs'])} per set, GH₵640 each when you buy 50 or more."})
    pays = biz.get("payments")
    if pays:
        items.append({"q": "How can I pay?", "a": "We accept " + (", ".join(pays) if isinstance(pays, list) else str(pays)) + "."})
    return items


def audit_own(biz, products, cfg):
    issues, pages_out, parsed = [], [], {}
    pages = own_pages()
    wanted = {"FurnitureStore", "LocalBusiness", "HomeGoodsStore", "Store"}
    prod_pages = [p for p in pages if p.get("product")]
    redirects, no_product_ld, missing_links = [], [], {}
    for pg in pages:
        doc = (ROOT / pg["file"]).read_text(errors="replace")
        h = parse(doc)
        parsed[pg["file"]] = h
        types, nodes = h.schema_types()
        css_js = h.css + h.scripts
        img_b, img_n = asset_bytes([i["src"] for i in h.imgs], pg["file"])
        cj_b, cj_n = asset_bytes(css_js, pg["file"])
        weight = len(doc.encode()) + img_b + cj_b
        label = page_label(pg["file"])
        redirect = h.refresh or bool(re.search(r"location\.replace\(", doc))
        info = {"page": pg["file"], "label": label, "url": pg["url"], "title": h.title, "title_len": len(h.title),
                "description": h.meta.get("description", ""), "h1": h.h1[:2], "schema": sorted(types),
                "bytes": weight, "requests": 1 + img_n + cj_n, "redirect": redirect, "in_sitemap": pg["in_sitemap"]}
        pages_out.append(info)
        for href in h.links + [i["src"] for i in h.imgs] + css_js:
            rel = local_path(href, pg["file"])
            if rel and not (ROOT / rel).exists() and not rel.startswith(("admin/", "cdn-cgi/")):
                missing_links.setdefault(rel, set()).add(pg["file"])
        if pg.get("product"):
            if redirect:
                redirects.append(pg["file"])
            if "Product" not in types:
                no_product_ld.append(pg["file"])
            continue
        if redirect:
            if pg["in_sitemap"]:
                issue(issues, "medium", pg["file"], "redirect-in-sitemap", f"{label} only redirects to another page but is listed in sitemap.xml.")
            continue
        f = pg["file"]
        kw = (cfg.get("keywords") or ["furniture shop Accra"])[0]
        # title
        if not h.title:
            issue(issues, "high", f, "title", f"{label} has no <title>.", title_fix(f, biz, products))
        elif not (30 <= len(h.title) <= 65):
            issue(issues, "medium" if len(h.title) > 80 or len(h.title) < 20 else "low", f, "title",
                  f"{label} title is {len(h.title)} characters (aim for 30–65 so Google shows it in full).", title_fix(f, biz, products))
        d = h.meta.get("description", "")
        if not d:
            issue(issues, "high", f, "description", f"{label} has no meta description.", desc_fix(f, biz, products))
        elif not (70 <= len(d) <= 160):
            issue(issues, "low" if len(d) < 200 else "medium", f, "description",
                  f"{label} meta description is {len(d)} characters (aim for 70–160).", desc_fix(f, biz, products))
        if not h.canonical:
            issue(issues, "medium", f, "canonical", f"{label} has no canonical link.")
        elif "#" in h.canonical:
            issue(issues, "medium", f, "canonical", f"{label} canonical points at a #hash URL ({h.canonical}); Google ignores the part after #.")
        if not h.meta.get("viewport"):
            issue(issues, "high", f, "viewport", f"{label} has no mobile viewport tag.")
        if not h.lang:
            issue(issues, "low", f, "lang", f"{label} has no <html lang>.")
        missing_og = [k for k in ("og:title", "og:description", "og:image") if not h.meta.get(k)]
        if missing_og:
            issue(issues, "low", f, "og", f"{label} is missing {', '.join(missing_og)} (link previews on WhatsApp/Facebook).")
        if not h.h1:
            issue(issues, "medium", f, "h1", f"{label} has no H1 heading.", intro_fix(f, kw, biz, products, "h1"))
        elif len(h.h1) > 1:
            issue(issues, "low", f, "h1", f"{label} has {len(h.h1)} H1 headings (one is best).")
        no_alt = [i["src"] for i in h.imgs if not (i["alt"] or "").strip() and i["src"]]
        if no_alt:
            issue(issues, "medium" if len(no_alt) > 2 else "low", f, "alt", f"{label}: {len(no_alt)} image(s) without alt text.",
                  {"kind": "alt", "page": f, "label": "Add alt text", "value": {s.split("?")[0]: alt_for(s, products, f) for s in no_alt[:40]}},
                  count=len(no_alt))
        if "INVALID_JSON" in types:
            issue(issues, "high", f, "jsonld-invalid", f"{label} has a JSON-LD block that isn't valid JSON.")
        if weight > 3_000_000:
            issue(issues, "high", f, "weight", f"{label} weighs {weight / 1e6:.1f} MB (images + scripts). Aim for under 1.5 MB on mobile data.")
        elif weight > 1_500_000:
            issue(issues, "medium", f, "weight", f"{label} weighs {weight / 1e6:.1f} MB. Compress the biggest images or lazy-load them.")
        if "noindex" in (h.meta.get("robots") or ""):
            issue(issues, "high", f, "noindex", f"{label} tells Google not to index it (noindex).")
        if not pg["in_sitemap"]:
            issue(issues, "low", f, "sitemap-page", f"{label} isn't in sitemap.xml.")
        if f == "index.html":
            biz_nodes = [n for n in nodes if set(n.get("@type") if isinstance(n.get("@type"), list) else [n.get("@type")]) & wanted]
            if not biz_nodes:
                issue(issues, "high", f, "jsonld-business", "Home page has no LocalBusiness / FurnitureStore JSON-LD.",
                      {"kind": "jsonld", "page": f, "label": "Add FurnitureStore schema", "value": store_jsonld(biz)})
            else:
                n = biz_nodes[0]
                miss = [k for k in ("address", "geo", "telephone", "openingHoursSpecification") if not n.get(k)]
                if miss:
                    issue(issues, "medium", f, "jsonld-business", f"FurnitureStore schema is missing {', '.join(miss)}.",
                          {"kind": "jsonld", "page": f, "label": "Add full FurnitureStore schema", "value": store_jsonld(biz)})
            if "FAQPage" not in types:
                issue(issues, "medium", f, "faq", "Home page has no FAQ (AI answers and Google love Q&A).",
                      {"kind": "faq", "page": f, "label": "Add FAQ block", "value": faq_items(biz, products)})
            same = []   # all Organization nodes (an applied fix adds a second node with the same @id)
            for n in nodes:
                if n.get("@type") == "Organization":
                    same += [u for u in (n.get("sameAs") or []) if u not in same]
            socials = [u for u in social_urls(biz) if u not in same]
            if socials:
                issue(issues, "medium", f, "sameas", f"Organization schema doesn't link {len(socials)} of your profiles (Instagram, TikTok, X, Google Maps). AI engines use these links to recognise the business.",
                      {"kind": "jsonld", "page": f, "label": "Link all profiles", "value": {"@context": "https://schema.org", "@type": "Organization", "@id": SITE + "#org", "sameAs": same + socials}})
        if f == "products/index.html" and "ItemList" not in types:
            issue(issues, "medium", f, "jsonld-itemlist", "Products page has no ItemList schema listing the products.",
                  {"kind": "jsonld", "page": f, "label": "Add product list schema", "value": itemlist_jsonld(products)})
    if redirects:
        issue(issues, "high", "p/", "product-pages", f"{len(redirects)} product pages (p/FAV-xxx.html) redirect straight to the home page, so Google and AI engines can't index a single product page. Competitors like Kpogas have their own indexable product and category pages.",
              {"kind": "product_landing", "page": "p/", "label": "Make real product pages",
               "value": "Each p/FAV-xxx.html becomes a real page: name, price, photos, highlights, Order on WhatsApp, See it in our shop, Product + Breadcrumb schema, self canonical, added to sitemap.xml. Share links keep the same preview card."},
              count=len(redirects))
    if no_product_ld:
        issue(issues, "medium", "p/", "jsonld-product", f"{len(no_product_ld)} product pages have no Product schema (price in GHS, availability). The next build adds it.", count=len(no_product_ld))
    for rel, srcs in sorted(missing_links.items())[:30]:
        issue(issues, "medium", sorted(srcs)[0], "broken-link", f"Broken internal link: /{rel} (on {', '.join(sorted(srcs)[:3])}).")
    # site files
    robots = (ROOT / "robots.txt").read_text() if (ROOT / "robots.txt").exists() else ""
    if not robots:
        issue(issues, "high", "robots.txt", "robots", "No robots.txt.")
    elif "sitemap:" not in robots.lower():
        issue(issues, "low", "robots.txt", "robots", "robots.txt doesn't point to sitemap.xml.")
    if re.search(r"^Disallow:\s*/\s*$", robots, re.M):
        issue(issues, "high", "robots.txt", "robots", "robots.txt blocks the whole site.")
    sm = (ROOT / "sitemap.xml").read_text() if (ROOT / "sitemap.xml").exists() else ""
    n_sm = len(re.findall(r"<loc>", sm))
    if not sm:
        issue(issues, "high", "sitemap.xml", "sitemap", "No sitemap.xml.")
    elif n_sm < 10:
        issue(issues, "medium", "sitemap.xml", "sitemap", f"sitemap.xml lists only {n_sm} URLs; none of your {len(prod_pages)} products has its own URL in it.")
    if not (ROOT / "llms.txt").exists():
        issue(issues, "low", "llms.txt", "llms", "No /llms.txt: a short plain-text fact sheet (address, phones, products, prices) that AI search tools can read.",
              {"kind": "llms", "page": "llms.txt", "label": "Create llms.txt", "value": "Business facts, 3 branches with map links, every product with price and link."})
    return issues, pages_out, parsed, {"robots": bool(robots), "robots_sitemap": "sitemap:" in robots.lower(),
                                       "sitemap_urls": n_sm, "llms": (ROOT / "llms.txt").exists(),
                                       "product_pages": len(prod_pages), "product_pages_indexable": len(prod_pages) - len(redirects)}


def social_urls(biz):
    out = list(biz.get("facebook_pages") or []) if isinstance(biz.get("facebook_pages"), list) else []
    out = [x.get("url") if isinstance(x, dict) else x for x in out]
    out += ["https://www.instagram.com/favisionent/", "https://x.com/FaVisionEnt", "https://www.tiktok.com/@favisionenterprise"]
    out += [l["maps_url"] for l in biz.get("locations") or [] if l.get("maps_url")]
    return [u for u in out if u]


def store_jsonld(biz):
    loc = (biz.get("locations") or [{}])[0]
    return {"@context": "https://schema.org", "@type": "FurnitureStore", "@id": SITE + "#odorkor", "name": biz.get("name"),
            "url": SITE, "image": SITE + "assets/images/og-cover.jpg", "telephone": (biz.get("phones") or [None])[0],
            "priceRange": "GH₵", "address": {"@type": "PostalAddress", "streetAddress": "Tarazzo Road, opposite Pacific",
                                             "addressLocality": "Odorkor, Accra", "addressRegion": "Greater Accra", "addressCountry": "GH"},
            "geo": {"@type": "GeoCoordinates", "latitude": loc.get("lat"), "longitude": loc.get("lng")}, "hasMap": loc.get("maps_url"),
            "areaServed": ["Accra", "Tema", "Kasoa"]}


def itemlist_jsonld(products):
    ready = [p for p in products if not p.get("placeholder") and p.get("price_ghs") and (ROOT / f"p/{p['id']}.html").exists()]
    return {"@context": "https://schema.org", "@type": "ItemList", "name": "F.A Vision Enterprise furniture",
            "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{SITE}p/{p['id']}.html", "name": short(p["name"])}
                                for i, p in enumerate(ready)]}


def title_fix(f, biz, products):
    t = {"index.html": "Furniture Shop in Accra · Sofas, Desks & Office Chairs | F.A Vision",
         "products/index.html": "Furniture Prices in Accra · All Products | F.A Vision Enterprise",
         "tiktok/index.html": "Shop Our TikTok Furniture Deals · Accra | F.A Vision",
         "studio/index.html": "Photo Studio & Ads · F.A Vision Enterprise, Accra",
         "videos/index.html": "Furniture Videos · F.A Vision Enterprise, Accra"}.get(f)
    return {"kind": "title", "page": f, "label": "Rewrite title", "value": t or f"{page_label(f).strip('/').title()} · F.A Vision Enterprise, Accra"}


def desc_fix(f, biz, products):
    desk = next((p for p in products if p["id"] == "FAV-014"), None)
    base = (f"We sell sofas, beds, dining sets, office chairs and student desks{' from ' + cedis(desk['price_ghs']) if desk else ''} "
            f"in Odorkor, Accra. Delivery to Accra, Tema & Kasoa. WhatsApp {local_phone(biz.get('whatsapp'))}.")
    return {"kind": "description", "page": f, "label": "Rewrite meta description", "value": base[:160]}


def intro_fix(f, kw, biz, products, why="keyword"):
    words = set(re.findall(r"[a-z]+", kw.lower()))
    match = [p for p in products if not p.get("placeholder") and p.get("price_ghs") and not p.get("seller")
             and words & set(re.findall(r"[a-z]+", f"{p.get('name')} {p.get('type')} {p.get('category')}".lower().rstrip("s")))]
    match = [p for p in match if words & set(w.rstrip("s") for w in re.findall(r"[a-z]+", f"{p.get('name')} {p.get('type')} {p.get('category')}".lower()))] or match
    eg = ", ".join(f"{short(p['name'])} {cedis(p['price_ghs'])}" for p in match[:2])
    text = (f"Looking for {kw}? F.A Vision Enterprise sells {('furniture such as ' + eg) if eg else 'home, office and school furniture'} "
            f"from our showroom at Tarazzo Road, Odorkor, with delivery across Accra, Tema & Kasoa. WhatsApp {local_phone(biz.get('whatsapp'))}.")
    return {"kind": "intro", "page": f, "label": "Add keyword intro line", "value": text, "keyword": kw}


# ------------------------------------------------------------------ keywords
def keyword_coverage(cfg, pages, parsed, biz, products):
    out = []
    for kw in cfg.get("keywords") or []:
        best, best_score, where = None, 0, []
        for info in pages:
            h = parsed.get(info["page"])
            if not h or (info["redirect"] and not info["page"].startswith("p/")):
                continue
            s, w = 0, []
            if has_keyword(h.title, kw):
                s += 3; w.append("title")
            if any(has_keyword(x, kw) for x in h.h1):
                s += 2; w.append("H1")
            if has_keyword(h.meta.get("description", ""), kw):
                s += 1; w.append("description")
            if not info["redirect"] and has_keyword(h.body_text(), kw):
                s += 1; w.append("text")
            if info["redirect"]:
                s = min(s, 1)   # a redirect page can't rank
            if s > best_score:
                best, best_score, where = info["page"], s, w
        target = suggest_page(kw, products)
        item = {"keyword": kw, "score": best_score, "covered": best_score >= 4, "best_page": best, "where": where, "suggest": target}
        if best_score < 4:
            item["fix"] = intro_fix(target if not target.startswith("p/") else "products/index.html", kw, biz, products)
            item["fix"]["id"] = "intro:" + re.sub(r"[^a-z0-9]+", "-", kw.lower())
        out.append(item)
    return out


def suggest_page(kw, products):
    k = kw.lower()
    if any(w in k for w in ("desk", "school", "student")):
        return "products/index.html"
    if "shop" in k or "wholesale" in k or "odorkor" in k or "kasoa" in k:
        return "index.html"
    return "products/index.html"


# ------------------------------------------------------------------ competitors
def fetch(url, ua, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "text/html,*/*"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read(3_000_000)
        return r.geturl(), r.status, body.decode(r.headers.get_content_charset() or "utf-8", "replace"), time.time() - t


def page_signals(url, doc, secs, keywords):
    h = parse(doc)
    types, _ = h.schema_types()
    text = h.body_text()
    imgs = len(h.imgs)
    return {
        "url": url, "title": bool(h.title), "title_len": len(h.title), "description": bool(h.meta.get("description")),
        "h1": len(h.h1), "og": bool(h.meta.get("og:title") and h.meta.get("og:image")), "canonical": bool(h.canonical),
        "viewport": bool(h.meta.get("viewport")), "schema": sorted(t for t in types if t != "INVALID_JSON"),
        "phone": bool(re.search(r"(\+233|\b0)[235]\d[\s-]?\d{3}[\s-]?\d{4}", text)), "accra": "accra" in text.lower(),
        "whatsapp": "wa.me" in doc or "whatsapp" in doc.lower(), "blog": bool(re.search(r'href="[^"]*/(blog|news|articles?)/', doc, re.I)),
        "faq": bool(re.search(r"\bFAQ|frequently asked", doc, re.I)), "kb": round(len(doc.encode()) / 1024),
        "requests": 1 + imgs + len(h.scripts) + len(h.css), "img_no_alt": sum(1 for i in h.imgs if not (i["alt"] or "").strip()),
        "secs": round(secs, 1), "keywords": [k for k in keywords if has_keyword(h.title + " " + " ".join(h.h1), k)],
    }


def category_links(base, doc):
    h = parse(doc)
    host = urlparse(base).netloc
    seen, out = set(), []
    for href in h.links:
        u = urljoin(base, href).split("#")[0]
        if urlparse(u).netloc != host or u in seen or u.rstrip("/") == base.rstrip("/"):
            continue
        if re.search(r"/(product-category|category|collections?|shop|sofa|bed|office|dining|chair|furniture|living|bedroom)", u, re.I) \
                and not re.search(r"\.(jpg|png|pdf)$|add-to-cart|cart|account|login|wp-admin|\?", u, re.I):
            seen.add(u)
            out.append(u)
    return out


def watch_competitors(cfg):
    ua = cfg.get("user_agent") or "FAVisionSEOWatch/1.0"
    delay = float(cfg.get("delay_seconds") or 3)
    keywords = cfg.get("keywords") or []
    res = []
    for c in cfg.get("competitors") or []:
        item = {"name": c.get("name"), "url": c.get("url"), "status": "ok", "pages": []}
        res.append(item)
        if not c.get("url"):
            item["status"] = "no website set"
            continue
        try:
            rp = urllib.robotparser.RobotFileParser()
            try:
                _, _, rtxt, _ = fetch(urljoin(c["url"], "/robots.txt"), ua, 15)
                rp.parse(rtxt.splitlines())
                item["sitemap"] = "sitemap:" in rtxt.lower()
            except Exception:  # noqa: BLE001  (no robots.txt = allowed)
                rp.parse([])
                item["sitemap"] = None
            if not rp.can_fetch(ua, c["url"]):
                item["status"] = "robots.txt asks bots not to read it: skipped"
                continue
            time.sleep(delay)
            final, code, doc, secs = fetch(c["url"], ua)
            item["https"] = final.startswith("https://")
            item["pages"].append(page_signals(final, doc, secs, keywords))
            for u in category_links(final, doc)[: int(cfg.get("pages_per_competitor") or 3)]:
                if not rp.can_fetch(ua, u):
                    continue
                time.sleep(delay)
                try:
                    f2, _, d2, s2 = fetch(u, ua)
                    item["pages"].append(page_signals(f2, d2, s2, keywords))
                except Exception as e:  # noqa: BLE001
                    item.setdefault("errors", []).append(f"{u}: {str(e)[:80]}")
        except urllib.error.HTTPError as e:
            item["status"] = f"HTTP {e.code}"
        except Exception as e:  # noqa: BLE001
            item["status"] = "unreachable: " + str(getattr(e, "reason", e))[:100]
    return res


def gaps(comps, own, our_site, keywords_cov):
    ok = [c for c in comps if c["pages"]]
    if not ok:
        return {"they_do": [], "we_beat": []}
    home = next((p for p in own if p["page"] == "index.html"), {})
    our_types = set(home.get("schema") or [])
    they, beat = [], []

    def who(fn):
        return [c["name"] for c in ok if fn(c)]

    product_schema = who(lambda c: any("Product" in p["schema"] for p in c["pages"]))
    if product_schema and not our_site["product_pages_indexable"]:
        they.append({"what": "Indexable product pages with Product schema (price, stock)", "who": product_schema,
                     "fix": "Apply “Make real product pages” in Top issues."})
    cats = who(lambda c: len(c["pages"]) > 1)
    if cats:
        they.append({"what": "Separate category pages (sofas, beds, office…) that Google can rank one by one", "who": cats,
                     "fix": "Our shop filters live behind #hash links. Product pages + the Products page ItemList are the first step."})
    for key, label, fix in (("blog", "A blog / news section that brings search traffic", "Post a short guide each month, e.g. “How to choose a student desk” (we can add a /guides/ page)."),
                            ("breadcrumb", "Breadcrumb schema", "Comes with real product pages."),
                            ("rating", "Review stars (AggregateRating) in Google results", "Ask happy customers for Google Maps reviews; only real reviews can go in schema.")):
        if key == "blog":
            w = who(lambda c: any(p["blog"] for p in c["pages"]))
        elif key == "breadcrumb":
            w = who(lambda c: any("BreadcrumbList" in p["schema"] for p in c["pages"]))
            if "BreadcrumbList" in our_types or our_site["product_pages_indexable"]:
                w = []
        else:
            w = who(lambda c: any("AggregateRating" in p["schema"] or "Review" in p["schema"] for p in c["pages"]))
        if w:
            they.append({"what": label, "who": w, "fix": fix})
    for c in ok:
        hp = c["pages"][0]
        weak = []
        if not hp["description"]:
            weak.append("no meta description")
        if not ({"FurnitureStore", "LocalBusiness", "Store", "HomeGoodsStore"} & set(hp["schema"])):
            weak.append("no LocalBusiness schema (address/phone for Google Maps & AI)")
        if not hp["faq"]:
            weak.append("no FAQ")
        if not hp["h1"]:
            weak.append("no H1")
        if not hp["og"]:
            weak.append("no link-preview tags")
        if hp["kb"] > 300 or hp["requests"] > 80:
            weak.append(f"heavy home page ({hp['kb']} KB HTML, {hp['requests']} files)")
        if hp["img_no_alt"] > 5:
            weak.append(f"{hp['img_no_alt']} images without alt text")
        if not hp["phone"]:
            weak.append("no phone number on the home page")
        if not hp["keywords"]:
            weak.append("targets none of our keywords in title/H1")
        if weak:
            beat.append({"who": c["name"], "weak": weak})
    uncovered = [k["keyword"] for k in keywords_cov if not any(k["keyword"] in p.get("keywords", []) for c in ok for p in c["pages"])]
    if uncovered:
        beat.append({"who": "Nobody", "weak": ["No competitor targets: " + ", ".join(uncovered) + ". Own these first."]})
    return {"they_do": they, "we_beat": beat}


# ------------------------------------------------------------------ AI visibility
def ask_ai(q):
    prompt = (f"{q} Answer like a helpful local guide in Ghana: name specific businesses (with their website if you know it) "
              "and say briefly why. Keep it under 200 words.")
    gk, ak = os.environ.get("GEMINI_API_KEY"), os.environ.get("ANTHROPIC_API_KEY")
    if gk:
        model = os.environ.get("GEMINI_MODEL") or "gemini-flash-latest"
        body = {"contents": [{"parts": [{"text": prompt}]}], "tools": [{"google_search": {}}]}
        req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gk}",
                                     data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.loads(r.read())
        cand = (d.get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []))
        srcs = [c.get("web", {}).get("title") or c.get("web", {}).get("uri") for c in (cand.get("groundingMetadata") or {}).get("groundingChunks", [])]
        return "gemini", text, [s for s in srcs if s]
    if ak:
        model = os.environ.get("CLAUDE_MODEL") or "claude-haiku-4-5-20251001"
        body = {"model": model, "max_tokens": 1024, "messages": [{"role": "user", "content": prompt}],
                "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]}
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "x-api-key": ak, "anthropic-version": "2023-06-01"})
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read())
        text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
        srcs = []
        for b in d.get("content", []):
            if b.get("type") == "web_search_tool_result" and isinstance(b.get("content"), list):
                srcs += [x.get("url") for x in b["content"] if x.get("url")]
        return "claude", text, srcs[:8]
    return None, "", []


def ai_visibility(cfg):
    if not (os.environ.get("GEMINI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")):
        return {"status": "no_key", "help": "Add GEMINI_API_KEY (free at aistudio.google.com) or ANTHROPIC_API_KEY in GitHub → repo Settings → Secrets and variables → Actions → New repository secret."}
    names = [(c["name"], re.compile(re.escape(c["name"].split()[0]), re.I)) for c in cfg.get("competitors") or []]
    results, provider = [], None
    for q in cfg.get("questions") or []:
        try:
            provider, text, srcs = ask_ai(q)
            results.append({"q": q, "us": bool(US.search(text) or any(US.search(s or "") for s in srcs)),
                            "competitors": [n for n, rx in names if rx.search(text)],
                            "answer": text[:600], "sources": srcs[:6]})
        except Exception as e:  # noqa: BLE001
            results.append({"q": q, "error": str(e)[:160]})
        time.sleep(2)
    ok = [r for r in results if "error" not in r]
    return {"status": "ok" if ok else "error", "provider": provider, "results": results,
            "share": round(100 * sum(r["us"] for r in ok) / len(ok)) if ok else 0}


# ------------------------------------------------------------------ main
def main():
    no_net = "--no-net" in sys.argv
    biz = load("data/business.json", {})
    products = load("data/products.json", [])
    cfg = load("data/seo-competitors.json", {})
    prev = load("data/seo-report.json", {}) or {}
    applied = {f.get("id") for f in (load("data/seo-fixes.json", {}) or {}).get("applied", [])}

    issues, pages, parsed, site = audit_own(biz, products, cfg)
    for i in issues:
        if i.get("fix"):
            i["fix"].setdefault("id", i["fix"]["kind"] + ":" + i["page"])
            i["fix"]["applied"] = i["fix"]["id"] in applied
    cost = {}
    for i in issues:   # one check can't sink the whole score: cap each check at 3 issues' worth
        k = i["check"]
        cost[k] = min(cost.get(k, 0) + SEV_COST[i["sev"]], 3 * SEV_COST[i["sev"]])
    score = max(0, round(100 - sum(cost.values())))
    order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda i: (order[i["sev"]], -i.get("count", 1)))
    kw = keyword_coverage(cfg, pages, parsed, biz, products)
    for k in kw:
        if k.get("fix"):
            k["fix"]["applied"] = k["fix"]["id"] in applied

    if no_net:
        comps = (prev.get("competitors") or {}).get("list") or []
        comp_status = "pending" if not comps else (prev.get("competitors") or {}).get("status", "ok")
        ai = prev.get("ai") or {"status": "pending"}
    else:
        comps = watch_competitors(cfg)
        comp_status = "ok" if any(c["pages"] for c in comps) else "unreachable"
        ai = ai_visibility(cfg)
    history = [h for h in (prev.get("history") or []) if h.get("d") != NOW.strftime("%Y-%m-%d")][-59:]
    history.append({"d": NOW.strftime("%Y-%m-%d"), "score": score, "ai": ai.get("share")})
    report = {
        "generated": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"), "mode": "local" if no_net else "full",
        "score": score, "prev_score": prev.get("score"),
        "counts": {s: sum(1 for i in issues if i["sev"] == s) for s in ("high", "medium", "low")},
        "site": site, "issues": issues, "pages": pages, "keywords": kw,
        "competitors": {"status": comp_status, "list": comps, "gaps": gaps(comps, pages, site, kw)},
        "ai": ai, "history": history,
    }
    OUT.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    print(f"SEO score {score}/100 · {len(issues)} issues · competitors {comp_status} · AI {ai.get('status')}")


if __name__ == "__main__":
    main()
