// 十種動物：沿脊線放樣出平滑的身體，羽色／毛色花紋畫在頂點色上；會在附近走動、跳枝、覓食。
// 模型用真實尺寸（公尺）建，再依物種放大（不放大在校園尺度下看不到）；+z 是前方、腳底在原點。
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { canopyGeometry } from './campus.js'
import { leafify, barkify, leafCardGeometry, leafCardMaterial } from './foliage.js'

const { clamp, lerp, smoothstep: ss, randFloat: rnd } = THREE.MathUtils
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const K = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, new THREE.Color(v)]))
const tmp = new THREE.Color()
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const fract = (x) => x - Math.floor(x)
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt))
const dampAngle = (a, b, k, dt) => a + wrap(b - a) * (1 - Math.exp(-k * dt))
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const sgn = () => (Math.random() < 0.5 ? -1 : 1)

const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
const gloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })
const mats = {}
const mat = (c, r = 0.6) => (mats[c + '/' + r] ||= new THREE.MeshStandardMaterial({ color: c, roughness: r }))
const SPH = new THREE.SphereGeometry(1, 16, 12)

/* ---------- 放樣 ---------- */
function cr(a, b, c, d, t) {
  const t2 = t * t, t3 = t2 * t
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
}
// rings：每個截面是 [x, y, z, 半寬, 上半高, 下半高?]，用 Catmull-Rom 內插成平滑的封閉管狀體。
// paint(out, u, s, c, q)：u 沿脊線 0→1；s 背 +1／腹 -1；c 兩側 ±1；q 是 frame(頂點) 的正規化座標。
// displace(u, s, c, p)：沿法線推出的距離（做溝紋、隆起）。另外輸出 uv（u, 繞一圈 0→1）和沿脊線的切線 tang，給毛用。
function loft(rings, paint, { seg = 16, sub = 5, up = V(0, 1, 0), grain = 0.06, frame, material = skin, displace } = {}) {
  rings = rings.map((r) => (r.length === 5 ? [...r, r[4]] : r))
  const n = rings.length, S = []
  for (let i = 0; i < n - 1; i++) {
    const a = rings[Math.max(0, i - 1)], b = rings[i], c = rings[i + 1], d = rings[Math.min(n - 1, i + 2)]
    for (let k = 0; k < sub + (i === n - 2 ? 1 : 0); k++) S.push(b.map((_, j) => cr(a[j], b[j], c[j], d[j], k / sub)))
  }
  const P = S.map((s) => V(s[0], s[1], s[2])), m = P.length
  const T = P.map((_, i) => V().subVectors(P[Math.min(i + 1, m - 1)], P[Math.max(i - 1, 0)]).normalize())
  const N = up.clone()
  if (Math.abs(N.dot(T[0])) > 0.95) N.set(0, 0, -1)
  N.addScaledVector(T[0], -N.dot(T[0])).normalize()
  const len = [0]
  for (let i = 1; i < m; i++) len.push(len[i - 1] + P[i].distanceTo(P[i - 1]))
  const total = len[m - 1] || 1
  const pos = [], cols = [], idx = [], uvs = [], tang = [], usc = [], ucs = [], col = new THREE.Color(), B = V(), v = V(), q = new THREE.Quaternion()
  let curT = T[0], curV = 0
  const put = (p, u, s, c) => {
    const fp = frame ? frame(p) : p
    paint(col, u, s, c, fp)
    const g = 1 + grain * (Math.random() * 2 - 1)
    pos.push(p.x, p.y, p.z); cols.push(col.r * g, col.g * g, col.b * g)
    uvs.push(u, curV); tang.push(curT.x, curT.y, curT.z); ucs.push(u, s, c)
    if (displace) usc.push([u, s, c, fp.clone()])
  }
  for (let i = 0; i < m; i++) {
    if (i > 0) { q.setFromUnitVectors(T[i - 1], T[i]); N.applyQuaternion(q); N.addScaledVector(T[i], -N.dot(T[i])).normalize() }
    B.crossVectors(T[i], N)
    const [, , , rx, ryt, ryb] = S[i]
    curT = T[i]
    for (let j = 0; j < seg; j++) {
      const ang = (j / seg) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang)
      curV = Math.abs(1 - 2 * j / seg) * 0.5   // 對稱展開，接縫那一條才不會跳回 0
      v.copy(P[i]).addScaledVector(B, rx * c).addScaledVector(N, (s >= 0 ? ryt : ryb) * s)
      put(v, len[i] / total, s, c)
    }
  }
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = a + seg, c = i * seg + ((j + 1) % seg), d = c + seg
    idx.push(a, b, c, c, b, d)
  }
  // 兩端用一個稍微凸出的頂點封口
  for (const [i, dir] of [[0, -1], [m - 1, 1]]) {
    const k = pos.length / 3, [, , , rx, ryt] = S[i]
    curT = T[i]; curV = 0
    put(P[i].clone().addScaledVector(T[i], dir * Math.min(rx, ryt) * 0.5), i ? 1 : 0, 0, 0)
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg)
      dir < 0 ? idx.push(k, a, b) : idx.push(k, b, a)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setAttribute('tang', new THREE.Float32BufferAttribute(tang, 3))
  g.setAttribute('ucs', new THREE.Float32BufferAttribute(ucs, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  if (displace) {
    const pa = g.attributes.position, na = g.attributes.normal
    usc.forEach(([u, s, c, fp], i) => {
      const d = displace(u, s, c, fp)
      pa.setXYZ(i, pa.getX(i) + na.getX(i) * d, pa.getY(i) + na.getY(i) * d, pa.getZ(i) + na.getZ(i) * d)
    })
    g.computeVertexNormals()
  }
  const mesh = new THREE.Mesh(g, material)
  mesh.castShadow = true
  return mesh
}
const solid = (c) => (o) => o.copy(c)

// 眼睛：有光澤的虹膜球 + 外側扁平瞳孔；fwd 讓眼睛往前轉一點
function eye(r, iris, [x, y, z], sx, fwd = 0.3, pupil = 0.55) {
  const g = new THREE.Group()
  const b = new THREE.Mesh(SPH, mat(iris, 0.12)); b.scale.setScalar(r)
  const p = new THREE.Mesh(SPH, mat(0x050404, 0.08)); p.scale.set(r * 0.3, r * pupil, r * pupil); p.position.x = sx * r * 0.82
  g.add(b, p); g.position.set(x, y, z); g.rotation.y = -sx * fwd
  return g
}

/* ---------- 腳：兩節 IK ---------- */
function makeLeg({ a, b, ra, rb, ca, cb, bend = 1, x = 0 }) {
  const hip = new THREE.Group(), knee = new THREE.Group(), foot = new THREE.Group()
  const up = new THREE.Mesh(new THREE.CylinderGeometry(ra, ra * 0.7, a, 8).translate(0, -a / 2, 0), mat(ca, 0.8))
  const lo = new THREE.Mesh(new THREE.CylinderGeometry(rb, rb * 0.85, b, 7).translate(0, -b / 2, 0), mat(cb, 0.5))
  const j = new THREE.Mesh(SPH, mat(cb, 0.5)); j.scale.setScalar(rb * 1.15)
  for (const m of [up, lo, j]) m.castShadow = true
  hip.add(up, knee); knee.position.y = -a; knee.add(j, lo, foot); foot.position.y = -b
  return { hip, knee, foot, a, b, bend, x, toes: [], ground: 0 }
}
// 把腳掌放到 (fy, fz)（和髖關節同一個座標系），bend +1 關節往後（鳥），-1 往前（膝蓋）
function legIK(l, hy, hz, fy, fz, footPitch = 0) {
  let dy = fy - hy, dz = fz - hz, d = Math.hypot(dy, dz)
  const max = (l.a + l.b) * 0.999, min = Math.abs(l.a - l.b) + 1e-4
  if (d > max) { dy *= max / d; dz *= max / d; d = max } else if (d < min) { dy *= min / d; dz *= min / d; d = min }
  const base = Math.atan2(-dz, -dy)
  const al = Math.acos(clamp((l.a * l.a + d * d - l.b * l.b) / (2 * l.a * d), -1, 1))
  const t1 = base + l.bend * al
  const ky = hy - l.a * Math.cos(t1), kz = hz - l.a * Math.sin(t1)
  const t2 = Math.atan2(-(hz + dz - kz), -(hy + dy - ky))
  l.hip.position.set(l.x, hy, hz)
  l.hip.rotation.x = t1; l.knee.rotation.x = t2 - t1; l.foot.rotation.x = footPitch - t2
}
function birdFoot(l, r, toe, c) {
  for (const [yaw, k] of [[-0.42, 1], [0, 1.12], [0.42, 0.95], [Math.PI, 0.62]]) {
    const p = new THREE.Group(), curl = new THREE.Group()
    p.rotation.y = yaw; p.add(curl)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.7, toe * k, 6).translate(0, (toe * k) / 2, 0).rotateX(Math.PI / 2), mat(c, 0.5))
    m.castShadow = true
    curl.add(m); l.foot.add(p); l.toes.push(curl)
  }
  l.ground = r * 0.6
}

/* ---------- 會彎的脖子 ---------- */
// 鳥的脖子有十幾節頸椎，可以縮成 S 形、伸直、往後扭去理毛。
// 這裡把脖子做成一條每格重新排的管子：沿著「身體 → 頭」的貝茲曲線鋪開，頭的位置和朝向另外決定。
const _q = new THREE.Quaternion()
function flexNeck(nl, nr, nb, paint, inset = nl * 0.7, inner = 16, seg = 14) {
  const rings = inner + 2, n = rings * seg
  const radius = (i) => (i === 0 ? nb : i === rings - 1 ? nr * 0.8 : lerp(nb, nr * 0.85, ss((i - 1) / (inner - 1), 0, 0.35)))
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cols = [], idx = [], col = new THREE.Color()
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1), r = radius(i)
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a)
      paint(col, u, sn, c, V((c * r) / nr, -0.7 + 1.8 * u, (-sn * r) / nr))
      const g = 1 + 0.06 * (Math.random() * 2 - 1)
      cols.push(col.r * g, col.g * g, col.b * g)
    }
  }
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = a + seg, c = i * seg + ((j + 1) % seg), d = c + seg
    idx.push(a, b, c, c, b, d)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  geo.setIndex(idx)
  const mesh = new THREE.Mesh(geo, skin)
  mesh.castShadow = true
  mesh.frustumCulled = false   // 每格都在變形，包圍球不準
  const P = Array.from({ length: rings }, () => V()), T = P.map(() => V()), Ns = P.map(() => V()), N = V(), B = V(), p = V(), nn = V(), e = V(), cx = V()
  const p1 = V(), p2 = V()
  // 從 a 出發沿 ta，到 b 時沿 tb 進入
  // back：頸根處背側的方向；endBack：頭那端背側的方向（脖子會沿途扭過去對齊，花紋才不會錯位）
  function update(a, ta, b, tb, back, endBack) {
    const d = a.distanceTo(b), k = clamp(d * 0.4, nl * 0.15, nl * 0.6)   // 控制柄太長曲線會打結鼓出來
    p1.copy(a).addScaledVector(ta, k); p2.copy(b).addScaledVector(tb, -k)
    P[0].copy(a).addScaledVector(ta, -inset)   // 埋進身體的那一截，太長會從胸口下面穿出來
    for (let i = 0; i < inner; i++) {
      const t = i / (inner - 1), m = 1 - t
      P[i + 1].copy(a).multiplyScalar(m * m * m).addScaledVector(p1, 3 * m * m * t).addScaledVector(p2, 3 * m * t * t).addScaledVector(b, t * t * t)
    }
    P[rings - 1].copy(b).addScaledVector(tb, nr * 0.6)
    for (let i = 0; i < rings; i++) T[i].subVectors(P[Math.min(i + 1, rings - 1)], P[Math.max(i - 1, 0)]).normalize()
    N.copy(back).addScaledVector(T[0], -back.dot(T[0])).normalize()
    for (let i = 0; i < rings; i++) {
      if (i > 0) { _q.setFromUnitVectors(T[i - 1], T[i]); N.applyQuaternion(_q).addScaledVector(T[i], -N.dot(T[i])).normalize() }
      Ns[i].copy(N)
    }
    // 頭端要扭多少，平均分給每一節
    const Te = T[rings - 1]
    e.copy(endBack).addScaledVector(Te, -endBack.dot(Te)).normalize()
    const twist = Math.atan2(cx.crossVectors(N, e).dot(Te), N.dot(e))
    for (let i = 0; i < rings; i++) {
      N.copy(Ns[i]).applyAxisAngle(T[i], twist * (i / (rings - 1)))
      B.crossVectors(T[i], N)
      const r = radius(i)
      for (let j = 0; j < seg; j++) {
        const a2 = (j / seg) * Math.PI * 2, c = Math.cos(a2), sn = Math.sin(a2), o = (i * seg + j) * 3
        nn.copy(B).multiplyScalar(c).addScaledVector(N, sn)
        p.copy(P[i]).addScaledVector(nn, r)
        pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z
        nor[o] = nn.x; nor[o + 1] = nn.y; nor[o + 2] = nn.z
      }
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.normal.needsUpdate = true
  }
  return { mesh, update }
}

