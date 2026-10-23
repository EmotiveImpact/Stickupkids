"""Builds the estate job in Blender from art/level/estate.json, bakes its
lighting and exports it for the game.

Run:  python3 art/level/build_level.py [--bake] [--samples 128] [--size 2048] [--preview]

Outputs (public/models/):
  estate.glb                 static scene, door leaves and loot, two UV sets
  estate-lightmap.webp       baked light (diffuse direct + indirect, no albedo)
  estate-probe.png           light at chest height, for lighting characters
  estate-materials.json      material table for the game

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
import kit  # noqa: E402
from kit import MATS, Frame, Geo, material  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "models")
os.makedirs(OUT, exist_ok=True)
args = sys.argv
BAKE = "--bake" in args
PREVIEW = "--preview" in args
SAMPLES = int(args[args.index("--samples") + 1]) if "--samples" in args else 128
LM_SIZE = int(args[args.index("--size") + 1]) if "--size" in args else 2048

kit.load_means(os.path.join(ROOT, "art", "textures", "out", "means.txt"))
L = json.load(open(os.path.join(HERE, "estate.json")))
W, H = L["w"], L["h"]
T = L["tiles"]
ROOMS = L["rooms"]

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
    return 4 <= x <= 25 and 7 <= y <= 19


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


FLOOR_MAT = {"stash": "carpet_stash", "living": "carpet_living", "hall": "boards", "kitchen": "tiles", "dining": "boards"}
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
        if 26 <= x <= 28 and 7 <= y <= 21:
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
            if y == 6 and 15 <= x <= 24:
                return "patio"
            if x == 19 and 0 <= px:
                return "patio"
            if (x // 5) % 3 == 2 and y >= 5:
                return "patio"
            return "grass"
        if y == 20:
            if 4 <= x <= 25:
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
HX0, HY0, HX1, HY1 = 4, 7, 26, 20
NXP, NYP = (HX1 - HX0) * R, (HY1 - HY0) * R


def wall_like(x, y):
    return in_house(x, y) and tile(x, y) in "#WDO"


def is_shell(x, y):
    return x in (4, 25) or y in (7, 19)


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
                outward = 1 if x == 25 else -1
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
    for d in L["doors"] + [{"x": 20, "y": 13, "axis": "h", "locked": False, "name": "Open doorway", "open": True}]:
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
    terrace(body, roof, det, -24.0, 4.35, 19.65, 7.35, seed=3, lit=lit)
    terrace(body, roof, det, 29.0, 54.0, 19.65, 7.35, seed=5, lit=lit)
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
    for x in (0.5, 29.5):
        fence_run(g, x, 1.5, x, 7.35)
    for x in range(-25, -3, 5):
        fence_run(gf, x + 0.35, 1.5, x + 0.35, 7.35)
    for x in range(34, 54, 5):
        fence_run(gf, x, 1.5, x, 7.35)
    # The far terrace's back fence on the other side of the alley.
    fence_run(gf, -24, -0.5, 54, -0.5, height=1.5)
    for x in range(-24, 54, 5):
        fence_run(gf, x, -7.0, x, -0.5, height=1.5)
    # Front garden walls with railings: target gap at 12-13, side passage 26-28.
    garden_wall(g, -3, 12, 21)
    garden_wall(g, 14, 26, 21)
    garden_wall(g, 29, 33, 21)
    garden_wall(gf, -24, -3, 21)
    garden_wall(gf, 33, 54, 21)
    # Little dividing walls between the front gardens.
    for x in (3.5, -1.5, -6.5, 29.5, 34.5):
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
def street_lamp(g, emit, x, y, arm=(0, 1)):
    """Council lamp column with an arm reaching over the road (arm in map dx, dy)."""
    base = P(x, y)
    g.cyl(base, 0.11, 0.6, "metal_dark", segs=12)
    g.cyl(base + Vector((0, 0, 0.6)), 0.075, 3.7, "metal_dark", segs=12, r2=0.055)
    hx, hy = x + arm[0] * 0.6, y + arm[1] * 0.6
    a = P(x, y, 4.25)
    b = P(hx, hy, 4.25)
    mid = (a + b) / 2
    length = (b - a).length
    g.box(mid, (length if arm[0] else 0.06, 0.06 if arm[0] else length, 0.06), "metal_dark", bevel=0.01)
    head = P(hx, hy, 4.18)
    g.box(head, (0.55 if arm[0] else 0.3, 0.3 if arm[0] else 0.55, 0.12), "metal_dark", bevel=0.03)
    emit.box(head - Vector((0, 0, 0.065)), (0.45 if arm[0] else 0.22, 0.22 if arm[0] else 0.45, 0.012), "emit_lamp")
    return P(hx, hy, 4.05)


def wheelie_bin(g, x, y, mat, rot=0.0, lid_open=False):
    c = P(x, y)
    g.box(c + Vector((0, 0, 0.5)), (0.58, 0.7, 0.92), mat, bevel=0.04, seg=2, rot=rot)
    g.box(c + Vector((0, 0, 0.98)), (0.62, 0.76, 0.06), mat, bevel=0.02, rot=rot, tilt=("X", -0.5) if lid_open else None)
    fx, fy = math.cos(rot), math.sin(rot)
    for s in (-1, 1):
        w = c + Vector((fx * 0.2 * s - fy * 0.3, fy * 0.2 * s + fx * 0.3, 0.1))
        g.cyl(w - Vector((fx * 0.04, fy * 0.04, 0)), 0.1, 0.08, "tyre", segs=12, axis="X", rot=rot)


def car(g, emit, x0, y0, length, width, mat, facing=1, lights=False, van=False):
    """A parked car or van along x. facing +1 means the bonnet points east."""
    cx = x0 + length / 2
    cy = y0 + width / 2
    c = P(cx, cy, 0)
    zb = -0.1
    if van:
        g.box(c + Vector((-0.25 * facing, 0, zb + 1.18)), (length - 0.6, width, 1.7), mat, bevel=0.12, seg=3)
        g.box(c + Vector((facing * (length / 2 - 0.45), 0, zb + 0.82)), (0.9, width - 0.04, 0.95), mat, bevel=0.18, seg=3)
        # Windscreen and side windows of the cab.
        g.box(c + Vector((facing * (length / 2 - 0.82), 0, zb + 1.55)), (0.5, width - 0.12, 0.55), "car_glass", bevel=0.05,
              tilt=("Y", -0.5 * facing))
        for s in (-1, 1):
            g.box(c + Vector((facing * (length / 2 - 1.15), s * (width / 2 + 0.005), zb + 1.5)), (0.6, 0.02, 0.45), "car_glass")
            g.box(c + Vector((-facing * 0.6, s * (width / 2 + 0.005), zb + 1.1)), (1.6, 0.012, 0.02), "metal_dark")
        g.box(c + Vector((0, 0, zb + 2.05)), (length - 1.4, width - 0.2, 0.06), "metal_dark", bevel=0.02)
    else:
        g.box(c + Vector((0, 0, zb + 0.55)), (length, width, 0.62), mat, bevel=0.16, seg=3)
        g.box(c + Vector((-0.2 * facing, 0, zb + 1.02)), (length * 0.52, width - 0.14, 0.5), "car_glass", bevel=0.14, seg=2)
        g.box(c + Vector((-0.2 * facing, 0, zb + 1.28)), (length * 0.42, width - 0.18, 0.04), mat, bevel=0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            wx = cx + sx * (length / 2 - (0.75 if not van else 0.7))
            wy = cy + sy * (width / 2 - 0.1)
            g.cyl(P(wx, wy, zb + 0.34) + Vector((0, -sy * 0.11, 0)), 0.34, 0.22, "tyre", segs=16, axis="Y")
            g.cyl(P(wx, wy, zb + 0.34) + Vector((0, -sy * 0.115, 0)), 0.2, 0.235, "metal", segs=12, axis="Y")
    # Lights.
    fx = cx + facing * (length / 2 + 0.005)
    rx = cx - facing * (length / 2 + 0.005)
    for s in (-1, 1):
        (emit if lights else g).box(P(fx, cy + s * (width / 2 - 0.22), zb + (0.8 if van else 0.66)), (0.03, 0.26, 0.12),
                                    "emit_headlight" if lights else "plastic_white", bevel=0.01)
        (emit if lights else g).box(P(rx, cy + s * (width / 2 - 0.15), zb + (1.0 if van else 0.7)), (0.03, 0.14, 0.2 if van else 0.1),
                                    "emit_tail" if lights else "can_red", bevel=0.01)
    g.box(P(fx + facing * 0.02, cy, zb + 0.4), (0.06, width - 0.1, 0.16), "plastic_black", bevel=0.02)
    g.box(P(rx - facing * 0.02, cy, zb + 0.4), (0.06, width - 0.1, 0.16), "plastic_black", bevel=0.02)
    return P(fx, cy, zb + 0.75)


def build_street():
    g = Geo("street")
    gf = Geo("street_far")
    emit = Geo("street_emit")
    lamps = []
    lamps.append(street_lamp(g, emit, 8.5, 23.5, (0, 1)))
    lamps.append(street_lamp(g, emit, 23.5, 23.5, (0, 1)))
    lamps.append(street_lamp(g, emit, 5.5, 0.5, (1, 0)))
    for x in (-8.5, 38.5, 52):
        lamps.append(street_lamp(gf, emit, x, 23.5, (0, 1)))
    for x in (-16, 16, 46):
        lamps.append(street_lamp(gf, emit, x, 28.6, (0, -1)))
    lamps.append(street_lamp(gf, emit, 30.5, 0.5, (1, 0)))
    lamps.append(street_lamp(gf, emit, -16.5, 0.5, (1, 0)))
    # Road markings: double yellow lines on our side, a dashed centre line.
    for yy in (24.18, 24.32):
        g.aabb(BX(-3), BY(yy + 0.05), -0.098, BX(33), BY(yy - 0.05), -0.094, "paint_yellow")
    for x in range(-24, 54, 4):
        (g if -3 <= x <= 32 else gf).aabb(BX(x), BY(26.07), -0.098, BX(x + 2.2), BY(25.93), -0.094, "paint_road")
    # Drains and a manhole.
    for x in (6.0, 21.0):
        g.aabb(BX(x), BY(24.5), -0.099, BX(x + 0.5), BY(24.15), -0.095, "metal_dark")
    g.cyl(P(15.0, 23.0, 0.0), 0.32, 0.012, "metal_dark", segs=16)
    # Parked cars.
    van_front = car(g, emit, 0.6, 24.15, 4.9, 1.9, "van_paint", facing=1, lights=True, van=True)
    car(g, emit, 16.6, 24.15, 4.0, 1.75, "car_paint", facing=-1)
    car(gf, emit, -9.0, 24.15, 4.1, 1.75, "car_paint2", facing=1)
    car(gf, emit, 36.0, 24.15, 4.2, 1.8, "bin_blue", facing=1)
    car(gf, emit, 8.0, 26.1, 4.1, 1.75, "car_paint2", facing=-1)
    car(gf, emit, 25.0, 26.1, 4.0, 1.75, "car_paint", facing=-1)
    car(gf, emit, -16.0, 26.1, 4.0, 1.75, "metal", facing=-1)
    return g, gf, emit, lamps, van_front


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


def prop_table(g, e, p):
    fr, span, depth = frame_for(p, g)
    L, D = span * 0.88, depth * 0.72
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
    # A trap house dining table: scales, baggies, a laptop, cash counter.
    fr.box(-0.6, 0.1, 0.77, 0.22, 0.16, 0.03, "plastic_black", bevel=0.01)
    fr.box(-0.6, 0.1, 0.8, 0.14, 0.14, 0.004, "chrome")
    for k in range(9):
        fr.box(-0.2 + (k % 3) * 0.1, -0.15 + (k // 3) * 0.09, 0.77, 0.07, 0.05, 0.02, "plastic_white", rot=k * 0.7)
    fr.box(0.6, -0.05, 0.77, 0.36, 0.25, 0.015, "metal_dark", bevel=0.005, rot=-0.2)
    fe = Frame(e_geo, fr.c.x, fr.c.y, (fr.f.x, fr.f.y), (fr.a.x, fr.a.y))
    fe.box(0.6 + 0.0, 0.08, 0.785, 0.34, 0.01, 0.22, "emit_screen", rot=-0.2)
    e.append(("laptop", fr.p(0.6, -0.1, 1.0)))
    fr.cyl(0.2, 0.28, 0.77, 0.033, 0.12, "can_silver", segs=10)
    fr.cyl(-0.9, -0.25, 0.77, 0.04, 0.2, "glass", segs=10)


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
        wheelie_bin(g, p["x"] + 0.5, p["y"] + k + 0.5, mats[(k + p["x"]) % 3], rot=math.pi / 2 if p["x"] > 20 else 0)


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
    for p in L["props"]:
        if p["kind"] in ("lamp", "car"):
            continue  # built with the street
        geo = g if in_house(p["x"], p["y"]) else ge
        fns[p["kind"]](geo, extra, p)

    # Dressing that is not in the level data (never solid, kept out of the walkways).
    # Living room: rug, floor lamp, beanbag.
    g.aabb(BX(5.9), BY(18.0), 0, BX(7.9), BY(15.4), 0.012, "rug", bevel=0.004)
    g.cyl(P(5.35, 18.62, 0), 0.14, 0.03, "metal_dark", segs=12)
    g.cyl(P(5.35, 18.62, 0.03), 0.015, 1.25, "metal", segs=6)
    g.cyl(P(5.35, 18.62, 1.18), 0.17, 0.26, "fabric_pillow", segs=14, r2=0.11)
    extra.append(("floorlamp", P(5.35, 18.62, 1.3)))
    # Hall: radiator, post on the mat, coats.
    g.aabb(BX(11.66), BY(15.9), 0.15, BX(11.72), BY(15.0), 0.7, "plastic_white", bevel=0.01)
    g.aabb(BX(12.2), BY(18.95), 0, BX(13.0), BY(18.45), 0.015, "fabric_chair")
    for k, (x, y) in enumerate(((12.4, 18.6), (12.55, 18.55), (12.5, 18.75))):
        g.box(P(x, y, 0.018), (0.22, 0.11, 0.004), "paper", rot=k * 0.9)
    for k in range(3):
        g.box(P(14.33, 17.2 + k * 0.28, 1.15), (0.08, 0.24, 0.55), "metal_dark" if k != 1 else "fabric_chair",
              bevel=0.04, seg=2, smooth=True)
    # Kitchen: pedal bin, washing basket.
    g.cyl(P(18.35, 8.35, 0), 0.16, 0.5, "chrome", segs=14)
    g.cyl(P(15.4, 12.6, 0), 0.25, 0.3, "plastic_white", segs=14, r2=0.27)
    # Stash room: gaming desk and screen, clothes on the floor.
    g.aabb(BX(9.55), BY(12.95), 0, BX(10.6), BY(11.9), 0.74, "plastic_black", bevel=0.01)
    g.box(P(10.35, 12.4, 0.74) + Vector((0, 0, 0.2)), (0.04, 0.62, 0.36), "plastic_black", bevel=0.01)
    e_geo.box(P(10.32, 12.4, 0.94), (0.005, 0.58, 0.32), "emit_screen")
    extra.append(("monitor", P(10.1, 12.4, 1.0)))
    for k, (x, y) in enumerate(((7.2, 9.4), (8.3, 8.6), (6.0, 12.3))):
        g.box(P(x, y, 0.03), (0.5, 0.35, 0.06), "metal_dark" if k % 2 else "fabric_chair", bevel=0.03, seg=2, smooth=True, rot=k)
    # Back garden: rotary washing line, a trampoline next door, plant pots.
    g2 = ge
    g2.cyl(P(13.0, 4.0, 0), 0.025, 1.7, "metal", segs=6)
    for a in range(4):
        g2.cyl(P(13.0, 4.0, 1.65), 0.012, 1.0, "metal", segs=4, axis="X", rot=a * math.pi / 2 + 0.3)
    for k, (x, y) in enumerate(((17.6, 6.4), (18.2, 6.5), (24.0, 6.4))):
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
    ge.cyl(P(23.4, 20.7, 0.33), 0.32, 0.03, "tyre", segs=18, axis="Y")
    ge.cyl(P(24.4, 20.7, 0.33), 0.32, 0.03, "tyre", segs=18, axis="Y")
    ge.box(P(23.9, 20.7, 0.62), (0.95, 0.03, 0.04), "car_paint", rot=0, tilt=("Y", 0.3))
    ge.box(P(23.7, 20.7, 0.48), (0.04, 0.03, 0.5), "car_paint", tilt=("Y", -0.3))
    return g, ge, e_geo, extra


# =================================================================== loot
def build_loot():
    out = []
    for l in L["loot"]:
        g = Geo(f"loot_{l['id']}")
        o = Vector((0, 0, 0))
        if l["id"] == "cash":
            z = 0.42
            for k in range(6):
                u = (k % 3 - 1) * 0.17
                v = (k // 3 - 0.5) * 0.11
                for s in range(2 + k % 2):
                    g.box(o + Vector((u, v, z + 0.025 + s * 0.05)), (0.15, 0.075, 0.045), "loot_note", bevel=0.004, rot=k * 0.3)
                    g.box(o + Vector((u, v, z + 0.025 + s * 0.05)), (0.035, 0.078, 0.047), "loot_band", rot=k * 0.3)
        elif l["id"] == "product":
            # A sports holdall on the floor with wrapped blocks spilling out.
            g.box(o + Vector((0, 0, 0.16)), (0.62, 0.32, 0.3), "loot_bag", bevel=0.1, seg=3, smooth=True)
            for k in range(5):
                g.box(o + Vector(((k - 2) * 0.11, 0.0, 0.33 + (k % 2) * 0.04)), (0.1, 0.2, 0.07), "loot_wrap", bevel=0.02, seg=2,
                      rot=0.2 * k)
            for s in (-1, 1):
                g.cyl(o + Vector((s * 0.12, 0, 0.3)), 0.012, 0.25, "loot_bag", segs=6, axis="X")
        else:
            # The stash bag: a big black duffel.
            g.box(o + Vector((0, 0, 0.22)), (0.85, 0.42, 0.4), "loot_bag", bevel=0.15, seg=4, smooth=True)
            for s in (-1, 1):
                g.box(o + Vector((s * 0.15, 0, 0.45)), (0.05, 0.42, 0.03), "loot_note", bevel=0.01)
        obj = g.to_object(C_DYN)
        obj.location = P(l["x"], l["y"])
        out.append(obj)
    return out


# =================================================================== lights
def add_light(name, kind, loc, colour, power, radius=0.1, rot=None, size=None, spot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.color = kit.hex_lin(colour)
    ld.energy = power
    if kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = radius
    if kind == "AREA":
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = size
    if kind == "SPOT":
        ld.spot_size = spot
        ld.spot_blend = 0.6
    if kind == "SUN":
        ld.angle = math.radians(1.0)
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    if rot:
        o.rotation_euler = rot
    scene.collection.objects.link(o)
    return o


LIGHT_LOG = []


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
    for name, (x, y), col, power in (("hall", (12.9, 14.6), "#ffcf9e", 150), ("dining", (19.5, 16.0), "#ffd4a8", 130)):
        add_light(name, "POINT", P(x, y, 2.4), col, power, radius=0.08)
        LIGHT_LOG.append((name, tuple(P(x, y, 2.4))))
    add_light("kitchen", "AREA", P(19.5, 10.3, 2.55), "#dfe8ff", 65, size=(1.4, 0.2))
    LIGHT_LOG.append(("kitchen", tuple(P(19.5, 10.3, 2.4))))
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
    b.aabb(BX(4.35), BY(19.65), CEIL, BX(25.65), BY(7.35), CEIL + 0.15, "ceiling")
    # Roof over the target house so no sky gets in.
    b.aabb(BX(4.0), BY(19.9), EAVES, BX(26.0), BY(7.1), EAVES + 0.1, "slate")
    return b


# =================================================================== UVs
TO_CAM = Vector((0, -math.cos(math.radians(54)), math.sin(math.radians(54))))


def box_uvs(obj):
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv[0]
    mw = obj.matrix_world
    for f in bm.faces:
        name = me.materials[f.material_index].name.split(".")[0]
        s = kit.uv_size(name)
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            co = mw @ lp.vert.co
            if ax == 2:
                u, v = co.x, co.y
            elif ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            lp[uv].uv = (u / s, v / s)
    bm.to_mesh(me)
    bm.free()


def split_hidden(obj):
    """Move faces the game camera can never see into their own object."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    hid = [f for f in bm.faces if f.normal.dot(TO_CAM) < 0.06]
    if not hid or len(hid) == len(bm.faces):
        bm.free()
        return None
    me2 = me.copy()
    bmesh.ops.delete(bm, geom=hid, context="FACES")
    bm.to_mesh(me)
    bm.free()
    bm2 = bmesh.new()
    bm2.from_mesh(me2)
    vis = [f for f in bm2.faces if f.normal.dot(TO_CAM) >= 0.06]
    bmesh.ops.delete(bm2, geom=vis, context="FACES")
    bm2.to_mesh(me2)
    bm2.free()
    o2 = bpy.data.objects.new(obj.name + "_hidden", me2)
    obj.users_collection[0].objects.link(o2)
    return o2


