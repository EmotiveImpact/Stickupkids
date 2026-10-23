"""Builds the Burgess Park job in Blender from art/level/burgess.json (the
level) and art/osm/burgess.json (paths, trees, buildings and fences from
OpenStreetMap), bakes its lighting and exports it for the game.

Run:  python3 art/level/build_park.py [--bake] [--samples 96] [--size 4096] [--preview] [--out DIR]

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
import bmesh
import numpy as np
from mathutils import Matrix, Vector

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
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 96
LM_SIZE = int(args[args.index("--size") + 1]) if "--size" in args else 4096

kit.MATS.update({
    "path": ("tarmac", "#ffffff", 3.0, 0.45, None),
    "road": ("tarmac", "#8c90a2", 3.0, 0.3, None),
    "path_edge": ("concrete", "#9a9eae", 1.0, 0.7, None),
    "track": ("soil", "#6a6878", 2.0, 1.0, None),
    "brick_kiln": ("brick_dark", "#d0c0d0", 0.9, 0.92, None),
    "kiln_floor": ("concrete", "#8a8c98", 3.0, 0.85, None),
    "canopy": ("grass", "#5e8478", 0.9, 1.0, None),
    "canopy_dark": ("grass", "#46685e", 0.9, 1.0, None),
    "shrub": ("grass", "#4c6c5c", 0.7, 1.0, None),
    "mulch": ("soil", "#7a7080", 2.0, 1.0, None),
    "roof_flat": ("concrete", "#5a5e6c", 2.0, 0.8, None),
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
# The kiln was first drawn with its corner at (18, 4); everything about it
# is given that way and moved to where the level has it.
ROOM = next(r for r in L["rooms"] if r["id"] == "kiln")
OX, OY = ROOM["x0"] - 19, ROOM["y0"] - 5
ROADS = ("tertiary", "secondary", "primary", "residential", "service", "unclassified")

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


def K(x, y, z=0.0):
    """A point of the kiln, in its first map's coordinates."""
    return P(x + OX, y + OY, z)


def tile(x, y):
    if 0 <= x < W and 0 <= y < H:
        return T[y][x]
    return "g"


def inside_map(x, y, pad=0.0):
    return -pad <= x < W + pad and -pad <= y < H + pad


GX0, GX1, GY0, GY1 = -24, W + 24, -20, H + 14
STEP = 1.0

# Ground surfaces, in the order they win where they cross: (material, which OSM paths).
SURFACES = [
    ("road", lambda p: p["kind"] in ROADS),
    ("path", lambda p: p["surface"] in ("asphalt", "paved", "concrete", "paving_stones")),
    ("path_edge", lambda p: p["surface"] in ("fine_gravel", "gravel", "compacted")),
    ("track", lambda p: p["surface"] in ("dirt", "ground", "earth", "grass")),
]


def seg_field(X, Y, pts, half):
    f = np.full(X.shape, 1e9)
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        q = dx * dx + dy * dy or 1e-9
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / q, 0, 1)
        f = np.minimum(f, np.hypot(X - ax - t * dx, Y - ay - t * dy) - half)
    return f


def poly_field(X, Y, pts):
    """Signed distance to a polygon's edge, negative inside."""
    ring = pts + pts[:1]
    d = seg_field(X, Y, ring, 0.0)
    inside = np.zeros(X.shape, bool)
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        if ay == by:
            continue
        crosses = (ay > Y) != (by > Y)
        inside ^= crosses & (X < ax + (Y - ay) * (bx - ax) / (by - ay))
    return np.where(inside, -d, d)


