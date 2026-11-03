# Tripo 做的五色鳥連著一截枯枝，切掉枯枝、只留鳥：blender -b -P tools/cut-barbet.py -- 輸入.glb 輸出.glb
# 座標（glTF）：頭朝 -x、y 往上；鳥腳抓在 y≈0.53 的枝頂，尾巴往下垂到 y≈0.36（在 x、z 都偏正的那一側）。
import bpy, sys, bmesh
a = sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
ob = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
def keep(co):
    x, y, z = co.x, co.z, -co.y
    if 0.1 < x < 0.2 and z > 0.1 and y > 0.34: return True   # 尾巴
    if y < 0.545: return False                                # 枝幹
    if y < 0.575 and -0.06 < x < 0.17 and -0.06 < z < 0.12: return False   # 原本抓著枝的腳趾（改用程式做的腳）
    if y < 0.61 and (x > 0.19 or z < -0.05): return False     # 枝頂兩側的斷枝
    return True
bm = bmesh.new(); bm.from_mesh(ob.data)
bad = [v for v in bm.verts if not keep(v.co)]
bmesh.ops.delete(bm, geom=bad, context='VERTS')
# 切完會留下零碎的小塊，只留最大的一塊
bm.verts.ensure_lookup_table()
seen, parts = set(), []
for v in bm.verts:
    if v.index in seen: continue
    stack, part = [v], []
    seen.add(v.index)
    while stack:
        u = stack.pop(); part.append(u)
        for e in u.link_edges:
            w = e.other_vert(u)
            if w.index not in seen: seen.add(w.index); stack.append(w)
    parts.append(part)
parts.sort(key=len, reverse=True)
small = [v for p in parts[1:] for v in p if len(p) < len(parts[0]) * 0.02]
bmesh.ops.delete(bm, geom=small, context='VERTS')
# 切口補起來（不然從正面看得到肚子底下一個空洞）
bm.edges.ensure_lookup_table()
bnd = [e for e in bm.edges if e.is_boundary]
bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
bm.to_mesh(ob.data); bm.free()
print('RESULT parts', len(parts), 'largest', len(parts[0]), 'removed small', len(small), 'verts', len(ob.data.vertices))
bpy.ops.export_scene.gltf(filepath=a[1], export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85)
