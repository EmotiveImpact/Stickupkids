"""Builds a rigged, animated Stickupkids crew member and exports it as glTF.

Run with Blender, or the bpy pip package:  python make_crew.py crew.glb

The mesh is low-poly and flat shaded, skinned to a simple humanoid skeleton.
Arms are driven by IK onto the rifle and legs by IK onto foot targets, so the
walk cycles plant their feet; the glTF exporter samples the result into plain
bone keys, so the game needs no IK at runtime.

Materials are named so the game can recolour them at load time:
  Slot   -> crew slot colour (or enemy red)
  Cloth  -> charcoal puffer and tracksuit
  Dark   -> balaclava, gloves, trainers, straps
  Skin   -> the strip of face that shows through the balaclava
  Sole   -> trainer soles
  Metal  -> the rifle (a separate mesh called Weapon, so it can be hidden)

Animations: Idle, Walk, Run, CrouchIdle, CrouchWalk (all loop, in place).
"""
import sys, math, bpy, bmesh
from mathutils import Vector, Matrix, Quaternion

out = sys.argv[-1] if sys.argv[-1].endswith(".glb") else "crew.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ---------------------------------------------------------------- materials
def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]

def mat(name, hexcol, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexcol), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m

M = {
    "Slot": mat("Slot", "#22E3FF", 0.45),
    "Cloth": mat("Cloth", "#1C1F27", 0.85),
    "Dark": mat("Dark", "#0A0B0E", 0.9),
    "Skin": mat("Skin", "#6B4A3A", 0.7),
    "Sole": mat("Sole", "#8E95A3", 0.8),
    "Metal": mat("Metal", "#23262E", 0.45, 0.6),
}

# ---------------------------------------------------------------- skeleton
# Blender convention: the character faces -Y, its left side is +X.
SH_X, SH_Z = 0.2, 1.43
BONES = [  # name, head, tail, parent, deform
    ("root", (0, 0, 0), (0, 0.25, 0), None, False),
    ("hips", (0, 0, 0.94), (0, 0, 1.05), "root", True),
    ("spine", (0, 0, 1.05), (0, 0, 1.22), "hips", True),
    ("chest", (0, 0, 1.22), (0, 0, 1.42), "spine", True),
    ("neck", (0, 0, 1.42), (0, 0, 1.51), "chest", True),
    ("head", (0, 0, 1.51), (0, 0, 1.78), "neck", True),
]
for s, x in (("L", 1), ("R", -1)):
    BONES += [
        (f"upper_arm.{s}", (SH_X * x, 0, SH_Z), (SH_X * x, 0.03, 1.13), "chest", True),
        (f"forearm.{s}", (SH_X * x, 0.03, 1.13), (SH_X * x, 0, 0.84), f"upper_arm.{s}", True),
        (f"hand.{s}", (SH_X * x, 0, 0.84), (SH_X * x, 0, 0.75), f"forearm.{s}", True),
        (f"thigh.{s}", (0.1 * x, 0, 0.93), (0.1 * x, -0.02, 0.51), "hips", True),
        (f"shin.{s}", (0.1 * x, -0.02, 0.51), (0.1 * x, 0, 0.09), f"thigh.{s}", True),
        (f"foot.{s}", (0.1 * x, 0, 0.09), (0.1 * x, -0.14, 0.03), f"shin.{s}", True),
        # IK helpers (not skinned)
        (f"ik_foot.{s}", (0.1 * x, 0, 0.09), (0.1 * x, -0.14, 0.09), "root", False),
        (f"pole_knee.{s}", (0.1 * x, -0.7, 0.5), (0.1 * x, -0.8, 0.5), "root", False),
        (f"pole_elbow.{s}", (0.55 * x, 0.45, 1.05), (0.55 * x, 0.55, 1.05), "chest", False),
    ]

