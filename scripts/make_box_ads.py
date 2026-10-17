#!/usr/bin/env python3
""""What's in the Box?" ads (oraimo-style) for every product in data/products.json.

    python3 scripts/make_box_ads.py              # every product with a photo
    python3 scripts/make_box_ads.py FAV-014      # one or more products

Output: assets/images/ads/box/box-<id>.jpg (1080 x 1350 feed) and box-<id>-story.jpg (1080 x 1920).

Look: pure black background, big white "What's in the Box?" title (box_title, e.g. "What's in the Bag?"),
the product drawn as thin white line art made from its own first photo (edge detection on a white
studio shot, GrabCut cut-out + edges on a room photo; a clean photo cut-out or framed photo when the
lines would be messy), "<short name> ×1", model / ref, a dimensions strip (only when the product's
"dimensions" or "box_size" holds a real measurement: never made up), a row of line icons drawn in code
for each `in_the_box` item ("Item ×qty"), the price, F.A Vision branding (partner products: the
seller's name and WhatsApp) and a white "Order on WhatsApp" pill. While `in_the_box_confirmed` is false
a small "typical contents" note goes under the button.

Data (data/products.json, per product): in_the_box [{item, qty, icon, guess?}], box_title?, box_note?,
box_size?, in_the_box_confirmed. Admin: "📦 What's in the Box ads" screen (admin/boxads.js, #boxads).
Needs Pillow; numpy + OpenCV (opencv-python-headless) for the line art, else a framed photo is used.
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

try:
    import numpy as np
    import cv2
except ImportError:          # no OpenCV: framed photos instead of line art
    np = cv2 = None

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/images/ads/box"
W = 1080
BLACK, WHITE, SOFT, DIM = (0, 0, 0), (255, 255, 255), (200, 200, 206), (130, 130, 138)
FONT_DIRS = [ROOT / "assets/fonts", Path("/usr/share/fonts/truetype/google-fonts")]

# How the main product is drawn. "line" = white line art, "cutout" = photo cut out on black,
# "card" = framed photo. Picked by eye for photos where the automatic choice looks messy.
ART = {
    **{k: "line" for k in ("FAV-002", "FAV-006", "FAV-007", "FAV-008", "FAV-014", "FAV-017", "FAV-019",
                           "FAV-021", "FAV-022", "FAV-032")},
    **{k: "card" for k in ("FAV-018", "FAV-023", "FAV-031", "FAV-001", "FAV-003", "FAV-004", "FAV-005", "FAV-009", "FAV-010", "FAV-011",
                           "FAV-015", "FAV-016", "FAV-020", "FAV-024", "FAV-025", "FAV-026", "FAV-027",
                           "FAV-028", "FAV-029", "FAV-030", "FAV-033", "FAV-034", "FAV-035")},
}
# Which photo to draw from (default: the first one).
PHOTO = {}


# ------------------------------------------------------------------ text helpers
def font(weight, size):
    for d in FONT_DIRS:
        p = d / f"Poppins-{weight}.ttf"
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.truetype("DejaVuSans-Bold.ttf" if weight == "Bold" else "DejaVuSans.ttf", size)


def fit_font(d, text, weight, size, maxw, minsize=18):
    f = font(weight, size)
    while d.textlength(text, font=f) > maxw and f.size > minsize:
        f = font(weight, f.size - 2)
    return f


def wrap(d, text, f, maxw, lines=2):
    words, out, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if d.textlength(t, font=f) <= maxw or not cur:
            cur = t
        else:
            out.append(cur)
            cur = w_
    out.append(cur)
    if len(out) > lines:
        out = out[:lines]
        while d.textlength(out[-1] + "…", font=f) > maxw and " " in out[-1]:
            out[-1] = out[-1].rsplit(" ", 1)[0]
        out[-1] += "…"
    return out


def clean_text(s):
    return str(s).replace("₵", "¢").replace("″", '"')


def local_phone(n):
    n = re.sub(r"\D", "", str(n))
    if n.startswith("233"):
        n = "0" + n[3:]
    return f"{n[:3]} {n[3:6]} {n[6:]}" if len(n) == 10 else n


def money(n):
    return "GH¢{:,}".format(int(n))


def short_name(p):
    n = str(p["name"]).split(" — ")[0]
    n = re.sub(r"\s*\([^)]*\)\s*$", "", n)
    return clean_text(n)


def model_of(p):
    m = re.search(r"\(([A-Z0-9][A-Z0-9-]{4,})\)", p["name"])
    if m:
        return m.group(1)
    m = re.search(r"Item No\.?:\s*([A-Z0-9-]{3,})", p.get("description") or "")
    return m.group(1) if m else ""


MEASURE = re.compile(r"\d+(?:\.\d+)?\s*(?:×|x|by)\s*\d|\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches)\b", re.I)


def dims_of(p):
    """[(label, value)] from the product's own size text; [] when it has no real measurement."""
    raw = p.get("box_size") or p.get("dimensions") or ""
    if not MEASURE.search(raw):
        return [], ""
    order = ""
    m = re.search(r"\((L\s*×\s*W\s*×\s*H)\)", raw)
    if m:
        order = m.group(1).replace(" ", " ")
        raw = raw.replace(m.group(0), "")
    out = []
    for seg in [s.strip(" ;,.") for s in raw.split(";") if s.strip(" ;,.")]:
        mm = re.match(r"^([A-Za-z][A-Za-z ]{1,14}?)\s+(\d.*)$", seg)
        out.append((mm.group(1).upper(), mm.group(2)) if mm else ("SIZE", seg))
    return out[:3], order