def path_fields(step):
    """For each surface, the signed distance to its edges at every vertex of
    the ground grid (negative on it)."""
    xs = GX0 + np.arange(int((GX1 - GX0) / step) + 1) * step
    ys = GY0 + np.arange(int((GY1 - GY0) / step) + 1) * step
    X, Y = np.meshgrid(xs, ys)
    out = []
    for mat, which in SURFACES:
        f = np.full(X.shape, 1e9)
        # A path takes the first surface that claims it.
        claimed = [p for p in OSM["paths"] if which(p) and next(m for m, w in SURFACES if w(p)) == mat]
        for p in claimed:
            f = np.minimum(f, seg_field(X, Y, p["pts"], p["width"] / 2))
        for a in OSM["areas"]:
            if mat == "road" and a["kind"] == "parking":
                f = np.minimum(f, poly_field(X, Y, a["pts"]))
            if mat == "track" and a["kind"] == "track":
                # The BMX track: a loop of packed dirt.
                f = np.minimum(f, seg_field(X, Y, a["pts"], 2.2))
        out.append(f)
    return out


FIELDS = path_fields(STEP)
ANY_PATH = np.minimum.reduce(FIELDS)


def path_dist(x, y):
    """Distance from a point to the nearest path or road edge (negative on one), from the ground grid."""
    i = int(round((y - GY0) / STEP))
    j = int(round((x - GX0) / STEP))
    if 0 <= i < ANY_PATH.shape[0] and 0 <= j < ANY_PATH.shape[1]:
        return ANY_PATH[i, j]
    return 1e9


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


def interp(cell, vals, p):
    """Bilinear value of the corner field at a point in the cell."""
    (x0, y0), (x1, _), _, (_, y1) = cell
    u, v = (p[0] - x0) / (x1 - x0), (p[1] - y0) / (y1 - y0)
    return (vals[0] * (1 - u) * (1 - v) + vals[1] * u * (1 - v) + vals[2] * u * v + vals[3] * (1 - u) * v)


# =================================================================== ground
def build_ground():
    """Grass everywhere in metre quads (the lightmap needs the vertices),
    mulch under the planting, the kiln's floor, and the roads, paths and
    the BMX track cut into the same sheet along their real edges, so
    nothing overlaps."""
    near = Geo("ground_near")
    far = Geo("ground_far")
    step = STEP
    for gy in range(int((GY1 - GY0) / step)):
        for gx in range(int((GX1 - GX0) / step)):
            px = GX0 + gx * step
            py = GY0 + gy * step
            x, y = math.floor(px + step / 2), math.floor(py + step / 2)
            t = tile(x, y)
            if t == "X":
                continue  # under a building
            g = near if -3 <= x < W + 3 and -3 <= y < H + 3 else far
            cell = [(px, py), (px + step, py), (px + step, py + step), (px, py + step)]
            if t in ".#DO" or t == "b":
                pieces = [(cell, "kiln_floor" if t != "b" else "mulch")]
            else:
                pieces, rest = [], cell
                idx = [(gy, gx), (gy, gx + 1), (gy + 1, gx + 1), (gy + 1, gx)]
                vals_all = [[f[j] for j in idx] for f in FIELDS]
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


def dashes(g, pts, mat="paint_road", length=1.6, gap=2.6, width=0.12):
    """Road centre-line dashes along a polyline (map coordinates)."""
    carry = 0.0
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        seg = math.hypot(bx - ax, by - ay)
        if seg < 1e-6:
            continue
        ux, uy = (bx - ax) / seg, (by - ay) / seg
        s = carry
        while s + length <= seg:
            cx, cy = ax + ux * (s + length / 2), ay + uy * (s + length / 2)
            if GX0 + 1 < cx < GX1 - 1 and GY0 + 1 < cy < GY1 - 1:
                g.box(P(cx, cy, 0.006), (length, width, 0.012), mat, rot=math.atan2(-uy, ux))
            s += length + gap
        carry = s - seg


