// 十種動物：都是寫實 3D 模型（Sketchfab 現成模型，或用照片／ChatGPT 參考圖交給 Tripo 生成），在 Blender 綁骨架，
// 程式轉骨頭做走路、跳枝、覓食等動作。模型比真實尺寸放大（不放大在校園尺度下看不到）；+z 是前方、腳底在原點。
// 這裡另外有停棲處（樹枝、樹幹、石頭），用 loft 放樣做。
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { canopyGeometry, ripple } from './campus.js'
import { leafify, barkify, leafCardGeometry, leafCardMaterial } from './foliage.js'

const { clamp, lerp, smoothstep: ss, randFloat: rnd } = THREE.MathUtils
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const tmp = new THREE.Color()
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const fract = (x) => x - Math.floor(x)
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt))
const dampAngle = (a, b, k, dt) => a + wrap(b - a) * (1 - Math.exp(-k * dt))
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const sgn = () => (Math.random() < 0.5 ? -1 : 1)

const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
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

/* ---------- 各種動物 ---------- */
const BUILD = {
  heron: malayanHeron,

  dove: spottedDove,

  nightheron: nightHeron,

  bulbul: bulbul,

  whiteeye: whiteeye,

  barbet: barbet,

  treepie: treepie,

  squirrel: squirrel,
  lizard: lizard,
  turtle: turtles,
}
/* ---------- 現成模型 ---------- */
// 松鼠和烏龜用網路上別人做好的寫實模型（來源與授權見 README、頁尾），載入後用頂點著色器把尾巴、頭、腳彎動。
const GLB = {}
export async function loadAnimalModels() {
  const L = new GLTFLoader(), D = new DRACOLoader()
  D.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
  L.setDRACOLoader(D)
  await Promise.all(['squirrel-rig', 'pond-turtle-rig', 'slider-rig', 'night-heron-rig', 'tree-lizard-rig', 'barbet-rig', 'bulbul-rig', 'whiteeye-rig', 'treepie-rig', 'dove-rig', 'heron-rig'].map((n) => L.loadAsync(`models/${n}.glb?v=${VER}`).then((g) => { GLB[n] = g.scene })))
}
/* ---------- 有骨架的現成模型：用「模型座標的軸」轉骨頭 ---------- */
// 每根骨頭的本地軸方向都不一樣（Blender 的 roll），直接轉 x/y/z 左右腳會不對稱。
// 這裡先算出每根骨頭靜止時在模型座標裡的朝向，turn(骨頭, 模型座標的軸, 角度) 再換算成本地軸，
// 所以「繞身體的上下軸轉」對每根骨頭意思都一樣。straight：一開始就把這些骨頭（例如捲起來的尾巴）拉直到某個比例。
function rigged(name, { straight = {} } = {}) {
  const model = cloneSkinned(GLB[name])
  const bones = {}
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o
    if (o.isMesh) {
      o.castShadow = true; o.frustumCulled = false
      if (o.material.isMeshBasicMaterial) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: 0.75 })
    }
  })
  for (const [n, k] of Object.entries(straight)) bones[n]?.quaternion.slerp(new THREE.Quaternion(), k)
  model.updateMatrixWorld(true)
  const mq = model.getWorldQuaternion(new THREE.Quaternion()).invert(), wq = new THREE.Quaternion()
  for (const b of Object.values(bones)) {
    b.userData.rest = b.quaternion.clone(); b.userData.restP = b.position.clone()
    b.userData.inv = mq.clone().multiply(b.getWorldQuaternion(wq)).invert()   // 模型座標 → 骨頭本地
  }
  const _a = V(), _q = new THREE.Quaternion()
  return {
    model, bones,
    reset() { for (const b of Object.values(bones)) { b.quaternion.copy(b.userData.rest); b.position.copy(b.userData.restP) } },
    // 把骨頭沿著父骨頭的方向推遠（s = 0.5 → 父骨頭拉長 50%），用來伸脖子
    stretch(n, s) { const b = bones[n]; if (b && s) b.position.copy(b.userData.restP).multiplyScalar(1 + s) },
    turn(n, axis, angle) {
      const b = bones[n]; if (!b || !angle) return
      b.quaternion.multiply(_q.setFromAxisAngle(_a.copy(axis).applyQuaternion(b.userData.inv).normalize(), angle))
    },
  }
}
// 版本號跟著 index.html 的 ?v= 走，模型檔才不會用到快取的舊版
const VER = new URL(import.meta.url).searchParams.get('v') ?? ''
const AX = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) }
// 腳趾（toeL0a → toeL0b …，Blender 自動找的）：彎曲軸 = 腳趾方向 × 往下，繞它正轉 = 趾尖往下勾
function toesOf(r, sd) {
  r.model.updateWorldMatrix(true, true)
  const at = (b) => r.model.worldToLocal(b.getWorldPosition(V()))
  return Object.keys(r.bones).filter((n) => n.startsWith('toe' + sd) && n.endsWith('a')).map((n) => {
    const a = r.bones[n], b = r.bones[n.slice(0, -1) + 'b'], d = at(b).sub(at(a)).setY(0).normalize()
    return { a: n, b: b.name, axis: d.cross(V(0, -1, 0)).normalize() }
  })
}
function curlToes(r, toes, c) { if (c) for (const t of toes) { r.turn(t.a, t.axis, c * 0.6); r.turn(t.b, t.axis, c * 0.9) } }

