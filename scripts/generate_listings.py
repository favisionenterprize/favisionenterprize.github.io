#!/usr/bin/env python3
"""Generate ready-to-paste Facebook Marketplace, group and WhatsApp posts for
F.A Vision Enterprise from data/business.json, data/products.json and
data/groups.csv.

Outputs (in output/):
  listings.md          Marketplace listing fields, 3 group caption variants
                       and a WhatsApp status text for every product
  posting-tracker.csv  One row per product x group, for logging manual posts
  meta-catalog.csv     Product feed for Meta Commerce Manager (Facebook /
                       Instagram Shop); only products with a price and photo

It also rewrites assets/js/products-data.js, which the website (index.html)
and the admin page read, so the site and the listings always match.
Products saved from the admin page (admin/) update data/products.json and
assets/js/products-data.js directly; re-run this script afterwards to
refresh output/.

Uses the Python standard library only:  python3 scripts/generate_listings.py
"""

import csv
import json
import sys
from datetime import date
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "output"
SITE_DATA = ROOT / "assets" / "js" / "products-data.js"

MARKETPLACE_TITLE_MAX = 100
META_CONDITION = {"Brand New": "new", "Used": "used", "Refurbished": "refurbished"}


def load():
    business = json.loads((DATA / "business.json").read_text(encoding="utf-8"))
    products = json.loads((DATA / "products.json").read_text(encoding="utf-8"))
    with (DATA / "groups.csv").open(encoding="utf-8", newline="") as f:
        groups = list(csv.DictReader(f))
    return business, products, groups


def local(number):
    """+233572646176 -> 057 264 6176, the format Ghanaian buyers dial."""
    digits = "".join(c for c in number if c.isdigit())
    if digits.startswith("233"):
        digits = "0" + digits[3:]
    return f"{digits[:3]} {digits[3:6]} {digits[6:]}"


def price_text(product):
    price = product.get("price_ghs")
    return f"GH₵ {price:,.0f}" if price else "Price on request"


def whatsapp_link(business, product):
    number = "".join(c for c in business["whatsapp"] if c.isdigit())
    who = business["name"] if product.get("seller") else "F.A Vision"
    message = f"Hello {who}, I'm interested in the {product['name']} ({product['id']})."
    return f"https://wa.me/{number}?text={quote(message)}"


def details(product):
    lines = []
    if product.get("material"):
        lines.append(f"Material: {product['material']}")
    if product.get("dimensions"):
        lines.append(f"Size: {product['dimensions']}")
    if product.get("colors"):
        lines.append(f"Colours: {', '.join(product['colors'])}")
    return lines


def marketplace_title(product):
    title = product["name"]
    if product.get("custom_order"):
        title += " - Made to Order"
    return title[:MARKETPLACE_TITLE_MAX]


def marketplace_description(business, product):
    """The one Facebook Marketplace description every listing of this product uses."""
    site = business.get("website")
    link = f"{site}#product/{product['id']}" if site else None
    lead = (product.get("description") or "").split("\n\n")[0].strip()
    parts = [f"{product['name']} by {business['name']}.", ""]
    if lead:
        parts += [lead, ""]
    if link:
        parts += [f"👉 See all photos, price and order online: {link}", ""]
    parts += [f"✔ {h}" for h in product.get("highlights", [])]
    parts += [""] + details(product)
    if product.get("custom_order"):
        parts.append("Custom sizes, colours and finishes available.")
    parts += [
        "",
        "Price negotiable for bulk orders." if product.get("negotiable") else None,
        None if product.get("seller") else "💳 Pay in full, pay 50% now and the rest on delivery, pay on delivery in Accra, or walk in and pay at the showroom.",
        f"🚚 {business['delivery_note']}",
        f"📍 {business['address']}" if product.get("seller") else f"📍 Showroom: {business['address']} (also Omanjor and Kasoa)",
        f"📞 Call / WhatsApp: {' / '.join(local(n) for n in business['phones'])}",
        f"🌐 {site}" if site else None,
        f"Ref: {product['id']}",
    ]
    return "\n".join(p for p in parts if p is not None).strip()


