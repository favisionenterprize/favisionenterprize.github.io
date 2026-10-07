#!/usr/bin/env python3
"""Make vertical YouTube Shorts / Reels (1080x1920, 12 s) from the strategy ads.

Each ad in assets/images/ads/ (fav-XXX.jpg, ai-studio.jpg) becomes
assets/videos/<name>-short.mp4: the ad on a blurred copy of itself, with a slow
zoom. New videos are added to data/videos.json with status "waiting" for both the
website and YouTube, so they show up in the admin (Social autopilot -> Videos &
YouTube) until you choose where to post them. Existing videos are left alone.

Run:  python3 scripts/make_shorts.py            (only missing videos)
      python3 scripts/make_shorts.py --force    (rebuild all)
Needs ffmpeg.
"""
import json, re, subprocess, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADS = ROOT / "assets/images/ads"
OUT = ROOT / "assets/videos"
DATA = ROOT / "data/videos.json"
SECONDS = 12
FORCE = "--force" in sys.argv


def load(path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


products = {p["id"]: p for p in load(ROOT / "data/products.json", [])}
business = load(ROOT / "data/business.json", {})
site = (business.get("website") or "https://favisionenterprize.github.io/").rstrip("/") + "/"
wa = "057 264 6176"


def price(p):
    return "GH₵{:,}".format(int(p["price_ghs"])) + (" (negotiable)" if p.get("negotiable") else "")


def texts(name):
    """Title, description and product id for one ad (None if it can't be described)."""
    if name.startswith("ai-studio"):
        return ("Design your room FREE before you buy | F.A Vision AI Studio #Shorts",
                "See your room before you buy it. Pick sofas, dining sets, wardrobes and wallpaper in the free "
                f"F.A Vision AI Studio and see them in your space. You only pay for what you order.\n\n"
                f"Try it: {site}studio/\nWhatsApp {wa}\nShowroom: Tarazzo Road, Odorkor, Accra\n\n"
                "#Shorts #InteriorDesign #FurnitureGhana #AccraHomes #FAVisionEnterprise", None)
    m = re.match(r"fav-(\d+)", name)
    p = products.get(f"FAV-{m.group(1)}") if m else None
    if not p or not p.get("price_ghs"):
        return None
    short = p["name"].split(" — ")[0]
    seller = p.get("seller")
    who = seller["name"] if seller else "F.A Vision Enterprise"
    phone = (seller or {}).get("whatsapp") or wa
    first = re.split(r"\n\s*\n", p.get("description") or "")[0].strip()
    hl = "\n".join("✔ " + h for h in (p.get("highlights") or [])[:4])
    title = f"{short} – {price(p)} in Ghana #Shorts"[:100]
    desc = (f"{short}: {price(p)}\n\n{first}\n\n{hl}\n\n"
            f"Order: WhatsApp {phone}\nSee all photos: {site}p/{p['id']}.html\nSold by {who}"
            + ("" if seller else " · Tarazzo Road, Odorkor, Accra · delivery across Accra")
            + "\n\n#Shorts #FurnitureGhana #AccraHomes #FAVisionEnterprise")
    return title, desc.strip(), p["id"]


def make(src, dst):
    # Background: the ad scaled to fill 1080x1920, blurred and darkened. Foreground: the ad
    # 1080 wide, zooming in slowly. 30 fps, H.264, no audio (add music in YouTube if you like).
    frames = SECONDS * 30
    vf = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:3,"
        "eq=brightness=-0.12[bg];"
        f"[0:v]scale=2160:-2,zoompan=z='min(1.0+0.0004*on,1.12)':d={frames}:s=1080x1350:fps=30"
        ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'[fg];"
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p"
    )
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", str(SECONDS), "-i", str(src),
                    "-filter_complex", vf, "-t", str(SECONDS), "-r", "30", "-c:v", "libx264", "-preset", "medium",
                    "-crf", "26", "-movflags", "+faststart", str(dst)], check=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lib = load(DATA, {"videos": []})
    have = {v["id"]: v for v in lib["videos"]}
    removed = set(lib.get("removed", []))   # deleted in the admin: never made again
    today = datetime.date.today().isoformat()
    made = 0
    for src in sorted(ADS.glob("*.jpg")):
        name = src.stem
        if name.endswith("-story") or name.endswith("-arrived"):
            continue   # story-format duplicates and dated variants
        info = texts(name)
        if not info:
            continue
        title, desc, pid = info
        vid = f"{name}-short"
        if vid in removed:
            continue
        dst = OUT / f"{vid}.mp4"
        if FORCE or not dst.exists():
            make(src, dst)
            made += 1
            print(f"made {dst.relative_to(ROOT)} ({dst.stat().st_size // 1024} KB)")
        if vid not in have:
            have[vid] = {
                "id": vid, "title": title, "description": desc,
                "file": f"assets/videos/{vid}.mp4", "poster": f"assets/images/ads/{src.name}",
                "product": pid, "kind": "short", "source": "generated", "created": today,
                "website": {"status": "waiting"}, "youtube": {"status": "waiting"},
            }
    lib.setdefault("removed", [])
    lib["videos"] = sorted(have.values(), key=lambda v: (v.get("created", ""), v["id"]))
    DATA.write_text(json.dumps(lib, indent=1, ensure_ascii=False) + "\n")
    print(f"{made} new video(s); {len(lib['videos'])} in data/videos.json")


if __name__ == "__main__":
    main()