# =================================================================== kiln
def build_kiln():
    """The lime kiln: an octagon of dark brick round a solid core, a passage
    under the arches, three arches (two gated). Wall faces stop at the cut
    for the game; the rest is light blocker."""
    low = Geo("walls")
    high = Geo("kiln_block")
    caps = Geo("caps")
    # Centre line of the outer wall, one metre thick, in the kiln's first
    # map's coordinates (moved by OX, OY below).
    x0, x1, y0, y1, c = 18.5, 26.5, 4.5, 12.5, 1.25
    ring = [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]
    ring = [(x + OX, y + OY) for x, y in ring]
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
    centre = Vector((22.5 + OX, 8.5 + OY, 0))
    if (outer[0] - centre).length < (inner[0] - centre).length:
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
        cc = sum(bot, Vector()) / 4
        for k in range(4):
            f = geo.poly([bot[k], bot[(k + 1) % 4], top[(k + 1) % 4], top[k]], mat)
            if f.normal.dot(((bot[k] + bot[(k + 1) % 4]) / 2) - cc) < 0:
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
    low.aabb(BX(21.0 + OX), BY(10.0 + OY), 0, BX(24.0 + OX), BY(7.0 + OY), CUT, "brick_kiln", bevel=0.02)
    caps.aabb(BX(21.0 + OX), BY(10.0 + OY), CUT, BX(24.0 + OX), BY(7.0 + OY), CUT + 0.01, "cap")
    high.aabb(BX(21.0 + OX), BY(10.0 + OY), CUT, BX(24.0 + OX), BY(7.0 + OY), KILN_H, "brick_kiln")
    # Vaulted cover over the passage, blocker only.
    high.aabb(BX(18.0 + OX), BY(13.0 + OY), KILN_H, BX(27.0 + OX), BY(4.0 + OY), KILN_H + 0.3, "brick_kiln")
    # Inside: rubble, a pallet, a camping lamp.
    for k, (x, y) in enumerate(((19.6, 6.0), (25.3, 10.6), (19.5, 11.3))):
        low.ico(K(x, y, 0.08), 0.28, "concrete", subdiv=1, scale=(1.3, 1, 0.5), noise=0.25, seed=90 + k)
    low.aabb(BX(19.2 + OX), BY(10.9 + OY), 0, BX(20.4 + OX), BY(9.7 + OY), 0.14, "wood_dark", bevel=0.01)
    low.cyl(K(20.0, 10.3, 0.14), 0.08, 0.04, "metal_dark", segs=10)
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


