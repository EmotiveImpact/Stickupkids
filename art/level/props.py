"""Props shared by the level builders. Each takes P, the builder's map to
Blender transform: P(x, y, z) with x east, y south in map cells."""
import math

from mathutils import Vector

from kit import Geo


def street_lamp(P, g, emit, x, y, arm=(0, 1)):
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


def wheelie_bin(P, g, x, y, mat, rot=0.0, lid_open=False):
    c = P(x, y)
    g.box(c + Vector((0, 0, 0.5)), (0.58, 0.7, 0.92), mat, bevel=0.04, seg=2, rot=rot)
    g.box(c + Vector((0, 0, 0.98)), (0.62, 0.76, 0.06), mat, bevel=0.02, rot=rot, tilt=("X", -0.5) if lid_open else None)
    fx, fy = math.cos(rot), math.sin(rot)
    for s in (-1, 1):
        w = c + Vector((fx * 0.2 * s - fy * 0.3, fy * 0.2 * s + fx * 0.3, 0.1))
        g.cyl(w - Vector((fx * 0.04, fy * 0.04, 0)), 0.1, 0.08, "tyre", segs=12, axis="X", rot=rot)


def car(P, g, emit, x0, y0, length, width, mat, facing=1, lights=False, van=False, zb=-0.1):
    """A parked car or van along x. facing +1 means the bonnet points east. zb: ground height."""
    cx = x0 + length / 2
    cy = y0 + width / 2
    c = P(cx, cy, 0)
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


def build_loot(defs, P, coll):
    """The loot models, one object each, named loot_<id>, standing at their map spot."""
    out = []
    for l in defs:
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
        obj = g.to_object(coll)
        obj.location = P(l["x"], l["y"])
        out.append(obj)
    return out
