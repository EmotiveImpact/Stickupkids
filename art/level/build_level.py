"""Builds the estate job in Blender from art/level/estate.json, bakes its
lighting and exports it for the game.

Run:  python3 art/level/build_level.py [--bake] [--samples 128] [--size 2048] [--preview] [--out DIR]

Outputs (public/models/estate/):
  level.glb                  static scene, door leaves and loot, two UV sets
  level-lightmap.png         baked light (diffuse direct + indirect, no albedo)
  level-probe.png            light at chest height, for lighting characters
  level-materials.json       material table for the game

The game cuts walls at 1.5 units and shows no ceilings. For the bake the walls
carry on to 2.6 with a ceiling over the house, so rooms are lit the way real
rooms are; those extra parts are light blockers only and never exported.
"""
import json
import math
import os
import sys
import time

import bpy  # noqa: I001  (bpy must load before bmesh)
import bmesh
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bake  # noqa: E402
import dress  # noqa: E402
import kit  # noqa: E402
import props  # noqa: E402
from bake import LIGHT_LOG, add_light  # noqa: E402
from kit import Frame, Geo, material  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
args = sys.argv
OUT = args[args.index("--out") + 1] if "--out" in args else os.path.join(ROOT, "public", "models", "estate")
BAKE = "--bake" in args
PREVIEW = "--preview" in args
DRESS = "--dress" in args     # real models (art/level/dress.py) in place of the drawn furniture
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 128
LM_SIZE = int(args[args.index("--size") + 1]) if "--size" in args else 2048

kit.load_means(os.path.join(ROOT, "art", "textures", "out", "means.txt"))
L = json.load(open(os.path.join(HERE, "estate.json")))
W, H = L["w"], L["h"]
T = L["tiles"]
ROOMS = L["rooms"]
# The target house's shell (walls included) and the side passage east of it.
HOUSE = (min(r["x0"] for r in ROOMS) - 1, min(r["y0"] for r in ROOMS) - 1,
         max(r["x1"] for r in ROOMS) + 1, max(r["y1"] for r in ROOMS) + 1)
_px = [x for x in range(HOUSE[2] + 1, L["w"]) if L["tiles"][HOUSE[1] + 3][x] == "p"]
PASSAGE = (min(_px), max(_px))
OPENINGS = [(x, y) for y, row in enumerate(L["tiles"]) for x, c in enumerate(row) if c == "O"]

CUT = 1.5     # wall height in the game
CEIL = 2.6    # ceiling height for the bake
SILL = 0.55
HEAD = 2.05
ZB = [0.0, SILL, CUT, HEAD, CEIL]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
C_STATIC = bpy.data.collections.new("static")      # baked and exported
C_EXPORT = bpy.data.collections.new("export")      # exported, not baked
C_BLOCK = bpy.data.collections.new("block")        # baked light blockers only
C_DYN = bpy.data.collections.new("dynamic")        # exported, hidden in the bake
for c in (C_STATIC, C_EXPORT, C_BLOCK, C_DYN):
    scene.collection.children.link(c)


def BX(x):
    return x - W / 2


def BY(y):
    return H / 2 - y


def P(x, y, z=0.0):
    return Vector((BX(x), BY(y), z))


def tile(x, y):
    if 0 <= x < W and 0 <= y < H:
        return T[y][x]
    return virtual_tile(x, y)


def virtual_tile(x, y):
    """The estate carries on past the edges of the map."""
    if y < -1:
        return "g" if y >= -7 else "X"
    if y == -1:
        return "="
    if y >= H:
        if y < 28:
            return "r"
        if y < 30:
            return "p"
        if y == 30:
            return "="
        return "g"
    if x < 0:
        c = T[y][1]
        return c
    c = T[y][W - 1]
    if 2 <= y <= 6:
        return "g"
    return c


def in_house(x, y):
    return HOUSE[0] <= x <= HOUSE[2] and HOUSE[1] <= y <= HOUSE[3]


def room_of(x, y):
    for r in ROOMS:
        if r["x0"] <= x <= r["x1"] and r["y0"] <= y <= r["y1"]:
            return r
    return None


def is_floor(x, y):
    return in_house(x, y) and tile(x, y) == "."


def room_at_point(px, py):
    """Room id (or 'out') for a point, looking past walls towards the point's side."""
    x, y = math.floor(px), math.floor(py)
    if is_floor(x, y):
        return room_of(x, y)["id"]
    if not in_house(x, y):
        return "out"
    dx = px - (x + 0.5)
    dy = py - (y + 0.5)
    sx = 1 if dx > 0 else -1
    sy = 1 if dy > 0 else -1
    cands = [(x + sx, y), (x, y + sy), (x + sx, y + sy)] if abs(dx) >= abs(dy) else [(x, y + sy), (x + sx, y), (x + sx, y + sy)]
    for cx, cy in cands:
        if is_floor(cx, cy):
            return room_of(cx, cy)["id"]
        if not in_house(cx, cy):
            return "out"
    for cx, cy in cands:
        if tile(cx, cy) in "DO":
            continue
    return "out"


FLOOR_MAT = {"stash": "carpet_navy", "living": "carpet_grey", "hall": "boards_old", "kitchen": "lino_check", "dining": "boards_worn"}
PLASTER = {"stash": "plaster_stash", "living": "plaster_living", "hall": "plaster_hall", "kitchen": "plaster_kitchen", "dining": "plaster_dining"}