# =================================================================== buildings and fences
def build_buildings():
    """Buildings from the map as plain blocks: the adventure playground's hut
    in the park, the houses and flats round its edges beyond. Lit windows on
    the ones outside."""
    near, far, emit = Geo("buildings"), Geo("far_buildings"), Geo("windows_emit")
    wr = random.Random(5)
    for b in OSM["buildings"]:
        if b["historic"]:
            continue
        pts = b["pts"][:-1] if b["pts"][0] == b["pts"][-1] else b["pts"]
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        if not (GX0 <= cx <= GX1 and GY0 <= cy <= GY1) or cy > H:
            continue
        inside = inside_map(cx, cy)
        levels = int(b["levels"]) if (b["levels"] or "").isdigit() else (1 if inside else 3)
        z = min(14.0, 0.4 + levels * 3.0)
        g = near if inside else far
        wall = "brick_n1" if inside else ("brick_n2", "brick_n3", "render_n")[len(pts) % 3]
        if area2(pts) > 0:
            pts = pts[::-1]
        base = [P(x, y, 0) for x, y in pts]
        top = [P(x, y, z) for x, y in pts]
        f = g.poly(top, "roof_flat")
        if f.normal.z < 0:
            f.normal_flip()
        n = len(pts)
        cc = sum(base, Vector()) / n
        for k in range(n):
            a, b2 = base[k], base[(k + 1) % n]
            f = g.poly([a, b2, top[(k + 1) % n], top[k]], wall)
            mid = (a + b2) / 2
            if f.normal.dot(mid - cc) < 0:
                f.normal_flip()
            if inside:
                # A parapet round the flat roof.
                d = top[(k + 1) % n] - top[k]
                inward = Vector((-d.y, d.x, 0)).normalized()
                if inward.dot(cc - mid) < 0:
                    inward = -inward
                g.box((top[k] + top[(k + 1) % n]) / 2 + inward * 0.15 + Vector((0, 0, 0.2)), (d.length + 0.3, 0.3, 0.4),
                      "concrete", rot=math.atan2(d.y, d.x))
                continue
            # Windows, a row per storey, on the walls that face us.
            if f.normal.y > -0.2:
                continue
            seg = (b2 - a).length
            u = (b2 - a).normalized()
            out = f.normal.normalized() * 0.03
            for lv in range(levels):
                for s in np.arange(1.2, seg - 0.8, 2.6):
                    lit = wr.random() < 0.35
                    c = a + u * s + out + Vector((0, 0, 1.5 + lv * 3.0))
                    (emit if lit else g).box(c, (1.0, 0.04, 1.2), wr.choice(("emit_window_warm", "emit_window_cool")) if lit else "glass",
                                             rot=math.atan2(u.y, u.x))
        if inside:
            # Plant on the roof, lined up with its longest wall: air handlers and vent stacks.
            e = max(range(n), key=lambda k: (base[(k + 1) % n] - base[k]).length)
            d = base[(e + 1) % n] - base[e]
            rot = math.atan2(d.y, d.x)
            xs, ys = [x for x, _ in pts], [y for _, y in pts]
            pr = random.Random(len(pts))
            units = []
            for _ in range(200):
                if len(units) >= 7:
                    break
                x, y = pr.uniform(min(xs) + 2.5, max(xs) - 2.5), pr.uniform(min(ys) + 2.5, max(ys) - 2.5)
                if inside_poly(pts, x, y) and all(math.hypot(x - ux, y - uy) > 3.5 for ux, uy in units):
                    units.append((x, y))
            for k, (x, y) in enumerate(units):
                if k % 3 == 2:
                    g.cyl(P(x, y, z), 0.32, 1.1, "metal_dark", segs=12)
                    g.cyl(P(x, y, z + 1.1), 0.42, 0.12, "metal_dark", segs=12)
                else:
                    g.box(P(x, y, z + 0.5), (2.2, 1.3, 1.0), "metal", bevel=0.04, rot=rot)
                    g.cyl(P(x, y, z + 1.0) + Vector((math.cos(rot), math.sin(rot), 0)) * 0.5, 0.42, 0.04, "plastic_black", segs=16)
    return near, far, emit


def inside_poly(pts, x, y):
    """Even-odd test against a polygon in level metres."""
    c = False
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c


def build_fences():
    """The BMX track's railings, where the level has them (gaps for gates)."""
    g = Geo("fences")
    for f in OSM["barriers"]:
        if f["kind"] not in ("fence", "wall"):
            continue
        # Walk the line and keep the stretches over fence cells.
        pts = []
        for (ax, ay), (bx, by) in zip(f["pts"], f["pts"][1:]):
            n = max(1, int(math.hypot(bx - ax, by - ay) / 0.5))
            for i in range(n):
                pts.append((ax + (bx - ax) * i / n, ay + (by - ay) * i / n))
        pts.append(tuple(f["pts"][-1]))
        runs, run = [], []
        for x, y in pts:
            keep = (GX0 < x < GX1 and GY0 < y < GY1) and (not inside_map(x, y) or tile(math.floor(x), math.floor(y)) == "=")
            if keep:
                run.append((x, y))
            elif run:
                runs.append(run)
                run = []
        if run:
            runs.append(run)
        for run in runs:
            if len(run) < 2:
                continue
            for k, (x, y) in enumerate(run):
                if k % 5 == 0 or k == len(run) - 1:
                    g.box(P(x, y, 0.7), (0.06, 0.06, 1.4), "metal_dark")
                else:
                    g.cyl(P(x, y, 0.06), 0.014, 1.28, "metal_dark", segs=3, cap=False)
            for (ax, ay), (bx, by) in zip(run, run[1:]):
                d = math.hypot(bx - ax, by - ay)
                for zz in (0.08, 1.32):
                    g.box(P((ax + bx) / 2, (ay + by) / 2, zz), (d + 0.01, 0.035, 0.035), "metal_dark", rot=math.atan2(-(by - ay), bx - ax))
    return g