/* ---------- 鳥的共用骨架 ---------- */
const BODY = [[-0.56, 0.06], [-0.44, 0.5], [-0.24, 0.86], [0, 1], [0.24, 0.96], [0.42, 0.74], [0.54, 0.3]]
const HEAD = [[-0.95, 0.12], [-0.72, 0.72], [-0.3, 0.98], [0.1, 1], [0.5, 0.82], [0.78, 0.55], [0.92, 0.38]]
const WING = [[0, 0.45], [0.12, 0.85], [0.35, 1], [0.6, 0.86], [0.8, 0.56], [0.93, 0.26], [1, 0.04]]

function bird(o) {
  const { L, R, W = 1, pitch = -0.3, paint } = o, lg = o.legs
  const H = (o.H = (lg.stand ?? 0.8) * (lg.tib + lg.tar) + R * 0.5)
  const root = new THREE.Group(), body = new THREE.Group()
  body.position.y = H; body.rotation.x = pitch; root.add(body)
  body.add(loft(BODY.map(([z, r]) => [0, 0, z * L, R * W * r, R * r, R * r * (o.belly ?? 1.08)]), paint.body, { frame: (p) => V(p.x / R, p.y / R, p.z / L) }))

  const wl = o.wing.len, wh = o.wing.h, wings = []
  for (const sx of [1, -1]) {
    // 覆羽：一排排的羽毛邊緣比較淡，看起來是鱗片狀
    const covert = (out, u, s, c, p) => { paint.wing(out, u, s, c, p); if (u < 0.6) out.multiplyScalar(1 + 0.22 * ss(fract(u * 7 + s * 0.8), 0.72, 0.95) - 0.08 * ss(fract(u * 7 + s * 0.8), 0.95, 1)) }
    const w = loft(WING.map(([u, h]) => [0, (wh * (1 - h)) / 2 - u * wh * 0.15, -u * wl, wh * 0.06 * (1 - u * 0.5), (h * wh) / 2]), covert, { seg: 10, frame: (p) => p })
    w.position.set(sx * R * W * (o.wing.x ?? 0.7), R * (o.wing.y ?? 0.2), L * (o.wing.z ?? 0.3))
    // 一根根的羽毛：初級飛羽在後下方疊成一束、尖端錯開；三級飛羽是蓋在上面的寬圓羽
    const th = wh * 0.022
    const feather = (len, fw, u0, u1, curve) => loft([[0, 0, 0, th, fw * 0.3], [0, 0, -len * 0.25, th, fw * 0.5], [0, -curve * 0.4, -len * 0.7, th * 0.8, fw * 0.42], [0, -curve, -len, th * 0.3, fw * 0.06]],
      (out, u, s2, c, p) => {
        paint.wing(out, lerp(u0, u1, u), -0.2, c, p)
        out.multiplyScalar((1 + 0.3 * ss(s2, 0.55, 0.9)) * (1 - 0.3 * band2(s2, -0.06, 0.06, 0.03)))   // 淡色羽緣、深色羽軸
      }, { seg: 8, grain: 0.03 })
    const np = o.wing.primaries ?? 6
    for (let i = 0; i < np; i++) {
      const f = feather(wl * 0.6 * (1 - i * 0.05), wh * 0.3, 0.6, 1, wh * 0.08)
      f.position.set(sx * th * 1.6 * (np - i), -wh * 0.08 - i * wh * 0.055, -wl * 0.4 - i * wl * 0.045)
      w.add(f)
    }
    for (let i = 0; i < 3; i++) {
      const f = feather(wl * 0.42, wh * 0.5, 0.35, 0.6, wh * 0.04)
      f.position.set(sx * th * (np * 1.6 + 2 + i * 1.6), wh * 0.18 - i * wh * 0.1, -wl * 0.22 - i * wl * 0.08)
      w.add(f)
    }
    w.rest = [o.wing.tilt ?? 0, sx * 0.08, sx * 0.3]
    w.rotation.set(...w.rest)
    body.add(w); wings.push(w)
  }

  const tl = o.tail.len, tw = o.tail.w, tip = o.tail.tip ?? 0.9
  const tail = new THREE.Group()
  tail.position.set(0, R * (o.tail.y ?? 0.15), -L * 0.46); tail.rotation.x = o.tail.cock ?? 0.1
  const th = Math.max(tl * 0.04, tw * 0.13)
  tail.add(loft([[0, 0, 0, tw * 0.3, th * 1.4], [0, 0, -tl * 0.25, tw * 0.42, th], [0, 0, -tl * 0.7, tw * 0.5, th * 0.8], [0, 0, -tl * 0.95, tw * 0.5 * tip, th * 0.5], [0, 0, -tl * 1.02, tw * 0.12 * tip, th * 0.25]], paint.tail, { seg: 10, frame: (p) => p }))
  body.add(tail)

  const nl = o.neck.len, nr = o.neck.r, lean = o.neck.lean ?? 0.3
  const neck = flexNeck(nl, nr, nr * (o.neck.base ?? 1.05), paint.neck ?? paint.body, Math.min(nl * 0.7, R * 0.45))
  neck.base = V(0, R * (o.neck.y ?? 0.35), L * (o.neck.z ?? 0.4))
  neck.rest = -pitch + lean
  body.add(neck.mesh)

  const hr = o.head.r, long = o.head.long ?? 1.1, hw = o.head.w ?? 0.85, hz = hr * (o.head.fwd ?? 0.35), hy = hr * 0.25
  const head = new THREE.Group()
  head.add(loft(HEAD.map(([z, r]) => [0, hy, hz + z * hr * long, hr * hw * r, hr * r, hr * r * 0.95]), paint.head, { frame: (p) => V(p.x / hr, (p.y - hy) / hr, (p.z - hz) / (hr * long)) }))
  const b = o.bill, c1 = new THREE.Color(b.c1), c2 = new THREE.Color(b.c2 ?? b.c1)
  const bill = loft([[0, 0, -b.len * 0.2, b.w, b.h, b.h], [0, -b.curve * 0.1, b.len * 0.3, b.w * 0.72, b.h * 0.66, b.h * 0.7], [0, -b.curve * 0.4, b.len * 0.68, b.w * 0.42, b.h * 0.36, b.h * 0.4], [0, -b.curve, b.len, b.w * 0.06, b.h * 0.06, b.h * 0.06]],
    b.paint ?? ((out, u, s) => out.copy(c1).lerp(c2, ss(-s, 0.05, 0.3))), { seg: 10, grain: 0.02, material: gloss })
  bill.position.set(0, hy - hr * (b.y ?? 0.15), hz + hr * long * 0.84)
  head.add(bill)
  // 碰地檢查用：嘴尖、下巴
  const probes = [V(0, bill.position.y - b.curve - b.h * 0.1, bill.position.z + b.len), V(0, hy - hr * 0.95, hz + hr * long * 0.2), V(0, bill.position.y - b.h, bill.position.z)]
  const e = o.eye
  const eyes = [1, -1].map((sx) => head.add(eye(e.r, e.iris, [sx * hr * hw * (e.x ?? 0.78), hy + hr * (e.y ?? 0.2), hz + hr * long * (e.z ?? 0.3)], sx, e.fwd ?? 0.3)).children.at(-1))
  body.add(head)
  o.extra?.({ root, body, neck, head, hr, hy, hz, long })

  const legs = [1, -1].map((sx) => {
    const l = makeLeg({ a: lg.tib, b: lg.tar, ra: lg.r * 2.2, rb: lg.r, ca: lg.thigh, cb: lg.c, bend: 1, x: sx * lg.x })
    birdFoot(l, lg.r, lg.toe, lg.c)
    root.add(l.hip)
    return l
  })
  return { root, body, neck, head, tail, wings, legs, bill, eyes, probes, o, nl, hr, blink: { next: rnd(1, 4), at: -1 } }
}

// 姿勢：c 是平滑後的數值，add 是每格直接疊上去的（點頭、快速動作）
const _pp = V(), _up = V(), _d = V(), _t0 = V(), _t3 = V(), _eb = V(), _q3 = new THREE.Quaternion(), _back = V(0, 0, -1), _e = new THREE.Euler(), _q2 = new THREE.Quaternion(), X = V(1, 0, 0), Y = V(0, 1, 0)
const POSE0 = { pitch: 0, crouch: 0, lean: 0, stretch: 0, yaw: 0, hp: 0, roll: 0, nyaw: 0, tail: 0, wing: 0, flare: 0, puff: 0 }
class Pose {
  constructor() { this.c = { ...POSE0 }; this.t = { ...POSE0 }; this.add = { ...POSE0 } }
  rest() { Object.assign(this.t, POSE0); Object.assign(this.add, POSE0); return this.t }
  step(dt, k = 6) { for (const key in this.t) this.c[key] = damp(this.c[key], this.t[key], k, dt) }
  v(key) { return this.c[key] + this.add[key] }
}
function birdPose(b, p, t) {
  const v = (k) => p.v(k), o = b.o
  b.body.rotation.x = o.pitch + v('pitch')
  b.body.position.y = o.H - v('crouch')
  const puff = 1 + v('puff') + 0.012 * Math.sin(t * 4.2)
  b.body.scale.set(puff, puff, 1 + v('puff') * 0.5)
  // 頭：位置 = 脖子根部往 lean 方向伸出 (1+stretch) 倍頸長；朝向用「世界」角度給（身體晃頭不跟著晃）
  const nk = b.neck, ny = v('nyaw'), bodyPitch = o.pitch + v('pitch')
  _d.set(0, Math.cos(nk.rest + v('lean')), Math.sin(nk.rest + v('lean'))).applyAxisAngle(Y, ny)
  b.head.position.copy(nk.base).addScaledVector(_d, b.nl * (1 + v('stretch')))
  _e.set(v('hp'), ny + v('yaw'), v('roll'), 'YXZ')
  b.head.quaternion.setFromEuler(_e).premultiply(_q2.setFromAxisAngle(X, -bodyPitch))
  // 頭和嘴不能鑽進地面（腳底 y = 0）：最低點低於地面就把頭往上抬
  b.body.updateMatrix(); b.head.updateMatrix()
  let low = Infinity
  for (const pr of b.probes) low = Math.min(low, _pp.copy(pr).applyMatrix4(b.head.matrix).applyMatrix4(b.body.matrix).y)
  const lift = b.hr * 0.05 - low
  if (lift > 0) b.head.position.addScaledVector(_up.set(0, 1, 0).applyAxisAngle(X, -bodyPitch), lift)
  // 脖子：從身體沿原本的頸根方向長出，從頭的後下方接進去
  // 頸根幾乎不動（粗的那段要留在胸口裡）；頭端的方向只跟脖子的轉向走，頭自己再在上面轉（鳥的寰椎關節很靈活）
  _t0.set(0, Math.cos(nk.rest + v('lean') * 0.25), Math.sin(nk.rest + v('lean') * 0.25))
  _e.set(v('hp'), ny + 0.3 * v('yaw'), 0, 'YXZ')
  _q3.setFromEuler(_e).premultiply(_q2)
  _t3.set(0, 1, 0.3).normalize().applyQuaternion(_q3)
  _eb.set(0, 0, -1).applyQuaternion(_q3)
  nk.update(nk.base, _t0, b.head.position, _t3, _back, _eb)
  // 眨眼（鳥是用瞬膜從前往後一抹，遠看就是眼睛瞇一下）
  const bl = b.blink
  if (t > bl.next) { bl.at = t; bl.next = t + rnd(1.5, 6) }
  const shut = t - bl.at < 0.14 ? Math.sin(((t - bl.at) / 0.14) * Math.PI) : 0
  b.eyes.forEach((e) => e.scale.set(1, 1 - 0.85 * shut, 1))
  b.tail.rotation.x = (o.tail.cock ?? 0.1) + v('tail')
  b.tail.scale.x = 1 + v('flare')
  b.wings.forEach((w, i) => { w.rotation.set(w.rest[0] - v('wing') * 0.5, w.rest[1], w.rest[2] - (i ? -1 : 1) * v('wing') * 0.6) })
}
const _hip = V()
function birdLegs(b, g) {
  b.body.updateMatrix()
  const o = b.o
  _hip.set(0, -o.R * 0.5, o.L * (o.legs.z ?? 0.02)).applyMatrix4(b.body.matrix)
  b.legs.forEach((l, k) => {
    const c = fract(g.phase + (g.together ? 0 : k * 0.5)), d = g.duty ?? 0.6, A = (g.stride ?? 0) * (g.amp ?? 0)
    let fz, fy = 0, lift = 0
    if (c < d) fz = A * d * (0.5 - c / d)
    else { const w = (c - d) / (1 - d); fz = A * d * (w - 0.5); lift = Math.sin(Math.PI * w) * (g.amp ?? 0); fy = (g.lift ?? 0) * lift }
    fy += l.ground + (g.tuck ?? 0)
    legIK(l, _hip.y, _hip.z, fy, _hip.z + fz + (o.legs.fz ?? 0))
    const curl = (g.curl ?? 0.05) + lift * 0.7 + (g.tuck ? 0.6 : 0)
    l.toes.forEach((t) => (t.rotation.x = curl))
  })
}