def importance(name):
    if name.endswith("_hidden"):
        return 0.1
    table = [("ground_int", 2.0), ("walls", 1.6), ("props_int", 1.6), ("door_", 1.4), ("frames", 1.3), ("sills", 1.2),
             ("skirting", 1.0), ("ground_near", 1.0), ("road", 0.8), ("boundaries_far", 0.3), ("boundaries", 1.0),
             ("street_far", 0.3), ("street", 1.0), ("props_ext", 1.0), ("neigh", 0.6), ("far_", 0.25), ("ground_far", 0.25)]
    for k, v in table:
        if name.startswith(k):
            return v
    return 1.0


def lightmap_uvs(objs):
    for o in objs:
        me = o.data
        lm = me.uv_layers.get("Lightmap") or me.uv_layers.new(name="Lightmap")
        me.uv_layers.active = lm
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    t = time.time()
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    print(f"  smart project {time.time() - t:.1f}s")
    bpy.ops.object.mode_set(mode="OBJECT")
    # Texel density by importance, relative to true surface area.
    for o in objs:
        me = o.data
        lm = me.uv_layers["Lightmap"]
        area3 = sum(p.area for p in me.polygons)
        uvs = np.zeros(len(me.loops) * 2)
        lm.data.foreach_get("uv", uvs)
        uvs = uvs.reshape(-1, 2)
        a2 = 0.0
        for p in me.polygons:
            idx = list(p.loop_indices)
            pts = uvs[idx]
            x, y = pts[:, 0], pts[:, 1]
            a2 += 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
        if a2 <= 0 or area3 <= 0:
            continue
        k = math.sqrt(area3 / a2) * importance(o.name)
        lm.data.foreach_set("uv", (uvs * k).ravel())
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    t = time.time()
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.0012, shape_method="CONCAVE")
    print(f"  pack {time.time() - t:.1f}s")
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        me = o.data
        if o.name.startswith(("ground_int", "walls", "ground_near")):
            lm = me.uv_layers["Lightmap"]
            uvs = np.zeros(len(me.loops) * 2)
            lm.data.foreach_get("uv", uvs)
            uvs = uvs.reshape(-1, 2)
            a2 = sum(0.5 * abs(np.dot(uvs[list(p.loop_indices)][:, 0], np.roll(uvs[list(p.loop_indices)][:, 1], 1))
                               - np.dot(uvs[list(p.loop_indices)][:, 1], np.roll(uvs[list(p.loop_indices)][:, 0], 1)))
                     for p in me.polygons)
            a3 = sum(p.area for p in me.polygons)
            print(f"  {o.name}: {math.sqrt(a2 / a3) * LM_SIZE:.1f} texels per unit at {LM_SIZE}")
        me.uv_layers.active = me.uv_layers["UVMap"]


