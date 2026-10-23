"""Builds the Burgess Park job in Blender from art/level/burgess.json (the
level) and art/osm/burgess.json (paths and trees from OpenStreetMap), bakes
its lighting and exports it for the game.

Run:  python3 art/level/build_park.py [--bake] [--samples 128] [--size 2048] [--preview] [--out DIR]

Outputs (public/models/burgess/): level.glb, level-lightmap.png,
level-probe.png, level-materials.json, as for the estate (build_level.py).

The kiln's walls are cut at 1.5 units in the game like the house walls; for
the bake they carry on up to the kiln's real height with a cap over the
arches, so the passage inside stays dark.
"""
import json
import math
import os
import random
import sys
import time

import bpy  # noqa: I001  (bpy must load before bmesh)
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bake  # noqa: E402
import kit  # noqa: E402
import props  # noqa: E402
from bake import LIGHT_LOG, add_light  # noqa: E402
from kit import Geo  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
args = sys.argv
OUT = args[args.index("--out") + 1] if "--out" in args else os.path.join(ROOT, "public", "models", "burgess")
BAKE = "--bake" in args
PREVIEW = "--preview" in args
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 128
LM_SIZE = int(args[args.index("--size") + 1]) if "--size" in args else 2048

kit.MATS.update({
    "path": ("tarmac", "#ffffff", 3.0, 0.45, None),
    "path_edge": ("concrete", "#9a9eae", 1.0, 0.7, None),
    "track": ("soil", "#6a6878", 2.0, 1.0, None),
    "brick_kiln": ("brick_dark", "#d0c0d0", 0.9, 0.92, None),
    "kiln_floor": ("concrete", "#8a8c98", 3.0, 0.85, None),
    "canopy": ("grass", "#5e8478", 0.9, 1.0, None),
    "canopy_dark": ("grass", "#46685e", 0.9, 1.0, None),
    "shrub": ("grass", "#4c6c5c", 0.7, 1.0, None),
    "mulch": ("soil", "#7a7080", 2.0, 1.0, None),
    "emit_lamp_led": (None, "#e8eeff", 1.0, 0.3, ("#dfe8ff", 22.0)),
})
kit.load_means(os.path.join(ROOT, "art", "textures", "out", "means.txt"))
L = json.load(open(os.path.join(HERE, "burgess.json")))
OSM = json.load(open(os.path.join(ROOT, "art", "osm", "burgess.json")))
W, H = L["w"], L["h"]
T = L["tiles"]

CUT = 1.5      # wall height in the game
LAMP = "#d8e2ff"
KILN_H = 4.4   # the kiln's real height, for the bake

bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bake.collections()
C_STATIC, C_EXPORT, C_BLOCK, C_DYN = COLL
rnd = random.Random(11)


def BX(x):
    return x - W / 2


def BY(y):
    return H / 2 - y


def P(x, y, z=0.0):
    return Vector((BX(x), BY(y), z))


def tile(x, y):
    if 0 <= x < W and 0 <= y < H:
        return T[y][x]
    return "g"


def seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    q = dx * dx + dy * dy
    t = 0.0 if q == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / q))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def path_dist(x, y):
    """Distance from a point to the nearest path edge (negative inside a path)."""
    best = 1e9
    for p in OSM["paths"]:
        pts = p["pts"]
        for i in range(len(pts) - 1):
            best = min(best, seg_dist(x, y, pts[i], pts[i + 1]) - p["width"] / 2)
    return best


GX0, GX1, GY0, GY1 = -28, W + 28, -24, H + 16

# Path surfaces, in the order they win where they cross.
SURFACES = [
    ("path", ("asphalt", "paved", "concrete")),
    ("path_edge", ("fine_gravel", "gravel", "compacted")),
    ("track", ("dirt", "ground", "earth", "grass")),
]


def path_fields(step):
    """For each surface, the signed distance to its path edges at every
    vertex of the ground grid (negative on the path)."""
    import numpy as np
    xs = GX0 + np.arange(int((GX1 - GX0) / step) + 1) * step
    ys = GY0 + np.arange(int((GY1 - GY0) / step) + 1) * step
    X, Y = np.meshgrid(xs, ys)
    out = []
    for _, kinds in SURFACES:
        f = np.full(X.shape, 1e9)
        for p in OSM["paths"]:
            if p["surface"] not in kinds:
                continue
            pts = p["pts"]
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                dx, dy = bx - ax, by - ay
                q = dx * dx + dy * dy or 1e-9
                t = np.clip(((X - ax) * dx + (Y - ay) * dy) / q, 0, 1)
                f = np.minimum(f, np.hypot(X - ax - t * dx, Y - ay - t * dy) - p["width"] / 2)
        out.append(f)
    return out


