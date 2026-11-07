// 荷花池的荷花：浮在水面的荷葉、挺出水面的荷葉（像一把淺碗）、粉紅荷花、花苞、蓮蓬。
// 全部是程式做的幾何 + InstancedMesh，一種東西一次畫完。
// 挺水的葉子和花會隨風輕輕擺（每格重算矩陣，只有鏡頭在池塘附近時才算）。
// 動物（夜鷺、烏龜）附近和鏡頭看過去的那一段留成開放水面，才看得到牠們。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

let seed = 31
const rnd = (a = 0, b = 1) => a + (b - a) * ((seed = (seed * 16807) % 2147483647) / 2147483647)
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s) }
const noise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
  const l = (a, b, t) => a + (b - a) * t
  return l(l(hash(ix, iy), hash(ix + 1, iy), fx), l(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy)
}
function inside([x, z], poly) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[j]
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) c = !c
  }
  return c
}
// 點到多邊形邊的最短距離（離池岸多遠）
function edgeDist([x, z], poly) {
  let d = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i]
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t))
  }
  return d
}

/* ---------- 荷葉貼圖：中間一點淡黃綠的葉臍，放射狀的葉脈往外分叉，邊緣深一點 ---------- */
function leafTexture() {
  const N = 256, cv = document.createElement('canvas')
  cv.width = cv.height = N
  const c = cv.getContext('2d'), m = N / 2
  const g = c.createRadialGradient(m, m, 0, m, m, m)
  g.addColorStop(0, '#c8d08a'); g.addColorStop(0.07, '#9fbb6a'); g.addColorStop(0.2, '#6f9a52')
  g.addColorStop(0.75, '#5f8c48'); g.addColorStop(0.97, '#4f7a3c'); g.addColorStop(1, '#4a7038')
  c.fillStyle = g; c.fillRect(0, 0, N, N)
  // 一點點斑駁
  for (let i = 0; i < 500; i++) {
    c.fillStyle = `rgba(${rnd(60, 120)},${rnd(110, 160)},${rnd(60, 90)},${rnd(0.04, 0.1)})`
    c.beginPath(); c.arc(rnd(0, N), rnd(0, N), rnd(2, 10), 0, 7); c.fill()
  }
  // 葉脈：約 20 條從中心出發，到一半以後分叉
  c.lineCap = 'round'
  const V = 20
  for (let i = 0; i < V; i++) {
    const a = (i / V) * Math.PI * 2 + rnd(-0.05, 0.05)
    const vein = (a0, r0, r1, w) => {
      c.strokeStyle = 'rgba(200,215,150,0.28)'; c.lineWidth = w
      c.beginPath(); c.moveTo(m + Math.cos(a0) * r0, m + Math.sin(a0) * r0)
      const steps = 8
      for (let k = 1; k <= steps; k++) {
        const r = r0 + (r1 - r0) * (k / steps), aa = a0 + Math.sin(k * 0.7 + i) * 0.02
        c.lineTo(m + Math.cos(aa) * r, m + Math.sin(aa) * r)
      }
      c.stroke()
    }
    vein(a, 6, m * 0.97, 1.6)
    vein(a + 0.07, m * 0.5, m * 0.95, 1.2)
    vein(a - 0.07, m * 0.55, m * 0.95, 1.2)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/* ---------- 葉子的形狀（半徑 1）：極座標網格，uv 照平面投影貼上去 ---------- */
function leafGeometry(shape) {
  const R = 9, S = 40, P = [], UV = [], I = []
  P.push(0, shape(0, 0), 0); UV.push(0.5, 0.5)
  for (let r = 1; r <= R; r++) for (let s = 0; s < S; s++) {
    const rr = r / R, a = (s / S) * Math.PI * 2
    P.push(Math.cos(a) * rr, shape(rr, a), Math.sin(a) * rr)
    UV.push(0.5 + 0.5 * rr * Math.cos(a), 0.5 + 0.5 * rr * Math.sin(a))
  }
  const id = (r, s) => (r === 0 ? 0 : 1 + (r - 1) * S + (s % S))
  for (let s = 0; s < S; s++) I.push(0, id(1, s + 1), id(1, s))
  for (let r = 1; r < R; r++) for (let s = 0; s < S; s++) {
    const a = id(r, s), b = id(r, s + 1), c = id(r + 1, s), d = id(r + 1, s + 1)
    I.push(a, b, c, b, d, c)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2))
  g.setIndex(I)
  g.computeVertexNormals()
  return g
}
// 浮葉：平貼水面，葉緣微微翹起、有一點波浪
const floatLeaf = () => leafGeometry((r, a) => 0.035 * r * r * r + 0.012 * Math.sin(6 * a + 1.3) * r ** 4)
// 挺水葉：中間凹下去（葉柄接在正中央），往外翹成淺碗，葉緣波浪、有的地方往下垂
const raisedLeaf = () => leafGeometry((r, a) => 0.3 * Math.pow(r, 1.5) - 0.16 * Math.max(0, r - 0.72) ** 2 * (1 + Math.sin(3 * a)) + 0.06 * Math.sin(7 * a + 0.5) * r * r)

// 顏色用一般看到的 sRGB 數值寫，轉成 three.js 計算用的線性色（不轉會偏淡、偏紫）
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace)
/* ---------- 荷花：兩圈粉紅花瓣、中間黃色的蓮蓬和雄蕊 ---------- */
function petal(len, width, cup, tilt, yaw, colBase, colTip) {
  const U = 10, Vn = 12, P = [], C = [], I = []
  const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(-tilt))
  const v3 = new THREE.Vector3(), col = new THREE.Color()
  for (let j = 0; j <= Vn; j++) for (let i = 0; i <= U; i++) {
    const v = j / Vn, u = (i / U) * 2 - 1
    // 湯匙形：底部窄、中段最寬、尖端收尖
    // 蓮花瓣：底部窄、上半部寬而圓，最尖端才收一個小尖
    const w = Math.pow(Math.sin(Math.PI * Math.pow(v, 0.6)), 0.55) * width
    v3.set(u * w, v * len, cup * u * u * w - 0.12 * len * v * v)   // 往花心凹成杓子，尖端稍微往外翻
    v3.applyMatrix4(m)
    P.push(v3.x, v3.y, v3.z)
    col.copy(colBase).lerp(colTip, Math.pow(v, 1.15) * (0.8 + 0.2 * Math.abs(u)))
    C.push(col.r, col.g, col.b)
  }
  for (let j = 0; j < Vn; j++) for (let i = 0; i < U; i++) {
    const a = j * (U + 1) + i, b = a + 1, c = a + U + 1, d = c + 1
    I.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3))
  g.setIndex(I)
  g.computeVertexNormals()
  return g
}
const colored = (g, c) => {
  g = g.index ? g.toNonIndexed() : g
  g.deleteAttribute('uv')
  const a = new Float32Array(g.attributes.position.count * 3)
  for (let i = 0; i < a.length; i += 3) c.toArray(a, i)
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}
function flowerGeometry() {
  const base = srgb(1.0, 0.9, 0.9), tip = srgb(0.95, 0.4, 0.6)
  const parts = []
  for (let i = 0; i < 4; i++) parts.push(petal(0.055, 0.028, 0.5, 0.95, i * Math.PI / 2 + 0.4, srgb(0.5, 0.6, 0.32), srgb(0.62, 0.55, 0.4)))   // 外面的萼片
  for (let i = 0; i < 9; i++) parts.push(petal(0.1, 0.055, 0.7, 0.7 + rnd(-0.1, 0.1), (i / 9) * Math.PI * 2 + rnd(-0.1, 0.1), base, tip))
  for (let i = 0; i < 7; i++) parts.push(petal(0.09, 0.05, 0.75, 0.28 + rnd(-0.06, 0.06), (i / 7) * Math.PI * 2 + 0.45, base, tip))
  const ng = (g) => { g = g.index ? g.toNonIndexed() : g; return g }
  const pod = colored(new THREE.CylinderGeometry(0.024, 0.016, 0.026, 14).translate(0, 0.03, 0), srgb(0.86, 0.82, 0.34))
  const stamens = colored(new THREE.CylinderGeometry(0.036, 0.03, 0.02, 18, 1, true).translate(0, 0.027, 0), srgb(0.98, 0.78, 0.25))
  return mergeGeometries([...parts.map(ng), pod, stamens])
}
// 花苞：水滴形，底下綠、尖端深粉紅
function budGeometry() {
  const pts = [[0, 0], [0.018, 0.008], [0.034, 0.035], [0.037, 0.06], [0.03, 0.09], [0.016, 0.115], [0.003, 0.13], [0, 0.132]].map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(pts, 14)
  const p = g.attributes.position, C = new Float32Array(p.count * 3), c = new THREE.Color()
  const lo = srgb(0.55, 0.6, 0.38), mid = srgb(0.95, 0.72, 0.78), hi = srgb(0.86, 0.3, 0.5)
  for (let i = 0; i < p.count; i++) {
    const v = p.getY(i) / 0.132
    if (v < 0.35) c.copy(lo).lerp(mid, v / 0.35); else c.copy(mid).lerp(hi, (v - 0.35) / 0.65)
    c.toArray(C, i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3))
  g.deleteAttribute('uv')
  return g
}
// 蓮蓬：倒圓錐，頂面平、有一顆顆蓮子的凹洞（用頂點色畫深點）
function podGeometry() {
  const pts = [[0, 0], [0.01, 0.002], [0.03, 0.04], [0.045, 0.058], [0.044, 0.064], [0, 0.066]].map(([r, y]) => new THREE.Vector2(r, y))
  let g = new THREE.LatheGeometry(pts, 16)
  g.deleteAttribute('uv')
  return colored(g, srgb(0.5, 0.58, 0.32))
}