# =================================================================== bake
def setup_cycles(samples):
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    cy.samples = samples
    cy.use_adaptive_sampling = False
    cy.max_bounces = 5
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 1
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 4
    cy.sample_clamp_indirect = 8.0
    scene.render.threads_mode = "AUTO"


def bake_into(objs, img, uv_layer, margin=6):
    mats = {m for o in objs for m in o.data.materials if m}
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.get("LM") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "LM"
        n.image = img
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    t = time.time()
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=margin, uv_layer=uv_layer,
                        use_clear=True, target="IMAGE_TEXTURES")
    print(f"  bake {img.name} {img.size[0]}x{img.size[1]}: {time.time() - t:.0f}s")
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)[::-1, :, :3].copy()


def encode_rgbd(lin):
    """Babylon's RGBD: gamma-encoded rgb scaled by D, with D in alpha."""
    m = np.maximum(lin.max(axis=2), 1e-6)
    D = np.maximum(255.0 / m, 1.0)
    D = np.clip(np.floor(D) / 255.0, 0, 1)
    rgb = lin * D[..., None]
    rgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
    out = np.dstack([rgb, D])
    return (out * 255 + 0.5).astype(np.uint8)


_OIDN = None


def oidn(img_lin):
    """OpenImageDenoise (shipped inside the bpy wheel) over an HDR float image."""
    global _OIDN
    import ctypes
    if _OIDN is None:
        lib = os.path.join(os.path.dirname(os.path.dirname(bpy.app.binary_path or "")), "lib")
        if not os.path.exists(os.path.join(lib, "libOpenImageDenoise.so.2")):
            import importlib.util
            lib = os.path.join(os.path.dirname(importlib.util.find_spec("bpy").origin), "lib")
        ctypes.CDLL(os.path.join(lib, "libtbb.so.12"), mode=ctypes.RTLD_GLOBAL)
        o = ctypes.CDLL(os.path.join(lib, "libOpenImageDenoise.so.2"), mode=ctypes.RTLD_GLOBAL)
        o.oidnNewDevice.restype = ctypes.c_void_p
        o.oidnNewDevice.argtypes = [ctypes.c_int]
        o.oidnCommitDevice.argtypes = [ctypes.c_void_p]
        o.oidnNewFilter.restype = ctypes.c_void_p
        o.oidnNewFilter.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        o.oidnSetSharedFilterImage.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_int,
                                               ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t,
                                               ctypes.c_size_t]
        o.oidnSetFilterBool.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_bool]
        o.oidnCommitFilter.argtypes = [ctypes.c_void_p]
        o.oidnExecuteFilter.argtypes = [ctypes.c_void_p]
        dev = o.oidnNewDevice(1)  # CPU
        o.oidnCommitDevice(dev)
        _OIDN = (o, dev)
    o, dev = _OIDN
    src = np.ascontiguousarray(img_lin, dtype=np.float32)
    out = np.zeros_like(src)
    h, w, _ = src.shape
    f = o.oidnNewFilter(dev, b"RT")
    o.oidnSetSharedFilterImage(f, b"color", src.ctypes.data, 3, w, h, 0, 0, 0)  # 3 = FLOAT3
    o.oidnSetSharedFilterImage(f, b"output", out.ctypes.data, 3, w, h, 0, 0, 0)
    o.oidnSetFilterBool(f, b"hdr", True)
    o.oidnCommitFilter(f)
    o.oidnExecuteFilter(f)
    return out


