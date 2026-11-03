# 烏龜綁骨架：blender -b -P tools/rig-turtle.py -- 減面後.glb 輸出-rig.glb pond|slider（輸入先用 tools/shrink-model.py 從 models/raw 產生）
# 骨頭位置照正交俯視、側視圖量（glTF 座標：頭朝 -x、y 上）。
# 掃描網格不封閉，Blender 自動權重會失敗，所以權重自己算：依點到各骨頭線段的距離（1/d^4，取最近 3 根）。
# 殼是硬的：殼範圍內的點只跟 shell 走，殼邊緣一圈漸變，腳根才不會撕裂。
import bpy, sys
from mathutils import Vector
a = sys.argv[sys.argv.index('--')+1:]
src, dst, kind = a[0], a[1], a[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = [o for o in bpy.data.objects if o.type == 'MESH'][0]
mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
G = lambda x, y, z: Vector((x, -z, y))
if kind == 'pond':
    shell_c, shell_r = (0.35, 0.0), (3.6, 2.25)
    J = {
        'neck0': ((-2.6, 0.0, 0.05), (-4.0, 0.3, 0.15)), 'neck1': ((-4.0, 0.3, 0.15), (-5.2, 0.2, 0.25)), 'head': ((-5.2, 0.2, 0.25), (-6.6, -0.1, 0.3)),
        'fl0': ((-2.0, -0.5, -1.4), (-2.0, -1.0, -2.7)), 'fl1': ((-2.0, -1.0, -2.7), (-1.9, -1.7, -3.7)),
        'fr0': ((-2.0, -0.5, 1.4), (-2.0, -1.0, 2.6)), 'fr1': ((-2.0, -1.0, 2.6), (-1.9, -1.7, 3.4)),
        'hl0': ((2.5, -0.5, -1.4), (3.0, -1.0, -2.3)), 'hl1': ((3.0, -1.0, -2.3), (3.6, -1.6, -3.0)),
        'hr0': ((2.4, -0.5, 1.4), (2.4, -1.0, 2.5)), 'hr1': ((2.4, -1.0, 2.5), (2.3, -1.6, 3.4)),
        'tail': ((3.6, -0.3, 0.1), (4.9, -0.6, 0.1)),
    }
else:
    shell_c, shell_r = (0.5, 0.0), (3.5, 2.85)
    J = {
        'neck0': ((-2.4, 0.1, 0.0), (-4.0, 0.35, 0.05)), 'neck1': ((-4.0, 0.35, 0.05), (-5.2, 0.6, 0.1)), 'head': ((-5.2, 0.6, 0.1), (-6.6, 0.8, 0.1)),
        'fl0': ((-2.4, -0.3, -1.6), (-2.9, -0.5, -2.4)), 'fl1': ((-2.9, -0.5, -2.4), (-3.5, -0.7, -3.2)),
        'fr0': ((-2.3, -0.3, 1.6), (-2.7, -0.5, 2.4)), 'fr1': ((-2.7, -0.5, 2.4), (-3.0, -0.7, 3.2)),
        'hl0': ((2.4, -0.3, -1.8), (3.3, -0.4, -2.7)), 'hl1': ((3.3, -0.4, -2.7), (4.3, -0.6, -3.8)),
        'hr0': ((2.4, -0.3, 1.8), (3.2, -0.4, 2.7)), 'hr1': ((3.2, -0.4, 2.7), (4.0, -0.6, 3.8)),
        'tail': ((3.8, -0.3, 0.0), (6.0, -1.2, 0.0)),
    }
P = {'neck0': 'shell', 'neck1': 'neck0', 'head': 'neck1', 'fl0': 'shell', 'fl1': 'fl0', 'fr0': 'shell', 'fr1': 'fr0',
     'hl0': 'shell', 'hl1': 'hl0', 'hr0': 'shell', 'hr1': 'hr0', 'tail': 'shell'}
arm = bpy.data.armatures.new('rig'); ao = bpy.data.objects.new(kind + '_rig', arm)
bpy.context.scene.collection.objects.link(ao); bpy.context.view_layer.objects.active = ao
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
b = arm.edit_bones.new('shell'); b.head = G(shell_c[0], -0.3, 0); b.tail = G(shell_c[0], 0.8, 0); eb['shell'] = b
for n, (h, t) in J.items():
    b = arm.edit_bones.new(n); b.head = G(*h); b.tail = G(*t); eb[n] = b
for n, p in P.items():
    eb[n].parent = eb[p]; eb[n].use_connect = (eb[p].tail - eb[n].head).length < 1e-4
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); ao.select_set(True); bpy.context.view_layer.objects.active = ao
bpy.ops.object.parent_set(type='ARMATURE_NAME')   # 只建空的骨頭群組，權重下面自己填
segs = {n: (eb_h, eb_t) for n, (eb_h, eb_t) in [(bn.name, (bn.head_local.copy(), bn.tail_local.copy())) for bn in arm.bones]}
def segd(p, h, t):
    d = t - h; L2 = d.length_squared
    u = 0.0 if L2 == 0 else max(0.0, min(1.0, (p - h).dot(d) / L2))
    return (p - (h + d * u)).length
groups = {g.name: g for g in ob.vertex_groups}
rigid = 0
for v in ob.data.vertices:
    p = v.co
    gx, gz = p.x, -p.y
    e = ((gx - shell_c[0]) / shell_r[0]) ** 2 + ((gz - shell_c[1]) / shell_r[1]) ** 2
    k = 1.0 if e < 1.0 else max(0.0, (1.3 - e) / 0.3)   # 整片殼都是硬的，殼外一小圈漸變到腳
    ds = sorted(((segd(p, h, t), n) for n, (h, t) in segs.items() if n != 'shell'))[:3]
    ws = [(1.0 / (d ** 4 + 1e-4), n) for d, n in ds]
    tot = sum(w for w, _ in ws)
    for w, n in ws: groups[n].add([v.index], (1 - k) * w / tot, 'REPLACE')
    if k > 0: groups['shell'].add([v.index], k, 'REPLACE')
    rigid += k >= 1
empty = sum(1 for v in ob.data.vertices if not any(g.weight > 0.01 for g in v.groups))
print('RESULT', kind, 'verts', len(ob.data.vertices), 'rigid', rigid, 'unweighted', empty)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=82,
    export_skins=True, export_animations=False, export_apply=False, use_selection=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
