"""Turns ambientCG floor surfaces into worn, lived-in game floors.

Run:  python3 art/assets/make_floors.py      (after art/assets/ambientcg.py)

Each source is graded towards the night palette (no browns or beiges), then
dirtied: tileable blotches of grime, a few wrapped-round stains and a light
speckle of grit, so no floor reads as showroom clean. Writes
public/textures/<name>.jpg and adds its mean colour and real size to
art/textures/out/means.txt and sizes.txt for the level builder.
"""
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(HERE, "ambientcg")
OUT = os.path.join(ROOT, "public", "textures")
META = os.path.join(ROOT, "art", "textures", "out")
SIZE = 1024

# name: (ambientCG id, metres across, saturation, rgb multiplier, grime 0..1)
FLOORS = {
    "carpet_navy": ("Carpet012", 1.0, 0.8, (0.95, 0.97, 1.05), 0.7),
    "carpet_red": ("Carpet013", 1.0, 0.75, (1.0, 0.9, 0.95), 0.8),
    "carpet_grey": ("Carpet003", 1.2, 0.5, (0.9, 0.92, 1.0), 0.75),
    "carpet_council": ("Carpet006", 1.4, 0.6, (0.9, 0.95, 1.0), 0.85),
    "carpet_olive": ("Carpet011", 1.0, 0.45, (0.85, 0.9, 0.92), 0.85),
    "carpet_teal": ("Carpet005", 1.6, 0.55, (0.85, 0.92, 0.98), 0.8),
    "lino_check": ("Tiles012", 1.2, 0.3, (0.82, 0.84, 0.9), 0.9),
    "lino_marble": ("Tiles074", 1.2, 0.25, (0.8, 0.82, 0.88), 0.9),
    "tiles_white": ("Tiles107", 1.6, 0.2, (0.85, 0.87, 0.92), 0.8),
    "tiles_slab": ("Tiles084", 2.4, 0.4, (0.9, 0.92, 0.98), 0.6),
    "boards_worn": ("WoodFloor041", 1.6, 0.25, (0.72, 0.72, 0.8), 0.6),
    "boards_old": ("WoodFloor043", 1.6, 0.25, (0.7, 0.7, 0.78), 0.7),
    "concrete_floor": ("Concrete034", 2.4, 0.3, (0.8, 0.82, 0.88), 0.9),
}


def periodic_noise(rng, n, scale):
    """Tileable noise: white noise low-passed in the frequency domain."""
    f = np.fft.fftfreq(n)
    k = np.sqrt(f[:, None] ** 2 + f[None, :] ** 2)
    spec = np.fft.fft2(rng.standard_normal((n, n))) * np.exp(-(k * scale) ** 2)
    a = np.real(np.fft.ifft2(spec))
    return (a - a.mean()) / (a.std() + 1e-9)


def stains(rng, n, count):
    """Dark rings and puddles that wrap round the edges."""
    yy, xx = np.mgrid[0:n, 0:n]
    m = np.zeros((n, n))
    for _ in range(count):
        cx, cy = rng.uniform(0, n, 2)
        r = rng.uniform(0.03, 0.12) * n
        dx = (xx - cx + n / 2) % n - n / 2
        dy = (yy - cy + n / 2) % n - n / 2
        d = np.sqrt(dx ** 2 * rng.uniform(0.6, 1.4) + dy ** 2) / r
        m = np.maximum(m, np.clip(1 - d, 0, 1) ** 0.6 * rng.uniform(0.3, 0.8))
        m = np.maximum(m, np.exp(-((d - 1) ** 2) / 0.004) * 0.18)  # tide mark
    return m


def make(name, spec, seed):
    acg, metres, sat, mult, grime = spec
    img = Image.open(os.path.join(SRC, acg, f"{acg}_Color.jpg")).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    a = np.asarray(img, dtype=np.float64) / 255.0
    grey = a @ np.array([0.299, 0.587, 0.114])
    a = grey[..., None] + (a - grey[..., None]) * sat
    a *= np.array(mult)
    rng = np.random.default_rng(seed)
    blot = 1 / (1 + np.exp(-(periodic_noise(rng, SIZE, 260) * 1.6 + 0.6 * periodic_noise(rng, SIZE, 90) - 0.4)))
    fine = periodic_noise(rng, SIZE, 6)
    dark = 1 - grime * (0.42 * blot + 0.5 * stains(rng, SIZE, 5) * grime)
    a *= dark[..., None]
    a *= (1 + 0.06 * grime * fine)[..., None]
    grit = rng.random((SIZE, SIZE)) < 0.004 * grime
    a[grit] *= 0.45
    a = np.clip(a, 0, 1)
    Image.fromarray((a * 255).astype(np.uint8)).save(os.path.join(OUT, f"{name}.jpg"), quality=88)
    return a.reshape(-1, 3).mean(0), metres  # sRGB, like the rest of means.txt


def upsert(path, rows):
    keep = [l for l in open(path) if l.split()[0] not in rows] if os.path.exists(path) else []
    with open(path, "w") as f:
        f.writelines(keep)
        for k, v in rows.items():
            f.write(f"{k} {v}\n")


if __name__ == "__main__":
    means, sizes = {}, {}
    for i, (name, spec) in enumerate(FLOORS.items()):
        mean, metres = make(name, spec, 100 + i)
        means[name] = " ".join(f"{c:.4f}" for c in mean)
        sizes[name] = f"{metres:.3f}"
        print(name, means[name])
    upsert(os.path.join(META, "means.txt"), means)
    upsert(os.path.join(META, "sizes.txt"), sizes)