def group_captions(business, product):
    """Three wordings, rotated across groups so identical text is not
    posted repeatedly (Facebook flags duplicate posts as spam)."""
    price = price_text(product)
    tags = " ".join(business["hashtags"][:4])
    highlights = product.get("highlights", [])
    first = highlights[0] if highlights else ""
    bullet_list = "\n".join(f"• {h}" for h in highlights)
    wa = local(business["whatsapp"])
    where = business["address"] if product.get("seller") else "Odorkor, Accra"
    brand = business["name"].upper() if product.get("seller") else "F.A VISION"
    return [
        f"{product.get('icon') or '🛋️'} {product['name']} available now!\n{bullet_list}\n💰 {price}\n"
        f"📍 {where}, delivery available\n📞 WhatsApp {wa}\n{tags}",
        f"Looking for a quality {product['name'].lower()}? {first}.\n"
        f"Available at {where}. {price}.\n"
        f"Send us a message or WhatsApp {wa} to order. {tags}",
        f"NEW FROM {brand} ✨ {product['name']}\n{price} | "
        f"{'Made to order in your size and colour' if product.get('custom_order') else 'Ready for pickup'}\n"
        f"Homes • Offices • Schools\nDM or call {wa} {tags}",
    ]


def whatsapp_status(business, product):
    return (
        f"{product['name']} 🔥\n{price_text(product)}\n"
        f"Order: {whatsapp_link(business, product)}"
    )


def for_product(business, product):
    """Partner products (product["seller"]) are sold by another business, so
    their listings carry that business's name and contacts, not F.A Vision's."""
    seller = product.get("seller")
    if not seller:
        return business
    name = seller["name"] + (f" (formerly {seller['formerly']})" if seller.get("formerly") else "")
    return {**business, "name": name, "phones": seller["phones"],
            "whatsapp": seller.get("whatsapp") or seller["phones"][0],
            "address": seller.get("address") or "Accra, Ghana",
            "delivery_note": "Contact us for delivery."}


def write_listings(business, products):
    out = [f"# {business['name']}: ready-to-paste listings", "",
           f"Generated {date.today().isoformat()}. Regenerate after editing `data/products.json`.", ""]
    for p in products:
        biz = for_product(business, p)
        out += [f"## {p['id']} · {p['name']}", ""]
        if p.get("seller"):
            out += [f"> Partner product: sold by {biz['name']}. Their contacts are used below.", ""]
        if p.get("placeholder"):
            out += ["> ⚠️ Placeholder product: confirm details, price and photos before posting.", ""]
        out += [
            "### Facebook Marketplace",
            "",
            f"- **Title:** {marketplace_title(p)}",
            f"- **Price:** {p['price_ghs'] if p.get('price_ghs') else '⚠️ set price_ghs'}",
            f"- **Category:** {p['marketplace_category']}",
            f"- **Condition:** {p['condition']}",
            f"- **Location:** {business['marketplace_location']}",
            f"- **Photos:** {', '.join(p['images']) if p.get('images') else '⚠️ add photos'}",
            "",
            "**Description:**",
            "",
            "```",
            marketplace_description(biz, p),
            "```",
            "",
            "### Group posts (use a different variant in each group)",
            "",
        ]
        for i, caption in enumerate(group_captions(biz, p), 1):
            out += [f"**Variant {i}**", "", "```", caption, "```", ""]
        out += ["### WhatsApp status", "", "```", whatsapp_status(biz, p), "```", ""]
    (OUT / "listings.md").write_text("\n".join(out), encoding="utf-8")


