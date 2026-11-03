# 依距離綁骨架（夜鷺、攀蜥）：blender -b -P tools/rig-distance.py -- 減面後.glb 輸出-rig.glb nightheron|lizard
# 骨頭位置照正交視圖量（glTF 座標：x 右、y 上、z 前）。掃描／拼接的網格不封閉，Blender 自動權重不可靠，
# 所以權重自己算：點到各骨頭線段的距離除以該骨頭的影響範圍 reach，取最近 3 根，1/d^4。
import bpy, sys
from mathutils import Vector
a = sys.argv[sys.argv.index('--')+1:]
src, dst, kind = a[0], a[1], a[2]
import json
EXTRA = json.loads(a[3]) if len(a) > 3 else {}   # 其他停枝鳥的點位可以從命令列傳進來
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = [o for o in bpy.data.objects if o.type == 'MESH'][0]
mw = ob.matrix_world.copy(); ob.parent = None; ob.matrix_world = mw
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
G = lambda x, y, z: Vector((x, -z, y))

# name: (頭, 尾, 父, reach)
if kind == 'nightheron':
    # 頭朝 -z
    B = {'body': ((0, 0.42, 0.36), (0, 0.8, 0.05), None, 1.0),
         'neck': ((0, 0.8, 0.05), (0, 0.93, 0.0), 'body', 0.8),
         'head': ((0, 0.93, 0.0), (0, 0.98, -0.36), 'neck', 0.8),
         'tail': ((0, 0.27, 0.42), (0, 0.15, 0.63), 'body', 0.7)}
    for s, n in ((1, 'L'), (-1, 'R')):
        B['wing' + n] = ((s * 0.14, 0.78, 0.06), (s * 0.16, 0.46, 0.32), 'body', 0.45)
        B['wingtip' + n] = ((s * 0.16, 0.46, 0.32), (s * 0.12, 0.2, 0.56), 'wing' + n, 0.45)
        B['thigh' + n] = ((s * 0.07, 0.4, 0.2), (s * 0.075, 0.28, 0.27), 'body', 0.35)
        B['shin' + n] = ((s * 0.075, 0.28, 0.27), (s * 0.075, 0.035, 0.17), 'thigh' + n, 0.35)
        B['foot' + n] = ((s * 0.075, 0.035, 0.17), (s * 0.075, 0.0, -0.08), 'shin' + n, 0.35)
elif kind == 'barbet':
    # 五色鳥（Tripo 生成）：頭朝 -x 偏 -z、身體斜站；左右方向約 (-0.47, 0, 0.88)
    B = {'body': ((0.1, 0.55, 0.08), (-0.1, 0.82, 0.0), None, 1.0),
         'neck': ((-0.1, 0.82, 0.0), (-0.17, 0.9, -0.03), 'body', 0.8),
         'head': ((-0.17, 0.9, -0.03), (-0.35, 0.88, -0.08), 'neck', 0.8),
         'tail': ((0.12, 0.56, 0.12), (0.17, 0.37, 0.17), 'body', 0.6)}
    for s, n in ((1, 'L'), (-1, 'R')):
        B['wing' + n] = ((-0.06 - s * 0.04, 0.79, 0.0 + s * 0.075), (0.12 - s * 0.04, 0.56, 0.1 + s * 0.075), 'body', 0.35)
elif kind in ('bulbul', 'whiteeye', 'treepie'):
    # Tripo 生成、ChatGPT 參考圖都是正側面頭朝左，所以模型都是頭朝 -x、左右對稱（z）。點位見 fju-animals README。
    P = {'bulbul': dict(tail0=(0.18, 0.24), tailE=(0.47, 0.03), hip=(0.15, 0.24), chest=(-0.22, 0.55), nk=(-0.3, 0.62), bill=(-0.49, 0.64), wing0=(-0.2, 0.5), wingE=(0.3, 0.25), wz=0.12)}
    if kind in EXTRA: P.update(EXTRA)
    q = P[kind]
    B = {'body': ((*q['hip'][:1], q['hip'][1], 0), (q['chest'][0], q['chest'][1], 0), None, 1.0),
         'neck': ((q['chest'][0], q['chest'][1], 0), (q['nk'][0], q['nk'][1], 0), 'body', 0.8),
         'head': ((q['nk'][0], q['nk'][1], 0), (q['bill'][0], q['bill'][1], 0), 'neck', 0.8),
         'tail': ((q['tail0'][0], q['tail0'][1], 0), (q['tailE'][0], q['tailE'][1], 0), 'body', 0.6)}
    for s, n in ((1, 'L'), (-1, 'R')):
        B['wing' + n] = ((q['wing0'][0], q['wing0'][1], s * q['wz']), (q['wingE'][0], q['wingE'][1], s * q['wz']), 'body', 0.35)