# The rifle is held at low ready across the body: grip by the right hip,
# muzzle pointing forward, down and across to the left.
GRIP = Vector((-0.1, -0.25, 1.08))
RIFLE = Matrix.Translation(GRIP) @ Matrix.Rotation(math.radians(40), 4, "Z") @ Matrix.Rotation(math.radians(12), 4, "X")
def rifle_pt(x, y, z):
    return RIFLE @ Vector((x, y, z))
BONES += [
    ("weapon", tuple(GRIP), tuple(rifle_pt(0, -0.12, 0)), "chest", True),
    ("ik_hand.R", tuple(rifle_pt(0, 0.0, -0.04)), tuple(rifle_pt(0, -0.08, -0.04)), "weapon", False),
    ("ik_hand.L", tuple(rifle_pt(0, -0.2, -0.01)), tuple(rifle_pt(0, -0.28, -0.01)), "weapon", False),
]

arm_data = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, h, t, parent, deform in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = h, t
    eb.use_deform = deform
    if parent:
        eb.parent = arm_data.edit_bones[parent]
for s in "LR":  # knees and elbows stay where IK puts them, feet stay level
    arm_data.edit_bones[f"forearm.{s}"].use_connect = True
    arm_data.edit_bones[f"shin.{s}"].use_connect = True
bpy.ops.object.mode_set(mode="OBJECT")
for s in "LR":
    arm_data.bones[f"foot.{s}"].use_inherit_rotation = False

# ---------------------------------------------------------------- mesh
parts = []

