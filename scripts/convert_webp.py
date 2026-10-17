#!/usr/bin/env python3
"""Make a lighter .webp copy of every product photo in assets/images/products.

The .jpg/.png stays (older phones, Facebook catalog, share cards). A .webp is only kept
when it is actually smaller than the original. generate_listings.py lists the photos
that have a .webp in products-data.js (FAV_DATA.webp); the shop only asks for a .webp
that is on that list, so a new photo without one simply shows the .jpg.

Run:  python3 scripts/convert_webp.py      (also run by .github/workflows/rebuild-ads.yml)
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "assets" / "images" / "products"


def convert_to_webp(quality=82):
    if not IMG_DIR.exists():
        print(f"{IMG_DIR} does not exist.")
        return
    count = saved = 0
    for path in sorted(IMG_DIR.iterdir()):
        if path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        webp = path.with_suffix(".webp")
        if webp.exists() and webp.stat().st_mtime >= path.stat().st_mtime:
            continue
        with Image.open(path) as im:
            im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
            im.save(webp, "WEBP", quality=quality, method=6)
        orig, new = path.stat().st_size, webp.stat().st_size
        if new >= orig:  # no gain: keep only the original
            webp.unlink()
            print(f"Skipped: {path.name} (webp not smaller)")
            continue
        count += 1
        saved += orig - new
        print(f"Converted: {path.name} -> {webp.name} ({round((1 - new / orig) * 100)}% smaller)")
    # drop orphans whose original photo was deleted
    for webp in IMG_DIR.glob("*.webp"):
        if not any(webp.with_suffix(s).exists() for s in (".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG")):
            webp.unlink()
            print(f"Removed orphan: {webp.name}")
    print(f"\nDone. Converted {count} files, saved {saved // 1024} KB.")


if __name__ == "__main__":
    convert_to_webp()