/* ---------- 行為 ---------- */
// 動作表：{ 名稱: [權重, 最短秒, 最長秒] }，時間到就隨機換下一個
class Acts {
  constructor(table, onStart) { this.table = table; this.onStart = onStart; this.next() }
  next(name) {
    const tb = this.table
    if (!name) {
      const keys = Object.keys(tb)
      let r = Math.random() * keys.reduce((s, k) => s + tb[k][0], 0)
      name = keys.find((k) => (r -= tb[k][0]) < 0) ?? keys[0]
    }
    Object.assign(this, { name, t: 0, dur: rnd(tb[name][1], tb[name][2]), r: Math.random() * 2 - 1, sgn: sgn() })
    this.onStart?.(name, this)
  }
  tick(dt) { this.t += dt; if (this.t >= this.dur) this.next() }
  get k() { return clamp(this.t / this.dur, 0, 1) }
}
// 小鳥看東西是一下一下跳著轉頭
class Glance {
  constructor(rate = [0.35, 1.4], yaw = 0.9, pitch = 0.35) { Object.assign(this, { rate, Y: yaw, P: pitch, t: 0, yaw: 0, hp: 0, roll: 0 }) }
  update(dt) {
    if ((this.t -= dt) > 0) return
    this.t = rnd(...this.rate); this.yaw = rnd(-this.Y, this.Y); this.hp = rnd(-this.P, this.P * 0.6)
    this.roll = Math.random() < 0.25 ? rnd(-0.5, 0.5) : 0
  }
}
// 在地上（或任何平面）走到隨機目標點
class Walker {
  constructor({ radius, speed, turn = 2.5, center = [0, 0], avoid }) {
    Object.assign(this, { radius, speed, turn, center, avoid, p: new THREE.Vector2(...center), h: 0, goal: null, want: null, v: 0 })
  }
  pick(min = 0.3, max = 99) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = this.radius * Math.sqrt(Math.random())
      const x = this.center[0] + Math.cos(a) * r, z = this.center[1] + Math.sin(a) * r
      const d = Math.hypot(x - this.p.x, z - this.p.y)
      if (d < min || d > max || this.avoid?.(x, z, this.p)) continue
      this.goal = new THREE.Vector2(x, z); this.want = null
      return true
    }
    return false
  }
  update(dt) {
    let target = this.want, d = 0
    if (this.goal) { const dx = this.goal.x - this.p.x, dz = this.goal.y - this.p.y; d = Math.hypot(dx, dz); target = Math.atan2(dx, dz) }
    if (target == null) { this.v = 0; return 0 }
    const diff = wrap(target - this.h), dh = clamp(diff, -this.turn * dt, this.turn * dt)
    this.h += dh
    let step = 0
    if (this.goal) {
      step = Math.min(this.speed * clamp(1.2 - Math.abs(diff), 0, 1) * dt, d)
      this.p.x += Math.sin(this.h) * step; this.p.y += Math.cos(this.h) * step
      if (d - step < 0.02) this.goal = null
    } else if (Math.abs(diff) < 0.02) this.want = null
    this.v = step / dt
    return step + Math.abs(dh) * 0.12
  }
  get busy() { return !!(this.goal || this.want != null) }
}
// 沿樹枝跳
class Hopper {
  constructor(env, { hop = [0.15, 0.4], rest = [0.8, 3.5], dur = 0.26, span = [0.45, 1.25], blocked } = {}) {
    Object.assign(this, { env, hopR: hop, restR: rest, dur, span, blocked })
    const { min, max } = env.branch
    this.s = rnd(min + 0.2, max - 0.1); this.k = 1; this.y = 0; this.wait = rnd(...rest); this.landed = 9
    this.h = this.wantH = this.face(sgn())
  }
  face(dir) {
    const tc = this.env.toCam, turn = rnd(...this.span)
    return Math.atan2(dir * Math.cos(turn) + tc.x * Math.sin(turn), tc.z * Math.sin(turn))
  }
  update(dt) {
    this.landed += dt
    if (this.k < 1) {
      this.k = Math.min(1, this.k + dt / this.dur)
      const e = this.k * this.k * (3 - 2 * this.k)
      this.s = lerp(this.s0, this.s1, e); this.y = this.arc * Math.sin(Math.PI * this.k)
      if (this.k >= 1) { this.landed = 0; this.y = 0 }
    } else if ((this.wait -= dt) <= 0) this.jump()
    this.h = dampAngle(this.h, this.wantH, 14, dt)
  }
  jump() {
    const { min, max } = this.env.branch
    let dir = sgn()
    const len = Math.random() < 0.3 ? 0 : rnd(...this.hopR)    // 有時只是原地轉個方向
    if (this.s + dir * len > max || this.s + dir * len < min) dir = -dir
    const s1 = clamp(this.s + dir * len, min, max)
    if (this.blocked?.(s1, this)) { this.wait = 0.4; return }
    Object.assign(this, { s0: this.s, s1, k: 0, arc: 0.06 + len * 0.3, wait: rnd(...this.restR) })
    this.wantH = this.face(len ? dir : -Math.sign(Math.sin(this.h)) || 1)
  }
  get hopping() { return this.k < 1 }
  get pre() { return this.k >= 1 ? 1 - clamp(this.wait / 0.12, 0, 1) : 0 }   // 起跳前蹲一下
}

/* ---------- 影子 ---------- */
let blobTex
function contactShadow(r, strength = 0.45) {
  if (!blobTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, '#fff'); g.addColorStop(0.45, '#999'); g.addColorStop(1, '#000')
    x.fillStyle = g; x.fillRect(0, 0, 64, 64)
    blobTex = new THREE.CanvasTexture(c)
  }
  const g = new THREE.Group()
  // 柔和的接觸陰影
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobTex, transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  // 接住太陽即時陰影的圓盤（地面本身是烘焙的，不接即時陰影），邊緣淡出
  const sm = new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })
  const R = r * 3
  sm.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position.xz;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vLocal;')
      .replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', `gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) * ( 1.0 - smoothstep( ${(R * 0.55).toFixed(4)}, ${R.toFixed(4)}, length( vLocal ) ) ) );`)
  }
  const catcher = new THREE.Mesh(new THREE.CircleGeometry(R, 32).rotateX(-Math.PI / 2), sm)
  catcher.receiveShadow = true; catcher.userData.catcher = true
  catcher.position.y = r * 0.004
  g.add(blob, catcher)
  return g
}

/* ---------- 共用的地面鳥行為 ---------- */
function groundBird(b, S, env, cfg) {
  b.root.scale.setScalar(S)
  b.root.add(contactShadow(cfg.shadow))
  const w = new Walker({ radius: cfg.radius, speed: cfg.speed, turn: cfg.turn ?? 2.5 })
  w.h = env.face(sgn(), rnd(0.3, 0.8))
  const pose = new Pose(), gait = { phase: 0, amp: 0, stride: cfg.stride, lift: cfg.lift, duty: 0.6 }
  const acts = new Acts(cfg.acts, (n, a) => {
    if (n === 'walk') w.speed = cfg.speed * (Math.random() < (cfg.hurry ?? 0) ? 2.5 : 1)   // 偶爾小跑步
    if (n === 'walk' && !w.pick(cfg.minWalk ?? 0.3, cfg.maxWalk)) a.next('look')
    if (n === 'turn') w.want = w.h + a.sgn * rnd(0.6, 2.2)
  })
  const focus = V()
  return {
    obj: b.root, focus,
    update(t, dt) {
      acts.tick(dt)
      const d = w.update(dt)
      if ((acts.name === 'walk' || acts.name === 'turn') && !w.busy) acts.next()
      gait.phase += d / (cfg.stride * S)
      gait.amp = damp(gait.amp, w.busy ? 1 : 0, 8, dt)
      const k = cfg.pose(acts, pose.rest(), pose.add, t, gait, w) ?? 6
      pose.step(dt, k)
      birdPose(b, pose, t)
      birdLegs(b, gait)
      b.root.position.set(w.p.x, 0, w.p.y); b.root.rotation.y = w.h
      focus.set(w.p.x, cfg.focusY, w.p.y)
    },
    acts, walker: w,
  }
}

/* ---------- 共用的停枝鳥行為 ---------- */
function perchBird(b, S, env, cfg = {}) {
  b.root.scale.setScalar(S)
  const hp = new Hopper(env, cfg.hopper)
  const gl = new Glance(cfg.glance, cfg.yaw, cfg.pitch)
  const pose = new Pose(), focus = V()
  const legLen = b.o.legs.tib + b.o.legs.tar
  const acts = cfg.acts ? new Acts(cfg.acts) : null
  const st = { hp, landed: 9 }
  const update = (t, dt) => {
    acts?.tick(dt)
    if (acts && acts.name !== 'idle') hp.wait = Math.max(hp.wait, 0.3)   // 做別的事時不跳
    hp.update(dt); gl.update(dt)
    const tg = pose.rest(), air = hp.hopping ? Math.sin(Math.PI * hp.k) : 0
    const bounce = hp.hopping ? 0 : Math.max(0, 1 - hp.landed * 5)
    tg.yaw = gl.yaw; tg.hp = gl.hp; tg.roll = gl.roll
    tg.crouch = legLen * (0.3 * hp.pre + 0.25 * bounce)
    pose.add.tail = 0.5 * Math.exp(-hp.landed * 4) * Math.sin(hp.landed * 14) + 0.2 * air
    pose.add.wing = 0.35 * air
    const k = cfg.custom?.(acts, tg, pose.add, t, hp) ?? 16
    pose.step(dt, k)
    birdPose(b, pose, t)
    birdLegs(b, { phase: 0, amp: 0, tuck: legLen * 0.45 * air, curl: 0.9 })
    b.root.position.set(hp.s, env.branch.top(hp.s) + hp.y, 0)
    b.root.rotation.y = hp.h
    focus.set(hp.s, 0.3, 0)
  }
  return { obj: b.root, focus, update, hopper: hp, st, acts }
}

