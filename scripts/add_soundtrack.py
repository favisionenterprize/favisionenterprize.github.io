#!/usr/bin/env python3
"""Give every video in data/videos.json an Afrobeats background track and a short voice-over.

Music: original Afrobeats-style instrumentals made here (log drum, kick, clap, rim on the
3-3-2 groove, shaker, electric-piano chords, highlife guitar plucks, ~106 BPM). They belong
to F.A Vision, so YouTube, Facebook, Instagram and the website won't claim or mute them.
(Real hit songs are copyrighted; on TikTok add one from TikTok's own sound library instead.)
The four beats are also saved as assets/audio/fa-afrobeat-<n>.m4a.

Videos you add yourself in the admin ("Added by me") keep their own sound with the beat
quietly underneath and no voice-over, unless they are silent.

Voice-over: the opening line(s) of the video's own description, read by a Piper neural voice
(offline TTS, https://github.com/rhasspy/piper), cut to fit the video, music ducked under it.

The new soundtrack replaces the video's audio in place (the old file stays in git history).
Each done video gets  "audio": {"music", "voiceover", "voice", "d"}  in data/videos.json and
is skipped next time.

Run:  python3 scripts/add_soundtrack.py               (videos without a soundtrack yet)
      python3 scripts/add_soundtrack.py --force       (redo all)
      python3 scripts/add_soundtrack.py --only tiktok-01-student-desk-price
Needs ffmpeg, numpy and piper-tts (pip install piper-tts); the voice downloads on first run.
"""
import datetime, json, os, re, subprocess, sys, tempfile, urllib.request, wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data/videos.json"
AUDIO = ROOT / "assets/audio"
FORCE = "--force" in sys.argv
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
VOICE = os.environ.get("PIPER_VOICE", "en_US-ryan-high")
VOICE_DIR = Path(os.environ.get("PIPER_DIR", Path.home() / ".cache/piper"))
SR = 44100
BPM = 106
STEP = 60 / BPM / 4  # one 16th note
RNG = np.random.default_rng(7)


# ------------------------------------------------------------------ music
def note(n):
    """MIDI note number -> Hz."""
    return 440.0 * 2 ** ((n - 69) / 12)


def env(n, attack=0.004, decay=0.25):
    t = np.arange(n) / SR
    e = np.exp(-t / decay)
    a = int(attack * SR)
    if a:
        e[:a] *= np.linspace(0, 1, a)
    return e


def kick(dur=0.35):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 48 + 90 * np.exp(-t * 35)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.12)


def clap(dur=0.22):
    n = int(dur * SR)
    x = np.convolve(RNG.standard_normal(n), [1, -0.9], "same")  # brighten
    e = np.zeros(n)
    for off in (0, 0.011, 0.022):  # three hands
        i = int(off * SR); e[i:] += env(n - i, 0.001, 0.035 if off < 0.02 else 0.09)
    return x * e * 0.2


def rim(dur=0.08):
    n = int(dur * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1700 * t) * 0.6 + RNG.standard_normal(n) * 0.25) * env(n, 0.0005, 0.018) * 0.25


def shaker(dur=0.07, accent=1.0):
    n = int(dur * SR)
    x = RNG.standard_normal(n)
    x = x - np.convolve(x, np.ones(4) / 4, "same")  # high-pass-ish
    return x * env(n, 0.006, 0.02) * 0.07 * accent


def log_drum(freq, dur=0.45):
    """Log drum: sine with a quick downward slide and a little grit."""
    n = int(dur * SR); t = np.arange(n) / SR
    f = freq * (1 + 0.6 * np.exp(-t * 40))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    return np.tanh(2.2 * x) * env(n, 0.002, 0.16) * 0.75


def epiano(freqs, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        out += np.sin(2 * np.pi * f * t) + 0.28 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t)
    return out * (1 + 0.12 * np.sin(2 * np.pi * 5.2 * t)) * env(n, 0.006, 0.5) * 0.16


def pluck(freq, dur=0.3):
    """Karplus-Strong guitar pluck (highlife lick)."""
    n = int(dur * SR); p = max(2, int(SR / freq))
    buf = RNG.uniform(-1, 1, p)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = 0.5 * (buf[i % p] + buf[(i + 1) % p]) * 0.996
    return out * env(n, 0.001, 0.22) * 0.32


def put(track, sound, at):
    i = int(at * SR)
    if i >= len(track):
        return
    j = min(len(track), i + len(sound))
    track[i:j] += sound[: j - i]


# one chord per bar (MIDI notes); kick and log-drum steps out of 16
BEATS = [
    {"name": "fa-afrobeat-1", "chords": [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], "kick": [0, 6, 8, 11], "log": [0, 3, 6, 10, 12]},    # Am F C G
    {"name": "fa-afrobeat-2", "chords": [[50, 53, 57], [58, 62, 65], [53, 57, 60], [48, 52, 55]], "kick": [0, 7, 8, 14], "log": [0, 3, 7, 10, 13]},    # Dm Bb F C
    {"name": "fa-afrobeat-3", "chords": [[53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64]], "kick": [0, 6, 8, 12], "log": [0, 3, 6, 9, 12, 14]}, # F G Em Am
    {"name": "fa-afrobeat-4", "chords": [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]], "kick": [0, 3, 8, 11], "log": [0, 4, 6, 10, 12]},    # G Em C D
]