elif kind in ('dove', 'heron', 'barbet2'):
    # 保留生成腳的鳥（Tripo 生成，頭朝 -x；五色鳥第二版也是）：保留生成的腳，綁 thigh → shin → foot。點位從命令列 JSON 傳入。
    q = EXTRA[kind]
    p3 = lambda xy, z=0: (xy[0], xy[1], z)
    if 'neck' in q:
        # 身體分兩節（body → chest）、脖子三節（neck → neck2 → neck3），伸脖子時三節一起拉長，頭整顆剛性
        nk = q['neck']
        B = {'body': (p3(q['hip']), p3(q['mid']), None, 1.0),
             'chest': (p3(q['mid']), p3(nk[0]), 'body', 1.0),
             'neck': (p3(nk[0]), p3(nk[1]), 'chest', 0.8),
             'neck2': (p3(nk[1]), p3(nk[2]), 'neck', 0.8),
             'neck3': (p3(nk[2]), p3(q['nk']), 'neck2', 0.8),
             'head': (p3(q['nk']), p3(q['bill']), 'neck3', 0.8),
             'tail': (p3(q['tail0']), p3(q['tailE']), 'body', 0.6)}
    else:
        B = {'body': (p3(q['hip']), p3(q['chest']), None, 1.0),
             'neck': (p3(q['chest']), p3(q['nk']), 'body', 0.8),
             'head': (p3(q['nk']), p3(q['bill']), 'neck', 0.8),
             'tail': (p3(q['tail0']), p3(q['tailE']), 'body', 0.6)}
    for s, n in ((1, 'L'), (-1, 'R')):
        B['wing' + n] = (p3(q['wing0'], s * q['wz']), p3(q['wingE'], s * q['wz']), 'body', 0.4)
    for n, leg in (('L', q['legL']), ('R', q['legR'])):
        z = leg[4]
        B['thigh' + n] = (p3(leg[0], z), p3(leg[1], z), 'body', 0.3)
        B['shin' + n] = (p3(leg[1], z), p3(leg[2], z), 'thigh' + n, 0.3)
        B['foot' + n] = (p3(leg[2], z), p3(leg[3], z), 'shin' + n, 0.3)
else:
    # 攀蜥：頭朝 -x、尾巴繞一圈
    B = {'pelvis': ((0.9, 0.0, 0.0), (0.4, 0.08, 0.0), None, 1.0),
         'spine1': ((0.4, 0.08, 0.0), (-0.4, 0.17, 0.0), 'pelvis', 1.0),
         'spine2': ((-0.4, 0.17, 0.0), (-1.3, 0.25, 0.0), 'spine1', 1.0),
         'neck': ((-1.3, 0.25, 0.0), (-1.8, 0.4, 0.0), 'spine2', 1.0),
         'head': ((-1.8, 0.4, 0.0), (-2.45, 0.35, 0.0), 'neck', 1.0)}
    legs = {'fl': [(-1.15, 0.1, -0.2), (-1.0, -0.2, -0.4), (-1.25, -0.5, -0.5), (-1.4, -0.55, -0.6)],
            'fr': [(-1.1, 0.1, 0.2), (-0.95, -0.2, 0.45), (-1.05, -0.5, 0.7), (-1.1, -0.55, 0.85)],
            'hl': [(0.55, 0.0, -0.2), (0.1, -0.3, -0.95), (0.75, -0.5, -1.05), (0.65, -0.55, -1.65)],
            'hr': [(0.6, 0.0, 0.2), (0.35, -0.3, 0.65), (0.85, -0.5, 0.78), (0.95, -0.55, 1.35)]}
    for n, p in legs.items():
        par = 'spine2' if n[0] == 'f' else 'pelvis'
        B[n + '0'] = (p[0], p[1], par, 0.5); B[n + '1'] = (p[1], p[2], n + '0', 0.5); B[n + '2'] = (p[2], p[3], n + '1', 0.5)
    T = [(0.9, 0.0, 0.0), (1.6, -0.12, -0.22), (2.3, -0.22, -0.4), (3.0, -0.28, -0.5), (3.6, -0.3, -0.38), (4.0, -0.3, 0.0),
         (3.95, -0.3, 0.55), (3.6, -0.3, 1.0), (3.0, -0.3, 1.45), (2.2, -0.3, 1.72), (1.0, -0.3, 1.95)]
    for i in range(len(T) - 1):
        B[f'tail{i}'] = (T[i], T[i + 1], 'pelvis' if i == 0 else f'tail{i-1}', 0.5)

