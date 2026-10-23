"""Rigs and animates a static AI-generated dog mesh and exports glTF.

    python rig_dog.py IN.glb OUT.glb [--yaw DEG] [--height 0.6] [--tris 10000]

The dog should stand on all fours, side-on or three-quarter, facing -Y once
--yaw is applied (glTF +Z). Leg positions are found from the four clusters of
vertices near the floor. Clips: Idle, Walk, Run, Down (once), Bark.
"""
import sys, math, argparse, bpy
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("out")
ap.add_argument("--yaw", type=float, default=0.0)
ap.add_argument("--height", type=float, default=0.6)
ap.add_argument("--tris", type=int, default=10000)
A = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=A.src)
new = [o for o in bpy.data.objects if o not in before]
names = [o.name for o in new]
meshes = [o for o in new if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.object
for n in names:  # joined meshes are already gone, so look up by name
    x = bpy.data.objects.get(n)
    if x is not None and x is not body:
        bpy.data.objects.remove(x)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.name = body.data.name = "Dog"
body.data.transform(Matrix.Rotation(math.radians(A.yaw), 4, "Z"))
vs = [v.co for v in body.data.vertices]
zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
body.data.transform(Matrix.Scale(A.height / (zmax - zmin), 4))
vs = [v.co for v in body.data.vertices]
zmin = min(v.z for v in vs)
cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2
cy = (min(v.y for v in vs) + max(v.y for v in vs)) / 2
body.data.transform(Matrix.Translation((-cx, -cy, -zmin)))
n = sum(len(p.vertices) - 2 for p in body.data.polygons)
if n > A.tris:
    m = body.modifiers.new("d", "DECIMATE"); m.ratio = A.tris / n
    bpy.ops.object.modifier_apply(modifier="d")

V = [v.co.copy() for v in body.data.vertices]
H = A.height
ymin, ymax = min(v.y for v in V), max(v.y for v in V)
L = ymax - ymin  # nose (-Y) to tail (+Y)
# Feet: floor vertices split front/back by the median Y of floor points, left/right by X.
floor = [v for v in V if v.z < 0.12 * H]
my = sorted(v.y for v in floor)[len(floor) // 2]
def foot(front, side):
    pts = [v for v in floor if (v.y < my) == front and (v.x * side > 0)]
    if not pts:
        return Vector((side * 0.08, (ymin + 0.3 * L) if front else (ymax - 0.3 * L), 0.0))
    return sum(pts, Vector()) / len(pts)
F = {(fr, s): foot(fr, x) for fr in (True, False) for s, x in (("L", 1), ("R", -1))}
fy = (F[(True, "L")].y + F[(True, "R")].y) / 2
by = (F[(False, "L")].y + F[(False, "R")].y) / 2
back_z = 0.68 * H

BONES = [
    ("root", (0, 0, 0), (0, 0.2, 0), None, False),
    ("pelvis", (0, by, back_z), (0, (by + fy) / 2 + 0.05, back_z + 0.01), "root", True),
    ("spine", (0, (by + fy) / 2 + 0.05, back_z + 0.01), (0, fy, back_z + 0.03), "pelvis", True),
    ("neck", (0, fy, back_z + 0.03), (0, fy - 0.1 * L, 0.88 * H), "spine", True),
    ("head", (0, fy - 0.1 * L, 0.88 * H), (0, ymin + 0.02, 0.78 * H), "neck", True),
    ("tail", (0, ymax - 0.12 * L, back_z), (0, ymax, back_z + 0.08 * H), "pelvis", True),
]
for (front, s), p in F.items():
    tag = ("front" if front else "back") + "." + s
    top = Vector((p.x * 0.8, p.y, back_z - 0.05 * H))
    knee = Vector((p.x, p.y + (0.03 if front else -0.06), 0.33 * H))
    paw = Vector((p.x, p.y, 0.05 * H))
    BONES += [
        (f"upper_{tag}", tuple(top), tuple(knee), "spine" if front else "pelvis", True),
        (f"lower_{tag}", tuple(knee), tuple(paw), f"upper_{tag}", True),
        (f"paw_{tag}", tuple(paw), tuple(paw + Vector((0, -0.06, -0.04 * H))), f"lower_{tag}", True),
    ]

ad = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", ad)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for name, h, t, parent, deform in BONES:
    eb = ad.edit_bones.new(name)
    eb.head, eb.tail = h, t
    eb.use_deform = deform
    if parent:
        eb.parent = ad.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
try:
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
except RuntimeError as e:
    print("bone heat failed:", e)
    bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
miss = [v for v in body.data.vertices if not any(g.weight > 0.01 for g in v.groups)]
if miss:
    segs = {n: (Vector(h), Vector(t)) for n, h, t, _, d in BONES if d}
    for v in miss:
        best = min(segs, key=lambda n: min((v.co - (segs[n][0] + (segs[n][1] - segs[n][0]) * k / 4)).length for k in range(5)))
        (body.vertex_groups.get(best) or body.vertex_groups.new(name=best)).add([v.index], 1.0, "REPLACE")
print("unweighted after heat:", len(miss))

bpy.ops.object.mode_set(mode="POSE")
P = rig.pose.bones
for pb in P:
    pb.rotation_mode = "QUATERNION"
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
TAU = 2 * math.pi

def turn(name, axis, deg):
    pb = P[name]
    q = Quaternion(pb.bone.matrix_local.to_3x3().inverted() @ Vector(axis), math.radians(deg))
    pb.rotation_quaternion = pb.rotation_quaternion @ q

def move(name, x=0, y=0, z=0):
    pb = P[name]
    pb.location = pb.location + pb.bone.matrix_local.to_3x3().inverted() @ Vector((x, y, z))

def reset():
    for pb in P:
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)

def leg(tag, swing, bend):
    """swing: degrees forward (+) about X; bend: knee flex."""
    turn(f"upper_{tag}", X, -swing)
    front = tag.startswith("front")
    turn(f"lower_{tag}", X, bend if front else -bend)
    turn(f"paw_{tag}", X, -bend * 0.5 if front else bend * 0.5)

def gait(p, amp, lift, phases, bounce=0.0, pitch=0.0):
    move("pelvis", 0, 0, bounce * math.sin(2 * TAU * p))
    turn("spine", X, pitch * math.sin(TAU * p))
    for tag, off in phases.items():
        q = TAU * (p + off)
        swing = amp * math.sin(q)
        bend = lift * max(0, math.cos(q))  # flex while the leg comes forward
        leg(tag, swing, bend)

WALK = {"front.L": 0.0, "back.R": 0.25, "front.R": 0.5, "back.L": 0.75}
GALLOP = {"front.L": 0.0, "front.R": 0.1, "back.L": 0.5, "back.R": 0.6}

def idle(p):
    b = math.sin(TAU * p)
    move("pelvis", 0, 0, 0.004 * b)
    turn("spine", X, 1.2 * b)
    turn("neck", Z, 10 * math.sin(TAU * p + 0.6) ** 3); turn("head", X, 3 * b)
    turn("tail", Z, 25 * math.sin(4 * TAU * p))

def walk(p):
    gait(p, 22, 35, WALK, bounce=0.008)
    turn("neck", X, 3 * math.sin(2 * TAU * p))
    turn("tail", Z, 18 * math.sin(2 * TAU * p))

def run(p):
    gait(p, 42, 55, GALLOP, bounce=0.03, pitch=6)
    turn("neck", X, -8 + 5 * math.sin(TAU * p))
    turn("tail", X, -12)

def down(p):
    t = min(1, p / 0.7); e = t * t * (3 - 2 * t)
    move("pelvis", 0, 0, -(back_z - 0.2 * H) * e)
    turn("pelvis", Y, 80 * e)
    for tag in ("front.L", "front.R", "back.L", "back.R"):
        leg(tag, 20 * e, 30 * e)
    turn("neck", X, 25 * e); turn("tail", X, 20 * e)

def bark(p):
    k = max(0.0, math.sin(TAU * p * 2)) ** 2  # two barks per second
    move("pelvis", 0, 0.02 * k, 0)
    turn("spine", X, -3 * k)
    turn("neck", X, -12 * k); turn("head", X, 10 * k)
    for tag in ("front.L", "front.R"):
        leg(tag, -6, 8)
    turn("tail", X, -20)
    turn("tail", Z, 8 * math.sin(6 * TAU * p))

def make_action(name, frames, pose, loop=True):
    rig.animation_data_create()
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data.action = act
    for f in range(frames + 1):
        reset()
        pose((f % frames) / frames if loop else f / frames)
        for pb in P:
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("rotation_quaternion", frame=f)
    tr = rig.animation_data.nla_tracks.new(); tr.name = name
    tr.strips.new(name, 0, act)
    rig.animation_data.action = None

make_action("Idle", 60, idle)
make_action("Walk", 30, walk)
make_action("Run", 16, run)
make_action("Down", 30, down, loop=False)
make_action("Bark", 30, bark)
reset()
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=A.out, export_format="GLB", use_selection=True,
    export_animation_mode="NLA_TRACKS", export_force_sampling=True,
    export_def_bones=False, export_anim_single_armature=True,
    export_image_format="JPEG", export_jpeg_quality=88,
)
print("tris:", sum(len(p.vertices) - 2 for p in body.data.polygons), "->", A.out)
