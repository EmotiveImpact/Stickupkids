"""Modelling kit for the level builder: a bmesh accumulator with bevelled
boxes, cylinders and quads, plus the material table shared with the game.

Coordinates: map cells are one unit, x east, y south. Blender is Z up with
X east and Y north, so map (x, y) sits at Blender (x - W/2, H/2 - y).
"""
import math
import os
import bpy  # noqa: I001
import bmesh
from mathutils import Matrix, Vector

# --------------------------------------------------------------- materials
# name: texture (or None), tint hex, texture size in metres, roughness, emissive
# The game reads this table (written to public/models/estate-materials.json)
# and the base colour of each Blender material is the texture mean times the
# tint, so bounced light picks up the right colour.
MATS = {
    # Walls
    "brick": ("brick", "#ffffff", 0.9, 0.9, None),
    "brick_n1": ("brick", "#d8c8d0", 0.9, 0.9, None),
    "brick_n2": ("brick_dark", "#ffffff", 0.9, 0.9, None),
    "brick_n3": ("brick", "#b8a8b8", 0.9, 0.9, None),
    "render_n": ("plaster", "#a8b0c0", 2.0, 0.9, None),
    "plaster_stash": ("plaster", "#9a86a6", 2.0, 0.9, None),
    "plaster_living": ("plaster", "#8fa4b0", 2.0, 0.9, None),
    "plaster_hall": ("plaster", "#b8b6c8", 2.0, 0.9, None),
    "plaster_kitchen": ("plaster", "#a9b8cc", 2.0, 0.9, None),
    "plaster_dining": ("plaster", "#a898b8", 2.0, 0.9, None),
    "ceiling": (None, "#d0d0d8", 1.0, 0.9, None),
    "cap": (None, "#15161c", 1.0, 1.0, None),
    "frame_white": (None, "#c4c7d2", 1.0, 0.5, None),
    "sill": ("concrete", "#d0d4dc", 1.0, 0.9, None),
    # Floors
    "boards": ("boards", "#ffffff", 1.6, 0.6, None),
    "carpet_living": ("carpet", "#a8b4d0", 1.0, 1.0, None),
    "carpet_stash": ("carpet", "#ffffff", 1.0, 1.0, None),
    "tiles": ("tiles", "#ffffff", 1.2, 0.35, None),
    "rug": ("fabric", "#b0a0c8", 0.7, 1.0, None),
    # Outside
    "tarmac": ("tarmac", "#ffffff", 3.0, 0.35, None),
    "tarmac_alley": ("tarmac", "#c8ccd8", 3.0, 0.5, None),
    "paving": ("paving", "#ffffff", 1.2, 0.5, None),
    "patio": ("patio", "#ffffff", 1.6, 0.6, None),
    "concrete": ("concrete", "#ffffff", 3.0, 0.7, None),
    "kerb": ("concrete", "#c8ccd4", 1.0, 0.6, None),
    "grass": ("grass", "#ffffff", 2.5, 1.0, None),
    "soil": ("soil", "#ffffff", 2.0, 1.0, None),
    "gravel": ("tarmac", "#9a9cb0", 1.0, 0.9, None),
    "fence": ("fence", "#ffffff", 1.2, 0.9, None),
    "slate": ("slate", "#ffffff", 1.5, 0.6, None),
    "leaves": ("grass", "#7a9a80", 0.8, 1.0, None),
    "bark": ("fence", "#7a6a70", 0.6, 1.0, None),
    "paint_yellow": (None, "#b8962a", 1.0, 0.6, None),
    "paint_road": (None, "#b8bcc0", 1.0, 0.6, None),
    # Furniture and stuff
    "fabric_sofa": ("fabric", "#8890b8", 0.6, 1.0, None),
    "fabric_chair": ("fabric", "#7a6a90", 0.6, 1.0, None),
    "fabric_bed": ("fabric", "#9aa8c8", 0.8, 1.0, None),
    "fabric_pillow": ("fabric", "#d0d4e0", 0.8, 1.0, None),
    "wood_dark": ("boards", "#8a8098", 1.0, 0.6, None),
    "wood_light": ("boards", "#c0b8c8", 1.0, 0.6, None),
    "door_int": (None, "#cfcfd8", 1.0, 0.5, None),
    "door_front": (None, "#1c3444", 1.0, 0.4, None),
    "metal_dark": (None, "#2a2d36", 1.0, 0.4, None),
    "metal": (None, "#7e8594", 1.0, 0.35, None),
    "chrome": (None, "#b8bfcc", 1.0, 0.15, None),
    "plastic_black": (None, "#16171c", 1.0, 0.5, None),
    "plastic_white": (None, "#c6cad4", 1.0, 0.4, None),
    "plastic_grey": (None, "#5a5e6a", 1.0, 0.5, None),
    "bin_green": (None, "#22423a", 1.0, 0.6, None),
    "bin_black": (None, "#1c1e24", 1.0, 0.6, None),
    "bin_blue": (None, "#1e3050", 1.0, 0.6, None),
    "car_paint": (None, "#2c3a5a", 1.0, 0.25, None),
    "car_paint2": (None, "#4a4e58", 1.0, 0.25, None),
    "van_paint": (None, "#15171c", 1.0, 0.3, None),
    "tyre": (None, "#121216", 1.0, 0.8, None),
    "car_glass": (None, "#0e1420", 1.0, 0.05, None),
    "worktop": (None, "#3a3e4a", 1.0, 0.3, None),
    "cupboard": (None, "#d0d2da", 1.0, 0.4, None),
    "appliance": (None, "#c8ccd6", 1.0, 0.3, None),
    "cardboard": (None, "#6a6270", 1.0, 0.9, None),
    "paper": (None, "#d8d8e0", 1.0, 0.9, None),
    "plant_pot": (None, "#3a3442", 1.0, 0.8, None),
    "can_red": (None, "#8a2030", 1.0, 0.3, None),
    "can_silver": (None, "#a0a8b8", 1.0, 0.3, None),
    "glass": (None, "#1a2840", 1.0, 0.05, None),
    "loot_note": (None, "#7ab89a", 1.0, 0.8, None),
    "loot_band": (None, "#d8c8f0", 1.0, 0.6, None),
    "loot_wrap": (None, "#c8d0dc", 1.0, 0.3, None),
    "loot_bag": (None, "#1a1d24", 1.0, 0.7, None),
    # Emitters (lights in the bake, glowing in the game)
    "emit_tv": (None, "#6c9cff", 1.0, 0.2, ("#6c9cff", 6.0)),
    "emit_lamp": (None, "#ffb060", 1.0, 0.3, ("#ff9a3e", 25.0)),
    "emit_window_warm": (None, "#ffb46a", 1.0, 0.3, ("#ffb46a", 1.3)),
    "emit_window_cool": (None, "#a8c0ff", 1.0, 0.3, ("#9ab8ff", 0.95)),
    "emit_window_tv": (None, "#7aa0ff", 1.0, 0.3, ("#7aa0ff", 0.85)),
    "emit_fridge": (None, "#e0f0ff", 1.0, 0.3, ("#d8ecff", 4.0)),
    "emit_bulb": (None, "#ffe6c0", 1.0, 0.3, ("#ffe0b0", 12.0)),
    "emit_strip": (None, "#e8f0ff", 1.0, 0.3, ("#e0ecff", 10.0)),
    "emit_led": (None, "#ff2d9b", 1.0, 0.3, ("#ff2d9b", 5.0)),
    "emit_headlight": (None, "#fff4e0", 1.0, 0.3, ("#fff0d8", 20.0)),
    "emit_tail": (None, "#ff2030", 1.0, 0.3, ("#ff1828", 4.0)),
    "emit_screen": (None, "#9ab8ff", 1.0, 0.2, ("#9ab8ff", 3.0)),
    "emit_hob": (None, "#ff4020", 1.0, 0.3, ("#ff3818", 2.0)),
}