def area2(poly):
    return sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1])) / 2


def clip(poly, vals, inside):
    """The part of a convex cell where the field is negative (inside) or not,
    with the boundary interpolated along the edges."""
    out, fs = [], []
    n = len(poly)
    for i in range(n):
        p, q, fp, fq = poly[i], poly[(i + 1) % n], vals[i], vals[(i + 1) % n]
        pin, qin = (fp < 0) == inside, (fq < 0) == inside
        if pin:
            out.append(p)
            fs.append(fp)
        if pin != qin:
            t = fp / (fp - fq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
            fs.append(0.0)
    return out, fs


# =================================================================== ground
def build_ground():
    """Grass everywhere at half-metre quads (the lightmap needs the vertices),
    mulch under the planting, the kiln's floor, and the paths cut into the
    same sheet along their real edges, so nothing overlaps."""
    near = Geo("ground_near")
    far = Geo("ground_far")
    step = 0.5
    fields = path_fields(step)
    for gy in range(int((GY1 - GY0) / step)):
        for gx in range(int((GX1 - GX0) / step)):
            px = GX0 + gx * step
            py = GY0 + gy * step
            x, y = math.floor(px + step / 2), math.floor(py + step / 2)
            t = tile(x, y)
            g = near if -3 <= x < W + 3 and -3 <= y < H + 3 else far
            cell = [(px, py), (px + step, py), (px + step, py + step), (px, py + step)]
            if t in ".#DO" or t == "b":
                pieces = [(cell, "kiln_floor" if t != "b" else "mulch")]
            else:
                pieces, rest = [], cell
                idx = [(gy, gx), (gy, gx + 1), (gy + 1, gx + 1), (gy + 1, gx)]
                vals_all = [[f[j] for j in idx] for f in fields]
                for (mat, _), vals in zip(SURFACES, vals_all):
                    if not rest:
                        break
                    # The field for what is left of the cell, at its corners.
                    rv = [interp(cell, vals, p) for p in rest]
                    if all(v >= 0 for v in rv):
                        continue
                    on, _ = clip(rest, rv, True)
                    off, _ = clip(rest, rv, False)
                    if abs(area2(off)) < 1e-3:
                        pieces.append((rest, mat))
                        rest = []
                    elif abs(area2(on)) >= 1e-3:
                        pieces.append((on, mat))
                        rest = off
                if rest:
                    pieces.append((rest, "grass"))
            for poly, mat in pieces:
                f = g.poly([P(px_, py_, 0) for px_, py_ in poly], mat)
                if f.normal.z < 0:
                    f.normal_flip()
    return near, far


def interp(cell, vals, p):
    """Bilinear value of the corner field at a point in the cell."""
    (x0, y0), (x1, _), _, (_, y1) = cell
    u, v = (p[0] - x0) / (x1 - x0), (p[1] - y0) / (y1 - y0)
    return (vals[0] * (1 - u) * (1 - v) + vals[1] * u * (1 - v) + vals[2] * u * v + vals[3] * (1 - u) * v)


# =================================================================== kiln
def build_kiln():
    """The lime kiln: an octagon of dark brick round a solid core, a passage
    under the arches, three arches (two gated). Wall faces stop at the cut
    for the game; the rest is light blocker."""
    low = Geo("walls")
    high = Geo("kiln_block")
    caps = Geo("caps")
    # Centre line of the outer wall, map coordinates, one metre thick.
    x0, x1, y0, y1, c = 18.5, 26.5, 4.5, 12.5, 1.25
    ring = [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]
    # Openings: (edge index, from, to) measured along the edge from its start.
    gaps = {0: (22.0 - (x0 + c), 23.0 - (x0 + c)), 4: ((x1 - c) - 23.0, (x1 - c) - 22.0), 6: ((y1 - c) - 9.0, (y1 - c) - 8.0)}
    def offset(pts, d):
        """The octagon moved d outwards along its corner bisectors (a true mitre)."""
        out = []
        for i in range(8):
            p, a, b = Vector((*pts[i], 0)), Vector((*pts[i - 1], 0)), Vector((*pts[(i + 1) % 8], 0))
            n1 = Vector(((p - a).y, -(p - a).x, 0)).normalized()
            n2 = Vector(((b - p).y, -(b - p).x, 0)).normalized()
            m = (n1 + n2).normalized()
            out.append(p + m * (d / m.dot(n1)))
        return out

    # Map y runs south, so the ring above is clockwise on screen: its left normal points out.
    outer = offset(ring, -0.5)
    inner = offset(ring, 0.5)
    if (outer[0] - Vector((22.5, 8.5, 0))).length < (inner[0] - Vector((22.5, 8.5, 0))).length:
        outer, inner = inner, outer

    def prism(geo, quad, z0, z1, mat):
        """A wall piece standing on a plan quad (map coordinates)."""
        bot = [P(q.x, q.y, z0) for q in quad]
        top = [P(q.x, q.y, z1) for q in quad]
        f = geo.poly(top, mat)
        if f.normal.z < 0:
            f.normal_flip()
        f = geo.poly(bot, mat)
        if f.normal.z > 0:
            f.normal_flip()
        c = sum(bot, Vector()) / 4
        for k in range(4):
            f = geo.poly([bot[k], bot[(k + 1) % 4], top[(k + 1) % 4], top[k]], mat)
            if f.normal.dot(((bot[k] + bot[(k + 1) % 4]) / 2) - c) < 0:
                f.normal_flip()

    for i in range(8):
        j = (i + 1) % 8
        a, b = Vector((*ring[i], 0)), Vector((*ring[j], 0))
        length = (b - a).length
        spans = [(0.0, 1.0)]
        if i in gaps:
            g0, g1 = gaps[i]
            spans = [(0.0, g0 / length), (g1 / length, 1.0)]
        for t0, t1 in spans:
            q = [outer[i].lerp(outer[j], t0), outer[i].lerp(outer[j], t1), inner[i].lerp(inner[j], t1), inner[i].lerp(inner[j], t0)]
            prism(low, q, 0.0, CUT, "brick_kiln")
            prism(caps, q, CUT, CUT + 0.01, "cap")
            prism(high, q, CUT, KILN_H, "brick_kiln")
        if i in gaps:
            g0, g1 = gaps[i]
            t0, t1 = g0 / length, g1 / length
            q = [outer[i].lerp(outer[j], t0), outer[i].lerp(outer[j], t1), inner[i].lerp(inner[j], t1), inner[i].lerp(inner[j], t0)]
            prism(high, q, 2.3, KILN_H, "brick_kiln")
            prism(low, q, 0.0, 0.05, "sill")
    # The core: the old kiln pot, solid.
    low.aabb(BX(21.0), BY(10.0), 0, BX(24.0), BY(7.0), CUT, "brick_kiln", bevel=0.02)
    caps.aabb(BX(21.0), BY(10.0), CUT, BX(24.0), BY(7.0), CUT + 0.01, "cap")
    high.aabb(BX(21.0), BY(10.0), CUT, BX(24.0), BY(7.0), KILN_H, "brick_kiln")
    # Vaulted cover over the passage, blocker only.
    high.aabb(BX(18.0), BY(13.0), KILN_H, BX(27.0), BY(4.0), KILN_H + 0.3, "brick_kiln")
    # Inside: rubble, a pallet, a camping lamp.
    for k, (x, y) in enumerate(((19.6, 6.0), (25.3, 10.6), (19.5, 11.3))):
        low.ico(P(x, y, 0.08), 0.28, "concrete", subdiv=1, scale=(1.3, 1, 0.5), noise=0.25, seed=90 + k)
    low.aabb(BX(19.2), BY(10.9), 0, BX(20.4), BY(9.7), 0.14, "wood_dark", bevel=0.01)
    low.cyl(P(20.0, 10.3, 0.14), 0.08, 0.04, "metal_dark", segs=10)
    return low, high, caps


def build_gates():
    """Iron gates in the south and west arches, as door leaves."""
    out = []
    for d in L["doors"]:
        x, y = d["x"], d["y"]
        g = Geo(f"door_{x}_{y}")
        hi = Geo(f"door_{x}_{y}_block")
        w = 0.94
        if d["axis"] == "h":
            hinge = P(x + 0.03, y + 0.5)
            along = Vector((1, 0, 0))
        else:
            hinge = P(x + 0.5, y + 0.03)
            along = Vector((0, -1, 0))
        rot = math.atan2(along.y, along.x)
        for z in (0.08, 0.75, 1.42):
            g.box(hinge + along * (w / 2) + Vector((0, 0, z)), (w, 0.04, 0.04), "metal_dark", rot=rot)
        for k in range(9):
            p = hinge + along * (0.04 + k * (w - 0.08) / 8)
            g.cyl(p, 0.013, CUT - 0.02, "metal_dark", segs=6)
        # A chain and padlock on the latch side.
        g.box(hinge + along * (w - 0.05) + Vector((0, 0, 0.95)), (0.06, 0.1, 0.12), "chrome", bevel=0.01, rot=rot)
        out.append({"def": d, "geo": g, "hi": hi, "hinge": hinge})
    return out


# =================================================================== planting
def tree(trunk, crown, x, y, scale=1.0, seed=0):
    """A London plane: grey trunk, a few limbs, a broad crown."""
    r = random.Random(seed)
    h = 2.8 * scale
    trunk.cyl(P(x, y, 0), 0.24 * scale, h, "bark", segs=10, r2=0.15 * scale)
    for k in range(3):
        a = r.uniform(0, 2 * math.pi)
        trunk.cyl(P(x, y, h * 0.8), 0.07 * scale, 1.4 * scale, "bark", segs=6, r2=0.03, axis="X", rot=a)
    n = 7
    for k in range(n):
        a = 2 * math.pi * k / n + r.uniform(-0.3, 0.3)
        rr = r.uniform(0.6, 1.6) * scale
        cz = (h + r.uniform(0.6, 1.8)) * 1.0
        crown.ico(P(x + math.cos(a) * rr, y + math.sin(a) * rr, cz), r.uniform(1.0, 1.45) * scale,
                  "canopy" if k % 3 else "canopy_dark", subdiv=1, scale=(1, 1, 0.75), noise=0.2, seed=seed * 13 + k)
    crown.ico(P(x, y, h + 2.0 * scale), 1.3 * scale, "canopy", subdiv=1, scale=(1, 1, 0.7), noise=0.2, seed=seed * 13 + 99)


def build_trees():
    near_t, far_t = Geo("trees"), Geo("far_trees")
    crowns, far_crowns = Geo("canopies"), Geo("far_canopies")
    spots = []
    for p in L["props"]:
        if p["kind"] == "tree":
            spots.append((p["x"] + 0.5, p["y"] + 0.5, 1.0))
    for x, y in OSM["trees"]:
        if not (0 <= x < W and 0 <= y < H):
            spots.append((x, y, 1.1))
    # The park is thicker with trees than the map data has: scatter more
    # off the paths in the margin, so the edges of the job sit in the dark.
    tries = 0
    while tries < 2600:
        tries += 1
        x = rnd.uniform(GX0 + 2, GX1 - 2)
        y = rnd.uniform(GY0 + 2, GY1 - 2)
        if -2 <= x < W + 2 and -2 <= y < H + 2:
            continue
        if path_dist(x, y) < 2.0 or any(math.hypot(x - a, y - b) < 4.2 for a, b, _ in spots):
            continue
        spots.append((x, y, rnd.uniform(0.9, 1.25)))
    for k, (x, y, s) in enumerate(spots):
        inside = -3 <= x < W + 3 and -3 <= y < H + 3
        tree(near_t if inside else far_t, crowns if inside else far_crowns, x, y, s, seed=k)
    return near_t, far_t, crowns, far_crowns


def build_shrubs():
    g = Geo("shrubs")
    seen = set()
    for y in range(H):
        for x in range(W):
            if T[y][x] != "b":
                continue
            seen.add((x, y))
            for k in range(3):
                g.ico(P(x + rnd.uniform(0.25, 0.75), y + rnd.uniform(0.25, 0.75), rnd.uniform(0.45, 0.65)),
                      rnd.uniform(0.5, 0.68), "shrub", subdiv=2, scale=(1, 1, 0.85), noise=0.18, seed=x * 31 + y * 7 + k)
    return g


# =================================================================== furniture
def park_lamp(g, emit, x, y):
    """A park lamp column with a lantern head. Returns the light position."""
    g.cyl(P(x, y, 0), 0.13, 0.5, "metal_dark", segs=12)
    g.cyl(P(x, y, 0.5), 0.065, 3.8, "metal_dark", segs=12, r2=0.05)
    g.cyl(P(x, y, 4.3), 0.2, 0.08, "metal_dark", segs=12)
    g.cyl(P(x, y, 4.38), 0.05, 0.25, "metal_dark", segs=8)
    emit.cyl(P(x, y, 4.0), 0.16, 0.3, "emit_lamp_led", segs=12, r2=0.2)
    g.cyl(P(x, y, 4.62), 0.24, 0.12, "metal_dark", segs=12, r2=0.05)
    return P(x, y, 3.95)


def bench(g, p):
    f = p.get("facing", math.pi / 2)
    cx, cy = p["x"] + p["w"] / 2, p["y"] + p["h"] / 2
    fx, fy = math.cos(f), math.sin(f)
    across = (-fy, fx)
    span = max(p["w"], p["h"]) - 0.3
    rot = math.atan2(-fy, fx) - math.pi / 2
    c = P(cx, cy)
    for k in range(3):
        o = Vector((fx * (k - 1) * 0.14, -fy * (k - 1) * 0.14, 0.45))
        g.box(c + o, (span, 0.11, 0.04), "wood_dark", bevel=0.01, rot=rot)
    g.box(c + Vector((-fx * 0.25, fy * 0.25, 0.75)), (span, 0.04, 0.3), "wood_dark", bevel=0.01, rot=rot)
    for s in (-1, 1):
        o = Vector((across[0] * s * span * 0.42, -across[1] * s * span * 0.42, 0.22))
        g.box(c + o, (0.06, 0.5, 0.44), "metal_dark", bevel=0.01, rot=rot)


def picnic_table(g, p):
    cx, cy = p["x"] + p["w"] / 2, p["y"] + p["h"] / 2
    c = P(cx, cy)
    g.box(c + Vector((0, 0, 0.74)), (1.8, 0.8, 0.05), "wood_dark", bevel=0.01)
    for s in (-1, 1):
        g.box(c + Vector((0, s * 0.72, 0.44)), (1.8, 0.3, 0.04), "wood_dark", bevel=0.01)
        for t in (-1, 1):
            g.box(c + Vector((t * 0.7, s * 0.25, 0.37)), (0.06, 0.06, 0.74), "wood_dark", rot=0, tilt=("X", s * 0.45))


def litter_bin(g, p):
    c = P(p["x"] + 0.5, p["y"] + 0.5)
    g.cyl(c, 0.26, 0.85, "metal_dark", segs=16)
    g.cyl(c + Vector((0, 0, 0.85)), 0.29, 0.08, "metal_dark", segs=16, r2=0.22)
    g.ico(c + Vector((0, 0, 0.92)), 0.12, "plastic_black", subdiv=1, noise=0.2, seed=5)


def build_furniture():
    g = Geo("props_ext")
    gf = Geo("far_props")
    emit = Geo("props_emit")
    lamps = []
    for p in L["props"]:
        k = p["kind"]
        if k == "lamp":
            lamps.append(park_lamp(g, emit, p["x"] + 0.5, p["y"] + 0.5))
        elif k == "bench":
            bench(g, p)
        elif k == "picnicTable":
            picnic_table(g, p)
        elif k == "bin":
            litter_bin(g, p)
    # Lamps along the canal path and the cycleway beyond the map.
    for x in (-18.5, -6.5, 41.5, 53.5):
        lamps.append(park_lamp(gf, emit, x, 28.5))
    for y in (-14.5, -2.5):
        lamps.append(park_lamp(gf, emit, -4.8, y))
    # The gang's car on the verge, lights on; the crew's van on the canal path.
    car = next(p for p in L["props"] if p["kind"] == "car")
    car_front = props.car(P, g, emit, car["x"] + 0.0, car["y"] + 0.1, 4.0, 1.8, "car_paint2", facing=1, lights=True, zb=0.0)
    v = L["van"]
    van_front = props.car(P, g, emit, v["x0"] + 0.1, v["y0"] + 0.05, 4.9, 1.9, "van_paint", facing=1, lights=True, van=True, zb=0.0)
    # A bag of rubbish by the bin, a bike on its side by the table.
    g.ico(P(16.1, 28.7, 0.2), 0.24, "plastic_black", subdiv=2, scale=(1, 1, 0.8), noise=0.15, seed=3)
    g.cyl(P(31.2, 18.3, 0.03), 0.32, 0.03, "tyre", segs=18)
    g.cyl(P(32.2, 18.5, 0.03), 0.32, 0.03, "tyre", segs=18)
    g.box(P(31.7, 18.4, 0.06), (0.95, 0.04, 0.04), "car_paint", rot=0.2)
    return g, gf, emit, lamps, car_front, van_front


# =================================================================== lights
def build_lights(lamps, car_front, van_front):
    d = Vector((0.45, 0.55, -1.0)).normalized()
    sun = add_light("moon", "SUN", (0, 0, 30), "#6f8fff", 0.8)
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("night")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*kit.hex_lin("#1a2a55"), 1)
    bg.inputs[1].default_value = 0.3
    bpy.context.scene.world = world
    for k, p in enumerate(lamps):
        # Burgess Park's lamps are white LED, not sodium.
        # Bright enough that a pool reads at a glance: the gang see you in it.
        add_light(f"lamp{k}", "POINT", p, LAMP, 900, radius=0.12)
        LIGHT_LOG.append(("street", tuple(p + Vector((0, 0, 0.3)))))
    for front, name in ((car_front, "car"), (van_front, "van")):
        for s in (-0.6, 0.6):
            add_light(f"{name}{s}", "SPOT", front + Vector((0.05, s, 0)), "#fff0d8", 600, radius=0.05,
                      rot=(0, math.radians(90), 0), spot=math.radians(55))
        LIGHT_LOG.append((name, tuple(front)))
    # The minder's camping lantern in the kiln passage.
    add_light("lantern", "POINT", P(20.0, 10.3, 0.35), "#ffd9a0", 60, radius=0.08)
    LIGHT_LOG.append(("lantern", tuple(P(20.0, 10.3, 0.35))))
    # Somebody's phone at the picnic table.
    add_light("phone", "POINT", P(29.3, 16.6, 0.9), "#9ab8ff", 4, radius=0.05)


