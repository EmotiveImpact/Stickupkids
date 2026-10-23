"""Generates the tileable albedo textures used by the level.

Run:  python3 art/textures/make_textures.py
Writes PNG masters to art/textures/out/ and JPEGs to public/textures/.

Everything is procedural and periodic (noise is filtered white noise in the
frequency domain), so every texture tiles without seams. Colours follow the
style guide: no browns or beiges, wood and brick lean charcoal and plum.
Lighting is baked separately in Blender, so these carry colour only, with a
little painted-in occlusion in mortar lines, grout and plank gaps.
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
PUB = os.path.join(HERE, "..", "..", "public", "textures")
os.makedirs(OUT, exist_ok=True)
os.makedirs(PUB, exist_ok=True)

N = 1024


def rng(seed):
    return np.random.default_rng(seed)


def noise(n, seed, lo=2.0, hi=None, beta=1.0, m=None):
    """Periodic fractal noise in [0,1]. lo/hi are frequency bounds in cycles per tile."""
    m = m or n
    r = rng(seed)
    w = r.standard_normal((m, n))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(m) * m
    fx = np.fft.fftfreq(n) * n
    f = np.sqrt(fx[None, :] ** 2 + fy[:, None] ** 2)
    f[0, 0] = 1
    amp = 1.0 / f ** beta
    amp[f < lo] = 0
    if hi:
        amp *= np.exp(-((f / hi) ** 2))
    out = np.real(np.fft.ifft2(F * amp))
    out -= out.min()
    out /= out.max() + 1e-9
    return out


def aniso(n, seed, sx, sy, beta=1.0):
    """Noise stretched along x (sx < sy gives streaks running along x)."""
    r = rng(seed)
    w = r.standard_normal((n, n))
    F = np.fft.fft2(w)
    fy = np.fft.fftfreq(n) * n
    fx = np.fft.fftfreq(n) * n
    f = np.sqrt((fx[None, :] * sx) ** 2 + (fy[:, None] * sy) ** 2)
    f[0, 0] = 1
    amp = 1.0 / f ** beta
    amp[f < 1.5] = 0
    out = np.real(np.fft.ifft2(F * amp))
    out -= out.min()
    out /= out.max() + 1e-9
    return out


def hexc(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def lerp(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def save(name, img, q=88):
    img = np.clip(img, 0, 1)
    im = Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGB")
    im.save(os.path.join(OUT, name + ".png"))
    im.save(os.path.join(PUB, name + ".jpg"), quality=q, optimize=True, progressive=True)
    mean = img.reshape(-1, 3).mean(0)
    print(f"{name:12s} mean #{''.join(f'{int(c * 255):02x}' for c in mean)}")
    return mean


def edge_dist(u, v):
    """Distance to the nearest edge of a unit cell, for (u, v) in [0,1)."""
    return np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))


yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
means = {}

# ---------------------------------------------------------------- brick
def bricks(name, base, var, mortar_col, seed, courses=16, per_row=4, mortar=6, soot=0.25):
    r = rng(seed)
    ch = N // courses
    bw = N // per_row
    row = (yy // ch).astype(int)
    off = (row % 2) * (bw // 2)
    col = ((xx + off) // bw).astype(int) % per_row
    u = ((xx + off) % bw) / bw
    v = (yy % ch) / ch
    ids = row * per_row + col
    tint = r.uniform(-1, 1, (courses * per_row, 3))
    shade = r.uniform(0, 1, courses * per_row)
    c = base * (1 + var * tint[ids] * np.array([0.6, 0.4, 0.5]))
    c = c * (0.78 + 0.34 * shade[ids])[..., None]
    grain = noise(N, seed + 1, lo=40, beta=0.6)
    blot = noise(N, seed + 2, lo=6, hi=60, beta=1.2)
    c = c * (0.85 + 0.25 * grain)[..., None] * (0.9 + 0.2 * blot)[..., None]
    # Mortar joints with chipped edges.
    du = np.minimum(u, 1 - u) * bw
    dv = np.minimum(v, 1 - v) * ch
    d = np.minimum(du, dv)
    chip = noise(N, seed + 3, lo=30, beta=0.8) * 3.0
    m = np.clip((mortar / 2 + chip - d) / 2.0, 0, 1)
    edge = np.clip(1 - d / 5, 0, 1) * 0.25
    c = c * (1 - edge)[..., None]
    mc = mortar_col * (0.75 + 0.35 * noise(N, seed + 4, lo=20, beta=0.7))[..., None]
    c = lerp(c, mc, m)
    # Soot and weathering streaks running down.
    streak = aniso(N, seed + 5, 1.0, 0.08, 1.0)
    c = c * (1 - soot * np.clip(streak - 0.45, 0, 1) * 2)[..., None]
    return save(name, c)

means["brick"] = bricks("brick", hexc("#6a2f3b"), 0.07, hexc("#4a4650"), 10)
means["brick_dark"] = bricks("brick_dark", hexc("#3e2a38"), 0.05, hexc("#3a3842"), 20, soot=0.35)

# ---------------------------------------------------------------- plaster
def plaster(name, col, seed):
    n1 = noise(N, seed, lo=2, hi=20, beta=1.4)
    n2 = noise(N, seed + 1, lo=60, beta=0.5)
    c = col[None, None, :] * (0.93 + 0.08 * n1 + 0.04 * n2)[..., None]
    return save(name, c)

means["plaster"] = plaster("plaster", hexc("#8e8a9c"), 30)

# ---------------------------------------------------------------- floorboards
def boards(name, base, var, seed, n_rows=8, gap=3):
    r = rng(seed)
    ph = N // n_rows
    row = (yy // ph).astype(int)
    c = np.zeros((N, N, 3))
    grain = aniso(N, seed + 1, 0.06, 1.0, 1.1)
    fine = aniso(N, seed + 2, 0.02, 1.0, 0.6)
    knots = noise(N, seed + 3, lo=12, hi=40, beta=1.0)
    for k in range(n_rows):
        # Random plank lengths that wrap around the tile.
        cuts = np.sort(r.uniform(0, N, r.integers(2, 4)))
        mask = row == k
        xs = xx[mask]
        idx = np.searchsorted(cuts, xs) % len(cuts)
        plank_t = r.uniform(-1, 1, (len(cuts), 3))
        plank_s = r.uniform(0.8, 1.15, len(cuts))
        col = base * (1 + var * plank_t[idx][:, :1])
        col = col * plank_s[idx][:, None]
        g = (0.8 + 0.3 * grain[mask] + 0.1 * fine[mask])
        g = g * (1 - 0.25 * np.clip(knots[mask] - 0.75, 0, 1) * 4)
        c[mask] = col * g[:, None]
        # End joints
        for cx in cuts:
            dx = np.abs(((xs - cx + N / 2) % N) - N / 2)
            j = np.clip(1 - dx / 2.5, 0, 1)
            c[mask] *= (1 - 0.55 * j)[:, None]
    v = (yy % ph)
    dv = np.minimum(v, ph - 1 - v)
    j = np.clip(1 - dv / gap, 0, 1)
    c = c * (1 - 0.6 * j)[..., None]
    return save(name, c)

means["boards"] = boards("boards", hexc("#4a4250"), 0.12, 40)

# ---------------------------------------------------------------- carpet
def carpet(name, col, seed):
    n1 = noise(N, seed, lo=200, beta=0.2)
    n2 = noise(N, seed + 1, lo=3, hi=30, beta=1.3)
    c = col[None, None, :] * (0.8 + 0.3 * n1 + 0.15 * n2)[..., None]
    return save(name, c)

means["carpet"] = carpet("carpet", hexc("#463a5a"), 50)

# ---------------------------------------------------------------- kitchen tiles
def tiles(name, a, b, grout, seed, n=4, g=5):
    r = rng(seed)
    t = N // n
    i = (xx // t).astype(int)
    j = (yy // t).astype(int)
    ids = j * n + i
    var = r.uniform(-0.012, 0.012, (n * n, 1))
    checker = ((i + j) % 2)[..., None]
    c = a * (1 - checker) + b * checker + var[ids]
    speck = noise(N, seed + 1, lo=150, beta=0.3)
    c = c * (0.94 + 0.1 * speck)[..., None]
    u = (xx % t)
    v = (yy % t)
    d = np.minimum(np.minimum(u, t - 1 - u), np.minimum(v, t - 1 - v))
    m = np.clip(1 - (d - g / 2) / 1.5, 0, 1)
    sheen = np.clip(1 - d / 10, 0, 1) * 0.1
    c = c * (1 - sheen)[..., None]
    c = lerp(c, grout * (0.85 + 0.2 * noise(N, seed + 2, lo=40))[..., None], m)
    return save(name, c)

means["tiles"] = tiles("tiles", hexc("#5a6272"), hexc("#4c5363"), hexc("#262a33"), 60)

# ---------------------------------------------------------------- outside: tarmac
def tarmac(name, col, seed):
    agg = noise(N, seed, lo=180, beta=0.1)
    agg2 = noise(N, seed + 1, lo=90, beta=0.4)
    low = noise(N, seed + 2, lo=1.5, hi=8, beta=1.5)
    c = col[None, None, :] * (0.7 + 0.25 * agg + 0.2 * agg2 + 0.25 * low)[..., None]
    stones = (noise(N, seed + 3, lo=250, beta=0.0) > 0.82)
    c[stones] *= 1.25
    # A couple of hairline cracks.
    crack = aniso(N, seed + 4, 1.0, 0.25, 1.4)
    k = np.clip(1 - np.abs(crack - 0.5) * 120, 0, 1) * (low > 0.55)
    c = c * (1 - 0.5 * k)[..., None]
    return save(name, c)

means["tarmac"] = tarmac("tarmac", hexc("#3c4250"), 70)

# ---------------------------------------------------------------- paving slabs
def paving(name, col, seed, n=2, gap=7):
    r = rng(seed)
    t = N // n
    i = (xx // t).astype(int)
    j = (yy // t).astype(int)
    ids = j * n + i
    shade = r.uniform(0.85, 1.12, n * n)
    c = col[None, None, :] * shade[ids][..., None]
    grit = noise(N, seed + 1, lo=120, beta=0.3)
    blot = noise(N, seed + 2, lo=3, hi=25, beta=1.3)
    c = c * (0.82 + 0.18 * grit + 0.22 * blot)[..., None]
    # Gum spots and stains.
    gum = noise(N, seed + 3, lo=60, hi=200, beta=0.0) > 0.86
    c[gum] *= 0.82
    u = (xx % t)
    v = (yy % t)
    d = np.minimum(np.minimum(u, t - 1 - u), np.minimum(v, t - 1 - v))
    chip = noise(N, seed + 4, lo=25, beta=0.8) * 4
    m = np.clip((gap / 2 + chip - d) / 2, 0, 1)
    c = c * (1 - 0.18 * np.clip(1 - d / 14, 0, 1))[..., None]
    c = lerp(c, hexc("#1c1f26") * np.ones_like(c), m)
    return save(name, c)

means["paving"] = paving("paving", hexc("#6b7080"), 80)
means["patio"] = paving("patio", hexc("#5d5f6c"), 85, n=4, gap=6)

# ---------------------------------------------------------------- concrete
def concrete(name, col, seed):
    a = noise(N, seed, lo=2, hi=20, beta=1.3)
    b = noise(N, seed + 1, lo=100, beta=0.4)
    c = col[None, None, :] * (0.78 + 0.25 * a + 0.12 * b)[..., None]
    return save(name, c)

means["concrete"] = concrete("concrete", hexc("#5c606c"), 90)

# ---------------------------------------------------------------- grass
def grass(name, base, tip, seed):
    blades = aniso(N, seed, 0.25, 1.0, 0.3)
    fine = noise(N, seed + 1, lo=200, beta=0.1)
    clumps = noise(N, seed + 2, lo=3, hi=30, beta=1.2)
    patch = noise(N, seed + 3, lo=1.5, hi=6, beta=1.5)
    t = np.clip(0.45 * blades + 0.35 * fine + 0.4 * clumps - 0.1, 0, 1)
    c = lerp(base * np.ones((N, N, 3)), tip * np.ones((N, N, 3)), t)
    # Worn, muddy patches.
    mud = np.clip((patch - 0.68) * 5, 0, 1)
    c = lerp(c, hexc("#2b2a33") * (0.8 + 0.4 * fine)[..., None], mud * 0.45)
    return save(name, c)

means["grass"] = grass("grass", hexc("#13281f"), hexc("#2f5a3f"), 100)

# ---------------------------------------------------------------- soil / bark
means["soil"] = concrete("soil", hexc("#2a2630"), 105)

# ---------------------------------------------------------------- fence boards
def fence(name, base, seed, n=8, gap=4):
    r = rng(seed)
    bw = N // n
    i = (xx // bw).astype(int)
    shade = r.uniform(0.8, 1.15, n)
    grain = aniso(N, seed + 1, 1.0, 0.05, 1.1)
    c = base[None, None, :] * shade[i][..., None] * (0.75 + 0.4 * grain)[..., None]
    u = xx % bw
    d = np.minimum(u, bw - 1 - u)
    c = c * (1 - 0.7 * np.clip(1 - d / gap, 0, 1))[..., None]
    green = noise(N, seed + 2, lo=2, hi=12, beta=1.3)
    c = lerp(c, c * np.array([0.8, 1.05, 0.95]), np.clip((green - 0.5) * 2, 0, 1) * 0.5)
    return save(name, c)

means["fence"] = fence("fence", hexc("#3b3644"), 110)

# ---------------------------------------------------------------- slate roof
def slate(name, col, seed, rows=8, per=6):
    r = rng(seed)
    rh = N // rows
    sw = N // per
    row = (yy // rh).astype(int)
    off = (row % 2) * (sw // 2)
    i = ((xx + off) // sw).astype(int) % per
    ids = row * per + i
    shade = r.uniform(0.8, 1.15, rows * per)
    c = col[None, None, :] * shade[ids][..., None]
    c = c * (0.85 + 0.2 * noise(N, seed + 1, lo=80, beta=0.4))[..., None]
    v = yy % rh
    u = (xx + off) % sw
    lip = np.clip(1 - v / 10, 0, 1) * 0.5           # shadow under the slate above
    side = np.clip(1 - np.minimum(u, sw - 1 - u) / 2.5, 0, 1) * 0.5
    c = c * (1 - np.maximum(lip, side))[..., None]
    moss = noise(N, seed + 2, lo=2, hi=15, beta=1.3)
    c = lerp(c, hexc("#25362c") * np.ones_like(c), np.clip((moss - 0.7) * 3, 0, 1) * 0.6)
    return save(name, c)

means["slate"] = slate("slate", hexc("#3a4050"), 120)

# ---------------------------------------------------------------- fabric
def fabric(name, col, seed):
    weave = 0.5 + 0.25 * np.sin(xx / N * 2 * np.pi * 256) * np.sin(yy / N * 2 * np.pi * 256)
    n1 = noise(N, seed, lo=100, beta=0.4)
    n2 = noise(N, seed + 1, lo=2, hi=12, beta=1.4)
    c = col[None, None, :] * (0.8 + 0.2 * weave + 0.15 * n1 + 0.1 * n2)[..., None]
    return save(name, c)

means["fabric"] = fabric("fabric", hexc("#3a3550"), 130)

# Average colours, used as Blender base colours so bounced light is tinted right.
with open(os.path.join(OUT, "means.txt"), "w") as f:
    for k, v in means.items():
        f.write(f"{k} {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
print("done")
