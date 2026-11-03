# 把 OpenStreetMap 下載的 area.json 轉成網頁用的 campus.json（公尺座標）。
# 座標：原點在校園中心，x 向東、z 向南（three.js 的 -z 是北）。
# 地圖資料 © OpenStreetMap contributors，ODbL 授權。
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(os.path.join(HERE, 'area.json')))
LAT0, LON0 = 25.03655, 121.43240
KX = 111320 * math.cos(math.radians(LAT0))
KZ = 110540

def xz(p):
    return [round((p['lon'] - LON0) * KX, 2), round(-(p['lat'] - LAT0) * KZ, 2)]

# 校園邊界：relation 的 outer way 接成一圈
rel = next(e for e in src['elements'] if e['type'] == 'relation')
segs = [[xz(p) for p in m['geometry']] for m in rel['members'] if m['role'] == 'outer']
rings = []
while segs:
    ring = segs.pop(0)
    while ring[0] != ring[-1]:
        for i, s in enumerate(segs):
            if s[0] == ring[-1]: ring += s[1:]; segs.pop(i); break
            if s[-1] == ring[-1]: ring += s[::-1][1:]; segs.pop(i); break
        else:
            break
    rings.append(ring)

def inside(pt, poly):
    x, z = pt; c = False
    for i in range(len(poly)):
        x1, z1 = poly[i]; x2, z2 = poly[i - 1]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            c = not c
    return c

def centroid(pts):
    return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]

ROAD_W = {'primary': 14, 'secondary': 12, 'tertiary': 9, 'residential': 6, 'unclassified': 6,
          'service': 4.5, 'pedestrian': 5, 'footway': 2.2, 'steps': 2.2, 'track': 3, 'corridor': 2}
AREA = {
    ('landuse', 'grass'): 'grass', ('natural', 'grassland'): 'grass', ('leisure', 'park'): 'park',
    ('natural', 'wood'): 'wood', ('leisure', 'pitch'): 'pitch', ('natural', 'water'): 'water',
    ('amenity', 'parking'): 'parking', ('landuse', 'flowerbed'): 'flower',
}

out = {'boundary': rings, 'buildings': [], 'areas': [], 'roads': [], 'treeRows': []}
for e in src['elements']:
    if e['type'] != 'way' or 'geometry' not in e: continue
    t = e.get('tags', {})
    pts = [xz(p) for p in e['geometry']]
    closed = len(pts) > 3 and pts[0] == pts[-1]
    c = centroid(pts)
    inCampus = any(inside(c, r) for r in rings)
    if 'building' in t and closed:
        lv = t.get('building:levels')
        try:
            h = float(t['height']) if 'height' in t else (float(lv) * 3.6 if lv else None)
        except ValueError:
            h = None
        out['buildings'].append({'pts': pts[:-1], 'h': h, 'name': t.get('name'), 'kind': t['building'], 'in': inCampus})
        continue
    kind = next((v for (k, val), v in AREA.items() if t.get(k) == val), None)
    if kind and closed:
        out['areas'].append({'pts': pts[:-1], 'kind': kind, 'name': t.get('name'), 'sport': t.get('sport'), 'in': inCampus})
        continue
    if t.get('natural') == 'tree_row':
        out['treeRows'].append(pts); continue
    hw = t.get('highway')
    if hw in ROAD_W:
        out['roads'].append({'pts': pts, 'w': ROAD_W[hw], 'kind': hw, 'in': inCampus})

json.dump(out, open(os.path.join(HERE, '..', 'campus.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
for r in rings:
    xs = [p[0] for p in r]; zs = [p[1] for p in r]
    print('ring', len(r), 'x', round(min(xs)), round(max(xs)), 'z', round(min(zs)), round(max(zs)))
print('in campus', sum(b['in'] for b in out['buildings']), 'buildings')
print({k: len(v) for k, v in out.items()})
