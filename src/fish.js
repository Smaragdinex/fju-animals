// 荷花池的魚：灰色的吳郭魚（校園池塘最常見的那種），在水面下慢慢游。
// 魚的身體是程式做的（沿身體排一圈圈橢圓，加尾鰭、背鰭、臀鰭和眼睛），一個 InstancedMesh 畫全部。
// 游泳：頂點著色器讓身體左右擺，越往尾巴擺越大；擺的節奏（相位）由程式依速度推進，游得快尾巴擺得快。
// 行為：兩小群各自跟著帶頭的魚，加幾隻獨行的；平常慢慢巡游，偶爾停下來、偶爾衝一下，
// 偶爾浮到水面吸一口氣，水面冒出一圈水波。不會游出池子、不會穿過烏龜的石頭。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

let seed = 97
const rnd = (a = 0, b = 1) => a + (b - a) * ((seed = (seed * 16807) % 2147483647) / 2147483647)
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace)

function inside([x, z], poly) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[j]
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) c = !c
  }
  return c
}
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

/* ---------- 魚的形狀（全長 1，頭朝 +x，尾巴在 -x） ---------- */
const BODY0 = -0.32, BODY1 = 0.5
function bodyShape(x) {
  const t = (x - BODY0) / (BODY1 - BODY0)                      // 0：尾柄，1：吻端
  const s = Math.sin(Math.PI * Math.min(1, 0.06 + 0.94 * Math.pow(t, 0.8)))
  return { hh: 0.035 + 0.135 * Math.pow(s, 0.8), hw: 0.014 + 0.05 * s }   // 半高、半寬：吳郭魚側扁、背高
}
function fishGeometry() {
  const back = srgb(0.22, 0.24, 0.24), side = srgb(0.44, 0.46, 0.45), belly = srgb(0.66, 0.66, 0.62), bar = srgb(0.32, 0.34, 0.34)
  const fin = srgb(0.36, 0.38, 0.38)
  const NX = 22, NA = 14, P = [], C = [], I = [], c = new THREE.Color()
  for (let i = 0; i <= NX; i++) {
    const x = BODY0 + (BODY1 - BODY0) * (i / NX)
    const { hh, hw } = bodyShape(x)
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * Math.PI * 2, sy = Math.sin(a)
      const y = hh * sy * (sy < 0 ? 0.85 : 1), z = hw * Math.cos(a)
      P.push(x, y, z)
      // 背深、腹淺；身體兩側有幾條淡淡的直紋
      const v = (sy + 1) / 2
      if (v > 0.5) c.copy(side).lerp(back, Math.pow((v - 0.5) * 2, 1.3)); else c.copy(belly).lerp(side, Math.pow(v * 2, 1.5))
      if (x > -0.2 && x < 0.3 && Math.abs(sy) < 0.8 && Math.sin(x * 30) > 0.55) c.lerp(bar, 0.45)
      if (x > 0.36) c.lerp(back, 0.25)   // 頭部稍暗
      c.toArray(C, P.length - 3)
    }
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NA; j++) {
    const a = i * NA + j, b = i * NA + ((j + 1) % NA), cc = a + NA, d = b + NA
    I.push(a, cc, b, b, cc, d)
  }
  // 吻端封起來
  const tip = P.length / 3
  P.push(BODY1 + 0.008, -0.005, 0); back.toArray(C, P.length - 3)
  for (let j = 0; j < NA; j++) I.push(NX * NA + j, tip, NX * NA + ((j + 1) % NA))
  const body = new THREE.BufferGeometry()
  body.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  body.setAttribute('color', new THREE.Float32BufferAttribute(C, 3))
  body.setIndex(I)
  body.computeVertexNormals()

  // 鰭：薄片（雙面），用 (x, y) 的點連成一條帶子
  const strip = (lo, hi, col) => {
    const P2 = [], C2 = [], I2 = []
    for (let k = 0; k < lo.length; k++) {
      P2.push(lo[k][0], lo[k][1], 0, hi[k][0], hi[k][1], 0)
      col.toArray(C2, C2.length); col.toArray(C2, C2.length)
      if (k) { const q = k * 2; I2.push(q - 2, q - 1, q, q - 1, q + 1, q) }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(C2, 3))
    g.setIndex(I2)
    g.computeVertexNormals()
    return g
  }
  const tailLo = [], tailHi = []
  for (let k = 0; k <= 6; k++) {
    const f = k / 6, y = (f - 0.5) * 2
    const r = 0.17 - 0.025 * (1 - Math.abs(y))          // 尾鰭末端微微內凹
    tailLo.push([BODY0 + 0.01, y * 0.03]); tailHi.push([BODY0 - r, y * 0.14])
  }
  const tail = strip(tailLo, tailHi, fin)
  const dLo = [], dHi = []
  for (let k = 0; k <= 10; k++) {
    const x = -0.24 + 0.5 * (k / 10), { hh } = bodyShape(x)
    dLo.push([x, hh * 0.92]); dHi.push([x - 0.02, hh + 0.025 + 0.035 * Math.sin(Math.PI * Math.min(1, (k / 10) * 1.2))])
  }
  const dorsal = strip(dLo, dHi, fin)
  const aLo = [], aHi = []
  for (let k = 0; k <= 5; k++) {
    const x = -0.22 + 0.16 * (k / 5), { hh } = bodyShape(x)
    aLo.push([x, -hh * 0.8]); aHi.push([x - 0.02, -hh * 0.85 - 0.04 * Math.sin(Math.PI * (k / 5))])
  }
  const anal = strip(aLo, aHi, fin)
  // 眼睛
  const eyeC = srgb(0.08, 0.08, 0.07)
  const eyes = [1, -1].map((s) => {
    const { hw } = bodyShape(0.4)
    const g = new THREE.SphereGeometry(0.016, 8, 6).translate(0.4, 0.035, s * (hw * 0.95))
    g.deleteAttribute('uv')
    const a = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < a.length; i += 3) eyeC.toArray(a, i)
    g.setAttribute('color', new THREE.BufferAttribute(a, 3))
    return g.toNonIndexed()
  })
  return mergeGeometries([body.toNonIndexed(), tail.toNonIndexed(), dorsal.toNonIndexed(), anal.toNonIndexed(), ...eyes])
}