def price_line(p):
    if not p.get("price_ghs"):
        return "Ask for today's price"
    if p["id"] == "FAV-014":
        return f"{money(p['price_ghs'])} a set  ·  {money(640)} each from 50"
    was = p.get("was_price_ghs")
    if was and was > p["price_ghs"]:
        return f"Now {money(p['price_ghs'])}  (was {money(was)})"
    lo_hi = re.search(r"GH₵\s?([\d,]+)\s*(?:to|–|-)\s*GH₵\s?([\d,]+)", " ".join([p.get("description") or ""] + list(p.get("highlights") or [])))
    if lo_hi:
        return f"{money(lo_hi.group(1).replace(',', ''))} – {money(lo_hi.group(2).replace(',', ''))}"
    unit = " per roll" if p.get("type") == "Wallpaper" else ""
    return ("From " if p.get("custom_order") else "") + money(p["price_ghs"]) + unit


def qty_text(q):
    return f"×{q}" if isinstance(q, int) or str(q).isdigit() else f"×{q}".replace(" or ", "/")


# ------------------------------------------------------------------ main product art
def _clean(e, min_area):
    n, lab, st, _ = cv2.connectedComponentsWithStats(e, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= min_area
    return (keep[lab] * 255).astype(np.uint8)


_CACHE = {}


def analyse(path):
    """Mask, crop box and stats for one photo (worked out at 1000 px, cached)."""
    if path in _CACHE:
        return _CACHE[path]
    orig = cv2.imread(str(path))
    h, w = orig.shape[:2]
    s = 1000 / max(h, w)
    img = cv2.resize(orig, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    border = np.concatenate([g[:6].ravel(), g[-6:].ravel(), g[:, :6].ravel(), g[:, -6:].ravel()])
    white = border.mean() > 228
    sm = cv2.bilateralFilter(cv2.bilateralFilter(img, 9, 70, 70), 9, 70, 70)
    gs = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY)
    info = {"white": bool(white), "touch": 0.0, "orig": orig, "s": s}
    if white:
        e = cv2.Canny(gs, 40, 110)
        mask = cv2.morphologyEx(cv2.dilate(e, np.ones((15, 15), np.uint8)), cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
        filled = mask.copy()
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(filled, cnts, -1, 255, -1)
        mask = cv2.erode(filled, np.ones((9, 9), np.uint8))
        info["lo_hi"] = (40, 110)
    else:
        k = 520 / max(h, w)                                   # GrabCut on a small copy (speed)
        small = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
        sh_, sw_ = small.shape[:2]
        gm = np.zeros((sh_, sw_), np.uint8)
        rect = (int(sw_ * .04), int(sh_ * .04), int(sw_ * .92), int(sh_ * .92))
        cv2.grabCut(small, gm, rect, np.zeros((1, 65)), np.zeros((1, 65)), 5, cv2.GC_INIT_WITH_RECT)
        gm = np.where((gm == 1) | (gm == 3), 255, 0).astype(np.uint8)
        mask = cv2.resize(gm, (w, h), interpolation=cv2.INTER_LINEAR)
        mask = np.where(mask > 127, 255, 0).astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(mask)
        if n > 1:
            big = st[1:, cv2.CC_STAT_AREA].max()
            keep = np.zeros(n, bool)
            keep[1:] = st[1:, cv2.CC_STAT_AREA] > big * 0.1
            mask = (keep[lab] * 255).astype(np.uint8)
        fr = mask > 0
        bd = np.concatenate([fr[int(h * .06)], fr[int(h * .94)], fr[:, int(w * .06)], fr[:, int(w * .94)]])
        info["touch"] = float(bd.mean())
        v = float(np.median(gs[fr])) if fr.any() else 128.0
        info["lo_hi"] = (int(max(10, .5 * v)), int(min(250, 1.25 * v)))
        e = cv2.Canny(gs, *info["lo_hi"])
        e[cv2.dilate(mask, np.ones((7, 7), np.uint8)) == 0] = 0
    e = _clean(e, 30)
    ys, xs = np.where(e > 0)
    info["mask"] = mask
    if not len(xs):
        info["bbox"] = None
    else:
        info["density"] = float((e > 0).sum() / max(1, (mask > 0).sum()))
        info["bbox"] = (max(0, xs.min() - 8), max(0, ys.min() - 8), min(w, xs.max() + 9), min(h, ys.max() + 9))
    _CACHE[path] = info
    return info


def line_art(info, box_w, box_h):
    """White line drawing (L image) of the product, drawn at twice the size and scaled down for smooth thin lines."""
    x0, y0, x1, y1 = info["bbox"]
    s, orig = info["s"], info["orig"]
    crop = orig[int(y0 / s):int(y1 / s), int(x0 / s):int(x1 / s)]
    mk = info["mask"][y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    k = min(2 * box_w / cw, 2 * box_h / ch)
    tw, th = max(8, int(cw * k)), max(8, int(ch * k))
    crop = cv2.resize(crop, (tw, th), interpolation=cv2.INTER_CUBIC if k > 1 else cv2.INTER_AREA)
    mk = cv2.resize(mk, (tw, th), interpolation=cv2.INTER_NEAREST)
    r = max(1, round(max(tw, th) / 1200))                       # filter sizes follow the working size
    sm = cv2.bilateralFilter(cv2.bilateralFilter(crop, 9 * r, 70, 70), 9 * r, 70, 70)
    sm = cv2.GaussianBlur(sm, (0, 0), 1.0 * r)
    lo, hi = (40, 120) if info["white"] else (50, 140)
    e = np.zeros((th, tw), np.uint8)
    for c in cv2.split(sm):                                      # colour edges: yellow on a white wall still shows
        e |= cv2.Canny(c, lo, hi)
    if not info["white"]:
        e[cv2.dilate(mk, np.ones((15 * r, 15 * r), np.uint8)) == 0] = 0
    e = _clean(e, 60 * r * r)
    e = cv2.dilate(e, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    im = Image.fromarray(e).resize((max(1, tw // 2), max(1, th // 2)), Image.LANCZOS)
    return im.point(lambda v: min(255, int(v * 1.5)))


def product_art(p, box_w, box_h):
    """(RGB image, L mask) of the main product fitted inside box_w x box_h."""
    path = ROOT / (PHOTO.get(p["id"]) or p["images"][0])
    mode = ART.get(p["id"])
    info = None
    if cv2 is not None and mode != "card":
        info = analyse(path)
        if info["bbox"] is None:
            mode = "card"
        elif not mode:
            if info["white"] or (info["touch"] < 0.1 and info.get("density", 1) < 0.1):
                mode = "line"
            elif info["touch"] < 0.18:
                mode = "cutout"
            else:
                mode = "card"
    if info is None and mode in ("line", "cutout"):
        mode = "card"
    if mode == "line":
        im = line_art(info, box_w, box_h)
        return Image.new("RGB", im.size, WHITE), im
    if mode == "cutout":
        x0, y0, x1, y1 = info["bbox"]
        s, orig = info["s"], info["orig"]
        crop = cv2.cvtColor(orig[int(y0 / s):int(y1 / s), int(x0 / s):int(x1 / s)], cv2.COLOR_BGR2RGB)
        mk = cv2.resize(info["mask"][y0:y1, x0:x1], (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_LINEAR)
        im = Image.fromarray(crop)
        a = Image.fromarray(cv2.GaussianBlur(mk, (0, 0), 1.5))
        sc = min(box_w / im.width, box_h / im.height)
        size = (max(1, int(im.width * sc)), max(1, int(im.height * sc)))
        return im.resize(size, Image.LANCZOS), a.resize(size, Image.LANCZOS)
    src = Image.open(path).convert("RGB")                      # card: framed photo
    bb = ImageOps.invert(ImageOps.grayscale(src)).point(lambda v: 255 if v > 18 else 0).getbbox()   # trim white padding
    if bb and (bb[2] - bb[0]) * (bb[3] - bb[1]) > 0.3 * src.width * src.height:
        src = src.crop(bb)
    s = min((box_w - 12) / src.width, (box_h - 12) / src.height)
    im = src.resize((max(1, int(src.width * s)), max(1, int(src.height * s))), Image.LANCZOS)
    card = Image.new("RGB", (im.width + 12, im.height + 12), WHITE)
    card.paste(im, (6, 6))
    m = Image.new("L", card.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, card.width - 1, card.height - 1), 30, fill=255)
    return card, m


# ------------------------------------------------------------------ line icons (drawn at 2x, white on black)
def icon(name, size):
    S = size * 2
    im = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(im)
    lw = max(6, S // 26)
    u = S / 100.0                                               # icons are drawn on a 100 x 100 grid

    def P(*pts):
        return [(x * u, y * u) for x, y in pts]

    def line(*pts, w=lw):
        d.line(P(*pts), fill=255, width=w, joint="curve")

    def rect(x0, y0, x1, y1, r=4, w=lw):
        d.rounded_rectangle((x0 * u, y0 * u, x1 * u, y1 * u), r * u, outline=255, width=w)

    def ell(x0, y0, x1, y1, w=lw, fill=None):
        d.ellipse((x0 * u, y0 * u, x1 * u, y1 * u), outline=255, width=w, fill=fill)

    def poly(*pts, w=lw):
        line(*(pts + (pts[0],)), w=w)

    n = name
    if n == "screws":
        for ox, oy in ((22, 18), (52, 34)):
            ell(ox, oy, ox + 18, oy + 9)
            line((ox + 9, oy + 9), (ox + 9, oy + 52))
            for k in range(4):
                line((ox + 3, oy + 18 + k * 9), (ox + 15, oy + 14 + k * 9), w=lw // 2 + 1)
    elif n == "allen":
        line((30, 22), (30, 72), (72, 72))
        line((24, 22), (36, 22), w=lw)
    elif n == "booklet":
        rect(26, 16, 74, 84, 3)
        line((26, 16), (36, 16), (36, 84))
        for y in (34, 46, 58, 70):
            line((44, y), (66, y), w=lw // 2 + 1)
    elif n == "panel":
        poly((14, 46), (58, 30), (88, 44), (44, 62))
        line((14, 46), (14, 54), (44, 70), (88, 52), (88, 44))
        line((44, 62), (44, 70))
    elif n == "glass":
        poly((12, 50), (54, 32), (90, 46), (48, 66))
        line((40, 44), (50, 40), w=lw // 2 + 1)
        line((46, 50), (62, 43), w=lw // 2 + 1)
        line((12, 50), (12, 54), (48, 70), (90, 50), (90, 46))
    elif n == "frame":
        line((16, 30), (84, 30))
        line((22, 30), (22, 84))
        line((78, 30), (78, 84))
        line((22, 64), (78, 64))
        line((16, 84), (28, 84))
        line((72, 84), (84, 84))
    elif n == "legs":
        for x in (34, 66):
            line((x - 6, 16), (x + 6, 16))
            line((x, 16), (x, 76))
            line((x - 10, 84), (x, 76), (x + 10, 84))
    elif n == "chair":
        rect(30, 8, 64, 42, 6)                                   # back rest
        line((34, 42), (34, 52))
        line((60, 42), (60, 52))
        poly((24, 52), (62, 52), (78, 62), (40, 62))            # seat
        line((24, 52), (24, 88))
        line((40, 62), (40, 92))
        line((78, 62), (78, 92))
        line((62, 52), (62, 70), w=lw // 2 + 1)
    elif n == "plastic_chair":
        d.rounded_rectangle((28 * u, 12 * u, 72 * u, 48 * u), 12 * u, outline=255, width=lw)
        line((22, 50), (78, 50), w=lw + 2)
        line((26, 50), (20, 88))
        line((74, 50), (80, 88))
        line((30, 50), (34, 80))
        line((70, 50), (66, 80))
    elif n == "office_chair":
        rect(34, 10, 66, 44, 8)
        rect(26, 48, 74, 58, 4)
        line((50, 58), (50, 74))
        line((24, 86), (50, 74), (76, 86))
        line((50, 74), (50, 88))
        for x in (24, 76, 50):
            ell(x - 4, 86, x + 4, 94, w=lw // 2 + 1)
    elif n == "armrest":
        line((22, 40), (70, 40), (70, 84))
        rect(18, 30, 74, 42, 6)
        line((56, 84), (84, 84))
    elif n == "gaslift":
        rect(38, 14, 62, 56, 4)
        rect(42, 56, 58, 88, 3)
        line((38, 30), (62, 30), w=lw // 2 + 1)
    elif n == "base":
        for x, y in ((10, 62), (28, 86), (72, 86), (90, 62), (50, 52)):
            line((50, 66), (x, y))
            ell(x - 5, y + 2, x + 5, y + 12, w=lw // 2 + 1)
        ell(42, 58, 58, 74)
    elif n == "castor":
        line((42, 14), (42, 40))
        line((32, 40), (64, 40), (64, 58))
        ell(30, 46, 66, 82)
        ell(44, 60, 52, 68, w=lw // 2 + 1)
    elif n == "cushion":
        d.rounded_rectangle((16 * u, 30 * u, 84 * u, 70 * u), 18 * u, outline=255, width=lw)
        line((30, 50), (70, 50), w=lw // 2 + 1)
    elif n == "pillow":
        d.polygon(P((18, 24), (50, 30), (82, 24), (76, 50), (82, 76), (50, 70), (18, 76), (24, 50)), outline=255)
        poly((18, 24), (50, 30), (82, 24), (76, 50), (82, 76), (50, 70), (18, 76), (24, 50))
    elif n == "drawers":
        rect(18, 16, 82, 84, 4)
        for y in (38, 60):
            line((18, y), (82, y))
        for y in (27, 49, 72):
            line((44, y), (56, y))
    elif n == "mirror":
        d.arc((26 * u, 10 * u, 74 * u, 58 * u), 180, 360, fill=255, width=lw)
        line((26, 34), (26, 88), (74, 88), (74, 34))
        line((40, 28), (52, 20), w=lw // 2 + 1)
    elif n == "stool":
        ell(20, 20, 80, 40)
        line((28, 34), (22, 86))
        line((72, 34), (78, 86))
        line((44, 40), (42, 80))
        line((56, 40), (58, 80))
        line((26, 64), (74, 64), w=lw // 2 + 1)
    elif n == "door":
        rect(28, 8, 72, 92, 3)
        line((36, 30), (50, 16), (64, 30), (50, 44), (36, 30), w=lw // 2 + 1)
        line((36, 62), (50, 48), (64, 62), (50, 76), (36, 62), w=lw // 2 + 1)
        line((64, 46), (64, 56))
    elif n == "shelf":
        rect(20, 10, 80, 90, 3)
        line((20, 36), (80, 36))
        line((20, 62), (80, 62))
        line((30, 22), (70, 22), w=lw // 2 + 1)
        line((40, 22), (40, 32), w=lw // 2 + 1)
    elif n == "sofa":
        rect(16, 30, 84, 52, 8)
        rect(8, 44, 22, 74, 6)
        rect(78, 44, 92, 74, 6)
        rect(20, 52, 80, 70, 4)
        line((16, 74), (16, 82))
        line((84, 74), (84, 82))
    elif n == "table":
        ell(12, 26, 88, 50)
        line((26, 44), (20, 86))
        line((74, 44), (80, 86))
        line((50, 50), (50, 84))
    elif n == "base_table":
        ell(14, 20, 86, 40)
        d.arc((26 * u, 36 * u, 74 * u, 92 * u), 200, 340, fill=255, width=lw)
        line((32, 84), (68, 84))
        line((40, 44), (36, 84))
        line((60, 44), (64, 84))
    elif n == "tv":
        rect(10, 16, 90, 66, 3)
        line((26, 66), (20, 84))
        line((74, 66), (80, 84))
        line((70, 24), (82, 24), w=lw // 2 + 1)
    elif n == "remote":
        rect(38, 8, 62, 92, 10)
        ell(45, 18, 55, 28, w=lw // 2 + 1)
        for y in (40, 52, 64):
            line((44, y), (46, y))
            line((54, y), (56, y))
    elif n == "battery":
        for x in (26, 54):
            rect(x, 24, x + 20, 84, 4)
            line((x + 7, 18), (x + 13, 18))
            line((x + 10, 46), (x + 10, 60), w=lw // 2 + 1)
            line((x + 3, 53), (x + 17, 53), w=lw // 2 + 1)
    elif n == "cable":
        rect(58, 10, 84, 36, 4)
        line((64, 10), (64, 2))
        line((78, 10), (78, 2))
        d.arc((22 * u, 30 * u, 74 * u, 70 * u), 0, 180, fill=255, width=lw)
        d.arc((10 * u, 46 * u, 46 * u, 90 * u), 180, 360, fill=255, width=lw)
        line((71, 36), (74, 50))
    elif n == "ac_in":
        rect(8, 30, 92, 64, 10)
        line((18, 56), (82, 56), w=lw // 2 + 1)
        line((72, 40), (82, 40), w=lw // 2 + 1)
    elif n == "ac_out":
        rect(12, 18, 88, 82, 4)
        ell(22, 26, 70, 74)
        ell(42, 46, 50, 54, w=lw // 2 + 1)
        line((78, 30), (78, 70), w=lw // 2 + 1)
    elif n == "plate":
        rect(12, 30, 88, 70, 3)
        for x in (24, 50, 76):
            ell(x - 4, 46, x + 4, 54, w=lw // 2 + 1)
    elif n == "toilet":
        line((30, 50), (30, 62))
        d.arc((22 * u, 40 * u, 82 * u, 80 * u), 0, 180, fill=255, width=lw)
        line((22, 60), (82, 60))
        line((40, 78), (44, 90), (64, 90), (66, 78))
        rect(22, 14, 50, 50, 4)
    elif n == "cistern":
        rect(20, 22, 80, 78, 6)
        line((16, 22), (84, 22), w=lw + 2)
        ell(44, 12, 56, 20, w=lw // 2 + 1)
    elif n == "toilet_seat":
        ell(18, 20, 82, 84)
        ell(32, 34, 68, 72)
        line((40, 16), (60, 16))
    elif n == "tiles":
        for k, (x, y) in enumerate(((12, 30), (46, 18), (30, 58), (64, 46))):
            poly((x, y + 12), (x + 22, y), (x + 40, y + 10), (x + 18, y + 22))
    elif n == "cards":
        for k in range(3):
            rect(14 + k * 8, 26 + k * 10, 70 + k * 8, 60 + k * 10, 3)
    elif n == "ream":
        poly((12, 40), (54, 24), (90, 38), (48, 56))
        line((12, 40), (12, 64), (48, 80), (90, 62), (90, 38))
        line((48, 56), (48, 80))
        line((22, 52), (40, 60), w=lw // 2 + 1)
    elif n == "sack":
        d.polygon(P((30, 24), (70, 24), (82, 86), (18, 86)), outline=255)
        line((30, 24), (70, 24), (82, 86), (18, 86), (30, 24))
        line((38, 24), (34, 12), (50, 18), (66, 12), (62, 24))
        line((34, 54), (66, 54), w=lw // 2 + 1)
    elif n == "roll":
        ell(14, 20, 38, 80)
        line((26, 20), (74, 20))
        line((26, 80), (86, 80), (86, 54), (74, 54))
        d.arc((62 * u, 20 * u, 86 * u, 54 * u), 270, 90, fill=255, width=lw)
    elif n == "footrest":
        ell(14, 54, 86, 82)
        line((50, 54), (50, 16))
        line((40, 16), (60, 16))
    elif n == "bowl":
        d.arc((14 * u, 24 * u, 86 * u, 84 * u), 0, 180, fill=255, width=lw)
        line((14, 54), (86, 54))
        d.arc((40 * u, 46 * u, 60 * u, 62 * u), 180, 360, fill=255, width=lw)
        line((50, 84), (50, 92))
    elif n == "tap":
        line((30, 86), (30, 40), (70, 40), (70, 56))
        line((22, 86), (38, 86))
        line((24, 28), (36, 28))
        line((30, 28), (30, 40))
        for y in (64, 74):
            line((70, y), (70, y + 4), w=lw // 2 + 1)
    elif n == "mattress":
        poly((10, 44), (54, 28), (90, 42), (46, 60))
        line((10, 44), (10, 60), (46, 76), (90, 58), (90, 42))
        line((46, 60), (46, 76))
        for t in (0.33, 0.66):
            line((10 + 44 * t, 44 - 16 * t + 0), (46 + 44 * t, 60 - 18 * t), w=lw // 2 + 1)
    elif n == "caps":
        for x, y in ((18, 30), (54, 30), (18, 62), (54, 62)):
            ell(x, y, x + 28, y + 10)
            line((x, y + 5), (x, y + 16))
            line((x + 28, y + 5), (x + 28, y + 16))
            d.arc((x * u, (y + 10) * u, (x + 28) * u, (y + 22) * u), 0, 180, fill=255, width=lw)
    else:                                                     # carton (fallback)
        poly((14, 34), (50, 20), (86, 34), (50, 48))
        line((14, 34), (14, 70), (50, 86), (86, 70), (86, 34))
        line((50, 48), (50, 86))
        line((32, 27), (68, 41), w=lw // 2 + 1)
    return im.resize((size, size), Image.LANCZOS)


# ------------------------------------------------------------------ layout
def contact(p, business):
    s = p.get("seller")
    if s:
        return s["name"], local_phone(s.get("whatsapp") or s["phones"][0]), True
    return "F.A Vision Enterprise", local_phone(business.get("whatsapp") or "0572646176"), False


def compose(p, business, H):
    story = H > 1500
    img = Image.new("RGB", (W, H), BLACK)
    d = ImageDraw.Draw(img)
    items = [x for x in (p.get("in_the_box") or []) if x.get("item")][:8]
    title = clean_text(p.get("box_title") or "What's in the Box?")
    name = short_name(p)
    model = model_of(p)
    dims, order = dims_of(p)
    seller_name, wa, partner = contact(p, business)

    pad = 64
    single = len(items) <= 1
    top = 120 if story else 48
    title_f = fit_font(d, title, "Bold", 104 if story else 86, W - 2 * pad, 60)
    f_it = font("Medium", 26 if story else 23)
    f_q = font("Bold", 26 if story else 23)
    # vertical budget
    cols = 3 if len(items) in (3, 5, 6) else 4
    rows = 0 if single else (len(items) + cols - 1) // cols
    icon_s = 116 if story else 92
    cell_h = icon_s + 16 + 2 * (f_it.size + 6) + (24 if story else 14)
    grid_h = rows * cell_h
    dims_h = 74 if dims else 0
    meta_h = 44
    footer_h = 300 if story else 226
    title_h = title_f.size + 30
    hero_cap_h = 64
    base_gap = 50 if story else 22
    fixed = top + title_h + hero_cap_h + meta_h + dims_h + grid_h + footer_h + base_gap * 3
    hero_max = (1040 if story else 820) if single else (860 if story else 620)
    hero_h = max(280, min(H - fixed, hero_max))
    slack = max(0, H - fixed - hero_h)
    gap = base_gap + slack // 4

    y = top + slack // 4
    d.text((W / 2, y + title_f.size / 2), title, font=title_f, fill=WHITE, anchor="mm")
    y += title_h + gap

    # hero
    art, mask = product_art(p, W - 2 * pad - 40, hero_h)
    img.paste(art, ((W - art.width) // 2, int(y + (hero_h - art.height) / 2)), mask)
    y += hero_h + 10
    if single and items:
        cap = f"{clean_text(items[0]['item'])} {qty_text(items[0].get('qty', 1))}"
    else:
        cap = f"{name} ×1"
    d.text((W / 2, y + 26), cap, font=fit_font(d, cap, "Medium", 44 if story else 40, W - 2 * pad, 24), fill=WHITE, anchor="mm")
    y += hero_cap_h - 10
    meta = "  ·  ".join(x for x in [name if single and items else "", f"Model {model}" if model else "", f"Ref {p['id']}"] if x)
    d.text((W / 2, y + 14), meta, font=fit_font(d, meta, "Regular", 26 if story else 24, W - 2 * pad, 16), fill=DIM, anchor="mm")
    y += meta_h
    if dims:
        y += 4
        f_lab, f_val = font("Bold", 22 if story else 20), font("Medium", 30 if story else 28)
        chips = [(lab, clean_text(val)) for lab, val in dims]

        def measure():
            ws = [d.textlength(lab, font=f_lab) + d.textlength(v, font=f_val) + 64 for lab, v in chips]
            return ws, sum(ws) + 18 * (len(chips) - 1) + (d.textlength(order, font=f_lab) + 24 if order else 0)
        widths, total = measure()
        while total > W - 2 * pad and f_val.size > 18:
            f_val, f_lab = font("Medium", f_val.size - 2), font("Bold", max(14, f_lab.size - 1))
            widths, total = measure()
        x = (W - total) / 2
        for (lab, v), wdt in zip(chips, widths):
            d.rounded_rectangle((x, y, x + wdt, y + 54), 27, outline=WHITE, width=2)
            d.text((x + 24, y + 27), lab, font=f_lab, fill=SOFT, anchor="lm")
            d.text((x + 24 + d.textlength(lab, font=f_lab) + 16, y + 27), v, font=f_val, fill=WHITE, anchor="lm")
            x += wdt + 18
        if order:
            d.text((x + 6, y + 27), order, font=f_lab, fill=DIM, anchor="lm")
        y += dims_h - 4

    # contents grid: line icon + "Item ×qty" (qty in bold white on the last line)
    if rows:
        y += gap // 2
        d.line((pad + 40, y, W - pad - 40, y), fill=(48, 48, 52), width=2)
        y += gap // 2 + (14 if story else 8)
        cw = (W - 2 * pad) / cols
        for r in range(rows):
            row = items[r * cols:(r + 1) * cols]
            x0 = pad + (W - 2 * pad - cw * len(row)) / 2
            for i, itx in enumerate(row):
                cx = x0 + cw * i + cw / 2
                img.paste(WHITE, (int(cx - icon_s / 2), int(y)), icon(itx.get("icon") or "carton", icon_s))
                q = " " + qty_text(itx.get("qty", 1))
                qw = d.textlength(q, font=f_q)
                lines = wrap(d, clean_text(itx["item"]), f_it, cw - 16, 2)
                if d.textlength(lines[-1], font=f_it) + qw > cw - 16:
                    lines.append("")
                    lines = lines[-3:] if len(lines) > 3 else lines
                ty = y + icon_s + 16
                for k, ln in enumerate(lines):
                    last = k == len(lines) - 1
                    tw = d.textlength(ln, font=f_it) + (qw if last else 0)
                    tx = cx - tw / 2
                    d.text((tx, ty), ln, font=f_it, fill=SOFT)
                    if last:
                        d.text((tx + d.textlength(ln, font=f_it) + (0 if ln else -d.textlength(" ", font=f_q)), ty - 1), q, font=f_q, fill=WHITE)
                    ty += f_it.size + 6
            y += cell_h
    # footer: price, brand + WhatsApp, pill
    fy = H - footer_h + (20 if story else 0)
    pl = price_line(p)
    d.text((W / 2, fy + 34), pl, font=fit_font(d, pl, "Bold", 54 if story else 48, W - 2 * pad, 28), fill=WHITE, anchor="mm")
    fy += 92 if story else 84
    # brand (left) + pill (right)
    by = fy + 8
    if not partner:
        logo = Image.open(ROOT / "assets/images/logo-512.png").convert("RGBA")
        logo.thumbnail((76, 76))
        disc = Image.new("L", (84, 84), 0)
        ImageDraw.Draw(disc).ellipse((0, 0, 83, 83), fill=255)
        img.paste(WHITE, (pad, by - 4), disc)
        img.paste(logo, (pad + 4, by), logo)
        bx = pad + 100
    else:
        bx = pad
    fb = fit_font(d, seller_name, "Bold", 30, 430 if not partner else 520, 18)
    d.text((bx, by + 22), seller_name, font=fb, fill=WHITE, anchor="lm")
    d.text((bx, by + 58), f"WhatsApp {wa}", font=font("Medium", 26), fill=SOFT, anchor="lm")
    cta = "Order on WhatsApp"
    fc = font("Bold", 30)
    cw_ = d.textlength(cta, font=fc) + 76
    px1 = W - pad
    d.rounded_rectangle((px1 - cw_, by + 4, px1, by + 76), 36, fill=WHITE)
    d.text((px1 - cw_ / 2, by + 40), cta, font=fc, fill=BLACK, anchor="mm")
    note = []
    if p.get("seller"):
        note.append("Sold & delivered by " + seller_name + " (partner of F.A Vision)")
    if not p.get("in_the_box_confirmed"):
        note.append("Typical contents shown, please confirm on WhatsApp")
    if note:
        nt = "  ·  ".join(note)
        d.text((W / 2, H - (60 if story else 34)), nt, font=fit_font(d, nt, "Regular", 20, W - 2 * pad, 14), fill=DIM, anchor="mm")
    return img


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, quality=88, optimize=True, progressive=True)
    print("wrote", path.relative_to(ROOT))


def main():
    business = json.loads((ROOT / "data/business.json").read_text(encoding="utf-8"))
    products = json.loads((ROOT / "data/products.json").read_text(encoding="utf-8"))
    only = {a.upper() for a in sys.argv[1:]}
    for p in products:
        if only and p["id"] not in only:
            continue
        if p.get("placeholder") or not p.get("images") or not (ROOT / p["images"][0]).exists():
            print("skip (no photo):", p["id"])
            continue
        if not p.get("in_the_box"):
            print("skip (no in_the_box):", p["id"])
            continue
        save(compose(p, business, 1350), OUT / f"box-{p['id'].lower()}.jpg")
        save(compose(p, business, 1920), OUT / f"box-{p['id'].lower()}-story.jpg")


if __name__ == "__main__":
    main()