def write_tracker(products, groups):
    fields = ["product_id", "product_name", "channel", "group_name", "caption_variant",
              "date_posted", "renew_on", "status", "enquiries", "sold", "notes"]
    with (OUT / "posting-tracker.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for p in products:
            w.writerow({"product_id": p["id"], "product_name": p["name"], "channel": "Marketplace",
                        "status": "To post"})
            for i, g in enumerate(groups):
                w.writerow({"product_id": p["id"], "product_name": p["name"], "channel": "Group",
                            "group_name": g["group_name"], "caption_variant": i % 3 + 1,
                            "status": "To post"})


def write_catalog(business, products):
    """Meta Commerce Manager data-feed columns. Products without a price or
    photo are skipped because Meta rejects them."""
    fields = ["id", "title", "description", "availability", "condition",
              "price", "sale_price", "sale_price_effective_date", "link",
              "image_link", "additional_image_link", "brand", "product_type",
              "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3"]
    skipped = []
    with (OUT / "meta-catalog.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for p in products:
            image = image_url(business, p["images"][0]) if p.get("images") else ""
            if not p.get("price_ghs") or not image:
                skipped.append(p["id"])
                continue
            w.writerow({
                "id": p["id"],
                "title": p["name"],
                "description": (p.get("description") or " ".join(p.get("highlights", [])) or p["name"])[:9999],
                "availability": "in stock" if p.get("in_stock") else ("available for order" if p.get("custom_order") else "out of stock"),
                "condition": META_CONDITION.get(p["condition"], "new"),
                "price": f"{p['price_ghs']:.2f} GHS",
                "link": product_page(business, p),
                "image_link": image,
                "additional_image_link": ",".join(image_url(business, x) for x in p.get("images", [])[1:10]),
                "brand": for_product(business, p)["name"],
                **catalog_extras(p),
            })
    return skipped


PRICE_BANDS = [(1000, "Under GH₵1,000"), (5000, "GH₵1,000 – 5,000"),
               (10000, "GH₵5,000 – 10,000"), (None, "GH₵10,000 and above")]


def active_sale(p):
    """The offer set in admin → Facebook catalog → Offers: price_ghs is the offer
    price and was_price_ghs the normal price. Returns (normal, offer) or None."""
    was, now = p.get("was_price_ghs"), p.get("price_ghs")
    if not was or not now or was <= now:
        return None
    return was, now


def catalog_extras(p):
    """Columns Commerce Manager uses for sets and catalog ads:
    custom_label_0 category, custom_label_1 price band, custom_label_2 stock / offer,
    custom_label_3 product type. Sets are made with rules like
    "Custom label 0 is Dining"."""
    price = p.get("price_ghs") or 0
    band = next(label for limit, label in PRICE_BANDS if limit is None or price < limit)
    sale = active_sale(p)
    stock = "On offer" if sale else ("In stock" if p.get("in_stock") else ("Made to order" if p.get("custom_order") else "Out of stock"))
    out = {
        "product_type": " > ".join(x for x in [p.get("category"), p.get("type")] if x),
        "custom_label_0": p.get("category") or "",
        "custom_label_1": band,
        "custom_label_2": stock,
        "custom_label_3": p.get("type") or "",
        "sale_price": "",
        "sale_price_effective_date": "",
    }
    if sale:
        out["price"] = f"{sale[0]:.2f} GHS"
        out["sale_price"] = f"{sale[1]:.2f} GHS"
        if p.get("sale_until"):
            start = p.get("sale_from") or date.today().isoformat()
            out["sale_price_effective_date"] = f"{start}T00:00+00:00/{p['sale_until']}T23:59+00:00"
    return out


def product_page(business, p):
    """Each catalog item opens its own product page (p/<id>.html) when it exists."""
    site = (business.get("website") or "").rstrip("/")
    if site and (ROOT / "p" / f"{p['id']}.html").exists():
        return f"{site}/p/{p['id']}.html"
    return business.get("website") or whatsapp_link(business, p)


def image_url(business, path):
    """Meta needs absolute image URLs; relative paths such as
    assets/images/sofa.jpg are resolved against the published website."""
    if path.startswith(("http://", "https://")):
        return path
    site = business.get("website", "").rstrip("/")
    return f"{site}/{path.lstrip('/')}" if site else ""


def site_data_js(business, products):
    """The storefront and the admin page both read this file. admin/admin.js
    writes the same format when products are saved from the browser."""
    data = {"business": business, "products": products}
    return (
        "// Generated from data/business.json and data/products.json. Do not edit by hand.\n"
        f"window.FAV_DATA = {json.dumps(data, ensure_ascii=False, indent=2)};\n"
    )


def main():
    business, products, groups = load()
    OUT.mkdir(exist_ok=True)
    write_listings(business, products)
    write_tracker(products, groups)
    skipped = write_catalog(business, products)
    SITE_DATA.write_text(site_data_js(business, products), encoding="utf-8")

    print(f"Wrote {len(products)} products to {OUT.relative_to(ROOT)}/ and {SITE_DATA.relative_to(ROOT)}")
    missing_price = [p["id"] for p in products if not p.get("price_ghs")]
    missing_photo = [p["id"] for p in products if not p.get("images")]
    if missing_price:
        print(f"  Missing price: {', '.join(missing_price)}", file=sys.stderr)
    if missing_photo:
        print(f"  Missing photos: {', '.join(missing_photo)}", file=sys.stderr)
    if skipped:
        print(f"  Left out of meta-catalog.csv: {', '.join(skipped)}", file=sys.stderr)


if __name__ == "__main__":
    main()
