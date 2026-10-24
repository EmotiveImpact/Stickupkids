"""Furniture and street dressing for the site builder (build_site.py): the
estate house's room props made map-agnostic, plus the outdoor pieces the new
jobs share. Call init() with the builder's transforms first.

Every prop function takes (g, e, p): g the Geo to build into, e a list that
collects (kind, position) for lights the bake should add, p the level prop.
"""
import math
import random

from mathutils import Vector

import props
from kit import Frame, Geo

P = BX = BY = None
EMIT = None   # Geo for glowing bits (screens, LEDs, the fridge light)
CUT = 1.5


def init(p, bx, by, emit, cut=1.5):
    global P, BX, BY, EMIT, CUT
    P, BX, BY, EMIT, CUT = p, bx, by, emit, cut


def frame_for(p, geo):
    """Local frame for a level prop: origin at its footprint centre, +v = front."""
    f = p.get("facing", math.pi / 2)
    fx, fy = round(math.cos(f)), round(math.sin(f))
    front = (fx, -fy)
    across = (-front[1], front[0])
    cx, cy = p["x"] + p["w"] / 2, p["y"] + p["h"] / 2
    fr = Frame(geo, BX(cx), BY(cy), front, across)
    along_x = abs(fx) > 0
    span = p["h"] if along_x else p["w"]
    depth = p["w"] if along_x else p["h"]
    return fr, span, depth


def efr(fr):
    return Frame(EMIT, fr.c.x, fr.c.y, (fr.f.x, fr.f.y), (fr.a.x, fr.a.y))


# =================================================================== rooms
def tv(g, e, p):
    fr, span, depth = frame_for(p, g)
    back = -depth / 2 - 0.04
    fr.box(0, back - 0.08, 0, span * 0.9, 0.42, 0.42, "wood_dark", bevel=0.015)
    fr.box(0, back - 0.15, 0.42, 0.35, 0.22, 0.03, "plastic_black", bevel=0.01)
    fr.box(0, back - 0.15, 0.45, 0.06, 0.06, 0.12, "plastic_black")
    fr.box(0, back - 0.15, 0.57, 1.7, 0.06, 0.92, "plastic_black", bevel=0.012)
    e.append(("tv", fr.p(0, back - 0.115, 1.03)))
    efr(fr).box(0, back - 0.115, 0.6, 1.62, 0.005, 0.86, "emit_tv")
    fr.box(-0.6, back - 0.05, 0.42, 0.32, 0.26, 0.07, "plastic_white", bevel=0.02)
    fr.box(0.0, back + 0.05, 0.42, 0.9, 0.09, 0.07, "plastic_black", bevel=0.02)
    fr.cyl(span * 0.42, back - 0.05, 0, 0.14, 0.32, "plant_pot", segs=12, r2=0.11)
    g.ico(fr.p(span * 0.42, back - 0.05, 0.62), 0.3, "leaves", subdiv=2, noise=0.25, seed=3)


def sofa(g, e, p):
    fr, span, depth = frame_for(p, g)
    L, D = span * 0.92, 0.95
    fr.box(0, 0, 0.06, L, D, 0.26, "fabric_sofa", bevel=0.05, seg=2)
    for s in (-1, 1):
        fr.box(s * (L / 2 - 0.12), 0, 0.06, 0.24, D, 0.56, "fabric_sofa", bevel=0.08, seg=3, smooth=True)
    fr.box(0, -D / 2 + 0.13, 0.32, L - 0.1, 0.26, 0.5, "fabric_sofa", bevel=0.06, seg=2)
    n = 3
    cw = (L - 0.5) / n
    for k in range(n):
        u = -(L - 0.5) / 2 + cw * (k + 0.5)
        fr.box(u, 0.08, 0.32, cw - 0.02, D - 0.32, 0.15, "fabric_sofa", bevel=0.06, seg=3, smooth=True)
        fr.box(u, -D / 2 + 0.33, 0.47, cw - 0.04, 0.2, 0.42, "fabric_sofa", bevel=0.08, seg=3, smooth=True)
    fr.box(-L / 2 + 0.42, -0.05, 0.47, 0.36, 0.14, 0.34, "fabric_pillow", bevel=0.06, seg=3, smooth=True, rot=0.3)
    fr.box(L / 2 - 0.35, 0.1, 0.47, 0.4, 0.35, 0.06, "metal_dark", bevel=0.03, seg=2, smooth=True, rot=-0.4)