/* ---------- 各種動物 ---------- */
const BUILD = {
  heron(env) {
    // 黑冠麻鷺：依實拍影片（大安森林公園）校正——身體細長、走路時水平；羽色是偏灰的褐色，頭頸才是紅褐；
    // 腳長、抬得高；警戒時整個身體立起來、脖子伸直；拔蚯蚓要往後扯好幾下才吞下去
    const P = K({ back: 0x8c7a68, bar: 0x4e4034, buff: 0xcdb894, streak: 0x7a6450, rufous: 0xb3764a, black: 0x2c2b2d, white: 0xe9e1d2, blue: 0x7aa6c4, prim: 0x3b332c, tip: 0xa48f78, tail: 0x5a4c40, worm: 0xb0645c })
    const vermic = (o, q, f = 1) => o.lerp(P.bar, 0.3 * f * ss(Math.sin(q.z * 130 + q.x * 30 + Math.sin(q.x * 45 + q.y * 17) * 2.4), 0.45, 0.95))
    let worm
    const b = bird({
      L: 0.27, R: 0.066, W: 0.86, pitch: 0, belly: 1.05,
      neck: { len: 0.14, r: 0.03, lean: 0.75, y: 0.25, z: 0.38, base: 1.35 },
      head: { r: 0.03, long: 1.2, w: 0.8 },
      bill: { len: 0.05, w: 0.009, h: 0.012, curve: 0.005, c1: 0x2c2b28, c2: 0x8a8a5a },
      eye: { r: 0.0068, iris: 0xe0bb1c, fwd: 0.45, x: 0.74 },
      wing: { len: 0.22, h: 0.075, y: 0.25 },
      tail: { len: 0.06, w: 0.05, cock: 0 },
      legs: { tib: 0.105, tar: 0.1, r: 0.0055, c: 0x8b9670, thigh: 0x9a8670, toe: 0.05, x: 0.03, stand: 0.85 },
      paint: {
        body: (o, u, s, c, q) => {
          vermic(o.copy(P.back), q)
          tmp.copy(P.buff).lerp(P.streak, 0.45 * ss(Math.abs(Math.sin(c * 8)), 0.82, 0.97))
          o.lerp(tmp, ss(-s, -0.05, 0.4) * ss(u, 0.35, 0.6))
          o.lerp(P.buff, ss(-s, 0, 0.4) * (1 - ss(u, 0.3, 0.5)))
        },
        wing: (o, u, s, c, p) => {
          vermic(o.copy(P.back), V(p.x * 12, p.y * 12, p.z * 5))
          if (u > 0.55) o.lerp(P.prim, 0.7 * ss(u, 0.55, 0.68) * ss(-s, -0.6, 0.2)).lerp(P.tip, ss(u, 0.9, 0.96))
        },
        tail: solid(P.tail),
        neck: (o, u, s, c) => {
          o.copy(P.rufous).lerp(P.back, 0.4 * (1 - ss(u, 0.15, 0.4)))
          const front = ss(-s, 0.35, 0.7)
          tmp.copy(P.white).lerp(P.black, ss(0.2, 0.1, Math.abs(c)) * 0.8).lerp(P.streak, 0.35 * ss(Math.abs(Math.sin(c * 11)), 0.8, 0.95))
          o.lerp(tmp, front)
        },
        head: (o, u, s, c, q) => {
          o.copy(P.rufous)
          o.lerp(P.black, ss(q.y, 0.15, 0.35))
          const lore = ss(q.z, 0.3, 0.45) * ss(Math.abs(q.x), 0.3, 0.5) * ss(q.y, -0.3, -0.15) * (1 - ss(q.y, 0.3, 0.45))
          o.lerp(P.blue, lore)
          o.lerp(P.white, ss(-q.y, 0.55, 0.75) * ss(q.z, -0.2, 0.1))
        },
      },
      extra: ({ head, hr, hy, hz, long }) => {
        // 深灰黑的短冠羽，往後垂
        head.add(loft([[0, hy + hr * 0.75, hz - hr * 0.1, hr * 0.42, hr * 0.22], [0, hy + hr * 0.62, hz - hr * 0.9, hr * 0.32, hr * 0.2], [0, hy + hr * 0.3, hz - hr * 1.6, hr * 0.16, hr * 0.1], [0, hy + hr * 0.1, hz - hr * 1.9, hr * 0.03, hr * 0.02]], solid(P.black)))
        // 嘴裡叼的蚯蚓（拔蚯蚓時才出現）
        worm = loft([[0, 0, 0, 0.0035, 0.0035], [0.004, -0.03, 0.006, 0.004, 0.004], [-0.004, -0.06, -0.002, 0.0035, 0.0035], [0.002, -0.085, 0.004, 0.002, 0.002]], (o, u) => o.copy(P.worm).multiplyScalar(0.85 + 0.3 * Math.abs(Math.sin(u * 40))), { up: V(0, 0, 1), material: gloss })
        worm.position.set(0, hy - hr * 0.2, hz + hr * long * 0.84 + 0.045)
        worm.visible = false
        head.add(worm)
      },
    })
    return groundBird(b, 2.6, env, {
      shadow: 0.13, radius: 1.6, speed: 0.32, hurry: 0.2, turn: 1.6, stride: 0.17, lift: 0.07, focusY: 0.75, minWalk: 0.5,
      acts: { walk: [3, 99, 99], stare: [3, 2, 5], strike: [1, 1.6, 1.6], worm: [0.6, 6, 8], alert: [1.5, 2, 5], look: [1.5, 1.5, 3.5], preen: [0.6, 2, 3.5], turn: [1, 99, 99], shake: [0.4, 0.7, 0.7] },
      pose(a, tg, add, t, gait) {
        const k = a.k
        tg.hp = 0.15; tg.stretch = -0.2; tg.lean = 0.1
        worm.visible = a.name === 'worm' && k > 0.1 && k < 0.92
        switch (a.name) {
          case 'walk': case 'turn':
            // 走路：身體水平，脖子往前伸、頭平平的，每一步頭跟著點一下
            Object.assign(tg, { lean: 0.45, stretch: 0.15, hp: 0.2, pitch: 0.05 })
            add.lean = 0.07 * Math.sin(gait.phase * Math.PI * 4) * gait.amp
            break
          case 'stare': {
            // 盯地面：脖子左右慢慢晃，頭一直對著同一個點（用視差判斷蚯蚓的位置），晃一陣停一陣
            Object.assign(tg, { lean: 1.0, stretch: 0.12, hp: 1.0, pitch: 0.22, roll: 0.15 * a.r, crouch: 0.012 })
            const sway = 0.38 * ss(Math.sin(t * 0.45 + a.r * 4), -0.3, 0.3) * Math.sin(t * 3.4)
            add.nyaw = sway; add.yaw = -0.95 * sway
            break
          }
          case 'alert': {
            // 警戒：整隻立起來，脖子伸直朝上，頭水平；脖子也會小幅左右晃
            Object.assign(tg, { pitch: -0.8, crouch: -0.035, lean: 0.1, stretch: 0.55, hp: -0.05, yaw: 0.4 * Math.sin(t * 0.6 + a.r * 3) })
            const sway = 0.18 * Math.sin(t * 2.6)
            add.nyaw = sway; add.yaw = -0.8 * sway
            return 4
          }
          case 'strike':
            if (k < 0.35) Object.assign(tg, { lean: 0.95, hp: 1.05, pitch: 0.25, crouch: 0.015 })
            else if (k < 0.5) Object.assign(tg, { lean: 1.6, hp: 1.35, pitch: 0.45, stretch: 0.6, crouch: 0.03 })
            else if (k < 0.7) Object.assign(tg, { lean: 0.25, hp: -0.4, stretch: -0.05 })
            else Object.assign(tg, { lean: 0.2, hp: 0.1 })
            add.lean = k > 0.55 && k < 0.7 ? 0.08 * Math.sin(t * 40) : 0   // 吞下去
            return k > 0.3 && k < 0.55 ? 22 : 8
          case 'worm': {
            // 拔蚯蚓：啄下去咬住 → 身體往後坐、一下一下往後扯 → 抬頭仰脖子吞
            if (k < 0.1) Object.assign(tg, { lean: 1.6, hp: 1.35, pitch: 0.45, stretch: 0.6, crouch: 0.03 })
            else if (k < 0.75) {
              const pull = Math.pow(Math.max(0, Math.sin(t * 5)), 2)
              Object.assign(tg, { lean: 1.35, hp: 1.25, pitch: 0.15, stretch: 0.4, crouch: 0.02 })
              add.lean = -0.55 * pull; add.pitch = -0.25 * pull; add.stretch = -0.25 * pull; add.hp = -0.2 * pull
              worm.scale.y = 1
            } else {
              Object.assign(tg, { lean: 0.3, hp: -0.7, stretch: -0.18, pitch: -0.1 })
              add.lean = 0.06 * Math.sin(t * 30)
              worm.scale.y = Math.max(0.05, 1 - (k - 0.75) / 0.17)
            }
            return 12
          }
          case 'look': Object.assign(tg, { yaw: 1.0 * a.r, hp: -0.1, stretch: 0.45, lean: -0.2 }); break
          case 'preen': Object.assign(tg, { lean: -0.3, nyaw: 0.85 * a.sgn, yaw: 1.6 * a.sgn, hp: 0.9, roll: 0.5 * a.sgn }); add.hp = 0.15 * Math.sin(t * 9); break
          case 'shake': Object.assign(tg, { puff: 0.12, wing: 0.25 }); add.roll = 0.35 * Math.sin(t * 38) * Math.sin(Math.PI * k); add.wing = 0.15 * Math.sin(t * 45); return 14
        }
      },
    })
  },

  dove(env) {
    // 珠頸斑鳩：邊走邊點頭，一路啄地上的草籽
    const P = K({ head: 0x9b9396, pink: 0xbb948a, pale: 0xd9c8c2, back: 0x8a705a, dark: 0x5c4838, fringe: 0xb79e86, prim: 0x4a4038, black: 0x1b1817, white: 0xf2efea, tailc: 0x6f5a4a })
    const scallop = (o, u, s) => o.lerp(P.dark, 0.55 * ss(Math.sin(u * 30) * Math.sin(s * 7 + 0.5), 0.35, 0.8)).lerp(P.fringe, 0.4 * ss(Math.sin(u * 30 + 1.4) * Math.sin(s * 7 + 2), 0.6, 0.95))
    const b = bird({
      L: 0.14, R: 0.048, W: 0.95, pitch: -0.05, belly: 1.05,
      neck: { len: 0.045, r: 0.022, lean: 0.35 },
      head: { r: 0.021, long: 1.05, w: 0.85 },
      bill: { len: 0.015, w: 0.0045, h: 0.005, curve: 0.002, c1: 0x3a3438, paint: (o, u) => o.set(u < 0.3 ? 0x9a8a8a : 0x3a3438) },
      eye: { r: 0.0045, iris: 0xd0602a, x: 0.8 },
      wing: { len: 0.14, h: 0.055, y: 0.15 },
      tail: { len: 0.13, w: 0.055, cock: 0.12, tip: 0.85 },
      legs: { tib: 0.034, tar: 0.026, r: 0.0035, c: 0xc24f4f, thigh: 0xbfa093, toe: 0.022, x: 0.016, stand: 0.88 },
      paint: {
        body: (o, u, s, c, q) => {
          scallop(o.copy(P.back), u * 1.5, c * 2)
          o.lerp(P.pink, ss(-s, -0.1, 0.4) * ss(u, 0.3, 0.6))
          o.lerp(P.pale, ss(-s, 0, 0.5) * (1 - ss(u, 0.2, 0.45)))
        },
        wing: (o, u, s) => { scallop(o.copy(P.back), u, s); o.lerp(P.prim, ss(u, 0.62, 0.75) * ss(-s, -0.7, 0.1)) },
        tail: (o, u, s, c) => {
          o.copy(P.tailc)
          const outer = ss(Math.abs(c), 0.35, 0.6)
          o.lerp(P.black, outer).lerp(P.white, outer * ss(u, 0.72, 0.8))
        },
        neck: (o, u, s, c, q) => {
          o.copy(P.pink).lerp(P.head, ss(u, 0.6, 0.9))
          const collar = ss(-s, -0.5, -0.25) * ss(q.y, -0.05, 0.1) * (1 - ss(q.y, 0.6, 0.75))
          tmp.copy(P.black).lerp(P.white, ss(Math.sin(q.x * 10) * Math.sin(q.y * 26) + Math.sin(q.z * 9) * 0.3, 0.35, 0.6))
          o.lerp(tmp, collar)
        },
        head: (o, u, s, c, q) => o.copy(P.head).lerp(P.pink, ss(-q.y, 0.2, 0.7)),
      },
    })
    return groundBird(b, 3.3, env, {
      shadow: 0.07, radius: 1.6, speed: 0.55, turn: 4, stride: 0.07, lift: 0.025, focusY: 0.45, minWalk: 0.25, maxWalk: 0.9,
      acts: { walk: [5, 99, 99], peck: [5, 0.5, 1.6], look: [2, 0.8, 2.2], turn: [1.5, 99, 99], preen: [0.5, 1.5, 3], fluff: [0.5, 1.5, 3] },
      pose(a, tg, add, t, gait) {
        const k = a.k
        switch (a.name) {
          case 'walk': case 'turn': {
            // 鴿子走路：頭先停在空中，再往前一推
            const h = fract(gait.phase * 2)
            add.lean = (h < 0.7 ? 0.35 - (h / 0.7) * 0.7 : -0.35 + ((h - 0.7) / 0.3) * 0.7) * gait.amp
            tg.hp = 0.1
            break
          }
          case 'peck': {
            const n = Math.max(1, Math.round(a.dur / 0.5)), w = fract(k * n), dn = Math.pow(Math.sin(Math.PI * w), 0.6)
            Object.assign(tg, { pitch: 0.35 })
            add.lean = 1.25 * dn; add.hp = 1.1 * dn; add.pitch = 0.2 * dn
            return 10
          }
          case 'look': Object.assign(tg, { yaw: 0.9 * a.r, hp: -0.15, stretch: 0.2 }); break
          case 'preen': Object.assign(tg, { lean: -0.3, nyaw: 0.85 * a.sgn, yaw: 1.6 * a.sgn, hp: 0.8 }); add.hp = 0.15 * Math.sin(t * 10); break
          case 'fluff': Object.assign(tg, { puff: 0.1, stretch: -0.4, crouch: 0.012 }); break
        }
      },
    })
  },

  nightheron(env) {
    // 夜鷺：縮脖子站在水邊，偶爾伸長脖子盯水面
    const P = K({ cap: 0x1b2433, grey: 0x8f969f, wing: 0x9ba3ac, prim: 0x6f767f, white: 0xe8ebec, under: 0xd9dde0 })
    const b = bird({
      L: 0.26, R: 0.095, W: 0.95, pitch: -0.5, belly: 1.1,
      neck: { len: 0.11, r: 0.045, lean: 0.2, y: 0.3, z: 0.36, base: 1.25 },
      head: { r: 0.043, long: 1.1, w: 0.85 },
      bill: { len: 0.07, w: 0.013, h: 0.016, curve: 0.005, c1: 0x141414 },
      eye: { r: 0.0085, iris: 0xc81c22, fwd: 0.4, x: 0.76 },
      wing: { len: 0.24, h: 0.08, y: 0.35 },
      tail: { len: 0.09, w: 0.07, cock: 0 },
      legs: { tib: 0.09, tar: 0.085, r: 0.0065, c: 0xd2bf48, thigh: 0xd8dcde, toe: 0.055, x: 0.036 },
      paint: {
        body: (o, u, s) => { o.copy(P.grey).lerp(P.cap, ss(s, 0.05, 0.3) * ss(u, 0.35, 0.5)); o.lerp(P.under, ss(-s, -0.25, 0.1)) },
        wing: (o, u, s) => o.copy(P.wing).lerp(P.prim, ss(u, 0.6, 0.75)).lerp(P.white, 0.25 * ss(-s, 0.7, 0.95)),
        tail: solid(P.grey),
        neck: (o, u, s) => o.copy(P.white).lerp(P.under, ss(s, 0.3, 0.8)),
        head: (o, u, s, c, q) => {
          o.copy(P.white)
          const cap = ss(q.y, 0.1, 0.25)
          const brow = ss(q.z, 0.35, 0.55) * ss(q.y, 0.15, 0.3) * (1 - ss(q.y, 0.45, 0.6))
          o.lerp(P.cap, cap * (1 - brow))
        },
      },
      extra: ({ head, hr, hy, hz }) => {
        // 兩根白色長飾羽，從後腦垂到背上
        for (const sx of [1, -1]) head.add(loft([[sx * hr * 0.1, hy + hr * 0.5, hz - hr * 0.6, hr * 0.06, hr * 0.06], [sx * hr * 0.2, hy + hr * 0.1, hz - hr * 2.4, hr * 0.05, hr * 0.04], [sx * hr * 0.25, hy - hr * 1.0, hz - hr * 4.2, hr * 0.03, hr * 0.02], [sx * hr * 0.25, hy - hr * 1.7, hz - hr * 5.0, hr * 0.005, hr * 0.005]], solid(P.white), { seg: 6 }))
      },
    })
    return groundBird(b, 2.4, env, {
      shadow: 0.12, radius: 0.7, speed: 0.22, turn: 1.2, stride: 0.13, lift: 0.04, focusY: 0.8, minWalk: 0.3,
      acts: { stand: [5, 3, 7], hunt: [3, 2.5, 5], walk: [1, 99, 99], turn: [1, 99, 99], strike: [0.6, 1.6, 1.6], look: [2, 1.5, 3], preen: [0.6, 2, 3.5] },
      pose(a, tg, add, t) {
        const k = a.k
        tg.stretch = -0.35; tg.hp = 0.05
        switch (a.name) {
          case 'walk': case 'turn': Object.assign(tg, { stretch: 0.1, lean: 0.3, hp: 0.3, pitch: 0.15 }); break
          case 'hunt': Object.assign(tg, { stretch: 0.8, lean: 0.55, hp: 0.65, pitch: 0.35, yaw: 0.2 * a.r }); break
          case 'strike':
            if (k < 0.35) Object.assign(tg, { stretch: 0.8, lean: 0.6, hp: 0.7, pitch: 0.35 })
            else if (k < 0.5) Object.assign(tg, { stretch: 1.3, lean: 1.3, hp: 1.3, pitch: 0.6 })
            else Object.assign(tg, { stretch: 0.1, lean: 0.1, hp: -0.2 })
            return k > 0.3 && k < 0.55 ? 22 : 8
          case 'look': Object.assign(tg, { yaw: 1.1 * a.r, stretch: 0 }); break
          case 'preen': Object.assign(tg, { stretch: 0.2, lean: -0.3, nyaw: 0.85 * a.sgn, yaw: 1.6 * a.sgn, hp: 0.9 }); add.hp = 0.12 * Math.sin(t * 8); break
          case 'stand': tg.yaw = 0.3 * Math.sin(t * 0.3 + a.r * 3); break
        }
      },
    })
  },

  bulbul(env) {
    // 白頭翁：黑頭、後腦一大塊白斑、耳後小白點
    const P = K({ back: 0x7d7e66, olive: 0x87914f, band: 0xa4a092, white: 0xedebe3, vent: 0xe6e2c4, wing: 0x7e923f, prim: 0x51563c, tail: 0x6c744a, edge: 0x8f9a4a, black: 0x161616 })
    const b = bird({
      L: 0.075, R: 0.028, pitch: -0.6,
      neck: { len: 0.012, r: 0.016, lean: 0.5 },
      head: { r: 0.017, long: 1.05, w: 0.9 },
      bill: { len: 0.012, w: 0.004, h: 0.005, curve: 0.002, c1: 0x1a1a1a },
      eye: { r: 0.0035, iris: 0x2a1a10 },
      wing: { len: 0.075, h: 0.03 },
      tail: { len: 0.08, w: 0.03, cock: 0.15 },
      legs: { tib: 0.018, tar: 0.018, r: 0.0022, c: 0x2b2622, thigh: 0x9a9a88, toe: 0.014, x: 0.01, stand: 0.55 },
      paint: {
        body: (o, u, s) => {
          o.copy(P.back).lerp(P.olive, 0.4 * ss(s, 0.2, 0.8))
          tmp.copy(P.white).lerp(P.band, ss(u, 0.6, 0.75)).lerp(P.vent, 1 - ss(u, 0.15, 0.3))
          o.lerp(tmp, ss(-s, -0.2, 0.25))
        },
        wing: (o, u, s) => o.copy(P.wing).lerp(P.prim, ss(u, 0.55, 0.7) * ss(-s, -0.6, 0.3)),
        tail: (o, u, s, c) => o.copy(P.tail).lerp(P.edge, ss(Math.abs(c), 0.6, 0.85)),
        neck: (o, u, s) => o.copy(P.black).lerp(P.white, ss(-s, 0.2, 0.5)),
        head: (o, u, s, c, q) => {
          o.copy(P.black)
          o.lerp(P.white, ss(q.y, 0.1, 0.25) * (1 - ss(q.z, -0.15, 0.05)))                     // 後腦白斑
          o.lerp(P.white, ss(Math.abs(q.x), 0.55, 0.7) * band2(q.z, -0.4, -0.05) * band2(q.y, -0.5, -0.1))   // 耳羽白點
          o.lerp(P.white, ss(-q.y, 0.55, 0.7) * ss(q.z, -0.1, 0.15))                            // 喉
        },
      },
    })
    return perchBird(b, 4.2, env, { acts: { idle: [6, 2, 6], preen: [1, 1.5, 3], sing: [1.5, 1.2, 2.5] }, custom: songbirdActs })
  },

  whiteeye(env) {
    // 綠繡眼：一小群三隻，在枝條上跳來跳去
    const P = K({ green: 0x93b03a, yellow: 0xf0d13a, white: 0xe2e4d8, flank: 0xc4c4b4, wing: 0x86a332, prim: 0x58692a, ring: 0xfbfbf6 })
    const birds = []
    const blocked = (s1, me) => birds.some((o) => o.hopper !== me && Math.abs(o.hopper.s - s1) < 0.28)
    for (let i = 0; i < 3; i++) {
      const b = bird({
        L: 0.045, R: 0.017, pitch: -0.5,
        neck: { len: 0.008, r: 0.01, lean: 0.5 },
        head: { r: 0.0115, long: 1.05, w: 0.9 },
        bill: { len: 0.009, w: 0.0022, h: 0.0026, curve: 0.002, c1: 0x2a2a2a },
        eye: { r: 0.0026, iris: 0x3a2a1a },
        wing: { len: 0.045, h: 0.018 },
        tail: { len: 0.04, w: 0.016, cock: 0.2 },
        legs: { tib: 0.011, tar: 0.012, r: 0.0014, c: 0x5c6474, thigh: 0xb6c25a, toe: 0.009, x: 0.006, stand: 0.55 },
        paint: {
          body: (o, u, s) => {
            o.copy(P.green)
            tmp.copy(P.white).lerp(P.flank, ss(Math.abs(s), 0.3, 0.6) * 0.6).lerp(P.yellow, ss(u, 0.72, 0.85))
            o.lerp(tmp, ss(-s, -0.2, 0.25))
          },
          wing: (o, u, s) => o.copy(P.wing).lerp(P.prim, ss(u, 0.55, 0.7) * ss(-s, -0.6, 0.3)),
          tail: solid(P.prim),
          neck: (o, u, s) => o.copy(P.green).lerp(P.yellow, ss(-s, -0.1, 0.3)),
          head: (o, u, s, c, q) => {
            o.copy(P.green).lerp(P.yellow, ss(-q.y, 0.2, 0.45) * ss(q.z, -0.3, 0))
            const d = Math.hypot(q.y - 0.2, q.z - 0.3)
            o.lerp(P.ring, ss(Math.abs(q.x), 0.45, 0.6) * band2(d, 0.2, 0.42))   // 白眼圈
          },
        },
      })
      const pb = perchBird(b, 4.1, env, { hopper: { hop: [0.12, 0.35], rest: [0.3, 1.6], dur: 0.2, blocked }, glance: [0.2, 0.8], yaw: 1.1, acts: { idle: [6, 1, 4], preen: [1, 1, 2] }, custom: songbirdActs })
      birds.push(pb)
    }
    birds[0].hopper.s = -0.9; birds[1].hopper.s = -0.45; birds[2].hopper.s = 0
    const focus = V()
    return {
      obj: new THREE.Group().add(...birds.map((b) => b.obj)), focus,
      update(t, dt) { birds.forEach((b) => b.update(t, dt)); focus.set(birds.reduce((s, b) => s + b.hopper.s, 0) / 3, 0.25, 0) },
    }
  },

  barbet(env) {
    // 五色鳥：綠身體、藍臉、黃額黃喉、紅色眼先，會鼓著喉嚨「咯咯咯」叫
    const P = K({ green: 0x3f9a3f, belly: 0x79b54e, blue: 0x2f6fd0, yellow: 0xf2d12c, red: 0xd42a20, black: 0x111111, wing: 0x3a8c3c, prim: 0x2a6a5a, tail: 0x2f7f6a })
    const b = bird({
      L: 0.08, R: 0.034, pitch: -0.8,
      neck: { len: 0.012, r: 0.022, lean: 0.6 },
      head: { r: 0.023, long: 1.0, w: 0.92 },
      bill: { len: 0.022, w: 0.008, h: 0.009, curve: 0.003, c1: 0x1c1c1c },
      eye: { r: 0.0042, iris: 0x5a2418 },
      wing: { len: 0.07, h: 0.034 },
      tail: { len: 0.05, w: 0.03, cock: 0.2 },
      legs: { tib: 0.016, tar: 0.018, r: 0.0025, c: 0x6f7768, thigh: 0x5aa04a, toe: 0.014, x: 0.011, stand: 0.55 },
      paint: {
        body: (o, u, s, c) => {
          o.copy(P.green).lerp(P.belly, ss(-s, -0.1, 0.4))
          o.lerp(P.blue, ss(u, 0.82, 0.88) * ss(-s, 0.2, 0.5))
          o.lerp(P.red, ss(u, 0.88, 0.93) * ss(-s, 0.55, 0.8) * ss(0.4, 0.2, Math.abs(c)))
        },
        wing: (o, u, s) => o.copy(P.wing).lerp(P.prim, ss(u, 0.5, 0.7) * ss(-s, -0.6, 0.3)),
        tail: solid(P.tail),
        neck: (o, u, s) => o.copy(P.green).lerp(P.yellow, ss(-s, 0.1, 0.4)),
        head: (o, u, s, c, q) => {
          o.copy(P.blue).lerp(P.green, ss(-q.z, 0.45, 0.7))
          o.lerp(P.yellow, ss(q.z, 0.4, 0.55) * ss(q.y, 0.25, 0.4))                      // 黃額
          o.lerp(P.black, ss(Math.abs(q.x), 0.5, 0.6) * band2(q.y, 0.08, 0.32) * band2(q.z, -0.45, 0.55))   // 過眼黑線
          o.lerp(P.red, ss(q.z, 0.55, 0.65) * band2(q.y, -0.05, 0.25) * ss(Math.abs(q.x), 0.3, 0.45))   // 紅眼先
          o.lerp(P.yellow, ss(-q.y, 0.35, 0.5))                                          // 黃喉
        },
      },
    })
    return perchBird(b, 4.2, env, { hopper: { rest: [2, 7] }, acts: { idle: [4, 2, 5], call: [3, 2, 4], preen: [0.8, 1.5, 3] }, custom: songbirdActs })
  },

  treepie(env) {
    // 樹鵲：長尾巴，跳一下尾巴就像鐘擺一樣晃
    const P = K({ face: 0x141416, grey: 0x8f9396, brown: 0x6b4630, rump: 0xb8b6ae, under: 0xa59c90, vent: 0xa65a2e, wing: 0x18181a, white: 0xeeeeea, tail: 0x1c1c1e })
    const b = bird({
      L: 0.1, R: 0.036, W: 0.95, pitch: -0.35,
      neck: { len: 0.015, r: 0.02, lean: 0.45 },
      head: { r: 0.02, long: 1.1, w: 0.88 },
      bill: { len: 0.02, w: 0.0065, h: 0.008, curve: 0.005, c1: 0x151515 },
      eye: { r: 0.0036, iris: 0x5a2a1a },
      wing: { len: 0.1, h: 0.04 },
      tail: { len: 0.2, w: 0.045, tip: 0.5, cock: 0.05 },
      legs: { tib: 0.02, tar: 0.025, r: 0.0026, c: 0x2a2a2a, thigh: 0x9a8f84, toe: 0.016, x: 0.012, stand: 0.55 },
      paint: {
        body: (o, u, s) => {
          o.copy(P.brown).lerp(P.rump, ss(s, 0, 0.3) * (1 - ss(u, 0.25, 0.4)))
          tmp.copy(P.under).lerp(P.vent, 1 - ss(u, 0.15, 0.3))
          o.lerp(tmp, ss(-s, -0.15, 0.3))
        },
        wing: (o, u, s) => o.copy(P.wing).lerp(P.white, band2(u, 0.5, 0.6) * band2(s, -0.3, 0.35)),
        tail: (o, u, s, c) => o.copy(P.tail).lerp(P.grey, ss(0.4, 0.25, Math.abs(c)) * (1 - ss(u, 0.55, 0.7))),
        neck: (o, u, s) => o.copy(P.grey).lerp(P.face, ss(-s, -0.2, 0.2)),
        head: (o, u, s, c, q) => o.copy(P.face).lerp(P.grey, ss(q.y, 0.3, 0.5) * (1 - ss(q.z, 0.3, 0.5)) + ss(-q.z, 0.4, 0.7)),
      },
    })
    const pb = perchBird(b, 4.2, env, {
      hopper: { rest: [1, 4], hop: [0.2, 0.5], dur: 0.32 }, acts: { idle: [5, 2, 6], preen: [1, 1.5, 3] },
      custom: (a, tg, add, t, hp) => {
        // 尾巴：落地後大幅擺盪，平常慢慢晃
        add.tail = 0.9 * Math.exp(-hp.landed * 2.2) * Math.sin(hp.landed * 9) + 0.05 * Math.sin(t * 1.3) + (hp.hopping ? 0.35 : 0)
        return songbirdActs(a, tg, add, t, hp)
      },
    })
    return pb
  },

  squirrel: squirrel,
  lizard: lizard,
  turtle: turtles,
}
function band2(x, a, b, soft = 0.05) { return ss(x, a - soft, a + soft) * (1 - ss(x, b - soft, b + soft)) }