/* ---------- 地上走的鳥：現成或 Tripo 生成的模型 + 骨架（body → neck → head、tail、兩翼、兩腳 thigh → shin → foot） ---------- */
// cfg：name 模型、H 顯示高度、h0 模型高度、rotY 讓頭朝 +z、lat「繞它正轉 = 抬頭、腳往前」的左右軸、
//      walk Walker 參數、acts 動作表、step 步幅（公尺）、bob 走路點頭、sway 盯地面時脖子左右晃
function groundTripo(env, cfg) {
  const r = rigged(cfg.name)
  const k = cfg.H / cfg.h0, LAT = cfg.lat, FWD = cfg.fwd ?? V(1, 0, 0)   // FWD：身體前後軸（側傾用）
  const root = new THREE.Group(), inner = new THREE.Group()
  r.model.scale.setScalar(k); inner.add(r.model)
  inner.rotation.y = cfg.rotY
  root.add(inner, contactShadow(cfg.shadow ?? 0.3))
  const w = new Walker({ radius: 0.7, speed: 0.16, turn: 1.0, ...cfg.walk })
  w.h = env.face(sgn(), rnd(0.3, 0.8))
  const acts = new Acts(cfg.acts, (n, a) => {
    if (n === 'walk' && !w.pick(0.25)) a.next('look')
    if (n === 'turn') w.want = w.h + a.sgn * rnd(0.6, 2)
  })
  const glance = new Glance([0.6, 1.8], 0.7, 0.25)
  const c = { lean: 0, neck: 0, head: 0, yaw: 0, phase: 0, amp: 0, sway: 0, reach: 0, roll: 0, hb: 0, hb0: 0, thrust: 9, prevPhase: 0 }, focus = V()
  // 腳：踩在地上的那一點固定不動（不會滑），離身體太遠就抬起來跨到前面；一次只抬一隻。
  // 大腿、小腿用兩節 IK 對到腳踝目標，腳掌保持原本貼地的角度。全部在模型座標的側面（FWD、y）平面裡算
  const N = FWD.clone().cross(AX.y).normalize()   // 繞 N 轉 = 在側面平面裡從 FWD 轉向上
  const mp = (b, out = V()) => r.model.worldToLocal(r.bones[b].getWorldPosition(out))
  const ang = (a, b) => Math.atan2(b.y - a.y, _d.subVectors(b, a).dot(FWD))
  const _d = V(), _t = V(), _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _r = new THREE.Quaternion(), _m = new THREE.Quaternion()
  // 在模型座標裡繞 axis 轉骨頭（身體前傾、側傾之後也準；r.turn 的軸是以靜止姿勢算的）
  const modelQ = (o, out) => out.copy(_m.copy(r.model.getWorldQuaternion(_m)).invert()).multiply(o.getWorldQuaternion(_r))
  const rotM = (bn, axis, a) => {
    const b = r.bones[bn], pm = modelQ(b.parent, new THREE.Quaternion()), bm = modelQ(b, new THREE.Quaternion())
    b.quaternion.copy(pm.invert().multiply(_q.setFromAxisAngle(axis, a).multiply(bm)))
    b.updateWorldMatrix(false, true)
  }
  r.model.updateWorldMatrix(true, true)
  const legs = ['L', 'R'].map((sd) => {
    const hip = mp('thigh' + sd), knee = mp('shin' + sd), ankle = mp('foot' + sd)
    const a = knee.clone().sub(hip), b = ankle.clone().sub(knee)
    const bend = Math.sign(a.dot(FWD) * b.y - a.y * b.dot(FWD))
    // 腳是斜的（往外張），IK 在側面平面裡算，所以骨長也要用投影到側面的長度
    return { sd, toes: toesOf(r, sd), rest: ankle, L1: Math.hypot(a.dot(FWD), a.y), L2: Math.hypot(b.dot(FWD), b.y), bend, flat: r.bones['foot' + sd].userData.inv.clone().invert(),
      plant: null, from: V(), to: V(), t: 1, pos: V() }
  })
  const stride = cfg.stride ?? 0.22 * cfg.H, lift = cfg.lift ?? 0.06 * cfg.H, swing = cfg.swingT ?? 0.32
  const [KA, KB] = cfg.knee ?? [0.5, 1.1]   // 抬腳時：腳跟（看起來像膝蓋）往前上抬多少、跗蹠往後折多少
  const ik = (L, target) => {
    const hip = mp('thigh' + L.sd), tg = r.model.worldToLocal(_t.copy(target))
    const du = _d.subVectors(tg, hip).dot(FWD), dv = tg.y - hip.y
    const d = clamp(Math.hypot(du, dv), Math.abs(L.L1 - L.L2) + 1e-4, (L.L1 + L.L2) * 0.999)
    const base = Math.atan2(dv, du), al = Math.acos(clamp((L.L1 * L.L1 + d * d - L.L2 * L.L2) / (2 * L.L1 * d), -1, 1))
    // 兩種彎法挑跟原本模型同一個方向的
    let want = base + al
    const kx = Math.cos(want) * L.L1, ky = Math.sin(want) * L.L1
    if (Math.sign(kx * (dv - ky) - ky * (du - kx)) !== L.bend) want = base - al
    rotM('thigh' + L.sd, N, want - ang(hip, mp('shin' + L.sd)))
    const knee = mp('shin' + L.sd)
    rotM('shin' + L.sd, N, ang(knee, tg) - ang(knee, mp('foot' + L.sd)))
    // 抬腳（照影片）：腳跟往前上提、跗蹠往後折讓腳掌拖在後面，過一半後再往前伸直、落地
    const sw = L.t < 1 ? L.t : 0
    if (sw) {
      rotM('thigh' + L.sd, N, -KA * Math.sin(Math.PI * sw))
      rotM('shin' + L.sd, N, KB * Math.sin(Math.PI * Math.min(1, sw / 0.8)))
    }
    // 腳掌：回到模型座標裡原本的角度（貼平），抬腳時腳趾往下垂
    const fb = r.bones['foot' + L.sd]
    _p.copy(r.model.getWorldQuaternion(_q)).invert().multiply(fb.parent.getWorldQuaternion(_q)).invert()
    fb.quaternion.copy(_p.multiply(L.flat))
    fb.updateWorldMatrix(false, true)
    if (sw) rotM('foot' + L.sd, N, 0.5 * Math.sin(Math.PI * Math.min(1, sw / 0.85)))
    // 腳趾：空中收起來、快落地時張開，踩地時平貼
    curlToes(r, L.toes, sw ? 0.9 * Math.sin(Math.PI * Math.min(1, sw / 0.85)) - 0.15 * ss(sw, 0.8, 1) : 0)
  }
  // 蚯蚓：每格用目前嘴尖的位置重排一條管子。拔的時候一端還在土裡、被拉長；拔出來後掛在嘴上扭，吞的時候越來越短
  let wormMesh = null, wormOn = false, caught = false, skin = null, tipIdx = -1
  // 嘴尖：模型上最往前的那個頂點（只看上半身），每格用蒙皮後的位置，蚯蚓才真的夾在嘴裡
  if (cfg.worm) {
    r.model.traverse((o) => { if (o.isSkinnedMesh) skin = o })
    const p = skin.geometry.attributes.position, v = V(), H = skin.geometry.boundingBox ?? (skin.geometry.computeBoundingBox(), skin.geometry.boundingBox)
    let best = Infinity
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (v.y > H.max.y * 0.6 && v.dot(FWD) < best) { best = v.dot(FWD); tipIdx = i } }
  }
  const anchor = V(), _tip = V(), _hd = V(), wormMat = new THREE.MeshStandardMaterial({ color: 0xb8675c, roughness: 0.45, emissive: 0x2a0d08 })
  const worm = (n, kk, t) => {
    if (n !== 'worm' || kk < 0.18) { wormOn = false; if (wormMesh) wormMesh.visible = false; return }
    r.bones.head.updateWorldMatrix(true, true)
    const tip = skin.getVertexPosition(tipIdx, _tip).applyMatrix4(skin.matrixWorld)
    // 往頭的方向縮 1.5 公分：夾在上下喙之間，不是黏在尖端外面
    tip.addScaledVector(r.bones.head.getWorldPosition(_hd).sub(tip).normalize(), 0.015)
    if (!wormOn) { wormOn = true; caught = Math.random() < 0.75; anchor.set(tip.x, 0.004, tip.z) }
    if (!caught || kk > 0.97) { if (wormMesh) wormMesh.visible = false; return }
    const pts = [], N = 12, L = 0.15
    const release = ss(kk, 0.53, 0.58), swallow = ss(kk, 0.75, 0.97)
    // 露出來的那段最長 L：拉得比 L 遠，土裡那端就被拔起來跟著走
    const dir = V().subVectors(anchor, tip), dl = dir.length()
    const end = dl > L ? tip.clone().addScaledVector(dir, L / dl) : anchor.clone()
    end.y = Math.max(end.y, 0.004)
    for (let i = 0; i <= N; i++) {
      const u = i / N
      // 還連著土：從地面拉到嘴尖，中間有點下垂、扭來扭去掙扎
      const a = V().lerpVectors(end, tip, u), wob = Math.sin(Math.PI * u)
      a.y -= wob * 0.012; a.x += Math.sin(u * 8 + t * 18) * 0.009 * wob; a.z += Math.cos(u * 7 + t * 15) * 0.007 * wob
      // 拔出來了：從嘴尖往下垂、左右扭；吞的時候長度縮短
      const len = L * (1 - swallow) * u
      const b = V(tip.x + Math.sin(u * 5 + t * 9) * 0.035 * u, tip.y - len, tip.z + Math.cos(u * 4 + t * 7) * 0.025 * u)
      pts.push(a.lerp(b, release))
    }
    if (!wormMesh) { wormMesh = new THREE.Mesh(new THREE.BufferGeometry(), wormMat); wormMesh.frustumCulled = false; root.parent.add(wormMesh) }
    wormMesh.visible = true
    wormMesh.geometry.dispose()
    wormMesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => root.parent.worldToLocal(p))), 18, 0.0065, 5)
  }
  const update = (t, dt) => {
    acts.tick(dt)
    const d = w.update(dt)
    if ((acts.name === 'walk' || acts.name === 'turn') && !w.busy) acts.next()
    c.phase += d / stride; c.amp = damp(c.amp, w.busy ? 1 : 0, 6, dt)
    const n = acts.name, kk = acts.k
    // 目標姿勢：lean 身體前傾、neck 脖子往前下伸、head 頭抬回水平、reach 脖子伸長（cfg.reach 倍）
    let lean = 0, neck = 0, head = 0, reach = 0.45, rate = 4
    if (n === 'hunt' || n === 'stare') { lean = 0.35; neck = 0.5; head = -0.35; reach = 0.85 }
    else if (n === 'strike' || n === 'peck') {
      if (kk < 0.3) { lean = 0.4; neck = 0.6; head = -0.4; reach = 0.6 }
      else if (kk < 0.45) { lean = 0.75; neck = 1.1; head = -0.2; reach = 1.2; rate = 25 }
      else { lean = 0.1; neck = 0.1; head = 0.1; reach = 0.4; rate = 6 }
    } else if (n === 'walk' || n === 'turn') { lean = 0.15; neck = 0.2; head = -0.15; reach = 0.6 }
    else if (n === 'look') { neck = -0.25; head = 0.2; reach = 1.05 }   // 警戒：脖子往上伸直
    else if (n === 'worm') {
      // 抓蚯蚓：瞄準 → 戳進草裡 → 分三下把蚯蚓拔出來 → 叼著甩一甩 → 嘴朝上吞下去
      if (kk < 0.12) { lean = 0.4; neck = 0.6; head = -0.4; reach = 0.6 }
      else if (kk < 0.2) { lean = 0.75; neck = 1.15; head = -0.2; reach = 1.2; rate = 25 }
      else if (kk < 0.55) {
        const pp = (kk - 0.2) / 0.35 * 3, pull = (Math.floor(pp) + ss(pp % 1, 0, 0.35)) / 3
        lean = 0.75 - 0.3 * pull; neck = 1.1 - 0.45 * pull; head = -0.2 + 0.05 * pull; reach = 1.2 - 0.25 * pull; rate = 18
      } else if (kk < 0.75) { lean = 0.2; neck = 0.05; head = -0.05; reach = 0.85; rate = 8 }
      else { lean = 0.05; neck = -0.35; head = -0.6 + 0.08 * Math.sin(t * 9); reach = 0.9; rate = 7 }
    }
    c.lean = damp(c.lean, lean, rate, dt); c.neck = damp(c.neck, neck, rate, dt); c.head = damp(c.head, head, rate, dt)
    c.reach = damp(c.reach, reach * (cfg.reach ?? 0), rate, dt)
    if (n === 'look' || n === 'stand') glance.update(dt)
    c.yaw = damp(c.yaw, n === 'look' || n === 'stand' ? glance.yaw * (n === 'look' ? 1 : 0.4) : 0, 10, dt)
    // 盯地面時脖子左右慢慢晃（頭保持對著同一點，用視差判斷獵物位置），晃一陣停一陣
    c.sway = damp(c.sway, n === 'stare' && cfg.sway ? 0.35 * ss(Math.sin(t * 0.45), -0.3, 0.3) * Math.sin(t * 3.4)
      : n === 'worm' && kk > 0.55 && kk < 0.75 ? 0.3 * Math.sin(t * 13) : 0, n === 'worm' ? 20 : 8, dt)   // 叼著蚯蚓時頭左右甩
    const ph = c.phase * Math.PI * 2
    r.reset()
    // 走路時重心移到踩地的那隻腳（身體側傾）、每一步前後點一下；站著時慢慢呼吸
    c.roll = damp(c.roll, 0.05 * ((legs[0].t < 1) - (legs[1].t < 1)), 5, dt)
    const roll = c.roll, pitch = 0.035 * Math.sin(ph * 2) * c.amp, breath = 0.025 * Math.sin(t * 1.7)
    if (r.bones.chest) {
      // 身體兩節分攤前傾，脖子三節分攤彎曲和伸長，頭整顆不變形
      r.turn('body', LAT, -c.lean * 0.6 + pitch + 0.015 * Math.sin(t * 1.3)); r.turn('body', FWD, roll)
      r.turn('chest', LAT, -c.lean * 0.4 + breath - pitch * 0.5); r.turn('chest', FWD, -roll * 0.4)
      const nb = -c.neck * 0.8 - pitch * 0.5, ny = c.yaw * 0.5 + c.sway
      for (const [b, f] of [['neck', 0.45], ['neck2', 0.35], ['neck3', 0.2]]) { r.turn(b, LAT, nb * f); r.turn(b, AX.y, ny * f) }
      r.turn('neck3', FWD, -roll * 0.6)
      for (const b of ['neck2', 'neck3', 'head']) r.stretch(b, c.reach)
    } else {
      r.turn('body', LAT, -c.lean + 0.02 * Math.sin(t * 1.3)); r.turn('body', FWD, roll)
      r.turn('neck', LAT, -c.neck * 0.8); r.turn('neck', AX.y, c.yaw * 0.5 + c.sway)
      r.stretch('head', c.reach)
    }
    r.turn('head', LAT, -c.neck * 0.3 - c.head); r.turn('head', AX.y, c.yaw * 0.6 - c.sway * 0.95)
    // 尾巴：前傾時翹起、走路時跟著步伐上下左右擺
    r.turn('tail', LAT, 0.1 * c.lean + 0.06 * Math.sin(ph * 2 + 1) * c.amp); r.turn('tail', AX.y, 0.08 * Math.sin(ph) * c.amp)
    for (const [wg, sg] of [['wingL', 1], ['wingR', -1]]) r.turn(wg, AX.y, sg * (0.02 * breath / 0.025 + 0.04 * Math.abs(roll) / 0.07))
    // 抬腳那一下身體微微升起
    const up = legs.reduce((a, L) => a + (L.t < 1 ? Math.sin(Math.PI * L.t) : 0), 0)
    root.position.set(w.p.x, 0.012 * cfg.H * up, w.p.y); root.rotation.y = w.h
    root.updateWorldMatrix(true, true)
    const fwd = _t.set(Math.sin(w.h), 0, Math.cos(w.h)).clone(), moving = c.amp > 0.3
    // 走路時左右腳照節拍輪流跨：每走 stride 公尺一個循環，左腳在 0、右腳在半圈，步伐才平均
    const beat = legs.map((L, i) => moving && Math.floor(c.phase + i * 0.5) > Math.floor(c.prevPhase + i * 0.5))
    c.prevPhase = c.phase
    legs.forEach((L, li) => {
      const home = r.model.localToWorld(L.rest.clone()); home.y -= root.position.y
      if (!L.plant) { L.plant = home.clone(); L.pos.copy(home) }
      const other = legs.find((o) => o !== L)
      if (L.t < 1) {
        L.t = Math.min(1, L.t + dt / swing)
        const e = L.t * L.t * (3 - 2 * L.t)
        L.pos.lerpVectors(L.from, L.to, e); L.pos.y += lift * Math.sin(Math.PI * L.t)
        if (L.t >= 1) { L.plant.copy(L.to); if (cfg.wade) ripple(L.to.x, L.to.z, 0.35) }   // 涉水時每踩一步一圈小水波
      } else {
        L.pos.copy(L.plant)
        // 腳落後太多（走路）或離站姿位置太遠（停下、轉身）就跨一步；另一隻腳在空中時不跨
        const far = Math.hypot(L.plant.x - home.x, L.plant.z - home.z)
        if (other.t >= 1 && (moving ? beat[li] || far > stride * 1.2 : far > 0.035 * cfg.H)) {
          L.from.copy(L.plant); L.to.copy(home).addScaledVector(fwd, moving ? stride * 0.5 : 0); L.t = 0
          if (moving) { c.thrust = 0; c.hb0 = c.hb }
        }
      }
      ik(L, L.pos)
    })
    // 鳩鴿類走路點頭：其實是頭前後移動，不是轉。每跨一步，頭很快往前推（thrust），
    // 之後身體往前走、頭停在空中原地不動（hold），所以相對身體慢慢往後退，下一步再推
    if (cfg.bob) {
      const A = cfg.bob, TH = cfg.thrustT ?? 0.13
      if (c.thrust < TH) { c.thrust += dt; const e = Math.min(1, c.thrust / TH); c.hb = lerp(c.hb0, A, e * e * e * (e * (e * 6 - 15) + 10)) }
      // 真的鳥頭在空中完全不動，但斑鳩腳短、每步只走 5 公分，從網頁的鏡頭距離看不出來，
      // 所以 bobGain 倍誇張：停頭時頭相對身體退得比身體走得快（在世界裡會微微往後飄）
      else c.hb = moving ? Math.max(-2 * A, c.hb - (cfg.bobGain ?? 1) * (w.v / k) * dt) : damp(c.hb, 0, 5, dt)
      const hd = r.bones.head
      // 頭推到前面時稍微低一點（影片裡脖子往前伸時頭會下沉）
      hd.position.add(FWD.clone().multiplyScalar(-c.hb).add(_d.set(0, -0.3 * Math.max(0, c.hb), 0)).applyQuaternion(modelQ(hd.parent, new THREE.Quaternion()).invert()))
    }
    if (cfg.worm) worm(n, kk, t)
    // 涉水的鷺鷥啄下去、嘴碰到水面時激起一圈大水波
    if (cfg.wade) {
      if (n !== 'strike') c.splash = false
      else if (!c.splash && kk > 0.3) {
        const tip = r.bones.head.localToWorld(_d.set(0, cfg.bill, 0))
        if (tip.y < env.waterY + 0.03) { ripple(tip.x, tip.z, 1.2); c.splash = true }
      }
    }
    focus.set(w.p.x, cfg.focusY ?? 0.6, w.p.y)
  }
  return { obj: root, focus, update, acts, walker: w, legs }
}
// 夜鷺（ChatGPT 參考圖 → Tripo，跟黑冠麻鷺一樣綁法：脖子三節、頭剛性、腳趾）：站著等、慢慢走、很快啄下去
function nightHeron(env) {
  // 站在池塘淺水裡（水深約 12 公分，離北岸石緣 1.4 公尺），只在池岸內側走動；啄的時候嘴伸進水裡
  return groundTripo(env, { name: 'night-heron-rig', H: 0.8, h0: 0.83, rotY: Math.PI / 2, lat: V(0, 0, -1), reach: 0.8, shadow: 0.3, wade: true, bill: 0.276,
    walk: { radius: 0.6, speed: 0.18, avoid: (x, z) => z < -0.4 }, swingT: 0.36, lift: 0, knee: [1.0, 1.7], focusY: 0.5,
    acts: { stand: [5, 3, 7], hunt: [3, 2.5, 5], walk: [1.2, 99, 99], turn: [1, 99, 99], strike: [0.7, 1.4, 1.4], look: [2, 1.5, 3] } })
}
// 黑冠麻鷺（ChatGPT 參考圖 → Tripo）：慢慢走、停下來盯地面（脖子左右晃）、啄進草裡拔蚯蚓吞下去
function malayanHeron(env) {
  return groundTripo(env, { name: 'heron-rig', H: 0.8, h0: 0.88, rotY: Math.PI / 2, lat: V(0, 0, -1), sway: true, shadow: 0.3, reach: 1, worm: true, bill: 0.225,
    walk: { radius: 1.6, speed: 0.2 }, step: 0.17, swingT: 0.38, lift: 0, knee: [1.2, 1.9], focusY: 0.5,
    acts: { walk: [3, 99, 99], stare: [3, 2.5, 5], worm: [1.4, 3.3, 3.9], look: [2, 1.5, 3], stand: [2, 2, 4], turn: [1, 99, 99] } })
}
// 珠頸斑鳩（ChatGPT 參考圖 → Tripo）：邊走邊點頭、啄地上的種子
// 斑鳩常一對一起在地上走
function spottedDove(env) {
  return groundGroup(2, 0.45, (avoid) => groundTripo(env, { name: 'dove-rig', H: 0.36, h0: 0.53, rotY: Math.PI / 2, lat: V(0, 0, -1), bob: 0.05, bobGain: 1.9, shadow: 0.18,
    walk: { radius: 1.2, speed: 0.15, avoid }, stride: 0.11, swingT: 0.16, lift: 0, knee: [0.6, 1.2], focusY: 0.3,
    acts: { walk: [4, 99, 99], peck: [3, 0.9, 1.3], look: [2, 1.2, 2.5], stand: [1.5, 1.5, 3], turn: [1, 99, 99] } }))
}

