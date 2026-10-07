#!/usr/bin/env python3
"""Extra ad models for every strategy ad (business.json -> promos.ads), plus seasonal ads.

    python3 scripts/make_ad_models.py              # tile + presence for every strategy ad, and the seasonal ads
    python3 scripts/make_ad_models.py fav-001      # one strategy ad (by ad id or product id)

Models (1080 x 1350, saved to assets/images/ads/models/<model>-<ad id>.jpg):
  tile      – bright "catalogue" ad: logo on top, big two-line headline (category + price),
              the product large in the middle, a green "Order on WhatsApp" button,
              a reassurance line and the website between rules.
  presence  – lifestyle ad: the product photo full-bleed, a big white two-line promise
              ("More comfort. More style."), a framed card with "Shop now" and "Follow" chips,
              "More to love." and a dark WhatsApp bar.
Seasonal (assets/images/ads/<id>.jpg):
  customer-service-week-2026 – "Happy Customer Service Week" thank-you ad.

The admin's autopilot posts these too (admin/igauto.js pool: kinds "Tile ad" and "Presence ad").
Partner products (with a "seller" block) carry the seller's name and phone, not F.A Vision's.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
W, H = 1080, 1350
BLUE, RED, PINK, PURPLE = (13, 85, 175), (244, 44, 44), (230, 80, 110), (176, 62, 166)
INK, GREY, NAVY = (20, 20, 26), (70, 74, 86), (9, 45, 104)
GREEN, GREEN_D = (22, 120, 64), (14, 90, 46)
OUT = ROOT / "assets/images/ads/models"
FONT_DIRS = [ROOT / "assets/fonts", Path("/usr/share/fonts/truetype/google-fonts")]


def font(weight, size):
    for d in FONT_DIRS:
        p = d / f"Poppins-{weight}.ttf"
        if p.exists():
            return ImageFont.truetype(str(p), size)
    if "Italic" in weight:
        return font(weight.replace("Italic", "") or "Regular", size)
    return ImageFont.truetype("DejaVuSans-Bold.ttf" if "Bold" in weight else "DejaVuSans.ttf", size)


def fit_font(draw, text, weight, size, maxw, minsize=24):
    f = font(weight, size)
    while draw.textlength(text, font=f) > maxw and f.size > minsize:
        f = font(weight, f.size - 2)
    return f


def local_phone(n):
    n = str(n).replace(" ", "").lstrip("+")
    if n.startswith("233"):
        n = "0" + n[3:]
    return f"{n[:3]} {n[3:6]} {n[6:]}" if len(n) == 10 else n


def money(n):
    return "GH¢{:,}".format(int(n))          # ¢: Poppins has no ₵ glyph


def cutout(src, box_w, box_h):
    """Product photo resized to fit the box; white backgrounds become transparent (soft edge)."""
    s = min(box_w / src.width, box_h / src.height)
    im = src.resize((max(1, int(src.width * s)), max(1, int(src.height * s))), Image.LANCZOS)
    g = ImageOps.grayscale(im)
    edge = list(g.resize((30, 30)).get_flattened_data() if hasattr(g, 'get_flattened_data') else g.resize((30, 30)).getdata())
    border = edge[:30] + edge[-30:] + edge[::30] + edge[29::30]
    if sum(border) / len(border) > 236:                    # white studio shot: cut it out
        mask = ImageOps.invert(g.point(lambda v: 255 if v > 242 else 0)).filter(ImageFilter.GaussianBlur(1.2))
    else:                                                   # room photo: rounded card
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), 28, fill=255)
    return im.convert("RGB"), mask


def logo_block(img, cx, y, seller=None):
    d = ImageDraw.Draw(img)
    if seller:
        f = fit_font(d, seller["name"], "Bold", 40, 760)
        d.text((cx, y + 30), seller["name"], font=f, fill=GREEN_D, anchor="mm")
        d.text((cx, y + 70), "VIA F.A VISION ENTERPRISE", font=font("Bold", 18), fill=RED, anchor="mm")
        return
    logo = Image.open(ROOT / "assets/images/logo-512.png").convert("RGBA")
    logo.thumbnail((92, 92))
    tw = d.textlength("F.A Vision", font=font("Bold", 40))
    x0 = int(cx - (logo.width + 18 + tw) / 2)
    img.paste(logo, (x0, y), logo)
    d.text((x0 + logo.width + 18, y + 10), "F.A Vision", font=font("Bold", 40), fill=BLUE)
    d.text((x0 + logo.width + 20, y + 58), "E N T E R P R I S E", font=font("Bold", 17), fill=RED)


CATEGORY_WORDS = [
    ("dining", "DINING SETS", "More flavour. More family."),
    ("living", "SOFAS & LIVING", "More comfort. More style."),
    ("sofa", "SOFAS & LIVING", "More comfort. More style."),
    ("bed", "BEDROOM", "More rest. More space."),
    ("wardrobe", "WARDROBES", "More space. More style."),
    ("student", "STUDENT DESKS", "More learning. More comfort."),
    ("school", "SCHOOL FURNITURE", "More learning. More comfort."),
    ("office", "OFFICE FURNITURE", "More focus. More comfort."),
    ("chair", "OFFICE CHAIRS", "More focus. More comfort."),
    ("desk", "DESKS", "More focus. More comfort."),
    ("water closet", "WATER CLOSETS", "More comfort. More class."),
    ("toilet", "WATER CLOSETS", "More comfort. More class."),
    ("tile", "TILES", "More shine. More value."),
    ("flour", "BAKING FLOUR", "More bakes. More profit."),
]


def words_for(p):
    hay = " ".join(str(p.get(k) or "") for k in ("type", "category", "name")).lower()
    for key, top, promise in CATEGORY_WORDS:
        if key in hay:
            return top, promise
    t = (p.get("type") or p.get("category") or "Quality pieces").upper()
    return t[:22], "More quality. More value."


# ------------------------------------------------------------------ tile model
def tile(ad, p, business):
    seller = p.get("seller")
    src = Image.open(ROOT / (ad.get("photo") or p["images"][0])).convert("RGB")
    bg = ImageOps.fit(src, (W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
    bg = ImageEnhance.Brightness(bg).enhance(1.25)
    img = Image.blend(Image.new("RGB", (W, H), (246, 247, 249)), bg, 0.22)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, 10), fill=GREEN if seller else BLUE)
    logo_block(img, W // 2, 34, seller)
    d = ImageDraw.Draw(img)

    top, _ = words_for(p)
    line1 = (ad.get("tile_title") or top).upper()
    line2 = (ad.get("tile_sub") or (f"FROM {money(p['price_ghs'])}" if p.get("price_ghs") else "FROM F.A VISION")).upper()
    d.text((W / 2, 230), line1, font=fit_font(d, line1, "Bold", 112, W - 100, 60), fill=INK, anchor="mm")
    d.text((W / 2, 336), line2, font=fit_font(d, line2, "Bold", 104, W - 100, 56), fill=GREEN_D, anchor="mm")
    sub = ad.get("tile_line") or ("For homes, offices, schools & churches" if not seller else (p.get("type") or "Quality products") + " · " + (seller.get("address") or "Accra").split(",")[0])
    d.text((W / 2, 418), sub, font=fit_font(d, sub, "Medium", 36, W - 120), fill=GREY, anchor="mm")

    im, mask = cutout(src, 900, 520)
    x, y = (W - im.width) // 2, 470 + (520 - im.height) // 2
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).ellipse((W / 2 - im.width * 0.42, y + im.height - 26, W / 2 + im.width * 0.42, y + im.height + 22), fill=110)
    img.paste((40, 40, 50), (0, 0), sh.filter(ImageFilter.GaussianBlur(18)))
    img.paste(im, (x, y), mask)

    d = ImageDraw.Draw(img)
    cta = "ORDER ON WHATSAPP"
    fc = font("Bold", 50)
    cw = d.textlength(cta, font=fc) + 190
    by = 1040
    d.rounded_rectangle(((W - cw) / 2 + 4, by + 8, (W + cw) / 2 + 4, by + 106), 22, fill=(0, 60, 30))
    d.rounded_rectangle(((W - cw) / 2, by, (W + cw) / 2, by + 98), 22, fill=GREEN)
    tx = (W - cw) / 2 + 55
    d.text((tx, by + 50), cta, font=fc, fill="white", anchor="lm")
    ax = tx + d.textlength(cta, font=fc) + 34
    d.line((ax, by + 50, ax + 44, by + 50), fill="white", width=8)
    d.line((ax + 24, by + 30, ax + 46, by + 50, ax + 24, by + 70), fill="white", width=8, joint="curve")
    reassure = ("Pay 50% now, rest on delivery  •  Delivery across Ghana" if not seller
                else f"Call / WhatsApp {local_phone(seller.get('whatsapp') or seller['phones'][0])}")
    d.text((W / 2, by + 140), reassure, font=fit_font(d, reassure, "Medium", 32, W - 100), fill=INK, anchor="mm")
    site = "favisionenterprize.github.io"
    fs = font("Bold", 42)
    sw = d.textlength(site, font=fs)
    yy = 1272
    d.text((W / 2, yy), site, font=fs, fill=INK, anchor="mm")
    d.line((90, yy, W / 2 - sw / 2 - 30, yy), fill=GREEN_D, width=3)
    d.line((W / 2 + sw / 2 + 30, yy, W - 90, yy), fill=GREEN_D, width=3)
    return img


# ------------------------------------------------------------------ presence model
def presence(ad, p, business):
    seller = p.get("seller")
    src = Image.open(ROOT / (ad.get("photo") or p["images"][0])).convert("RGB")
    for path in p.get("images", []):                       # prefer a room photo for the full-bleed background
        try:
            cand = Image.open(ROOT / path).convert("RGB")
        except OSError:
            continue
        g = list((lambda q: q.get_flattened_data() if hasattr(q, 'get_flattened_data') else q.getdata())(ImageOps.grayscale(cand).resize((20, 20))))
        if sum(g) / len(g) < 200:
            src = cand
            break
    img = ImageEnhance.Contrast(ImageOps.fit(src, (W, H), Image.LANCZOS, centering=(0.5, 0.55))).enhance(1.05)
    grad = Image.new("L", (1, H))
    for yy in range(H):
        t = max(0.0, 1 - yy / 620) * 0.85 + max(0.0, (yy - 860) / 420) * 0.8
        grad.putpixel((0, yy), int(255 * min(0.84, t)))
    img.paste((10, 10, 16), (0, 0), grad.resize((W, H)))
    d = ImageDraw.Draw(img)

    d.ellipse((40, 40, 132, 132), fill="white")
    if not seller:
        logo = Image.open(ROOT / "assets/images/logo-512.png").convert("RGBA")
        logo.thumbnail((78, 78))
        img.paste(logo, (47 + (78 - logo.width) // 2, 47 + (78 - logo.height) // 2), logo)
    else:
        d.text((86, 86), seller["name"][:1], font=font("Bold", 52), fill=GREEN_D, anchor="mm")
    name = seller["name"] if seller else "F.A Vision Enterprise"
    d.text((152, 56), name, font=fit_font(d, name, "Bold", 36, 760), fill="white")
    d.text((152, 100), "Accra, Ghana", font=font("Regular", 24), fill=(225, 225, 232))

    _, promise = words_for(p)
    promise = ad.get("presence_line") or promise
    brand = (seller["name"].split()[0].title() if seller else "F.A Vision") + "."
    d.text((W / 2, 250), brand, font=fit_font(d, brand, "Medium", 118, W - 120), fill="white", anchor="mm", stroke_width=2, stroke_fill=(0, 0, 0))
    parts = [x.strip() + "." for x in promise.rstrip(".").split(".") if x.strip()]
    for i, line in enumerate(parts[:2]):
        d.text((W / 2, 372 + i * 88), line, font=fit_font(d, line, "Medium", 78, W - 120), fill="white", anchor="mm", stroke_width=2, stroke_fill=(0, 0, 0))

    cx0, cy0, cw, ch = 290, 590, 500, 480
    card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, cw - 1, ch - 1), 34, outline=(255, 255, 255, 235), width=5, fill=(255, 255, 255, 28))
    img.paste(card, (cx0, cy0), card)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((cx0 + 26, cy0 + 26, cx0 + 84, cy0 + 84), 14, fill="white")
    d.polygon([(cx0 + 46, cy0 + 40), (cx0 + 46, cy0 + 70), (cx0 + 70, cy0 + 55)], fill=INK)
    chip, fcp = "Shop now", font("Medium", 34)
    tw = d.textlength(chip, font=fcp)
    chx, chy = cx0 + 150, cy0 + ch - 196
    d.rounded_rectangle((chx, chy, chx + tw + 100, chy + 66), 14, fill="white")
    d.line((chx + 26, chy + 46, chx + 48, chy + 22), fill=BLUE, width=5)
    d.line((chx + 32, chy + 22, chx + 48, chy + 22, chx + 48, chy + 38), fill=BLUE, width=5)
    d.text((chx + 70, chy + 33), chip, font=fcp, fill=INK, anchor="lm")
    short = str(p["name"]).split(" — ")[0]
    lab = (short[:22] + "…") if len(short) > 23 else short
    fl = font("Medium", 24)
    lw = d.textlength(lab, font=fl)
    lx, ly = cx0 + 20, cy0 + ch - 92
    d.rounded_rectangle((lx, ly, lx + lw + 186, ly + 56), 28, fill=(70, 62, 56))
    d.text((lx + 22, ly + 28), lab, font=fl, fill="white", anchor="lm")
    fx = lx + lw + 44
    d.rounded_rectangle((fx, ly + 10, fx + 120, ly + 46), 10, fill="white")
    d.text((fx + 60, ly + 28), "Follow", font=font("Medium", 22), fill=INK, anchor="mm")

    price = money(p["price_ghs"]) if p.get("price_ghs") else ""
    bottom = f"From {price}. More to love." if price else "More to love."
    d.text((W / 2, 1150), bottom, font=fit_font(d, bottom, "Medium", 76, W - 100), fill="white", anchor="mm", stroke_width=2, stroke_fill=(0, 0, 0))

    d.rectangle((0, 1236, W, H), fill=(36, 52, 64))
    wa = local_phone((seller or {}).get("whatsapp") or business.get("whatsapp") or "0572646176")
    bar = f"WhatsApp {wa}  ·  favisionenterprize.github.io"
    d.text((50, 1293), bar, font=fit_font(d, bar, "Medium", 38, W - 160), fill="white", anchor="lm")
    d.line((W - 70, 1270, W - 48, 1293, W - 70, 1316), fill="white", width=7, joint="curve")
    return img


# ------------------------------------------------------------------ Customer Service Week
def customer_service_week(products, business, year=2026):
    pick = [p for p in products.values() if not p.get("seller") and p.get("images") and not p.get("placeholder")]
    order = ["FAV-011", "FAV-014", "FAV-001", "FAV-010", "FAV-006"]
    pick = sorted(pick, key=lambda p: order.index(p["id"]) if p["id"] in order else 99)[:5]
    base = Image.open(ROOT / pick[0]["images"][0]).convert("RGB")
    img = ImageOps.fit(base, (W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(26))
    img = Image.blend(ImageEnhance.Brightness(img).enhance(1.1), Image.new("RGB", (W, H), (255, 236, 214)), 0.55)
    d = ImageDraw.Draw(img)

    # badge (top-left): shield in brand colours
    bx, by = 54, 44
    sh = [(bx, by + 30), (bx + 30, by), (bx + 210, by), (bx + 240, by + 30), (bx + 240, by + 150), (bx + 120, by + 230), (bx, by + 150)]
    d.polygon([(x + 6, y + 8) for x, y in sh], fill=(0, 0, 0))
    d.polygon(sh, fill=BLUE)
    d.rectangle((bx + 8, by + 44, bx + 232, by + 78), fill=RED)
    d.text((bx + 120, by + 61), f"CUSTOMER SERVICE WEEK {year}", font=font("Bold", 14), fill="white", anchor="mm")
    d.text((bx + 120, by + 114), "SERVICE", font=font("BoldItalic", 38), fill="white", anchor="mm")
    d.text((bx + 120, by + 154), "WITH HEART", font=font("BoldItalic", 30), fill=(255, 214, 102), anchor="mm")

    d.rounded_rectangle((W - 360, 56, W - 50, 152), 48, fill="white")
    logo = Image.open(ROOT / "assets/images/logo-512.png").convert("RGBA")
    logo.thumbnail((76, 76))
    img.paste(logo, (W - 346, 66), logo)
    d.text((W - 258, 74), "F.A Vision", font=font("Bold", 30), fill=BLUE)
    d.text((W - 256, 112), "ENTERPRISE", font=font("Bold", 15), fill=RED)

    d.text((W / 2, 400), "Happy Customer", font=font("BoldItalic", 104), fill="white", anchor="mm", stroke_width=6, stroke_fill=(20, 20, 30))
    d.text((W / 2, 530), "Service Week", font=font("BoldItalic", 132), fill="white", anchor="mm", stroke_width=8, stroke_fill=(20, 20, 30))
    d.text((W / 2, 642), "To every customer who trusted us this year: thank you.", font=fit_font(d, "To every customer who trusted us this year: thank you.", "BoldItalic", 34, W - 90), fill=INK, anchor="mm")
    d.text((W / 2, 692), "We'll keep going the extra mile for you.", font=font("BoldItalic", 34), fill=INK, anchor="mm")

    stage = Image.new("L", (W, H), 0)
    ImageDraw.Draw(stage).rounded_rectangle((40, 760, W - 40, 1150), 40, fill=215)
    img.paste((255, 255, 255), (0, 0), stage.filter(ImageFilter.GaussianBlur(6)))
    slot = (W - 120) / len(pick)
    cw_, chh = int(slot - 20), 300
    for i, p in enumerate(pick):
        im = ImageOps.fit(Image.open(ROOT / p["images"][0]).convert("RGB"), (cw_, chh), Image.LANCZOS)
        m = Image.new("L", (cw_, chh), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, cw_ - 1, chh - 1), 26, fill=255)
        x = int(60 + i * slot + 10)
        shd = Image.new("L", (W, H), 0)
        ImageDraw.Draw(shd).rounded_rectangle((x + 4, 800, x + cw_ + 4, 800 + chh + 8), 26, fill=90)
        img.paste((60, 40, 30), (0, 0), shd.filter(ImageFilter.GaussianBlur(10)))
        img.paste(im, (x, 792), m)
    d = ImageDraw.Draw(img)
    d.text((W / 2, 1122), "Homes · Offices · Schools · Churches  —  delivered across Ghana", font=font("Medium", 28), fill=GREY, anchor="mm")

    d.rectangle((0, 1176, W, H), fill=NAVY)
    d.rectangle((0, 1176, W, 1186), fill=RED)
    d.text((54, 1234), "favisionenterprize.github.io", font=font("Bold", 36), fill="white", anchor="lm")
    d.text((54, 1292), "WhatsApp 057 264 6176  ·  020 747 3267", font=font("Medium", 28), fill=(220, 230, 250), anchor="lm")
    d.text((W - 54, 1234), "Follow us", font=font("Bold", 30), fill="white", anchor="rm")
    d.text((W - 54, 1292), "@favisionent", font=font("Medium", 26), fill=(220, 230, 250), anchor="rm")
    return img


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, quality=88, optimize=True, progressive=True)
    print("wrote", path.relative_to(ROOT))


def main():
    business = json.loads((ROOT / "data/business.json").read_text(encoding="utf-8"))
    products = {p["id"]: p for p in json.loads((ROOT / "data/products.json").read_text(encoding="utf-8"))}
    only = set(sys.argv[1:])
    for ad in business["promos"]["ads"]:
        if only and ad["id"] not in only and ad["product"] not in only:
            continue
        p = products.get(ad["product"])
        if not p or not p.get("images"):
            continue
        save(tile(ad, p, business), OUT / f"tile-{ad['id']}.jpg")
        save(presence(ad, p, business), OUT / f"presence-{ad['id']}.jpg")
    if not only:
        save(customer_service_week(products, business), ROOT / "assets/images/ads/customer-service-week-2026.jpg")


if __name__ == "__main__":
    main()