// 小鳥共用的動作：理毛、鳴叫
function songbirdActs(a, tg, add, t) {
  if (!a) return
  switch (a.name) {
    case 'preen':
      Object.assign(tg, { lean: -0.3, nyaw: 1.0 * a.sgn, yaw: 1.5 * a.sgn, hp: 0.9, roll: 0.4 * a.sgn })
      add.hp = 0.2 * Math.sin(t * 14); add.wing = 0.1 * Math.max(0, Math.sin(t * 7))
      return 10
    case 'sing':
      Object.assign(tg, { hp: -0.45, stretch: 0.3, lean: -0.2 })
      add.hp = 0.08 * Math.sin(t * 22); add.puff = 0.03 * Math.abs(Math.sin(t * 11))
      return 10
    case 'call': {
      // 五色鳥：頭低低的，每一聲「咯」頭點一下、喉嚨鼓起
      Object.assign(tg, { hp: 0.25, lean: 0.1, tail: 0.15 })
      const beat = Math.pow(Math.max(0, Math.sin(t * 13)), 3)
      add.hp = 0.12 * beat; add.puff = 0.06 * beat; add.tail = -0.15 * beat
      return 10
    }
  }
}

/* ---------- 現成模型 ---------- */
// 松鼠和烏龜用網路上別人做好的寫實模型（來源與授權見 README、頁尾），載入後用頂點著色器把尾巴、頭、腳彎動。
const GLB = {}
export async function loadAnimalModels() {
  const L = new GLTFLoader(), D = new DRACOLoader()
  D.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
  L.setDRACOLoader(D)
  await Promise.all(['squirrel-rig', 'pond-turtle', 'slider'].map((n) => L.loadAsync(`models/${n}.glb`).then((g) => { GLB[n] = g.scene })))
}
// 複製模型並換上會變形的材質。glsl 要定義 void deform(vec3 p)，算出 dPos（新位置）和 dR（法線要轉的矩陣）。
// recolor 是片段著色器裡改顏色的程式（可以用 vP：模型座標）。
const DEFORM_LIB = `
  vec3 dPos; mat3 dR;
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }`
function deformable(name, uniforms, glsl, recolor = '') {
  const root = GLB[name].clone(true)
  root.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true; o.frustumCulled = false
    // 掃描模型是不受光的材質，換成一般受光材質才會和場景的光影一致
    const src = o.material
    const m = src.isMeshBasicMaterial ? new THREE.MeshStandardMaterial({ map: src.map, color: src.color, roughness: 0.75 }) : src.clone()
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms)
      const decl = Object.keys(uniforms).map((k) => `uniform float ${k};`).join('\n')
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${decl}\n${DEFORM_LIB}\n${glsl}\nvarying vec3 vP, vNo;`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\ndeform(position);\nobjectNormal = dR * objectNormal;\nvNo = normal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ndeform(position);\ntransformed = dPos;\nvP = position;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${decl}\nvarying vec3 vP, vNo;`)
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + recolor)
    }
    m.customProgramCacheKey = () => 'deform-' + name
    o.material = m
  })
  return root
}