/* ---------- 停枝的鳥：Tripo 生成的模型 + 程式做的 IK 腳 ---------- */
// 模型由照片或 ChatGPT 畫的參考圖用 Tripo 轉成 3D，Blender 切掉原本的腳、綁骨架（body → neck → head、tail、兩翼）。
// 腳另外用兩節 IK + 四趾做，腳掌抓在枝上，跳的時候蹲低 → 蹬起 → 空中收腳 → 落地一壓一彈。
// cfg：name 模型、k 縮放、rotY 讓頭朝 +z、lat 模型的左右軸、feet 切口中心（腳長出來的地方）、
//      leg 腳的大小倍數、legC 腳的顏色、beat 鳴叫時點頭的頻率
function perchTripo(env, cfg) {
  const r = rigged(cfg.name)
  const k = cfg.k, LAT = cfg.lat.clone().normalize(), ls = cfg.leg ?? 1
  const LEG = { tib: 0.05 * ls, tar: 0.031 * ls }, LH = 0.05 * ls, HIPX = 0.022 * ls, HIP_IN = 0.025 * ls   // 髖關節埋進肚子裡
  const [fx, fy, fz] = cfg.feet
  const root = new THREE.Group(), lift = new THREE.Group(), inner = new THREE.Group()
  r.model.scale.setScalar(k); r.model.position.set(-fx * k, -fy * k + 0.006 * ls, -fz * k)
  inner.add(r.model); inner.rotation.y = cfg.rotY
  lift.add(inner); root.add(lift)
  const [ca, cb, ct] = cfg.legC ?? [0x4e5a45, 0x56614f, 0x4f5a4a]
  const legs = [1, -1].map((sx) => {
    const l = makeLeg({ a: LEG.tib, b: LEG.tar, ra: 0.0075 * ls, rb: 0.0042 * ls, ca, cb, bend: 1, x: sx * HIPX })
    birdFoot(l, 0.0042 * ls, 0.022 * ls, ct)
    root.add(l.hip)
    return l
  })
  const hp = new Hopper(env, { rest: [2, 7], dur: 0.32, ...cfg.hopper })
  const gl = new Glance([0.5, 1.6], 0.8, 0.3)
  const acts = new Acts({ idle: [4, 2, 5], call: [3, 2, 4], preen: [0.8, 1.5, 3] })
  const c = { yaw: 0, pitch: 0, call: 0 }, focus = V()
  const update = (t, dt) => {
    acts.tick(dt)
    if (acts.name !== 'idle') hp.wait = Math.max(hp.wait, 0.3)   // 做別的事時不跳
    hp.update(dt); gl.update(dt)
    const k01 = hp.hopping ? hp.k : 1
    const air = hp.hopping ? Math.sin(Math.PI * k01) : 0
    const push = hp.hopping ? Math.max(0, 1 - k01 / 0.25) : 0                      // 剛起跳那一下腿還是直的
    const land = hp.hopping ? 0 : Math.exp(-hp.landed * 7) * (1 + 0.4 * Math.sin(hp.landed * 22))
    const crouch = clamp(0.75 * hp.pre + 0.6 * land, 0, 1)
    c.yaw = damp(c.yaw, acts.name === 'preen' ? 1.2 * acts.sgn : gl.yaw, acts.name === 'preen' ? 6 : 18, dt)
    c.pitch = damp(c.pitch, acts.name === 'preen' ? 0.5 : gl.hp, 18, dt)
    c.call = damp(c.call, acts.name === 'call' ? 1 : 0, 6, dt)
    const beat = c.call * Math.max(0, Math.sin(t * (cfg.beat ?? 9)))
    r.reset()
    r.turn('body', LAT, 0.04 * beat)
    r.turn('neck', AX.y, c.yaw * 0.45); r.turn('neck', LAT, c.pitch * 0.4 + 0.12 * beat - 0.15 * crouch)
    r.turn('head', AX.y, c.yaw * 0.55); r.turn('head', LAT, c.pitch * 0.6 + 0.18 * beat + 0.15 * crouch)
    r.turn('tail', LAT, 0.45 * land - 0.3 * hp.pre + 0.2 * air)
    for (const [w, sg] of [['wingL', 1], ['wingR', -1]]) r.turn(w, AX.y, sg * (0.6 * air + 0.15 * push))
    // 身體：蹲下時壓低、往前傾；起跳時伸直；空中略抬頭
    const h = LH * (1 - 0.42 * crouch + 0.08 * push) - 0.02 * ls * air
    lift.position.set(0, h, 0.004 * ls * crouch)
    lift.rotation.x = 0.28 * crouch - 0.12 * push + 0.08 * air
    // 腳：在地上時腳掌抓在枝頂（root 座標 y=0）；空中往身體收
    const hipY = h + HIP_IN, hipZ = (-0.004 + 0.004 * crouch) * ls
    legs.forEach((l) => {
      const tuck = air * 0.75
      const fy2 = lerp(0.002, hipY - (LEG.tib + LEG.tar) * 0.45, tuck)
      const fz2 = lerp(0.006, -0.01, tuck) * ls
      legIK(l, hipY, hipZ, fy2, fz2, -0.1 * crouch)
      const curl = 0.55 + 0.6 * tuck - 0.2 * push
      l.toes.forEach((tt) => (tt.rotation.x = curl))
    })
    root.position.set(hp.s, env.branch.top(hp.s) + hp.y, 0)
    root.rotation.y = hp.h
    focus.set(hp.s, 0.3, 0)
  }
  return { obj: root, focus, update, hopper: hp, acts }
}
/* ---------- 停枝的鳥：用模型自己的腳（骨頭 thigh → shin → foot） ---------- */
// 跳的節奏和 perchTripo 一樣，只是腳不另外做：蹲低時大腿往前、小腿往後折、身體跟著降低，空中把腳收起來。
// cfg：name、k、rotY、lat（繞它正轉 = 抬頭、腳往前）、foot 腳底在模型裡的高度、drop 蹲到底時身體降多少（模型單位）
function perchRigged(env, cfg) {
  const r = rigged(cfg.name)
  const k = cfg.k, LAT = cfg.lat
  const root = new THREE.Group(), lift = new THREE.Group(), inner = new THREE.Group()
  r.model.scale.setScalar(k); r.model.position.y = -cfg.foot * k
  inner.add(r.model); inner.rotation.y = cfg.rotY
  lift.add(inner); root.add(lift)
  const hp = new Hopper(env, { rest: [2, 7], dur: 0.32, ...cfg.hopper })
  const toes = [toesOf(r, 'L'), toesOf(r, 'R')]
  const gl = new Glance([0.5, 1.6], 0.8, 0.3)
  const acts = new Acts({ idle: [4, 2, 5], call: [3, 2, 4], preen: [0.8, 1.5, 3] })
  const c = { yaw: 0, pitch: 0, call: 0 }, focus = V()
  const update = (t, dt) => {
    acts.tick(dt)
    if (acts.name !== 'idle') hp.wait = Math.max(hp.wait, 0.3)
    hp.update(dt); gl.update(dt)
    const k01 = hp.hopping ? hp.k : 1
    const air = hp.hopping ? Math.sin(Math.PI * k01) : 0
    const push = hp.hopping ? Math.max(0, 1 - k01 / 0.25) : 0
    const land = hp.hopping ? 0 : Math.exp(-hp.landed * 7) * (1 + 0.4 * Math.sin(hp.landed * 22))
    const crouch = clamp(0.75 * hp.pre + 0.6 * land, 0, 1)
    c.yaw = damp(c.yaw, acts.name === 'preen' ? 1.2 * acts.sgn : gl.yaw, acts.name === 'preen' ? 6 : 18, dt)
    c.pitch = damp(c.pitch, acts.name === 'preen' ? -0.5 : -gl.hp, 18, dt)
    c.call = damp(c.call, acts.name === 'call' ? 1 : 0, 6, dt)
    const beat = c.call * Math.max(0, Math.sin(t * (cfg.beat ?? 9)))
    r.reset()
    // 身體蹲低時前傾、起跳時伸直；頭保持水平
    r.turn('body', LAT, -0.3 * crouch + 0.1 * push - 0.06 * air + 0.03 * beat)
    r.turn('neck', AX.y, c.yaw * 0.45); r.turn('neck', LAT, c.pitch * 0.4 - 0.12 * beat + 0.15 * crouch)
    r.turn('head', AX.y, c.yaw * 0.55); r.turn('head', LAT, c.pitch * 0.6 - 0.18 * beat + 0.15 * crouch)
    r.turn('tail', LAT, -0.45 * land + 0.3 * hp.pre - 0.2 * air)
    for (const [w, sg] of [['wingL', 1], ['wingR', -1]]) r.turn(w, AX.y, sg * (0.6 * air + 0.15 * push))
    // 腳：蹲 → 大腿往前、小腿往後折、腳掌壓平；空中 → 整隻腳收到肚子下面
    const bend = 0.9 * crouch, tuck = 0.8 * air
    for (const s of ['L', 'R']) {
      r.turn('thigh' + s, LAT, 0.3 * crouch + bend * 0.6 + tuck * 0.8)
      r.turn('shin' + s, LAT, -bend * 1.2 - tuck * 1.6)
      r.turn('foot' + s, LAT, bend * 0.6 + tuck * 1.2)
    }
    // 腳趾：平常勾住樹枝，蹬出去時放開、空中半收，落地再抓緊
    const grip = 0.55 - 0.65 * push - 0.3 * air + 0.25 * land
    toes.forEach((t) => curlToes(r, t, grip))
    lift.position.y = -cfg.drop * k * crouch
    root.position.set(hp.s, env.branch.top(hp.s) + hp.y, 0)
    root.rotation.y = hp.h
    focus.set(hp.s, 0.3, 0)
  }
  return { obj: root, focus, update, hopper: hp, acts }
}
// 五色鳥：ChatGPT 參考圖 → Tripo，正側面頭朝 -x；腳是模型自己生成的，綁了 thigh → shin → foot
function barbet(env) { return perchRigged(env, { name: 'barbet-rig', k: 0.6, rotY: Math.PI / 2, lat: V(0, 0, -1), foot: 0.01, drop: 0.05, beat: 9 }) }
// 白頭翁：ChatGPT 參考圖 → Tripo，正側面頭朝 -x
// 綠繡眼常常幾隻一起：三隻在同一根枝上跳，彼此不擠在一起
// 同一根枝上好幾隻：各跳各的，但不會跳到別隻身上（gap 公尺內有鳥就不跳），一開始在鏡頭正對的那段枝上分開站
function perchGroup(n, gap, start, mk) {
  const birds = []
  const blocked = (s1, me) => birds.some((b) => b.hopper !== me && Math.abs(b.hopper.s - s1) < gap)
  for (let i = 0; i < n; i++) birds.push(mk(blocked))
  birds.forEach((b, i) => { b.hopper.s = start + i * gap * 1.4 })
  return group(birds, () => V(birds.reduce((a, b) => a + b.hopper.s, 0) / n, 0.3, 0))
}
// 地上兩隻：各走各的，選目的地和走的路線都會避開另一隻
function groundGroup(n, gap, mk) {
  const birds = []
  const near = (x, z, me) => birds.some((b) => {
    const w = b.walker
    if (w.p === me) return false
    return Math.hypot(x - w.p.x, z - w.p.y) < gap || (w.goal && Math.hypot(x - w.goal.x, z - w.goal.y) < gap)
  })
  const avoid = (x, z, p) => { for (let k = 1; k <= 8; k++) if (near(lerp(p.x, x, k / 8), lerp(p.y, z, k / 8), p)) return true; return false }
  for (let i = 0; i < n; i++) birds.push(mk(avoid))
  birds.forEach((b, i) => b.walker.p.set((i - (n - 1) / 2) * gap * 1.5, (i % 2) * 0.2))
  return group(birds, () => birds.reduce((a, b) => a.add(b.focus), V()).divideScalar(n))
}
function group(birds, center) {
  const g = new THREE.Group(), focus = V()
  birds.forEach((b) => g.add(b.obj))
  const update = (t, dt) => { birds.forEach((b) => b.update(t, dt)); focus.copy(center()) }
  return { obj: g, focus, update, birds, acts: birds[0].acts }
}
// 綠繡眼常常幾隻一起：三隻在同一根枝上跳
function whiteeye(env) {
  return perchGroup(3, 0.28, -1.1, (blocked) => perchTripo(env, { name: 'whiteeye-rig', k: 0.42, rotY: Math.PI / 2, lat: V(0, 0, 1), feet: [-0.055, 0.17, 0], leg: 0.84, legC: [0x5d6266, 0x676c70, 0x5d6266], beat: 11,
    hopper: { rest: [0.8, 3], blocked } }))
}
// 樹鵲、白頭翁常成對出現：兩隻在同一根枝上
function treepie(env) {
  return perchGroup(2, 0.55, -1.2, (blocked) => perchTripo(env, { name: 'treepie-rig', k: 0.82, rotY: Math.PI / 2, lat: V(0, 0, 1), feet: [-0.19, 0.16, 0], leg: 1.15, legC: [0x1c1c1c, 0x222222, 0x1c1c1c], beat: 6,
    hopper: { blocked } }))
}
function bulbul(env) {
  return perchGroup(2, 0.32, -0.9, (blocked) => perchTripo(env, { name: 'bulbul-rig', k: 0.42, rotY: Math.PI / 2, lat: V(0, 0, 1), feet: [-0.07, 0.165, 0], leg: 0.86, legC: [0x2c2a26, 0x33302c, 0x2c2a27], beat: 7,
    hopper: { blocked } }))
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
// 斯文豪氏攀蜥：用同屬的先島攀蜥 3D 掃描（CC0），綁了骨架（tools/rig-distance.py）。
// 模型座標：頭朝 -x、y 往上（貼在樹上時是朝外）、z 是左右；原本尾巴捲成一圈，這裡先拉直大半。
function lizard(env) {
  const tails = Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['tail' + i, i === 0 ? 0 : 0.85]))
  const r = rigged('tree-lizard-rig', { straight: tails })
  const k = 0.26 / 3.35   // 吻端到骨盆約 26 公分（比真的大一些，才看得清楚）
  const root = new THREE.Group(), inner = new THREE.Group()
  r.model.scale.setScalar(k); r.model.position.y = 0.6 * k
  inner.add(r.model); inner.rotation.y = Math.PI / 2   // 頭轉到 +z
  root.add(inner)

  // 樹幹表面上走：p.x 是沿圓周的弧長、p.y 是高度；heading 0 = 頭朝上
  const T = env.trunk
  const w = new Walker({ radius: 0.75, speed: 0.6, turn: 7, center: [0, 1.75], avoid: (x, z) => Math.abs(x) > T.arc || z < 1.05 || z > 2.5 })
  w.p.set(0, 1.6); w.h = Math.random() < 0.6 ? 0 : Math.PI
  const acts = new Acts({ walk: [3, 99, 99], rest: [4, 2.5, 7], pushup: [2, 1.4, 2.4], look: [2, 1, 2.5], turn: [1.5, 99, 99] }, (n, a) => {
    if (n === 'walk' && !w.pick(0.25, 0.8)) a.next('rest')
    if (n === 'turn') w.want = pick([0, Math.PI, 0.35, -0.35, Math.PI + 0.35, Math.PI - 0.35])
  })
  const surf = new THREE.Group(), holder = new THREE.Group()
  surf.add(holder); holder.add(root)
  const m4 = new THREE.Matrix4(), xa = V(), ya = V(0, 0, 1), za = V(), focus = V()
  // 四隻腳：side 左 -1／右 +1（模型的 z），對角兩隻一起動
  const LEGS = [['fl', -1, 0], ['fr', 1, 0.5], ['hl', -1, 0.5], ['hr', 1, 0]]
  let phase = 0, amp = 0, push = 0, look = 0
  const update = (t, dt) => {
    acts.tick(dt)
    const d = w.update(dt)
    if ((acts.name === 'walk' || acts.name === 'turn') && !w.busy) acts.next()
    phase += d / 0.16; amp = damp(amp, w.busy ? 1 : 0, 14, dt)
    const ph = phase * Math.PI * 2
    push = damp(push, acts.name === 'pushup' ? 1 : 0, 10, dt)
    const bob = push * Math.max(0, Math.sin(t * 11))
    look = damp(look, acts.name === 'look' ? acts.r * 0.6 : acts.name === 'rest' ? 0.15 * Math.sin(t * 0.4) : 0, 6, dt)
    r.reset()
    // 走路時身體左右扭成 S 形（在樹皮的平面上，繞朝外的 y 軸），頭維持朝前
    const bend = 0.2 * Math.sin(ph) * amp
    r.turn('pelvis', AX.y, -bend * 0.5); r.turn('spine1', AX.y, bend); r.turn('spine2', AX.y, bend * 0.6)
    r.turn('neck', AX.y, -bend * 1.2 + look * 0.6); r.turn('head', AX.y, look * 0.5)
    // 伏地挺身：前半身撐起、頭一上一下
    r.turn('spine2', AX.z, -0.25 * push - 0.12 * bob); r.turn('neck', AX.z, -0.1 * push - 0.1 * bob)
    // 尾巴：跟著走路左右擺；斜著爬時尾巴會橫過樹幹，每節往樹皮彎一點，才會貼著圓圓的樹幹
    const hug = -0.7 * k / T.R * Math.abs(Math.sin(w.h)) * 1.1
    for (let i = 0; i < 10; i++) {
      r.turn('tail' + i, AX.y, (-0.12 * Math.sin(ph - i * 0.7) * amp + 0.03 * Math.sin(t * 0.7 - i * 0.6)) * (i < 3 ? 1 : 0.6))
      if (i > 0) r.turn('tail' + i, AX.z, hug)
    }
    for (const [l, side, off] of LEGS) {
      const c = fract(phase + off), duty = 0.55
      let sw, lift = 0
      if (c < duty) sw = 0.5 - c / duty
      else { const u = (c - duty) / (1 - duty); sw = u - 0.5; lift = Math.sin(Math.PI * u) }
      r.turn(l + '0', AX.y, -side * sw * 0.8 * amp)            // 前後擺
      r.turn(l + '0', AX.x, -side * 0.5 * lift * amp)          // 抬腳
      if (l[0] === 'f') r.turn(l + '0', AX.x, side * 0.3 * push)   // 伏地挺身時前腳撐直
    }
    // 擺到樹幹表面：holder 的 +y 朝外、+z 是頭的方向
    surf.rotation.y = w.p.x / T.R
    holder.position.set(0, w.p.y, T.R + 0.004 + 0.012 * push)
    za.set(Math.sin(w.h), Math.cos(w.h), 0); xa.crossVectors(ya, za)
    holder.quaternion.setFromRotationMatrix(m4.makeBasis(xa, ya, za))
    focus.set(0, w.p.y, T.R)
  }
  return { obj: surf, focus, update, acts }
}

