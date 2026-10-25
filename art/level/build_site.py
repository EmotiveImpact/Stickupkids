"""Builds one of the South London site jobs in Blender: a level laid over a
slice of OpenStreetMap (art/osm/<job>.json) with rooms of its own
(art/level/<job>.json), bakes its lighting and exports it for the game.

Run:  python3 art/level/build_site.py <job> [--bake] [--samples 96] [--size 4096] [--preview] [--out DIR]

Outputs (public/models/<job>/): level.glb, level-lightmap.png,
level-probe.png, level-materials.json, as for the estate (build_level.py).

What comes from where:
- The ground: the map's paths and roads cut into one sheet along their real
  edges (as build_park.py does), with the level's own paving, yards and
  floors filling the cells the level drew.
- Buildings: the map's footprints. Inside the map they stand to the game's
  wall cut with a cap on top, like every wall, and carry on up to their full
  height for the bake only; outside it they stand full height with lit
  windows (except south of the map, where they would hide it).
- Rooms: walls, windows and doors from the level's tiles, as in the estate.
- Each job's own pieces (a viaduct, a market roof) come from SITES below.
"""
import json
import math
import os
import random
import sys
import time

import bpy  # noqa: I001  (bpy must load before bmesh)
import bmesh  # noqa: F401
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bake  # noqa: E402
import dress  # noqa: E402
import furniture  # noqa: E402
import kit  # noqa: E402
import props  # noqa: E402
from bake import LIGHT_LOG, add_light  # noqa: E402
from kit import Geo  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
args = sys.argv
JOB = next(a for a in args[1:] if not a.startswith("--") and not a.replace(".", "").isdigit() and "/" not in a)
OUT = args[args.index("--out") + 1] if "--out" in args else os.path.join(ROOT, "public", "models", JOB)
DRESS = "--dress" in args     # litter the rooms with real models (art/level/dress.py)
BAKE = "--bake" in args
PREVIEW = "--preview" in args
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 96
LM_SIZE = int(args[args.index("--size") + 1]) if "--size" in args else 4096

CUT = 1.5     # wall height in the game
CEIL = 2.6    # ceiling height for the bake
SILL = 0.55
HEAD = 2.05
ZB = [0.0, SILL, CUT, HEAD, CEIL]

# Per job: lamp colour and power, the moon, materials, building heights and
# the job's own geometry (a function of the builder's geometry sets).
SITES = {
    "aylesbury": {
        # The walkway and path lamps: sodium orange, like the intro.
        "lamp": "#ff9a3c", "lamp_power": 850, "lamp_h": 5.0,
        "moon": ("#8aa2f0", 2.4), "sky": ("#1a2a55", 0.6),
        "wall_out": "panel",
        # Storeys above the ground floor, for the bake's shade and the far blocks.
        "x_height": 13.0, "far_height": 13.0,
        "rooms": {
            "living": ("#8fa4b0", ("#ffc890", 70)), "hall": ("#b8b6c8", ("#ffcf9e", 90)),
            "kitchen": ("#a9b8cc", ("#e8f0ff", 110)), "stash": ("#9a86a6", None),
            "lobby": ("#9aa0a8", ("#dfe8ff", 160)), "bins": ("#7a7884", ("#dfe8ff", 30)),
        },
        "floors": {"carpet": "carpet_council", "boards": "boards_old", "lino": "lino_marble", "tiles": "tiles_white"},
        "room_floor": {"stash": "carpet_red", "lobby": "tiles_slab", "bins": "concrete_floor"},
        "paved": "paving",
        "car_paint": "car_paint2",
    },
    "elephant": {
        # The lane's lamps are old sodium heads; the footpath has the same.
        "lamp": "#ff9a3c", "lamp_power": 750, "lamp_h": 5.5,
        "moon": ("#8aa2f0", 2.2), "sky": ("#1a2a55", 0.55),
        "wall_out": "brick_viaduct",
        "x_height": 7.0, "far_height": 15.0,
        "rooms": {
            "office": ("#a8a098", ("#ffe0b0", 90)),
            "grow": ("#d8dce4", ("#ffc8f0", 260)),
        },
        "floors": {"lino": "lino_marble", "tiles": "concrete_floor"},
        "room_floor": {},
        "paved": "paving",
        "car_paint": "car_paint",
        "extra": "elephant",
        # The deck over the road arches, for the bake's shade.
        "decks": [(-24, 22, None, 43, 6.2, 7.2)],
    },
    "brixton": {
        # White LED heads on the avenue and Coldharbour Lane.
        "lamp": "#ff9a3c", "lamp_power": 800, "lamp_h": 6.0,
        "moon": ("#8aa2f0", 2.3), "sky": ("#1a2a55", 0.55),
        "wall_out": "brick",
        "x_height": 9.0, "far_height": 12.0,
        "rooms": {
            "shop": ("#c4ccd8", ("#eef4ff", 150)), "stock": ("#a49c98", ("#ffd8a8", 60)),
            "back": ("#8c7c94", ("#ffc890", 55)), "row": ("#b0aca4", None), "row2": ("#b0aca4", None),
            "passage": ("#8e8a90", ("#dfe8ff", 30)),
        },
        "floors": {"lino": "lino_check", "boards": "boards_worn", "tiles": "tiles_slab"},
        "room_floor": {"stock": "concrete_floor", "back": "carpet_olive"},
        "paved": "paving",
        "car_paint": "car_paint2",
        "extra": "brixton",
    },
    "peckham": {
        # White LED heads on Cerise Road and the railway path.
        "lamp": "#ff9a3c", "lamp_power": 800, "lamp_h": 6.0,
        "moon": ("#8aa2f0", 2.4), "sky": ("#1a2a55", 0.6),
        "wall_out": "concrete",
        "x_height": 9.0, "far_height": 12.0,
        "rooms": {"deck": ("#9c9ca6", None), "deck2": ("#9c9ca6", None), "deck3": ("#9c9ca6", None), "stairs": ("#8a8a96", ("#dfe8ff", 45))},
        "floors": {"tiles": "concrete_floor"},
        "room_floor": {},
        "paved": "paving",
        "car_paint": "car_paint",
        "extra": "peckham",
    },
    "brockwell": {
        # Old park lamps on the paths, sodium orange.
        "lamp": "#ff9a3c", "lamp_power": 750, "lamp_h": 5.0,
        "moon": ("#8aa2f0", 2.4), "sky": ("#1a2a55", 0.6),
        "wall_out": "brick",
        "x_height": 4.0, "far_height": 10.0,
        "rooms": {
            "cafe": ("#d8d0c0", ("#ffe4b8", 120)), "store": ("#b0a8a0", ("#ffd8a8", 50)),
            "plant": ("#9aa4ac", ("#dfe8ff", 60)),
        },
        "floors": {"tiles": "tiles_white", "lino": "lino_marble"},
        "room_floor": {"store": "concrete_floor", "plant": "tiles_slab"},
        "paved": "paving",
        "car_paint": "car_paint2",
        "extra": "brockwell",
    },
}
CFG = SITES[JOB]
LAMP = CFG["lamp"]