def armchair(g, e, p):
    fr, span, depth = frame_for(p, g)
    fr.box(0, 0, 0.05, 0.85, 0.85, 0.3, "fabric_chair", bevel=0.05, seg=2)
    fr.box(0, -0.3, 0.35, 0.8, 0.22, 0.45, "fabric_chair", bevel=0.07, seg=3, smooth=True)
    for s in (-1, 1):
        fr.box(s * 0.36, 0.02, 0.05, 0.16, 0.82, 0.55, "fabric_chair", bevel=0.06, seg=3, smooth=True)
    fr.box(0, 0.08, 0.35, 0.56, 0.6, 0.13, "fabric_chair", bevel=0.05, seg=3, smooth=True)


def coffee_table(g, e, p):
    fr, span, depth = frame_for(p, g)
    fr.box(0, 0, 0.38, 0.95, 0.62, 0.04, "wood_dark", bevel=0.012)
    fr.box(0, 0, 0.1, 0.85, 0.52, 0.025, "wood_dark", bevel=0.008)
    for su in (-1, 1):
        for sv in (-1, 1):
            fr.box(su * 0.42, sv * 0.26, 0, 0.04, 0.04, 0.38, "metal_dark")
    fr.box(0.2, 0.05, 0.125, 0.3, 0.22, 0.02, "paper", rot=0.2)
    fr.cyl(-0.38, -0.08, 0.42, 0.033, 0.12, "can_silver", segs=10)
    fr.cyl(0.35, -0.18, 0.42, 0.07, 0.025, "metal", segs=12)


def counter(g, e, p):
    """A run of kitchen units against the wall behind the prop, with a sink and a hob."""
    fr, span, depth = frame_for(p, g)
    back = -depth / 2 - 0.04
    d = 0.66
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
    fr.box(-span * 0.25, v + 0.02, 0.905, 0.55, 0.42, 0.02, "chrome", bevel=0.01)
    fr.cyl(-span * 0.25, back + 0.06, 0.92, 0.015, 0.28, "chrome", segs=8)
    fr.cyl(span * 0.05, v - 0.05, 0.92, 0.08, 0.22, "plastic_white", segs=12)
    fr.box(span * 0.3, v + 0.02, 0.92, 0.6, 0.52, 0.01, "plastic_black", bevel=0.005)
    for su in (-1, 1):
        for sv in (-1, 1):
            fr.cyl(span * 0.3 + su * 0.15, v + 0.02 + sv * 0.13, 0.925, 0.09, 0.006, "metal_dark", segs=16)
    efr(fr).cyl(span * 0.3 + 0.15, v + 0.15, 0.932, 0.07, 0.003, "emit_hob", segs=16)


def fridge(g, e, p):
    fr, span, depth = frame_for(p, g)
    back = -depth / 2 - 0.02
    v = back + 0.36
    fr.box(0, v, 0, 0.7, 0.68, 1.48, "appliance", bevel=0.03, seg=2)
    fr.box(0, v + 0.3, 0.05, 0.6, 0.06, 1.38, "plastic_white")
    efr(fr).box(0, v + 0.27, 0.08, 0.56, 0.005, 1.32, "emit_fridge")
    for z in (0.35, 0.7, 1.05):
        fr.box(0, v + 0.18, z, 0.58, 0.3, 0.012, "glass")
        fr.box(-0.12, v + 0.2, z + 0.012, 0.12, 0.12, 0.14, "can_red", bevel=0.02)
    hinge = fr.p(-0.35, v + 0.34, 0)
    ang = math.radians(110)
    dvec = (fr.a * math.cos(ang) + fr.f * math.sin(ang))
    g.box(hinge + dvec * 0.35 + Vector((0, 0, 0.74)), (0.7, 0.07, 1.46), "appliance", bevel=0.02, rot=math.atan2(dvec.y, dvec.x))
    e.append(("fridge", fr.p(0, v + 0.45, 0.8)))