/* ---------- 池塘烏龜：一隻在石頭上曬太陽（斑龜的近親 3D 掃描），一隻在水裡游（紅耳龜 3D 掃描） ---------- */
// 兩隻都在 Blender 綁了骨架（tools/rig-turtle.py）：殼 shell 是硬的根骨頭，脖子兩節 + 頭、四隻腳各兩節、尾巴。
// 模型座標：頭朝 -x、y 往上；殼長約 12 單位。
function turtleOf(name, len) {
  const model = cloneSkinned(GLB[name + '-rig'])
  const bones = {}
  model.traverse((o) => {
    if (o.isBone) { bones[o.name] = o; o.userData.rest = o.quaternion.clone(); o.userData.rp = o.position.clone() }
    if (o.isMesh) {
      o.castShadow = true; o.frustumCulled = false
      // 掃描模型是不受光的材質，換成一般受光材質才會和場景的光影一致
      if (o.material.isMeshBasicMaterial) o.material = new THREE.MeshStandardMaterial({ map: o.material.map, roughness: 0.75 })
    }
  })
  const box = new THREE.Box3().setFromObject(model), k = len / (box.max.x - box.min.x)
  const inner = new THREE.Group()
  model.scale.setScalar(k); model.position.y = -box.min.y * k
  inner.add(model); inner.rotation.y = Math.PI / 2   // 頭轉到 +z
  const root = new THREE.Group(); root.add(inner)
  // 縮脖子：neck0 沿著自己的方向往殼裡滑
  const n0 = bones.neck0, nDir = bones.neck1.position.clone().applyQuaternion(n0.userData.rest), nLen = nDir.length()
  nDir.normalize()
  const _e = new THREE.Euler(), _q = new THREE.Quaternion()
  const pose = (n, x = 0, y = 0, z = 0) => { const b = bones[n]; b.quaternion.copy(b.userData.rest).multiply(_q.setFromEuler(_e.set(x, y, z))) }
  const neckOut = (f) => n0.position.copy(n0.userData.rp).addScaledVector(nDir, f * nLen)
  return { root, pose, neckOut, h: (box.max.y - box.min.y) * k }
}
function turtles(env) {
  const g = new THREE.Group(), focus = V(0, 0.8, 0)
  // 曬太陽：脖子伸長、頭慢慢轉，偶爾縮頭
  const a = turtleOf('pond-turtle', 0.62)
  g.add(a.root)
  const wa = new Walker({ radius: 0.22, speed: 0.05, turn: 0.5 })
  wa.h = env.face(1, 0.6)
  const actsA = new Acts({ bask: [4, 5, 10], look: [3, 2, 5], hide: [1, 2, 4], turn: [1, 99, 99] }, (n, ac) => {
    if (n === 'turn') wa.want = wa.h + ac.sgn * rnd(0.4, 1)
  })
  const sa = { neck: 0, ly: 0, lp: 0, tuck: 0 }
  // 水裡游：四肢划水，頭露出水面
  const b = turtleOf('slider', 0.46)
  g.add(b.root)
  const rocks = env.rocks
  const nearRock = (x, z, r = 0.25) => rocks.some((rk) => Math.hypot(x - rk.x, z - rk.z) < rk.r + r)
  const wb = new Walker({ radius: 1.7, speed: 0.18, turn: 0.6, avoid: (x, z, p) => {
    for (let k = 0; k <= 10; k++) if (nearRock(lerp(p.x, x, k / 10), lerp(p.y, z, k / 10), 0.35)) return true
    return false
  } })
  for (let i = 0; i < 50; i++) { const x = rnd(-1.6, 1.6), z = rnd(-1.6, 1.6); if (!nearRock(x, z, 0.5)) { wb.p.set(x, z); break } }
  let wake = 0; const _wk = V()
  const update = (t, dt) => {
    actsA.tick(dt)
    wa.update(dt)
    if (actsA.name === 'turn' && !wa.busy) actsA.next()
    const n = actsA.name
    // 脖子：曬太陽時伸長、頭抬平；受驚時很快縮進殼裡，腳也收起來；平常呼吸時脖子一伸一縮
    sa.neck = damp(sa.neck, n === 'hide' ? -0.85 : n === 'bask' ? 0.15 : 0, n === 'hide' ? 7 : 1.2, dt)
    sa.tuck = damp(sa.tuck, n === 'hide' ? 1 : 0, n === 'hide' ? 6 : 1, dt)
    sa.ly = damp(sa.ly, n === 'look' ? 0.55 * Math.sin(t * 0.5 + actsA.r * 3) : 0.08 * Math.sin(t * 0.2), 2, dt)
    sa.lp = damp(sa.lp, n === 'bask' ? 0.3 : 0.15, 2, dt)
    a.neckOut(sa.neck + 0.03 * Math.sin(t * 1.4))
    a.pose('neck0', 0, sa.ly * 0.5, -sa.lp * 0.5)
    a.pose('neck1', 0, sa.ly * 0.3, -sa.lp * 0.3)
    a.pose('head', 0, sa.ly * 0.2, -sa.lp * 0.5 + 0.25 * sa.tuck)
    for (const [l, sg] of [['fl', 1], ['fr', -1], ['hl', 1], ['hr', -1]]) {
      a.pose(l + '0', 0, sg * 0.5 * sa.tuck, 0)
      a.pose(l + '1', 0, sg * 0.6 * sa.tuck, 0)
    }
    a.pose('tail', 0, 0.1 * Math.sin(t * 0.3), 0)
    a.root.position.set(wa.p.x, env.rockTop, wa.p.y); a.root.rotation.y = wa.h

    if (!wb.goal) wb.pick(0.8)
    wb.update(dt)
    // 划水：對角的兩隻腳一起划（左前＋右後、右前＋左後），前腳划得大、後腳像槳一樣推
    const ph = t * 3
    for (const [l, sg, off, A] of [['fl', 1, 0, 0.55], ['hr', -1, 0, 0.4], ['fr', -1, Math.PI, 0.55], ['hl', 1, Math.PI, 0.4]]) {
      const c = Math.sin(ph + off)
      b.pose(l + '0', 0.15 * Math.cos(ph + off), sg * A * c, 0)
      b.pose(l + '1', 0, sg * 0.35 * c, 0)
    }
    b.neckOut(0.1)
    b.pose('neck0', 0, 0.15 * Math.sin(t * 0.4), -0.15)
    b.pose('head', 0, 0.1 * Math.sin(t * 0.4), -0.2)
    b.pose('tail', 0, 0.25 * Math.sin(ph), 0)
    // 殼大約九成在水面下
    b.root.position.set(wb.p.x, env.waterY - b.h * 0.72 + 0.006 * Math.sin(t * 2), wb.p.y)
    b.root.rotation.y = wb.h; b.root.rotation.z = 0.04 * Math.sin(t * 1.6)
    // 游的時候頭前面推出一圈圈水波，停著的時候偶爾一小圈
    if ((wake -= dt) <= 0) {
      const hp = g.localToWorld(_wk.set(wb.p.x + Math.sin(wb.h) * 0.22, 0, wb.p.y + Math.cos(wb.h) * 0.22))
      ripple(hp.x, hp.z, wb.busy ? 0.55 : 0.2); wake = wb.busy ? 0.45 : rnd(2, 4)
    }
  }
  return { obj: g, focus, update, acts: actsA }
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
const BRANCH = { len: 2.6, y: 3.2 }
// 停棲的橫枝（樹的座標：樹幹在原點、枝條往 +x）：從樹幹斜斜往上長出來、慢慢轉平，末端微微下垂；
// 越往外越細，和樹幹接的地方粗一點。center(x) 是枝條中心高度、radius(x) 是半徑。
const limb = {
  center: (x) => 3.2 - 0.85 * Math.pow(1 - ss(x, -0.25, 1.6), 1.6) - 0.07 * ss(x, 2.2, 3.0),
  // 和樹幹接的地方慢慢變粗（枝領），不是一個圓頭插在樹幹上
  radius: (x) => lerp(0.11, 0.038, clamp(x / 2.95, 0, 1)) + 0.1 * Math.exp(-Math.max(x, 0) / 0.32),
  z: (x) => 0.03 * Math.sin(x * 2.1 + 0.5) * ss(x, 0.3, 1),
}
const barkPaint = (o, u, s, c, p) => o.copy(tmp.set(BARK)).multiplyScalar(0.85 + 0.25 * ss(s, -0.6, 0.8))
// 沿 [[x, y, z, r], ...] 長一根逐漸變細的枝
function bough(pts) {
  return loft(pts.map(([x, y, z, r]) => [x, y, z, r, r]), barkPaint, { seg: 12, sub: 4, up: V(0, 0, 1), material: mat(BARK, 0.9) })
}
function heroTree(away = -1) {
  // away：樹座標裡背對鏡頭的 z 方向；小枝往那邊長，才不會擋住停在枝上的動物
  const { len } = BRANCH
  const trunk = stick(0.26, 0.34, 7, BARK, [0, 7, 0], [0, 0, 0], 14)
  const pts = []
  for (let x = -0.25; x <= 2.95; x += 0.08) pts.push([x, limb.center(x), limb.z(x), limb.radius(x)])   // 從樹幹裡面開始長
  const branch = bough(pts)
  // 枝條末段分出幾根小枝，往外往上彎，末端是一小簇葉子（不再有直直戳上去的棍子）
  const g = new THREE.Group().add(trunk, branch)
  const twig = (x0, dir, up, L, r0, leaf) => {
    const y0 = limb.center(x0), z0 = limb.z(x0), q = []
    for (let k = 0; k <= 6; k++) {
      const f = k / 6
      q.push([x0 + L * f * 0.75, y0 + L * up * f * f + L * 0.15 * f, z0 + dir * L * f * 0.65, lerp(r0, r0 * 0.35, f)])
    }
    g.add(bough(q))
    // 小枝末端是鬆散的一叢葉子（只有葉片、沒有實心的球），沿小枝方向拉長、上下壓扁
    for (let k = 0; k < 2; k++) {
      const [lx, ly, lz] = q[4 + k * 2], m = new THREE.Mesh(leafCardGeometry(26, true), leafCardMaterial(0x5a9440))
      const r = leaf * (1 + k * 0.4)
      m.scale.set(r * 1.3, r * 0.8, r * 1.1); m.position.set(lx, ly + r * 0.2, lz); m.rotation.set(0.3 * k, k * 1.7, 0.2)
      g.add(m)
    }
  }
  // 動物停在 x ≈ 1.8～2.4，小枝長在靠樹幹那段和末端
  twig(1.0, away, 0.9, 0.7, 0.035, 0.22)
  twig(2.65, away * 0.8, 0.45, 0.5, 0.022, 0.18)
  twig(2.9, away * 0.3, 0.3, 0.4, 0.018, 0.16)
  const blob = (r, x, yy, z) => { const m = crownBlob(0x5a9440, r); m.position.set(x, yy, z); return m }
  g.add(blob(2.6, 0, 7.2, 0), blob(2.0, 1.6, 6.2, 0.6), blob(1.8, -1.4, 6.0, -0.5))
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true })
  return g
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
    const { len, y } = BRANCH
    const tree = heroTree(-1)   // 樹座標 +z 正好朝鏡頭
    // 樹幹放在動物的側邊，枝條朝動物伸過來
    tree.position.copy(side).multiplyScalar(-len)
    tree.rotation.y = Math.atan2(-side.z, side.x)
    g.add(tree)
    // obj 的 +x 就是枝條方向，原點在枝條的軸上
    obj.position.y = y
    obj.rotation.y = tree.rotation.y
    env.toCam = toCam.clone().applyAxisAngle(V(0, 1, 0), -obj.rotation.y)
    // 枝條表面的高度（obj 座標，s = 樹的 x - len）
    env.branch = { min: -len * 0.8, max: 0.15, top: (s) => limb.center(s + len) + limb.radius(s + len) - y }
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