/* ---------- 赤腹松鼠 ---------- */
// 模型是坐著捧東西吃的姿勢。原檔沒有骨架，我們在 Blender 幫它綁了一副（models/rig/，見 README）：
// hips → spine1 → spine2 → neck → head、兩隻手三節、兩隻後腳三節、尾巴 8 節，權重是 Blender 自動算的。
// 模型座標：+z 是頭、y 往上；原本是美洲灰松鼠，毛色在著色器裡改成赤腹松鼠。
const SQUIRREL_COLOR = `
  {
    vec3 c = diffuseColor.rgb;
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    float white = smoothstep(0.18, 0.42, lum) * (1.0 - smoothstep(0.1, 0.25, sat));
    // 胸口、肚子、四肢內側（朝前或朝下的白毛）→ 紅褐色；側面、臉上、眼圈保留原色
    vec3 n = normalize(vNo);
    float under = max(smoothstep(0.15, 0.5, n.z), smoothstep(-0.1, -0.45, n.y)) * (1.0 - smoothstep(0.55, 0.85, abs(n.x)));
    float belly = white * under * smoothstep(0.3, 0.12, vP.y) * smoothstep(-0.5, -0.25, vP.z) * (1.0 - smoothstep(0.0, 0.12, vP.y) * smoothstep(0.12, 0.28, vP.z));
    // 其他灰毛 → 偏橄欖的灰褐，帶一點顆粒
    float grey = (1.0 - smoothstep(0.08, 0.2, sat)) * (1.0 - belly);
    c = mix(c, c * vec3(0.78, 0.7, 0.52) * 0.85, grey * 0.9);
    c = mix(c, vec3(0.3, 0.07, 0.028) * clamp(lum / 0.5, 0.55, 1.25), smoothstep(0.0, 0.6, belly));
    diffuseColor.rgb = c;
  }`

