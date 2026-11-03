// 十種動物：沿脊線放樣出平滑的身體，羽色／毛色花紋畫在頂點色上；會在附近走動、跳枝、覓食。
// 模型用真實尺寸（公尺）建，再依物種放大（不放大在校園尺度下看不到）；+z 是前方、腳底在原點。
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
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

/* ---------- 毛 ---------- */
// 同一個網格沿法線疊好幾層，每層只留下「一根根毛」所在的點，越外層越細越少，輪廓就蓬起來。
// 毛往 comb 方向（沿脊線，往後或往尾端）倒；顏色是刺鼠色：毛根深、中段一圈淡色、毛尖深。
function fur(base, { len, layers = 10, dens = [100, 60], comb = -1, band = 0x8c8676, tip = 0x2a241c, bandAmt = 0.5, droop = 0.2, holes = [] }) {
  const g = new THREE.InstancedBufferGeometry()
  for (const k of ['position', 'normal', 'color', 'uv', 'tang']) g.setAttribute(k, base.geometry.attributes[k])
  g.setIndex(base.geometry.index)
  g.setAttribute('shell', new THREE.InstancedBufferAttribute(new Float32Array(layers).map((_, i) => (i + 1) / layers), 1))
  g.instanceCount = layers
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  const U = { uLen: { value: len }, uDens: { value: new THREE.Vector2(...dens) }, uComb: { value: comb }, uBand: { value: new THREE.Color(band) }, uTip: { value: new THREE.Color(tip) }, uBandAmt: { value: bandAmt }, uDroop: { value: droop },
    uHoles: { value: [0, 1].map((i) => holes[i] ? new THREE.Vector4(...holes[i]) : new THREE.Vector4(0, 0, 0, 0)) } }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float shell; attribute vec3 tang;
        uniform float uLen, uComb, uDroop;
        varying float vShell; varying vec2 vFurUv; varying vec3 vObj;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vShell = shell; vFurUv = uv; vObj = position;
        float sh2 = shell * shell;
        transformed += normal * shell * uLen + tang * uComb * sh2 * uLen * 0.9;
        transformed.y -= sh2 * uLen * uDroop;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uDens; uniform vec3 uBand, uTip; uniform float uBandAmt; uniform vec4 uHoles[2];
        varying float vShell; varying vec2 vFurUv; varying vec3 vObj;
        float furHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec2 cell = vFurUv * uDens;
        float h = furHash(floor(cell));
        float rr = length(fract(cell) - 0.5);
        if (h < vShell * 0.9 || rr > (1.0 - vShell) * 0.42 + 0.06) discard;
        // 眼睛周圍不長毛（毛越外層讓得越開）
        for (int i = 0; i < 2; i++) if (uHoles[i].w > 0.0 && distance(vObj, uHoles[i].xyz) < uHoles[i].w * (1.0 + vShell)) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.55, 1.05, vShell) * (0.85 + 0.3 * h);
        float bnd = smoothstep(0.45, 0.6, vShell) * (1.0 - smoothstep(0.78, 0.88, vShell));
        diffuseColor.rgb = mix(diffuseColor.rgb, uBand, bnd * uBandAmt);
        diffuseColor.rgb = mix(diffuseColor.rgb, uTip, smoothstep(0.86, 0.97, vShell) * 0.6);`)
  }
  m.customProgramCacheKey = () => 'fur'
  const mesh = new THREE.Mesh(g, m)
  mesh.frustumCulled = false
  return mesh
}

// 圓柱（腳）也長毛：補上顏色和沿軸的切線
function furLimb(mesh, color, o) {
  const g = mesh.geometry, n = g.attributes.position.count, c = new THREE.Color(color)
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => c.toArray()[i % 3] * (0.9 + Math.random() * 0.2)), 3))
  g.setAttribute('tang', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => (i % 3 === 1 ? -1 : 0)), 3))
  const f = fur(mesh, { comb: 1, ...o })
  mesh.add(f)
  return f
}

// 一條沿著折線每格重排的管子（松鼠尾巴的芯），radius(u) 決定粗細，wide 讓側面比上下寬（毛往兩側攤開）
function tube(n, seg, radius, wide = 1, paint = () => new THREE.Color(1, 1, 1)) {
  const g = new THREE.BufferGeometry(), V3 = (n + 1) * seg + 2
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V3 * 3), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(V3 * 3), 3))
  g.setAttribute('tang', new THREE.BufferAttribute(new Float32Array(V3 * 3), 3))
  const uv = [], idx = []
  for (let i = 0; i <= n; i++) for (let j = 0; j < seg; j++) uv.push(i / n, Math.abs(1 - 2 * j / seg) * 0.5)
  uv.push(0, 0, 1, 0)
  const cols = []
  for (let k = 0; k < V3; k++) { const c = paint(uv[k * 2]); const gr = 0.9 + Math.random() * 0.2; cols.push(c.r * gr, c.g * gr, c.b * gr) }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  for (let i = 0; i < n; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = a + seg, c = i * seg + ((j + 1) % seg), d = c + seg
    idx.push(a, b, c, c, b, d)
  }
  const c0 = (n + 1) * seg, c1 = c0 + 1
  for (let j = 0; j < seg; j++) { idx.push(c0, j, (j + 1) % seg); idx.push(c1, n * seg + (j + 1) % seg, n * seg + j) }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  const P = [], T = [], N = V(), B = V(), q = new THREE.Quaternion(), w = V()
  for (let i = 0; i <= n; i++) { P.push(V()); T.push(V()) }
  // pts：控制點（同一個座標系），沿著它們用 Catmull-Rom 取 n+1 個截面
  g.userData.update = (pts, up) => {
    const L = pts.length - 1
    for (let i = 0; i <= n; i++) {
      const f = (i / n) * L, k = Math.min(L - 1, Math.floor(f)), t = f - k
      const a = pts[Math.max(0, k - 1)], b = pts[k], c = pts[k + 1], d = pts[Math.min(L, k + 2)]
      P[i].set(cr(a.x, b.x, c.x, d.x, t), cr(a.y, b.y, c.y, d.y, t), cr(a.z, b.z, c.z, d.z, t))
    }
    for (let i = 0; i <= n; i++) T[i].subVectors(P[Math.min(i + 1, n)], P[Math.max(i - 1, 0)]).normalize()
    N.copy(up).addScaledVector(T[0], -up.dot(T[0])).normalize()
    const pa = g.attributes.position.array, ta = g.attributes.tang.array
    for (let i = 0; i <= n; i++) {
      if (i > 0) { q.setFromUnitVectors(T[i - 1], T[i]); N.applyQuaternion(q); N.addScaledVector(T[i], -N.dot(T[i])).normalize() }
      B.crossVectors(T[i], N)
      const r = radius(i / n)
      for (let j = 0; j < seg; j++) {
        const an = (j / seg) * Math.PI * 2, o = (i * seg + j) * 3
        w.copy(P[i]).addScaledVector(B, r * wide * Math.cos(an)).addScaledVector(N, r * Math.sin(an))
        pa[o] = w.x; pa[o + 1] = w.y; pa[o + 2] = w.z
        ta[o] = T[i].x; ta[o + 1] = T[i].y; ta[o + 2] = T[i].z
      }
    }
    let o = c0 * 3
    w.copy(P[0]).addScaledVector(T[0], -radius(0) * 0.5); pa[o] = w.x; pa[o + 1] = w.y; pa[o + 2] = w.z
    w.copy(P[n]).addScaledVector(T[n], radius(1) * 0.8); o += 3; pa[o] = w.x; pa[o + 1] = w.y; pa[o + 2] = w.z
    for (const k of [c0, c1]) { const ti = k === c0 ? 0 : n; ta.set([T[ti].x, T[ti].y, T[ti].z], k * 3) }
    g.attributes.position.needsUpdate = g.attributes.tang.needsUpdate = true
    g.computeVertexNormals()
    g.computeBoundingSphere()
  }
  return g
}

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

/* ---------- 赤腹松鼠 ---------- */
function squirrel(env) {
  const P = K({ ag: 0x6c6350, ag2: 0x4b4437, pale: 0x9d978a, tip: 0x241f19, belly: 0xa2431f, nose: 0x5a3a34, paw: 0x3b322a, ring: 0xbcb4a2 })
  const S = 3.4, L = 0.15, R = 0.037
  const grizzle = (o, p, k = 140) => o.lerp(P.ag2, 0.35 * Math.random() + 0.12 * Math.sin(p.x * k * 2.3 + p.z * k * 1.7) * Math.sin(p.y * k * 1.9))
  const root = new THREE.Group(), body = new THREE.Group()
  root.add(body)
  body.add(loft([[0, 0.004, -0.53 * L, R * 0.3, R * 0.3], [0, 0.006, -0.42 * L, R * 0.85, R * 0.88, R * 0.82], [0, 0.004, -0.2 * L, R * 0.95, R, R * 0.9], [0, 0, 0, R * 0.85, R * 0.9, R * 0.82], [0, 0, 0.22 * L, R * 0.78, R * 0.85, R * 0.78], [0, 0.004, 0.4 * L, R * 0.7, R * 0.78, R * 0.72], [0, 0.008, 0.53 * L, R * 0.48, R * 0.52, R * 0.5]],
    (o, u, s, c, p) => { grizzle(o.copy(P.ag), p); o.lerp(P.belly, ss(-s, 0.25, 0.5)) }, { grain: 0.18 }))
  body.add(fur(body.children[0], { len: 0.0065, layers: 12, dens: [130, 210], band: 0xa59f90, bandAmt: 0.4 }))
  // 大腿肌肉
  const haunches = [1, -1].map((sx) => {
    const m = loft([[0, 0, -0.03, 0.006, 0.01], [0, 0, -0.015, 0.016, 0.026], [0, 0, 0.01, 0.017, 0.028], [0, 0, 0.03, 0.006, 0.01]], (o, u, s, c, p) => { grizzle(o.copy(P.ag), p); o.lerp(P.belly, 0.6 * ss(-s, 0.6, 0.9)) }, { grain: 0.18 })
    m.position.set(sx * 0.024, -0.006, -0.3 * L)
    body.add(m, fur(m, { len: 0.0065, layers: 10, dens: [55, 170], band: 0xa59f90, bandAmt: 0.4 }))
    return m
  })
  // 頭
  const head = new THREE.Group()
  head.position.set(0, 0.016, 0.47 * L)
  const hr = 0.027, eyes = [[0.0175, 0.0075, 0.022], [-0.0175, 0.0075, 0.022]]
  head.add(loft([[0, 0.002, -0.006, 0.45 * hr, 0.45 * hr], [0, 0.004, 0.004, 0.85 * hr, 0.9 * hr, 0.85 * hr], [0, 0.005, 0.018, hr * 0.9, hr, hr * 0.9], [0, 0.003, 0.032, 0.78 * hr, 0.8 * hr, 0.75 * hr], [0, -0.001, 0.044, 0.5 * hr, 0.5 * hr, 0.45 * hr], [0, -0.003, 0.053, 0.26 * hr, 0.26 * hr, 0.24 * hr], [0, -0.004, 0.057, 0.08 * hr, 0.08 * hr, 0.08 * hr]],
    (o, u, s, c, p) => {
      grizzle(o.copy(P.ag), p)
      o.lerp(P.pale, ss(-s, 0.1, 0.5) * ss(u, 0.4, 0.6))
      o.lerp(P.nose, ss(u, 0.9, 0.96))
      const d = Math.min(...eyes.map((e) => Math.hypot(p.x - e[0], p.y - e[1], p.z - e[2])))
      o.lerp(P.ring, band2(d, 0.005, 0.0085, 0.0015))
    }, { grain: 0.15 }))
  head.add(fur(head.children[0], { len: 0.0028, layers: 7, dens: [60, 130], band: 0xa59f90, bandAmt: 0.35, holes: eyes.map((e) => [...e, 0.0062]) }))
  eyes.forEach(([x, y, z], i) => head.add(eye(0.0058, 0x120c08, [x, y, z], i ? -1 : 1, 0.15, 0.7)))
  // 鬍鬚：口鼻兩側各五根，往外往後散開
  const wv = []
  for (const sx of [1, -1]) for (let k = 0; k < 5; k++) {
    const a = -0.35 + k * 0.17, L2 = 0.028 + Math.random() * 0.012
    wv.push(sx * 0.005, -0.003, 0.05, sx * (0.005 + L2 * Math.cos(a) * 0.9), -0.003 + L2 * Math.sin(a) * 0.5, 0.05 - L2 * 0.35)
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3))
  head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.7 })))
  for (const sx of [1, -1]) {
    const ear = loft([[0, 0, 0, 0.0065, 0.003], [0, 0.007, 0, 0.0072, 0.0026], [0, 0.013, 0, 0.0045, 0.0016], [0, 0.0155, 0, 0.001, 0.001]], (o, u) => o.copy(P.ag).lerp(P.ag2, u), { up: V(0, 0, -1), seg: 10 })
    ear.position.set(sx * 0.012, 0.022, 0.008); ear.rotation.z = -sx * 0.35
    head.add(ear)
  }
  body.add(head)
  // 尾巴：骨架是一節一節的關節（可以捲、可以甩），外觀是沿著關節每格重排的一整條管子 + 長毛，
  // 影片裡的尾巴寬度接近身體，毛往兩側攤開、尾端毛色較深、邊緣一圈霜白
  const tail = [], sl = 0.022
  let parent = body
  for (let i = 0; i < 9; i++) {
    const seg = new THREE.Group()
    if (i === 0) seg.position.set(0, 0.012, -0.5 * L); else seg.position.z = -sl
    parent.add(seg); tail.push(seg); parent = seg
  }
  const tailEnd = new THREE.Group(); tailEnd.position.z = -sl; parent.add(tailEnd)
  const tailGeo = tube(40, 16, (u) => 0.008 + 0.009 * Math.sin(Math.PI * Math.min(1, 0.25 + u * 0.9)), 1.35,
    (u) => tmp.copy(P.ag).lerp(P.ag2, 0.3).lerp(P.tip, 0.5 * ss(u, 0.75, 1)).clone())
  const tailMesh = new THREE.Mesh(tailGeo, skin)
  tailMesh.castShadow = true; tailMesh.frustumCulled = false
  const tailFur = fur(tailMesh, { len: 0.024, layers: 18, dens: [200, 90], comb: 1, band: 0xc9c2b0, bandAmt: 0.75, tip: 0x1e1a15, droop: 0.12 })
  root.add(tailMesh, tailFur)
  const tailPts = Array.from({ length: 11 }, () => V())
  // 坐著吃東西時捧的果實
  const nut = new THREE.Mesh(SPH, mat(0x7a5a32, 0.6)); nut.scale.set(0.009, 0.008, 0.011); nut.castShadow = true
  root.add(nut)
  // 腳：前腳手肘往後、後腳膝蓋往前
  const legSpec = [
    { x: 0.02, y: -0.016, z: 0.3 * L, a: 0.03, b: 0.028, ra: 0.0095, rb: 0.0058, bend: 1, off: 0 },
    { x: -0.02, y: -0.016, z: 0.3 * L, a: 0.03, b: 0.028, ra: 0.0095, rb: 0.0058, bend: 1, off: 0.07 },
    { x: 0.025, y: -0.006, z: -0.3 * L, a: 0.04, b: 0.042, ra: 0.013, rb: 0.0068, bend: -1, off: 0.5 },
    { x: -0.025, y: -0.006, z: -0.3 * L, a: 0.04, b: 0.042, ra: 0.013, rb: 0.0068, bend: -1, off: 0.57 },
  ]
  const legs = legSpec.map((sp, i) => {
    const l = makeLeg({ ...sp, ca: 0x6c6350, cb: 0x5a5244 })
    const pw = new THREE.Mesh(SPH, mat(0x4e463a, 0.8))
    if (i < 2) { pw.scale.set(0.006, 0.004, 0.009); pw.position.z = 0.004 } else { pw.scale.set(0.007, 0.004, 0.02); pw.position.z = 0.01 }
    pw.castShadow = true
    l.foot.add(pw); l.ground = 0.004; l.sp = sp
    // 腳也有毛：上段長一點，下段短
    const [up, , lo] = [l.hip.children[0], null, l.knee.children[1]]
    furLimb(up, 0x6c6350, { len: 0.0045, layers: 7, dens: [40, 60], band: 0xa59f90, bandAmt: 0.35 })
    furLimb(lo, 0x5a5244, { len: 0.0025, layers: 6, dens: [40, 50], band: 0x8a8272, bandAmt: 0.3 })
    root.add(l.hip)
    return l
  })
  root.scale.setScalar(S)

  const br = env.branch, focus = V()
  const st = { s: rnd(br.min + 0.4, br.max - 0.3), dir: sgn(), goal: null, v: 0, h: 0, phase: 0, amp: 0 }
  const faceH = (dir) => Math.atan2(dir * Math.cos(0.25) + env.toCam.x * Math.sin(0.25), env.toCam.z * Math.sin(0.25))
  st.h = faceH(st.dir)
  const acts = new Acts({ run: [3, 99, 99], sit: [3, 3, 7], alert: [2, 1.5, 3], flick: [2, 0.8, 1.6], groom: [1, 2, 3], turn: [1, 0.6, 0.6] }, (n, a) => {
    if (n === 'run') {
      let dir = sgn(); const len = rnd(0.35, 1.1)
      if (st.s + dir * len > br.max || st.s + dir * len < br.min) dir = -dir
      st.goal = clamp(st.s + dir * len, br.min, br.max); st.dir = dir
    }
    if (n === 'turn') st.dir = -st.dir
  })
  const pose = { pitch: 0, lift: 0, hp: 0, yaw: 0 }, H0 = 0.07
  // 影片：坐著、停下來時尾巴沿背部往上翹成 S 形，跑的時候拖在後面微微起伏
  const tailRest = { run: [0.25, 0.08, 0.05, 0.04, 0.03, 0, 0, 0, 0], sit: [0.95, 0.35, 0.25, 0.15, 0.05, -0.15, -0.25, -0.35, -0.3], stand: [0.8, 0.35, 0.2, 0.1, 0, -0.15, -0.25, -0.3, -0.25] }
  const tailNow = [...tailRest.stand]
  const _p = V(), _n2 = V(), _inv = new THREE.Matrix4()
  const update = (t, dt) => {
    acts.tick(dt)
    let speed = 0
    if (acts.name === 'run' && st.goal != null) {
      const d = st.goal - st.s
      st.v = damp(st.v, 1.2 * Math.sign(d) * clamp(Math.abs(d) * 4, 0.3, 1), 6, dt)
      const step = st.v * dt
      if (Math.abs(d) <= Math.abs(step) + 0.01) { st.s = st.goal; st.goal = null; acts.next(pick(['sit', 'alert', 'flick'])) } else st.s += step
      speed = Math.abs(step)
    } else st.v = damp(st.v, 0, 10, dt)
    st.h = dampAngle(st.h, faceH(st.dir), 9, dt)
    st.phase += speed / (0.14 * S)
    st.amp = damp(st.amp, acts.name === 'run' ? 1 : 0, 10, dt)
    const sit = acts.name === 'sit' || acts.name === 'groom' ? 1 : 0
    pose.pitch = damp(pose.pitch, sit ? -1.15 : acts.name === 'alert' ? -0.25 : -0.06, 7, dt)
    pose.lift = damp(pose.lift, sit ? 0.014 : acts.name === 'alert' ? 0.008 : 0, 7, dt)
    const ph = st.phase * Math.PI * 2
    body.rotation.x = pose.pitch + 0.16 * Math.sin(ph) * st.amp
    body.position.y = H0 + pose.lift + 0.012 * st.amp * Math.max(0, Math.sin(ph + 1.2))
    body.scale.setScalar(1 + 0.015 * Math.sin(t * 6))
    // 頭：坐著吃東西時快速啃、警戒時抬頭東張西望
    let hp = -pose.pitch * 0.85 + 0.1, yaw = 0.5 * Math.sin(t * 0.7) * (acts.name === 'alert' ? 1.4 : 0.6)
    if (acts.name === 'sit') hp += 0.35 + 0.08 * Math.sin(t * 28)
    if (acts.name === 'groom') { hp += 0.6 + 0.15 * Math.sin(t * 16); yaw = 0.3 * Math.sin(t * 5) }
    if (acts.name === 'run') { hp = 0.05; yaw = 0 }
    pose.hp = damp(pose.hp, hp, 12, dt); pose.yaw = damp(pose.yaw, yaw, 8, dt)
    head.rotation.set(pose.hp, pose.yaw, 0, 'YXZ')
    // 尾巴
    const tr = tailRest[acts.name === 'run' ? 'run' : sit ? 'sit' : 'stand']
    const flick = acts.name === 'flick' ? Math.sin(Math.PI * acts.k) : 0
    tail.forEach((sg, i) => {
      tailNow[i] = damp(tailNow[i], tr[i], 5, dt)
      sg.rotation.x = tailNow[i] + (i === 0 ? -0.5 * pose.pitch : 0) + 0.06 * Math.sin(t * 1.6 - i * 0.6) + flick * 0.45 * Math.sin(t * 20 - i * 0.9) + 0.15 * st.amp * Math.sin(ph - i * 0.7)
      sg.rotation.y = 0.05 * Math.sin(t * 1.1 - i * 0.5)
    })
    // 腳
    body.updateMatrix()
    legs.forEach((l, i) => {
      const sp = l.sp
      _p.set(sp.x, sp.y, sp.z).applyMatrix4(body.matrix)
      const c = fract(st.phase + sp.off), duty = 0.4, A = 0.14 * st.amp
      let fz, fy = l.ground
      if (c < duty) fz = A * duty * (0.5 - c / duty)
      else { const w = (c - duty) / (1 - duty); fz = A * duty * (w - 0.5); fy += 0.03 * Math.sin(Math.PI * w) * st.amp }
      fz += i < 2 ? 0.006 : 0.012
      if (i < 2 && sit) {
        // 前腳捧著食物到嘴邊
        fy = _p.y - 0.028 + (acts.name === 'groom' ? 0.025 + 0.01 * Math.sin(t * 16 + i) : 0.004 * Math.sin(t * 28))
        fz = _p.z + 0.024
      }
      legIK(l, _p.y, _p.z, fy, _p.z + fz - (i < 2 && sit ? _p.z : 0), i < 2 && sit ? -1.2 : 0)
      l.hip.position.x = sp.x
    })
    root.position.set(st.s, br.top(st.s), 0)
    root.rotation.y = st.h
    focus.set(st.s, 0.3, 0)
    // 尾巴外觀跟著關節走（在 root 的座標系裡排）
    root.updateMatrixWorld(true)
    _inv.copy(root.matrixWorld).invert()
    tailPts[0].set(0, 0.006, -0.42 * L).applyMatrix4(body.matrix)
    tail.forEach((sg, i) => tailPts[i + 1].setFromMatrixPosition(sg.matrixWorld).applyMatrix4(_inv))
    tailPts[10].setFromMatrixPosition(tailEnd.matrixWorld).applyMatrix4(_inv)
    tailGeo.userData.update(tailPts, Y)
    // 果實在兩隻前掌中間
    nut.visible = acts.name === 'sit'
    if (nut.visible) {
      legs[0].foot.getWorldPosition(_p); legs[1].foot.getWorldPosition(_n2)
      nut.position.copy(_p).add(_n2).multiplyScalar(0.5).applyMatrix4(_inv)
      nut.position.y += 0.004; nut.rotation.set(0.5, 0, 0)
    }
  }
  return { obj: root, focus, update }
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

/* ---------- 池塘烏龜：一隻在石頭上曬太陽，一隻在水裡游 ---------- */
// 龜殼的盾片：背甲中間一排 5 片椎盾、兩側各 4 片肋盾、外圈一圈緣盾。
// 回傳所在盾片的編號、種類，以及到盾片邊緣的相對距離 d（0 在縫上、1 在盾片中心）。
function scuteAt(u, s, c) {
  const ac = Math.abs(c)
  if (s < 0.3 || u < 0.06 || u > 0.94) {
    const n = 12, f = u * n, k = Math.floor(f)
    const along = Math.min(f - k, 1 - (f - k)) * 2
    const across = u < 0.06 || u > 0.94 ? 1 : Math.min(s / 0.3, 1) * 1.6
    return { id: 40 + k + (c > 0 ? 0 : 20), kind: 'm', d: Math.min(along, across) }
  }
  if (ac < 0.3) {
    const f = (u - 0.06) / 0.88 * 5, k = Math.floor(f)
    return { id: k, kind: 'v', d: Math.min((1 - ac / 0.3) * 1.4, Math.min(f - k, 1 - (f - k)) * 2) }
  }
  const f = (u - 0.1) / 0.8 * 4, k = clamp(Math.floor(f), 0, 3), fu = clamp(f - k, 0, 1)
  const t = (ac - 0.3) / (0.954 - 0.3)
  return { id: 10 + k + (c > 0 ? 0 : 4), kind: 'c', d: Math.min(Math.min(t, 1 - t) * 2, Math.min(fu, 1 - fu) * 2) }
}
const cellRand = (id) => fract(Math.sin(id * 91.7 + 3.1) * 43758.5)

// 背甲的花紋逐像素畫（頂點色會把細縫和生長紋糊掉）：和 scuteAt 同一套分法
function shellMaterial(P, pond, wet) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: wet ? 0.28 : 0.62 })
  const U = {}
  for (const k of ['scute', 'scute2', 'seam', 'ring', 'plas', 'blot']) U['c_' + k] = { value: P[k] }
  U.uPond = { value: pond ? 1 : 0 }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 ucs; varying vec3 vUcs; varying vec3 vOp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUcs = ucs; vOp = position;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vUcs; varying vec3 vOp;
        uniform vec3 c_scute, c_scute2, c_seam, c_ring, c_plas, c_blot; uniform float uPond;
        float cRand(float id) { return fract(sin(id * 91.7 + 3.1) * 43758.5); }
        // 回傳 (編號, 到縫的相對距離 d, 是否緣盾)
        vec3 scuteAt(float u, float s, float c) {
          float ac = abs(c);
          if (s < 0.3 || u < 0.06 || u > 0.94) {
            float f = u * 12.0, k = floor(f), along = min(f - k, 1.0 - (f - k)) * 2.0;
            float across = (u < 0.06 || u > 0.94) ? 1.0 : min(s / 0.3, 1.0) * 1.6;
            return vec3(40.0 + k + (c > 0.0 ? 0.0 : 20.0), min(along, across), 1.0);
          }
          if (ac < 0.3) {
            float f = (u - 0.06) / 0.88 * 5.0, k = floor(f);
            return vec3(k, min((1.0 - ac / 0.3) * 1.4, min(f - k, 1.0 - (f - k)) * 2.0), 0.0);
          }
          float f = (u - 0.1) / 0.8 * 4.0, k = clamp(floor(f), 0.0, 3.0), fu = clamp(f - k, 0.0, 1.0);
          float t = (ac - 0.3) / (0.954 - 0.3);
          return vec3(10.0 + k + (c > 0.0 ? 0.0 : 4.0), min(min(t, 1.0 - t) * 2.0, min(fu, 1.0 - fu) * 2.0), 0.0);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float u = vUcs.x, s = vUcs.y, c = vUcs.z;
          vec3 col;
          if (s < -0.05) {
            float f = u * 6.0, k = floor(f);
            float d = min(min(f - k, 1.0 - (f - k)) * 2.0, min(abs(c) / 0.6, 1.0) * 2.0);
            col = mix(c_plas, c_blot, mix(0.5, 0.85, uPond) * smoothstep(0.35, 0.55, d) * (0.6 + 0.4 * cRand(k + (c > 0.0 ? 7.0 : 0.0))));
            col = mix(col, c_ring, 0.35 * (1.0 - smoothstep(0.0, 0.05, d)));
          } else {
            vec3 sc = scuteAt(u, max(s, 0.0), c);
            float d = sc.y, r = cRand(sc.x);
            col = mix(c_scute, c_scute2, r);
            if (uPond > 0.5) {
              // 生長紋：繞著盾片中心一圈圈的細線，越靠中心越淡
              float dn = d + 0.03 * sin(vOp.x * 900.0 + vOp.z * 700.0) + 0.02 * sin(vOp.z * 1500.0);
              float rings = smoothstep(0.78, 0.95, 0.5 + 0.5 * cos(dn * 3.14159 * 7.0 + r * 3.0));
              col = mix(col, c_ring, 0.28 * rings * smoothstep(0.04, 0.2, d) * (1.0 - smoothstep(0.7, 0.9, d)));
              col *= 0.9 + 0.22 * smoothstep(0.7, 1.0, d);
            } else {
              // 紅耳龜：細細彎彎的黃紋
              float w = sin(d * 15.0 + sin(vOp.x * 260.0 + r * 5.0) * 1.4 + sin(vOp.z * 210.0) * 0.9 + r * 6.0);
              col = mix(col, c_ring, 0.5 * smoothstep(0.9, 0.98, w) * smoothstep(0.08, 0.25, d));
            }
            col = mix(col, c_seam, 0.85 * (1.0 - smoothstep(0.012, 0.035, d)));
            col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.012, d));   // 縫底比較暗
            if (sc.z > 0.5 && s < 0.08) col = mix(col, c_plas, 0.5);
          }
          diffuseColor.rgb = col * vColor;
        }`)
  }
  m.customProgramCacheKey = () => 'shell' + (pond ? 1 : 0)
  return m
}