kit.MATS.update({
    "path": ("tarmac", "#ffffff", 3.0, 0.45, None),
    "road": ("tarmac", "#8c90a2", 3.0, 0.3, None),
    "path_edge": ("concrete", "#9a9eae", 1.0, 0.7, None),
    "track": ("soil", "#6a6878", 2.0, 1.0, None),
    "canopy": ("grass", "#5e8478", 0.9, 1.0, None),
    "canopy_dark": ("grass", "#46685e", 0.9, 1.0, None),
    "shrub": ("grass", "#4c6c5c", 0.7, 1.0, None),
    "mulch": ("soil", "#7a7080", 2.0, 1.0, None),
    "roof_flat": ("concrete", "#5a5e6c", 2.0, 0.8, None),
    "panel": ("concrete", "#b4b2bc", 2.4, 0.85, None),
    "panel_dark": ("concrete", "#848290", 2.4, 0.85, None),
    "lino": ("tiles", "#a0a8b4", 0.6, 0.5, None),
    "emit_lamp_site": (None, "#ffffff", 1.0, 0.3, (LAMP, 22.0)),
    "brick_viaduct": ("brick_dark", "#d8c8d0", 0.9, 0.92, None),
    "mylar": (None, "#c8ccd8", 1.0, 0.25, None),
    "tent_black": ("fabric", "#3a3c48", 0.6, 0.9, None),
    "plant": ("grass", "#86b06a", 0.6, 1.0, None),
    "plant_dry": ("grass", "#a89a70", 0.6, 1.0, None),
    "emit_grow": (None, "#ffd8f4", 1.0, 0.3, ("#ffa8ec", 6.0)),
    "emit_pool": (None, "#1c78b0", 1.0, 0.05, ("#1a70b0", 0.7)),
    "pool_line": (None, "#1a3a78", 1.0, 0.1, ("#1a4a90", 0.6)),
    "coping": ("concrete", "#e8e4dc", 1.5, 0.7, None),
})
for rid, (tint, _light) in CFG["rooms"].items():
    kit.MATS[f"plaster_{rid}"] = ("plaster", tint, 2.0, 0.9, None)
kit.load_means(os.path.join(ROOT, "art", "textures", "out", "means.txt"))
L = json.load(open(os.path.join(HERE, f"{JOB}.json")))
OSM = json.load(open(os.path.join(ROOT, "art", "osm", f"{JOB}.json")))
W, H = L["w"], L["h"]
T = L["tiles"]
ROOMS = L["rooms"]
ROADS = ("tertiary", "secondary", "primary", "residential", "service", "unclassified", "living_street", "trunk")

bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bake.collections()
C_STATIC, C_EXPORT, C_BLOCK, C_DYN = COLL
rnd = random.Random(17)


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


def inside_map(x, y, pad=0.0):
    return -pad <= x < W + pad and -pad <= y < H + pad


def room_of(x, y):
    for r in ROOMS:
        if r["x0"] <= x <= r["x1"] and r["y0"] <= y <= r["y1"]:
            return r
    return None


DOORS = {(d["x"], d["y"]): d for d in L["doors"]}


def is_gate(x, y):
    """A door in a fence rather than a wall."""
    d = DOORS.get((x, y))
    if not d:
        return False
    a, b = ((x - 1, y), (x + 1, y)) if d["axis"] == "h" else ((x, y - 1), (x, y + 1))
    return tile(*a) not in "#W" and tile(*b) not in "#W"


def wall_like(x, y):
    return tile(x, y) in "#WDO" and not is_gate(x, y)


def is_floor(x, y):
    return room_of(x, y) is not None and tile(x, y) == "."


def is_shell(x, y):
    """A wall with outside on one side: thicker than a partition."""
    return any(not wall_like(x + dx, y + dy) and not is_floor(x + dx, y + dy)
               for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy)


def room_at_point(px, py):
    """Room id (or 'out') for a point, looking past walls towards the point's side."""
    x, y = math.floor(px), math.floor(py)
    if is_floor(x, y):
        return room_of(x, y)["id"]
    if not wall_like(x, y):
        return "out"
    dx, dy = px - (x + 0.5), py - (y + 0.5)
    sx, sy = (1 if dx > 0 else -1), (1 if dy > 0 else -1)
    cands = [(x + sx, y), (x, y + sy), (x + sx, y + sy)] if abs(dx) >= abs(dy) else [(x, y + sy), (x + sx, y), (x + sx, y + sy)]
    for cx, cy in cands:
        if is_floor(cx, cy):
            return room_of(cx, cy)["id"]
        if not wall_like(cx, cy):
            return "out"
    return "out"


def floor_mat(r):
    return CFG["room_floor"].get(r["id"]) or CFG["floors"].get(r["floor"], "boards")


# =================================================================== ground fields (as build_park.py)
GX0, GX1, GY0, GY1 = -24, W + 24, -20, H + 14
STEP = 1.0
SURFACES = [
    ("road", lambda p: p["kind"] in ROADS),
    ("path", lambda p: p["surface"] in ("asphalt", "paved", "concrete")),
    ("paving", lambda p: p["surface"] in ("paving_stones", "sett", "concrete:plates")),
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


def poly_mask(X, Y, pts):
    ring = pts + pts[:1]
    inside = np.zeros(X.shape, bool)
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        if ay == by:
            continue
        crosses = (ay > Y) != (by > Y)
        inside ^= crosses & (X < ax + (Y - ay) * (bx - ax) / (by - ay))
    return inside


def poly_field(X, Y, pts):
    d = seg_field(X, Y, pts + pts[:1], 0.0)
    return np.where(poly_mask(X, Y, pts), -d, d)


def path_fields(step):
    xs = GX0 + np.arange(int((GX1 - GX0) / step) + 1) * step
    ys = GY0 + np.arange(int((GY1 - GY0) / step) + 1) * step
    X, Y = np.meshgrid(xs, ys)
    out = []
    for mat, which in SURFACES:
        f = np.full(X.shape, 1e9)
        claimed = [p for p in OSM["paths"] if which(p) and next(m for m, w in SURFACES if w(p)) == mat]
        for p in claimed:
            f = np.minimum(f, seg_field(X, Y, p["pts"], p["width"] / 2))
        for a in OSM["areas"]:
            if mat == "road" and a["kind"] == "parking":
                f = np.minimum(f, poly_field(X, Y, a["pts"]))
        out.append(f)
    return out


FIELDS = path_fields(STEP)
ANY_PATH = np.minimum.reduce(FIELDS)


def path_dist(x, y):
    i = int(round((y - GY0) / STEP))
    j = int(round((x - GX0) / STEP))
    if 0 <= i < ANY_PATH.shape[0] and 0 <= j < ANY_PATH.shape[1]:
        return ANY_PATH[i, j]
    return 1e9


def area2(poly):
    return sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1])) / 2