# =================================================================== main
def main():
    t0 = time.time()
    near, far = build_ground()
    low, high, caps = build_kiln()
    doors = build_gates()
    trunks, trunks_far, crowns, crowns_far = build_trees()
    shrubs = build_shrubs()
    fur, fur_far, emit, lamps, car_front, van_front = build_furniture()
    print(f"geometry built {time.time() - t0:.1f}s")

    def obj(g, coll):
        return g.to_object(coll) if len(g.bm.faces) else None

    statics = [obj(g, C_STATIC) for g in (near, far, low, trunks, trunks_far, fur, fur_far)]
    statics.append(shrubs.to_object(C_STATIC, smooth_angle=89))
    statics = [o for o in statics if o]
    door_objs = []
    for d in doors:
        door_objs.append(obj(d["geo"], C_STATIC))
        obj(d["hi"], C_BLOCK)
    # Tree crowns are baked like the rest but kept apart, so the game can see through them.
    canopies = [g.to_object(C_STATIC, smooth_angle=89) for g in (crowns, crowns_far)]
    lantern = Geo("lantern_emit")
    lantern.cyl(P(20.0, 10.3, 0.18), 0.06, 0.16, "emit_bulb", segs=10)
    emitters = [obj(emit, C_EXPORT), obj(lantern, C_EXPORT)]
    hidden = [obj(caps, C_DYN)]
    obj(high, C_BLOCK)
    loot = props.build_loot(L["loot"], P, C_DYN)
    build_lights(lamps, car_front, van_front)

    bake.finish(OUT, W, H, P, statics, door_objs + canopies, emitters, hidden, loot, doors, COLL, CUT,
                bake=BAKE, samples=SAMPLES, lm_size=LM_SIZE,
                preview=os.path.join(HERE, "preview-park.png") if PREVIEW else None, ortho=40, t0=t0, meta={"lamp": LAMP})


main()
