"""Rigs and animates a static AI-generated humanoid mesh and exports glTF.

    python rig_humanoid.py IN.glb OUT.glb --role crew|dealer|soldier|runner
                           [--weapon rifle.glb|pistol.glb] [--yaw DEG] [--tris 14000]

The input is any single-character mesh standing in an A- or T-pose (for
example TRELLIS output). The script:
  1. joins and cleans the mesh, turns it to face Blender -Y (glTF +Z),
     scales it to 1.8 m and puts the origin between the feet;
  2. finds shoulders, hands, hips and feet from the vertex cloud and fits the
     shared Stickupkids skeleton (same bone names as art/crew/make_crew.py);
  3. skins it with Blender's bone-heat weights, falling back to distance
     weights for anything heat misses;
  4. animates every clip through IK targets, so poses do not depend on how
     the arms happened to sit in the source image;
  5. optionally attaches a weapon mesh (named Weapon) to the weapon bone.

Clips (in place, looped unless noted): Idle, Walk, Run, CrouchIdle,
CrouchWalk, Aim, Shoot, Kick (once), HandsUp, Down (once), Sit.
"""
import sys, math, argparse, bpy, bmesh
from mathutils import Vector, Matrix, Quaternion
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("out")
ap.add_argument("--role", default="crew")
ap.add_argument("--weapon")
ap.add_argument("--yaw", type=float, default=0.0)
ap.add_argument("--height", type=float, default=1.8)
ap.add_argument("--tris", type=int, default=14000)
ap.add_argument("--slot", help="hex hue of the slot trim to split into a Slot material, e.g. 22E3FF")
A = ap.parse_args(argv)
ARMED = A.role in ("crew", "soldier") or bool(A.weapon)
PISTOL = A.role == "soldier"

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ---------------------------------------------------------------- import and normalise
def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
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
    o = bpy.context.object
    for n in names:  # joined meshes are already gone, so look up by name
        x = bpy.data.objects.get(n)
        if x is not None and x is not o:
            bpy.data.objects.remove(x)
    for m in list(o.modifiers):
        o.modifiers.remove(m)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o

def normalise(o, height, yaw=0.0, base=True):
    o.data.transform(Matrix.Rotation(math.radians(yaw), 4, "Z"))
    vs = [v.co for v in o.data.vertices]
    zmin = min(v.z for v in vs); zmax = max(v.z for v in vs)
    s = height / (zmax - zmin)
    o.data.transform(Matrix.Scale(s, 4))
    vs = [v.co for v in o.data.vertices]
    zmin = min(v.z for v in vs)
    low = [v for v in vs if v.z < zmin + 0.12 * height] if base else vs
    cx = sum(v.x for v in low) / len(low); cy = sum(v.y for v in low) / len(low)
    o.data.transform(Matrix.Translation((-cx, -cy, -zmin)))
    o.data.update()

def decimate(o, tris):
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n > tris:
        m = o.modifiers.new("d", "DECIMATE"); m.ratio = tris / n
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="d")

body = import_glb(A.src)
body.name = body.data.name = "Body"
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.object.mode_set(mode="OBJECT")
normalise(body, A.height, A.yaw)
decimate(body, A.tris)
H = A.height