def make_beat(spec, seconds):
    bars = int(np.ceil(seconds / (16 * STEP))) + 1
    track = np.zeros(int((bars * 16 * STEP + 1) * SR))
    lick = [0, 1, 2, 1, 0, 2, 1, 2]
    for b in range(bars):
        ch = spec["chords"][b % 4]
        root = note(ch[0] - 12)
        for s in range(16):
            t = (b * 16 + s) * STEP + (STEP * 0.12 if s % 2 else 0)  # light swing
            if s in spec["kick"]:
                put(track, kick(), t)
            if s in (4, 12):
                put(track, clap(), t)
            if s in (3, 6, 10, 14):  # 3-3-2 rim
                put(track, rim(), t)
            put(track, shaker(accent=1.3 if s % 2 else 0.7), t)
            if s in spec["log"] and b > 0:  # log drum comes in after the first bar
                put(track, log_drum(root * (1.5 if s in (6, 7) else 1)), t)
            if s in (2, 5, 8, 11, 14):  # piano stabs
                put(track, epiano([note(x) for x in ch], STEP * 2.6), t)
            if b % 2 == 1 and s % 2 == 0:  # guitar lick every other bar
                put(track, pluck(note(ch[lick[(s // 2) % 8]] + 12)), t)
    track = track[: int(seconds * SR)]
    track /= np.max(np.abs(track)) + 1e-9
    track = np.tanh(1.8 * track)  # glue: louder body, softer peaks
    track /= np.max(np.abs(track)) + 1e-9
    return (track * 0.9).astype(np.float32)


def write_wav(path, x):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


# ------------------------------------------------------------------ voice-over
def voice_model():
    model = VOICE_DIR / f"{VOICE}.onnx"
    if not model.exists():
        VOICE_DIR.mkdir(parents=True, exist_ok=True)
        lang, speaker, quality = VOICE.split("-")
        base = f"https://huggingface.co/rhasspy/piper-voices/resolve/main/{lang.split('_')[0]}/{lang}/{speaker}/{quality}/{VOICE}"
        for ext in (".onnx", ".onnx.json"):
            print("downloading voice", VOICE + ext)
            urllib.request.urlretrieve(base + ext, str(VOICE_DIR / (VOICE + ext)))
    return model


PRODUCTS = {p["id"]: p for p in json.loads((ROOT / "data/products.json").read_text())}
DIGITS = "zero one two three four five six seven eight nine".split()


WORDS = [(r"\bMon\s*[–-]\s*Sat\b", "Monday to Saturday"), (r"\b(\d+)\s*am\s*[–-]\s*(\d+)\s*pm\b", r"\1 A M to \2 P M"),
         (r"\bopp\.", "opposite"), (r"\bRd\b", "Road"), (r"\best\.", "established"), (r"\(negotiable\)", ", negotiable."),
         (r"\bFA Vision\b", "F A Vision"), (r"\bF\.A\b", "F A"), (r"\bPOV\b", "P O V"), (r"\bSHS\b", "S H S"),
         (r"\bPTA\b", "P T A"), (r"\bDM\b", "D M"), (r"\bGHS\s?([\d,]+)", r"\1 cedis"), (r"(\d)\s*%", r"\1 percent"),
         (r"(\d)\s*[–-]\s*(\d)", r"\1 to \2"), (r"&", " and "), (r"\bFAV-", "")]


def speakable(text):
    # every line is its own sentence (captions often break lines without a full stop)
    lines = [ln.strip() for ln in str(text).splitlines() if ln.strip()]
    t = " ".join(ln if re.search(r"[.!?:]$", re.sub(r"[^\w.!?:)]+$", "", ln)) else re.sub(r"[^\w)]+$", "", ln) + "." for ln in lines)
    t = re.sub(r"https?://\S+|\b\S+\.(?:com|io|org)\S*", "our website", t)
    t = re.sub(r"#\w+", "", t)
    t = re.sub(r"GH[₵¢]\s?([\d,]+)", lambda m: m.group(1).replace(",", "") + " cedis", t)
    for a, b in WORDS:
        t = re.sub(a, b, t)
    t = re.sub(r"\b0(\d{2})\s?(\d{3})\s?(\d{4})\b",
               lambda m: ", ".join(" ".join(DIGITS[int(c)] for c in g) for g in ("0" + m.group(1), m.group(2), m.group(3))), t)
    t = re.sub(r"(\w)\s*[^\w\s.,!?'’:;()&/+-]+\s+(?=[A-Z])", r"\1. ", t)  # an emoji before a capital ends a sentence
    t = t.replace("our website (link in bio)", "our website")
    t = re.sub(r"[^\w\s.,!?'’:;()&/+-]", " ", t)  # emojis and symbols
    t = re.sub(r"\s+([,.!?])", r"\1", re.sub(r"\s+", " ", t))
    return re.sub(r"([,.])[,.]+", r"\1", t).strip(" -:;,")


def script_for(v, seconds):
    """The first sentences of the description that fit the video (about 2.6 words a second)."""
    text = speakable(v.get("description") or v.get("title") or "")
    budget = max(8, int((seconds - 1.8) * 2.6))
    out, words = [], 0
    for s in re.split(r"(?<=[.!?])\s+", text):
        w = len(s.split())
        if not w:
            continue
        if words + w > budget:
            if not out:  # one long sentence: cut it
                out.append(" ".join(s.split()[:budget]).rstrip(",;") + ".")
            break
        out.append(s); words += w
    line = " ".join(out)
    m = re.match(r"fav-(\d+)", v["id"])
    p = PRODUCTS.get(v.get("product") or (m and "FAV-" + m.group(1)) or "", {})
    brand = ((p.get("seller") or {}).get("name") or "F A Vision Enterprise").title().replace("F A", "F A")  # partner products close with their seller
    if brand.split()[0] not in line and words + len(brand.split()) <= budget:
        line += " " + brand + "."
    return line


def tts(text, path):
    subprocess.run([sys.executable, "-m", "piper", "-m", str(voice_model()), "-f", str(path), "--length-scale", "0.92"],
                   input=text.encode(), check=True, capture_output=True)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def loudness(path):
    """Mean volume in dB (-99 when the video has no sound)."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    m = re.search(r"mean_volume: (-?[\d.]+) dB", out)
    return float(m.group(1)) if m else -99.0


# ------------------------------------------------------------------ main
def main():
    data = json.loads(DATA.read_text())
    removed = set(data.get("removed", []))
    AUDIO.mkdir(parents=True, exist_ok=True)
    for spec in BEATS:  # shareable copies of the beats
        m4a = AUDIO / f"{spec['name']}.m4a"
        if not m4a.exists() or FORCE:
            with tempfile.TemporaryDirectory() as tmp:
                wav = Path(tmp) / "b.wav"
                write_wav(wav, make_beat(spec, 32))
                subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-af", "afade=t=out:st=30:d=2",
                                "-c:a", "aac", "-b:a", "128k", str(m4a)], check=True)
    done = 0
    for i, v in enumerate(data["videos"]):
        if v["id"] in removed or (ONLY and v["id"] != ONLY) or (v.get("audio") and not FORCE and not ONLY):
            continue
        src = ROOT / v["file"]
        if not src.exists():
            continue
        secs = duration(src)
        if secs < 3:
            continue
        spec = BEATS[i % len(BEATS)]
        # A video you recorded yourself (admin "Add videos") keeps your own sound: the beat goes
        # quietly underneath it and no voice-over is added, unless the video is silent.
        own = v.get("source") == "upload" and loudness(src) > -45
        line = "" if own else script_for(v, secs)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            music, vo, out = tmp / "m.wav", tmp / "v.wav", tmp / "o.mp4"
            write_wav(music, make_beat(spec, secs + 0.5))
            fade = max(0, secs - 1.2)
            if own:
                voice_in = ["-i", str(src)]
                lead = "[2:a]apad,volume=1.0[v];"
            else:
                tts(line, vo)
                speed = min(1.25, max(1.0, duration(vo) / (secs - 1.3)))
                voice_in = ["-i", str(vo)]
                lead = f"[2:a]atempo={speed:.3f},adelay=500|500,apad,volume=1.35[v];"  # voice from 0.5 s
            # music ducks under the voice; both fade out at the end
            fc = (f"[1:a]volume={0.35 if own else 0.55}[m];{lead}"
                  f"[v]asplit[v1][v2];[m][v2]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=350[md];"
                  f"[md][v1]amix=inputs=2:duration=first:normalize=0,atrim=0:{secs:.2f},afade=t=in:d=0.3,"
                  f"afade=t=out:st={fade:.2f}:d=1.2,alimiter=limit=0.9[a]")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-i", str(music), *voice_in,
                            "-filter_complex", fc, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy",
                            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-t", f"{secs:.2f}",
                            "-movflags", "+faststart", str(out)], check=True)
            out.replace(src)
        v["audio"] = {"music": spec["name"], "voiceover": line, "voice": "" if own else VOICE, "own_sound": own,
                      "d": datetime.date.today().isoformat()}
        if v.get("size_mb") is not None:
            v["size_mb"] = round(src.stat().st_size / 1e6, 1)
        done += 1
        print(f"♪ {v['id']}: {spec['name']} + " + (f"“{line}”" if line else "your own sound"))
    DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    print(f"{done} video(s) got a soundtrack.")


if __name__ == "__main__":
    main()