def clip(poly, vals, inside):
    out = []
    n = len(poly)
    for i in range(n):
        p, q, fp, fq = poly[i], poly[(i + 1) % n], vals[i], vals[(i + 1) % n]
        pin, qin = (fp < 0) == inside, (fq < 0) == inside
        if pin:
            out.append(p)
        if pin != qin:
            t = fp / (fp - fq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out


def interp(cell, vals, p):
    (x0, y0), (x1, _), _, (_, y1) = cell
    u, v = (p[0] - x0) / (x1 - x0), (p[1] - y0) / (y1 - y0)
    return vals[0] * (1 - u) * (1 - v) + vals[1] * u * (1 - v) + vals[2] * u * v + vals[3] * (1 - u) * v


def outside_building(x, y):
    return any(inside_poly(b["pts"], x, y) for b in FAR_BUILDINGS)


def inside_poly(pts, x, y):
    c = False
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c


# =================================================================== ground
def build_ground():
    """One sheet in metre quads: rooms' floors, the level's paving, and the
    map's paths and roads cut in along their real edges."""
    near, inner, far = Geo("ground_near"), Geo("ground_int"), Geo("ground_far")
    paved = CFG["paved"]
    for gy in range(int((GY1 - GY0) / STEP)):
        for gx in range(int((GX1 - GX0) / STEP)):
            px, py = GX0 + gx * STEP, GY0 + gy * STEP
            x, y = math.floor(px + 0.5), math.floor(py + 0.5)
            t = tile(x, y)
            if t == "X":
                continue
            cell = [(px, py), (px + STEP, py), (px + STEP, py + STEP), (px, py + STEP)]
            r = room_of(x, y) if inside_map(x, y) else None
            if r and (t == "." or wall_like(x, y)):
                f = inner.poly([P(a, b, 0) for a, b in cell], floor_mat(r))
                if f.normal.z < 0:
                    f.normal_flip()
                continue
            g = near if inside_map(x, y, 3) else far
            if inside_map(x, y) and (t == "b" or wall_like(x, y)):
                pieces = [(cell, "mulch" if t == "b" else "concrete")]
            else:
                rest_mat = "grass"
                if inside_map(x, y):
                    rest_mat = {"p": paved, "r": "road", "=": "concrete", "D": paved}.get(t, "grass")
                pieces, rest = [], cell
                idx = [(gy, gx), (gy, gx + 1), (gy + 1, gx + 1), (gy + 1, gx)]
                vals_all = [[f[j] for j in idx] for f in FIELDS]
                for (mat, _), vals in zip(SURFACES, vals_all):
                    if not rest:
                        break
                    rv = [interp(cell, vals, p) for p in rest]
                    if all(v >= 0 for v in rv):
                        continue
                    on = clip(rest, rv, True)
                    off = clip(rest, rv, False)
                    if len(off) < 3 or abs(area2(off)) < 1e-3:
                        pieces.append((rest, mat))
                        rest = []
                    elif len(on) >= 3 and abs(area2(on)) >= 1e-3:
                        pieces.append((on, mat))
                        rest = off
                if rest:
                    pieces.append((rest, rest_mat))
            for poly, mat in pieces:
                f = g.poly([P(a, b, 0) for a, b in poly], mat)
                if f.normal.z < 0:
                    f.normal_flip()
    return near, inner, far


# =================================================================== rooms: walls
R = 20


def wall_box():
    cells = [(x, y) for y in range(H) for x in range(W) if wall_like(x, y)]
    if not cells:
        return None
    xs, ys = [c[0] for c in cells], [c[1] for c in cells]
    return min(xs) - 1, min(ys) - 1, max(xs) + 2, max(ys) + 2


def solid_band(ch, b):
    if ch == "#":
        return True
    if ch == "W":
        return b in (0, 3)
    return b == 3


def greedy(lab):
    lab = lab.copy()
    nr, nc = lab.shape
    for r in range(nr):
        c = 0
        while c < nc:
            v = lab[r, c]
            if v < 0:
                c += 1
                continue
            c1 = c
            while c1 + 1 < nc and lab[r, c1 + 1] == v:
                c1 += 1
            r1 = r
            while r1 + 1 < nr and np.all(lab[r1 + 1, c:c1 + 1] == v):
                r1 += 1
            lab[r:r1 + 1, c:c1 + 1] = -1
            yield r, c, r1, c1, v
            c = c1 + 1


def faces_from_mask(solid, X0, Y0, res, zb, groups, mat_at, caps=None, cap_band=1, top=None):
    """Vertical faces round a banded raster of solid pixels (solid[b, j, i]),
    greedily merged. groups: [(geo, bands)]. mat_at(i, j) names the material
    for a face whose open side is pixel (i, j). caps: a Geo for the cut top
    of band cap_band. top: (geo, band, z, mat) for the top of the walls."""
    nb, NY, NX = solid.shape
    ids = {}

    def mid(m):
        return ids.setdefault(m, len(ids))

    def names():
        return {v: k for k, v in ids.items()}

    for i in range(NX + 1):
        left = solid[:, :, i - 1] if i > 0 else np.zeros((nb, NY), bool)
        right = solid[:, :, i] if i < NX else np.zeros((nb, NY), bool)
        for sign in (1, -1):
            exist = (left & ~right) if sign > 0 else (right & ~left)
            if not exist.any():
                continue
            for geo, bands in groups:
                lab = np.full((len(bands), NY), -1, dtype=int)
                for bi, b in enumerate(bands):
                    for j in np.nonzero(exist[b])[0]:
                        lab[bi, j] = mid(mat_at(i if sign > 0 else i - 1, j))
                nm = names()
                for r0, c0, r1, c1, lb in greedy(lab):
                    z0, z1 = zb[bands[r0]], zb[bands[r1] + 1]
                    geo.quad(P(X0 + i / res, Y0 + (c1 + 1) / res, z0), (0, (c1 + 1 - c0) / res, 0), (0, 0, z1 - z0), nm[lb],
                             n=(sign, 0, 0))
    for j in range(NY + 1):
        north = solid[:, j - 1, :] if j > 0 else np.zeros((nb, NX), bool)
        south = solid[:, j, :] if j < NY else np.zeros((nb, NX), bool)
        for sign in (1, -1):
            exist = (north & ~south) if sign > 0 else (south & ~north)
            if not exist.any():
                continue
            for geo, bands in groups:
                lab = np.full((len(bands), NX), -1, dtype=int)
                for bi, b in enumerate(bands):
                    for i in np.nonzero(exist[b])[0]:
                        lab[bi, i] = mid(mat_at(i, j if sign > 0 else j - 1))
                nm = names()
                for r0, c0, r1, c1, lb in greedy(lab):
                    z0, z1 = zb[bands[r0]], zb[bands[r1] + 1]
                    geo.quad(P(X0 + c0 / res, Y0 + j / res, z0), ((c1 + 1 - c0) / res, 0, 0), (0, 0, z1 - z0), nm[lb], n=(0, -sign, 0))
    if caps is not None:
        lab = np.where(solid[cap_band], 0, -1)
        for r0, c0, r1, c1, _ in greedy(lab):
            caps.quad(P(X0 + c0 / res, Y0 + (r1 + 1) / res, zb[cap_band + 1]), ((c1 + 1 - c0) / res, 0, 0),
                      (0, (r1 + 1 - r0) / res, 0), "cap", n=(0, 0, 1))
    if top is not None:
        geo, band, z, mat = top
        lab = np.where(solid[band], 0, -1)
        for r0, c0, r1, c1, _ in greedy(lab):
            geo.quad(P(X0 + c0 / res, Y0 + (r1 + 1) / res, z), ((c1 + 1 - c0) / res, 0, 0), (0, (r1 + 1 - r0) / res, 0), mat,
                     n=(0, 0, 1))


def build_walls():
    """The level's own walls (rooms, sheds, stair lobbies): cut at 1.5 for
    the game, carried on to the ceiling for the bake."""
    low, high, caps = Geo("walls"), Geo("walls_block"), Geo("caps")
    box = wall_box()
    if not box:
        return low, high, caps
    HX0, HY0, HX1, HY1 = box
    NXP, NYP = (HX1 - HX0) * R, (HY1 - HY0) * R
    ch = np.full((NYP, NXP), "", dtype="<U1")
    half = R // 2

    def fill(i0, j0, i1, j1, c):
        ch[max(0, j0):min(NYP, j1), max(0, i0):min(NXP, i1)] = c

    for y in range(HY0, HY1):
        for x in range(HX0, HX1):
            if not wall_like(x, y):
                continue
            c = tile(x, y)
            t = 6 if is_shell(x, y) else 4
            ci, cj = (x - HX0) * R + half, (y - HY0) * R + half
            fill(ci - t // 2, cj - t // 2, ci + t // 2, cj + t // 2, c)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if not wall_like(x + dx, y + dy):
                    continue
                tt = min(t, 6 if is_shell(x + dx, y + dy) else 4)
                if dx == 1:
                    fill(ci, cj - tt // 2, (x - HX0 + 1) * R, cj + tt // 2, c)
                elif dx == -1:
                    fill((x - HX0) * R, cj - tt // 2, ci, cj + tt // 2, c)
                elif dy == 1:
                    fill(ci - tt // 2, cj, ci + tt // 2, (y - HY0 + 1) * R, c)
                else:
                    fill(ci - tt // 2, (y - HY0) * R, ci + tt // 2, cj, c)
    solid = np.zeros((4, NYP, NXP), dtype=bool)
    for b in range(4):
        for c in "#WDO":
            if solid_band(c, b):
                solid[b] |= ch == c

    def wmat(i, j):
        px, py = HX0 + (i + 0.5) / R, HY0 + (j + 0.5) / R
        if i < 0 or j < 0 or i >= NXP or j >= NYP:
            return CFG["wall_out"]
        x, y = math.floor(px), math.floor(py)
        if tile(x, y) in "DWO":
            t = 6 if is_shell(x, y) else 4
            horiz = wall_like(x - 1, y) or wall_like(x + 1, y)
            off = abs((py - (y + 0.5)) * R) if horiz else abs((px - (x + 0.5)) * R)
            if off < t / 2 + 0.01:
                return "frame_white"
        r = room_at_point(px, py)
        return CFG["wall_out"] if r == "out" else f"plaster_{r}"

    # Bands 0-1 below the cut (exported), 2-3 above it (bake only).
    faces_from_mask(solid, HX0, HY0, R, ZB, ((low, (0, 1)), (high, (2, 3))), wmat, caps=caps, cap_band=1,
                    top=(high, 3, CEIL, "ceiling"))
    # Sills and lintels where bands change.
    for k in (1, 2, 3):
        below, above = solid[k - 1], solid[k]
        for up, exist in ((True, below & ~above), (False, above & ~below)):
            geo = low if ZB[k] <= CUT else high
            for r0, c0, r1, c1, _ in greedy(np.where(exist, 0, -1)):
                geo.quad(P(HX0 + c0 / R, HY0 + (r1 + 1) / R, ZB[k]), ((c1 + 1 - c0) / R, 0, 0), (0, (r1 + 1 - r0) / R, 0),
                         "sill" if up else "frame_white", n=(0, 0, 1 if up else -1))
    return low, high, caps


def build_openings():
    frames, frames_hi, glass, sills = Geo("frames"), Geo("frames_block"), Geo("glass"), Geo("sills")
    fw, fd = 0.06, 0.07
    seen = set()
    for y in range(H):
        for x in range(W):
            if tile(x, y) != "W" or (x, y) in seen:
                continue
            horiz = wall_like(x - 1, y) or wall_like(x + 1, y)
            run = [(x, y)]
            nx_, ny_ = (x + 1, y) if horiz else (x, y + 1)
            while tile(nx_, ny_) == "W":
                run.append((nx_, ny_))
                nx_, ny_ = (nx_ + 1, ny_) if horiz else (nx_, ny_ + 1)
            seen.update(run)
            t = 0.3
            if horiz:
                a0, a1, c = run[0][0], run[-1][0] + 1, y + 0.5
                outward = 1 if not is_floor(x, y + 1) else -1

                def box(u0, u1, z0, z1, d, m, off=0.0, geo=frames, c=c):
                    geo.aabb(BX(u0), BY(c + off) - d / 2, z0, BX(u1), BY(c + off) + d / 2, z1, m, bevel=0.006)
            else:
                a0, a1, c = run[0][1], run[-1][1] + 1, x + 0.5
                outward = 1 if not is_floor(x + 1, y) else -1

                def box(u0, u1, z0, z1, d, m, off=0.0, geo=frames, c=c):
                    geo.aabb(BX(c + off) - d / 2, BY(u1), z0, BX(c + off) + d / 2, BY(u0), z1, m, bevel=0.006)
            box(a0, a1, SILL, SILL + fw, fd, "frame_white")
            box(a0, a0 + fw, SILL, CUT, fd, "frame_white")
            box(a1 - fw, a1, SILL, CUT, fd, "frame_white")
            box(a0, a0 + fw, CUT, HEAD, fd, "frame_white", geo=frames_hi)
            box(a1 - fw, a1, CUT, HEAD, fd, "frame_white", geo=frames_hi)
            box(a0, a1, HEAD - fw, HEAD, fd, "frame_white", geo=frames_hi)
            for k in range(1, a1 - a0):
                box(a0 + k - fw / 2, a0 + k + fw / 2, SILL, CUT, fd, "frame_white")
            box(a0 + fw, a1 - fw, SILL + fw, CUT, 0.012, "glass", geo=glass)
            box(a0 - 0.08, a1 + 0.08, SILL - 0.06, SILL, 0.16, "sill", off=outward * (t / 2 + 0.05), geo=sills)
            box(a0 - 0.05, a1 + 0.05, SILL - 0.03, SILL, 0.12, "frame_white", off=-outward * (t / 2 + 0.03), geo=sills)
    return frames, frames_hi, glass, sills


def build_doors():
    """Door leaves in walls, gates in fences, hung from their hinges."""
    out = []
    for d in L["doors"]:
        x, y = d["x"], d["y"]
        g, hi = Geo(f"door_{x}_{y}"), Geo(f"door_{x}_{y}_block")
        w, th = 0.94, 0.045
        if d["axis"] == "h":
            hinge, along, side = P(x + 0.03, y + 0.5), Vector((1, 0, 0)), Vector((0, 1, 0))
        else:
            hinge, along, side = P(x + 0.5, y + 0.03), Vector((0, -1, 0)), Vector((1, 0, 0))
        rot = math.atan2(along.y, along.x)
        mid = hinge + along * (w / 2)
        if is_gate(x, y):
            for z in (0.08, 0.7, 1.32):
                g.box(mid + Vector((0, 0, z)), (w, 0.04, 0.04), "metal_dark", rot=rot)
            for k in range(9):
                g.cyl(hinge + along * (0.04 + k * (w - 0.08) / 8), 0.013, 1.36, "metal_dark", segs=6)
        else:
            name = d["name"].lower()
            mat = "door_front" if "front" in name else ("metal_dark" if "bin" in name or "shutter" in name else "door_int")
            g.box(mid + Vector((0, 0, CUT / 2)), (w, th, CUT), mat, bevel=0.008, rot=rot)
            hi.box(mid + Vector((0, 0, (CUT + 2.0) / 2)), (w, th, 2.0 - CUT), mat, rot=rot)
            if "lobby" in name:
                for s in (-1, 1):
                    g.box(hinge + along * (w / 2) + side * s * (th / 2 + 0.004) + Vector((0, 0, 0.95)), (0.7, 0.01, 1.0), "glass", rot=rot)
            for s in (-1, 1):
                p = hinge + along * (w - 0.1) + side * s * (th / 2 + 0.03) + Vector((0, 0, 1.0))
                g.box(p, (0.03, 0.05, 0.05), "chrome", bevel=0.01, rot=rot)
                g.box(p + along * -0.05 + side * s * 0.02, (0.13, 0.025, 0.025), "chrome", bevel=0.008, rot=rot)
        out.append({"def": d, "geo": g, "hi": hi, "hinge": hinge})
    return out


def build_ceilings():
    b = Geo("ceiling_block")
    for r in ROOMS:
        b.aabb(BX(r["x0"] - 0.2), BY(r["y1"] + 1.2), CEIL, BX(r["x1"] + 1.2), BY(r["y0"] - 0.2), CEIL + 0.15, "ceiling")
    return b


# =================================================================== buildings
ALL_BUILDINGS = []
for b in OSM["buildings"]:
    pts = b["pts"][:-1] if b["pts"][0] == b["pts"][-1] else b["pts"]
    if len(pts) >= 3:
        ALL_BUILDINGS.append({**b, "pts": pts, "cx": sum(p[0] for p in pts) / len(pts), "cy": sum(p[1] for p in pts) / len(pts)})
FAR_BUILDINGS = [b for b in ALL_BUILDINGS if not inside_map(b["cx"], b["cy"])]


def build_map_blocks():
    """The map's buildings inside the level, from its X cells: walls to the
    cut (exported, with a cap), lit ground-floor windows, the rest of their
    height for the bake."""
    res = 4
    X0, Y0 = 0, 0
    NX, NY = W * res, H * res
    xs = (np.arange(NX) + 0.5) / res
    ys = (np.arange(NY) + 0.5) / res
    XX, YY = np.meshgrid(xs, ys)
    tiles = np.array([list(r) for r in T])
    xcell = tiles[(YY.astype(int)), (XX.astype(int))] == "X"
    inpoly = np.zeros(xcell.shape, bool)
    for b in ALL_BUILDINGS:
        inpoly |= poly_mask(XX, YY, b["pts"])
    mask = xcell & inpoly
    # X cells with no footprint under them (the slice cut a building's edge) stay whole cells.
    mask |= xcell & ~np.repeat(np.repeat(np.array([[inpoly[j * res:(j + 1) * res, i * res:(i + 1) * res].any()
                                                     for i in range(W)] for j in range(H)]), res, 0), res, 1)
    zb = [0.0, CUT, CFG["x_height"]]
    solid = np.stack([mask, mask])
    low, high, caps = Geo("blocks"), Geo("blocks_block"), Geo("blocks_caps")
    faces_from_mask(solid, X0, Y0, res, zb, ((low, (0,)), (high, (1,))), lambda i, j: CFG["wall_out"], caps=caps, cap_band=0,
                    top=(high, 1, CFG["x_height"], "roof_flat"))
    # Ground-floor windows along the long faces, some lit.
    emit, det = Geo("blocks_windows"), Geo("blocks_detail")
    wr = random.Random(9)
    for f in list(low.bm.faces):
        n = f.normal
        if abs(n.z) > 0.5:
            continue
        vs = [v.co for v in f.verts]
        lo = min(vs, key=lambda v: (v.x, v.y))
        hi = max(vs, key=lambda v: (v.x, v.y))
        seg = (Vector((hi.x, hi.y, 0)) - Vector((lo.x, lo.y, 0)))
        if seg.length < 2.6:
            continue
        u = seg.normalized()
        out = Vector((n.x, n.y, 0)).normalized() * 0.03
        rot = math.atan2(u.y, u.x)
        s = 1.3
        while s < seg.length - 1.0:
            c = Vector((lo.x, lo.y, 0)) + u * s + out
            state = wr.random()
            m = "glass" if state < 0.5 else ("emit_window_warm" if state < 0.8 else ("emit_window_tv" if state < 0.9 else "emit_window_cool"))
            det.box(c + Vector((0, 0, 0.95)), (1.3, 0.05, 0.85), "frame_white", rot=rot)
            (emit if m.startswith("emit") else det).box(c + out + Vector((0, 0, 0.98)), (1.18, 0.04, 0.75), m, rot=rot)
            s += 3.2
    return low, high, caps, emit, det


def build_far_buildings():
    """Buildings round the map: full height with lit windows, except those
    south of it, which stand to the cut so they hide nothing."""
    g, emit, caps = Geo("far_buildings"), Geo("far_windows"), Geo("far_caps")
    wr = random.Random(5)
    for b in FAR_BUILDINGS:
        pts, cx, cy = b["pts"], b["cx"], b["cy"]
        if not (GX0 - 20 <= cx <= GX1 + 20 and GY0 - 30 <= cy <= GY1 + 10):
            continue
        south = cy > H - 2
        levels = int(b["levels"]) if (b["levels"] or "").isdigit() else max(2, int(CFG["far_height"] / 3))
        z = CUT if south else min(30.0, 0.4 + levels * 3.0)
        if area2(pts) > 0:
            pts = pts[::-1]
        base = [P(x, y, 0) for x, y in pts]
        top = [P(x, y, z) for x, y in pts]
        f = (caps if south else g).poly(top, "cap" if south else "roof_flat")
        if f.normal.z < 0:
            f.normal_flip()
        n = len(pts)
        cc = sum(base, Vector()) / n
        wall = CFG["wall_out"] if wr.random() < 0.6 else wr.choice(("brick_n1", "brick_n2", "panel_dark"))
        for k in range(n):
            a, b2 = base[k], base[(k + 1) % n]
            f = g.poly([a, b2, top[(k + 1) % n], top[k]], wall)
            if f.normal.dot((a + b2) / 2 - cc) < 0:
                f.normal_flip()
            if south or f.normal.y > -0.2:
                continue
            seg, u = (b2 - a).length, (b2 - a).normalized()
            out = f.normal.normalized() * 0.03
            for lv in range(int((z - 0.4) / 3.0)):
                for s in np.arange(1.2, seg - 0.8, 2.6):
                    lit = wr.random() < 0.3
                    c = a + u * s + out + Vector((0, 0, 1.5 + lv * 3.0))
                    (emit if lit else g).box(c, (1.0, 0.04, 1.2),
                                             wr.choice(("emit_window_warm", "emit_window_cool", "emit_window_tv")) if lit else "glass",
                                             rot=math.atan2(u.y, u.x))
    return g, emit, caps


def build_fences():
    """Railings along the level's fence cells."""
    g = Geo("fences")

    def fence(x, y):
        return tile(x, y) == "=" or is_gate(x, y)

    for y in range(H):
        for x in range(W):
            if tile(x, y) != "=":
                continue
            c = (x + 0.5, y + 0.5)
            g.box(P(*c, 0.7), (0.07, 0.07, 1.4), "metal_dark")
            for dx, dy in ((1, 0), (0, 1)):
                if not fence(x + dx, y + dy):
                    continue
                n = (c[0] + dx, c[1] + dy)
                if is_gate(x + dx, y + dy):
                    n = (c[0] + dx * 0.47, c[1] + dy * 0.47)
                mx, my = (c[0] + n[0]) / 2, (c[1] + n[1]) / 2
                length = math.hypot(n[0] - c[0], n[1] - c[1])
                rot = 0 if dx else math.pi / 2
                for zz in (0.1, 1.32):
                    g.box(P(mx, my, zz), (length, 0.035, 0.035), "metal_dark", rot=rot)
                for k in range(1, 8):
                    t = k / 8 * (length / 1.0)
                    if t >= length:
                        break
                    g.cyl(P(c[0] + dx * t, c[1] + dy * t, 0.1), 0.012, 1.22, "metal_dark", segs=4, cap=False)
            # The far post of a gate.
            for dx, dy in ((-1, 0), (0, -1)):
                if is_gate(x + dx, y + dy):
                    q = (c[0] + dx * 0.53, c[1] + dy * 0.53)
                    g.box(P(*q, 0.7), (0.07, 0.07, 1.4), "metal_dark")
                    g.box(P((c[0] + q[0]) / 2, (c[1] + q[1]) / 2, 0.1), (0.47, 0.035, 0.035), "metal_dark", rot=0 if dx else math.pi / 2)
                    g.box(P((c[0] + q[0]) / 2, (c[1] + q[1]) / 2, 1.32), (0.47, 0.035, 0.035), "metal_dark", rot=0 if dx else math.pi / 2)
    return g


# =================================================================== planting
def build_trees():
    near_t, far_t, crowns, far_crowns = Geo("trees"), Geo("far_trees"), Geo("canopies"), Geo("far_canopies")
    spots = [(p["x"] + 0.5, p["y"] + 0.5, rnd.uniform(0.9, 1.15)) for p in L["props"] if p["kind"] == "tree"]
    for x, y in OSM["trees"]:
        if not inside_map(x, y) and GX0 < x < GX1 and GY0 < y < GY1 and path_dist(x, y) > 1.0 and not outside_building(x, y):
            spots.append((x, y, 1.05))
    tries = 0
    while tries < 1500:
        tries += 1
        x, y = rnd.uniform(GX0 + 2, GX1 - 2), rnd.uniform(GY0 + 2, GY1 - 2)
        if inside_map(x, y, 2) or path_dist(x, y) < 2.5 or outside_building(x, y):
            continue
        if any(inside_poly(b["pts"], x + dx, y + dy) for b in FAR_BUILDINGS for dx, dy in ((3, 0), (-3, 0), (0, 3), (0, -3))):
            continue
        if any(math.hypot(x - a, y - b) < 8 for a, b, _ in spots):
            continue
        spots.append((x, y, rnd.uniform(0.9, 1.2)))
        if len(spots) > 140:
            break
    for k, (x, y, s) in enumerate(spots):
        inside = inside_map(x, y, 3)
        furniture.tree(near_t if inside else far_t, crowns if inside else far_crowns, x, y, s, seed=k, blobs=6 if inside else 4)
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
def build_furniture(emit):
    ext, inner = Geo("props_ext"), Geo("props_int")
    extra, lamps, cars = [], [], []
    for p in L["props"]:
        k = p["kind"]
        if k == "lamp":
            lamps.append(furniture.column_lamp(ext, emit, p["x"] + 0.5, p["y"] + 0.5, CFG["lamp_h"]))
        elif k == "bench":
            furniture.bench(ext, p)
        elif k == "bin":
            furniture.litter_bin(ext, p)
        elif k == "car":
            front, heading = furniture.parked_car(ext, emit, p, CFG["car_paint"], lights=True)
            cars.append((front, heading))
        elif k == "parked":
            furniture.parked_car(ext, emit, p, rnd.choice(("car_paint", "car_paint2", "metal", "bin_blue", "van_paint")))
        elif k in furniture.FNS:
            furniture.FNS[k](inner if room_of(p["x"], p["y"]) else ext, extra, p)
    v = L["van"]
    vp = {"x": v["x0"], "y": v["y0"], "w": v["x1"] - v["x0"] + 1, "h": v["y1"] - v["y0"] + 1, "facing": -math.pi / 2}
    van = furniture.parked_car(ext, emit, vp, "van_paint", lights=True, van=True)
    # Road centre lines on the map's bigger roads.
    for p in OSM["paths"]:
        if p["kind"] in ("tertiary", "secondary", "primary", "trunk"):
            dashes(ext, p["pts"])
    return ext, inner, extra, lamps, cars, van


def dashes(g, pts, mat="paint_road", length=1.6, gap=2.6, width=0.12):
    carry = 0.0
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        seg = math.hypot(bx - ax, by - ay)
        if seg < 1e-6:
            continue
        ux, uy = (bx - ax) / seg, (by - ay) / seg
        s = carry
        while s + length <= seg:
            cx, cy = ax + ux * (s + length / 2), ay + uy * (s + length / 2)
            if GX0 + 1 < cx < GX1 - 1 and GY0 + 1 < cy < GY1 - 1 and tile(math.floor(cx), math.floor(cy)) in "rg":
                g.box(P(cx, cy, 0.006), (length, width, 0.012), mat, rot=math.atan2(-uy, ux))
            s += length + gap
        carry = s - seg


# =================================================================== each job's own pieces
def extra_elephant(ext, emit, block, extra):
    """The viaduct carried on past the map, the grow's tents and rack, the
    car wash's kit."""
    vy0, vy1 = 22, 43
    for x0, x1 in ((GX0 - 10, 0), (W, GX1 + 10)):
        ext.aabb(BX(x0), BY(vy1), 0, BX(x1), BY(vy0), 7.2, "brick_viaduct")
    # Parapet and railings along both faces, inside the map too (bake only above the cut).
    for y in (vy0 + 0.3, vy1 - 0.3):
        block.aabb(BX(GX0), BY(y + 0.3), 7.2, BX(GX1), BY(y - 0.3), 8.2, "brick_viaduct")
    for p in L["props"]:
        k = p["kind"]
        x0, y0, x1, y1 = p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"]
        if k == "tent":
            # A grow tent with its sides rolled to the cut, plants under a light bar.
            ext.aabb(BX(x0 + 0.05), BY(y1 - 0.05), 0, BX(x1 - 0.05), BY(y0 + 0.05), 0.03, "mylar")
            for (a, b, c, d) in ((x0, y0, x1, y0 + 0.05), (x0, y1 - 0.05, x1, y1), (x0, y0, x0 + 0.05, y1), (x1 - 0.05, y0, x1, y1)):
                ext.aabb(BX(a + 0.05), BY(d - 0.05 if d == y1 else d), 0, BX(c - 0.05 if c == x1 else c), BY(b + 0.05 if b == y0 else b), 1.25,
                         "mylar" if (b + d) / 2 > y0 + 0.5 else "tent_black")
            for cx in (x0 + 0.5, x0 + 1.5):
                for cy in (y0 + 0.5, y0 + 1.5, y0 + 2.5):
                    ext.cyl(P(cx, cy, 0), 0.18, 0.28, "plant_pot", segs=10, r2=0.15)
                    for k2 in range(3):
                        ext.ico(P(cx + rnd.uniform(-0.1, 0.1), cy + rnd.uniform(-0.1, 0.1), 0.55 + k2 * 0.25), 0.28 - k2 * 0.05, "plant",
                                subdiv=1, noise=0.3, seed=int(cx * 10 + cy * 100 + k2))
            emit.aabb(BX(x0 + 0.3), BY((y0 + y1) / 2 + 0.6), 1.9, BX(x1 - 0.3), BY((y0 + y1) / 2 - 0.6), 1.94, "emit_grow")
            extra.append(("grow", P((x0 + x1) / 2, (y0 + y1) / 2, 1.8)))
        elif k == "rack":
            for z in (0.4, 0.9, 1.4):
                ext.aabb(BX(x0 + 0.1), BY(y1 - 0.1), z, BX(x1 - 0.1), BY(y0 + 0.1), z + 0.03, "metal")
                for k2 in range(6):
                    ext.ico(P(x0 + 0.3 + (k2 % 3) * 0.7, y0 + 0.5 + (k2 // 3) * 1.0, z - 0.12), 0.16, "plant_dry", subdiv=1, noise=0.35,
                            seed=k2 + int(z * 10))
            for a in (x0 + 0.1, x1 - 0.1):
                for b in (y0 + 0.1, y1 - 0.1):
                    ext.cyl(P(a, b, 0), 0.02, 1.45, "metal", segs=6)
        elif k == "washer":
            c = P(x0 + 0.5, y0 + 0.5)
            ext.box(c + Vector((0, 0, 0.35)), (0.7, 0.5, 0.6), "can_red", bevel=0.05)
            ext.cyl(c + Vector((0.2, 0.3, 0.05)), 0.25, 0.08, "plastic_black", segs=14)
            ext.cyl(c + Vector((0.4, -0.6, 0.02)), 0.02, 2.0, "plastic_black", segs=6, axis="X", rot=-0.6)
        elif k == "tyres":
            for k2 in range(p["h"] * 3):
                cy = y0 + 0.5 + (k2 // 3)
                ext.cyl(P(x0 + 0.5, cy, (k2 % 3) * 0.24), 0.36, 0.22, "tyre", segs=16)
    # Puddles of light from the shutters and a strip light in the car wash.
    emit.aabb(BX(57.5), BY(28.1), 5.6, BX(62.5), BY(27.9), 5.65, "emit_strip")
    extra.append(("wash", P(60, 28, 5.3)))


def extra_brixton(ext, emit, block, extra):
    """Market Row's shuttered stalls and strip lights, and the railway
    viaducts: their decks over the map for the bake's shade, and the arches
    themselves where they run on past it."""
    rooms = {r["id"]: r for r in ROOMS}
    ew, ns = rooms["row"], rooms["row2"]
    doors = {(d["x"], d["y"]) for d in L["doors"]}

    def shutters(axis, fixed, a0, a1, face):
        """Roller shutters on one wall of an arm, 3.4 m wide with piers between."""
        a = a0
        while a + 3.4 <= a1 + 1:
            cells = [(int(fixed - (face < 0)), int(a + k)) if axis == "y" else (int(a + k), int(fixed - (face < 0))) for k in range(4)]
            if not any(c in doors or tile(*c) not in "X#" for c in cells):
                if axis == "x":
                    x0, x1, y0, y1 = a + 0.3, a + 3.7, fixed + face * 0.02, fixed + face * 0.08
                else:
                    y0, y1, x0, x1 = a + 0.3, a + 3.7, fixed + face * 0.02, fixed + face * 0.08
                x0, x1 = min(x0, x1), max(x0, x1)
                y0, y1 = min(y0, y1), max(y0, y1)
                ext.aabb(BX(x0), BY(y1), 0, BX(x1), BY(y0), CUT - 0.05, "metal")
                block.aabb(BX(x0), BY(y1), CUT - 0.05, BX(x1), BY(y0), CEIL - 0.25, "metal")
                block.aabb(BX(x0), BY(y1), CEIL - 0.25, BX(x1), BY(y0), CEIL, "metal_dark")
            a += 4

    shutters("x", ew["y0"], ew["x0"], ew["x1"], 1)
    shutters("x", ew["y1"] + 1, ew["x0"], ew["x1"], -1)
    shutters("y", ns["x0"], ns["y0"], ns["y1"], 1)
    shutters("y", ns["x1"] + 1, ns["y0"], ns["y1"], -1)
    # Strip lights down the middle of both arms.
    cy = (ew["y0"] + ew["y1"] + 1) / 2
    for x in range(ew["x0"] + 3, ew["x1"] - 2, 9):
        emit.aabb(BX(x - 1), BY(cy + 0.08), CEIL - 0.12, BX(x + 1), BY(cy - 0.08), CEIL - 0.08, "emit_strip")
        extra.append(("strip", P(x, cy, CEIL - 0.2)))
    cx = (ns["x0"] + ns["x1"] + 1) / 2
    for y in range(ns["y0"] + 3, ns["y1"] - 1, 9):
        emit.aabb(BX(cx - 0.08), BY(y + 1), CEIL - 0.12, BX(cx + 0.08), BY(y - 1), CEIL - 0.08, "emit_strip")
        extra.append(("strip", P(cx, y, CEIL - 0.2), math.pi / 2))
    # Every line through Brixton runs on arches here.
    viaducts(ext, block)

def viaducts(ext, block):
    """Railway viaducts from the OSM rail lines: the deck over the map for the
    bake's shade, the arches themselves where they run on past it."""
    for r in OSM["rail"]:
        pts = r["pts"]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            mx, my = (ax + bx) / 2, (ay + by) / 2
            if not (GX0 - 40 < mx < GX1 + 40 and GY0 - 40 < my < GY1 + 40):
                continue
            length = math.hypot(bx - ax, by - ay)
            if length < 0.5:
                continue
            ux, uy = (bx - ax) / length, (by - ay) / length
            rot = math.atan2(-uy, ux)
            inside = -2 < mx < W + 2 and -2 < my < H + 2
            if inside:
                block.box(P(mx, my, 6.7), (length + 1.0, 8.0, 1.0), "brick_viaduct", rot=rot)
            else:
                ext.box(P(mx, my, 3.6), (length + 1.0, 8.0, 7.2), "brick_viaduct", rot=rot)


def extra_peckham(ext, emit, block, extra):
    """The car park deck's bay lines and strip lights, the railway along the south."""
    rooms = {r["id"]: r for r in ROOMS}
    x0, x1, y0, y1 = rooms["deck"]["x0"], rooms["deck2"]["x1"], rooms["deck"]["y0"], rooms["deck2"]["y1"]
    for y in range(y0 + 2, y1 - 1, 6):
        for x in range(x0 + 2, x1 - 1, 8):
            if tile(x, y) == "." and tile(x, y - 1) == "." and tile(x, y + 1) == ".":
                emit.aabb(BX(x - 1), BY(y + 0.08), CEIL - 0.12, BX(x + 1), BY(y - 0.08), CEIL - 0.08, "emit_strip")
                extra.append(("strip", P(x, y, CEIL - 0.2)))
    # Bay lines along the north and south walls.
    for ya, yb in ((y0, y0 + 4.8), (y1 - 3.8, y1 + 1)):
        x = x0
        while x <= x1 + 1:
            if all(tile(int(min(x, W - 1)), int(y)) in "." for y in (ya + 0.5, yb - 0.5)):
                ext.aabb(BX(x - 0.05), BY(yb), 0.0, BX(x + 0.05), BY(ya), 0.012, "paint_road")
            x += 2.5
    viaducts(ext, block)


def extra_brockwell(ext, emit, block, extra):
    """The pool: lit water with lane lines, white coping round the edge, and
    the underwater lights' glow for the bake."""
    cells = [(x, y) for y in range(H) for x in range(W) if tile(x, y) == "w"]
    x0, x1 = min(c[0] for c in cells), max(c[0] for c in cells) + 1
    y0, y1 = min(c[1] for c in cells), max(c[1] for c in cells) + 1
    emit.aabb(BX(x0), BY(y1), -0.02, BX(x1), BY(y0), 0.02, "emit_pool")
    lanes = 8
    for k in range(1, lanes):
        y = y0 + (y1 - y0) * k / lanes
        emit.aabb(BX(x0 + 2), BY(y + 0.15), 0.021, BX(x1 - 2), BY(y - 0.15), 0.025, "pool_line")
    for a, b, c, d in ((x0 - 0.5, y0 - 0.5, x1 + 0.5, y0), (x0 - 0.5, y1, x1 + 0.5, y1 + 0.5),
                       (x0 - 0.5, y0, x0, y1), (x1, y0, x1 + 0.5, y1)):
        ext.aabb(BX(a), BY(d), 0, BX(c), BY(b), 0.08, "coping")
    for k in range(5):
        x = x0 + (x1 - x0) * (k + 0.5) / 5
        extra.append(("pool", P(x, (y0 + y1) / 2, 0.3)))


EXTRAS = {"elephant": extra_elephant, "brixton": extra_brixton, "peckham": extra_peckham, "brockwell": extra_brockwell}


# =================================================================== lights
def build_lights(lamps, extra, cars, van):
    d = Vector((0.45, 0.55, -1.0)).normalized()
    col, power = CFG["moon"]
    sun = add_light("moon", "SUN", (0, 0, 30), col, power)
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("night")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    sky, strength = CFG["sky"]
    bg.inputs[0].default_value = (*kit.hex_lin(sky), 1)
    bg.inputs[1].default_value = strength
    bpy.context.scene.world = world
    for k, p in enumerate(lamps):
        add_light(f"lamp{k}", "POINT", p, LAMP, CFG["lamp_power"], radius=0.12)
        LIGHT_LOG.append(("street", tuple(p + Vector((0, 0, 0.3)))))
    for r in ROOMS:
        light = CFG["rooms"].get(r["id"], (None, None))[1]
        if not light:
            continue
        c = P((r["x0"] + r["x1"] + 1) / 2, (r["y0"] + r["y1"] + 1) / 2, CEIL - 0.2)
        add_light(f"room_{r['id']}", "POINT", c, light[0], light[1], radius=0.1)
        LIGHT_LOG.append(("ceiling", tuple(c)))
    for kind, p, *rest in extra:
        if kind == "pool":
            add_light("pool", "AREA", p, "#40c0f0", 220, size=(9.0, 20.0), rot=(math.pi, 0, 0))
        elif kind == "strip":
            add_light("strip", "AREA", p, "#e8f0ff", 70, size=(2.0, 0.3), rot=(0, 0, rest[0] if rest else 0))
        elif kind == "tv":
            add_light("tv", "AREA", p, "#6c9cff", 95, size=(1.6, 0.86), rot=(0, math.radians(90), 0))
        elif kind == "fridge":
            add_light("fridge", "POINT", p, "#d8ecff", 25, radius=0.2)
        elif kind == "laptop":
            add_light("laptop", "POINT", p, "#9ab8ff", 6, radius=0.1)
        elif kind == "led":
            add_light("led", "POINT", p, "#ff2d9b", 35, radius=0.3)
        elif kind == "grow":
            add_light("grow", "AREA", p, "#ffb8ee", 160, size=(1.4, 2.4), rot=(0, 0, 0))
        elif kind == "wash":
            add_light("wash", "AREA", p, "#e8f0ff", 260, size=(5.0, 0.3), rot=(0, 0, 0))
        LIGHT_LOG.append((kind, tuple(p)))
    for k, (front, heading) in enumerate(cars + [van]):
        side = Vector((-math.sin(heading), math.cos(heading), 0))
        fwd = Vector((math.cos(heading), math.sin(heading), 0))
        for s in (-0.6, 0.6):
            add_light(f"head{k}{s}", "SPOT", front + side * s + fwd * 0.05, "#fff0d8", 600, radius=0.05,
                      rot=(0, -math.pi / 2, heading), spot=math.radians(55))
        LIGHT_LOG.append(("van" if k == len(cars) else "car", tuple(front)))


# =================================================================== main
def main():
    t0 = time.time()
    emit = Geo("props_emit")
    furniture.init(P, BX, BY, emit, CUT)
    near, inner, far = build_ground()
    print(f"ground {time.time() - t0:.1f}s")
    low, high, caps = build_walls()
    frames, frames_hi, glass, sills = build_openings()
    doors = build_doors()
    ceil = build_ceilings()
    blocks, blocks_hi, blocks_caps, block_windows, block_det = build_map_blocks()
    houses, houses_win, houses_caps = build_far_buildings()
    fences = build_fences()
    trunks, trunks_far, crowns, crowns_far = build_trees()
    shrubs = build_shrubs()
    ext, pint, extra, lamps, cars, van = build_furniture(emit)
    deck = Geo("deck_block")
    for x0, y0, x1, y1, z0, z1 in CFG.get("decks", []):
        x1 = GX1 if x1 is None else x1
        deck.aabb(BX(x0), BY(y1), z0, BX(x1), BY(y0), z1, "concrete")
    if CFG.get("extra"):
        EXTRAS[CFG["extra"]](ext, emit, deck, extra)
    if DRESS:
        print(f"dressed with {dress.scatter(L, P, C_STATIC, random.Random(5))} models")
    print(f"geometry built {time.time() - t0:.1f}s")

    def obj(g, coll, **kw):
        return g.to_object(coll, **kw) if len(g.bm.faces) else None

    statics = [obj(g, C_STATIC) for g in (near, inner, far, low, frames, sills, blocks, block_det, houses, fences, trunks, trunks_far,
                                          ext, pint)]
    statics.append(obj(shrubs, C_STATIC, smooth_angle=89))
    statics = [o for o in statics if o] + dress.placed()
    door_objs = []
    for d in doors:
        door_objs.append(obj(d["geo"], C_STATIC))
        obj(d["hi"], C_BLOCK)
    canopies = [o for o in (obj(crowns, C_STATIC, smooth_angle=89), obj(crowns_far, C_STATIC, smooth_angle=89)) if o]
    emitters = [obj(g, C_EXPORT) for g in (emit, block_windows, houses_win)]
    hidden = [obj(g, C_DYN) for g in (caps, blocks_caps, houses_caps, glass)]
    for g in (high, frames_hi, ceil, blocks_hi, deck):
        obj(g, C_BLOCK)
    loot = props.build_loot(L["loot"], P, C_DYN)
    build_lights(lamps, extra, cars, van)

    bake.finish(OUT, W, H, P, statics, door_objs + canopies, emitters, hidden, loot, doors, COLL, CUT,
                bake=BAKE, samples=SAMPLES, lm_size=LM_SIZE,
                preview=os.path.join(HERE, f"preview-{JOB}.png") if PREVIEW else None, ortho=max(W, H) * 0.6, t0=t0,
                meta={"lamp": LAMP, "materials": dress.materials()}, export_hidden=False, probe_per_unit=4)


main()
