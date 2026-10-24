"""Seamless 10 s title loop from the crew still: rain, sodium lamp flicker, puddle shimmer, haze, grain.

Everything is a function of the phase t/T, so frame 300 equals frame 0.
Usage: python3 make_loop.py crew.webp crewcut.webp outdir [--front-rain]
"""
import sys, os, numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, cut, out = sys.argv[1:4]
FRONT = '--front-rain' in sys.argv
RAIN_ONLY = '--rain-only' in sys.argv  # just the rain falling over the crew, on black, for a screen-blended layer over the crew cut-out  # rain over the crew too (the standalone video); off for the game, where the cut layer sits on top
W, H, FPS, SEC = 1920, 1080, 30, 10
N = FPS * SEC
rng = np.random.default_rng(7)
os.makedirs(out, exist_ok=True)

base = np.asarray(Image.open(src).convert('RGB').resize((W, H)), np.float32) / 255
alpha = np.asarray(Image.open(cut).convert('RGBA').resize((W, H)))[..., 3].astype(np.float32) / 255
crew = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), np.float32)[..., None] / 255

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
LX, LY = 950, 162
d2 = (xx - LX) ** 2 + (yy - LY) ** 2
glow = np.exp(-d2 / (2 * 260 ** 2))[..., None]          # lamp pool in the air
core = np.exp(-d2 / (2 * 60 ** 2))[..., None]
warm = np.clip((base[..., 0] - base[..., 2]) * 2.2, 0, 1)[..., None]  # orange-lit pixels (sky, wet ground) follow the lamp
ground = np.clip((yy - 700) / 140, 0, 1)[..., None]

def flicker(p):
    """Lamp level for loop phase p in [0,1): a steady buzz with two stutters, at 3.1 s and 7.4 s."""
    v = 1 + 0.025 * np.sin(2 * np.pi * 7 * p) + 0.015 * np.sin(2 * np.pi * 23 * p)
    for c, w, depth in ((0.31, 0.012, 0.6), (0.335, 0.008, 0.4), (0.74, 0.02, 0.45)):
        dp = min(abs(p - c), 1 - abs(p - c))
        v -= depth * np.exp(-(dp / w) ** 2)
    return v

def rain_tex(n, length, width, bright, seed):
    """A tile (H x W) of slanted streaks that wraps both ways."""
    r = np.random.default_rng(seed)
    im = Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(im)
    for _ in range(n):
        x, y = r.uniform(0, W), r.uniform(0, H)
        L = length * r.uniform(0.6, 1.2)
        b = int(255 * bright * r.uniform(0.4, 1))
        for ox in (-W, 0, W):
            for oy in (-H, 0, H):
                dr.line([(x + ox, y + oy), (x + ox - L * 0.07, y + oy + L)], fill=b, width=width)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255

layers = [  # (tile, loops of the tile height per 10 s)
    (rain_tex(900, 26, 1, 0.35, 1), 7),
    (rain_tex(450, 55, 2, 0.45, 2), 11),
    (rain_tex(120, 120, 3, 0.4, 3), 16),
]
rainlight = 0.1 + 1.3 * glow[..., 0] + 0.2 * ground[..., 0]

# Haze: soft noise that sways and returns
hz = Image.fromarray((rng.random((27, 48)) * 255).astype(np.uint8)).resize((W + 200, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(30))
haze = np.asarray(hz, np.float32) / 255

# Splashes on the wet ground: fixed spots, each flashing once per loop at its own phase
splashes = [(rng.uniform(0, W), rng.uniform(820, H), rng.random(), rng.uniform(0.5, 1)) for _ in range(160)]

for f in [int(a) for a in os.environ["FRAMES"].split(",")] if os.environ.get("FRAMES") else range(N):
    p = f / N
    lamp = flicker(p)
    img = base * np.maximum(1 + (lamp - 1) * (0.55 * warm + 0.5 * glow + 0.4 * core), 0.45) + max(lamp - 0.97, 0) * 0.35 * core * np.array([1, 0.55, 0.2])

    # Puddle shimmer: wavy horizontal displacement on the ground, kept off the boots
    dx = (np.sin(yy * 0.09 + 2 * np.pi * 3 * p) * 2.2 + np.sin(yy * 0.031 - 2 * np.pi * 2 * p + xx * 0.004) * 1.6) * ground[..., 0]
    sx = np.clip(xx + dx, 0, W - 1)
    x0 = sx.astype(np.int32); fr = (sx - x0)[..., None]; x1 = np.minimum(x0 + 1, W - 1)
    yi = yy.astype(np.int32)
    shim = img[yi, x0] * (1 - fr) + img[yi, x1] * fr
    m = ground * (1 - crew)
    img = img * (1 - m) + shim * m

    # Haze drifting across the lamp light
    off = int(100 + 100 * np.sin(2 * np.pi * p))
    img += (haze[:, off:off + W, None] * 0.07 * (0.4 + glow * 1.5) * lamp) * np.array([1, 0.6, 0.3])

    # Rain
    rain = np.zeros((H, W), np.float32)
    for tile, k in layers:
        rain += np.roll(tile, int(round(k * H * p)) % H, axis=0)
    rain *= rainlight * lamp
    if RAIN_ONLY:
        r = rain * crew[..., 0] * 0.8
        Image.fromarray((np.clip(r[..., None] * np.array([1, 0.78, 0.55]), 0, 1) * 255).astype(np.uint8)).resize((1280, 720), Image.LANCZOS).save(f'{out}/f{f:03d}.jpg', quality=95)
        continue
    if not FRONT:
        rain *= 1 - crew[..., 0]
    img += rain[..., None] * np.array([1, 0.78, 0.55])

    # Splashes
    sp = Image.new('L', (W, H), 0)
    ds = ImageDraw.Draw(sp)
    for x, y, ph, s in splashes:
        a = (p - ph) % 1 * SEC  # seconds since this splash
        if a < 0.18:
            r = 2 + 10 * a / 0.18 * s
            ds.ellipse([x - r, y - r * 0.3, x + r, y + r * 0.3], outline=int(200 * (1 - a / 0.18)), width=1)
    img += (np.asarray(sp, np.float32)[..., None] / 255) * 0.5 * (0.4 + 2 * glow) * np.array([1, 0.75, 0.5])

    # Grain
    img += np.random.default_rng(f).normal(0, 0.018, (H, W, 1)).astype(np.float32)
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(f'{out}/f{f:03d}.jpg', quality=95)
    if f % 50 == 0:
        print(f, flush=True)
