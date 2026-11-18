"""Generate the AntiShort icons (original artwork: a portrait video frame under a "no" sign).

Outputs
  chrome-extension/icons/icon{16,32,48,128}.png  rounded square, transparent corners
  mobile-app/assets/icon.png                        1024x1024, full-bleed, no alpha (iOS masks it)
  mobile-app/assets/splash-icon.png                 1024x1024 symbol on transparent background
  mobile-app/assets/adaptive-icon.png               Android adaptive icon foreground: symbol inside the
                                                    safe zone, transparent (background color in app.json)
  mobile-app/assets/adaptive-icon-monochrome.png    Android 13+ themed icon: one-color silhouette

Usage (from the repository root):  python scripts/generate-icons.py
Requires Pillow (pip install pillow). The generated PNGs are committed, so this only needs to run
if you change the artwork.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SUPERSAMPLE = 4
BASE = 1024

BG_TOP = (36, 36, 44)
BG_BOTTOM = (16, 16, 20)
FRAME = (245, 245, 247)
PLAY = (30, 30, 36)
RED = (234, 67, 53)


def background(size: int) -> Image.Image:
    """Vertical gradient, RGB."""
    img = Image.new("RGB", (size, size), BG_BOTTOM)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
        draw.line([(0, y), (size, y)], fill=color)
    return img


def symbol(size: int) -> Image.Image:
    """Portrait video frame with a play mark, crossed by a red prohibition sign. RGBA."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size / BASE

    # Portrait "short video" frame.
    fw, fh = 330 * s, 520 * s
    fx0, fy0 = (size - fw) / 2, (size - fh) / 2
    draw.rounded_rectangle([fx0, fy0, fx0 + fw, fy0 + fh], radius=64 * s, fill=FRAME)

    # Play mark inside the frame.
    cx, cy, r = size / 2 + 12 * s, size / 2, 92 * s
    draw.polygon([(cx - r * 0.8, cy - r), (cx - r * 0.8, cy + r), (cx + r, cy)], fill=PLAY)

    # Prohibition ring + slash.
    ring_r, width = 400 * s, 64 * s
    c = size / 2
    draw.ellipse([c - ring_r, c - ring_r, c + ring_r, c + ring_r], outline=RED, width=round(width))
    off = (ring_r - width / 2) * 0.7071
    draw.line([(c - off, c - off), (c + off, c + off)], fill=RED, width=round(width))
    return img


# Android adaptive icons: 108 dp canvas, launchers may crop to a 66 dp circle. The symbol (ring
# diameter ~84% of its canvas) is scaled so the whole ring stays inside that circle with a margin.
ADAPTIVE_SCALE = 0.66


def symbol_monochrome(size: int) -> Image.Image:
    """Same symbol as one-color silhouette (white + alpha); the system tints it. Play mark and a gap
    around the slash are cut out so the shapes stay readable in a single color."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    s = size / BASE
    white, clear = (255, 255, 255, 255), (0, 0, 0, 0)

    fw, fh = 330 * s, 520 * s
    fx0, fy0 = (size - fw) / 2, (size - fh) / 2
    draw.rounded_rectangle([fx0, fy0, fx0 + fw, fy0 + fh], radius=64 * s, fill=white)

    cx, cy, r = size / 2 + 12 * s, size / 2, 92 * s
    draw.polygon([(cx - r * 0.8, cy - r), (cx - r * 0.8, cy + r), (cx + r, cy)], fill=clear)

    ring_r, width = 400 * s, 64 * s
    c = size / 2
    draw.ellipse([c - ring_r, c - ring_r, c + ring_r, c + ring_r], outline=white, width=round(width))
    off = (ring_r - width / 2) * 0.7071
    draw.line([(c - off, c - off), (c + off, c + off)], fill=clear, width=round(width + 40 * s))
    draw.line([(c - off, c - off), (c + off, c + off)], fill=white, width=round(width))
    return img


def adaptive_foreground(size: int, monochrome: bool = False) -> Image.Image:
    """Symbol scaled into the adaptive-icon safe zone, centered on a transparent canvas."""
    big = size * SUPERSAMPLE
    inner = round(big * ADAPTIVE_SCALE)
    sym = (symbol_monochrome(big) if monochrome else symbol(big)).resize((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    offset = (big - inner) // 2
    canvas.alpha_composite(sym, (offset, offset))
    return canvas.resize((size, size), Image.LANCZOS)


def render(size: int, rounded: bool, with_background: bool = True) -> Image.Image:
    big = size * SUPERSAMPLE
    sym = symbol(big)
    if not with_background:
        return sym.resize((size, size), Image.LANCZOS)
    canvas = background(big).convert("RGBA")
    canvas.alpha_composite(sym)
    if rounded:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 0.22), fill=255)
        canvas.putalpha(mask)
        return canvas.resize((size, size), Image.LANCZOS)
    return canvas.convert("RGB").resize((size, size), Image.LANCZOS)


def main() -> None:
    ext_dir = ROOT / "chrome-extension" / "icons"
    app_dir = ROOT / "mobile-app" / "assets"
    ext_dir.mkdir(parents=True, exist_ok=True)
    app_dir.mkdir(parents=True, exist_ok=True)

    for size in (16, 32, 48, 128):
        render(size, rounded=True).save(ext_dir / f"icon{size}.png", optimize=True)
    render(1024, rounded=False).save(app_dir / "icon.png", optimize=True)
    render(1024, rounded=False, with_background=False).save(app_dir / "splash-icon.png", optimize=True)
    adaptive_foreground(1024).save(app_dir / "adaptive-icon.png", optimize=True)
    adaptive_foreground(1024, monochrome=True).save(app_dir / "adaptive-icon-monochrome.png", optimize=True)
    print("icons written to", ext_dir, "and", app_dir)


if __name__ == "__main__":
    main()