export function buildLotus(scene, ponds, waterY, keepClear) {
  const group = new THREE.Group()
  const leafTex = leafTexture()
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  // 葉背比較淡、偏灰綠
  leafMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      if (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.5, 0.36), 0.55);`)
  }
  leafMat.customProgramCacheKey = () => 'lotusLeaf'
  const flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide })
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0x5f7d3a, roughness: 0.7 })

  const pads = [], raised = []
  const clearOK = (x, z, m = 0) => !keepClear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + m)
  for (const poly of ponds) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    const area = Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
    // 一叢一叢長：用雜訊決定哪裡密、哪裡是開放水面
    const dens = (x, z) => Math.min(1, Math.max(0, (noise(x * 0.16 + 3.7, z * 0.16) - 0.18) / 0.3))
    const tries = Math.round(area * 90)
    for (let i = 0; i < tries; i++) {
      const x = rnd(x0, x1), z = rnd(z0, z1)
      if (!inside([x, z], poly)) continue
      const ed = edgeDist([x, z], poly)
      if (ed < 0.65 || !clearOK(x, z) || rnd() > dens(x, z)) continue
      // 挺水的葉子和花：離岸遠一點、在密的地方
      if (rnd() < 0.3 && ed > 0.9 && clearOK(x, z, 0.6)) {
        if (raised.some((r) => Math.hypot(r.x - x, r.z - z) < 0.42)) continue
        const u = rnd()
        const kind = u < 0.2 ? 'flower' : u < 0.3 ? 'bud' : u < 0.34 ? 'pod' : 'leaf'
        const H = kind === 'leaf' ? rnd(0.3, 1.2) : rnd(0.6, 1.35)
        raised.push({ x, z, kind, H, s: kind === 'leaf' ? rnd(0.24, 0.42) : kind === 'flower' ? rnd(1.4, 1.8) : rnd(1.2, 1.5), lean: rnd(0, 0.22), la: rnd(0, 6.28), yaw: rnd(0, 6.28), ph: rnd(0, 6.28), tilt: kind === 'leaf' ? rnd(0.05, 0.4) : rnd(0, 0.25) })
      } else {
        const r = rnd(0.15, 0.34)
        if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.78)) continue
        if (ed < r + 0.55) continue
        pads.push({ x, z, r, yaw: rnd(0, 6.28), ph: rnd(0, 6.28) })
      }
    }
  }

  // 浮葉
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler()
  const padMesh = new THREE.InstancedMesh(floatLeaf(), leafMat, Math.max(1, pads.length))
  pads.forEach((pd, i) => {
    q.setFromEuler(e.set(rnd(-0.03, 0.03), pd.yaw, rnd(-0.03, 0.03)))
    m.compose(p.set(pd.x, waterY + 0.008, pd.z), q, s.set(pd.r, pd.r, pd.r))
    padMesh.setMatrixAt(i, m)
    // 有的比較黃、有的比較老（偏褐）
    c.setRGB(1, 1, 1)
    if (rnd() < 0.12) c.setRGB(1.12, 1.0, 0.7); else if (rnd() < 0.06) c.setRGB(0.95, 0.82, 0.62)
    else c.multiplyScalar(rnd(0.88, 1.08))
    padMesh.setColorAt(i, c)
  })
  padMesh.count = pads.length
  padMesh.receiveShadow = true
  group.add(padMesh)

  // 挺水的部分：葉柄 + 頂端（葉、花、花苞、蓮蓬）
  const heads = { leaf: raisedLeaf(), flower: flowerGeometry(), bud: budGeometry(), pod: podGeometry() }
  const mats = { leaf: leafMat, flower: flowerMat, bud: flowerMat, pod: flowerMat }
  const meshes = {}
  for (const k of Object.keys(heads)) {
    const list = raised.filter((r) => r.kind === k)
    const im = new THREE.InstancedMesh(heads[k], mats[k], Math.max(1, list.length))
    im.count = list.length
    im.castShadow = im.receiveShadow = true
    if (k === 'leaf') list.forEach((r, i) => { c.setRGB(1, 1, 1).multiplyScalar(rnd(0.9, 1.08)); if (rnd() < 0.1) c.setRGB(1.1, 1.02, 0.75); im.setColorAt(i, c) })
    meshes[k] = { im, list }
    group.add(im)
  }
  const stalkGeo = new THREE.CylinderGeometry(0.0055, 0.008, 1, 6).translate(0, 0.5, 0)
  const stalks = new THREE.InstancedMesh(stalkGeo, stalkMat, Math.max(1, raised.length))
  stalks.count = raised.length
  stalks.castShadow = true
  group.add(stalks)

  // 隨風擺：整枝繞根部轉一點點，頂端的葉子或花再自己晃
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), top = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion()
  function pose(t) {
    let si = 0
    for (const k of Object.keys(meshes)) {
      const { im, list } = meshes[k]
      list.forEach((r, i) => {
        const gust = 0.6 + 0.4 * Math.sin(t * 0.37 + r.x * 0.21)
        const sw = 0.05 * gust * Math.sin(t * 1.3 + r.ph) + 0.02 * Math.sin(t * 2.9 + r.ph * 1.7)
        const la = r.lean + sw
        dir.set(Math.sin(la) * Math.cos(r.la), Math.cos(la), Math.sin(la) * Math.sin(r.la))
        const base = p.set(r.x, waterY - 0.05, r.z)
        const L = r.H + 0.05
        // 葉柄
        q.setFromUnitVectors(up, dir)
        m.compose(base, q, s.set(1, L, 1))
        stalks.setMatrixAt(si++, m)
        // 頂端：沿葉柄方向，再自己傾斜、轉一個角度
        top.copy(base).addScaledVector(dir, L)
        qa.setFromEuler(e.set(r.tilt + 0.06 * Math.sin(t * 1.7 + r.ph), r.yaw, 0.04 * Math.sin(t * 1.1 + r.ph)))
        qb.copy(q).multiply(qa)
        m.compose(top, qb, s.setScalar(r.s))
        im.setMatrixAt(i, m)
      })
      im.instanceMatrix.needsUpdate = true
    }
    stalks.instanceMatrix.needsUpdate = true
  }
  pose(0)
  // 浮葉跟著水面輕輕上下、轉一點點
  const center = new THREE.Vector3()
  if (ponds.length) { const P = ponds[0]; center.set(P.reduce((a, v) => a + v[0], 0) / P.length, waterY, P.reduce((a, v) => a + v[1], 0) / P.length) }
  function bob(t) {
    pads.forEach((pd, i) => {
      q.setFromEuler(e.set(0.02 * Math.sin(t * 0.9 + pd.ph), pd.yaw + 0.03 * Math.sin(t * 0.21 + pd.ph), 0.02 * Math.cos(t * 0.8 + pd.ph)))
      m.compose(p.set(pd.x, waterY + 0.008 + 0.003 * Math.sin(t * 1.2 + pd.ph), pd.z), q, s.setScalar(pd.r))
      padMesh.setMatrixAt(i, m)
    })
    padMesh.instanceMatrix.needsUpdate = true
  }
  scene.add(group)
  const stats = { pads: pads.length, raised: raised.length, flowers: meshes.flower.list.length, buds: meshes.bud.list.length, pods: meshes.pod.list.length }
  console.log('[fju] 荷花池', stats)
  return {
    group, stats,
    update(t, camPos) {
      if (camPos.distanceTo(center) > 120) return
      pose(t); bob(t)
    },
  }
}