# =================================================================== planting
def tree(trunk, crown, x, y, scale=1.0, seed=0, blobs=6):
    """A London plane: grey trunk, a few limbs, a broad crown."""
    r = random.Random(seed)
    h = 2.8 * scale
    trunk.cyl(P(x, y, 0), 0.24 * scale, h, "bark", segs=7, r2=0.15 * scale, cap=False)
    for k in range(2):
        a = r.uniform(0, 2 * math.pi)
        trunk.cyl(P(x, y, h * 0.8), 0.07 * scale, 1.4 * scale, "bark", segs=4, r2=0.03, axis="X", rot=a, cap=False)
    for k in range(blobs - 1):
        a = 2 * math.pi * k / (blobs - 1) + r.uniform(-0.3, 0.3)
        rr = r.uniform(0.7, 1.6) * scale
        cz = h + r.uniform(0.6, 1.8)
        crown.ico(P(x + math.cos(a) * rr, y + math.sin(a) * rr, cz), r.uniform(1.1, 1.55) * scale,
                  "canopy" if k % 3 else "canopy_dark", subdiv=1, scale=(1, 1, 0.75), noise=0.2, seed=seed * 13 + k)
    crown.ico(P(x, y, h + 2.0 * scale), 1.35 * scale, "canopy", subdiv=1, scale=(1, 1, 0.7), noise=0.2, seed=seed * 13 + 99)


def build_trees():
    near_t, far_t = Geo("trees"), Geo("far_trees")
    crowns, far_crowns = Geo("canopies"), Geo("far_canopies")
    spots = []
    for p in L["props"]:
        if p["kind"] == "tree":
            spots.append((p["x"] + 0.5, p["y"] + 0.5, rnd.uniform(0.95, 1.2)))
    for x, y in OSM["trees"]:
        if not inside_map(x, y) and GX0 < x < GX1 and GY0 < y < GY1 and path_dist(x, y) > 1.0:
            spots.append((x, y, 1.1))
    # The park carries on past the map: scatter more off the paths in the
    # margin, so the edges of the job sit among trees.
    tries = 0
    while tries < 2400:
        tries += 1
        x = rnd.uniform(GX0 + 2, GX1 - 2)
        y = rnd.uniform(GY0 + 2, GY1 - 2)
        if inside_map(x, y, 2):
            continue
        if path_dist(x, y) < 2.0 or any(math.hypot(x - a, y - b) < 5.5 for a, b, _ in spots):
            continue
        spots.append((x, y, rnd.uniform(0.9, 1.25)))
    for k, (x, y, s) in enumerate(spots):
        inside = inside_map(x, y, 3)
        tree(near_t if inside else far_t, crowns if inside else far_crowns, x, y, s, seed=k, blobs=6 if inside else 4)
    print(f"trees {len(spots)}")
    return near_t, far_t, crowns, far_crowns


def build_shrubs():
    g = Geo("shrubs")
    for y in range(H):
        for x in range(W):
            if T[y][x] != "b":
                continue
            for k in range(2):
                g.ico(P(x + rnd.uniform(0.3, 0.7), y + rnd.uniform(0.3, 0.7), rnd.uniform(0.45, 0.65)),
                      rnd.uniform(0.6, 0.78), "shrub", subdiv=1, scale=(1, 1, 0.85), noise=0.22, seed=x * 31 + y * 7 + k)
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


def turned(g, pivot, angle, build):
    """Build something into g, then turn what was added about a point (Blender coordinates)."""
    g.bm.verts.ensure_lookup_table()
    n0 = len(g.bm.verts)
    out = build()
    g.bm.verts.ensure_lookup_table()
    verts = g.bm.verts[n0:]
    R = Matrix.Rotation(angle, 3, "Z")
    bmesh.ops.rotate(g.bm, verts=verts, cent=pivot, matrix=R)
    return pivot + R @ (out - pivot) if out is not None else None