# ---------------------------------------------------------------- slot trim split
if A.slot:
    # Faces whose texture colour is close to the slot hue move to a Slot
    # material (plain white, so the game can tint it per crew member).
    import colorsys
    mat = body.data.materials[0]
    img = next((n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"), None)
    if img:
        W, Hh = img.size
        px = list(img.pixels)
        th = colorsys.rgb_to_hsv(*[int(A.slot[i:i + 2], 16) / 255 for i in (0, 2, 4)])[0]
        slot = bpy.data.materials.new("Slot"); slot.use_nodes = True
        b = slot.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (1, 1, 1, 1)
        b.inputs["Emission Color"].default_value = (1, 1, 1, 1)
        b.inputs["Emission Strength"].default_value = 0.25
        b.inputs["Roughness"].default_value = 0.5
        body.data.materials.append(slot)
        idx = len(body.data.materials) - 1
        uv = body.data.uv_layers.active.data
        hits = 0
        for p in body.data.polygons:
            u = sum(uv[l].uv.x for l in p.loop_indices) / p.loop_total
            v = sum(uv[l].uv.y for l in p.loop_indices) / p.loop_total
            i = (int(min(max(v, 0), 0.9999) * Hh) * W + int(min(max(u, 0), 0.9999) * W)) * 4
            h, s_, val = colorsys.rgb_to_hsv(px[i], px[i + 1], px[i + 2])
            if s_ > 0.45 and val > 0.35 and min(abs(h - th), 1 - abs(h - th)) < 0.06:
                p.material_index = idx; hits += 1
        print("slot faces:", hits)
    elif body.data.color_attributes:
        # vertex-coloured meshes (TripoSR): same test on each face's corner colours,
        # and the slot faces are painted white so the game's tint shows true
        ca = body.data.color_attributes.active_color or body.data.color_attributes[0]
        if ca.domain != "CORNER":
            bpy.context.view_layer.objects.active = body
            body.data.color_attributes.active_color = ca
            bpy.ops.geometry.color_attribute_convert(domain="CORNER", data_type="BYTE_COLOR")
            ca = body.data.color_attributes.active_color
        th = colorsys.rgb_to_hsv(*[int(A.slot[i:i + 2], 16) / 255 for i in (0, 2, 4)])[0]
        mat.name = "Cloth"
        slot = mat.copy(); slot.name = "Slot"
        body.data.materials.append(slot)
        idx = len(body.data.materials) - 1
        hits = 0
        for p in body.data.polygons:
            c = [sum(ca.data[l].color[k] for l in p.loop_indices) / p.loop_total for k in range(3)]
            h, s_, val = colorsys.rgb_to_hsv(*c)
            if s_ > 0.35 and val > 0.2 and min(abs(h - th), 1 - abs(h - th)) < 0.07:
                p.material_index = idx; hits += 1
                for l in p.loop_indices:
                    ca.data[l].color = (0.9, 0.9, 0.9, 1)
        print("slot faces (vertex colour):", hits)

# ---------------------------------------------------------------- landmarks
V = [v.co.copy() for v in body.data.vertices]
def band(z0, z1):
    return [v for v in V if z0 * H <= v.z <= z1 * H]

def torso_half_width(z):
    """Half width of the torso at height z, ignoring arms (largest central gap-free run)."""
    xs = sorted(v.x for v in band(z - 0.015, z + 0.015))
    if not xs:
        return 0.15 * H
    # walk outwards from the centre until a gap of >3 cm (arm/torso split)
    left = [x for x in xs if x <= 0][::-1]; right = [x for x in xs if x >= 0]
    def reach(seq, sign):
        last = 0.0
        for x in seq:
            if abs(x - last) > 0.03:
                break
            last = x
        return abs(last)
    return max(reach(right, 1), reach(left, -1))

hip_z = 0.53 * H
chest_w = torso_half_width(0.70)
sh_z = 0.81 * H
sh_x = max(0.75 * chest_w, 0.09 * H)

def arm_end(side):
    """Hand: the vertex furthest from the shoulder among points clearly outside the torso."""
    sh = Vector((side * sh_x, 0, sh_z))
    cand = [v for v in V if side * v.x > sh_x + 0.04 and 0.3 * H < v.z < 0.86 * H]
    if not cand:
        return sh + Vector((side * 0.05, 0, -0.55))
    far = max(cand, key=lambda v: (v - sh).length)
    # average the tip so one stray vertex does not decide it
    tip = [v for v in cand if (v - far).length < 0.06]
    return sum(tip, Vector()) / len(tip)

def leg_x(side):
    low = [v for v in V if v.z < 0.25 * H and side * v.x > 0.01]
    return side * (sum(abs(v.x) for v in low) / len(low)) if low else side * 0.1

hand = {s: arm_end(x) for s, x in (("L", 1), ("R", -1))}
leg = {s: leg_x(x) for s, x in (("L", 1), ("R", -1))}
print("landmarks: shoulder x %.3f, hands L %s R %s" % (sh_x, tuple(round(c, 2) for c in hand["L"]), tuple(round(c, 2) for c in hand["R"])))

# ---------------------------------------------------------------- skeleton
def lerp(a, b, t):
    return a + (b - a) * t

BONES = [
    ("root", (0, 0, 0), (0, 0.25, 0), None, False),
    ("hips", (0, 0, hip_z), (0, 0, 0.58 * H), "root", True),
    ("spine", (0, 0, 0.58 * H), (0, 0, 0.68 * H), "hips", True),
    ("chest", (0, 0, 0.68 * H), (0, 0, 0.79 * H), "spine", True),
    ("neck", (0, 0, 0.79 * H), (0, 0, 0.84 * H), "chest", True),
    ("head", (0, 0, 0.84 * H), (0, 0, 0.99 * H), "neck", True),
]
for s, x in (("L", 1), ("R", -1)):
    sh = Vector((x * sh_x, 0, sh_z))
    hd = hand[s]
    wrist = lerp(sh, hd, 0.86)
    elbow = lerp(sh, wrist, 0.5) + Vector((0, 0.025, 0))
    lx = leg[s]
    BONES += [
        (f"clavicle.{s}", (x * 0.02, -0.01, 0.78 * H), tuple(sh), "chest", True),
        (f"upper_arm.{s}", tuple(sh), tuple(elbow), f"clavicle.{s}", True),
        (f"forearm.{s}", tuple(elbow), tuple(wrist), f"upper_arm.{s}", True),
        (f"hand.{s}", tuple(wrist), tuple(hd), f"forearm.{s}", True),
        (f"thigh.{s}", (lx, 0, 0.52 * H), (lx, -0.012 * H, 0.285 * H), "hips", True),
        (f"shin.{s}", (lx, -0.012 * H, 0.285 * H), (lx, 0, 0.05 * H), f"thigh.{s}", True),
        (f"foot.{s}", (lx, 0, 0.05 * H), (lx, -0.08 * H, 0.015 * H), f"shin.{s}", True),
        (f"ik_foot.{s}", (lx, 0, 0.05 * H), (lx, -0.08 * H, 0.05 * H), "root", False),
        (f"pole_knee.{s}", (lx, -0.7, 0.28 * H), (lx, -0.8, 0.28 * H), "root", False),
        (f"ik_hand.{s}", tuple(wrist), tuple(wrist + Vector((0, -0.08, 0))), "root", False),
        (f"pole_elbow.{s}", (x * 0.6, 0.5, 0.6 * H), (x * 0.6, 0.6, 0.6 * H), "root", False),
    ]
BONES.append(("weapon", (-0.1, -0.25, 0.6 * H), (-0.1, -0.37, 0.6 * H), "chest", True))

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
for s in "LR":
    for b in ("forearm", "hand", "shin", "foot"):
        arm_data.edit_bones[f"{b}.{s}"].use_connect = True
    arm_data.edit_bones[f"upper_arm.{s}"].use_connect = True
bpy.ops.object.mode_set(mode="OBJECT")
for s in "LR":
    arm_data.bones[f"foot.{s}"].use_inherit_rotation = False

# ---------------------------------------------------------------- skinning
DEFORM = [b[0] for b in BONES if b[4] and b[0] != "weapon"]

def distance_weights(o):
    """Fallback skin: inverse-distance to bone segments, best three bones."""
    segs = {n: (Vector(h), Vector(t)) for n, h, t, _, d in BONES if n in DEFORM}
    groups = {n: (o.vertex_groups.get(n) or o.vertex_groups.new(name=n)) for n in segs}
    for v in o.data.vertices:
        if any(g.weight > 0.01 for g in v.groups):
            continue
        ds = []
        for n, (a, b) in segs.items():
            ab = b - a
            t = max(0, min(1, (v.co - a).dot(ab) / ab.length_squared))
            ds.append(((v.co - (a + ab * t)).length + 1e-4, n))
        ds.sort()
        ws = [(1 / d ** 4, n) for d, n in ds[:3]]
        tot = sum(w for w, _ in ws)
        for w, n in ws:
            groups[n].add([v.index], w / tot, "REPLACE")

bpy.ops.object.select_all(action="DESELECT")
for b in arm_data.bones:
    b.use_deform = b.name in DEFORM
body.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
try:
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
except RuntimeError as e:
    print("bone heat failed:", e)
    body.parent = rig
    body.modifiers.new("Armature", "ARMATURE").object = rig
unweighted = sum(1 for v in body.data.vertices if not any(g.weight > 0.01 for g in v.groups))
print("unweighted after heat:", unweighted, "of", len(body.data.vertices))
if unweighted:
    distance_weights(body)
arm_data.bones["weapon"].use_deform = True

# ---------------------------------------------------------------- weapon
weapon = None
if A.weapon:
    weapon = import_glb(A.weapon)
    weapon.name = weapon.data.name = "Weapon"
    # Long axis to -Y, grip at the origin. Source props are normalised so
    # their longest horizontal side runs along Y.
    vs = [v.co for v in weapon.data.vertices]
    ext = Vector([max(v[i] for v in vs) - min(v[i] for v in vs) for i in range(3)])
    if ext.x > ext.y:
        weapon.data.transform(Matrix.Rotation(math.radians(90), 4, "Z"))
    length = 0.36 if PISTOL else 0.8
    vs = [v.co for v in weapon.data.vertices]
    ext = Vector([max(v[i] for v in vs) - min(v[i] for v in vs) for i in range(3)])
    weapon.data.transform(Matrix.Scale(length / ext.y, 4))
    vs = [v.co for v in weapon.data.vertices]
    c = Vector([(max(v[i] for v in vs) + min(v[i] for v in vs)) / 2 for i in range(3)])
    grip = Vector((c.x, c.y + (0.0 if PISTOL else 0.12), c.z))
    # grip sits on the weapon bone's head; skinned rigidly to that bone
    weapon.data.transform(Matrix.Translation(arm_data.bones["weapon"].head_local - grip))
    decimate(weapon, 3000)
    g = weapon.vertex_groups.new(name="weapon")
    g.add([v.index for v in weapon.data.vertices], 1.0, "REPLACE")
    weapon.parent = rig
    weapon.modifiers.new("Armature", "ARMATURE").object = rig

# ---------------------------------------------------------------- IK
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
P = rig.pose.bones
for pb in P:
    pb.rotation_mode = "QUATERNION"
for s in "LR":
    for chain, tgt, pole in (("shin", "ik_foot", "pole_knee"), ("forearm", "ik_hand", "pole_elbow")):
        c = P[f"{chain}.{s}"].constraints.new("IK")
        c.target, c.subtarget = rig, f"{tgt}.{s}"
        c.pole_target, c.pole_subtarget = rig, f"{pole}.{s}"
        c.pole_angle = math.radians(-90)
        c.chain_count = 2
    c = P[f"hand.{s}"].constraints.new("COPY_ROTATION")
    c.target, c.subtarget = rig, f"ik_hand.{s}"

# ---------------------------------------------------------------- animation helpers
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
TAU = 2 * math.pi

def rest(pb):
    return pb.bone.matrix_local

def move(name, x=0, y=0, z=0):
    pb = P[name]
    pb.location = pb.location + rest(pb).to_3x3().inverted() @ Vector((x, y, z))

def turn(name, axis, deg):
    pb = P[name]
    q = Quaternion(rest(pb).to_3x3().inverted() @ Vector(axis), math.radians(deg))
    pb.rotation_quaternion = pb.rotation_quaternion @ q

def place(name, pos, look=None):
    """Put a root-parented target at an armature-space position, optionally aiming its Y axis."""
    pb = P[name]
    m = Matrix.Translation(pos)
    if look is not None:
        m = m @ Vector(look).to_track_quat("-Y", "Z").to_matrix().to_4x4()
    pb.matrix = m

def reset():
    for pb in P:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)

def update():
    bpy.context.view_layer.update()

def key_all(frame):
    for pb in P:
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion", frame=frame)

SHO = {s: Vector((x * sh_x, 0, sh_z)) for s, x in (("L", 1), ("R", -1))}
ARM = (SHO["L"] - hand["L"]).length  # shoulder to hand tip

def chest_point(local):
    """A point given in the chest's frame (armature axes, origin at chest head), posed."""
    m = rig.pose.bones["chest"].matrix
    return m @ (rest(P["chest"]).inverted() @ (rest(P["chest"]).to_translation() + Vector(local)))

def hold_weapon(offset=(0, 0, 0), pitch=0.0, aim=False):
    """Pose the weapon bone in the chest frame and put both hands on it."""
    if not ARMED:
        return
    if PISTOL:
        grip = Vector((-0.04, -0.42 if aim else -0.3, (0.07 if aim else -0.05) * H)) + Vector(offset)
        yaw = 0 if aim else -15
    else:
        grip = Vector((-0.11, -0.22, -0.06 * H)) + Vector(offset)
        if aim:
            grip = Vector((-0.12, -0.2, 0.065 * H)) + Vector(offset)
        yaw = 0 if aim else 40
    pitch = pitch if aim else pitch - 12
    pb = P["weapon"]
    target = chest_point(grip)
    rot = (rig.pose.bones["chest"].matrix.to_3x3()
           @ Matrix.Rotation(math.radians(yaw), 3, "Z") @ Matrix.Rotation(math.radians(pitch), 3, "X"))
    pb.matrix = Matrix.Translation(target) @ rot.to_4x4() @ rest(pb).to_3x3().to_4x4()
    update()
    wm = pb.matrix @ Matrix.Translation((0, 0, 0))
    fwd = (wm.to_3x3() @ (rest(pb).to_3x3().inverted() @ Vector((0, -1, 0)))).normalized()
    head = wm.to_translation()
    place("ik_hand.R", head + Vector((0, 0, -0.03)), fwd)
    support = 0.08 if PISTOL else 0.26
    place("ik_hand.L", head + fwd * support + Vector((0, 0, -0.02)), fwd)

def arms_free(swing=0.0, out=0.12, drop=0.95, fwd=0.0):
    """Unarmed arms hanging by the sides, swinging fore and aft."""
    for s, x, sg in (("L", 1, 1), ("R", -1, -1)):
        sh = chest_point(SHO[s] - rest(P["chest"]).to_translation())
        a = math.radians(swing * sg)
        d = Vector((x * out, -math.sin(a) + fwd, -math.cos(a) * drop)).normalized()
        place(f"ik_hand.{s}", sh + d * ARM * 0.92, (0, -1, -0.4))

def feet(p, stride, lift, stance=0.55, spread=0.0, toe=25):
    for s, off in (("L", 0.0), ("R", 0.5)):
        q = (p + off) % 1
        if q < stance:
            t = q / stance; y = -stride / 2 + stride * t; z = 0; pitch = 0
        else:
            t = (q - stance) / (1 - stance)
            e = 0.5 - 0.5 * math.cos(math.pi * t)
            y = stride / 2 - stride * e; z = lift * math.sin(math.pi * t)
            pitch = -toe * math.sin(math.pi * t) * (1 - t) * 1.5
        move(f"ik_foot.{s}", spread * (1 if s == "L" else -1), y, z)
        turn(f"foot.{s}", X, pitch)

def look(yaw=0, pitch=0):
    turn("neck", Z, yaw * 0.4); turn("head", Z, yaw * 0.6); turn("head", X, pitch)

def make_action(name, frames, pose, loop=True):
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    for f in range(frames + 1):
        reset()
        p = (f % frames) / frames if loop else f / frames
        pose(p)          # body, legs, head
        update()
        pose.arms(p)     # hands placed against the posed chest
        key_all(f)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    rig.animation_data.action = None

def clip(arms):
    def wrap(f):
        f.arms = arms
        return f
    return wrap

def carry(swing_amp=0.0, aim=False, pitch=0.0, bob=0.0):
    def arms(p):
        if ARMED:
            hold_weapon(pitch=pitch + bob * math.sin(2 * TAU * p), aim=aim)
        else:
            arms_free(swing_amp * math.sin(TAU * p))
    return arms

# ---------------------------------------------------------------- clips
@clip(carry(4, bob=2))
def idle(p):
    b = math.sin(TAU * p)
    move("hips", 0, 0, -0.012 + 0.006 * b)
    turn("spine", X, 2 + 1.2 * b); turn("chest", X, 1.5 * b); turn("hips", Z, 4)
    move("ik_foot.L", 0.03, -0.06, 0); move("ik_foot.R", -0.03, 0.05, 0)
    turn("ik_foot.L", Z, 8); turn("ik_foot.R", Z, -12)
    look(18 * math.sin(TAU * p + 1.0) ** 3, 2 * b)

@clip(carry(22, bob=2.5))
def walk(p):
    s = math.sin(TAU * p)
    move("hips", 0.012 * s, 0, -0.035 - 0.025 * abs(math.cos(TAU * p)))
    turn("hips", Z, 6 * s); turn("spine", X, 5); turn("chest", Z, -8 * s)
    feet(p, 0.56, 0.11)
    look(4 * s, -4)

@clip(carry(45, pitch=-8, bob=4))
def run(p):
    s = math.sin(TAU * p)
    move("hips", 0.015 * s, -0.04, -0.08 + 0.05 * abs(math.sin(TAU * p)))
    turn("hips", Z, 9 * s); turn("spine", X, 13); turn("chest", X, 4); turn("chest", Z, -12 * s)
    feet(p, 0.95, 0.24, stance=0.42, toe=40)
    look(3 * s, -12)

@clip(carry(3))
def crouch_idle(p):
    b = math.sin(TAU * p)
    move("hips", 0, 0.04, -0.34 + 0.005 * b)
    turn("spine", X, 22 + 1.5 * b); turn("chest", X, 8)
    move("ik_foot.L", 0.05, -0.16, 0); move("ik_foot.R", -0.07, 0.14, 0)
    look(14 * math.sin(TAU * p + 0.5), -18)

@clip(carry(12, bob=2))
def crouch_walk(p):
    s = math.sin(TAU * p)
    move("hips", 0.01 * s, 0.03, -0.31 - 0.015 * abs(math.cos(TAU * p)))
    turn("hips", Z, 5 * s); turn("spine", X, 24); turn("chest", X, 6); turn("chest", Z, -6 * s)
    feet(p, 0.42, 0.08, stance=0.6, spread=0.03, toe=18)
    look(5 * s, -18)

def stance_aim(p, sway=1.0):
    b = math.sin(TAU * p)
    move("hips", 0, 0.02, -0.04)
    turn("hips", Z, 8); turn("chest", Z, -8 + 0.6 * b * sway); turn("spine", X, 4)
    move("ik_foot.L", 0.04, -0.12, 0); move("ik_foot.R", -0.05, 0.12, 0)
    turn("ik_foot.L", Z, 10); turn("ik_foot.R", Z, -20)
    look(0, 2)

def aim_arms(kick=0.0):
    def arms(p):
        if ARMED:
            hold_weapon(offset=(0, kick, 0), pitch=kick * 60, aim=True)
        else:
            arms_free(0, out=0.25, drop=0.6, fwd=0.7)
    return arms

@clip(aim_arms())
def aim(p):
    stance_aim(p)

shot = lambda p: max(0.0, 1 - p * 5) ** 2  # sharp recoil, quick settle
@clip(lambda p: aim_arms(0.05 * shot(p))(p))
def shoot(p):
    stance_aim(p, 0)
    turn("chest", X, -3 * shot(p))

@clip(carry(0, pitch=-10))
def kick(p):
    # door kick: chamber, strike, recover over 24 frames
    k = math.sin(math.pi * min(1, p / 0.7)) if p < 0.7 else 0
    strike = math.sin(math.pi * min(1, max(0, (p - 0.2) / 0.35)))
    move("hips", 0, 0.06 * k, -0.02 * k)
    turn("spine", X, -10 * k); turn("hips", X, -6 * k)
    move("ik_foot.L", 0.02, -0.04, 0)
    move("ik_foot.R", 0, -0.55 * strike, 0.45 * k)
    turn("foot.R", X, 20 * strike)
    look(0, 6 * k)

@clip(lambda p: hands_up_arms(p))
def hands_up(p):
    b = math.sin(TAU * p)
    move("hips", 0, 0.02, -0.02 + 0.004 * b)
    turn("spine", X, -3); turn("chest", X, -2 + b)
    move("ik_foot.L", 0.04, 0, 0); move("ik_foot.R", -0.04, 0, 0)
    look(10 * math.sin(TAU * p), 4)

def hands_up_arms(p):
    b = 0.015 * math.sin(TAU * p * 2)
    for s, x in (("L", 1), ("R", -1)):
        sh = chest_point(SHO[s] - rest(P["chest"]).to_translation())
        place(f"ik_hand.{s}", sh + Vector((x * 0.22, -0.08, 0.5 + b)), (0, 0, 1))
    if ARMED:  # weapon dropped to the floor in front
        pb = P["weapon"]
        pb.matrix = Matrix.Translation((0.05, -0.45, 0.04)) @ Matrix.Rotation(math.radians(90), 4, "Z") @ rest(pb).to_3x3().to_4x4()

@clip(lambda p: down_arms(p))
def down(p):
    # collapse backwards over 36 frames and stay down
    t = min(1, p / 0.75); e = t * t * (3 - 2 * t)
    knee = math.sin(math.pi * min(1, t * 1.6)) if t < 0.62 else 0
    move("hips", 0, 0.35 * e, -0.38 * knee - (0.86 * H * 0.53 - 0.12) * e * (1 if t > 0.4 else t / 0.4))
    turn("hips", X, -88 * e)
    turn("spine", X, 6 * e); turn("chest", X, 4 * e)
    move("ik_foot.L", 0.12 * e, -0.15 * e, 0); move("ik_foot.R", -0.15 * e, -0.05 * e, 0)
    look(25 * e, -10 * e)

def down_arms(p):
    t = min(1, p / 0.75)
    for s, x in (("L", 1), ("R", -1)):
        sh = chest_point(SHO[s] - rest(P["chest"]).to_translation())
        d = Vector((x * (0.3 + 0.6 * t), 0.2 * t, -1 + t)).normalized()
        place(f"ik_hand.{s}", sh + d * ARM * 0.9, (0, -1, 0))
    if ARMED:
        pb = P["weapon"]
        pb.matrix = Matrix.Translation((-0.4 * t, 0.2 * t - 0.3, 0.6 * H * (1 - t) + 0.04)) @ Matrix.Rotation(math.radians(70 * t), 4, "Z") @ rest(pb).to_3x3().to_4x4()

SEAT = 0.46

@clip(lambda p: sit_arms(p))
def sit(p):
    b = math.sin(TAU * p)
    drop = hip_z - SEAT - 0.08
    move("hips", 0, 0.12, -drop)
    turn("hips", X, -8); turn("spine", X, -6 + 1.2 * b); turn("chest", X, 8)
    move("ik_foot.L", 0.08, -0.42, 0); move("ik_foot.R", -0.12, -0.38, 0)
    turn("ik_foot.R", Z, -15)
    look(20 * math.sin(TAU * p + 0.7), -4)

def sit_arms(p):
    for s, x in (("L", 1), ("R", -1)):
        sh = chest_point(SHO[s] - rest(P["chest"]).to_translation())
        place(f"ik_hand.{s}", sh + Vector((x * 0.32, -0.18, -0.38)), (0, -1, -0.5))
    if ARMED:
        pb = P["weapon"]
        pb.matrix = Matrix.Translation((-0.28, -0.25, SEAT + 0.02)) @ rest(pb).to_3x3().to_4x4()

make_action("Idle", 90, idle)
make_action("Walk", 32, walk)
make_action("Run", 20, run)
make_action("CrouchIdle", 80, crouch_idle)
make_action("CrouchWalk", 44, crouch_walk)
make_action("Aim", 60, aim)
make_action("Shoot", 8, shoot)
make_action("Kick", 24, kick, loop=False)
make_action("HandsUp", 60, hands_up)
make_action("Down", 40, down, loop=False)
make_action("Sit", 90, sit)
reset()
bpy.ops.object.mode_set(mode="OBJECT")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=A.out, export_format="GLB", use_selection=True,
    export_animation_mode="NLA_TRACKS", export_force_sampling=True,
    export_def_bones=False, export_anim_single_armature=True,
    export_image_format="JPEG", export_jpeg_quality=88,
)
tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
print("tris:", tris, "->", A.out)