arm = bpy.data.armatures.new('rig'); ao = bpy.data.objects.new(kind + '_rig', arm)
bpy.context.scene.collection.objects.link(ao); bpy.context.view_layer.objects.active = ao
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for n, (h, t, p, r) in B.items():
    b = arm.edit_bones.new(n); b.head = G(*h); b.tail = G(*t); eb[n] = b
for n, (h, t, p, r) in B.items():
    if p: eb[n].parent = eb[p]; eb[n].use_connect = (eb[p].tail - eb[n].head).length < 1e-4
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); ao.select_set(True); bpy.context.view_layer.objects.active = ao
bpy.ops.object.parent_set(type='ARMATURE_NAME')
segs = {bn.name: (bn.head_local.copy(), bn.tail_local.copy(), B[bn.name][3]) for bn in arm.bones}
def segd(p, h, t):
    d = t - h; L2 = d.length_squared
    u = 0.0 if L2 == 0 else max(0.0, min(1.0, (p - h).dot(d) / L2))
    return (p - (h + d * u)).length
groups = {g.name: g for g in ob.vertex_groups}
HEAD = EXTRA.get(kind, {}).get('headRigid') if isinstance(EXTRA.get(kind), dict) else None   # [y0, y1, x 小於多少才算頭]
for v in ob.data.vertices:
    ds = sorted(((segd(v.co, h, t) / r, n) for n, (h, t, r) in segs.items()))
    # 腳和尾巴互不借權重（掃描時尾巴尖貼著後腳趾，不擋的話尾巴一動腳趾就被拉走）
    leg = lambda n: n[:2] in ('fl', 'fr', 'hl', 'hr')
    tail = lambda n: n.startswith('tail') and n[4:].isdigit() and int(n[4:]) >= 2
    if leg(ds[0][1]): ds = [d for d in ds if not tail(d[1])]
    elif tail(ds[0][1]): ds = [d for d in ds if not leg(d[1])]
    ds = ds[:3]
    ws = [(1.0 / (d ** 4 + 1e-6), n) for d, n in ds]
    tot = sum(w for w, _ in ws)
    ws = [(w / tot, n) for w, n in ws]
    if HEAD:
        # 頭部剛性：y 高於 HEAD[1] 的整顆跟 head 走（含冠羽），HEAD[0]～HEAD[1] 之間漸變
        y = v.co.z; hk = max(0.0, min(1.0, (y - HEAD[0]) / (HEAD[1] - HEAD[0]))) if v.co.x < HEAD[2] else 0.0
        hk = hk * hk * (3 - 2 * hk)
        ws = [(w * (1 - hk), n) for w, n in ws if n != 'head'] + [(hk + sum(w for w, n in ws if n == 'head') * (1 - hk), 'head')]
    for w, n in ws:
        if w > 1e-4: groups[n].add([v.index], w, 'REPLACE')
print('RESULT', kind, 'verts', len(ob.data.vertices), 'bones', len(B))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85,
    export_skins=True, export_animations=False, export_apply=False, use_selection=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