def table(g, e, p, trap=True):
    """A table and chairs; trap=True dresses it with scales, baggies and a laptop."""
    fr, span, depth = frame_for(p, g)
    L, D = span * 0.88, depth * 0.8
    fr.box(0, 0, 0.72, L, D, 0.05, "wood_dark", bevel=0.012)
    for su in (-1, 1):
        for sv in (-1, 1):
            fr.box(su * (L / 2 - 0.08), sv * (D / 2 - 0.08), 0, 0.07, 0.07, 0.72, "wood_dark", bevel=0.01)
    for k in (-1, 1):
        for sv in (-1, 1):
            u, v = k * L * 0.25, sv * (D / 2 + 0.12)
            fr.box(u, v, 0.44, 0.42, 0.4, 0.05, "wood_dark", bevel=0.01)
            fr.box(u, v + sv * 0.18, 0.49, 0.42, 0.04, 0.42, "wood_dark", bevel=0.01)
    if trap:
        fr.box(-0.45, 0.05, 0.77, 0.22, 0.16, 0.03, "plastic_black", bevel=0.01)
        fr.box(-0.45, 0.05, 0.8, 0.14, 0.14, 0.004, "chrome")
        for k in range(6):
            fr.box(-0.1 + (k % 3) * 0.09, -0.12 + (k // 3) * 0.08, 0.77, 0.07, 0.05, 0.02, "plastic_white", rot=k * 0.7)
        fr.box(0.45, -0.02, 0.77, 0.36, 0.25, 0.015, "metal_dark", bevel=0.005, rot=-0.2)
        efr(fr).box(0.45, 0.1, 0.785, 0.34, 0.01, 0.22, "emit_screen", rot=-0.2)
        e.append(("laptop", fr.p(0.45, -0.05, 1.0)))


def bed(g, e, p):
    """A double bed, headboard against the wall it faces away from."""
    fr, span, depth = frame_for(p, g)
    W, Lb = min(span, 1.5), depth - 0.2
    fr.box(0, 0, 0, W, Lb, 0.32, "wood_dark", bevel=0.02)
    fr.box(0, -Lb / 2 + 0.04, 0, W, 0.08, 0.95, "fabric_chair", bevel=0.03, seg=2)
    fr.box(0, 0.05, 0.32, W - 0.08, Lb - 0.2, 0.18, "fabric_pillow", bevel=0.05, seg=2)
    fr.box(0, 0.25, 0.44, W + 0.04, Lb - 0.6, 0.15, "fabric_bed", bevel=0.06, seg=3, smooth=True)
    for s in (-1, 1):
        fr.box(s * W * 0.24, -Lb / 2 + 0.35, 0.5, W * 0.42, 0.34, 0.12, "fabric_pillow", bevel=0.05, seg=3, smooth=True)
    efr(fr).box(0, -Lb / 2 + 0.02, 0.96, W, 0.02, 0.015, "emit_led")
    e.append(("led", fr.p(0, -Lb / 2 + 0.2, 1.0)))


def shelves(g, e, p):
    fr, span, depth = frame_for(p, g)
    back = -depth / 2 - 0.02
    v = back + 0.18
    fr.box(0, v, 0, span * 0.92, 0.36, 0.04, "wood_dark")
    for s in (-1, 1):
        fr.box(s * span * 0.45, v, 0, 0.04, 0.36, 1.4, "wood_dark")
    for z in (0.4, 0.8, 1.2):
        fr.box(0, v, z, span * 0.9, 0.34, 0.03, "wood_dark")
    rr = random.Random(p["x"] * 7 + p["y"])
    for z in (0.04, 0.43, 0.83):
        u = -span * 0.42
        while u < span * 0.4:
            w = rr.uniform(0.18, 0.4)
            h = rr.uniform(0.15, 0.33)
            fr.box(u + w / 2, v, z, w - 0.02, 0.3, h, rr.choice(["cardboard", "cardboard", "plastic_black", "paper"]), bevel=0.01)
            u += w + rr.uniform(0.0, 0.12)


def stairs(g, e, p):
    """A stair flight climbing from the south end of its footprint; past the cut it is cap."""
    x0, x1 = p["x"] + 0.05, p["x"] + p["w"] - 0.05
    y_s, y_n = p["y"] + p["h"], p["y"]
    n = 10
    rise = 0.18
    run = (y_s - y_n) / n
    for k in range(n):
        z1 = rise * (k + 1)
        ya = y_s - run * k
        z1c = min(z1, CUT)
        g.aabb(BX(x0), BY(ya), 0, BX(x1), BY(ya - run), z1c, "concrete" if z1 <= CUT else "cap")
        if z1 <= CUT:
            g.aabb(BX(x0), BY(ya - run + 0.04), z1c - 0.03, BX(x1), BY(ya - run), z1c + 0.005, "paint_yellow")
    g.aabb(BX(x1) - 0.04, BY(y_s), 0.9, BX(x1), BY(y_n), 0.95, "metal")


def bins(g, e, p):
    mats = ["bin_black", "bin_green", "bin_blue"]
    for k in range(max(p["w"], p["h"])):
        x = p["x"] + (k if p["w"] > p["h"] else 0) + 0.5
        y = p["y"] + (0 if p["w"] > p["h"] else k) + 0.5
        props.wheelie_bin(P, g, x, y, mats[(k + p["x"]) % 3], rot=math.pi / 2 if p["w"] <= p["h"] else 0)


def big_bin(g, e, p):
    """A four-wheeled communal bin."""
    c = P(p["x"] + p["w"] / 2, p["y"] + p["h"] / 2)
    rot = 0 if p["w"] >= p["h"] else math.pi / 2
    g.box(c + Vector((0, 0, 0.7)), (1.25, 0.95, 1.1), "metal", bevel=0.05, rot=rot)
    g.box(c + Vector((0, 0, 1.28)), (1.3, 1.0, 0.08), "bin_green", bevel=0.03, rot=rot)
    for sx in (-0.5, 0.5):
        for sy in (-0.35, 0.35):
            g.cyl(c + Vector((sx, sy, 0)), 0.07, 0.15, "plastic_black", segs=8)


def crate(g, e, p):
    """A dumped washing machine."""
    c = P(p["x"] + 0.5, p["y"] + 0.5)
    g.box(c + Vector((0, 0, 0.42)), (0.6, 0.6, 0.84), "appliance", bevel=0.03, rot=0.3)
    g.cyl(c + Vector((0.1, -0.3, 0.42)), 0.2, 0.04, "glass", segs=16, axis="Y", rot=0.3)


# =================================================================== outside
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
        crown.ico(P(x + math.cos(a) * rr, y + math.sin(a) * rr, h + r.uniform(0.6, 1.8)), r.uniform(1.1, 1.55) * scale,
                  "canopy" if k % 3 else "canopy_dark", subdiv=1, scale=(1, 1, 0.75), noise=0.2, seed=seed * 13 + k)
    crown.ico(P(x, y, h + 2.0 * scale), 1.35 * scale, "canopy", subdiv=1, scale=(1, 1, 0.7), noise=0.2, seed=seed * 13 + 99)


def column_lamp(g, emit, x, y, h=5.0):
    """A plain estate lamp column with a lantern head. Returns the light position."""
    g.cyl(P(x, y, 0), 0.12, 0.45, "metal_dark", segs=12)
    g.cyl(P(x, y, 0.45), 0.06, h - 0.65, "metal_dark", segs=12, r2=0.045)
    emit.cyl(P(x, y, h - 0.32), 0.15, 0.24, "emit_lamp_site", segs=12, r2=0.18)
    g.cyl(P(x, y, h - 0.08), 0.22, 0.1, "metal_dark", segs=12, r2=0.05)
    return P(x, y, h - 0.4)


def bulkhead(g, emit, x, y, z=2.3, facing=(0, 1)):
    """A wall light on a walkway soffit or a stairwell wall."""
    c = P(x, y, z)
    g.box(c, (0.34, 0.34, 0.08), "metal_dark", bevel=0.02)
    emit.box(c - Vector((0, 0, 0.05)), (0.28, 0.28, 0.02), "emit_lamp_site")
    return c - Vector((0, 0, 0.15))


def bench(g, p):
    f = p.get("facing", math.pi / 2)
    cx, cy = p["x"] + p["w"] / 2, p["y"] + p["h"] / 2
    fx, fy = math.cos(f), math.sin(f)
    across = (-fy, fx)
    span = max(p["w"], p["h"]) - 0.3
    rot = math.atan2(-fy, fx) - math.pi / 2
    c = P(cx, cy)
    for k in range(3):
        g.box(c + Vector((fx * (k - 1) * 0.14, -fy * (k - 1) * 0.14, 0.45)), (span, 0.11, 0.04), "wood_dark", bevel=0.01, rot=rot)
    g.box(c + Vector((-fx * 0.25, fy * 0.25, 0.75)), (span, 0.04, 0.3), "wood_dark", bevel=0.01, rot=rot)
    for s in (-1, 1):
        g.box(c + Vector((across[0] * s * span * 0.42, -across[1] * s * span * 0.42, 0.22)), (0.06, 0.5, 0.44), "metal_dark",
              bevel=0.01, rot=rot)


def litter_bin(g, p):
    c = P(p["x"] + 0.5, p["y"] + 0.5)
    g.cyl(c, 0.26, 0.85, "metal_dark", segs=16)
    g.cyl(c + Vector((0, 0, 0.85)), 0.29, 0.08, "metal_dark", segs=16, r2=0.22)


def bollard(g, x, y):
    g.cyl(P(x, y, 0), 0.1, 0.9, "metal_dark", segs=10)
    g.cyl(P(x, y, 0.75), 0.105, 0.05, "plastic_white", segs=10)


def parked_car(g, emit, p, mat, lights=False, van=False):
    """A car on a level prop footprint: along x when w > h, else along y. Returns its front (Blender) and heading."""
    along_x = p["w"] >= p["h"]
    f = p.get("facing", 0.0)
    if along_x:
        facing = 1 if math.cos(f) >= 0 else -1
        front = props.car(P, g, emit, p["x"] + 0.0, p["y"] + 0.1, p["w"] - 0.0, 1.8, mat, facing=facing, lights=lights, van=van, zb=0.0)
        return front, (0.0 if facing > 0 else math.pi)
    # Along y: build along x about the footprint centre and turn it.
    from mathutils import Matrix
    import bmesh
    cx, cy = p["x"] + p["w"] / 2, p["y"] + p["h"] / 2
    g.bm.verts.ensure_lookup_table()
    n0 = len(g.bm.verts)
    emit.bm.verts.ensure_lookup_table()
    m0 = len(emit.bm.verts)
    front = props.car(P, g, emit, cx - p["h"] / 2, cy - 0.9, p["h"], 1.8, mat, facing=1, lights=lights, van=van, zb=0.0)
    south = math.sin(f) > 0
    ang = -math.pi / 2 if south else math.pi / 2
    R = Matrix.Rotation(ang, 3, "Z")
    pivot = P(cx, cy)
    g.bm.verts.ensure_lookup_table()
    emit.bm.verts.ensure_lookup_table()
    bmesh.ops.rotate(g.bm, verts=g.bm.verts[n0:], cent=pivot, matrix=R)
    bmesh.ops.rotate(emit.bm, verts=emit.bm.verts[m0:], cent=pivot, matrix=R)
    return pivot + R @ (front - pivot), ang


FNS = {
    "tv": tv, "sofa": sofa, "armchair": armchair, "coffeeTable": coffee_table, "counter": counter, "fridge": fridge,
    "table": table, "bed": bed, "shelves": shelves, "stairs": stairs, "bins": bins, "bigBin": big_bin, "crate": crate,
}


def geo_pair(name):
    return Geo(name), Geo(name + "_far")
