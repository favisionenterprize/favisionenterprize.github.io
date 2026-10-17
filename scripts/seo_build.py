#!/usr/bin/env python3
"""Put the SEO fixes into the website's pages at build time.

The admin's "SEO & AI" screen never edits HTML itself: "Apply fix" saves the fix in
data/seo-fixes.json (an allowed admin write path), and this script writes it into the
pages. Run by .github/workflows/seo-fixes.yml (on data/seo-fixes.json pushes) and by
rebuild-ads.yml right after make_share_cards.py (which rewrites p/*.html).

Always (quick wins, from our own product facts only):
  - Product JSON-LD (price in GHS, availability, brand/seller) on every p/<ID>.html
Applied fixes (data/seo-fixes.json "applied"), each {id, kind, page, value}:
  title, description  replace <title> / <meta name=description> on that page
  jsonld              add one <script type=application/ld+json> block
  alt                 {src: alt text} for images without alt text
  faq                 [{q, a}] visible FAQ block + FAQPage JSON-LD
  intro               one keyword-targeted intro line after the page's <h1>
  product_landing     turn p/<ID>.html from instant redirects into real, indexable
                      product pages (self canonical, listed in sitemap.xml)
  llms                write /llms.txt (plain-text facts for AI search engines)

Idempotent: every injected block sits between <!--seo:ID--> markers and is replaced
on the next run.   python3 scripts/seo_build.py [--check]
"""
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://favisionenterprize.github.io/"
FIXES = ROOT / "data/seo-fixes.json"


def load(path, fallback=None):
    try:
        return json.loads((ROOT / path).read_text())
    except (OSError, ValueError):
        return fallback


def cedis(n):
    return "GH₵" + f"{int(n):,}"


def local_phone(num):
    d = re.sub(r"\D", "", str(num or ""))
    if d.startswith("233"):
        d = "0" + d[3:]
    return f"{d[:3]} {d[3:6]} {d[6:]}" if len(d) == 10 else d


def short(name):
    return str(name).split(" — ")[0].strip()


def abs_url(path):
    return path if re.match(r"^https?:", str(path)) else SITE + str(path).lstrip("/")


def availability(p):
    return "https://schema.org/InStock" if p.get("in_stock") else "https://schema.org/PreOrder"


def product_jsonld(p, biz):
    seller = p.get("seller") or {}
    d = {
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": f"{SITE}p/{p['id']}.html#product",
        "name": short(p["name"]),
        "sku": p["id"],
        "description": p.get("description") or " · ".join(p.get("highlights") or []),
        "image": [abs_url(i) for i in (p.get("images") or [])[:5]],
        "brand": {"@type": "Brand", "name": seller.get("name") or biz.get("name", "F.A Vision Enterprise")},
        "category": p.get("category") or p.get("type") or "Furniture",
        "itemCondition": "https://schema.org/NewCondition",
        "url": f"{SITE}p/{p['id']}.html",
    }
    if p.get("material"):
        d["material"] = p["material"]
    if p.get("colors"):
        d["color"] = ", ".join(p["colors"])
    if p.get("price_ghs"):
        d["offers"] = {
            "@type": "Offer",
            "price": f"{float(p['price_ghs']):.2f}",
            "priceCurrency": "GHS",
            "availability": availability(p),
            "url": f"{SITE}p/{p['id']}.html",
            "areaServed": "GH",
            "seller": {"@type": "Organization", "name": seller.get("name")} if seller else {"@id": SITE + "#org"},
        }
    return d


def breadcrumb_jsonld(p):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE},
        {"@type": "ListItem", "position": 2, "name": "Products", "item": SITE + "products/"},
        {"@type": "ListItem", "position": 3, "name": short(p["name"]), "item": f"{SITE}p/{p['id']}.html"}]}


