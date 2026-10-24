"""Removes the flat ground slab TRELLIS sometimes builds under a model.

    python drop_floor.py IN.glb OUT.glb

The slab is fused to the feet, so it is cut by footprint: faces lying in the
bottom few centimetres that are not under a shoe or paw (found from the
vertices just above the slab) are deleted, along with stray low fragments.
The texture is kept.
"""
import sys, bpy, bmesh
from mathutils import Vector
from mathutils.kdtree import KDTree

src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new(); bm.from_mesh(o.data)
    zs = [v.co.z for v in bm.verts]
    zmin, H = min(zs), max(zs) - min(zs)
    # slab surfaces show up as dense flat layers of vertices in the bottom 15 %
    # (shoes often poke through, so the slab need not be at the very bottom)
    bins = [0] * 60
    for z in zs:
        r = (z - zmin) / H
        if r < 0.15:
            bins[int(r / 0.0025)] += 1
    med = sorted(bins)[len(bins) // 2] or 1
    layers = [zmin + (i + 0.5) * 0.0025 * H for i, b in enumerate(bins) if b > 6 * med and b > 80]
    if not layers:
        print(o.name, "no slab"); bm.free(); continue
    top = max(layers) + 0.006 * H
    on_layer = lambda z: any(abs(z - l) < 0.006 * H for l in layers)
    # footprint of whatever stands on the slab: low vertices that are not slab
    feet = [v.co for v in bm.verts if v.co.z < top + 0.08 * H and not on_layer(v.co.z)]
    kd = KDTree(len(feet))
    for i, c in enumerate(feet):
        kd.insert(Vector((c.x, c.y, 0)), i)
    kd.balance()
    drop = []
    for f in bm.faces:
        if max(v.co.z for v in f.verts) > top:
            continue
        c = f.calc_center_median()
        _, _, dist = kd.find(Vector((c.x, c.y, 0))) if feet else (None, None, 1e9)
        flat = abs(f.normal.z) > 0.92 and all(on_layer(v.co.z) for v in f.verts)
        if dist > 0.02 * H or flat:
            drop.append(f)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    # then any small island left floating near the floor (slab offcuts)
    key = lambda v: tuple(round(c, 4) for c in v.co)
    bykey = {}
    for f in bm.faces:
        for v in f.verts:
            bykey.setdefault(key(v), []).append(f)
    seen, islands = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        part, stack = [], [f]; seen.add(f.index)
        while stack:
            g = stack.pop(); part.append(g)
            for v in g.verts:
                for h in bykey[key(v)]:
                    if h.index not in seen:
                        seen.add(h.index); stack.append(h)
        islands.append(part)
    total = len(bm.faces)
    for part in islands:
        if len(part) < 0.01 * total and max(v.co.z for g in part for v in g.verts) < top + 0.02 * H:
            drop += part
    bmesh.ops.delete(bm, geom=[f for part in islands for f in part
                               if len(part) < 0.01 * total and max(v.co.z for g in part for v in g.verts) < top + 0.02 * H],
                     context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(o.data); bm.free()
    print(o.name, "dropped faces:", len(drop))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="AUTO")
