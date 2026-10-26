"""Turn the ChatGPT texture images into game textures.

Usage: python3 art/textures/import_textures.py SRC_DIR

Each source is made to tile, graded towards the night palette (no browns or
beiges: wood and soil go grey-plum), cut to 1024 square and written to
public/textures/<name>.jpg. The mean colour and real-world size of each
texture go to art/textures/out/means.txt and sizes.txt, which the level
builder reads for bounce colour and UV scale.

Tiling: the image is cropped where its content best repeats the first band of
pixels (so bricks and slabs wrap on a whole period), then that band is
cross-faded with what follows the crop, so the last column runs straight into
the first. The fade keeps variance, so noise does not go soft at the seam.
"""
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_JPG = os.path.join(ROOT, "public", "textures")
OUT_META = os.path.join(HERE, "out")

# name: (source file, metres across the full source, search for a repeat?,
#        saturation, rgb multiplier)
SPEC = {
    "brick": ("brick", 0.79, True, 0.85, (1.0, 0.97, 1.02)),
    "brick_dark": ("brick_dark", 0.85, True, 0.9, (1.0, 1.0, 1.04)),
    "boards": ("boards", 1.26, ("gap", True), 0.32, (0.86, 0.84, 0.92)),
    "carpet": ("carpet", 0.9, False, 0.9, (1.0, 1.0, 1.0)),
    "tiles": ("tiles", 1.8, True, 0.6, (0.98, 1.0, 1.04)),
    "tarmac": ("tarmac", 3.0, False, 0.9, (1.0, 1.0, 1.0)),
    "paving": ("paving", 2.4, True, 0.6, (0.98, 1.0, 1.04)),
    "patio": ("patio", 1.8, True, 0.6, (0.98, 1.0, 1.04)),
    "grass": ("grass", 2.0, False, 0.62, (0.82, 0.86, 0.9)),
    "soil": ("soil", 2.0, False, 0.4, (0.92, 0.92, 1.0)),
    "fence": ("fence", 1.5, (False, "gap"), 0.35, (0.92, 0.92, 0.98)),
    "slate": ("slate", 1.5, True, 1.0, (1.0, 1.0, 1.0)),
    "concrete": ("concrete", 3.0, False, 0.6, (0.98, 1.0, 1.03)),
}
SIZE = 1024
BAND = 0.04  # seam band, as a share of the image


def to_lin(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def best_repeat(a, band, search):
    """Width L (L + band <= width) where columns L.. best match columns 0.."""
    n = a.shape[1]
    lum = a @ np.array([0.299, 0.587, 0.114])
    lum = lum - lum.mean()
    ref = lum[:, :band]
    ref = (ref - ref.mean()) / (ref.std() + 1e-6)
    best, best_l = -2.0, n - band
    for L in range(max(band * 2, n - band - search), n - band + 1):
        c = lum[:, L:L + band]
        c = (c - c.mean()) / (c.std() + 1e-6)
        s = float((ref * c).mean())
        if s > best:
            best, best_l = s, L
    return best_l, best


def gap_cut(a, band):
    """For boards: start and end on the darkest gap between planks, so the
    seam hides in a joint. Returns (start, L) with a[:, start:start+L]."""
    n = a.shape[1]
    prof = (a @ np.array([0.299, 0.587, 0.114])).mean(axis=0)
    prof = np.convolve(prof, np.ones(5) / 5, mode="same")
    edge = n // 6
    s = int(np.argmin(prof[band:edge])) + band
    e = int(np.argmin(prof[n - edge - band:n - band])) + n - edge - band
    return s, e - s


def wrap_x(a, band, search):
    """Crop to a repeat and fade the seam band. Works on columns."""
    if search == "gap":
        s, L = gap_cut(a, band)
        a = a[:, s:]
        band = max(4, band // 4)
        score = 1.0
    elif search:
        L, score = best_repeat(a, band, search)
    else:
        L, score = a.shape[1] - band, 0.0
    w = np.linspace(0, 1, band)[None, :, None]  # 0 at the seam, 1 inside
    w = w * w * (3 - 2 * w)
    head = a[:, :band]
    tail = a[:, L:L + band]
    mu = a.mean(axis=(0, 1), keepdims=True)
    k = np.sqrt(w ** 2 + (1 - w) ** 2)
    mixed = ((head - mu) * w + (tail - mu) * (1 - w)) / k + mu
    out = a[:, :L].copy()
    out[:, :band] = mixed
    return out, L, score


def process(name, src_dir):
    src, metres, periodic, sat, mul = SPEC[name]
    img = Image.open(os.path.join(src_dir, src + ".png")).convert("RGB")
    a = np.asarray(img).astype(np.float64) / 255.0
    n = a.shape[1]
    band = max(8, int(n * BAND))
    sx_mode, sy_mode = periodic if isinstance(periodic, tuple) else (periodic, periodic)
    mode = lambda m: "gap" if m == "gap" else (int(n * 0.4) if m else 0)
    a, lx, sx = wrap_x(a, band, mode(sx_mode))
    a = a.transpose(1, 0, 2)
    a, ly, sy = wrap_x(a, band, mode(sy_mode))
    a = a.transpose(1, 0, 2)
    # Grade in linear light: pull saturation, tint.
    lin = to_lin(a)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    lin = lum[..., None] + (lin - lum[..., None]) * sat
    lin = lin * np.array(mul)
    a = to_srgb(lin)
    out = Image.fromarray((a * 255 + 0.5).astype(np.uint8), "RGB").resize((SIZE, SIZE), Image.LANCZOS)
    out.save(os.path.join(OUT_JPG, name + ".jpg"), quality=88, optimize=True)
    # Real width of what is left after the crop (the crop is not square; the
    # resize squashes it a little, so average the two axes).
    size = metres * (lx + ly) / (2 * n)
    mean = np.asarray(out).reshape(-1, 3).mean(axis=0) / 255.0
    print(f"{name:11s} crop {lx}x{ly} of {n} (match {sx:.2f}, {sy:.2f}) -> {size:.2f} m, mean {np.round(mean * 255)}")
    return mean, size


def main():
    src_dir = sys.argv[1]
    os.makedirs(OUT_META, exist_ok=True)
    means = {}
    path = os.path.join(OUT_META, "means.txt")
    if os.path.exists(path):
        for line in open(path):
            k, r, g, b = line.split()
            means[k] = (float(r), float(g), float(b))
    sizes = {}
    for name in SPEC:
        means[name], sizes[name] = process(name, src_dir)
    with open(path, "w") as f:
        for k, (r, g, b) in means.items():
            f.write(f"{k} {r:.4f} {g:.4f} {b:.4f}\n")
    with open(os.path.join(OUT_META, "sizes.txt"), "w") as f:
        for k, s in sizes.items():
            f.write(f"{k} {s:.3f}\n")


if __name__ == "__main__":
    main()
