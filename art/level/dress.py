"""Real models for level dressing: Poly Haven glTFs (CC0) placed into a level.

    import dress
    dress.place("sofa_03", P(8.5, 16.5), face=math.pi)   # map facing, like level props
    statics += dress.placed()                            # bake and export with the rest
    meta = {"materials": dress.materials()}              # textures for the game

Each model is loaded once, joined into one mesh, cut down to a game budget and
its materials renamed ph_<asset>[_n]. Their base colour maps are written to
public/textures/ph/ so the game can texture them by material name like any
other level material. Models must be fetched first: art/assets/polyhaven.py.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "art", "assets"))
import polyhaven  # noqa: E402

TEX_OUT = os.path.join(ROOT, "public", "textures", "ph")

# Per-model fixes: scale (some ship in the wrong units), triangle budget, and
# the turn that makes the model's front face Blender -Y.
FIX = {
    "steel_frame_shelves_01": {"scale": 0.07},   # ships in decimetres; also kept under the 1.5 m wall cut
    "vintage_microwave": {"scale": 0.5},
    "street_rat": {"tris": 600},
    "old_bed_frame": {"tris": 4000},
}
DEFAULT_TRIS = 2500   # big things; smaller ones get less (see _load)

_base = {}
_placed = []
_mats = {}
_lib = None


def _library():
    global _lib
    if _lib is None:
        _lib = bpy.data.collections.new("ph_library")   # never linked to the scene
    return _lib


def _texture(mat, name, big):
    """Write the material's base colour map for the game and keep the name."""
    b = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
    rough = 0.8
    if b:
        rough = float(b.inputs["Roughness"].default_value)
        link = b.inputs["Base Color"].links
        node = link[0].from_node if link else None
        while node and node.type != "TEX_IMAGE" and node.inputs:
            ins = [i for i in node.inputs if i.links]
            node = ins[0].links[0].from_node if ins else None
        if node and node.type == "TEX_IMAGE" and node.image:
            from PIL import Image
            os.makedirs(TEX_OUT, exist_ok=True)
            src = bpy.path.abspath(node.image.filepath)
            im = Image.open(src).convert("RGB")
            side = 1024 if big else 512
            if im.width > side:
                im = im.resize((side, side * im.height // im.width), Image.LANCZOS)
            im.save(os.path.join(TEX_OUT, f"{name}.jpg"), quality=86, optimize=True)
            _mats[name] = {"tex": f"ph/{name}", "tint": "#ffffff", "size": 1.0, "rough": max(rough, 0.45),
                           "emissive": None}
            return
    col = b.inputs["Base Color"].default_value if b else (0.5, 0.5, 0.5, 1)
    hexc = "#" + "".join(f"{int(max(0, min(1, c)) ** (1 / 2.2) * 255):02x}" for c in col[:3])
    _mats[name] = {"tex": None, "tint": hexc, "size": 1.0, "rough": max(rough, 0.45), "emissive": None}


def _load(asset):
    if asset in _base:
        return _base[asset]
    path = polyhaven.fetch(asset)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    keep = obj.name
    for name in [o.name for o in bpy.data.objects if o not in before]:
        if name != keep:
            bpy.data.objects.remove(bpy.data.objects[name])
    fix = FIX.get(asset, {})
    obj.scale = (fix.get("scale", 1.0),) * 3
    obj.rotation_mode = "XYZ"
    obj.rotation_euler.z += fix.get("turn", 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    me = obj.data
    if me.shape_keys:
        obj.shape_key_clear()
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    ext = max(max(v.co[i] for v in me.vertices) - min(v.co[i] for v in me.vertices) for i in range(3))
    budget = fix.get("tris", DEFAULT_TRIS if ext > 1.0 else 1500 if ext > 0.45 else 500)
    if tris > budget:
        mod = obj.modifiers.new("cut", "DECIMATE")
        mod.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Origin at the middle of the footprint, on the floor.
    lo = Vector([min((v.co[i] for v in me.vertices)) for i in range(3)])
    hi = Vector([max((v.co[i] for v in me.vertices)) for i in range(3)])
    me.transform(Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
    big = max(hi - lo) > 1.0
    for k, m in enumerate(me.materials):
        name = f"ph_{asset.lower()}" + (f"_{k}" if k else "")
        m.name = name
        _texture(m, name, big)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    _library().objects.link(obj)
    obj.name = f"ph_{asset}"
    _base[asset] = (obj, hi - lo)
    return _base[asset]


def size(asset):
    """Width (X), depth (Y) and height of a model as placed with face=pi/2."""
    return _load(asset)[1]


def place(asset, at, face=math.pi / 2, coll=None, tilt=(0.0, 0.0), lift=0.0, spin=0.0):
    """Put a copy of `asset` at Blender point `at` (use the level's P()).
    `face`: map facing of the model's front, as level props use (0 east,
    pi/2 south). `tilt`: (x, y) radians, to lay a thing on its side. `spin`:
    an extra turn in radians, for scattered clutter."""
    base, _dims = _load(asset)
    o = base.copy()
    o.data = base.data.copy()
    o.location = at + Vector((0, 0, lift))
    o.rotation_mode = "XYZ"
    o.rotation_euler = Euler((tilt[0], tilt[1], math.pi / 2 - face + spin), "XYZ")
    (coll or bpy.context.scene.collection).objects.link(o)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if tilt != (0.0, 0.0):
        # Laid over: sit it back on the floor (or whatever it was lifted onto).
        zmin = min(v.co.z for v in o.data.vertices)
        o.data.transform(Matrix.Translation((0, 0, at.z + lift - zmin)))
    _placed.append(o)
    return o


def placed():
    return list(_placed)


def materials():
    return dict(_mats)