function squirrel(env) {
  const model = cloneSkinned(GLB['squirrel-rig'])   // 有骨架的模型要用 SkeletonUtils 複製，皮才會跟著新骨頭
  const bones = {}
  model.traverse((o) => { if (o.isBone) { bones[o.name] = o; o.userData.rest = o.quaternion.clone() } })
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return
    o.castShadow = true; o.frustumCulled = false
    const m = o.material.clone()
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vP, vNo;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; vNo = normal;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vP, vNo;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + SQUIRREL_COLOR)
    }
    m.customProgramCacheKey = () => 'squirrel-color'
    o.material = m
  })
  // 身長約 55 公分（比真的大一些，遠處才看得清楚），腳掌放在樹枝上
  const S = 0.35, root = new THREE.Group()
  model.scale.setScalar(S); model.position.y = 0.79 * S - 0.01
  root.add(model)
  const _e = new THREE.Euler(), _q = new THREE.Quaternion()
  const pose = (name, x = 0, y = 0, z = 0) => {
    const b = bones[name]; if (!b) return
    b.quaternion.copy(b.userData.rest).multiply(_q.setFromEuler(_e.set(x, y, z)))
  }

  const br = env.branch, focus = V()
  // 影片：大部分時間坐著用前掌捧著東西啃；啃一陣會抬頭、一下一下轉頭張望；尾巴常常一抽一抽；偶爾很快挪個方向
  const st = { s: rnd(-0.5, -0.2), off: 0, offT: 0 }   // 鏡頭正對的那一段枝條
  const base = Math.atan2(Math.cos(0.5) * sgn() + env.toCam.x * Math.sin(0.5), env.toCam.z * Math.sin(0.5))
  const glance = new Glance([0.35, 1.2], 0.9, 0.35)
  const acts = new Acts({ eat: [5, 3, 8], look: [3, 2, 4.5], flick: [2, 0.8, 1.4], shift: [1, 0.35, 0.35] }, (n) => {
    if (n === 'shift') st.offT = clamp(st.offT + rnd(0.25, 0.5) * sgn(), -0.6, 0.6)
  })
  const c = { look: 0, yaw: 0, pitch: 0, eat: 1, flick: 0 }
  const update = (t, dt) => {
    acts.tick(dt)
    const n = acts.name
    st.off = damp(st.off, st.offT, 18, dt)
    if (n === 'look') glance.update(dt)
    // 混合權重：吃 ↔ 張望
    c.eat = damp(c.eat, n === 'eat' || n === 'flick' ? 1 : 0, 5, dt)
    c.look = 1 - c.eat
    // 張望：頭一下一下快速轉（damp 很快），脖子跟一部分
    c.yaw = damp(c.yaw, n === 'look' ? glance.yaw : 0, 22, dt)
    c.pitch = damp(c.pitch, n === 'look' ? glance.hp : 0, 22, dt)
    const nib = Math.sin(t * 24), roll = Math.sin(t * 7.5)
    pose('neck', c.eat * 0.12 - c.look * 0.12 + c.pitch * -0.3, 0, c.yaw * 0.35)
    pose('head', c.eat * (0.25 + 0.05 * nib) - c.look * 0.2 + c.pitch * -0.6, 0, c.yaw * 0.65)
    // 前掌：吃的時候把食物轉來轉去送到嘴邊；張望時手稍微放低
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      pose('upperarm' + side, c.eat * 0.05 + c.look * 0.15, 0, 0)
      pose('forearm' + side, c.eat * (0.08 + 0.05 * roll) - c.look * 0.12, 0, 0)
      pose('hand' + side, c.eat * 0.15 * Math.sin(t * 7.5 + sg), 0, 0)
    }
    // 身體：呼吸，張望時稍微挺起來
    const br5 = Math.sin(t * 5.5)
    pose('spine1', 0.015 * br5 - c.look * 0.08, 0, 0)
    pose('spine2', 0.01 * br5 - c.look * 0.06, 0, c.yaw * 0.1)
    // 尾巴：平常慢慢擺；抽動時一個波從尾根傳到尾尖
    c.flick = damp(c.flick, n === 'flick' ? 1 : 0, 10, dt)
    for (let i = 0; i < 8; i++) {
      const k = i / 7
      const sway = 0.035 * Math.sin(t * 0.8 - i * 0.45)
      const wave = c.flick * 0.16 * Math.sin(t * 16 - i * 0.9) * (0.4 + k)
      pose('tail' + i, wave + 0.015 * Math.sin(t * 1.3 - i * 0.6), 0, sway)
    }
    root.position.set(st.s, br.top(st.s), 0)
    root.rotation.y = base + st.off
    focus.set(st.s, 0.25, 0)
  }
  return { obj: root, focus, update, acts }
}

/* ---------- 斯文豪氏攀蜥（貼在樹幹上） ---------- */
function lizard(env) {
  const P = K({ base: 0x6d6a3d, dark: 0x3c3a22, stripe: 0xe0d27a, belly: 0xc3bc96, head: 0x75734a, lip: 0xd8cf9a })
  const S = 3.7, L = 0.065
  const root = new THREE.Group(), body = new THREE.Group()
  body.position.y = 0.011; root.add(body)
  body.add(loft([[0, 0, -0.036, 0.004, 0.004], [0, 0, -0.026, 0.0075, 0.0095, 0.0075], [0, 0.0005, -0.01, 0.0088, 0.011, 0.0085], [0, 0.0005, 0.008, 0.0088, 0.011, 0.0085], [0, 0, 0.022, 0.0075, 0.009, 0.0072], [0, 0, 0.034, 0.0055, 0.0065, 0.0055]],
    (o, u, s, c, p) => {
      o.copy(P.base).lerp(P.dark, 0.7 * ss(s, 0.3, 0.6) * ss(Math.sin(p.z * 260), 0.4, 0.8))
      o.lerp(P.stripe, band2(s, 0.0, 0.3, 0.08) * ss(u, 0.25, 0.4) * (1 - ss(u, 0.85, 0.95)))
      o.lerp(P.belly, ss(-s, 0.35, 0.7))
    }, { seg: 14 }))
  // 背上一排小棘
  for (let i = 0; i < 11; i++) {
    const h = 0.004 * (1 - i / 13), cone = new THREE.Mesh(new THREE.ConeGeometry(0.0012, h, 4), mat(0x4a4728, 0.8))
    cone.position.set(0, 0.0105 + h / 2, 0.03 - i * 0.0055); cone.rotation.x = -0.4
    body.add(cone)
  }
  const head = new THREE.Group()
  head.position.set(0, 0.001, 0.034)
  const hr = 0.0095
  head.add(loft([[0, 0.001, -0.006, 0.55 * hr, 0.55 * hr], [0, 0.0015, 0.002, 1.05 * hr, 0.85 * hr, 0.75 * hr], [0, 0.0015, 0.01, 0.95 * hr, 0.8 * hr, 0.65 * hr], [0, 0.0005, 0.018, 0.6 * hr, 0.55 * hr, 0.45 * hr], [0, -0.0005, 0.025, 0.3 * hr, 0.3 * hr, 0.25 * hr], [0, -0.001, 0.028, 0.06 * hr, 0.06 * hr, 0.06 * hr]],
    (o, u, s) => o.copy(P.head).lerp(P.dark, 0.4 * ss(s, 0.5, 0.9) * ss(u, 0.3, 0.5)).lerp(P.lip, ss(-s, 0.05, 0.3))))
  for (const sx of [1, -1]) head.add(eye(0.0022, 0xb08a30, [sx * 0.0075, 0.0038, 0.008], sx, 0.1))
  body.add(head)
  // 尾巴
  const tail = [], tr = [0.0055, 0.0042, 0.003, 0.002, 0.0012], tsl = 0.028
  let parent = body
  tr.forEach((r, i) => {
    const sg = new THREE.Group()
    if (i === 0) sg.position.set(0, 0, -0.034); else sg.position.z = -tsl
    const r1 = tr[i + 1] ?? 0.0004
    sg.add(loft([[0, 0, 0.004, r * 1.05, r * 1.1, r], [0, 0, -tsl * 0.5, (r + r1) / 2, (r + r1) / 2], [0, 0, -tsl - 0.002, r1, r1]],
      (o, u, s, c, p) => o.copy(P.base).lerp(P.dark, 0.6 * ss(Math.sin((p.z - i * tsl) * 300), 0.3, 0.7)).lerp(P.belly, 0.6 * ss(-s, 0.4, 0.8)), { seg: 10 }))
    parent.add(sg); tail.push(sg); parent = sg
  })
  // 四肢：上臂往外、前臂往下，五根細長的趾
  const legs = [[1, 0.02, 1], [-1, 0.02, 1], [1, -0.022, -1], [-1, -0.022, -1]].map(([sx, z, fb], i) => {
    const sh = new THREE.Group(), el = new THREE.Group(), ft = new THREE.Group()
    sh.position.set(sx * 0.0075, -0.002, z); sh.rotation.order = 'YXZ'
    const limb = (len, r) => { r *= 1.5; const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len, 6).translate(0, len / 2, 0).rotateX(Math.PI / 2), mat(0x67653a, 0.75)); m.castShadow = true; return m }
    sh.add(limb(0.013, 0.0024), el); el.position.z = 0.013; el.rotation.x = 0.85
    el.add(limb(0.012, 0.002), ft); ft.position.z = 0.012; ft.rotation.x = -0.85
    for (let k = 0; k < 5; k++) { const toe = limb(0.006 + (k === 3 ? 0.002 : 0), 0.0007); toe.rotation.y = (k - 2) * 0.32 * sx + fb * 0; ft.add(toe) }
    root.add(sh)
    return { sh, el, ft, sx, base: sx * (Math.PI / 2 - fb * 0.55), off: [0, 0.5, 0.5, 0][i], fb }
  })
  // 和 body 一起動
  legs.forEach((l) => { root.remove(l.sh); body.add(l.sh) })
  root.scale.setScalar(S)

  // 樹幹表面上走：p.x 是沿圓周的弧長、p.y 是高度；heading 0 = 頭朝上
  const T = env.trunk
  const w = new Walker({ radius: 0.75, speed: 0.75, turn: 7, center: [0, 1.75], avoid: (x, z) => Math.abs(x) > T.arc || z < 1.05 || z > 2.5 })
  w.p.set(0, 1.6); w.h = Math.random() < 0.6 ? 0 : Math.PI
  const acts = new Acts({ walk: [3, 99, 99], rest: [4, 2.5, 7], pushup: [2, 1.4, 2.4], look: [2, 1, 2.5], turn: [1.5, 99, 99] }, (n, a) => {
    if (n === 'walk' && !w.pick(0.25, 0.8)) a.next('rest')
    if (n === 'turn') w.want = pick([0, Math.PI, 0.35, -0.35, Math.PI + 0.35, Math.PI - 0.35])
  })
  const surf = new THREE.Group(), holder = new THREE.Group()
  surf.add(holder); holder.add(root)
  const m4 = new THREE.Matrix4(), xa = V(), ya = V(0, 0, 1), za = V(), focus = V()
  let phase = 0, amp = 0, hy = 0, push = 0, look = 0
  const update = (t, dt) => {
    acts.tick(dt)
    const d = w.update(dt)
    if ((acts.name === 'walk' || acts.name === 'turn') && !w.busy) acts.next()
    phase += d / (0.1 * S); amp = damp(amp, w.busy ? 1 : 0, 14, dt)
    const ph = phase * Math.PI * 2
    body.rotation.y = 0.22 * Math.sin(ph) * amp
    push = damp(push, acts.name === 'pushup' ? 1 : 0, 10, dt)
    const bob = push * Math.max(0, Math.sin(t * 11))
    body.rotation.x = -0.28 * push - 0.15 * bob
    body.position.y = 0.011 + 0.004 * push + 0.003 * bob
    look = damp(look, acts.name === 'look' ? acts.r * 0.6 : acts.name === 'rest' ? 0.2 * Math.sin(t * 0.4) : 0, 6, dt)
    hy = damp(hy, -body.rotation.y * 1.2 + look, 12, dt)
    head.rotation.set(-0.1 * push + 0.12 * bob, hy, 0, 'YXZ')
    tail.forEach((sg, i) => { sg.rotation.y = -0.3 * Math.sin(ph - i * 0.9) * amp + 0.06 * Math.sin(t * 0.7 - i * 0.6); sg.rotation.x = 0.02 })
    legs.forEach((l) => {
      const c = fract(phase + l.off), duty = 0.55
      let sw, lift = 0
      if (c < duty) sw = 0.5 - c / duty
      else { const u = (c - duty) / (1 - duty); sw = u - 0.5; lift = Math.sin(Math.PI * u) }
      l.sh.rotation.y = l.base - l.sx * sw * 0.9 * amp
      l.sh.rotation.x = 0.12 - 0.5 * lift * amp - (l.fb > 0 ? 0.25 * push : 0)
    })
    // 擺到樹幹表面：holder 的 +y 朝外、+z 是頭的方向
    surf.rotation.y = w.p.x / T.R
    holder.position.set(0, w.p.y, T.R + 0.004)
    za.set(Math.sin(w.h), Math.cos(w.h), 0); xa.crossVectors(ya, za)
    holder.quaternion.setFromRotationMatrix(m4.makeBasis(xa, ya, za))
    focus.set(0, w.p.y, T.R)
  }
  return { obj: surf, focus, update }
}

