# 掃描模型減面：blender -b -P tools/shrink-model.py -- 原檔.glb 輸出.glb 目標三角形數
# 合併所有網格、焊接接縫、減面、貼圖轉 JPEG、Draco 壓縮。
import bpy, sys, bmesh
a = sys.argv[sys.argv.index('--')+1:]
src, dst, target = a[0], a[1], int(a[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
# 掃描檔附帶的小方塊不要
for o in list(bpy.data.objects):
    if o.type == 'MESH' and len(o.data.vertices) <= 24: bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
# 把階層的變換全部套到頂點上，之後在網頁裡自己擺
mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
# 掃描檔被切成 65k 頂點一塊，接縫要先合併，減面才不會裂開
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0001); bpy.ops.object.mode_set(mode='OBJECT')
tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
if tris > target:
    m = ob.modifiers.new('dec', 'DECIMATE'); m.ratio = target / tris
    bpy.ops.object.modifier_apply(modifier='dec')
print('RESULT', src, 'tris', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'dims', tuple(round(d, 3) for d in ob.dimensions), 'bbox', [tuple(round(c, 2) for c in v) for v in (ob.bound_box[0], ob.bound_box[6])])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=82,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_apply=True)
