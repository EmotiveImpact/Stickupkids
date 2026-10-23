import bpy, sys, math
from mathutils import Vector
src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc=bpy.context.scene; sc.render.engine='BLENDER_WORKBENCH'
sc.display.shading.color_type='VERTEX'; sc.display.shading.light='STUDIO'
sc.render.resolution_x=500; sc.render.resolution_y=700
sc.world = bpy.data.worlds.new('w'); sc.display.shading.background_type='VIEWPORT'
cam=bpy.data.objects.new('c',bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=2.3
a=math.radians(30); cam.location=Vector((math.sin(a)*6,-math.cos(a)*6,1.6)); 
cam.rotation_euler=(Vector((0,0,0.95))-cam.location).to_track_quat('-Z','Y').to_euler()
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
arm.animation_data_create()
for act in bpy.data.actions:
    arm.animation_data.action=act
    try: arm.animation_data.action_slot = act.slots[0]
    except Exception: pass
    f0,f1=act.frame_range; sc.frame_set(int(f0+(f1-f0)*0.4))
    sc.render.filepath=f'{out}_{act.name}.png'; bpy.ops.render.render(write_still=True)