TEX_MEANS = {}
TEX_SIZE = {}
# Materials that show a texture at its real-world size (art/textures/out/sizes.txt).
# The rest reuse a texture at whatever scale reads best on them.
TRUE_SIZE = {"brick", "brick_n1", "brick_n2", "brick_n3", "boards", "carpet_living", "carpet_stash", "tiles",
             "tarmac", "tarmac_alley", "paving", "patio", "concrete", "grass", "soil", "fence", "slate"}


def load_means(path):
    for line in open(path):
        k, r, g, b = line.split()
        TEX_MEANS[k] = (float(r), float(g), float(b))
    sizes = os.path.join(os.path.dirname(path), "sizes.txt")
    if os.path.exists(sizes):
        for line in open(sizes):
            k, v = line.split()
            TEX_SIZE[k] = float(v)


def uv_size(name):
    """Metres covered by one repeat of this material's texture."""
    tex, _tint, size, _r, _e = MATS[name]
    if name in TRUE_SIZE and tex in TEX_SIZE:
        return TEX_SIZE[tex]
    return size


def hex_lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def srgb_to_lin(c):
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def base_colour(name):
    tex, tint, _size, _r, _e = MATS[name]
    t = hex_lin(tint)
    if tex:
        m = srgb_to_lin(TEX_MEANS[tex])
        return [a * b for a, b in zip(m, t)]
    return t


