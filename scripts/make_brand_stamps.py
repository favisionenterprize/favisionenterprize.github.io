#!/usr/bin/env python3
"""Brand stamp on every post image (rule P1 in data/ai-plan.json).

Every picture the Social autopilot posts must show the posting brand's NAME and LOGO. Strategy ads,
tile/presence/box ads, share cards and the Shorts made from them already show F.A Vision's brand, so
they count as F.A Vision's own. Plain product photos don't, so this script makes a stamped copy per
brand: 1080x1350, the photo uncropped on the brand's light colour, and a band at the bottom with the
brand's logo, its name and its own WhatsApp number (never another brand's).

  F.A Vision (also its "Fa Vision Furnitures" Page): first photo of every F.A Vision product
  Oteng Furniture: first photo of every F.A Vision product (Oteng sells the same stock; never F.A Vision ads)
  Partner brands (AGOODMANN, ANAC, MANYE OYE): the first 3 photos of their own products
  FAV-014 (the student desk, Profile relay): its first 3 photos for F.A Vision and Oteng

Writes assets/images/stamped/<brand id>/<photo name>.jpg and data/brand-stamps.json:
  { brands: { <id>: { "<source path>": "<stamped path>" } }, own: { <id>: [already-branded images] },
    videos: { <id>: [videos made from that brand's own ads] } }
The admin (admin/brandstamp.js) swaps each post's picture for its stamped copy and refuses to post a
picture that has none. Run: python3 scripts/make_brand_stamps.py   (also run by rebuild-ads.yml)
"""
import json, os, re, sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)
W, H, BAND = 1080, 1350, 150
FORCE = "--force" in sys.argv


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def local(n):
    d = re.sub(r"\D", "", str(n or ""))
    if d.startswith("233"): d = "0" + d[3:]
    return f"{d[:3]} {d[3:6]} {d[6:]}" if len(d) >= 9 else ""


def font(name, size):
    path = {"poppins": J("assets/fonts/Poppins-Bold.ttf"), "poppins-m": J("assets/fonts/Poppins-Medium.ttf"),
            "lora": J("assets/fonts/Lora-Variable.ttf"), "inter": J("assets/fonts/Inter-SemiBold.otf")}[name]
    f = ImageFont.truetype(path, size)
    if name == "lora":
        try: f.set_variation_by_name("Bold")
        except Exception: pass
    return f


def logo_for(b, size):
    """Round logo: F.A Vision's own logo, else the brand kit's monogram on its colour."""
    if b.get("default"):
        im = Image.open(J("assets/images/logo-512.png")).convert("RGBA")
    else:
        kit = J("assets/brands", b["id"], "avatar.png")
        if not os.path.exists(kit):
            raise SystemExit(f"{b['id']} has no brand kit: run python3 scripts/make_brand_kit.py {b['id']} first")
        im = Image.open(kit).convert("RGBA")
    im = ImageOps.fit(im, (size * 4, size * 4), Image.LANCZOS)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, im.width - 1, im.height - 1], fill=255)
    im.putalpha(mask)
    ring = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([6, 6, im.width - 7, im.height - 7], outline=(255, 255, 255, 255), width=14)
    im = Image.alpha_composite(im, ring)
    return im.resize((size, size), Image.LANCZOS)


def stamp(src, b, dst):
    c = b["colors"]
    prim, acc, light = hexrgb(c["primary"]), hexrgb(c["accent"]), hexrgb(c.get("light", "#FFFFFF"))
    photo = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    canvas = Image.new("RGB", (W, H), light if not b.get("default") else (246, 248, 252))
    area = (W - 40, H - BAND - 40)
    photo.thumbnail(area, Image.LANCZOS)
    if photo.width < area[0] and photo.height < area[1]:      # small photo: scale up to fit
        k = min(area[0] / photo.width, area[1] / photo.height)
        photo = photo.resize((int(photo.width * k), int(photo.height * k)), Image.LANCZOS)
    canvas.paste(photo, ((W - photo.width) // 2, 20 + (area[1] - photo.height) // 2))
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, H - BAND, W, H], fill=prim)
    d.rectangle([0, H - BAND, W, H - BAND + 6], fill=acc)
    lg = logo_for(b, 112)
    canvas.paste(lg, (34, H - BAND + 22), lg)
    name = b["name"]
    fn = font("poppins" if b.get("default") else "lora", 46)
    while d.textlength(name, font=fn) > W - 200 and fn.size > 26:
        fn = font("poppins" if b.get("default") else "lora", fn.size - 2)
    d.text((168, H - BAND + 26), name, font=fn, fill=(255, 255, 255))
    wa = local(b.get("whatsapp") or (b.get("phones") or [""])[0])
    sub = (f"WhatsApp {wa}" if wa else "") + (f"  ·  {b['tagline']}" if b.get("tagline") else "")
    fs = font("poppins-m" if b.get("default") else "inter", 27)
    while d.textlength(sub, font=fs) > W - 200 and " · " in sub:
        sub = sub.rsplit("  ·  ", 1)[0]
    d.text((170, H - BAND + 90), sub, font=fs, fill=acc if not b.get("default") else (255, 255, 255))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    canvas.save(dst, "JPEG", quality=84, optimize=True, progressive=True)


