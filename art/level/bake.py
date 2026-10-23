"""The back half shared by the level builders: UVs, the Cycles lightmap bake,
the light probe for characters, the material table and the glTF export.

A builder makes its geometry with kit.Geo, sorts the objects into the
collections from collections(), adds lights with add_light(), then calls
finish().
"""
import json
import math
import os
import time

import bpy  # noqa: I001  (bpy must load before bmesh)
import bmesh
import numpy as np
from mathutils import Vector

import kit
from kit import MATS, Geo

LIGHT_LOG = []


def collections():
    """static: baked and exported. export: exported, not baked. block: baked
    light blockers only. dynamic: exported, hidden in the bake."""
    scene = bpy.context.scene
    out = []
    for name in ("static", "export", "block", "dynamic"):
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
        out.append(c)
    return out


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
    bpy.context.scene.collection.objects.link(o)
    return o



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
             ("street_far", 0.3), ("street", 1.0), ("props_ext", 1.0), ("neigh", 0.6), ("far_canopies", 0.05), ("far_trees", 0.08), ("far_", 0.25),
             ("ground_far", 0.25), ("canopies", 0.3), ("trees", 0.6), ("shrubs", 0.6)]
    for k, v in table:
        if name.startswith(k):
            return v
    return 1.0


BLOBS = ("canopies", "far_canopies", "shrubs")


def lightmap_uvs(objs, lm_size):
    for o in objs:
        me = o.data
        lm = me.uv_layers.get("Lightmap") or me.uv_layers.new(name="Lightmap")
        me.uv_layers.active = lm
    t = time.time()
    # Leafy blobs (crowns, shrubs) take the widest angle, so each comes out in
    # a few big islands rather than thousands of slivers, each with its gutter.
    blobs = [o for o in objs if o.name.startswith(BLOBS)]
    for group, angle in (([o for o in objs if o not in blobs], 60), (blobs, 89)):
        if not group:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    print(f"  smart project {time.time() - t:.1f}s")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
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
    # A gutter of about two and a half texels whatever the map size.
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=2.5 / lm_size, shape_method="CONCAVE")
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
            print(f"  {o.name}: {math.sqrt(a2 / a3) * lm_size:.1f} texels per unit at {lm_size}")
        me.uv_layers.active = me.uv_layers["UVMap"]


# =================================================================== bake
def setup_cycles(samples):
    scene = bpy.context.scene
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



def finish(out, W, H, P, statics, door_objs, emitters, hidden_in_bake, loot, doors, coll, cut,
           bake=False, samples=128, lm_size=2048, preview=None, ortho=34, t0=None, meta=None):
    """UV, bake and export. `out`: folder for level.glb and friends. `P`: map
    (x, y, z) to Blender. `coll`: the four collections. `preview`: path for a
    Cycles preview render, or None."""
    t0 = t0 or time.time()
    scene = bpy.context.scene
    C_STATIC, C_EXPORT, C_BLOCK, C_DYN = coll
    os.makedirs(out, exist_ok=True)
    BAKE, SAMPLES, PREVIEW = bake, samples, preview
    emitters = [o for o in emitters if o]
    hidden_in_bake = [o for o in hidden_in_bake if o]
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
    lightmap_uvs(statics + door_objs, lm_size)
    print(f"uvs done {time.time() - t0:.1f}s")

    meta = {"materials": {}, "lights": LIGHT_LOG, "doors": {}, "cut": cut, **(meta or {})}
    for k, (tex, tint, size, rough, em) in MATS.items():
        meta["materials"][k] = {"tex": tex, "tint": tint, "size": size, "rough": rough,
                                "emissive": list(em) if em else None}
    for d in doors:
        h = d["hinge"]
        meta["doors"][f"door_{d['def']['x']}_{d['def']['y']}"] = {"hinge": [h.x, h.z, h.y], "axis": d["def"]["axis"]}

    if BAKE:
        setup_cycles(SAMPLES)
        C_DYN.hide_render = True
        img = bpy.data.images.new("lightmap", lm_size, lm_size, float_buffer=True, alpha=False)
        lm = bake_into(statics + door_objs, img, "Lightmap")
        cover = (lm.max(axis=2) > 0).astype(np.float64)
        lm = oidn(lm) * cover[..., None]
        lm = denoise(lm, cover, passes=1)
        print("  lightmap percentiles (50/90/99/max):", [float(np.percentile(lm[cover > 0], q)) for q in (50, 90, 99)], float(lm.max()))
        from PIL import Image
        Image.fromarray(encode_rgbd(lm), "RGBA").save(os.path.join(out, "level-lightmap.png"), optimize=True)
        np.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "lightmap.npy"), lm.astype(np.float16))
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
        Image.fromarray(enc, "RGB").save(os.path.join(out, "level-probe.png"))
        meta["probe"] = {"max": pmax, "perUnit": 8}
        bpy.data.objects.remove(pobj)
        C_DYN.hide_render = False

    json.dump(meta, open(os.path.join(out, "level-materials.json"), "w"), indent=1)

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
        o.select_set(True)
    path = os.path.join(out, "level.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", export_yup=True, export_apply=False,
                              export_cameras=False, export_lights=False)
    print(f"exported {path} {os.path.getsize(path) / 1e6:.1f} MB, total {time.time() - t0:.0f}s")

    if PREVIEW:
        setup_cycles(24)
        scene.cycles.use_denoising = True
        cam = bpy.data.cameras.new("cam")
        cam.type = "ORTHO"
        cam.ortho_scale = ortho
        co = bpy.data.objects.new("cam", cam)
        tilt = math.radians(54)
        co.location = (0, -math.cos(tilt) * 60, math.sin(tilt) * 60)
        co.rotation_euler = (math.radians(90) - tilt, 0, 0)
        scene.collection.objects.link(co)
        scene.camera = co
        C_BLOCK.hide_render = True
        C_DYN.hide_render = False
        scene.render.resolution_x, scene.render.resolution_y = 1280, 720
        scene.render.filepath = PREVIEW
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.exposure = 1.5
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"preview {time.time() - t:.0f}s")