# =================================================================== ground
def ground_mat(px, py):
    x, y = math.floor(px), math.floor(py)
    if in_house(x, y):
        r = room_at_point(px, py)
        return FLOOR_MAT.get(r, "boards")
    t = tile(x, y)
    if t == "r":
        return "tarmac"
    if y <= 0 and y >= -1:
        return "tarmac_alley" if y == 0 else "concrete"
    if t == "p":
        if PASSAGE[0] <= x <= PASSAGE[1] and 7 <= y <= 21:
            return "concrete"
        if 12 <= x <= 13 and 20 <= y <= 21:
            return "patio"
        if y == 1:
            return "concrete"
        return "paving"
    if t == "=":
        return "concrete"
    if t == "X":
        return "concrete"
    if t == "g":
        if 2 <= y <= 6:
            # Back gardens: patio by the house, a path to the back door.
            if y == 6 and 15 <= x <= HOUSE[2]:
                return "patio"
            if x == 19 and 0 <= px:
                return "patio"
            if (x // 5) % 3 == 2 and y >= 5:
                return "patio"
            return "grass"
        if y == 20:
            if HOUSE[0] <= x <= HOUSE[2]:
                return "gravel"
            return "grass" if (x // 5) % 2 else "gravel"
        if y < -1:
            return "grass"
        return "grass"
    return "concrete"


GX0, GX1, GY0, GY1 = -24, 54, -16, 36


def build_ground():
    near = Geo("ground_near")
    inner = Geo("ground_int")
    far = Geo("ground_far")
    road = Geo("road")
    step = 0.5
    for gy in range(int((GY1 - GY0) / step)):
        for gx in range(int((GX1 - GX0) / step)):
            px = GX0 + gx * step
            py = GY0 + gy * step
            cx, cy = px + step / 2, py + step / 2
            x, y = math.floor(cx), math.floor(cy)
            if tile(x, y) == "X" and not (0 <= x < W and 0 <= y < H):
                continue
            mat = ground_mat(cx, cy)
            z = -0.1 if mat == "tarmac" else 0.0
            if in_house(x, y):
                g = inner
            elif -3 <= x < W + 3 and -3 <= y < H + 4:
                g = near
            else:
                g = far
            if mat == "tarmac":
                g = road if -3 <= x < W + 3 else far
            g.quad(P(px, py + step, z), (step, 0, 0), (0, step, 0), mat, n=(0, 0, 1))
    # Kerbs either side of the road (road between y 24 and 28).
    near.aabb(BX(GX0), BY(24.0), -0.1, BX(GX1), BY(23.84), 0.015, "kerb", bevel=0.02)
    near.aabb(BX(GX0), BY(28.16), -0.1, BX(GX1), BY(28.0), 0.015, "kerb", bevel=0.02)
    return near, inner, far, road


# =================================================================== walls
R = 20
HX0, HY0, HX1, HY1 = HOUSE[0], HOUSE[1], HOUSE[2] + 1, HOUSE[3] + 1
NXP, NYP = (HX1 - HX0) * R, (HY1 - HY0) * R


def wall_like(x, y):
    return in_house(x, y) and tile(x, y) in "#WDO"


def is_shell(x, y):
    return x in (HOUSE[0], HOUSE[2]) or y in (HOUSE[1], HOUSE[3])


def solid_band(ch, b):
    if ch == "#":
        return True
    if ch == "W":
        return b in (0, 3)
    return b == 3  # D, O


def build_walls():
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
            ci = (x - HX0) * R + half
            cj = (y - HY0) * R + half
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

    def px_of(i):
        return HX0 + i / R

    def py_of(j):
        return HY0 + j / R

    def wmat(i, j):
        """Material for a wall face whose open side is pixel (i, j)."""
        px, py = HX0 + (i + 0.5) / R, HY0 + (j + 0.5) / R
        if i < 0 or j < 0 or i >= NXP or j >= NYP:
            return "brick"
        x, y = math.floor(px), math.floor(py)
        c = tile(x, y)
        if c in "DWO":
            # Inside the wall line of an opening: a jamb or reveal.
            t = 6 if is_shell(x, y) else 4
            if abs((px - (x + 0.5)) * R) < t / 2 + 0.01 or abs((py - (y + 0.5)) * R) < t / 2 + 0.01:
                horiz = wall_like(x - 1, y) or wall_like(x + 1, y)
                off = abs((py - (y + 0.5)) * R) if horiz else abs((px - (x + 0.5)) * R)
                if off < t / 2 + 0.01:
                    return "frame_white"
        r = room_at_point(px, py)
        return "brick" if r == "out" else PLASTER[r]

    low = Geo("walls")
    high = Geo("walls_block")
    caps = Geo("caps")
    groups = ((low, (0, 1)), (high, (2, 3)))

    def greedy(lab):
        """Greedy rectangles over a 2D label array (-1 = empty). Yields (r0, c0, r1, c1, label)."""
        lab = lab.copy()
        nr, nc = lab.shape
        for r in range(nr):
            c = 0
            while c < nc:
                L_ = lab[r, c]
                if L_ < 0:
                    c += 1
                    continue
                c1 = c
                while c1 + 1 < nc and lab[r, c1 + 1] == L_:
                    c1 += 1
                r1 = r
                while r1 + 1 < nr and np.all(lab[r1 + 1, c:c1 + 1] == L_):
                    r1 += 1
                lab[r:r1 + 1, c:c1 + 1] = -1
                yield r, c, r1, c1, L_
                c = c1 + 1

    mat_ids = {}

    def mid(m):
        if m not in mat_ids:
            mat_ids[m] = len(mat_ids)
        return mat_ids[m]

    inv = lambda: {v: k for k, v in mat_ids.items()}  # noqa: E731

    # Faces with normals along map x.
    for i in range(NXP + 1):
        left = solid[:, :, i - 1] if i > 0 else np.zeros((4, NYP), bool)
        right = solid[:, :, i] if i < NXP else np.zeros((4, NYP), bool)
        for sign in (1, -1):
            exist = (left & ~right) if sign > 0 else (right & ~left)
            if not exist.any():
                continue
            for geo, bands in groups:
                lab = np.full((len(bands), NYP), -1, dtype=int)
                for bi, b in enumerate(bands):
                    js = np.nonzero(exist[b])[0]
                    for j in js:
                        lab[bi, j] = mid(wmat(i if sign > 0 else i - 1, j))
                names = inv()
                for r0, c0, r1, c1, lb in greedy(lab):
                    z0, z1 = ZB[bands[r0]], ZB[bands[r1] + 1]
                    x = px_of(i)
                    geo.quad(P(x, py_of(c1 + 1), z0), (0, (c1 + 1 - c0) / R, 0), (0, 0, z1 - z0), names[lb],
                             n=(sign, 0, 0))
    # Faces with normals along map y (south is +y, Blender -Y).
    for j in range(NYP + 1):
        north = solid[:, j - 1, :] if j > 0 else np.zeros((4, NXP), bool)
        south = solid[:, j, :] if j < NYP else np.zeros((4, NXP), bool)
        for sign in (1, -1):  # +1: faces south
            exist = (north & ~south) if sign > 0 else (south & ~north)
            if not exist.any():
                continue
            for geo, bands in groups:
                lab = np.full((len(bands), NXP), -1, dtype=int)
                for bi, b in enumerate(bands):
                    is_ = np.nonzero(exist[b])[0]
                    for i in is_:
                        lab[bi, i] = mid(wmat(i, j if sign > 0 else j - 1))
                names = inv()
                for r0, c0, r1, c1, lb in greedy(lab):
                    z0, z1 = ZB[bands[r0]], ZB[bands[r1] + 1]
                    y = py_of(j)
                    geo.quad(P(px_of(c0), y, z0), ((c1 + 1 - c0) / R, 0, 0), (0, 0, z1 - z0), names[lb],
                             n=(0, -sign, 0))
    # Horizontal faces between bands: sill tops and lintel undersides.
    for k in (1, 2, 3):
        below, above = solid[k - 1], solid[k]
        for up, exist in ((True, below & ~above), (False, above & ~below)):
            if not exist.any():
                continue
            geo = low if ZB[k] <= CUT else high
            m = "sill" if up else "frame_white"
            lab = np.where(exist, mid(m), -1)
            names = inv()
            for r0, c0, r1, c1, lb in greedy(lab):
                geo.quad(P(px_of(c0), py_of(r1 + 1), ZB[k]), ((c1 + 1 - c0) / R, 0, 0), (0, (r1 + 1 - r0) / R, 0),
                         names[lb], n=(0, 0, 1 if up else -1))
    # Caps where walls are cut, for the game only.
    lab = np.where(solid[1], mid("cap"), -1)
    names = inv()
    for r0, c0, r1, c1, lb in greedy(lab):
        caps.quad(P(px_of(c0), py_of(r1 + 1), CUT), ((c1 + 1 - c0) / R, 0, 0), (0, (r1 + 1 - r0) / R, 0), "cap", n=(0, 0, 1))
    # Wall tops at the ceiling (blocker).
    lab = np.where(solid[3], mid("ceiling"), -1)
    names = inv()
    for r0, c0, r1, c1, lb in greedy(lab):
        high.quad(P(px_of(c0), py_of(r1 + 1), CEIL), ((c1 + 1 - c0) / R, 0, 0), (0, (r1 + 1 - r0) / R, 0), "ceiling", n=(0, 0, 1))

    # Skirting boards along the bottom of painted walls.
    skirt = Geo("skirting")
    for f in list(low.bm.faces):
        name = low.mats[f.material_index]
        if not name.startswith("plaster_"):
            continue
        n = f.normal
        if abs(n.z) > 0.5:
            continue
        zs = [v.co.z for v in f.verts]
        if min(zs) > 0.01:
            continue
        xs = [v.co.x for v in f.verts]
        ys = [v.co.y for v in f.verts]
        d = 0.015
        if abs(n.x) > 0.5:
            x = xs[0] + n.x * d / 2
            skirt.aabb(x - d / 2, min(ys), 0, x + d / 2, max(ys), 0.09, "frame_white", bevel=0.004)
        else:
            y = ys[0] + n.y * d / 2
            skirt.aabb(min(xs), y - d / 2, 0, max(xs), y + d / 2, 0.09, "frame_white", bevel=0.004)
    return low, high, caps, skirt, ch


# =================================================================== openings
def build_openings(ch):
    frames = Geo("frames")
    frames_hi = Geo("frames_block")
    glass = Geo("glass")
    sills = Geo("sills")
    doors = []
    fw, fd = 0.06, 0.07  # frame width and depth

    # Windows: group adjacent W tiles into runs.
    seen = set()
    for y in range(HY0, HY1):
        for x in range(HX0, HX1):
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
                a0, a1 = run[0][0], run[-1][0] + 1
                c = y + 0.5
                outward = 1 if y == 19 else -1  # map y direction of the outside
                def box(u0, u1, z0, z1, d, m, off=0.0, geo=frames):
                    geo.aabb(BX(u0), BY(c + off) - d / 2, z0, BX(u1), BY(c + off) + d / 2, z1, m, bevel=0.006)
            else:
                a0, a1 = run[0][1], run[-1][1] + 1
                c = x + 0.5
                outward = 1 if x == HOUSE[2] else -1
                def box(u0, u1, z0, z1, d, m, off=0.0, geo=frames):
                    geo.aabb(BX(c + off) - d / 2, BY(u1), z0, BX(c + off) + d / 2, BY(u0), z1, m, bevel=0.006)
            # Frame: sill rail, jambs, mullions, transom, head (head above the cut).
            box(a0, a1, SILL, SILL + fw, fd, "frame_white")
            box(a0, a0 + fw, SILL, CUT, fd, "frame_white")
            box(a1 - fw, a1, SILL, CUT, fd, "frame_white")
            box(a0, a0 + fw, CUT, HEAD, fd, "frame_white", geo=frames_hi)
            box(a1 - fw, a1, CUT, HEAD, fd, "frame_white", geo=frames_hi)
            box(a0, a1, HEAD - fw, HEAD, fd, "frame_white", geo=frames_hi)
            box(a0, a1, 1.42, 1.42 + fw * 0.8, fd, "frame_white")
            n = a1 - a0
            for k in range(1, n):
                box(a0 + k - fw / 2, a0 + k + fw / 2, SILL, CUT, fd, "frame_white")
                box(a0 + k - fw / 2, a0 + k + fw / 2, CUT, HEAD, fd, "frame_white", geo=frames_hi)
            box(a0 + fw, a1 - fw, SILL + fw, CUT, 0.012, "glass", geo=glass)
            # Outside sill.
            box(a0 - 0.08, a1 + 0.08, SILL - 0.06, SILL, 0.16, "sill", off=outward * (t / 2 + 0.05), geo=sills)
            # Inside window board.
            box(a0 - 0.05, a1 + 0.05, SILL - 0.03, SILL, 0.12, "frame_white", off=-outward * (t / 2 + 0.03), geo=sills)

    # Door architraves and leaves.
    for d in L["doors"] + [{"x": x, "y": y, "axis": "h", "locked": False, "name": "Open doorway", "open": True} for x, y in OPENINGS]:
        x, y = d["x"], d["y"]
        t = 0.3 if is_shell(x, y) else 0.2
        aw, ad = 0.07, 0.018
        for side in (-1, 1):
            off = side * (t / 2 + ad / 2)
            if d["axis"] == "h":
                c = y + 0.5
                for u0, u1 in ((x - aw, x), (x + 1, x + 1 + aw)):
                    frames.aabb(BX(u0), BY(c + off) - ad / 2, 0, BX(u1), BY(c + off) + ad / 2, CUT, "frame_white", bevel=0.005)
                    frames_hi.aabb(BX(u0), BY(c + off) - ad / 2, CUT, BX(u1), BY(c + off) + ad / 2, HEAD + aw, "frame_white")
                frames_hi.aabb(BX(x - aw), BY(c + off) - ad / 2, HEAD, BX(x + 1 + aw), BY(c + off) + ad / 2, HEAD + aw, "frame_white")
            else:
                c = x + 0.5
                for u0, u1 in ((y - aw, y), (y + 1, y + 1 + aw)):
                    frames.aabb(BX(c + off) - ad / 2, BY(u1), 0, BX(c + off) + ad / 2, BY(u0), CUT, "frame_white", bevel=0.005)
                    frames_hi.aabb(BX(c + off) - ad / 2, BY(u1), CUT, BX(c + off) + ad / 2, BY(u0), HEAD + aw, "frame_white")
                frames_hi.aabb(BX(c + off) - ad / 2, BY(y + 1 + aw), HEAD, BX(c + off) + ad / 2, BY(y - aw), HEAD + aw, "frame_white")
        if d.get("open"):
            continue
        doors.append(build_door_leaf(d))
    return frames, frames_hi, glass, sills, doors


def build_door_leaf(d):
    """A door leaf in world space, hinged at the west (h) or north (v) jamb."""
    x, y = d["x"], d["y"]
    front = d["name"] == "Front door"
    mat = "door_front" if front else "door_int"
    g = Geo(f"door_{x}_{y}")
    hi = Geo(f"door_{x}_{y}_block")
    w, th = 0.94, 0.045
    if d["axis"] == "h":
        hinge = P(x + 0.03, y + 0.5)
        along = Vector((1, 0, 0))
        side = Vector((0, 1, 0))
    else:
        hinge = P(x + 0.5, y + 0.03)
        along = Vector((0, -1, 0))
        side = Vector((1, 0, 0))
    rot = math.atan2(along.y, along.x)
    mid = hinge + along * (w / 2)
    g.box(mid + Vector((0, 0, CUT / 2)), (w, th, CUT), mat, bevel=0.008, rot=rot)
    hi.box(mid + Vector((0, 0, (CUT + 2.0) / 2)), (w, th, 2.0 - CUT), mat, rot=rot)
    # Raised panel mouldings on both faces.
    for s in (-1, 1):
        for u0, u1, z0, z1 in ((0.12, 0.44, 0.15, 0.7), (0.5, 0.82, 0.15, 0.7), (0.12, 0.44, 0.82, 1.5), (0.5, 0.82, 0.82, 1.5)):
            if front and z0 > 0.8:
                continue
            uc = (u0 + u1) / 2
            zc = (z0 + min(z1, CUT)) / 2
            p = hinge + along * uc + side * s * (th / 2 + 0.006) + Vector((0, 0, zc))
            g.box(p, (u1 - u0, 0.012, min(z1, CUT) - z0), mat, bevel=0.004, rot=rot)
        # Lever handle.
        p = hinge + along * (w - 0.1) + side * s * (th / 2 + 0.03) + Vector((0, 0, 1.0))
        g.box(p, (0.03, 0.05, 0.05), "chrome", bevel=0.01, rot=rot)
        g.box(p + along * -0.05 + side * s * 0.02, (0.13, 0.025, 0.025), "chrome", bevel=0.008, rot=rot)
    if front:
        # Glazed top, letterbox, number.
        for s in (-1, 1):
            p = hinge + along * (w / 2) + side * s * (th / 2 + 0.004) + Vector((0, 0, 1.15))
            g.box(p, (0.6, 0.01, 0.5), "glass", rot=rot)
            g.box(hinge + along * (w / 2) + side * s * (th / 2 + 0.008) + Vector((0, 0, 0.9)), (0.3, 0.016, 0.06), "chrome", bevel=0.005, rot=rot)
    return {"def": d, "geo": g, "hi": hi, "hinge": hinge}


# =================================================================== neighbours
EAVES, RIDGE = 5.0, 7.2
import random  # noqa: E402

rnd = random.Random(7)


def terrace(geo_body, geo_roof, geo_detail, x0, x1, ys, yn, plot=5.0, seed=1, front_south=True, lit=None):
    """A terrace of houses between x0 and x1, south face at ys, north face at yn (map y)."""
    r = random.Random(seed)
    xs = []
    x = x0
    while x < x1 - 0.5:
        xs.append((x, min(x + plot, x1)))
        x += plot
    face_y = ys if front_south else yn  # the facade the camera sees (south)
    ymid = (ys + yn) / 2
    for k, (a, b) in enumerate(xs):
        brick = r.choice(["brick_n1", "brick_n2", "brick_n3", "brick_n1", "render_n"])
        geo_body.aabb(BX(a), BY(ys), 0, BX(b), BY(yn), EAVES, brick)
        # Slate roof with a small overhang at the eaves.
        ov = 0.3
        p = [P(a, ys + ov, EAVES - 0.1), P(b, ys + ov, EAVES - 0.1), P(b, ymid, RIDGE), P(a, ymid, RIDGE)]
        geo_roof.poly(p, "slate")
        q = [P(b, yn - ov, EAVES - 0.1), P(a, yn - ov, EAVES - 0.1), P(a, ymid, RIDGE), P(b, ymid, RIDGE)]
        geo_roof.poly(q, "slate")
        # Ridge tiles and a gutter.
        geo_detail.aabb(BX(a), BY(ymid + 0.12), RIDGE - 0.06, BX(b), BY(ymid - 0.12), RIDGE + 0.08, "slate", bevel=0.04)
        geo_detail.cyl(P(a, ys + ov + 0.05, EAVES - 0.2), 0.07, b - a, "plastic_black", segs=8, axis="X", cap=True)
        # Chimney stack on the party wall.
        if k > 0 or a > x0:
            geo_detail.aabb(BX(a) - 0.45, BY(ymid + 0.5), RIDGE - 1.0, BX(a) + 0.45, BY(ymid - 0.5), RIDGE + 1.0, brick, bevel=0.03)
            geo_detail.aabb(BX(a) - 0.52, BY(ymid + 0.57), RIDGE + 1.0, BX(a) + 0.52, BY(ymid - 0.57), RIDGE + 1.12, "sill", bevel=0.02)
            for dx in (-0.22, 0.22):
                geo_detail.cyl(P(a + dx, ymid, RIDGE + 1.12), 0.11, 0.35, "plant_pot", segs=10, r2=0.09)
        # Front facade (south): door, bay window, first floor windows.
        door_left = r.random() < 0.5
        dx0 = a + (0.6 if door_left else (b - a) - 1.6)
        fy = BY(face_y)
        geo_detail.aabb(BX(dx0) - 0.08, fy - 0.06, 0, BX(dx0 + 1.0) + 0.08, fy + 0.0, 2.25, "frame_white", bevel=0.01)
        geo_detail.aabb(BX(dx0), fy - 0.07, 0.05, BX(dx0 + 1.0), fy - 0.01, 2.1, r.choice(["door_front", "door_int", "metal_dark", "car_paint"]), bevel=0.01)
        geo_detail.aabb(BX(dx0) - 0.2, fy - 0.4, 0, BX(dx0 + 1.0) + 0.2, fy, 0.12, "sill", bevel=0.02)
        wx0 = a + (2.0 if door_left else 0.6)
        lit_g = lit if lit is not None else geo_detail
        for z0, z1, wa, wb in ((0.8, 2.3, wx0, wx0 + 2.2), (3.0, 4.4, a + 0.6, a + 2.0), (3.0, 4.4, b - 2.0, b - 0.6)):
            state = r.random()
            m = "glass" if state < 0.45 else ("emit_window_warm" if state < 0.78 else ("emit_window_tv" if state < 0.9 else "emit_window_cool"))
            geo_detail.aabb(BX(wa) - 0.07, fy - 0.05, z0 - 0.07, BX(wb) + 0.07, fy + 0.0, z1 + 0.07, "frame_white", bevel=0.01)
            (lit_g if m.startswith("emit") else geo_detail).aabb(BX(wa), fy - 0.06, z0, BX(wb), fy - 0.03, z1, m)
            geo_detail.aabb(BX((wa + wb) / 2) - 0.03, fy - 0.075, z0, BX((wa + wb) / 2) + 0.03, fy - 0.03, z1, "frame_white")
            geo_detail.aabb(BX(wa) - 0.12, fy - 0.16, z0 - 0.14, BX(wb) + 0.12, fy, z0 - 0.06, "sill", bevel=0.01)
        # Downpipe and the odd satellite dish or alarm box.
        geo_detail.cyl(P(b - 0.12, face_y + 0.08, 0), 0.045, EAVES - 0.2, "plastic_black", segs=8)
        if r.random() < 0.35:
            geo_detail.cyl(P(a + 1.2, face_y + 0.25, 4.6), 0.28, 0.06, "plastic_grey", segs=14, r2=0.3, axis="Y")
        if r.random() < 0.4:
            geo_detail.aabb(BX(b - 1.0), fy - 0.12, 4.5, BX(b - 0.7), fy, 4.85, "bin_blue", bevel=0.02)
        # Back windows glow onto the gardens behind.
        by = BY(yn)
        for wa, wb in ((a + 0.8, a + 2.0), (b - 2.0, b - 0.8)):
            if r.random() < 0.55:
                m = r.choice(["emit_window_warm", "emit_window_warm", "emit_window_cool"])
                lit_g.aabb(BX(wa), by + 0.0, 1.0, BX(wb), by + 0.05, 2.1, m)
    return xs


def build_neighbours():
    body = Geo("neigh_body")
    roof = Geo("neigh_roof")
    det = Geo("neigh_detail")
    far_body = Geo("far_body")
    far_roof = Geo("far_roof")
    far_det = Geo("far_detail")
    lit = Geo("lit_windows")
    terrace(body, roof, det, -24.0, HOUSE[0] + 0.35, 19.65, 7.35, seed=3, lit=lit)
    terrace(body, roof, det, PASSAGE[1] + 1.0, 54.0, 19.65, 7.35, seed=5, lit=lit)
    # The terrace across the alley shows its back to us.
    terrace(far_body, far_roof, far_det, -24.0, 54.0, -7.0, -17.0, seed=9, lit=lit)
    return body, roof, det, far_body, far_roof, far_det, lit


# =================================================================== boundaries
def fence_run(g, x0, y0, x1, y1, height=1.2, post=1.8):
    """Close-board fence along a straight line in map coords."""
    horiz = abs(y1 - y0) < 1e-6
    length = abs(x1 - x0) if horiz else abs(y1 - y0)
    t = 0.05
    if horiz:
        g.aabb(BX(min(x0, x1)), BY(y0) - t / 2, 0.15, BX(max(x0, x1)), BY(y0) + t / 2, height, "fence")
        g.aabb(BX(min(x0, x1)), BY(y0) - 0.04, 0, BX(max(x0, x1)), BY(y0) + 0.04, 0.15, "concrete")
        g.aabb(BX(min(x0, x1)), BY(y0) - 0.05, height - 0.04, BX(max(x0, x1)), BY(y0) + 0.05, height + 0.02, "fence")
    else:
        g.aabb(BX(x0) - t / 2, BY(max(y0, y1)), 0.15, BX(x0) + t / 2, BY(min(y0, y1)), height, "fence")
        g.aabb(BX(x0) - 0.04, BY(max(y0, y1)), 0, BX(x0) + 0.04, BY(min(y0, y1)), 0.15, "concrete")
        g.aabb(BX(x0) - 0.05, BY(max(y0, y1)), height - 0.04, BX(x0) + 0.05, BY(min(y0, y1)), height + 0.02, "fence")
    n = max(1, int(round(length / post)))
    for k in range(n + 1):
        f = k / n
        px = x0 + (x1 - x0) * f
        py = y0 + (y1 - y0) * f
        g.aabb(BX(px) - 0.05, BY(py) - 0.05, 0, BX(px) + 0.05, BY(py) + 0.05, height + 0.06, "fence", bevel=0.01)


def garden_wall(g, x0, x1, y, h=0.62, railings=True):
    g.aabb(BX(x0), BY(y + 0.62), 0, BX(x1), BY(y + 0.38), h, "brick", bevel=0.01)
    g.aabb(BX(x0) - 0.02, BY(y + 0.66), h, BX(x1) + 0.02, BY(y + 0.34), h + 0.07, "sill", bevel=0.015)
    if railings:
        g.aabb(BX(x0), BY(y + 0.52), h + 0.5, BX(x1), BY(y + 0.48), h + 0.54, "metal_dark")
        n = int((x1 - x0) / 0.14)
        for k in range(n + 1):
            px = x0 + 0.07 + k * ((x1 - x0 - 0.14) / max(1, n))
            g.cyl(P(px, y + 0.5, h + 0.07), 0.011, 0.55, "metal_dark", segs=6, smooth=False, cap=False)
            g.cyl(P(px, y + 0.5, h + 0.62), 0.02, 0.05, "metal_dark", segs=6, r2=0.0, smooth=False)


def build_boundaries():
    g = Geo("boundaries")
    gf = Geo("boundaries_far")
    # Back fence along the alley, with the gate gap at x 14-15.
    fence_run(g, -3, 1.5, 14, 1.5)
    fence_run(g, 16, 1.5, 33, 1.5)
    fence_run(gf, -24, 1.5, -3, 1.5)
    fence_run(gf, 33, 1.5, 54, 1.5)
    # Gate post caps.
    for x in (14, 16):
        g.aabb(BX(x) - 0.08, BY(1.5) - 0.08, 0, BX(x) + 0.08, BY(1.5) + 0.08, 1.35, "fence", bevel=0.02)
    # Garden dividers.
    for x in (0.5, HOUSE[0] - 0.5, HOUSE[2] + 0.5, PASSAGE[1] + 3.5):
        fence_run(g, x, 1.5, x, 7.35)
    for x in range(-25, -3, 5):
        fence_run(gf, x + 0.35, 1.5, x + 0.35, 7.35)
    for x in range(34, 54, 5):
        fence_run(gf, x, 1.5, x, 7.35)
    # The far terrace's back fence on the other side of the alley.
    fence_run(gf, -24, -0.5, 54, -0.5, height=1.5)
    for x in range(-24, 54, 5):
        fence_run(gf, x, -7.0, x, -0.5, height=1.5)
    # Front garden walls with railings: target gap at 12-13, then the side passage.
    garden_wall(g, -3, 12, 21)
    garden_wall(g, 14, PASSAGE[0], 21)
    garden_wall(g, PASSAGE[1] + 1, 33, 21)
    garden_wall(gf, -24, -3, 21)
    garden_wall(gf, 33, 54, 21)
    # Little dividing walls between the front gardens.
    for x in (HOUSE[0] - 0.5, 0.5, -4.5, PASSAGE[1] + 1.5, PASSAGE[1] + 6.5, 34.5):
        gg = g if -3 < x < 33 else gf
        gg.aabb(BX(x) - 0.12, BY(21.4), 0, BX(x) + 0.12, BY(19.7), 0.62, "brick", bevel=0.01)
        gg.aabb(BX(x) - 0.15, BY(21.4), 0.62, BX(x) + 0.15, BY(19.7), 0.68, "sill", bevel=0.01)
    # Gate piers either side of the target's front gate.
    for x in (12, 14):
        g.aabb(BX(x) - 0.17, BY(21.67), 0, BX(x) + 0.17, BY(21.33), 0.95, "brick", bevel=0.01)
        g.aabb(BX(x) - 0.2, BY(21.7), 0.95, BX(x) + 0.2, BY(21.3), 1.03, "sill", bevel=0.02)
    # South side of the road: pavement walls and hedges.
    garden_wall(gf, -24, 54, 30, railings=False)
    for x in range(-24, 54, 4):
        gf.ico(P(x + 2, 31.6, 0.55), 0.9, "leaves", subdiv=2, scale=(2.2, 0.9, 0.7), noise=0.12, seed=x)
    return g, gf


# =================================================================== street
def build_street():
    g = Geo("street")
    gf = Geo("street_far")
    emit = Geo("street_emit")
    lamps = []
    lamps.append(props.street_lamp(P, g, emit, 8.5, 23.5, (0, 1)))
    lamps.append(props.street_lamp(P, g, emit, 23.5, 23.5, (0, 1)))
    lamps.append(props.street_lamp(P, g, emit, 5.5, 0.5, (1, 0)))
    for x in (-8.5, 38.5, 52):
        lamps.append(props.street_lamp(P, gf, emit, x, 23.5, (0, 1)))
    for x in (-16, 16, 46):
        lamps.append(props.street_lamp(P, gf, emit, x, 28.6, (0, -1)))
    lamps.append(props.street_lamp(P, gf, emit, 30.5, 0.5, (1, 0)))
    lamps.append(props.street_lamp(P, gf, emit, -16.5, 0.5, (1, 0)))
    # Road markings: double yellow lines on our side, a dashed centre line.
    for yy in (24.18, 24.32):
        g.aabb(BX(-3), BY(yy + 0.05), -0.098, BX(33), BY(yy - 0.05), -0.094, "paint_yellow")
    for x in range(-24, 54, 4):
        (g if -3 <= x <= 32 else gf).aabb(BX(x), BY(26.07), -0.098, BX(x + 2.2), BY(25.93), -0.094, "paint_road")
    # Drains and a manhole.
    for x in (6.0, 21.0):
        g.aabb(BX(x), BY(24.5), -0.099, BX(x + 0.5), BY(24.15), -0.095, "metal_dark")
    g.cyl(P(15.0, 23.0, 0.0), 0.32, 0.012, "metal_dark", segs=16)
    # Parked cars: Meshy models when dressing, drawn boxes otherwise.
    car = real_car if DRESS else props.car
    van_front = car(P, g, emit, 0.6, 24.15, 4.9, 1.9, "van_paint", facing=1, lights=True, van=True)
    car(P, g, emit, 16.6, 24.15, 4.0, 1.75, "car_paint", facing=-1)
    car(P, gf, emit, -9.0, 24.15, 4.1, 1.75, "car_paint2", facing=1)
    car(P, gf, emit, 36.0, 24.15, 4.2, 1.8, "bin_blue", facing=1)
    car(P, gf, emit, 8.0, 26.1, 4.1, 1.75, "car_paint2", facing=-1)
    car(P, gf, emit, 25.0, 26.1, 4.0, 1.75, "car_paint", facing=-1)
    car(P, gf, emit, -16.0, 26.1, 4.0, 1.75, "metal", facing=-1)
    return g, gf, emit, lamps, van_front


# Which Meshy model stands in for each drawn car, by its paint.
CAR_MODEL = {"car_paint": "mk:fiesta", "car_paint2": "mk:bmw-1series", "bin_blue": "mk:fiesta", "metal": "mk:bmw-1series"}


def real_car(P, g, emit, x0, y0, length, width, mat, facing=1, lights=False, van=False, zb=-0.1):
    """props.car's footprint and lights, with a Meshy car or van in it."""
    asset = "mk:transit-van" if van else CAR_MODEL.get(mat, "mk:fiesta")
    cx, cy = x0 + length / 2, y0 + width / 2
    dress.place(asset, P(cx, cy, zb + 0.1), face=0.0 if facing > 0 else math.pi, coll=C_STATIC)
    real = dress.size(asset).y          # the model's length, now along x
    fx = cx + facing * (real / 2 + 0.005)
    if lights:
        for s in (-1, 1):
            emit.box(P(fx, cy + s * (width / 2 - 0.3), zb + (0.9 if van else 0.72)), (0.03, 0.22, 0.1), "emit_headlight", bevel=0.01)
            emit.box(P(cx - facing * (real / 2 + 0.005), cy + s * (width / 2 - 0.15), zb + (1.1 if van else 0.8)),
                     (0.03, 0.12, 0.18), "emit_tail", bevel=0.01)
    return P(fx, cy, zb + 0.75)


# =================================================================== props
def frame_for(p, geo):
    """Local frame for a level prop: origin at its footprint centre, +v = front."""
    f = p.get("facing", math.pi / 2)
    fx, fy = round(math.cos(f)), round(math.sin(f))     # map direction
    front = (fx, -fy)                                      # Blender XY
    across = (-front[1], front[0])
    cx, cy = p["x"] + p["w"] / 2, p["y"] + p["h"] / 2
    fr = Frame(geo, BX(cx), BY(cy), front, across)
    along_x = abs(fx) > 0
    span = p["h"] if along_x else p["w"]      # length across the front
    depth = p["w"] if along_x else p["h"]
    return fr, span, depth


def prop_tv(g, e, p):
    fr, span, depth = frame_for(p, g)
    back = -depth / 2 - 0.33 + 0.29   # against the wall behind the prop
    fr.box(0, back - 0.08, 0, span * 0.9, 0.42, 0.42, "wood_dark", bevel=0.015)
    for k in (-1, 0, 1):
        fr.box(k * span * 0.3, back + 0.135, 0.06, span * 0.28, 0.01, 0.3, "plastic_black", bevel=0.005)
    fr.box(0, back - 0.15, 0.42, 0.35, 0.22, 0.03, "plastic_black", bevel=0.01)
    fr.box(0, back - 0.15, 0.45, 0.06, 0.06, 0.12, "plastic_black")
    fr.box(0, back - 0.15, 0.57, 1.7, 0.06, 0.92, "plastic_black", bevel=0.012)
    e.append(("tv", fr.p(0, back - 0.115, 1.03)))
    fe = Frame(e_geo, fr.c.x, fr.c.y, (fr.f.x, fr.f.y), (fr.a.x, fr.a.y))
    fe.box(0, back - 0.115, 0.6, 1.62, 0.005, 0.86, "emit_tv")
    # Console, soundbar, a games controller, a plant.
    fr.box(-0.6, back - 0.05, 0.42, 0.32, 0.26, 0.07, "plastic_white", bevel=0.02)
    fr.box(0.0, back + 0.05, 0.42, 0.9, 0.09, 0.07, "plastic_black", bevel=0.02)
    fr.cyl(span * 0.42, back - 0.05, 0, 0.14, 0.32, "plant_pot", segs=12, r2=0.11)
    g.ico(fr.p(span * 0.42, back - 0.05, 0.62), 0.3, "leaves", subdiv=2, noise=0.25, seed=3)


def prop_sofa(g, e, p):
    fr, span, depth = frame_for(p, g)
    L, D = span * 0.92, 0.95
    fr.box(0, 0, 0.06, L, D, 0.26, "fabric_sofa", bevel=0.05, seg=2)
    for s in (-1, 1):
        fr.box(s * (L / 2 - 0.12), 0, 0.06, 0.24, D, 0.56, "fabric_sofa", bevel=0.08, seg=3, smooth=True)
        for t in (-1, 1):
            fr.box(s * (L / 2 - 0.1), t * (D / 2 - 0.1), 0, 0.05, 0.05, 0.06, "plastic_black")
    fr.box(0, -D / 2 + 0.13, 0.32, L - 0.1, 0.26, 0.5, "fabric_sofa", bevel=0.06, seg=2)
    n = 3
    cw = (L - 0.5) / n
    for k in range(n):
        u = -(L - 0.5) / 2 + cw * (k + 0.5)
        fr.box(u, 0.08, 0.32, cw - 0.02, D - 0.32, 0.15, "fabric_sofa", bevel=0.06, seg=3, smooth=True)
        fr.box(u, -D / 2 + 0.33, 0.47, cw - 0.04, 0.2, 0.42, "fabric_sofa", bevel=0.08, seg=3, smooth=True, rot=0)
    # A scatter cushion and a hoodie left on the arm.
    fr.box(-L / 2 + 0.42, -0.05, 0.47, 0.36, 0.14, 0.34, "fabric_pillow", bevel=0.06, seg=3, smooth=True, rot=0.3)
    fr.box(L / 2 - 0.35, 0.1, 0.47, 0.4, 0.35, 0.06, "metal_dark", bevel=0.03, seg=2, smooth=True, rot=-0.4)


def prop_armchair(g, e, p):
    fr, span, depth = frame_for(p, g)
    fr.box(0, 0, 0.05, 0.85, 0.85, 0.3, "fabric_chair", bevel=0.05, seg=2)
    fr.box(0, -0.3, 0.35, 0.8, 0.22, 0.45, "fabric_chair", bevel=0.07, seg=3, smooth=True)
    for s in (-1, 1):
        fr.box(s * 0.36, 0.02, 0.05, 0.16, 0.82, 0.55, "fabric_chair", bevel=0.06, seg=3, smooth=True)
    fr.box(0, 0.08, 0.35, 0.56, 0.6, 0.13, "fabric_chair", bevel=0.05, seg=3, smooth=True)


def prop_coffee_table(g, e, p):
    fr, span, depth = frame_for(p, g)
    fr.box(0, 0, 0.38, 0.95, 0.62, 0.04, "wood_dark", bevel=0.012)
    fr.box(0, 0, 0.1, 0.85, 0.52, 0.025, "wood_dark", bevel=0.008)
    for su in (-1, 1):
        for sv in (-1, 1):
            fr.box(su * 0.42, sv * 0.26, 0, 0.04, 0.04, 0.38, "metal_dark")
    # Clutter on the lower shelf: magazines, a pizza box on the floor beside it.
    fr.box(0.2, 0.05, 0.125, 0.3, 0.22, 0.02, "paper", rot=0.2)
    fr.box(-0.85, 0.35, 0, 0.38, 0.38, 0.05, "cardboard", bevel=0.005, rot=0.4)
    fr.cyl(-0.3, -0.18, 0.42, 0.033, 0.12, "can_red", segs=10)
    fr.cyl(-0.38, -0.08, 0.42, 0.033, 0.12, "can_silver", segs=10)
    fr.cyl(0.35, -0.18, 0.42, 0.07, 0.025, "metal", segs=12)


def prop_stairs(g, e, p):
    # Steps rise northwards (map -y) from the south edge of the footprint.
    x0, x1 = p["x"] + 0.05, p["x"] + p["w"] - 0.05
    y_s, y_n = p["y"] + p["h"] + 0.4, p["y"] - 0.35
    n = 8
    rise = 0.21
    run = (y_s - y_n) / n
    for k in range(n):
        z1 = rise * (k + 1)
        ya = y_s - run * k
        z1c = min(z1, CUT)
        g.aabb(BX(x0), BY(ya), 0, BX(x1), BY(ya - run), z1c, "boards" if z1 <= CUT else "cap")
        if z1 <= CUT:
            g.aabb(BX(x0 + 0.25), BY(ya + 0.02), z1c, BX(x1 - 0.25), BY(ya - run), z1c + 0.015, "carpet_living")
    g.aabb(BX(x0), BY(y_n), CUT, BX(x1), BY(y_n - 0.01), CUT + 0.001, "cap")


def counter_run(g, e, fr, span, depth, hob=False, sink=False):
    back = -depth / 2 - 0.33
    d = 0.76
    v = back + d / 2
    fr.box(0, v, 0, span - 0.02, d - 0.06, 0.1, "plastic_black")
    fr.box(0, v + 0.01, 0.1, span - 0.02, d - 0.04, 0.78, "cupboard", bevel=0.005)
    n = max(2, int(round(span / 0.6)))
    w = (span - 0.02) / n
    for k in range(n):
        u = -span / 2 + 0.01 + w * (k + 0.5)
        fr.box(u, v + d / 2 - 0.02, 0.13, w - 0.012, 0.02, 0.72, "cupboard", bevel=0.006)
        fr.box(u + w * 0.32, v + d / 2, 0.75, 0.12, 0.02, 0.018, "chrome", bevel=0.005)
    fr.box(0, v + 0.01, 0.88, span, d + 0.02, 0.04, "worktop", bevel=0.006)
    fr.box(0, back - 0.02, 0.92, span, 0.02, 0.25, "tiles")  # splashback
    if sink:
        fr.box(-span * 0.18, v + 0.02, 0.905, 0.55, 0.42, 0.02, "chrome", bevel=0.01)
        fr.box(-span * 0.18 - 0.08, v + 0.02, 0.88, 0.4, 0.34, 0.03, "metal_dark")
        fr.cyl(-span * 0.18, back + 0.06, 0.92, 0.015, 0.28, "chrome", segs=8)
        fr.box(-span * 0.18, back + 0.14, 1.18, 0.03, 0.16, 0.03, "chrome")
        fr.cyl(span * 0.3, v - 0.05, 0.92, 0.08, 0.22, "plastic_white", segs=12)       # kettle
        fr.box(span * 0.08, v - 0.08, 0.92, 0.28, 0.16, 0.18, "chrome", bevel=0.02)  # toaster
        for k in range(4):
            fr.cyl(-span * 0.4 + k * 0.08, v + 0.12, 0.92, 0.035, 0.1, "plastic_white", segs=8)  # mugs
    if hob:
        fr.box(-span * 0.1, v + 0.02, 0.92, 0.6, 0.52, 0.01, "plastic_black", bevel=0.005)
        for su in (-1, 1):
            for sv in (-1, 1):
                fr.cyl(-span * 0.1 + su * 0.15, v + 0.02 + sv * 0.13, 0.925, 0.09, 0.006, "metal_dark", segs=16)
        fe = Frame(e_geo, fr.c.x, fr.c.y, (fr.f.x, fr.f.y), (fr.a.x, fr.a.y))
        fe.cyl(-span * 0.1 + 0.15, v + 0.15, 0.932, 0.07, 0.003, "emit_hob", segs=16)
        fr.box(-span * 0.1, v + d / 2 - 0.01, 0.13, 0.6, 0.02, 0.6, "metal_dark", bevel=0.01)  # oven door
        fr.box(-span * 0.1, v + d / 2 + 0.01, 0.12, 0.62, 0.02, 0.04, "chrome")
        fr.box(span * 0.32, v - 0.02, 0.92, 0.5, 0.36, 0.3, "appliance", bevel=0.015)        # microwave
        fr.box(span * 0.28, v + 0.165, 0.95, 0.32, 0.01, 0.22, "plastic_black")


def prop_counter(g, e, p):
    fr, span, depth = frame_for(p, g)
    counter_run(g, e, fr, span, depth, hob=p["x"] > 20, sink=p["x"] < 20)


def prop_fridge(g, e, p):
    fr, span, depth = frame_for(p, g)
    back = -depth / 2 - 0.31
    v = back + 0.36
    fr.box(0, v, 0, 0.7, 0.68, 1.48, "appliance", bevel=0.03, seg=2)
    fr.box(0, v + 0.3, 0.05, 0.6, 0.06, 1.38, "plastic_white")
    fe = Frame(e_geo, fr.c.x, fr.c.y, (fr.f.x, fr.f.y), (fr.a.x, fr.a.y))
    fe.box(0, v + 0.27, 0.08, 0.56, 0.005, 1.32, "emit_fridge")
    for z in (0.35, 0.7, 1.05):
        fr.box(0, v + 0.18, z, 0.58, 0.3, 0.012, "glass")
        fr.box(-0.12, v + 0.2, z + 0.012, 0.12, 0.12, 0.14, "can_red", bevel=0.02)
        fr.box(0.14, v + 0.18, z + 0.012, 0.16, 0.1, 0.1, "plastic_white", bevel=0.02)
    # Door swung open about 110 degrees, hinged on the left front corner.
    hinge = fr.p(-0.35, v + 0.34, 0)
    ang = math.radians(110)
    dvec = (fr.a * math.cos(ang) + fr.f * math.sin(ang))
    mid = hinge + dvec * 0.35
    g.box(mid + Vector((0, 0, 0.74)), (0.7, 0.07, 1.46), "appliance", bevel=0.02, rot=math.atan2(dvec.y, dvec.x))
    e.append(("fridge", fr.p(0, v + 0.45, 0.8)))


def prop_table_furniture(fr, L, D):
    fr.box(0, 0, 0.72, L, D, 0.05, "wood_dark", bevel=0.012)
    for su in (-1, 1):
        for sv in (-1, 1):
            fr.box(su * (L / 2 - 0.08), sv * (D / 2 - 0.08), 0, 0.07, 0.07, 0.72, "wood_dark", bevel=0.01)
    for k in (-1, 0, 1):
        for sv in (-1, 1):
            u = k * L * 0.32
            v = sv * (D / 2 + 0.12)
            r = 0.15 * k * sv
            fr.box(u, v, 0.44, 0.44, 0.42, 0.05, "wood_dark", bevel=0.01, rot=r)
            fr.box(u, v + sv * 0.19, 0.49, 0.42, 0.04, 0.45, "wood_dark", bevel=0.01, rot=r)
            for su in (-1, 1):
                for sw in (-1, 1):
                    fr.box(u + su * 0.18, v + sw * 0.17, 0, 0.035, 0.035, 0.44, "metal_dark")


def prop_table(g, e, p, top=0.72, furniture=True):
    """`furniture` False: only the clutter, on a table top at `top` (a real model is the table)."""
    fr, span, depth = frame_for(p, g)
    L, D = span * 0.88, depth * 0.72
    t = top + 0.05
    if furniture:
        prop_table_furniture(fr, L, D)
    # A trap house dining table: scales, baggies, a laptop, cash counter.
    fr.box(-0.6, 0.1, t, 0.22, 0.16, 0.03, "plastic_black", bevel=0.01)
    fr.box(-0.6, 0.1, t + 0.03, 0.14, 0.14, 0.004, "chrome")
    for k in range(9):
        fr.box(-0.2 + (k % 3) * 0.1, -0.15 + (k // 3) * 0.09, t, 0.07, 0.05, 0.02, "plastic_white", rot=k * 0.7)
    fr.box(0.6, -0.05, t, 0.36, 0.25, 0.015, "metal_dark", bevel=0.005, rot=-0.2)
    fe = Frame(e_geo, fr.c.x, fr.c.y, (fr.f.x, fr.f.y), (fr.a.x, fr.a.y))
    fe.box(0.6 + 0.0, 0.08, t + 0.015, 0.34, 0.01, 0.22, "emit_screen", rot=-0.2)
    e.append(("laptop", fr.p(0.6, -0.1, 1.0)))
    fr.cyl(0.2, 0.28, t, 0.033, 0.12, "can_silver", segs=10)
    fr.cyl(-0.9, -0.25, t, 0.04, 0.2, "glass", segs=10)


def prop_cabinet(g, e, p):
    fr, span, depth = frame_for(p, g)
    back = -depth / 2 - 0.33
    fr.box(0, back + 0.22, 0.05, span * 0.95, 0.44, 0.75, "wood_dark", bevel=0.01)
    for k in (-1, 1):
        fr.box(k * span * 0.24, back + 0.445, 0.1, span * 0.45, 0.01, 0.6, "wood_light", bevel=0.004)
    fr.cyl(-span * 0.3, back + 0.2, 0.8, 0.1, 0.3, "plant_pot", segs=10, r2=0.07)
    g.ico(fr.p(-span * 0.3, back + 0.2, 1.2), 0.22, "leaves", subdiv=2, noise=0.3, seed=11)
    fr.box(span * 0.2, back + 0.2, 0.8, 0.25, 0.04, 0.32, "plastic_black", bevel=0.01, rot=0.1)  # photo frame


def prop_bed(g, e, p):
    # Double bed, headboard against the north wall.
    x0, x1 = p["x"] + 0.08, p["x"] + p["w"] - 0.05
    y0, y1 = p["y"] - 0.3, p["y"] + p["h"] - 0.1
    g.aabb(BX(x0), BY(y1), 0, BX(x1), BY(y0), 0.32, "wood_dark", bevel=0.02)
    g.aabb(BX(x0), BY(y0 + 0.08), 0, BX(x1), BY(y0), 0.95, "fabric_chair", bevel=0.04, seg=2)
    g.aabb(BX(x0 + 0.04), BY(y1 - 0.04), 0.32, BX(x1 - 0.04), BY(y0 + 0.1), 0.5, "fabric_pillow", bevel=0.05, seg=2)
    # Rumpled duvet, two pillows.
    duv = g.aabb(BX(x0 - 0.03), BY(y1 + 0.02), 0.42, BX(x1 + 0.03), BY(y0 + 0.75), 0.58, "fabric_bed", bevel=0.07, seg=3, smooth=True)
    rr = random.Random(4)
    for f in duv:
        for v in f.verts:
            if v.co.z > 0.55:
                v.co.z += rr.uniform(-0.03, 0.04)
    for k in range(2):
        u = x0 + 0.25 + k * ((x1 - x0) - 0.5) / 1 * 0.5 + 0.1
        g.box(P(u + 0.15, y0 + 0.38, 0.56), (0.62, 0.36, 0.13), "fabric_pillow", bevel=0.06, seg=3, smooth=True, rot=0.05 * (k - 0.5))
    # A magenta LED strip along the headboard.
    e_geo.aabb(BX(x0), BY(y0 + 0.02), 0.96, BX(x1), BY(y0 - 0.0), 0.975, "emit_led")
    e.append(("led", P((x0 + x1) / 2, y0 + 0.2, 1.0)))


def prop_shelves(g, e, p):
    fr, span, depth = frame_for(p, g)
    back = -depth / 2 - 0.33
    v = back + 0.18
    fr.box(0, v, 0, span * 0.92, 0.36, 0.04, "wood_dark")
    for s in (-1, 1):
        fr.box(s * span * 0.45, v, 0, 0.04, 0.36, 1.4, "wood_dark")
    for z in (0.4, 0.8, 1.2):
        fr.box(0, v, z, span * 0.9, 0.34, 0.03, "wood_dark")
    rr = random.Random(5)
    for z in (0.04, 0.43, 0.83):
        u = -span * 0.42
        while u < span * 0.4:
            w = rr.uniform(0.18, 0.4)
            h = rr.uniform(0.15, 0.33)
            m = rr.choice(["cardboard", "cardboard", "plastic_black", "paper", "bin_blue"])
            fr.box(u + w / 2, v + rr.uniform(-0.03, 0.03), z, w - 0.02, 0.3, h, m, bevel=0.01)
            u += w + rr.uniform(0.0, 0.12)


def prop_shed(g, e, p):
    x0, x1, y0, y1 = p["x"] + 0.05, p["x"] + p["w"] - 0.05, p["y"] + 0.05, p["y"] + p["h"] - 0.05
    g.aabb(BX(x0), BY(y1), 0, BX(x1), BY(y0), 1.9, "fence", bevel=0.01)
    ym = (y0 + y1) / 2
    ov = 0.15
    g.poly([P(x0 - ov, y1 + ov, 1.85), P(x1 + ov, y1 + ov, 1.85), P(x1 + ov, ym, 2.35), P(x0 - ov, ym, 2.35)], "slate")
    g.poly([P(x1 + ov, y0 - ov, 1.85), P(x0 - ov, y0 - ov, 1.85), P(x0 - ov, ym, 2.35), P(x1 + ov, ym, 2.35)], "slate")
    g.aabb(BX(x0 + 0.4), BY(y1 + 0.03), 0.02, BX(x0 + 1.2), BY(y1), 1.75, "fence", bevel=0.01)
    g.aabb(BX(x0 + 1.6), BY(y1 + 0.03), 0.9, BX(x0 + 2.4), BY(y1), 1.5, "glass")
    g.aabb(BX(x0 + 1.12), BY(y1 + 0.06), 0.85, BX(x0 + 1.18), BY(y1 + 0.03), 0.95, "metal")


def prop_garden_table(g, e, p):
    cx, cy = p["x"] + p["w"] / 2, p["y"] + p["h"] / 2
    g.cyl(P(cx, cy, 0.7), 0.55, 0.03, "metal_dark", segs=20)
    g.cyl(P(cx, cy, 0), 0.04, 0.7, "metal_dark", segs=8)
    g.cyl(P(cx, cy, 0.73), 0.025, 1.4, "metal", segs=8)
    g.cyl(P(cx, cy, 1.5), 0.12, 0.7, "fabric_chair", segs=8, r2=0.03, smooth=False)
    for k, a in enumerate((0.3, 2.4, 4.3)):
        px, py = cx + math.cos(a) * 0.85, cy + math.sin(a) * 0.85
        rot = -a + math.pi / 2
        g.box(P(px, py, 0.43), (0.45, 0.45, 0.04), "plastic_white", bevel=0.02, rot=rot)
        back = Vector((math.cos(a), -math.sin(a), 0)) * 0.22
        g.box(P(px, py, 0.7) + back, (0.45, 0.04, 0.5), "plastic_white", bevel=0.02, rot=-a)
        for s in ((-0.18, -0.18), (0.18, -0.18), (-0.18, 0.18), (0.18, 0.18)):
            g.box(P(px + s[0], py + s[1], 0.21), (0.03, 0.03, 0.42), "plastic_white")


def prop_bins(g, e, p):
    mats = ["bin_black", "bin_green", "bin_blue"]
    for k in range(p["h"]):
        props.wheelie_bin(P, g, p["x"] + 0.5, p["y"] + k + 0.5, mats[(k + p["x"]) % 3], rot=math.pi / 2 if p["x"] > 20 else 0)


def prop_tree(g, e, p):
    cx, cy = p["x"] + p["w"] / 2, p["y"] + p["h"] / 2
    g.cyl(P(cx, cy, 0), 0.16, 2.0, "bark", segs=10, r2=0.1)
    for k, (dx, dy, z, r) in enumerate(((0, 0, 2.6, 1.15), (0.6, 0.3, 2.3, 0.8), (-0.55, 0.2, 2.4, 0.85),
                                        (0.1, -0.6, 2.5, 0.8), (0.0, 0.4, 3.2, 0.75))):
        g.ico(P(cx + dx, cy + dy, z), r, "leaves", subdiv=2, noise=0.18, seed=20 + k)
    for a in (0.4, 2.2, 4.0):
        g.cyl(P(cx, cy, 1.5), 0.05, 1.0, "bark", segs=6, r2=0.02, axis="X", rot=a)


def prop_hedge(g, e, p):
    x0, x1 = p["x"], p["x"] + p["w"]
    cy = p["y"] + p["h"] / 2
    n = int((x1 - x0) / 0.7)
    for k in range(n):
        px = x0 + (k + 0.5) * (x1 - x0) / n
        g.ico(P(px, cy, 0.45), 0.55, "leaves", subdiv=2, scale=(1.1, 0.85, 0.95), noise=0.15, seed=40 + k)


def build_props(lamp_list):
    g = Geo("props_int")
    ge = Geo("props_ext")
    global e_geo
    e_geo = Geo("props_emit")
    extra = []
    fns = {
        "tv": prop_tv, "sofa": prop_sofa, "armchair": prop_armchair, "coffeeTable": prop_coffee_table,
        "stairs": prop_stairs, "counter": prop_counter, "fridge": prop_fridge, "table": prop_table,
        "cabinet": prop_cabinet, "bed": prop_bed, "shelves": prop_shelves, "shed": prop_shed,
        "gardenTable": prop_garden_table, "bins": prop_bins, "tree": prop_tree, "hedge": prop_hedge,
    }
    if DRESS:
        fns.update(DRESSED)
    for p in L["props"]:
        if p["kind"] in ("lamp", "car"):
            continue  # built with the street
        geo = g if in_house(p["x"], p["y"]) else ge
        fns[p["kind"]](geo, extra, p)
    if DRESS:
        dress_clutter()
        print(f"dressed with {dress.scatter(L, P, C_STATIC, random.Random(5), density=0.35, street=0.12)} more models")

    # Dressing that is not in the level data (never solid, kept out of the walkways).
    # Living room: rug, floor lamp.
    g.aabb(BX(7.4), BY(17.6), 0, BX(9.9), BY(15.2), 0.012, "rug", bevel=0.004)
    g.cyl(P(7.3, 15.3, 0), 0.14, 0.03, "metal_dark", segs=12)
    g.cyl(P(7.3, 15.3, 0.03), 0.015, 1.25, "metal", segs=6)
    g.cyl(P(7.3, 15.3, 1.18), 0.17, 0.26, "fabric_pillow", segs=14, r2=0.11)
    extra.append(("floorlamp", P(7.3, 15.3, 1.3)))
    # Hall: radiator, post on the mat, coats.
    g.aabb(BX(11.66), BY(15.9), 0.15, BX(11.72), BY(15.0), 0.7, "plastic_white", bevel=0.01)
    g.aabb(BX(12.2), BY(18.95), 0, BX(13.0), BY(18.45), 0.015, "fabric_chair")
    for k, (x, y) in enumerate(((12.4, 18.6), (12.55, 18.55), (12.5, 18.75))):
        g.box(P(x, y, 0.018), (0.22, 0.11, 0.004), "paper", rot=k * 0.9)
    for k in range(3):
        g.box(P(14.33, 17.2 + k * 0.28, 1.15), (0.08, 0.24, 0.55), "metal_dark" if k != 1 else "fabric_chair",
              bevel=0.04, seg=2, smooth=True)
    # Kitchen: pedal bin, washing basket.
    g.cyl(P(15.35, 9.35, 0), 0.16, 0.5, "chrome", segs=14)
    g.cyl(P(15.4, 12.6, 0), 0.25, 0.3, "plastic_white", segs=14, r2=0.27)
    # Stash room: gaming desk and screen, clothes on the floor.
    g.aabb(BX(9.55), BY(12.95), 0, BX(10.6), BY(11.9), 0.74, "plastic_black", bevel=0.01)
    g.box(P(10.35, 12.4, 0.74) + Vector((0, 0, 0.2)), (0.04, 0.62, 0.36), "plastic_black", bevel=0.01)
    e_geo.box(P(10.32, 12.4, 0.94), (0.005, 0.58, 0.32), "emit_screen")
    extra.append(("monitor", P(10.1, 12.4, 1.0)))
    for k, (x, y) in enumerate(((7.4, 9.4), (8.3, 8.6), (7.6, 12.5))):
        g.box(P(x, y, 0.03), (0.5, 0.35, 0.06), "metal_dark" if k % 2 else "fabric_chair", bevel=0.03, seg=2, smooth=True, rot=k)
    # Back garden: rotary washing line, a trampoline next door, plant pots.
    g2 = ge
    g2.cyl(P(13.0, 4.0, 0), 0.025, 1.7, "metal", segs=6)
    for a in range(4):
        g2.cyl(P(13.0, 4.0, 1.65), 0.012, 1.0, "metal", segs=4, axis="X", rot=a * math.pi / 2 + 0.3)
    for k, (x, y) in enumerate(((17.6, 6.4), (18.2, 6.5), (15.6, 6.4))):
        g2.cyl(P(x, y, 0), 0.18, 0.34, "plant_pot", segs=12, r2=0.14)
        g2.ico(P(x, y, 0.5), 0.22, "leaves", subdiv=1, noise=0.25, seed=60 + k)
    t = Geo("tramp")
    ge.cyl(P(-7.5, 4.2, 0.55), 1.6, 0.06, "metal_dark", segs=28)
    ge.cyl(P(-7.5, 4.2, 0.6), 1.45, 0.012, "plastic_black", segs=28)
    for a in range(6):
        aa = a * math.pi / 3
        ge.cyl(P(-7.5 + math.cos(aa) * 1.55, 4.2 + math.sin(aa) * 1.55, 0), 0.03, 0.56, "metal", segs=6)
    # The alley: a dumped mattress, a shopping trolley-ish cage, bin bags.
    ge.box(P(9.0, 0.45, 0.08), (1.9, 0.2, 0.9), "fabric_pillow", bevel=0.05, seg=2, smooth=True, tilt=("X", -1.25))
    for k, (x, y) in enumerate(((10.5, 0.6), (10.9, 0.4), (24.3, 0.5))):
        ge.ico(P(x, y, 0.22), 0.28, "plastic_black", subdiv=2, scale=(1, 1, 0.9), noise=0.12, seed=70 + k)
    # Front garden: the bin is a level prop; add a bike chained to the railings.
    ge.cyl(P(9.4, 20.7, 0.33), 0.32, 0.03, "tyre", segs=18, axis="Y")
    ge.cyl(P(10.4, 20.7, 0.33), 0.32, 0.03, "tyre", segs=18, axis="Y")
    ge.box(P(9.9, 20.7, 0.62), (0.95, 0.03, 0.04), "car_paint", rot=0, tilt=("Y", 0.3))
    ge.box(P(9.7, 20.7, 0.48), (0.04, 0.03, 0.5), "car_paint", tilt=("Y", -0.3))
    return g, ge, e_geo, extra


# =================================================================== real models
# With --dress, level props become Poly Haven models and the rooms get
# clutter. Positions are map tiles (x east, y south), like the level data.
def ph(asset, x, y, face=math.pi / 2, z=0.0, **kw):
    return dress.place(asset, P(x, y, z), face=face, coll=C_STATIC, **kw)


def centre(p):
    return p["x"] + p["w"] / 2, p["y"] + p["h"] / 2


def real_sofa(g, e, p):
    x, y = centre(p)
    ph("mk:sofa", x, y, face=p.get("facing", 0))
    ph("side_table_01", p["x"] + p["w"] + 0.3, y)


def real_armchair(g, e, p):
    x, y = centre(p)
    ph("modern_arm_chair_01", x, y, face=p.get("facing", 0), spin=0.25)


def real_coffee_table(g, e, p):
    x, y = centre(p)
    ph("modern_coffee_table_01", x, y)
    ph("cigarette_pack", x - 0.1, y - 0.3, z=0.39, spin=0.6)
    fr, _s, _d = frame_for(p, g)
    fr.cyl(0.18, 0.2, 0.39, 0.033, 0.12, "can_red", segs=10)
    fr.cyl(0.1, 0.32, 0.39, 0.033, 0.12, "can_silver", segs=10)
    fr.box(-0.85, 0.35, 0, 0.38, 0.38, 0.05, "cardboard", bevel=0.005, rot=0.4)   # pizza box


def real_table(g, e, p):
    x, y = centre(p)
    ph("dining_table", x, y)
    prop_table(g, e, p, top=0.83, furniture=False)
    # Chairs that never matched: white garden chairs and two old dining chairs.
    n, s = p["y"] - 0.05, p["y"] + p["h"] + 0.05
    ph("plastic_monobloc_chair_01", x - 0.7, n, face=math.pi / 2, spin=0.15)
    ph("dining_chair_02", x + 0.6, n, face=math.pi / 2, spin=-0.1)
    ph("plastic_monobloc_chair_01", x - 0.8, s, face=-math.pi / 2, spin=-0.2)
    ph("dining_chair_02", x + 0.1, s + 0.15, face=-math.pi / 2, spin=0.45)
    ph("plastic_monobloc_chair_01", p["x"] - 0.45, y, face=0, spin=0.1)


def real_shelves(g, e, p):
    x, y = centre(p)
    ph("steel_frame_shelves_01", x + 0.3, p["y"] + 0.22)
    ph("cardboard_box_01", x - 0.55, p["y"] + 0.3, spin=0.2)
    ph("cardboard_box_01", x - 0.5, p["y"] + 0.3, z=0.34, spin=-0.3)


def against_wall(p, inset):
    """Map point `inset` metres out from the wall behind prop `p`, mid-footprint."""
    f = p.get("facing", math.pi / 2)
    fx, fy = round(math.cos(f)), round(math.sin(f))
    x, y = centre(p)
    deep = p["h"] if fx == 0 else p["w"]
    return x - fx * (deep / 2 - inset), y - fy * (deep / 2 - inset), (fx, fy)


def real_counter(g, e, p):
    """A 2.4 m Meshy kitchen run with the washing machine on the end; drawn if it will not fit."""
    span = max(p["w"], p["h"])
    if span < 3.0:
        return prop_counter(g, e, p)
    x, y, (fx, fy) = against_wall(p, 0.33)
    ax, ay = -fy, fx
    f = p.get("facing", math.pi / 2)
    ph("mk:kitchen-run", x + ax * (1.2 - span / 2 + 0.02), y + ay * (1.2 - span / 2 + 0.02), face=f)
    ph("mk:washing-machine", x + ax * (span / 2 - 0.31), y + ay * (span / 2 - 0.31), face=f)


def real_fridge(g, e, p):
    x, y, (fx, fy) = against_wall(p, 0.4)
    ph("mk:fridge-freezer", x, y, face=p.get("facing", math.pi / 2))
    e.append(("fridge", P(x + fx * 0.5, y + fy * 0.5, 0.8)))


def real_bins(g, e, p):
    for k in range(p["h"]):
        ph("mk:wheelie-bin", p["x"] + 0.5, p["y"] + k + 0.5, face=math.pi if p["x"] > 20 else 0.0, spin=0.15 * (k % 2))


DRESSED = {"sofa": real_sofa, "armchair": real_armchair, "coffeeTable": real_coffee_table, "table": real_table,
           "shelves": real_shelves, "counter": real_counter, "fridge": real_fridge, "bins": real_bins}


def dress_clutter():
    """The mess that makes a room look lived in. Kept clear of doors and walkways."""
    # Meshy pieces made for this game: the street, the garden, the stash.
    ph("mk:phone-box", 3.0, 22.7, face=-math.pi / 2)
    ph("mk:bus-shelter", 31.0, 23.0, face=-math.pi / 2)
    ph("mk:eurobin", 26.6, 22.6, face=-math.pi / 2, spin=0.1)
    ph("mk:moped", 19.4, 22.7, face=0.0, spin=0.2)
    ph("mk:traffic-cone", 13.6, 23.75, spin=0.4)
    ph("mk:shopping-trolley", 6.2, 22.8, face=0.0, spin=0.7)
    ph("mk:mattress", 11.6, 2.9, face=0.0, spin=0.12)
    ph("mk:scales-table", 9.8, 10.6, face=math.pi)
    # Front room: the console by the telly, a crate of games, a speaker.
    ph("gaming_console", 10.0, 14.35, face=0, spin=0.3)
    ph("boombox", 10.55, 17.55, face=math.pi, spin=-0.5)
    # Kitchen: bleach and cleaner on the floor, crates of bottles, food on the side.
    ph("bleach_bottle", 18.2, 8.3)
    ph("multi_cleaner_bottle", 18.4, 8.25, spin=1.0)
    ph("plastic_crate_01", 16.4, 12.6, spin=0.1)
    ph("plastic_crate_01", 16.4, 12.6, z=0.26, spin=-0.25)
    ph("long_life_food", 16.0, 8.3, z=0.92)
    ph("wooden_cutting_board", 16.9, 8.4, z=0.92, spin=0.2)
    ph("pot_enamel_01", 19.5, 9.5, z=0.92)
    # Back bedroom (the stash): boxes, a crate, a toolbox, the bat on the floor.
    ph("plastic_crate_02", 7.7, 12.45, spin=-0.3)
    ph("metal_toolbox", 8.9, 12.6, spin=0.4)
    ph("baseball_bat", 8.4, 11.8, tilt=(math.pi / 2, 0.0), spin=1.1)
    ph("cardboard_box_01", 10.55, 9.3, spin=0.5)
    # Garden: compost bags, tyres, a barrel, a chair knocked over.
    ph("compost_bags", 15.6, 2.6, face=math.pi / 2)
    ph("old_tyre", 6.6, 2.6, tilt=(math.pi / 2, 0.0))
    ph("old_tyre", 6.65, 2.6, z=0.16, tilt=(math.pi / 2, 0.0), spin=0.4)
    ph("rusted_wheel_rim_01", 7.3, 2.4, tilt=(math.pi / 2, 0.0), spin=0.3)
    ph("barrel_03", 27.3, 6.3)
    ph("plastic_crate_03", 11.6, 6.45, spin=0.3)
    ph("wooden_stool_01", 10.4, 3.3)
    ph("plastic_monobloc_chair_01", 6.6, 5.4, tilt=(-math.pi / 2, 0.0), spin=2.2)
    # The alley: bins, spray cans, a rat.
    ph("metal_trash_can", 15.5, 0.45, face=math.pi / 2)
    ph("spray_paint_bottles_02", 11.5, 0.7, spin=0.8)
    ph("street_rat", 12.4, 0.55, spin=0.9)


# =================================================================== loot
# =================================================================== lights


def build_lights(lamps, extra, van_front):
    # Moonlight from the south-west, low and cold. Direction matches the game.
    # Strong enough that the dark between lamps stays blue, not black.
    d = Vector((0.45, 0.55, -1.0)).normalized()
    sun = add_light("moon", "SUN", (0, 0, 30), "#6f8fff", 0.5)
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("night")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*kit.hex_lin("#1a2a55"), 1)
    bg.inputs[1].default_value = 0.22
    scene.world = world
    for k, p in enumerate(lamps):
        # Pools of sodium light with dark between them, not an orange wash.
        add_light(f"street{k}", "POINT", p, "#ff9a3e", 380, radius=0.12)
        LIGHT_LOG.append(("street", tuple(p)))
    # Interiors.
    for name, (x, y), col, power in (("hall", (12.9, 14.6), "#ffcf9e", 150), ("dining", (17.5, 16.0), "#ffd4a8", 130)):
        add_light(name, "POINT", P(x, y, 2.4), col, power, radius=0.08)
        LIGHT_LOG.append((name, tuple(P(x, y, 2.4))))
    add_light("kitchen", "AREA", P(17.2, 10.3, 2.55), "#dfe8ff", 65, size=(1.4, 0.2))
    LIGHT_LOG.append(("kitchen", tuple(P(17.2, 10.3, 2.4))))
    add_light("porch", "POINT", P(12.5, 19.95, 2.2), "#ffd9a8", 40, radius=0.05)
    add_light("backdoor", "POINT", P(19.5, 7.0, 2.2), "#d8e4ff", 30, radius=0.05)
    for kind, p in extra:
        if kind == "tv":
            add_light("tv", "AREA", p, "#6c9cff", 95, size=(1.6, 0.86), rot=(0, math.radians(90), 0))
        elif kind == "fridge":
            add_light("fridge", "AREA", p, "#d8ecff", 40, size=(0.5, 1.2), rot=(0, math.radians(-90), 0))
        elif kind == "laptop":
            add_light("laptop", "POINT", p, "#9ab8ff", 6, radius=0.1)
        elif kind == "led":
            add_light("led", "POINT", p, "#ff2d9b", 35, radius=0.3)
        elif kind == "floorlamp":
            add_light("floorlamp", "POINT", p, "#ffc890", 85, radius=0.1)
        elif kind == "monitor":
            add_light("monitor", "POINT", p, "#9ab8ff", 8, radius=0.15)
        LIGHT_LOG.append((kind, tuple(p)))
    # The van's headlights reach along the road.
    for s in (-0.6, 0.6):
        add_light(f"head{s}", "SPOT", van_front + Vector((0.05, s, 0)), "#fff0d8", 600, radius=0.05,
                  rot=(0, math.radians(90), 0), spot=math.radians(55))
    LIGHT_LOG.append(("van", tuple(van_front)))


def build_blockers():
    b = Geo("ceiling_block")
    b.aabb(BX(HOUSE[0] + 0.35), BY(HOUSE[3] + 0.65), CEIL, BX(HOUSE[2] + 0.65), BY(HOUSE[1] + 0.35), CEIL + 0.15, "ceiling")
    # Roof over the target house so no sky gets in.
    b.aabb(BX(HOUSE[0]), BY(HOUSE[3] + 0.9), EAVES, BX(HOUSE[2] + 1.0), BY(HOUSE[1] + 0.1), EAVES + 0.1, "slate")
    return b


# =================================================================== main
def main():
    t0 = time.time()
    near, inner, far, road = build_ground()
    low, high, caps, skirt, ch = build_walls()
    frames, frames_hi, glass, sills, doors = build_openings(ch)
    nbody, nroof, ndet, fbody, froof, fdet, lit = build_neighbours()
    bnd, bndf = build_boundaries()
    st, stf, st_emit, lamps, van_front = build_street()
    pint, pext, pemit, extra = build_props(lamps)
    blk = build_blockers()
    print(f"geometry built {time.time() - t0:.1f}s")

    def obj(g, coll):
        return g.to_object(coll) if len(g.bm.faces) else None

    statics = [obj(g, C_STATIC) for g in (near, inner, far, road, low, skirt, frames, sills, nbody, nroof, ndet, fbody, froof, fdet,
                                          bnd, bndf, st, stf, pint, pext)]
    statics = [o for o in statics if o] + dress.placed()
    door_objs = []
    for d in doors:
        o = obj(d["geo"], C_STATIC)
        door_objs.append(o)
        obj(d["hi"], C_BLOCK)
    emitters = [obj(g, C_EXPORT) for g in (lit, st_emit, pemit)]
    hidden_in_bake = [obj(g, C_DYN) for g in (caps, glass)]
    for g in (high, frames_hi, blk):
        obj(g, C_BLOCK)
    loot = props.build_loot(L["loot"], P, C_DYN)
    build_lights(lamps, extra, van_front)

    bake.finish(OUT, W, H, P, statics, door_objs, emitters, hidden_in_bake, loot, doors,
                (C_STATIC, C_EXPORT, C_BLOCK, C_DYN), CUT, bake=BAKE, samples=SAMPLES, lm_size=LM_SIZE,
                preview=os.path.join(HERE, "preview.png") if PREVIEW else None, ortho=34, t0=t0,
                meta={"materials": dress.materials()} if DRESS else None)

main()