def denoise(img_lin, mask, passes=2):
    """A light edge-aware smooth inside covered texels, to take the edge off bake noise."""
    out = img_lin.copy()
    for _ in range(passes):
        acc = out * 4.0
        wsum = np.full(out.shape[:2], 4.0)
        lum = out.mean(axis=2)
        for dy, dx, w in ((0, 1, 2), (0, -1, 2), (1, 0, 2), (-1, 0, 2), (1, 1, 1), (1, -1, 1), (-1, 1, 1), (-1, -1, 1)):
            sh = np.roll(np.roll(out, dy, 0), dx, 1)
            shm = np.roll(np.roll(mask, dy, 0), dx, 1)
            shl = sh.mean(axis=2)
            sim = np.exp(-((shl - lum) ** 2) / (2 * (0.08 + 0.15 * lum) ** 2))
            ww = w * sim * shm
            acc += sh * ww[..., None]
            wsum += ww
        out = acc / wsum[..., None]
    return out


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
    statics = [o for o in statics if o]
    door_objs = []
    for d in doors:
        o = obj(d["geo"], C_STATIC)
        door_objs.append(o)
        obj(d["hi"], C_BLOCK)
    emitters = [obj(g, C_EXPORT) for g in (lit, st_emit, pemit)]
    hidden_in_bake = [obj(g, C_DYN) for g in (caps, glass)]
    for g in (high, frames_hi, blk):
        obj(g, C_BLOCK)
    loot = build_loot()
    build_lights(lamps, extra, van_front)

    for o in statics + door_objs + emitters + hidden_in_bake + loot:
        box_uvs(o)
    t = time.time()
    for o in list(statics):
        h = split_hidden(o)
        if h:
            statics.append(h)
    print(f"split hidden faces {time.time() - t:.1f}s")
    tris = sum(len(p.vertices) - 2 for o in statics + door_objs for p in o.data.polygons)
    print(f"static objects {len(statics)}, triangles {tris}")
    lightmap_uvs(statics + door_objs)
    print(f"uvs done {time.time() - t0:.1f}s")

    meta = {"materials": {}, "lights": LIGHT_LOG, "doors": {}, "cut": CUT}
    for k, (tex, tint, size, rough, em) in MATS.items():
        meta["materials"][k] = {"tex": tex, "tint": tint, "size": size, "rough": rough,
                                "emissive": list(em) if em else None}
    for d in doors:
        h = d["hinge"]
        meta["doors"][f"door_{d['def']['x']}_{d['def']['y']}"] = {"hinge": [h.x, h.z, h.y], "axis": d["def"]["axis"]}

    if BAKE:
        setup_cycles(SAMPLES)
        C_DYN.hide_render = True
        img = bpy.data.images.new("lightmap", LM_SIZE, LM_SIZE, float_buffer=True, alpha=False)
        lm = bake_into(statics + door_objs, img, "Lightmap")
        cover = (lm.max(axis=2) > 0).astype(np.float64)
        lm = oidn(lm) * cover[..., None]
        lm = denoise(lm, cover, passes=1)
        print("  lightmap percentiles (50/90/99/max):", [float(np.percentile(lm[cover > 0], q)) for q in (50, 90, 99)], float(lm.max()))
        from PIL import Image
        Image.fromarray(encode_rgbd(lm), "RGBA").save(os.path.join(OUT, "estate-lightmap.png"), optimize=True)
        np.save(os.path.join(HERE, "lightmap.npy"), lm.astype(np.float16))
        # Light at chest height across the map, for characters.
        pg = Geo("probe")
        pg.quad(P(0, H, 1.0), (W, 0, 0), (0, H, 0), "plastic_white", n=(0, 0, 1))
        pobj = pg.to_object(C_STATIC)
        me = pobj.data
        uvl = me.uv_layers.new(name="UVMap")
        for lp in me.loops:
            co = me.vertices[lp.vertex_index].co
            uvl.data[lp.index].uv = ((co.x + W / 2) / W, (co.y + H / 2) / H)
        pimg = bpy.data.images.new("probe", W * 8, H * 8, float_buffer=True, alpha=False)
        scene.cycles.samples = max(64, SAMPLES // 2)
        pr = oidn(bake_into([pobj], pimg, "UVMap", margin=0))
        pmax = float(np.percentile(pr, 99.5)) * 1.2 + 1e-6
        enc = (np.clip(pr / pmax, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(enc, "RGB").save(os.path.join(OUT, "estate-probe.png"))
        meta["probe"] = {"max": pmax, "perUnit": 8}
        bpy.data.objects.remove(pobj)
        C_DYN.hide_render = False

    json.dump(meta, open(os.path.join(OUT, "estate-materials.json"), "w"), indent=1)

    # Join the static set into one object for export; doors, loot and emitters stay separate.
    bpy.ops.object.select_all(action="DESELECT")
    for o in statics:
        o.select_set(True)
    bpy.context.view_layer.objects.active = statics[0]
    bpy.ops.object.join()
    statics[0].name = "static"
    exp = [statics[0]] + door_objs + emitters + hidden_in_bake + loot
    bpy.ops.object.select_all(action="DESELECT")
    for o in exp:
        if o:
            o.select_set(True)
    path = os.path.join(OUT, "estate.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", export_yup=True, export_apply=False,
                              export_cameras=False, export_lights=False)
    print(f"exported {path} {os.path.getsize(path) / 1e6:.1f} MB, total {time.time() - t0:.0f}s")

    if PREVIEW:
        setup_cycles(24)
        scene.cycles.use_denoising = True
        cam = bpy.data.cameras.new("cam")
        cam.type = "ORTHO"
        cam.ortho_scale = 34
        co = bpy.data.objects.new("cam", cam)
        tilt = math.radians(54)
        co.location = (0, -math.cos(tilt) * 60, math.sin(tilt) * 60)
        co.rotation_euler = (math.radians(90) - tilt, 0, 0)
        scene.collection.objects.link(co)
        scene.camera = co
        C_BLOCK.hide_render = True
        C_DYN.hide_render = False
        scene.render.resolution_x, scene.render.resolution_y = 1280, 720
        scene.render.filepath = os.path.join(HERE, "preview.png")
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.exposure = 1.5
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"preview {time.time() - t:.0f}s")


main()
