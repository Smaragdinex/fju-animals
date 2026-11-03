# 松鼠綁骨架：blender -b -P tools/rig-squirrel.py -- models/raw/eastern-gray-squirrel.glb models/squirrel-rig.glb
# 骨頭位置是照正交側視圖、正視圖量的（glTF 座標：x 右、y 上、z 前），權重用 Blender 自動權重（bone heat）。
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--')+1:]
src, dst = a[0], a[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = [o for o in bpy.data.objects if o.type == 'MESH'][0]
mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0005); bpy.ops.object.mode_set(mode='OBJECT')

G = lambda x, y, z: Vector((x, -z, y))      # glTF (x, y 上, z 前) → Blender
bones = {}  # name: (head, tail, parent)
def B(name, h, t, parent=None): bones[name] = (G(*h), G(*t), parent)
B('hips', (0, -0.48, -0.2), (0, -0.42, -0.1))
B('spine1', (0, -0.42, -0.1), (0, -0.2, 0.06), 'hips')
B('spine2', (0, -0.2, 0.06), (0, 0.0, 0.26), 'spine1')
B('neck', (0, 0.0, 0.26), (0, 0.07, 0.48), 'spine2')
B('head', (0, 0.07, 0.48), (0, -0.02, 0.92), 'neck')
for s, n in ((1, 'L'), (-1, 'R')):
    B('upperarm.' + n, (s * 0.17, -0.04, 0.3), (s * 0.13, -0.32, 0.33), 'spine2')
    B('forearm.' + n, (s * 0.13, -0.32, 0.33), (s * 0.1, -0.28, 0.66), 'upperarm.' + n)
    B('hand.' + n, (s * 0.1, -0.28, 0.66), (s * 0.09, -0.33, 0.85), 'forearm.' + n)
    B('thigh.' + n, (s * 0.2, -0.38, -0.08), (s * 0.24, -0.46, 0.22), 'hips')
    B('shin.' + n, (s * 0.24, -0.46, 0.22), (s * 0.27, -0.71, 0.06), 'thigh.' + n)
    B('foot.' + n, (s * 0.27, -0.71, 0.06), (s * 0.3, -0.77, 0.38), 'shin.' + n)
T = [(0, -0.45, -0.3), (0, -0.3, -0.48), (0, -0.08, -0.6), (0, 0.15, -0.64), (0, 0.38, -0.6), (0, 0.55, -0.45), (0, 0.62, -0.22), (0, 0.62, 0.0), (0, 0.6, 0.15)]
for i in range(len(T) - 1):
    B(f'tail{i}', T[i], T[i + 1], 'hips' if i == 0 else f'tail{i-1}')

arm = bpy.data.armatures.new('rig'); ao = bpy.data.objects.new('squirrel_rig', arm)
bpy.context.scene.collection.objects.link(ao)
bpy.context.view_layer.objects.active = ao
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for name, (h, t, p) in bones.items():
    b = arm.edit_bones.new(name); b.head = h; b.tail = t; eb[name] = b
for name, (h, t, p) in bones.items():
    if p:
        eb[name].parent = eb[p]
        eb[name].use_connect = (eb[p].tail - h).length < 1e-4
bpy.ops.object.mode_set(mode='OBJECT')
# 自動權重（bone heat）
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True); ao.select_set(True); bpy.context.view_layer.objects.active = ao
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
vg = {g.index: g.name for g in ob.vertex_groups}
empty = sum(1 for v in ob.data.vertices if not any(g.weight > 0.01 for g in v.groups))
print('RESULT groups', len(vg), 'unweighted verts', empty, 'of', len(ob.data.vertices))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85,
    export_skins=True, export_animations=False, export_apply=False, use_selection=True)