_mat_cache = {}


def material(name):
    if name in _mat_cache:
        return _mat_cache[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*base_colour(name), 1)
    b.inputs["Roughness"].default_value = MATS[name][3]
    em = MATS[name][4]
    if em:
        b.inputs["Emission Color"].default_value = (*hex_lin(em[0]), 1)
        b.inputs["Emission Strength"].default_value = em[1]
    _mat_cache[name] = m
    return m


# --------------------------------------------------------------- geometry
UP = Vector((0, 0, 1))


class Geo:
    """Accumulates geometry for one object. Faces carry a material name."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.smooth_faces = set()

    def mi(self, mat):
        if mat not in MATS:
            raise KeyError(mat)
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    # A quad from a corner and two edge vectors, wound to face n.
    def quad(self, p0, du, dv, mat, n=None):
        p0 = Vector(p0)
        du = Vector(du)
        dv = Vector(dv)
        pts = [p0, p0 + du, p0 + du + dv, p0 + dv]
        if n is not None and du.cross(dv).dot(Vector(n)) < 0:
            pts.reverse()
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(mat)
        return f

    def poly(self, pts, mat):
        vs = [self.bm.verts.new(Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(mat)
        # A new face's normal is zero until asked for; callers check it to fix the winding.
        f.normal_update()
        return f

    def _finish_new(self, verts, mat, bevel, seg, smooth, mats=None):
        faces = {f for v in verts for f in v.link_faces}
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            r = bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=seg, profile=0.5,
                                affect="EDGES", clamp_overlap=True)
            faces = {f for f in faces if f.is_valid} | set(r["faces"])
        idx = self.mi(mat)
        for f in faces:
            if mats:
                f.material_index = self.mi(mats(f))
            else:
                f.material_index = idx
            if smooth:
                f.smooth = True
        return faces

    def box(self, c, size, mat, bevel=0.0, seg=1, rot=0.0, smooth=False, mats=None, tilt=None):
        """Box centred at c (Blender coords) with size (sx, sy, sz), rotated rot radians about Z."""
        M = Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot, 4, "Z")
        if tilt:
            M = M @ Matrix.Rotation(tilt[1], 4, tilt[0])
        M = M @ Matrix.Diagonal((size[0], size[1], size[2], 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)
        bevel = min(bevel, min(size) * 0.45)
        return self._finish_new(r["verts"], mat, bevel, seg, smooth, mats)

    def aabb(self, x0, y0, z0, x1, y1, z1, mat, bevel=0.0, seg=1, smooth=False, mats=None):
        return self.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
                        (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), mat, bevel, seg, smooth=smooth, mats=mats)

    def cyl(self, c, r, h, mat, segs=16, r2=None, axis="Z", rot=0.0, smooth=True, cap=True, bevel=0.0):
        """Cylinder (or cone with r2) standing on c, along axis."""
        M = Matrix.Translation(Vector(c))
        if axis == "X":
            M = M @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "Y")
        elif axis == "Y":
            M = M @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Rotation(-math.pi / 2, 4, "X")
        else:
            M = M @ Matrix.Rotation(rot, 4, "Z")
        M = M @ Matrix.Translation((0, 0, h / 2))
        ret = bmesh.ops.create_cone(self.bm, cap_ends=cap, cap_tris=False, segments=segs,
                                    radius1=r, radius2=r if r2 is None else r2, depth=h, matrix=M)
        faces = self._finish_new(ret["verts"], mat, bevel, 1, False)
        if smooth:
            for f in faces:
                # Smooth the sides, keep the caps flat.
                n = f.normal
                f.smooth = True
        return faces

    def sphere(self, c, r, mat, segs=12, rings=8, scale=(1, 1, 1), smooth=True, noise=0.0, seed=0):
        M = Matrix.Translation(Vector(c)) @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1))
        ret = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r, matrix=M)
        if noise:
            import random
            rnd = random.Random(seed)
            cc = Vector(c)
            for v in ret["verts"]:
                d = (v.co - cc)
                v.co = cc + d * (1 + rnd.uniform(-noise, noise))
        return self._finish_new(ret["verts"], mat, 0, 1, smooth)

    def ico(self, c, r, mat, subdiv=2, scale=(1, 1, 1), noise=0.0, seed=0, smooth=True):
        M = Matrix.Translation(Vector(c)) @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1))
        ret = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=r, matrix=M)
        if noise:
            import random
            rnd = random.Random(seed)
            cc = Vector(c)
            for v in ret["verts"]:
                d = (v.co - cc)
                v.co = cc + d * (1 + rnd.uniform(-noise, noise))
        return self._finish_new(ret["verts"], mat, 0, 1, smooth)

    def to_object(self, coll, smooth_angle=35):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(material(m))
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        o = bpy.data.objects.new(self.name, me)
        coll.objects.link(o)
        return o


class Frame:
    """A local frame for a prop: origin at the footprint centre, v = front."""

    def __init__(self, geo, cx, cy, front, across):
        self.g = geo
        self.c = Vector((cx, cy, 0))
        self.f = Vector((front[0], front[1], 0))
        self.a = Vector((across[0], across[1], 0))
        self.rot = math.atan2(front[1], front[0]) - math.pi / 2  # local +Y -> front

    def p(self, u, v, z):
        return self.c + self.a * u + self.f * v + Vector((0, 0, z))

    def box(self, u, v, z, su, sv, sz, mat, bevel=0.0, seg=1, smooth=False, rot=0.0):
        """Box with its base centred at local (u, v, z)."""
        return self.g.box(self.p(u, v, z + sz / 2), (su, sv, sz), mat, bevel, seg, rot=self.rot + rot, smooth=smooth)

    def cyl(self, u, v, z, r, h, mat, segs=16, r2=None, smooth=True, axis="Z", bevel=0.0):
        if axis == "U":
            return self.g.cyl(self.p(u, v, z), r, h, mat, segs, r2, axis="X", rot=self.rot, smooth=smooth, bevel=bevel)
        if axis == "V":
            return self.g.cyl(self.p(u, v, z), r, h, mat, segs, r2, axis="Y", rot=self.rot, smooth=smooth, bevel=bevel)
        return self.g.cyl(self.p(u, v, z), r, h, mat, segs, r2, smooth=smooth, bevel=bevel)