/* ---------- 池塘烏龜：一隻在石頭上曬太陽（斑龜的近親 3D 掃描），一隻在水裡游（紅耳龜 3D 掃描） ---------- */
// 模型座標：頭朝 -x、y 往上；殼長約 12 單位。脖子往 -x 伸縮、轉頭；殼外側的腳划水。
const TURTLE_GLSL = `
  void deform(vec3 p) {
    dR = mat3(1.0); dPos = p;
    vec3 np = vec3(uNeckX, 0.2, 0.0);
    float wn = smoothstep(uNeckX + 0.2, uNeckX - 0.9, p.x);
    if (wn > 0.0) {
      mat3 R = rotY(uLookY * wn) * rotZ(uLookP * wn);
      dPos = np + R * (p - np); dPos.x -= uNeck * wn * 1.4; dR = R;
      return;
    }
    float side = abs(p.z), aw = smoothstep(uSide, uSide + 1.4, side);
    if (aw > 0.0 && uPaddle > 0.0) {
      float ph = (p.x < 0.0 ? 0.0 : 3.14159) + (p.z > 0.0 ? 0.0 : 3.14159);
      float s = sin(uT * 3.2 + ph), c = cos(uT * 3.2 + ph), r = side - uSide;
      dPos.x += s * aw * r * 0.7 * uPaddle;
      dPos.y += c * aw * r * 0.25 * uPaddle;
    }
  }`
function turtleOf(name, len, neckX, side) {
  const U = { uNeck: { value: 0 }, uLookY: { value: 0 }, uLookP: { value: 0 }, uPaddle: { value: 0 }, uT: { value: 0 }, uNeckX: { value: neckX }, uSide: { value: side } }
  const model = deformable(name, U, TURTLE_GLSL)
  const box = new THREE.Box3().setFromObject(model), k = len / (box.max.x - box.min.x)
  const inner = new THREE.Group()
  model.scale.setScalar(k); model.position.y = -box.min.y * k
  inner.add(model); inner.rotation.y = Math.PI / 2   // 頭轉到 +z
  const root = new THREE.Group(); root.add(inner)
  return { root, U, k, h: (box.max.y - box.min.y) * k }
}
function turtles(env) {
  const g = new THREE.Group(), focus = V(0, 0.8, 0)
  // 曬太陽：脖子伸長、頭慢慢轉，偶爾縮頭
  const a = turtleOf('pond-turtle', 0.62, -4.6, 3.1)
  g.add(a.root)
  const wa = new Walker({ radius: 0.22, speed: 0.05, turn: 0.5 })
  wa.h = env.face(1, 0.6)
  const actsA = new Acts({ bask: [4, 5, 10], look: [3, 2, 5], hide: [1, 2, 4], turn: [1, 99, 99] }, (n, ac) => {
    if (n === 'turn') wa.want = wa.h + ac.sgn * rnd(0.4, 1)
  })
  const sa = { neck: 0, ly: 0, lp: 0 }
  // 水裡游：四肢划水，頭露出水面
  const b = turtleOf('slider', 0.46, -4.9, 3.2)
  g.add(b.root)
  b.U.uPaddle.value = 1
  const rocks = env.rocks
  const nearRock = (x, z, r = 0.25) => rocks.some((rk) => Math.hypot(x - rk.x, z - rk.z) < rk.r + r)
  const wb = new Walker({ radius: 1.7, speed: 0.18, turn: 0.6, avoid: (x, z, p) => {
    for (let k = 0; k <= 10; k++) if (nearRock(lerp(p.x, x, k / 10), lerp(p.y, z, k / 10), 0.35)) return true
    return false
  } })
  for (let i = 0; i < 50; i++) { const x = rnd(-1.6, 1.6), z = rnd(-1.6, 1.6); if (!nearRock(x, z, 0.5)) { wb.p.set(x, z); break } }
  const update = (t, dt) => {
    actsA.tick(dt)
    wa.update(dt)
    if (actsA.name === 'turn' && !wa.busy) actsA.next()
    const n = actsA.name
    sa.neck = damp(sa.neck, n === 'hide' ? -0.9 : n === 'bask' ? 0.35 : 0.15, n === 'hide' ? 6 : 1.5, dt)
    sa.ly = damp(sa.ly, n === 'look' ? 0.5 * Math.sin(t * 0.5 + actsA.r * 3) : 0.08 * Math.sin(t * 0.2), 2, dt)
    sa.lp = damp(sa.lp, n === 'bask' ? 0.25 : 0.1, 2, dt)
    a.U.uNeck.value = sa.neck + 0.03 * Math.sin(t * 1.4); a.U.uLookY.value = sa.ly; a.U.uLookP.value = sa.lp
    a.root.position.set(wa.p.x, env.rockTop, wa.p.y); a.root.rotation.y = wa.h

    if (!wb.goal) wb.pick(0.8)
    wb.update(dt)
    b.U.uT.value = t; b.U.uNeck.value = 0.25; b.U.uLookY.value = 0.15 * Math.sin(t * 0.4); b.U.uLookP.value = 0.3
    // 殼大約九成在水面下
    b.root.position.set(wb.p.x, env.waterY - b.h * 0.72 + 0.006 * Math.sin(t * 2), wb.p.y)
    b.root.rotation.y = wb.h; b.root.rotation.z = 0.04 * Math.sin(t * 1.6)
  }
  return { obj: g, focus, update }
}

/* ---------- 停棲處 ---------- */
const BARK = 0x6d5544
barkify(mat(BARK, 0.9))
// 樹冠：一團平滑的球 + 表面一圈葉片
function crownBlob(color, r) {
  const m = new THREE.Mesh(canopyGeometry(), leafify(new THREE.MeshStandardMaterial({ color, roughness: 0.85, vertexColors: true })))
  m.scale.setScalar(r); m.castShadow = true
  m.add(new THREE.Mesh(leafCardGeometry(), leafCardMaterial(color)))
  return m
}
function stick(r0, r1, len, c, [x, y, z], rot = [0, 0, 0], seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg).translate(0, -len / 2, 0), mat(c, 0.9))
  m.position.set(x, y, z); m.rotation.set(...rot); m.castShadow = m.receiveShadow = true
  return m
}
const BRANCH = { len: 2.6, y: 3.2, r0: 0.1, r1: 0.045 }
function heroTree() {
  // 樹幹在原點，一根橫枝往 +x 伸出，高 3.2 公尺，越往外越細
  const { len, y, r0, r1 } = BRANCH
  const trunk = stick(0.26, 0.34, 7, BARK, [0, 7, 0], [0, 0, 0], 14)
  const branch = stick(r0, r1, len + 0.3, BARK, [0, y, 0], [0, 0, Math.PI / 2], 12)
  const twig = stick(0.035, 0.02, 0.9, BARK, [len * 0.7, y, 0], [0, 0, 2.6])
  const tip = new THREE.Mesh(SPH, mat(BARK, 0.9)); tip.scale.setScalar(r1); tip.position.set(len + 0.3, y, 0)
  const blob = (r, x, yy, z) => { const m = crownBlob(0x5a9440, r); m.position.set(x, yy, z); return m }
  return new THREE.Group().add(trunk, branch, twig, tip, blob(2.6, 0, 7.2, 0), blob(2.0, 1.6, 6.2, 0.6), blob(1.8, -1.4, 6.0, -0.5), blob(1.2, len * 0.9, 5.0, -0.8))
}
function rock(r, seed) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'))
  const p = g.attributes.position, n = V(), cols = []
  const f = (n) => 1 + 0.13 * Math.sin(n.x * 3.1 + seed) * Math.cos(n.z * 2.7 - seed) + 0.06 * Math.sin(n.y * 7 + n.x * 5 + seed * 2)
  const base = new THREE.Color(0x8a857b), wet = new THREE.Color(0x4a4842), moss = new THREE.Color(0x6c7848), c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i).normalize()
    const k = f(n), y = n.y < -0.2 ? -0.2 + (n.y + 0.2) * 0.3 : n.y
    p.setXYZ(i, n.x * k * r, y * k * r * 0.45, n.z * k * r * 0.8)
    c.copy(base).lerp(wet, ss(-n.y, -0.2, 0.15)).lerp(moss, 0.6 * ss(n.y, 0.55, 0.8) * ss(Math.sin(n.x * 9 + seed) * Math.sin(n.z * 8), 0, 0.4))
    const gr = 0.92 + Math.random() * 0.16
    cols.push(c.r * gr, c.g * gr, c.b * gr)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }))
  m.castShadow = m.receiveShadow = true
  m.userData.top = r * 0.45 * f(V(0, 1, 0))
  return m
}

// 依動物資料把模型擺到校園上，回傳鏡頭要看的目標點與鏡頭位置
export function placeAnimal(def, waterY) {
  const [x, z] = def.spot
  const v = THREE.MathUtils.degToRad(def.view)
  const toCam = V(Math.sin(v), 0, Math.cos(v))     // 從動物指向鏡頭
  const side = V(toCam.z, 0, -toCam.x)              // 和視線垂直
  const g = new THREE.Group(), obj = new THREE.Group()
  g.position.set(x, 0, z); g.add(obj)
  // 朝向：沿著 side 方向，再往鏡頭轉 turn 弧度，看起來是四分之三側面
  const face = (s, turn) => { const d = side.clone().multiplyScalar(s * Math.cos(turn)).addScaledVector(toCam, Math.sin(turn)); return Math.atan2(d.x, d.z) }
  const env = { toCam, face, waterY }
  const target = V()
  let dist = 5.5, camH = 1.6

  if (def.perch === 'ground') {
    target.set(x, 1.0, z)
    dist = 6; camH = 1.8
  } else if (def.perch === 'branch') {
    const { len, y, r0, r1 } = BRANCH
    const tree = heroTree()
    // 樹幹放在動物的側邊，枝條朝動物伸過來
    tree.position.copy(side).multiplyScalar(-len)
    tree.rotation.y = Math.atan2(-side.z, side.x)
    g.add(tree)
    // obj 的 +x 就是枝條方向，原點在枝條的軸上
    obj.position.y = y
    obj.rotation.y = tree.rotation.y
    env.toCam = toCam.clone().applyAxisAngle(V(0, 1, 0), -obj.rotation.y)
    env.branch = { min: -len * 0.8, max: 0.15, top: (s) => lerp(r0, r1, (s + len) / (len + 0.3)) }
    target.set(x, 3.6, z)
    dist = 5; camH = 3.4
  } else if (def.perch === 'trunk') {
    const R = 0.42
    const trunk = stick(R * 0.95, R * 1.08, 8, BARK, [0, 8, 0], [0, 0, 0], 16)
    const crown = crownBlob(0x55903c, 3); crown.position.y = 8.6
    g.add(trunk, crown)
    obj.rotation.y = Math.atan2(toCam.x, toCam.z)   // obj 的 +z 朝鏡頭
    env.trunk = { R, arc: 0.16 }
    target.set(x + toCam.x * R, 1.6, z + toCam.z * R)
    dist = 4.2; camH = 1.8
  } else if (def.perch === 'rock') {
    const r1 = rock(1.1, 1.3), r2 = rock(0.8, 4.1)
    r1.position.y = waterY
    r2.position.set(side.x * 1.9 - toCam.x * 0.8, waterY, side.z * 1.9 - toCam.z * 0.8)
    g.add(r1, r2)
    env.rockTop = waterY + r1.userData.top - 0.02
    env.rocks = [{ x: 0, z: 0, r: 1.1 }, { x: r2.position.x, z: r2.position.z, r: 0.8 }]
    target.set(x, 0.8, z)
    dist = 5.2; camH = 2.4
  }
  const built = BUILD[def.id](env)
  obj.add(built.obj)
  // 動物本身不接收陰影（停在樹蔭下也要看得清楚），也不烘進地面
  built.obj.traverse((o) => { if (o.isMesh) { o.receiveShadow = !!o.userData.catcher; o.userData.noBake = true } })

  // 鏡頭目標跟著動物走一部分
  const base = target.clone(), f0 = V(), fw = V()
  g.updateMatrixWorld(true)
  built.update(0, 0.016)
  g.updateMatrixWorld(true)
  obj.localToWorld(f0.copy(built.focus))
  const update = (t, dt) => {
    built.update(t, dt)
    obj.updateMatrixWorld()
    obj.localToWorld(fw.copy(built.focus)).sub(f0)
    fw.y *= 0.3
    target.copy(base).addScaledVector(fw, 0.6)
  }
  const cam = base.clone().addScaledVector(toCam, dist)
  cam.y = camH
  return { group: g, update, target, cam, built }
}