def main():
    brands = json.load(open(J("data/brands.json")))["brands"]
    products = json.load(open(J("data/products.json")))
    business = json.load(open(J("data/business.json")))
    home = next(b for b in brands if b.get("default"))
    by_seller = {}
    for b in brands:
        if not b.get("default"):
            by_seller[b["name"].lower()] = b
    def owner(p):
        s = p.get("seller")
        if not s: return home
        return by_seller.get(s["name"].lower()) or next((b for b in brands if s["name"].lower() in [m.lower() for m in b.get("match", [])]), None)

    live = [p for p in products if not p.get("placeholder") and p.get("images")]
    plan = {}   # brand id -> [source photos]
    for p in live:
        o = owner(p)
        if not o: continue
        n = 3 if (o is not home or p["id"] == "FAV-014") else 1
        srcs = [x for x in p["images"][:n] if os.path.exists(J(x))]
        if o is home:
            for bid in (home["id"], "oteng-furniture"):
                plan.setdefault(bid, []).extend(srcs)
        else:
            plan.setdefault(o["id"], []).extend(srcs)

    out = {"note": "Made by scripts/make_brand_stamps.py; don't edit by hand. Read by admin/brandstamp.js.", "brands": {}, "own": {}, "videos": {}}
    made = 0
    for b in brands:
        bid = b["id"]
        m = {}
        for src in plan.get(bid, []):
            base = os.path.splitext(os.path.basename(src))[0]
            dst = f"assets/images/stamped/{bid}/{base}.jpg"
            if FORCE or not os.path.exists(J(dst)) or os.path.getmtime(J(dst)) < max(os.path.getmtime(J(src)), os.path.getmtime(__file__), os.path.getmtime(J("data/brands.json"))):
                stamp(J(src), b, J(dst)); made += 1
            m[src] = dst
        out["brands"][bid] = m

    # Already branded as F.A Vision: its strategy ads and the designs made from them, for its own products only.
    partner_ids = {p["id"].lower() for p in live if p.get("seller")}
    ads = (business.get("promos") or {}).get("ads") or []
    own = []
    for a in ads:
        pid = str(a.get("product") or "").lower()
        if pid in partner_ids: continue
        for f in (f"assets/images/ads/{a['id']}.jpg", f"assets/images/ads/models/tile-{a['id']}.jpg", f"assets/images/ads/models/presence-{a['id']}.jpg"):
            if os.path.exists(J(f)): own.append(f)
    for f in sorted(os.listdir(J("assets/images/ads"))):
        if f.endswith(".jpg") and not re.match(r"fav-\d+", f): own.append("assets/images/ads/" + f)   # ai-studio, seasonal
    for p in live:
        if p.get("seller"): continue
        for f in (f"assets/images/ads/box/box-{p['id'].lower()}.jpg", f"assets/images/share/{p['id'].lower()}.jpg"):
            if os.path.exists(J(f)): own.append(f)
    out["own"][home["id"]] = sorted(set(own))
    vids = []
    for f in sorted(os.listdir(J("assets/videos"))):
        mm = re.match(r"(fav-\d+|ai-studio)[\w-]*-short\.mp4$", f)
        if mm and mm.group(1) not in partner_ids: vids.append("assets/videos/" + f)
    out["videos"][home["id"]] = vids
    for b in brands:
        out["own"].setdefault(b["id"], []); out["videos"].setdefault(b["id"], [])
    old = None
    try: old = json.load(open(J("data/brand-stamps.json")))
    except Exception: pass
    if old != out:
        with open(J("data/brand-stamps.json"), "w") as fh:
            json.dump(out, fh, indent=1, ensure_ascii=False); fh.write("\n")
    print(f"brand stamps: {made} made, " + ", ".join(f"{k} {len(v)}" for k, v in out["brands"].items()) + f"; {len(out['own'][home['id']])} F.A Vision images already branded, {len(vids)} videos")


if __name__ == "__main__":
    main()