def bike(g, x, y, rot):
    """A BMX on its side."""
    c = P(x, y, 0.03)
    for s in (-0.45, 0.45):
        g.cyl(c + Vector((math.cos(rot) * s, math.sin(rot) * s, 0)), 0.25, 0.03, "tyre", segs=16)
    g.box(c + Vector((0, 0, 0.03)), (0.85, 0.04, 0.04), "car_paint", rot=rot)
    g.box(c + Vector((math.cos(rot) * 0.4, math.sin(rot) * 0.4, 0.04)), (0.05, 0.5, 0.03), "chrome", rot=rot)


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
    # Lamps carry on along the canal path, Wells Way and Albany Road past the map.
    for x, y in ((-20.5, 131.5), (-8.5, 131.0), (W + 6.5, 146.5), (W + 18.5, 147.5), (236.5, -14.5), (236.5, H + 8.5)):
        lamps.append(park_lamp(gf, emit, x, y))
    # The roads' centre lines.
    for p in OSM["paths"]:
        if p["kind"] in ("tertiary", "secondary", "primary"):
            dashes(g, p["pts"])
    # The gang's car in the car park, lights on.
    car = next(p for p in L["props"] if p["kind"] == "car")
    car_front = props.car(P, g, emit, car["x"] + 0.0, car["y"] + 0.1, 4.0, 1.8, "car_paint2", facing=1, lights=True, zb=0.0)
    # The crew's van on Wells Way, pointing north.
    mark_emit(emit)
    v = L["van"]
    vc = P((v["x0"] + v["x1"] + 1) / 2, (v["y0"] + v["y1"] + 1) / 2)
    van_front = turned(g, vc, math.pi / 2, lambda: props.car(
        P, g, emit, (v["x0"] + v["x1"] + 1) / 2 - 2.45, (v["y0"] + v["y1"] + 1) / 2 - 0.95, 4.9, 1.9, "van_paint",
        facing=1, lights=True, van=True, zb=0.0))
    # turned() moves g's new vertices; the van's lights went into emit.
    turned_emit(emit, vc, math.pi / 2)
    # A bag of rubbish by a bin, a bike on its side by the table, another at the BMX track.
    g.ico(P(85.1 + 0.0, 134.7, 0.2), 0.24, "plastic_black", subdiv=2, scale=(1, 1, 0.8), noise=0.15, seed=3)
    bike(g, 101.2, 126.3, 0.2)
    bike(g, 209.6, 23.8, -0.9)
    return g, gf, emit, lamps, car_front, van_front


_EMIT_MARK = {}


def mark_emit(emit):
    emit.bm.verts.ensure_lookup_table()
    _EMIT_MARK[id(emit)] = len(emit.bm.verts)


def turned_emit(emit, pivot, angle):
    """Turn whatever was added to emit since mark_emit()."""
    emit.bm.verts.ensure_lookup_table()
    n0 = _EMIT_MARK.get(id(emit), len(emit.bm.verts))
    bmesh.ops.rotate(emit.bm, verts=emit.bm.verts[n0:], cent=pivot, matrix=Matrix.Rotation(angle, 3, "Z"))