export function buildFish(scene, ponds, waterY, rocks, onRipple) {
  const poly = ponds[0]
  if (!poly) return { update() {} }
  const geo = fishGeometry()
  const N = 14
  const swim = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2)   // (相位, 擺幅)
  swim.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('aSwim', swim)
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide })
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSwim;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // 身體左右擺：從頭到尾振幅變大，波往尾巴傳
        float tt = clamp((0.42 - position.x) / 0.92, 0.0, 1.0);
        transformed.z += aSwim.y * (0.01 + 0.11 * tt * tt) * sin(position.x * 7.0 + aSwim.x);`)
  }
  mat.customProgramCacheKey = () => 'fish1'
  const mesh = new THREE.InstancedMesh(geo, mat, N)
  mesh.frustumCulled = false
  scene.add(mesh)

  const ok = (x, z, m = 0.4) => inside([x, z], poly) && edgeDist([x, z], poly) > m && !rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + 0.25)
  const pickPoint = () => { for (let i = 0; i < 200; i++) { const p = [rnd(...xr), rnd(...zr)]; if (ok(p[0], p[1], 0.6)) return p } return [cx, cz] }
  let xr = [Infinity, -Infinity], zr = [Infinity, -Infinity]
  for (const [x, z] of poly) { xr = [Math.min(xr[0], x), Math.max(xr[1], x)]; zr = [Math.min(zr[0], z), Math.max(zr[1], z)] }
  const cx = (xr[0] + xr[1]) / 2, cz = (zr[0] + zr[1]) / 2

  // 兩群各 5～6 隻，加 3 隻獨行
  const fish = []
  const groups = [[0, 6], [6, 11], [11, 14]]
  groups.forEach(([a, b], gi) => {
    const [sx, sz] = pickPoint()
    for (let i = a; i < b; i++) {
      const lead = gi < 2 && i === a
      fish.push({
        x: sx + rnd(-0.5, 0.5), z: sz + rnd(-0.3, 0.3), y: waterY - rnd(0.05, 0.075), h: rnd(0, 6.28),
        v: 0.15, vWant: 0.2, tgt: null, leader: gi < 2 && !lead ? a : -1, off: [rnd(-0.2, 1.4), rnd(-0.7, 0.7)],
        s: rnd(0.2, 0.3), ph: rnd(0, 6.28), t: rnd(0, 3), mode: 'cruise', mt: rnd(2, 6), rise: 0, gulp: rnd(6, 25),
      })
    }
  })
  fish.forEach((f) => { if (!ok(f.x, f.z)) { const [x, z] = pickPoint(); f.x = x; f.z = z } })

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3()
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  function step(dt) {
    for (const f of fish) {
      // 換模式：巡游、停一下、衝一下
      if ((f.mt -= dt) <= 0) {
        const u = rnd()
        f.mode = u < 0.15 ? 'rest' : u < 0.25 ? 'dash' : 'cruise'
        f.mt = f.mode === 'dash' ? rnd(0.4, 0.9) : f.mode === 'rest' ? rnd(1.5, 4) : rnd(3, 8)
        if (f.mode !== 'rest' && f.leader < 0) f.tgt = pickPoint()
      }
      // 目標：帶頭的或獨行的自己挑點；跟隨的跟在帶頭的後面一點
      let tx, tz
      if (f.leader >= 0) {
        const L = fish[f.leader], ch = Math.cos(L.h), sh = Math.sin(L.h)
        tx = L.x - ch * (0.4 + f.off[0] * 0.5) - sh * f.off[1]; tz = L.z + sh * (0.4 + f.off[0] * 0.5) - ch * f.off[1]
        // 用 -sin 是因為魚的 +x 朝前、heading 繞 y 轉
      } else {
        if (!f.tgt || Math.hypot(f.tgt[0] - f.x, f.tgt[1] - f.z) < 0.4) f.tgt = pickPoint()
        ;[tx, tz] = f.tgt
      }
      const want = Math.atan2(-(tz - f.z), tx - f.x)
      const dist = Math.hypot(tx - f.x, tz - f.z)
      f.vWant = f.mode === 'rest' ? 0.02 : f.mode === 'dash' ? 0.7 : f.leader >= 0 ? Math.min(0.45, 0.12 + dist * 0.5) : 0.18
      f.v += (f.vWant - f.v) * Math.min(1, dt * (f.mode === 'dash' ? 4 : 1.2))
      const turn = (f.mode === 'dash' ? 3 : 1.4) * dt
      f.h += Math.max(-turn, Math.min(turn, wrap(want - f.h)))
      // 前面是池岸或石頭就轉開
      const nx = f.x + Math.cos(f.h) * f.v * dt, nz = f.z - Math.sin(f.h) * f.v * dt
      const look = 0.35
      if (!ok(f.x + Math.cos(f.h) * look, f.z - Math.sin(f.h) * look, 0.3)) {
        f.h += 2.5 * dt * (wrap(Math.atan2(-(cz - f.z), cx - f.x) - f.h) > 0 ? 1 : -1)
        if (f.leader < 0) f.tgt = pickPoint()
      }
      if (ok(nx, nz, 0.25)) { f.x = nx; f.z = nz } else f.v *= 0.5
      // 不要疊在一起：太近就互相推開一點
      for (const o of fish) {
        if (o === f) continue
        const dx = f.x - o.x, dz = f.z - o.z, d = Math.hypot(dx, dz), min = (f.s + o.s) * 0.75
        if (d > 1e-4 && d < min) { const k = (min - d) * 0.5 * Math.min(1, dt * 6) / d; if (ok(f.x + dx * k, f.z + dz * k, 0.25)) { f.x += dx * k; f.z += dz * k } }
      }
      // 偶爾浮上來吸一口氣：水面冒一圈小水波
      if ((f.gulp -= dt) <= 0 && f.rise === 0) f.rise = 0.001
      if (f.rise > 0) {
        f.rise += dt
        if (f.rise > 0.6 && f.rise - dt <= 0.6) onRipple?.(f.x + Math.cos(f.h) * f.s * 0.45, f.z - Math.sin(f.h) * f.s * 0.45, 0.45)
        if (f.rise > 1.4) { f.rise = 0; f.gulp = rnd(8, 30) }
      }
      const up = f.rise > 0 ? Math.sin(Math.min(1, f.rise / 1.4) * Math.PI) : 0
      const yT = waterY - 0.065 + up * 0.04
      f.y += (yT - f.y) * Math.min(1, dt * 3)
      // 擺尾巴：速度越快擺得越快越大；停著的時候只有一點點
      f.ph += dt * (4 + f.v * 30)
      f.amp = Math.min(0.9, 0.25 + f.v * 2)
    }
  }
  function write() {
    fish.forEach((f, i) => {
      e.set(0, f.h, 0.15 * (f.rise > 0 ? Math.cos(Math.min(1, f.rise / 1.4) * Math.PI) : 0))
      q.setFromEuler(e)
      m.compose(p.set(f.x, f.y, f.z), q, s.setScalar(f.s))
      mesh.setMatrixAt(i, m)
      swim.setXY(i, f.ph, f.amp ?? 0.3)
    })
    mesh.instanceMatrix.needsUpdate = true
    swim.needsUpdate = true
  }
  step(0); write()
  const center = new THREE.Vector3(cx, waterY, cz)
  return {
    mesh, fish,
    update(t, dt, camPos) {
      if (camPos.distanceTo(center) > 120) return
      step(Math.min(dt, 0.05)); write()
    },
  }
}
