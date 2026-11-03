# 停枝的鳥：把 Tripo 生成的腳切掉（之後用程式做的 IK 腳），肚子底下補洞。
# blender -b -P tools/cut-below.py -- 輸入.glb 輸出.glb 切線高度y 尾巴從x以後保留
# 座標（glTF）：頭朝 -x、y 往上；比 y 低的點刪掉，但 x 大於「尾巴」值的保留（尾巴常常垂得比肚子低）。
import bpy, sys, bmesh
a = sys.argv[sys.argv.index('--')+1:]
src, dst, ycut, tailx = a[0], a[1], float(a[2]), float(a[3])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
bm = bmesh.new(); bm.from_mesh(ob.data)
bad = [v for v in bm.verts if v.co.z < ycut and v.co.x < tailx]   # Blender z = glTF y
bmesh.ops.delete(bm, geom=bad, context='VERTS')
bm.verts.ensure_lookup_table()
seen, parts = set(), []
for v in bm.verts:
    if v.index in seen: continue
    stack, part = [v], []; seen.add(v.index)
    while stack:
        u = stack.pop(); part.append(u)
        for e in u.link_edges:
            w = e.other_vert(u)
            if w.index not in seen: seen.add(w.index); stack.append(w)
    parts.append(part)
parts.sort(key=len, reverse=True)
small = [v for p in parts[1:] for v in p if len(p) < len(parts[0]) * 0.02]
bmesh.ops.delete(bm, geom=small, context='VERTS')
bm.edges.ensure_lookup_table()
bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
bm.to_mesh(ob.data); bm.free()
print('RESULT cut', len(bad), 'small', len(small), 'verts', len(ob.data.vertices))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85)