def box(size, loc, material, weights, bevel=0.0, seg=1, taper=None, rot=None, target=None):
    """A bevelled, optionally tapered box. weights is a bone name or f(co)->{bone: w}."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if taper:  # (x, y) scale of the top face
        bm = bmesh.new(); bm.from_mesh(o.data)
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x *= taper[0]; v.co.y *= taper[1]
        bm.to_mesh(o.data); bm.free()
    if bevel:
        mod = o.modifiers.new("b", "BEVEL"); mod.width = bevel; mod.segments = seg
        bpy.ops.object.modifier_apply(modifier="b")
    mw = Matrix.Translation(loc) @ (rot or Matrix())
    o.data.transform(mw)
    o.data.materials.append(M[material])
    for p in o.data.polygons:
        p.use_smooth = False
    for v in o.data.vertices:
        wd = {weights: 1.0} if isinstance(weights, str) else weights(v.co)
        for bone, w in wd.items():
            if w <= 0:
                continue
            g = o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone)
            g.add([v.index], w, "REPLACE")
    (target if target is not None else parts).append(o)
    return o

def blend(lo_bone, hi_bone, z0, z1):
    def f(co):
        t = min(1, max(0, (co.z - z0) / (z1 - z0)))
        return {lo_bone: 1 - t, hi_bone: t}
    return f

torso = blend("spine", "chest", 1.12, 1.32)
pelvis = blend("hips", "spine", 1.0, 1.12)

# Torso: chunky quilted puffer, wider at the chest.
box((0.46, 0.3, 0.2), (0, 0, 0.97), "Cloth", "hips", 0.04, taper=(1.05, 1.05))   # tracksuit hips
box((0.5, 0.35, 0.5), (0, 0, 1.2), "Cloth", torso, 0.09, 3, taper=(1.06, 0.98))
for z in (1.06, 1.2, 1.34):  # quilting seams, almost flush with the jacket
    w = 0.505 if z < 1.3 else 0.48
    box((w, 0.345, 0.018), (0, 0, z), "Dark", torso, 0.008)
box((0.34, 0.06, 0.19), (0, -0.16, 1.02), "Cloth", pelvis, 0.02)                    # jacket hem front
box((0.015, 0.012, 0.42), (0, -0.177, 1.2), "Dark", torso)                          # zip
box((0.32, 0.28, 0.1), (0, 0.01, 1.47), "Cloth", "chest", 0.04)                     # collar
box((0.3, 0.12, 0.13), (0, 0.15, 1.47), "Cloth", "chest", 0.05, 2)                  # hood, bunched
# Backpack
box((0.32, 0.13, 0.36), (0, 0.24, 1.2), "Cloth", "chest", 0.04)
box((0.33, 0.135, 0.03), (0, 0.24, 1.3), "Dark", "chest")
for x in (-0.11, 0.11):
    box((0.04, 0.36, 0.03), (x, 0.0, 1.39), "Dark", "chest")                        # straps over shoulders
    box((0.04, 0.02, 0.28), (x, -0.18, 1.24), "Dark", torso)

# Head: rounded balaclava with an eye slit trimmed in the slot colour.
box((0.08, 0.08, 0.1), (0, 0, 1.5), "Dark", "neck", 0.02)
box((0.25, 0.27, 0.29), (0, -0.005, 1.645), "Dark", "head", 0.095, 3)
box((0.16, 0.03, 0.05), (0, -0.132, 1.668), "Skin", "head", 0.01)
for x in (-0.045, 0.045):
    box((0.035, 0.012, 0.022), (x, -0.146, 1.668), "Dark", "head")
box((0.15, 0.014, 0.008), (0, -0.146, 1.636), "Slot", "head")   # slot-colour stitch under the eye hole

for s, x in (("L", 1), ("R", -1)):
    sx = SH_X * x
    # Arms: puffy sleeves with a slot stripe down the outside.
    box((0.16, 0.18, 0.15), (sx * 0.93, 0, 1.38), "Cloth", "chest", 0.065, 3)        # shoulder
    box((0.15, 0.16, 0.32), (sx, 0.015, 1.27), "Cloth", f"upper_arm.{s}", 0.05, 2, taper=(1.1, 1.1))
    box((0.012, 0.06, 0.3), (sx + 0.077 * x, 0.015, 1.27), "Slot", f"upper_arm.{s}")
    box((0.13, 0.14, 0.29), (sx, 0.015, 0.99), "Cloth", f"forearm.{s}", 0.045, 2, taper=(1.12, 1.12))
    box((0.012, 0.05, 0.25), (sx + 0.067 * x, 0.015, 1.0), "Slot", f"forearm.{s}")
    box((0.13, 0.14, 0.04), (sx, 0.005, 0.86), "Dark", f"forearm.{s}", 0.01)        # cuff
    box((0.09, 0.1, 0.11), (sx, 0, 0.78), "Dark", f"hand.{s}", 0.025)                 # glove
    # Legs: tracksuit bottoms with stripes, chunky trainers.
    lx = 0.1 * x
    box((0.18, 0.19, 0.46), (lx, -0.01, 0.72), "Cloth", f"thigh.{s}", 0.045, 2, taper=(0.92, 0.92))
    box((0.012, 0.05, 0.42), (lx + 0.087 * x, -0.01, 0.73), "Slot", f"thigh.{s}")
    box((0.15, 0.16, 0.44), (lx, -0.01, 0.31), "Cloth", f"shin.{s}", 0.04, 2, taper=(1.12, 1.1))
    box((0.012, 0.045, 0.4), (lx + 0.078 * x, -0.01, 0.31), "Slot", f"shin.{s}")
    box((0.15, 0.16, 0.05), (lx, 0, 0.11), "Cloth", f"shin.{s}", 0.015)              # elasticated cuff
    box((0.13, 0.27, 0.09), (lx, -0.05, 0.075), "Dark", f"foot.{s}", 0.035, 2)
    box((0.14, 0.29, 0.035), (lx, -0.05, 0.018), "Sole", f"foot.{s}", 0.01)
# Holster on the right thigh
box((0.05, 0.12, 0.17), (-0.2, -0.01, 0.78), "Dark", "thigh.R", 0.02)

def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for p in objs:
        p.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = o.data.name = name
    return o

body = join(parts, "Crew")

# Rifle: compact carbine, modelled along -Y with the grip at the origin.
gun = []
def gpart(size, loc, material="Metal", rx=0.0, bevel=0.006):
    r = RIFLE @ Matrix.Translation(loc) @ Matrix.Rotation(math.radians(rx), 4, "X")
    return box(size, Vector(r.translation), material, "weapon", bevel, rot=r.to_3x3().to_4x4(), target=gun)
gpart((0.05, 0.3, 0.075), (0, -0.06, 0.035))            # receiver
gpart((0.056, 0.2, 0.062), (0, -0.27, 0.03), "Dark")     # handguard
gpart((0.022, 0.16, 0.022), (0, -0.44, 0.04))           # barrel
gpart((0.035, 0.035, 0.03), (0, -0.52, 0.04), "Dark")   # muzzle
gpart((0.03, 0.065, 0.15), (0, -0.13, -0.06), rx=-12)   # magazine
gpart((0.035, 0.045, 0.1), (0, 0.0, -0.045), rx=18)     # pistol grip
gpart((0.04, 0.2, 0.06), (0, 0.2, 0.01), "Dark")        # stock
gpart((0.044, 0.04, 0.11), (0, 0.29, -0.01), "Dark")    # butt pad
gpart((0.02, 0.09, 0.03), (0, -0.07, 0.09))             # sight
weapon = join(gun, "Weapon")

for o in (body, weapon):
    o.parent = rig
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

# ---------------------------------------------------------------- IK
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
P = rig.pose.bones
for pb in P:
    pb.rotation_mode = "QUATERNION"
for s in "LR":
    c = P[f"shin.{s}"].constraints.new("IK")
    c.target, c.subtarget = rig, f"ik_foot.{s}"
    c.pole_target, c.pole_subtarget = rig, f"pole_knee.{s}"
    c.pole_angle = math.radians(-90)
    c.chain_count = 2
    c = P[f"forearm.{s}"].constraints.new("IK")
    c.target, c.subtarget = rig, f"ik_hand.{s}"
    c.pole_target, c.pole_subtarget = rig, f"pole_elbow.{s}"
    c.pole_angle = math.radians(-90)
    c.chain_count = 2
    c = P[f"hand.{s}"].constraints.new("COPY_ROTATION")
    c.target, c.subtarget = rig, f"ik_hand.{s}"
    c.influence = 0.6

# ---------------------------------------------------------------- animation helpers
def rest3(pb):
    return pb.bone.matrix_local.to_3x3()

def move(name, x=0, y=0, z=0):
    """Offset a bone by an armature-space vector (bones whose parents stay unrotated)."""
    pb = P[name]
    pb.location = pb.location + rest3(pb).inverted() @ Vector((x, y, z))

def turn(name, axis, deg):
    """Rotate a bone about an armature-space axis (X pitch forward, Z yaw, Y roll)."""
    pb = P[name]
    r = rest3(pb)
    q = Quaternion(r.inverted() @ Vector(axis), math.radians(deg))
    pb.rotation_quaternion = pb.rotation_quaternion @ q

def reset():
    for pb in P:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)

def key_all(frame):
    for pb in P:
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion", frame=frame)

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

def make_action(name, frames, pose):
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    for f in range(frames + 1):  # last frame repeats the first so the loop is seamless
        reset()
        pose((f % frames) / frames)
        key_all(f)
    for fc in getattr(act, "fcurves", []) or []:
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    rig.animation_data.action = None

TAU = 2 * math.pi

def feet(p, stride, lift, stance=0.55, spread=0.0, toe=25):
    """Plant and swing each IK foot target. p is cycle phase 0..1."""
    for s, x, off in (("L", 1, 0.0), ("R", -1, 0.5)):
        q = (p + off) % 1
        if q < stance:   # on the ground, sliding back under the body
            t = q / stance
            y = -stride / 2 + stride * t
            z = 0
            pitch = 0
        else:            # in the air, swinging forward
            t = (q - stance) / (1 - stance)
            e = 0.5 - 0.5 * math.cos(math.pi * t)
            y = stride / 2 - stride * e
            z = lift * math.sin(math.pi * t)
            pitch = -toe * math.sin(math.pi * t) * (1 - t) * 1.5
        move(f"ik_foot.{s}", spread * x, y, z)
        turn(f"foot.{s}", X, pitch)

def look(yaw=0, pitch=0):
    turn("neck", Z, yaw * 0.4); turn("head", Z, yaw * 0.6)
    turn("head", X, pitch)

# ---------------------------------------------------------------- the five cycles
def idle(p):
    b = math.sin(TAU * p)
    move("hips", 0, 0, -0.012 + 0.006 * b)
    turn("spine", X, 2 + 1.2 * b)
    turn("chest", X, 1.5 * b)
    turn("hips", Z, 4)
    move("ik_foot.L", 0.03, -0.08, 0)
    move("ik_foot.R", -0.03, 0.06, 0)
    turn("ik_foot.L", Z, 8); turn("ik_foot.R", Z, -12)
    look(18 * math.sin(TAU * p + 1.0) ** 3, 2 * b)
    turn("weapon", X, 2 * b)

def walk(p):
    s = math.sin(TAU * p)
    move("hips", 0.012 * s, 0, -0.035 - 0.025 * abs(math.cos(TAU * p)))
    turn("hips", Z, 6 * s)
    turn("spine", X, 5)
    turn("chest", Z, -8 * s)
    turn("chest", Y, -2 * s)
    feet(p, 0.56, 0.11)
    look(4 * s, -4)
    turn("weapon", X, 2.5 * math.sin(2 * TAU * p))

def run(p):
    s = math.sin(TAU * p)
    move("hips", 0.015 * s, -0.04, -0.08 + 0.05 * abs(math.sin(TAU * p)))
    turn("hips", Z, 9 * s)
    turn("spine", X, 13)
    turn("chest", X, 4)
    turn("chest", Z, -12 * s)
    feet(p, 0.95, 0.24, stance=0.42, toe=40)
    look(3 * s, -12)
    turn("weapon", X, -6 + 4 * math.sin(2 * TAU * p))

def crouch_idle(p):
    b = math.sin(TAU * p)
    move("hips", 0, 0.04, -0.34 + 0.005 * b)
    turn("spine", X, 22 + 1.5 * b)
    turn("chest", X, 8)
    move("ik_foot.L", 0.05, -0.16, 0)
    move("ik_foot.R", -0.07, 0.14, 0)
    turn("ik_foot.L", Z, 6); turn("ik_foot.R", Z, -10)
    look(14 * math.sin(TAU * p + 0.5), -18)

def crouch_walk(p):
    s = math.sin(TAU * p)
    move("hips", 0.01 * s, 0.03, -0.31 - 0.015 * abs(math.cos(TAU * p)))
    turn("hips", Z, 5 * s)
    turn("spine", X, 24)
    turn("chest", X, 6)
    turn("chest", Z, -6 * s)
    feet(p, 0.42, 0.08, stance=0.6, spread=0.03, toe=18)
    look(5 * s, -18)
    turn("weapon", X, 2 * math.sin(2 * TAU * p))

make_action("Idle", 90, idle)
make_action("Walk", 32, walk)
make_action("Run", 20, run)
make_action("CrouchIdle", 80, crouch_idle)
make_action("CrouchWalk", 44, crouch_walk)
reset()
bpy.ops.object.mode_set(mode="OBJECT")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True,
    export_animation_mode="NLA_TRACKS", export_force_sampling=True,
    export_def_bones=False, export_anim_single_armature=True,
)
tris = sum(len(p.vertices) - 2 for o in (body, weapon) for p in o.data.polygons)
print("tris:", tris, "->", out)