// kind：'pond' 斑龜（背甲深褐、盾片有淡色縫與生長紋、腹甲黃底每片一塊黑斑、脖子細黃線）
//       'slider' 紅耳龜（背甲橄欖綠帶黃色紋、眼後一塊紅斑）
function turtleModel(kind = 'pond', wet = false) {
  const pond = kind === 'pond'
  const P = K(pond
    ? { scute: 0x2e2517, scute2: 0x3d311d, seam: 0x8a7444, ring: 0x1c160e, plas: 0xd6c07a, blot: 0x33281b, skin: 0x2a2d1d, line: 0xc9bf62, red: 0x2a2d1d }
    : { scute: 0x28301a, scute2: 0x343e1e, seam: 0x5f5c34, ring: 0xb0a040, plas: 0xd9c66a, blot: 0x4a3f22, skin: 0x2a3820, line: 0xcfc55a, red: 0xb8321e })
  const root = new THREE.Group(), shell = new THREE.Group()
  shell.position.y = 0.024; root.add(shell)
  const shellMat = shellMaterial(P, pond, wet)
  const skinMat = wet ? gloss : skin
  shell.add(loft([[0, 0.004, -0.1, 0.012, 0.004, 0.002], [0, 0.004, -0.094, 0.058, 0.03, 0.006], [0, 0.002, -0.07, 0.084, 0.052, 0.01], [0, 0, -0.03, 0.095, 0.064, 0.013], [0, 0, 0.02, 0.095, 0.065, 0.013], [0, 0.002, 0.06, 0.085, 0.055, 0.011], [0, 0.004, 0.088, 0.06, 0.034, 0.007], [0, 0.005, 0.097, 0.014, 0.006, 0.003]],
    (o) => {
      o.setRGB(1, 1, 1)   // 花紋在 shellMaterial 裡畫，頂點色只留一點顆粒感
    }, { seg: 56, sub: 9, grain: 0.08, material: shellMat,
      // 縫是凹下去的溝、盾片中心微微隆起；斑龜背上有一條低低的稜
      displace: (u, s, c) => {
        if (s < -0.05) return -0.0006 * ss(0.08, 0, Math.min(Math.abs(c) * 3, Math.abs(Math.sin(u * 6 * Math.PI))))
        const { d } = scuteAt(u, Math.max(s, 0), c)
        return -0.0014 * ss(0.07, 0, d) + 0.0008 * ss(d, 0.5, 1) + (pond ? 0.0018 * ss(0.12, 0, Math.abs(c)) * ss(s, 0.5, 0.9) : 0)
      } }))
  // 皮膚：沿著脖子、頭的細黃線
  const striped = (o, u, s, c, p, n = pond ? 8 : 5) => {
    const a = Math.atan2(s, c)
    o.copy(P.skin).lerp(P.line, ss(Math.abs(Math.sin(a * n)), pond ? 0.95 : 0.9, 0.995))
    if (s < -0.6) o.lerp(P.line, 0.45)
  }
  const neck = new THREE.Group()
  neck.position.set(0, 0.022, 0.07); shell.add(neck)
  neck.add(loft([[0, 0, -0.035, 0.017, 0.015], [0, 0, -0.005, 0.015, 0.0135], [0, 0.002, 0.03, 0.0135, 0.0125]], (o, u, s, c, p) => {
    striped(o, u, s, c)
    o.multiplyScalar(0.92 + 0.12 * Math.sin(u * 60))   // 頸部皺褶
  }, { seg: 64, material: skinMat }))
  const head = new THREE.Group()
  head.position.z = 0.03; neck.add(head)
  const eyes = [[0.0105, 0.0068, 0.016], [-0.0105, 0.0068, 0.016]]
  head.add(loft([[0, 0.002, -0.006, 0.0125, 0.0115], [0, 0.003, 0.004, 0.0145, 0.013, 0.011], [0, 0.0035, 0.016, 0.0125, 0.011, 0.0092], [0, 0.0025, 0.026, 0.0092, 0.0082, 0.0062], [0, 0.0014, 0.0315, 0.006, 0.0052, 0.0042], [0, 0.0008, 0.0345, 0.0022, 0.002]],
    (o, u, s, c, p) => {
      striped(o, u, s, c)
      // 下巴到嘴角的黃線、嘴巴的縫、鼻孔
      o.lerp(P.line, 0.7 * band2(s, -0.25, -0.12, 0.04) * ss(u, 0.3, 0.6))
      o.lerp(P.ring.clone().multiplyScalar(0.3), 0.8 * band2(s, -0.42, -0.34, 0.03) * ss(u, 0.55, 0.75))
      if (u > 0.93 && s > 0.2) o.multiplyScalar(0.4)
      const ear = Math.min(...[1, -1].map((sx) => Math.hypot(p.x - sx * 0.0115, p.y - 0.003, (p.z - 0.004) * 0.7)))
      o.lerp(P.red, ss(0.0052, 0.0035, ear))
    }, { seg: 64, sub: 8, material: skinMat }))
  for (const [x, y, z] of eyes) head.add(eye(0.0034, pond ? 0x8c8a3a : 0x6b6a2a, [x, y, z], Math.sign(x), 0.35))
  const claw = new THREE.CylinderGeometry(0.0002, 0.0011, 0.0045, 5).translate(0, 0.00225, 0).rotateX(Math.PI / 2 + 0.35)
  const legs = [[1, 0.06, 0.9], [-1, 0.06, 0.9], [1, -0.065, 2.3], [-1, -0.065, 2.3]].map(([sx, z, yaw], i) => {
    const g = new THREE.Group()
    g.position.set(sx * 0.06, 0.004, z); g.rotation.order = 'YXZ'
    g.add(loft([[0, 0, -0.008, 0.012, 0.009], [0, 0, 0.012, 0.013, 0.008], [0, -0.001, 0.03, 0.016, 0.0042], [0, -0.001, 0.04, 0.0095, 0.002]], (o, u, s, c) => {
      striped(o, u, s, c, null, 2)
      o.multiplyScalar(0.85 + 0.25 * ss(Math.sin(u * 40) * Math.sin(c * 12), 0.2, 0.6))   // 鱗片
    }, { seg: 24, up: V(0, 1, 0), material: skinMat }))
    // 爪：前腳 5 根、後腳 4 根
    const n = i < 2 ? 5 : 4
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(claw, mat(0x2b241a, 0.4))
      const f = k / (n - 1) - 0.5
      m.position.set(f * 0.022, -0.0012, 0.038 + 0.004 * Math.cos(f * 2.5)); m.rotation.y = f * 0.7
      g.add(m)
    }
    shell.add(g)
    return { g, base: sx * yaw, sx, front: i < 2, off: [0, 0.5, 0.5, 0][i] }
  })
  const tail = loft([[0, 0.01, -0.09, 0.008, 0.006], [0, 0.006, -0.11, 0.005, 0.004], [0, 0.002, -0.125, 0.001, 0.001]], (o, u, s, c) => striped(o, u, s, c, null, 2), { seg: 16, material: skinMat })
  shell.add(tail)
  return { root, shell, neck, head, legs }
}
function turtleAnimate(tm, st, t, dt, mode) {
  // mode：walk / swim / bask / hide
  // 影片：曬太陽時脖子整個伸出來、斜斜往上，頭接近水平；呼吸時脖子一伸一縮
  st.neck = damp(st.neck, mode === 'hide' ? -0.032 : mode === 'bask' ? 0.02 : 0.004, mode === 'hide' ? 8 : 2, dt)
  tm.neck.position.z = 0.07 + st.neck + (mode === 'hide' ? 0 : 0.0012 * Math.sin(t * 1.4))
  tm.neck.rotation.x = damp(tm.neck.rotation.x, mode === 'swim' ? -0.45 : mode === 'bask' ? -0.42 : -0.12, 3, dt)
  tm.head.rotation.y = damp(tm.head.rotation.y, st.look, 3, dt)
  tm.head.rotation.x = -tm.neck.rotation.x * 0.6
  const ph = st.phase * Math.PI * 2
  tm.legs.forEach((l) => {
    let yaw = l.base, pitch = 0.25, tuck = mode === 'hide' ? 1 : 0
    if (mode === 'walk') {
      const c = fract(st.phase + l.off), duty = 0.6
      let sw, lift = 0
      if (c < duty) sw = 0.5 - c / duty; else { const u = (c - duty) / (1 - duty); sw = u - 0.5; lift = Math.sin(Math.PI * u) }
      yaw -= l.sx * sw * 0.7 * st.amp * (l.front ? 1 : -1); pitch -= 0.4 * lift * st.amp
    } else if (mode === 'swim') {
      const s = Math.sin(ph + (l.sx > 0 ? 0 : Math.PI) + (l.front ? 0 : Math.PI / 2))
      yaw += l.sx * (l.front ? 0.55 : 0.4) * s; pitch = 0.1 + 0.25 * Math.cos(ph)
    } else if (mode === 'bask') {
      // 後腳往後伸直、腳底朝上攤開；前腳往前撐
      if (l.front) { yaw = l.sx * 0.6; pitch = 0.15 } else { yaw = l.sx * 2.9; pitch = 0.02 }
    }
    l.g.rotation.y = damp(l.g.rotation.y, yaw - tuck * l.sx * 0.5, 6, dt)
    l.g.rotation.x = damp(l.g.rotation.x, pitch, 6, dt)
    l.g.rotation.z = damp(l.g.rotation.z, mode === 'bask' && !l.front ? -l.sx * 1.1 : 0, 4, dt)
    l.g.scale.setScalar(damp(l.g.scale.x, 1 - tuck * 0.45, 6, dt))
  })
  tm.shell.rotation.z = mode === 'swim' ? 0.05 * Math.sin(ph) : 0
}
function turtles(env) {
  const S = 3, g = new THREE.Group(), focus = V(0, 0.8, 0)
  // 曬太陽的那隻
  const a = turtleModel('pond', false), sa = { neck: 0, look: 0, phase: 0, amp: 0 }
  a.root.scale.setScalar(S); g.add(a.root)
  const wa = new Walker({ radius: 0.22, speed: 0.06, turn: 0.5 })
  wa.h = env.face(1, 0.6)
  const actsA = new Acts({ bask: [4, 5, 10], look: [3, 2, 5], hide: [1, 2, 4], walk: [1, 99, 99], turn: [1, 99, 99] }, (n, ac) => {
    if (n === 'walk' && !wa.pick(0.08)) ac.next('look')
    if (n === 'turn') wa.want = wa.h + ac.sgn * rnd(0.4, 1)
  })
  // 在水裡游的那隻
  const b = turtleModel('slider', true), sb = { neck: 0, look: 0, phase: 0, amp: 1 }
  b.root.scale.setScalar(S * 0.8); g.add(b.root)
  const rocks = env.rocks
  const nearRock = (x, z, r = 0.25) => rocks.some((rk) => Math.hypot(x - rk.x, z - rk.z) < rk.r + r)
  const wb = new Walker({ radius: 1.7, speed: 0.22, turn: 0.7, avoid: (x, z, p) => {
    for (let k = 0; k <= 10; k++) if (nearRock(lerp(p.x, x, k / 10), lerp(p.y, z, k / 10), 0.35)) return true
    return false
  } })
  for (let i = 0; i < 50; i++) { const x = rnd(-1.6, 1.6), z = rnd(-1.6, 1.6); if (!nearRock(x, z, 0.5)) { wb.p.set(x, z); break } }
  const update = (t, dt) => {
    actsA.tick(dt)
    const d = wa.update(dt)
    if ((actsA.name === 'walk' || actsA.name === 'turn') && !wa.busy) actsA.next()
    sa.phase += d / (0.06 * S); sa.amp = damp(sa.amp, wa.busy ? 1 : 0, 6, dt)
    sa.look = actsA.name === 'look' ? 0.6 * Math.sin(t * 0.5 + actsA.r * 3) : 0
    turtleAnimate(a, sa, t, dt, wa.busy ? 'walk' : actsA.name === 'hide' ? 'hide' : actsA.name === 'bask' ? 'bask' : 'idle')
    a.root.position.set(wa.p.x, env.rockTop, wa.p.y); a.root.rotation.y = wa.h

    if (!wb.goal) wb.pick(0.8)
    const db = wb.update(dt)
    sb.phase += Math.max(db, dt * 0.05) / (0.05 * S)
    sb.look = 0.3 * Math.sin(t * 0.4)
    turtleAnimate(b, sb, t, dt, 'swim')
    b.root.position.set(wb.p.x, env.waterY - 0.07 * S * 0.8 + 0.006 * Math.sin(t * 2), wb.p.y); b.root.rotation.y = wb.h
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
