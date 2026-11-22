"""Build the animated GIFs shown in README.md from the committed screenshots.

Usage (from the repo root):
    pip install pillow
    python scripts/make_readme_gifs.py

Output goes to docs/media/. Re-run after replacing the screenshots in
docs/screenshots/ to refresh every GIF.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "docs" / "screenshots"
REPORT_SHOTS = ROOT / "reports" / "screenshots"
OUT = ROOT / "docs" / "media"
OUT.mkdir(parents=True, exist_ok=True)

# Brand palette (sampled from the dashboard sidebar)
NAVY = (11, 30, 48)
NAVY_2 = (16, 46, 66)
GREEN = (22, 163, 74)
MINT = (134, 239, 172)
WHITE = (255, 255, 255)
MUTED = (148, 163, 184)


def font(size: int, weight: str = "SemiBold", bangla: bool = False) -> ImageFont.FreeTypeFont:
    candidates = []
    if bangla:
        candidates += [
            os.environ.get("BANGLA_FONT", ""),
            "/mnt/skills/plugins/bangla-motion-explainer/assets/fonts/HindSiliguri-Bold.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansBengali-Bold.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
            "C:/Windows/Fonts/Nirmala.ttc",
            "C:/Windows/Fonts/Nirmala.ttf",
            "/System/Library/Fonts/Supplemental/Bangla MN.ttc",
        ]
    candidates += [
        f"/usr/share/fonts/opentype/inter/Inter-{weight}.otf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ]
    for c in candidates:
        if c and Path(c).exists():
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def ease(t: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * t)


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return m


def gradient_bg(size, top=NAVY, bottom=(6, 18, 30)):
    w, h = size
    bg = Image.new("RGB", size, top)
    d = ImageDraw.Draw(bg)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    # soft green glow in the top-left corner
    glow = Image.new("L", size, 0)
    ImageDraw.Draw(glow).ellipse([-w // 3, -h // 2, w // 2, h // 2], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    bg.paste(Image.new("RGB", size, GREEN), (0, 0), glow)
    return bg


def save_gif(frames, durations, name, dither="none"):
    """Encode with ffmpeg (one optimised palette for all frames + delta
    rectangles). Falls back to Pillow if ffmpeg is not installed."""
    import shutil
    import subprocess
    import tempfile

    path = OUT / name
    if shutil.which("ffmpeg"):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            lines = []
            for i, (f, d) in enumerate(zip(frames, durations)):
                fp = tmp / f"f{i:04d}.png"
                f.save(fp)
                lines += [f"file '{fp}'", f"duration {d / 1000:.3f}"]
            lines.append(f"file '{tmp / f'f{len(frames) - 1:04d}.png'}'")
            (tmp / "list.txt").write_text("\n".join(lines))
            vf = ("split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];"
                  f"[b][p]paletteuse=dither={dither}:diff_mode=rectangle")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                            "-i", str(tmp / "list.txt"), "-vf", vf, "-loop", "0", str(path)], check=True)
    else:
        pal = [f.quantize(colors=256, dither=Image.Dither.NONE) for f in frames]
        pal[0].save(path, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True)
    print(f"{name}: {len(frames)} frames, {path.stat().st_size / 1e6:.2f} MB")


# --------------------------------------------------------------------------
# 1. Full product tour inside a browser window
# --------------------------------------------------------------------------
TOUR = [
    ("intro", "/", "Interactive intro", "Swat the mosquito to enter — skippable, respects reduced motion"),
    ("command", "/", "Command Center", "Next weeks' forecast, validated accuracy and a time machine"),
    ("profiling", "/profiling", "Data Profiling Studio", "Health, distributions, seasonality and rainfall-lag analysis"),
    ("wards", "/wards", "Ward Risk Explorer", "All 60 wards ranked by risk tier and outbreak alert"),
    ("geography", "/geography", "Map & Emergency Routing", "914 real hospitals · A* road routing · nearest care"),
    ("lab", "/lab", "AI Forecast Lab", "2 / 3 / 4-week horizons, drivers and uncertainty fans"),
    ("copilot", "/copilot", "Research Copilot", "Grounded answers with citations, in English and Bangla"),
    ("evidence", "/evidence", "Model Evidence", "Reliability center and alert-policy simulator"),
    ("response", "/response", "Response Intelligence", "Resource sandbox: risk-blind vs history vs forecast"),
    ("climate", "/climate", "Climate Observatory", "Real NASA POWER + Open-Meteo beside the organizer data"),
    ("learn", "/learn", "Learn", "From rainfall to cases — with a 3D Aedes mosquito"),
    ("provenance", "/provenance", "System & Provenance", "Checksums, versions and live integration status"),
]


def load_tour_image(key: str) -> Image.Image:
    p = SHOTS / "after" / f"{key}.png"
    if not p.exists():
        p = SHOTS / f"{key}.png"
    return Image.open(p).convert("RGB").resize((1440, 900))


def browser_frame(shot: Image.Image, url: str, title: str, sub: str, step: int, total: int,
                  caption_alpha: float = 1.0, W: int = 960) -> Image.Image:
    pad, bar = 28, 38
    sw = W - 2 * pad
    sh = round(sw * 900 / 1440)
    H = pad + bar + sh + 92
    canvas = gradient_bg((W, H))

    # window shadow
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([pad, pad + 8, pad + sw, pad + bar + sh + 8], 14, fill=150)
    canvas.paste((0, 0, 0), (0, 0), shadow.filter(ImageFilter.GaussianBlur(14)))

    win = Image.new("RGB", (sw, bar + sh), (241, 245, 249))
    d = ImageDraw.Draw(win)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([14 + i * 20, 13, 26 + i * 20, 25], fill=c)
    d.rounded_rectangle([90, 8, sw - 90, 30], 11, fill=WHITE)
    d.ellipse([104, 14, 114, 24], fill=GREEN)
    d.text((124, 11), f"dengueshield.ai{url}", font=font(13, "Medium"), fill=(71, 85, 105))
    win.paste(shot.resize((sw, sh), Image.LANCZOS), (0, bar))
    canvas.paste(win, (pad, pad), rounded_mask(win.size, 12))

    # progress dots
    cy = pad + bar + sh + 26
    dot_w = 14 * total
    x0 = (W - dot_w) // 2
    dd = ImageDraw.Draw(canvas)
    for i in range(total):
        x = x0 + i * 14
        if i == step:
            dd.rounded_rectangle([x - 4, cy - 3, x + 14, cy + 3], 3, fill=MINT)
        else:
            dd.ellipse([x + 2, cy - 3, x + 8, cy + 3], fill=(51, 65, 85))

    # caption
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    a = int(255 * caption_alpha)
    t_font, s_font = font(22, "Bold"), font(14, "Medium")
    tw = ld.textlength(title, font=t_font)
    sw2 = ld.textlength(sub, font=s_font)
    ld.text(((W - tw) / 2, cy + 14), title, font=t_font, fill=(255, 255, 255, a))
    ld.text(((W - sw2) / 2, cy + 44), sub, font=s_font, fill=(*MUTED, a))
    canvas.paste(layer, (0, 0), layer)
    return canvas


def build_tour():
    imgs = [load_tour_image(k) for k, *_ in TOUR]
    frames, durs = [], []
    n = len(TOUR)
    steps = 9
    for i, (key, url, title, sub) in enumerate(TOUR):
        frames.append(browser_frame(imgs[i], url, title, sub, i, n))
        durs.append(2300 if i else 1900)
        nxt = (i + 1) % n
        a, b = imgs[i], imgs[nxt]
        for s in range(1, steps + 1):
            # wipe transition: the next page sweeps in behind a glowing edge.
            # Only the swept strip changes per frame, which keeps the GIF small.
            t = ease(s / (steps + 1))
            x = int(1440 * t)
            mix = a.copy()
            mix.paste(b.crop((0, 0, x, 900)), (0, 0))
            d = ImageDraw.Draw(mix)
            d.rectangle([x - 3, 0, x + 3, 900], fill=MINT)
            cur, step = (TOUR[nxt], nxt) if t >= 0.5 else (TOUR[i], i)
            frames.append(browser_frame(mix, cur[1], cur[2], cur[3], step, n))
            durs.append(40)
    save_gif(frames, durs, "tour.gif")


# --------------------------------------------------------------------------
# 2. English ↔ বাংলা wipe
# --------------------------------------------------------------------------
def build_bilingual():
    en = Image.open(REPORT_SHOTS / "cmd-desktop.png").convert("RGB").crop((0, 0, 1440, 1000))
    bn = Image.open(SHOTS / "command-bangla.png").convert("RGB").crop((0, 0, 1440, 1000))
    W = 900
    H = round(W * 1000 / 1440)
    en, bn = en.resize((W, H), Image.LANCZOS), bn.resize((W, H), Image.LANCZOS)
    f_en, f_bn = font(18, "Bold"), font(20, bangla=True)

    def frame(p):
        x = int(W * p)
        img = en.copy()
        img.paste(bn.crop((x, 0, W, H)), (x, 0))
        d = ImageDraw.Draw(img, "RGBA")
        d.rectangle([x - 2, 0, x + 2, H], fill=(*MINT, 255))
        d.ellipse([x - 20, H // 2 - 20, x + 20, H // 2 + 20], fill=(*NAVY, 240), outline=MINT, width=3)
        d.text((x - 10, H // 2 - 14), "↔", font=font(22, "Bold"), fill=MINT)
        if x > 120:
            d.rounded_rectangle([16, H - 52, 126, H - 16], 18, fill=(*NAVY, 230))
            d.text((34, H - 46), "English", font=f_en, fill=WHITE)
        if x < W - 120:
            d.rounded_rectangle([W - 126, H - 52, W - 16, H - 16], 18, fill=(*GREEN, 235))
            d.text((W - 100, H - 50), "বাংলা", font=f_bn, fill=WHITE)
        return img

    frames, durs = [], []
    path = [1.0] * 1 + [1 - ease(i / 22) for i in range(1, 23)] + [0.0] + [ease(i / 22) for i in range(1, 23)]
    for k, p in enumerate(path):
        frames.append(frame(p))
        durs.append(1400 if k in (0, 23) else 45)
    save_gif(frames, durs, "bilingual.gif")


# --------------------------------------------------------------------------
# 3. Emergency routing (route ↔ nearest hospitals)
# --------------------------------------------------------------------------
def build_routing():
    a = Image.open(SHOTS / "map-route-desktop.png").convert("RGB")
    b = Image.open(SHOTS / "map-nearest-desktop.png").convert("RGB")
    W = 900
    H = round(W * a.height / a.width)
    a, b = a.resize((W, H), Image.LANCZOS), b.resize((W, H), Image.LANCZOS)
    labels = ["A* route · fastest vs shortest (verified vs Dijkstra)", "Nearest hospitals ranked by road time"]

    def tag(img, text, alpha=1.0):
        img = img.copy()
        d = ImageDraw.Draw(img, "RGBA")
        f = font(17, "SemiBold")
        tw = d.textlength(text, font=f)
        d.rounded_rectangle([16, 16, 16 + tw + 44, 54], 19, fill=(*NAVY, int(235 * alpha)))
        d.ellipse([30, 30, 40, 40], fill=(*MINT, int(255 * alpha)))
        d.text((50, 24), text, font=f, fill=(255, 255, 255, int(255 * alpha)))
        return img

    frames, durs = [], []
    for src, dst, lab_a, lab_b in [(a, b, labels[0], labels[1]), (b, a, labels[1], labels[0])]:
        frames.append(tag(src, lab_a)); durs.append(2200)
        for s in range(1, 9):
            t = ease(s / 9)
            frames.append(tag(Image.blend(src, dst, t), lab_a if t < 0.5 else lab_b, abs(t - 0.5) * 2))
            durs.append(50)
    save_gif(frames, durs, "routing.gif")


# --------------------------------------------------------------------------
# 4. Three phones scrolling at once
# --------------------------------------------------------------------------
def build_mobile():
    names = [("command-mobile.png", "Command Center"), ("wards-mobile.png", "Ward Risk"), ("lab-mobile.png", "Forecast Lab")]
    scr_w, scr_h = 240, 500
    shots = []
    for n, _ in names:
        im = Image.open(SHOTS / n).convert("RGB")
        im = im.resize((scr_w, round(im.height * scr_w / im.width)), Image.LANCZOS)
        shots.append(im)
    W, H = 900, 640
    bg = gradient_bg((W, H))
    bezel = 12
    pw, ph = scr_w + 2 * bezel, scr_h + 2 * bezel
    gap = (W - 3 * pw) // 4
    f = font(15, "SemiBold")
    max_scroll = 1400  # px of each page shown (scaled)
    n_frames = 36
    frames, durs = [], []
    for k in range(n_frames + 1):
        t = ease(k / n_frames)
        img = bg.copy()
        d = ImageDraw.Draw(img)
        for i, shot in enumerate(shots):
            x = gap + i * (pw + gap)
            y = 44 + (18 if i == 1 else 0)
            sh = Image.new("L", (W, H), 0)
            ImageDraw.Draw(sh).rounded_rectangle([x, y + 10, x + pw, y + ph + 10], 34, fill=160)
            img.paste((0, 0, 0), (0, 0), sh.filter(ImageFilter.GaussianBlur(12)))
            d.rounded_rectangle([x, y, x + pw, y + ph], 34, fill=(15, 23, 42), outline=(71, 85, 105), width=2)
            off = int(min(max_scroll, shot.height - scr_h) * t)
            screen = shot.crop((0, off, scr_w, off + scr_h))
            img.paste(screen, (x + bezel, y + bezel), rounded_mask(screen.size, 24))
            d.rounded_rectangle([x + pw // 2 - 34, y + bezel + 6, x + pw // 2 + 34, y + bezel + 22], 8, fill=(15, 23, 42))
            lab = names[i][1]
            d.text((x + (pw - d.textlength(lab, font=f)) / 2, y + ph + 22), lab, font=f, fill=WHITE)
        frames.append(img)
        durs.append(1200 if k in (0, n_frames) else 80)
    # scroll back up quickly so the loop is seamless
    for k in range(1, 9):
        frames.append(frames[n_frames - round(k * n_frames / 8)]); durs.append(45)
    save_gif(frames, durs, "mobile.gif")


if __name__ == "__main__":
    build_tour()
    build_bilingual()
    build_routing()
    build_mobile()