# =================================================================== lights
def build_lights(lamps, car_front, van_front):
    d = Vector((0.45, 0.55, -1.0)).normalized()
    # A strong moon: most of this map is far from a lamp, and the open grass
    # still has to read (with the trees' moon shadows) at a glance.
    sun = add_light("moon", "SUN", (0, 0, 30), "#8aa2f0", 2.4)
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("night")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*kit.hex_lin("#1a2a55"), 1)
    bg.inputs[1].default_value = 0.6
    bpy.context.scene.world = world
    for k, p in enumerate(lamps):
        # Burgess Park's lamps are white LED, not sodium.
        # Bright enough that a pool reads at a glance: the gang see you in it.
        add_light(f"lamp{k}", "POINT", p, LAMP, 900, radius=0.12)
        LIGHT_LOG.append(("street", tuple(p + Vector((0, 0, 0.3)))))
    # Headlights: a spot points down its -Z; turn that to the bonnet's heading.
    for front, name, heading in ((car_front, "car", 0.0), (van_front, "van", math.pi / 2)):
        side = Vector((-math.sin(heading), math.cos(heading), 0))
        for s in (-0.6, 0.6):
            add_light(f"{name}{s}", "SPOT", front + side * s + Vector((math.cos(heading), math.sin(heading), 0)) * 0.05,
                      "#fff0d8", 600, radius=0.05, rot=(0, -math.pi / 2, heading), spot=math.radians(55))
        LIGHT_LOG.append((name, tuple(front)))
    # The minder's camping lantern in the kiln passage.
    add_light("lantern", "POINT", K(20.0, 10.3, 0.35), "#ffd9a0", 60, radius=0.08)
    LIGHT_LOG.append(("lantern", tuple(K(20.0, 10.3, 0.35))))
    # Somebody's phone at the picnic table.
    t = next(p for p in L["props"] if p["kind"] == "picnicTable")
    add_light("phone", "POINT", P(t["x"] + 1.3, t["y"] + 0.6, 0.9), "#9ab8ff", 4, radius=0.05)


# =================================================================== main
def main():
    t0 = time.time()
    near, far = build_ground()
    print(f"ground {time.time() - t0:.1f}s")
    low, high, caps = build_kiln()
    doors = build_gates()
    trunks, trunks_far, crowns, crowns_far = build_trees()
    shrubs = build_shrubs()
    houses, houses_far, windows = build_buildings()
    fences = build_fences()
    print(f"scenery {time.time() - t0:.1f}s")
    fur, fur_far, emit, lamps, car_front, van_front = build_furniture()
    print(f"geometry built {time.time() - t0:.1f}s")

    def obj(g, coll):
        return g.to_object(coll) if len(g.bm.faces) else None

    statics = [obj(g, C_STATIC) for g in (near, far, low, trunks, trunks_far, fur, fur_far, houses, houses_far, fences)]
    statics.append(shrubs.to_object(C_STATIC, smooth_angle=89))
    statics = [o for o in statics if o]
    door_objs = []
    for d in doors:
        door_objs.append(obj(d["geo"], C_STATIC))
        obj(d["hi"], C_BLOCK)
    # Tree crowns are baked like the rest but kept apart, so the game can see through them.
    canopies = [g.to_object(C_STATIC, smooth_angle=89) for g in (crowns, crowns_far)]
    lantern = Geo("lantern_emit")
    lantern.cyl(K(20.0, 10.3, 0.18), 0.06, 0.16, "emit_bulb", segs=10)
    emitters = [obj(emit, C_EXPORT), obj(lantern, C_EXPORT), obj(windows, C_EXPORT)]
    hidden = [obj(caps, C_DYN)]
    obj(high, C_BLOCK)
    t = next(p for p in L["props"] if p["kind"] == "picnicTable")
    on_table = {l["id"]: 0.35 for l in L["loot"] if t["x"] <= l["x"] <= t["x"] + t["w"] and t["y"] <= l["y"] <= t["y"] + t["h"]}
    loot = props.build_loot(L["loot"], P, C_DYN, lift=on_table)
    build_lights(lamps, car_front, van_front)

    bake.finish(OUT, W, H, P, statics, door_objs + canopies, emitters, hidden, loot, doors, COLL, CUT,
                bake=BAKE, samples=SAMPLES, lm_size=LM_SIZE,
                preview=os.path.join(HERE, "preview-park.png") if PREVIEW else None, ortho=max(W, H) * 0.6, t0=t0,
                meta={"lamp": LAMP}, export_hidden=False, probe_per_unit=4)


main()
