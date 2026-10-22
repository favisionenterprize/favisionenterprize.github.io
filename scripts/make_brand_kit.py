#!/usr/bin/env python3
"""Brand kit images for Alexander's other brands (data/brands.json): logo, avatar, social covers.
Run: python3 scripts/make_brand_kit.py oteng-furniture   (writes assets/brands/<id>/)."""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LORA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets/fonts/Lora-Variable.ttf")
INTER_B = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets/fonts/Inter-SemiBold.otf")
INTER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets/fonts/Inter-Regular.otf")

def font(path, size, bold=False):
    f = ImageFont.truetype(path, size)
    if bold:
        try: f.set_variation_by_name("Bold")
        except Exception: pass
    return f

def hexrgb(h): h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def center(d, xy, text, f, fill, spacing=0):
    w = d.textlength(text, font=f) + spacing * (len(text) - 1)
    x, y = xy[0] - w / 2, xy[1]
    if not spacing: d.text((x, y), text, font=f, fill=fill); return
    for ch in text: d.text((x, y), ch, font=f, fill=fill); x += d.textlength(ch, font=f) + spacing

def monogram(size, b, bg=True):
    """Gold ring + serif initials on the brand colour (transparent when bg=False)."""
    S = size * 4  # draw big, shrink for smooth edges
    im = Image.new("RGBA", (S, S), hexrgb(b["colors"]["primary"]) + (255,) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    gold = hexrgb(b["colors"]["accent"])
    m = int(S * 0.12); w = max(6, S // 60)
    d.ellipse([m, m, S - m, S - m], outline=gold, width=w)
    d.ellipse([m + w * 3, m + w * 3, S - m - w * 3, S - m - w * 3], outline=gold, width=max(2, w // 3))
    f = font(LORA, int(S * 0.34), bold=True)
    t = b["initials"]; bb = d.textbbox((0, 0), t, font=f)
    d.text(((S - (bb[2] - bb[0])) / 2 - bb[0], (S - (bb[3] - bb[1])) / 2 - bb[1] - S * 0.02), t, font=f, fill=gold)
    small = font(INTER_B, int(S * 0.045))
    center(d, (S / 2, S * 0.685), b.get("est", "EST. ACCRA"), small, gold, spacing=int(S * 0.008))
    return im.resize((size, size), Image.LANCZOS)

def wordmark_lockup(b, W, H, bg):
    im = Image.new("RGB", (W, H), hexrgb(bg)); d = ImageDraw.Draw(im)
    c = b["colors"]; gold, cream = hexrgb(c["accent"]), hexrgb(c["light"])
    mono = monogram(int(H * 0.46), b, bg=False)
    im.paste(mono, (int(W / 2 - mono.width / 2), int(H * 0.08)), mono)
    name = font(LORA, int(H * 0.11), bold=True)
    center(d, (W / 2, H * 0.58), b["name"].upper(), name, cream if bg == c["primary"] else hexrgb(c["primary"]), spacing=int(H * 0.012))
    tag = font(INTER, int(H * 0.045))
    center(d, (W / 2, H * 0.74), b["tagline"], tag, gold)
    return im

def cover(b, W, H, safe=None):
    """Cover/header: brand colour field, thin gold rule, wordmark left-of-centre inside the safe area."""
    c = b["colors"]; im = Image.new("RGB", (W, H), hexrgb(c["primary"])); d = ImageDraw.Draw(im)
    gold, cream = hexrgb(c["accent"]), hexrgb(c["light"])
    for i in range(0, W, max(8, W // 160)):  # subtle wood-grain lines
        d.line([(i, 0), (i - H // 3, H)], fill=tuple(min(255, v + 6) for v in hexrgb(c["primary"])), width=1)
    sx, sy, sw, sh = safe or (0, 0, W, H)
    mono = monogram(int(sh * 0.55), b, bg=False)
    my = int(sy + sh / 2 - mono.height / 2)
    total = mono.width + sh * 0.08 + font(LORA, int(sh * 0.17), True).getlength(b["name"].upper())
    x0 = int(sx + sw / 2 - total / 2)
    im.paste(mono, (x0, my), mono)
    tx = x0 + mono.width + int(sh * 0.08)
    d.text((tx, sy + sh * 0.27), b["name"].upper(), font=font(LORA, int(sh * 0.17), True), fill=cream)
    d.line([(tx, sy + sh * 0.52), (tx + sw * 0.18, sy + sh * 0.52)], fill=gold, width=max(2, H // 200))
    d.text((tx, sy + sh * 0.57), b["tagline"], font=font(INTER, int(sh * 0.075)), fill=gold)
    d.text((tx, sy + sh * 0.70), b.get("cover_line", ""), font=font(INTER, int(sh * 0.06)), fill=cream)
    return im

def main(bid):
    brands = json.load(open(os.path.join(ROOT, "data/brands.json")))
    b = next(x for x in brands["brands"] if x["id"] == bid)
    out = os.path.join(ROOT, "assets/brands", bid); os.makedirs(out, exist_ok=True)
    c = b["colors"]
    monogram(1080, b).convert("RGB").save(f"{out}/avatar.png")                     # IG, TikTok, X, YouTube, FB profile
    monogram(1024, b, bg=False).save(f"{out}/logo-mark.png")                       # transparent mark
    wordmark_lockup(b, 1600, 1000, c["light"]).save(f"{out}/logo-light.png")
    wordmark_lockup(b, 1600, 1000, c["primary"]).save(f"{out}/logo-dark.png")
    cover(b, 1640, 624, (120, 60, 1400, 504)).save(f"{out}/facebook-cover.jpg", quality=92)
    cover(b, 1500, 500, (300, 40, 1050, 420)).save(f"{out}/x-header.jpg", quality=92)
    cover(b, 2560, 1440, (507, 508, 1546, 423)).save(f"{out}/youtube-banner.jpg", quality=92)
    cover(b, 1584, 396, (300, 40, 1100, 316)).save(f"{out}/linkedin-cover.jpg", quality=92)
    print("wrote", sorted(os.listdir(out)))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "oteng-furniture")