def ld_script(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace("</", "<\\/") + "</script>"


def block(key, content):
    return f"<!--seo:{key}-->{content}<!--/seo:{key}-->"


def put_block(doc, key, content, where="</head>"):
    """Insert or replace the marked block `key`. `where` = tag to insert before (or after, for '</h1>')."""
    doc = re.sub(rf"<!--seo:{re.escape(key)}-->.*?<!--/seo:{re.escape(key)}-->\n?", "", doc, flags=re.S)
    if content is None:
        return doc
    b = block(key, content)
    i = doc.lower().find(where.lower())
    if i < 0:
        return doc
    if where.lower() == "</h1>":
        i += len(where)
        return doc[:i] + "\n" + b + doc[i:]
    return doc[:i] + b + "\n" + doc[i:]


def set_title(doc, text):
    t = html.escape(text, quote=False)
    if re.search(r"<title>.*?</title>", doc, re.S):
        return re.sub(r"<title>.*?</title>", lambda m: f"<title>{t}</title>", doc, count=1, flags=re.S)
    return doc.replace("</head>", f"<title>{t}</title>\n</head>", 1)


def set_description(doc, text):
    tag = f'<meta name="description" content="{html.escape(text)}">'
    if re.search(r'<meta\s+name="description"[^>]*>', doc):
        return re.sub(r'<meta\s+name="description"[^>]*>', lambda m: tag, doc, count=1)
    return re.sub(r"(<title>.*?</title>)", lambda m: m.group(1) + "\n" + tag, doc, count=1, flags=re.S)


def set_alts(doc, alts):
    def fix(m):
        tag = m.group(0)
        src = re.search(r'\ssrc="([^"]+)"', tag)
        if not src:
            return tag
        key = src.group(1).split("?")[0]
        alt = alts.get(key) or alts.get(key.lstrip("./"))
        if not alt or re.search(r'\salt="[^"]+"', tag):
            return tag
        tag = re.sub(r'\salt=""', "", tag)
        return tag[:4] + f' alt="{html.escape(alt)}"' + tag[4:]
    return re.sub(r"<img\b[^>]*>", fix, doc)


def faq_html(items):
    qs = "".join(f"<details><summary>{html.escape(x['q'])}</summary><p>{html.escape(x['a'])}</p></details>" for x in items)
    style = ("<style>.seo-faq{max-width:860px;margin:32px auto;padding:0 16px;font:16px/1.5 system-ui,sans-serif}"
             ".seo-faq details{border-bottom:1px solid #ddd;padding:10px 0}.seo-faq summary{font-weight:600;cursor:pointer}</style>")
    ld = ld_script({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": x["q"], "acceptedAnswer": {"@type": "Answer", "text": x["a"]}} for x in items]})
    return f'{style}<section class="seo-faq" aria-label="Questions and answers"><h2>Questions and answers</h2>{qs}</section>{ld}'


def box_html(p, biz):
    """'What's in the box' section: the box ad (scripts/make_box_ads.py), contents list, size, packaging."""
    items = [x for x in p.get("in_the_box") or [] if x.get("item")]
    if not items:
        return ""
    title = p.get("box_title") or "What's in the Box?"
    img = f"assets/images/ads/box/box-{p['id'].lower()}.jpg"
    pic = (f'<img src="../{img}" alt="{html.escape(title)} {html.escape(short(p["name"]))}: '
           f'{html.escape(", ".join(str(x["item"]) for x in items))}" loading="lazy" width="1080" height="1350">'
           if (ROOT / img).exists() else "")
    lis = "".join(f'<li><span>{html.escape(str(x["item"]))}</span> <b>×{html.escape(str(x.get("qty", 1)))}</b></li>' for x in items)
    size = p.get("box_size") or p.get("dimensions") or ""
    size = size if re.search(r"\d", size) and re.search(r"cm|mm|\bm\b|in\b|×", size) else ""
    seller = p.get("seller")
    how = p.get("box_note") or (f"Sold and delivered by {seller['name']}: ask them about delivery." if seller else (biz.get("delivery_note") or ""))
    note = "" if p.get("in_the_box_confirmed") else '<p class="box-fine">Typical contents shown. Please confirm on WhatsApp before you order.</p>'
    return (f'<section class="box" aria-labelledby="box-h"><h2 id="box-h">📦 {html.escape(title)}</h2>'
            f'<div class="box-grid">{pic}<div><ul class="box-list">{lis}</ul>'
            + (f'<p><b>Size:</b> {html.escape(size)}</p>' if size else "")
            + (f'<p><b>How it\'s packaged &amp; delivered:</b> {html.escape(how)}</p>' if how else "")
            + note + '</div></div></section>')


def landing_page(p, biz, card):
    """A real product page (no redirect) for p/<ID>.html."""
    seller = p.get("seller") or {}
    wa = re.sub(r"\D", "", seller.get("whatsapp") or biz.get("whatsapp", ""))
    name = short(p["name"])
    t = html.escape(f"{name} · {cedis(p['price_ghs'])} in Accra | {seller.get('name') or 'F.A Vision Enterprise'}")
    d = html.escape((p.get("description") or " · ".join(p.get("highlights") or []))[:158])
    shop = f"{SITE}#product/{p['id']}"
    msg = f"Hello, I'm interested in the {name} ({p['id']}) at {cedis(p['price_ghs'])}. {SITE}p/{p['id']}.html"
    wa_link = f"https://wa.me/{wa}?text={quote(msg)}"
    facts = [("Price", cedis(p["price_ghs"]) + (" (negotiable)" if p.get("negotiable") else "")),
             ("Availability", "In stock" if p.get("in_stock") else "Made to order"),
             ("Material", p.get("material")), ("Size", p.get("dimensions")),
             ("Colours", ", ".join(p.get("colors") or [])), ("Sold by", seller.get("name") or biz.get("name")),
             ("Where", seller.get("address") or biz.get("address"))]
    rows = "".join(f"<tr><th>{k}</th><td>{html.escape(str(v))}</td></tr>" for k, v in facts if v)
    hl = "".join(f"<li>{html.escape(h)}</li>" for h in p.get("highlights") or [])
    imgs = "".join(f'<img src="{abs_url(i)}" alt="{html.escape(name)}, photo {n + 1}" loading="lazy" width="540">'
                   for n, i in enumerate((p.get("images") or [])[:4]))
    phones = " · ".join(local_phone(x) for x in (seller.get("phones") or biz.get("phones") or []))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{t}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{d}">
<link rel="canonical" href="{SITE}p/{p['id']}.html">
<meta property="og:type" content="product">
<meta property="og:site_name" content="F.A Vision Enterprise">
<meta property="og:title" content="{html.escape(name)} · {cedis(p['price_ghs'])}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{SITE}p/{p['id']}.html">
<meta property="og:image" content="{card}">
<meta property="og:image:width" content="1080">
<meta property="og:image:height" content="1350">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{card}">
<link rel="icon" type="image/png" sizes="48x48" href="../assets/images/favicon.png">
<style>body{{margin:0;font:16px/1.55 system-ui,sans-serif;color:#1b2430;background:#fff}}main{{max-width:900px;margin:0 auto;padding:16px}}
nav{{font-size:14px}}nav a,a{{color:#0d55af}}h1{{font-size:clamp(24px,5vw,34px);margin:12px 0 4px}}.price{{font-size:24px;font-weight:700;color:#0d55af}}
.gal{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:14px 0}}.gal img{{width:100%;height:auto;border-radius:12px}}
.btns{{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}}.btn{{display:inline-block;padding:12px 18px;border-radius:10px;font-weight:600;text-decoration:none}}
.wa{{background:#1fa855;color:#fff}}.shop{{border:1px solid #0d55af}}table{{border-collapse:collapse}}th,td{{text-align:left;padding:6px 12px 6px 0;vertical-align:top}}
.box{{margin:22px 0;padding:16px;border:1px solid #e3e7ee;border-radius:16px;background:#f7f9fc}}.box h2{{margin:0 0 12px;font-size:22px}}
.box-grid{{display:grid;grid-template-columns:minmax(0,320px) 1fr;gap:18px;align-items:start}}.box-grid img{{width:100%;height:auto;border-radius:12px;display:block}}
.box-list{{list-style:none;padding:0;margin:0 0 10px;display:grid;gap:6px}}.box-list li{{display:flex;justify-content:space-between;gap:12px;padding:8px 12px;background:#fff;border-radius:10px;border:1px solid #e3e7ee}}
.box p{{margin:6px 0}}.box-fine{{font-size:13px;color:#5f6b7a}}@media(max-width:620px){{.box-grid{{grid-template-columns:1fr}}}}</style>
</head><body><main>
<nav><a href="../">Home</a> › <a href="../products/">Products</a> › {html.escape(name)}</nav>
<h1>{html.escape(name)}</h1>
<p class="price">{cedis(p['price_ghs'])}</p>
<div class="gal">{imgs}</div>
<p>{html.escape(p.get('description') or '')}</p>
{f'<ul>{hl}</ul>' if hl else ''}
<table>{rows}</table>
{box_html(p, biz)}
<div class="btns"><a class="btn wa" href="{wa_link}">Order on WhatsApp</a><a class="btn shop" href="{shop}">See it in our shop →</a></div>
<p>Call {html.escape(phones)}. {html.escape(biz.get('delivery_note') or '')}</p>
</main>
{ld_script(product_jsonld(p, biz))}
{ld_script(breadcrumb_jsonld(p))}
</body></html>
"""


def llms_txt(biz, products):
    lines = [f"# {biz.get('name')}", "",
             f"> {biz.get('tagline') or 'Furniture shop in Odorkor, Accra, Ghana'}. We sell home, office and school furniture with delivery across Accra, Tema and Kasoa.", "",
             "## Contact",
             f"- WhatsApp: {local_phone(biz.get('whatsapp'))}",
             f"- Phones: {', '.join(local_phone(x) for x in biz.get('phones') or [])}",
             f"- Website: {SITE}"]
    for loc in biz.get("locations") or []:
        lines.append(f"- {loc.get('name')}: {loc.get('address')} ({loc.get('maps_url')})")
    lines += ["", "## Products"]
    for p in products:
        if p.get("placeholder") or not p.get("price_ghs") or not (ROOT / f"p/{p['id']}.html").exists():
            continue
        who = f" (sold by {p['seller']['name']})" if p.get("seller") else ""
        lines.append(f"- [{short(p['name'])}]({SITE}p/{p['id']}.html): {cedis(p['price_ghs'])}, "
                     f"{'in stock' if p.get('in_stock') else 'made to order'}{who}")
    return "\n".join(lines) + "\n"


def sitemap_products(on, products):
    sm = ROOT / "sitemap.xml"
    if not sm.exists():
        return False
    s = sm.read_text()
    s2 = re.sub(r"\s*<!-- seo:products -->.*?<!-- /seo:products -->", "", s, flags=re.S)
    if on:
        urls = "".join(f"\n  <url><loc>{SITE}p/{p['id']}.html</loc><changefreq>weekly</changefreq><priority>0.8</priority>"
                       f"<image:image><image:loc>{abs_url(p['images'][0])}</image:loc></image:image></url>"
                       for p in products if (ROOT / f"p/{p['id']}.html").exists() and p.get("images"))
        s2 = s2.replace("</urlset>", f"  <!-- seo:products -->{urls}\n  <!-- /seo:products -->\n</urlset>")
    if s2 != s:
        sm.write_text(s2)
        return True
    return False


def page_file(page):
    page = page.lstrip("/")
    if not page or page.endswith("/"):
        page += "index.html"
    return ROOT / page


def main():
    check = "--check" in sys.argv
    biz = load("data/business.json", {})
    products = load("data/products.json", [])
    fixes = load("data/seo-fixes.json", {}) or {}
    applied = [f for f in fixes.get("applied", []) if not f.get("removed")]
    landing = any(f.get("kind") == "product_landing" for f in applied)
    changed = []

    docs = {}

    def get(path):
        if path not in docs:
            docs[path] = path.read_text() if path.exists() else None
        return docs[path]

    by_id = {p["id"]: p for p in products}
    for f in sorted((ROOT / "p").glob("FAV-*.html")):
        p = by_id.get(f.stem)
        if not p or not p.get("price_ghs"):
            continue
        doc = get(f)
        if landing:
            m = re.search(r'<meta property="og:image" content="([^"]+)"', doc)
            card = m.group(1) if m else abs_url((p.get("images") or [""])[0])
            doc = landing_page(p, biz, card)
        else:
            doc = put_block(doc, "product", ld_script(product_jsonld(p, biz)))
        docs[f] = doc

    for fx in applied:
        kind, path = fx.get("kind"), page_file(fx.get("page") or "index.html")
        if kind in ("product_landing",):
            continue
        if kind == "llms":
            docs[ROOT / "llms.txt"] = llms_txt(biz, products)
            continue
        doc = get(path)
        if doc is None:
            print("skip (no page):", fx.get("id"), path)
            continue
        v = fx.get("value")
        key = re.sub(r"[^a-z0-9_-]", "-", str(fx.get("id", kind)).lower())
        if kind == "title" and v:
            doc = set_title(doc, v)
        elif kind == "description" and v:
            doc = set_description(doc, v)
        elif kind == "jsonld" and v:
            doc = put_block(doc, key, ld_script(v))
        elif kind == "alt" and isinstance(v, dict):
            doc = set_alts(doc, v)
        elif kind == "faq" and v:
            doc = put_block(doc, key, faq_html(v), "</body>")
        elif kind == "intro" and v:
            doc = put_block(doc, key, f'<p class="seo-intro" style="max-width:860px;margin:8px auto">{html.escape(v)}</p>',
                            "</h1>" if "</h1>" in doc.lower() else "</body>")
        docs[path] = doc

    for path, doc in docs.items():
        if doc is None:
            continue
        old = path.read_text() if path.exists() else None
        if doc != old:
            changed.append(str(path.relative_to(ROOT)))
            if not check:
                path.write_text(doc)
    if not check and sitemap_products(landing, products):
        changed.append("sitemap.xml")
    print(("would change: " if check else "changed: ") + (", ".join(changed) if changed else "nothing"))


if __name__ == "__main__":
    main()
