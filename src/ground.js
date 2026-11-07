// 地面：把草地、樹林、球場、道路、池塘畫進一張高解析貼圖，再把陽光陰影與天光遮蔽烘進另一張貼圖。
// 全部畫在同一張圖上，就不會有一層層平面互相搶深度而閃爍。
import * as THREE from 'three'

// 細節貼圖涵蓋的範圍（公尺）；外圍再用一張低解析的蓋到地平線
export const CORE = { x0: -560, z0: -560, size: 1120 }
const FAR = { x0: -2000, z0: -2000, size: 4000 }

const AREA_STYLE = {
  parking: ['#b9bab4', 1], wood: ['#5f9446', 2], grass: ['#7fae58', 3], park: ['#78a852', 3],
  flower: ['#d7a3b4', 4], pitch: ['#c9805a', 5], tennis: ['#4f8f7c', 6], field: ['#76ab52', 4],
}
const areaOf = (pts) => {
  let s = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  return Math.abs(s / 2)
}

function paint(data, ext, N, detail) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const c = cv.getContext('2d')
  const k = N / ext.size
  const path = (pts, close = true) => {
    c.beginPath()
    pts.forEach(([x, z], i) => c[i ? 'lineTo' : 'moveTo']((x - ext.x0) * k, (z - ext.z0) * k))
    if (close) c.closePath()
  }
  c.fillStyle = '#c9cdc3'
  c.fillRect(0, 0, N, N)
  c.fillStyle = '#d9dccd'
  for (const r of data.boundary) { path(r); c.fill() }

  // 面：先排種類，同種類大的先畫，小的蓋在上面（例如大運動場上的小球場）
  const list = []
  for (const a of data.areas) {
    if (a.kind === 'water') continue
    let kind = a.kind
    if (kind === 'pitch' && a.sport === 'tennis') kind = 'tennis'
    if (kind === 'pitch' && /棒壘/.test(a.name || '')) kind = 'field'
    list.push({ a, kind, ar: areaOf(a.pts) })
  }
  list.sort((p, q) => AREA_STYLE[p.kind][1] - AREA_STYLE[q.kind][1] || q.ar - p.ar)
  for (const { a, kind } of list) {
    c.fillStyle = AREA_STYLE[kind][0]
    path(a.pts); c.fill()
    if (detail && (kind === 'pitch' || kind === 'tennis')) {
      // 球場白線：外框往內縮一點
      c.save(); path(a.pts); c.clip()
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = Math.max(1, 0.5 * k)
      c.lineJoin = 'round'; path(a.pts); c.stroke()
      c.restore()
    }
  }

  // 道路：先畫較寬的路緣，再畫路面；圓角接頭讓轉彎不會缺角
  const roads = data.roads.filter((r) => r.kind !== 'construction' && r.kind !== 'corridor')
  const isWalk = (r) => r.kind === 'footway' || r.kind === 'steps' || r.kind === 'pedestrian'
  c.lineCap = c.lineJoin = 'round'
  const stroke = (rs, color, extra) => {
    c.strokeStyle = color
    for (const r of rs) { c.lineWidth = Math.max(1, (r.w + extra) * k); path(r.pts, false); c.stroke() }
  }
  const car = roads.filter((r) => !isWalk(r)), walk = roads.filter(isWalk)
  stroke(car, '#c2c0b8', 1.2)
  stroke(walk, '#d8d0bf', 0.5)
  stroke(car, '#8b8e90', 0)
  stroke(walk, '#ebe4d4', 0)
  if (detail) {
    // 雙線道以上畫中央虛線
    c.setLineDash([3 * k, 4 * k])
    c.strokeStyle = 'rgba(245,240,225,0.9)'; c.lineWidth = Math.max(1, 0.18 * k)
    for (const r of car) if (r.w >= 6) { path(r.pts, false); c.stroke() }
    c.setLineDash([])
  }

  // 池塘：深色水底 + 石砌池岸
  for (const a of data.areas) {
    if (a.kind !== 'water') continue
    c.fillStyle = '#35606b'; path(a.pts); c.fill()
    c.strokeStyle = '#a49c8b'; c.lineWidth = 1.2 * k; path(a.pts); c.stroke()
  }

  // 建築底下壓暗，牆腳和地面接得比較實
  c.fillStyle = '#9e9c94'
  for (const b of data.buildings) if (b.pts.length > 2) { path(b.pts); c.fill() }

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

// 地面材質遮罩（和地面貼圖同一個範圍）：R＝柏油（車道、停車場）、G＝人行道地磚、B＝水泥（路緣、廣場空地）、黑＝其他。
// 著色器靠它決定每個地方要畫哪一種近看細節；用比較低的解析度就夠，邊界由地面貼圖本身決定。
function paintMask(data, ext, N) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const c = cv.getContext('2d')
  const k = N / ext.size
  const path = (pts, close = true) => {
    c.beginPath()
    pts.forEach(([x, z], i) => c[i ? 'lineTo' : 'moveTo']((x - ext.x0) * k, (z - ext.z0) * k))
    if (close) c.closePath()
  }
  c.fillStyle = '#0000ff'; c.fillRect(0, 0, N, N)
  for (const a of data.areas) {
    c.fillStyle = a.kind === 'parking' ? '#ff0000' : '#000000'
    path(a.pts); c.fill()
  }
  const roads = data.roads.filter((r) => r.kind !== 'construction' && r.kind !== 'corridor')
  const isWalk = (r) => r.kind === 'footway' || r.kind === 'steps' || r.kind === 'pedestrian'
  const car = roads.filter((r) => !isWalk(r)), walk = roads.filter(isWalk)
  c.lineCap = c.lineJoin = 'round'
  const stroke = (rs, color, extra) => {
    c.strokeStyle = color
    for (const r of rs) { c.lineWidth = Math.max(1, (r.w + extra) * k); path(r.pts, false); c.stroke() }
  }
  stroke(car, '#0000ff', 1.2)
  stroke(walk, '#0000ff', 0.5)
  stroke(car, '#ff0000', 0)
  stroke(walk, '#00ff00', 0)
  c.fillStyle = '#000000'
  for (const a of data.areas) if (a.kind === 'water') { path(a.pts); c.fill() }
  for (const b of data.buildings) if (b.pts.length > 2) { path(b.pts); c.fill() }
  const tex = new THREE.CanvasTexture(cv)
  tex.anisotropy = 4
  return tex
}

function plane(ext, y) {
  const g = new THREE.PlaneGeometry(ext.size, ext.size).rotateX(-Math.PI / 2)
  g.translate(ext.x0 + ext.size / 2, y, ext.z0 + ext.size / 2)
  return g
}

// 草地近看的細節貼圖：從正上方看一小塊草（約 1.3 公尺見方），可以無縫拼貼。
// 灰色 128 代表「不改顏色」，比較亮的是曬到太陽的草尖、比較暗的是草葉之間的縫和泥土。
let _grassTex
function grassDetailTexture() {
  if (_grassTex) return _grassTex
  const N = 512, cv = document.createElement('canvas')
  cv.width = cv.height = N
  const c = cv.getContext('2d')
  c.fillStyle = 'rgb(118,120,112)'; c.fillRect(0, 0, N, N)
  let s = 11
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const wrap = (fn) => { for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) fn(dx, dy) }
  // 草葉之間的暗縫、零星泥土
  for (let i = 0; i < 900; i++) {
    const x = r() * N, y = r() * N, rad = 1 + r() * 3
    c.fillStyle = `rgba(${55 + r() * 20},${58 + r() * 18},${45 + r() * 12},${0.35 + r() * 0.4})`
    wrap((dx, dy) => { c.beginPath(); c.arc(x + dx, y + dy, rad, 0, 7); c.fill() })
  }
  // 草葉：短筆畫，方向亂，少數是枯黃的；最後畫的比較亮（最上面那層曬得到太陽）
  c.lineCap = 'round'
  for (let i = 0; i < 14000; i++) {
    const t = i / 14000
    const x = r() * N, y = r() * N, a = r() * Math.PI * 2, L = 5 + r() * 16
    const dry = r() < 0.06
    const v = 85 + t * 85 + r() * 25
    c.strokeStyle = dry ? `rgba(${v * 1.15},${v * 1.05},${v * 0.6},0.9)` : `rgba(${v * 0.95},${v * 1.02},${v * 0.82},0.85)`
    c.lineWidth = 0.8 + r() * 1.8
    const ex = Math.cos(a) * L, ey = Math.sin(a) * L, bend = (r() - 0.5) * L * 0.5
    wrap((dx, dy) => {
      c.beginPath(); c.moveTo(x + dx, y + dy)
      c.quadraticCurveTo(x + dx + ex * 0.5 - ey / L * bend, y + dy + ey * 0.5 + ex / L * bend, x + dx + ex, y + dy + ey)
      c.stroke()
    })
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return (_grassTex = tex)
}

// 草地的大塊色差（有的地方比較乾黃、有的比較濃綠）。foliage.js 的 3D 草葉用一樣的算法，顏色才接得上。
export const GRASS_TINT_GLSL = `
  vec3 grassTint(vec3 col, vec2 p) {
    float m1 = smoothstep(0.1, 0.9, gNoise(p * 0.045) * 0.7 + gNoise(p * 0.11 + 5.0) * 0.3), m2 = gNoise(p * 0.17 + 13.0);
    float dry = smoothstep(0.5, 0.85, m1) * 0.7 + smoothstep(0.6, 0.9, m2) * 0.35;
    float lush = (1.0 - smoothstep(0.1, 0.5, m1)) * 0.5;
    col = mix(col, col * vec3(1.18, 1.04, 0.55), dry);
    return col * (1.0 - 0.25 * lush);
  }`

// 路面近看的細節，依遮罩分三種：
//   柏油：細碎的石子顆粒、一塊塊補過的新柏油（比較黑）、裂縫、油漬、靠路緣的地方積灰變暗；標線會磨損斷斷續續
//   地磚：20×10 公分的磚交錯排、每塊深淺不同、磚縫
//   水泥：1.5 公尺一塊的伸縮縫、水漬斑塊
// 細節小於一個像素時（遠看）淡掉，不會閃。
export const ROAD_GLSL = `
  vec2 rHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  // 裂縫：Voronoi 兩個最近點的距離差很小的地方就是邊界
  float crackLine(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + rHash2(i + o) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return sqrt(d2) - sqrt(d1);
  }
  float rBox(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
  vec3 roadDetail(vec3 col, vec2 p, vec2 uv, float vd) {
    vec3 mk = texture2D(roadMask, uv).rgb;
    if (mk.r + mk.g + mk.b < 0.02) return col;
    float near = 1.0 - smoothstep(30.0, 120.0, vd);
    // 柏油
    if (mk.r > 0.01) {
      vec3 c = col;
      float lum = dot(col, vec3(0.333));
      float line = smoothstep(0.35, 0.55, lum);             // 白色標線（地面貼圖上比路面亮很多）
      c *= 0.82;                                            // 柏油比原本的灰暗一點、偏暖
      c *= vec3(1.0, 0.98, 0.95);
      // 大塊的深淺（新舊路面）、補過的長方形新柏油
      c *= 0.88 + 0.22 * gNoise(p * 0.07) + 0.08 * gNoise(p * 0.6);
      vec2 pc = floor(p / vec2(4.0, 2.6) + vec2(0.3, 0.7));
      vec2 pf = fract(p / vec2(4.0, 2.6) + vec2(0.3, 0.7));
      float patchOn = step(0.9, gHash(pc)) * rBox(pf.x, 0.15, 0.85, 0.01) * rBox(pf.y, 0.2, 0.8, 0.015);
      c *= 1.0 - 0.28 * patchOn;
      // 油漬
      c *= 1.0 - 0.18 * smoothstep(0.62, 0.85, gNoise(p * 0.45 + 17.0)) * smoothstep(0.5, 0.7, gNoise(p * 0.05 + 3.0));
      // 靠路緣：遮罩模糊後不到 1 的地方就是路邊，積灰變暗
      float edge = texture2D(roadMask, uv, 4.0).r;
      c *= mix(0.86, 1.0, smoothstep(0.55, 0.95, edge));
      // 近看：石子顆粒、裂縫
      if (near > 0.0) {
        float g = gHash(floor(p * 55.0));
        float stone = step(0.9, g) * 0.35 - step(g, 0.12) * 0.2 + (gHash(floor(p * 140.0)) - 0.5) * 0.12;
        float gf = 1.0 - smoothstep(0.3, 1.2, fwidth(p.x * 55.0));
        c *= 1.0 + stone * gf * near;
        // 裂縫：只在少數老舊的路段，線條歪斜、粗細不一，不要排成整齊的網格
        float area = smoothstep(0.62, 0.8, gNoise(p * 0.06 + 41.0));
        vec2 wp = p * 0.45 + vec2(gNoise(p * 1.7), gNoise(p * 1.7 + 9.0)) * 0.8;
        float cw = 0.012 + 0.025 * gNoise(p * 2.3);
        float cr = (1.0 - smoothstep(0.0, cw + fwidth(wp.x) * 0.8, crackLine(wp))) * smoothstep(0.35, 0.6, gNoise(p * 0.9 + 5.0));
        c *= 1.0 - 0.35 * cr * area * near * (1.0 - patchOn);
      }
      // 標線磨損：斑駁地露出底下的柏油
      float wear = smoothstep(0.35, 0.65, gNoise(p * 3.0) * 0.6 + gNoise(p * 0.4) * 0.4);
      c = mix(c, col * 0.95, line * (1.0 - 0.45 * wear));
      col = mix(col, c, mk.r);
    }
    // 地磚
    if (mk.g > 0.01) {
      vec2 b = p / vec2(0.2, 0.1);
      b.x += 0.5 * mod(floor(b.y), 2.0);
      vec2 id = floor(b), f = fract(b);
      vec2 w = fwidth(b);
      float pf = 1.0 - smoothstep(0.25, 0.6, max(w.x, w.y));
      float grout = 1.0 - rBox(f.x, 0.04, 0.96, w.x) * rBox(f.y, 0.08, 0.92, w.y);
      float h = gHash(id);
      vec3 c = col * vec3(0.98, 0.95, 0.9);
      c *= mix(1.0, 0.86 + 0.24 * h, pf);
      c = mix(c, c * vec3(1.05, 0.9, 0.82), step(0.85, gHash(id + 7.0)) * pf * 0.6);   // 少數偏紅的磚
      c *= mix(1.0, 0.68, grout * pf);
      c *= mix(1.0, 0.94, pf);                       // 遠看時磚縫平均起來的暗度
      c *= 0.9 + 0.12 * gNoise(p * 0.5);             // 髒污
      col = mix(col, c, mk.g);
    }
    // 水泥：伸縮縫、水漬
    if (mk.b > 0.01) {
      vec2 s = p / 1.5;
      vec2 f = fract(s), w = fwidth(s);
      float jf = 1.0 - smoothstep(0.05, 0.2, max(w.x, w.y));
      float joint = 1.0 - rBox(f.x, 0.008, 0.992, w.x) * rBox(f.y, 0.008, 0.992, w.y);
      vec3 c = col;
      c *= 0.9 + 0.1 * gHash(floor(s)) * jf + 0.1 * gNoise(p * 0.3);
      c *= 1.0 - 0.12 * smoothstep(0.6, 0.85, gNoise(p * 0.8 + 9.0));
      c *= mix(1.0, 0.8, joint * jf);
      if (near > 0.0) c *= 1.0 + (gHash(floor(p * 80.0)) - 0.5) * 0.08 * near * (1.0 - smoothstep(0.3, 1.0, fwidth(p.x * 80.0)));
      col = mix(col, c, mk.b);
    }
    return col;
  }`

// 地面材質：貼圖上色，烘好的光影乘到直射光（R）與天光（G）上，再加一層世界座標的細雜訊
function groundMaterial(map, bake, detail = true, mask = null) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 1 })
  m.userData.bake = { value: bake }
  const gTex = { value: grassDetailTexture() }, mTex = { value: mask }
  m.userData.mask = mask   // 除錯用：可以讀遮罩的 canvas 對照
  // 近、遠兩塊地面的 onBeforeCompile 字面一樣，不給不同的 key 會共用同一支程式（遠的沒有草葉貼圖）
  m.customProgramCacheKey = () => (detail ? 'groundD' : 'groundF')
  m.onBeforeCompile = (sh) => {
    sh.uniforms.bakeMap = m.userData.bake
    sh.uniforms.grassTex = gTex
    sh.uniforms.roadMask = mTex
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGp = (modelMatrix * vec4(transformed, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vGp;
        uniform sampler2D bakeMap, grassTex, roadMask;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
        }
        ${GRASS_TINT_GLSL}
        ${ROAD_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // 近看才有的細節：草地明暗斑塊 + 細碎顆粒；離鏡頭遠就淡掉，避免俯瞰時閃爍
        float vd = length(vViewPosition);
        float gFade = 1.0 - smoothstep(60.0, 220.0, vd);
        float gn = gNoise(vGp * 0.35) * 0.6 + gNoise(vGp * 2.3) * 0.25 + gHash(floor(vGp * 9.0)) * 0.15;
        diffuseColor.rgb *= mix(1.0, 0.86 + gn * 0.26, gFade);
        // 草地（貼圖上綠色的地方）：大塊乾濕色差 + 近看的草葉貼圖（兩種大小、轉個角度疊，看不出重複）
        vec3 mc = diffuseColor.rgb;
        float isGrass = smoothstep(0.02, 0.06, mc.g - max(mc.r, mc.b));
        diffuseColor.rgb = mix(diffuseColor.rgb, grassTint(diffuseColor.rgb, vGp), isGrass);
        ${detail ? `
        vec2 q1 = vGp / 1.3, q2 = mat2(0.8, -0.6, 0.6, 0.8) * vGp / 3.1;
        vec3 d1 = texture2D(grassTex, q1).rgb, d2 = texture2D(grassTex, q2).rgb;
        vec3 det = (d1 * 0.65 + d2 * 0.35) * 2.15;
        float dFade = 1.0 - smoothstep(25.0, 140.0, vd);
        // 中等大小的草叢明暗（10～80 公分），貼圖的草葉在 20 公尺外就糊成一片，這層撐住中景的質感
        float cl = smoothstep(0.15, 0.85, gNoise(vGp * 2.7 + 3.1) * 0.55 + gNoise(vGp * 7.3 - 1.7) * 0.45);
        float clFade = 1.0 - smoothstep(50.0, 260.0, vd);
        diffuseColor.rgb *= mix(1.0, 0.72 + cl * 0.56, isGrass * clFade);
        diffuseColor.rgb *= mix(vec3(1.0), det, isGrass * dFade * 0.9);
        diffuseColor.rgb = roadDetail(diffuseColor.rgb, vGp, vMapUv, vd);` : ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        vec2 bk = texture2D(bakeMap, vMapUv).rg;
        reflectedLight.directDiffuse *= bk.r;
        reflectedLight.indirectDiffuse *= 0.3 + 0.7 * bk.g;`)
  }
  return m
}

export function buildGround(scene, data) {
  // 小螢幕（手機）用一半解析度，記憶體少四倍
  const maxTex = Math.min(innerWidth, innerHeight) > 700 ? 4096 : 2048
  const near = paint(data, CORE, maxTex, true)
  const far = paint(data, FAR, 1024, false)
  // 還沒烘之前先給全白，畫面不會一片黑
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  white.needsUpdate = true
  const farMesh = new THREE.Mesh(plane(FAR, -0.05), groundMaterial(far, white, false))
  const nearMat = groundMaterial(near, white, true, paintMask(data, CORE, maxTex / 2))
  const nearMesh = new THREE.Mesh(plane(CORE, 0), nearMat)
  scene.add(farMesh, nearMesh)
  return {
    mesh: nearMesh, res: maxTex, map: near, bake: nearMat.userData.bake,
    // 烘完把結果接上；外圍那張只用天光，不另外烘
    setBake(tex) { nearMat.userData.bake.value = tex },
  }
}

/* ---------- 烘焙 ---------- */
// 從正上方對著地面拍，地面用「只輸出陰影」的材質：
// 太陽方向附近抖幾次 → 柔和的陽光陰影（R）；整個天空半球取很多方向 → 天光遮蔽（G）。
// 地面切成 2×2 塊分別烘，陰影貼圖解析度才夠。
export function bakeGround(renderer, scene, ground, sunDir, { res = ground.res, tiles = 2, sunN = 12, skyN = 40 } = {}) {
  const t0 = performance.now()
  const rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.HalfFloatType })

  const BAKE_LAYER = 3
  const recv = new THREE.ShadowMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })
  recv.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
      'gl_FragColor = vec4( color * getShadowMask(), 1.0 );')
  }
  const recvMesh = new THREE.Mesh(ground.mesh.geometry, recv)
  recvMesh.receiveShadow = true
  recvMesh.layers.set(BAKE_LAYER)
  scene.add(recvMesh)

  const light = new THREE.DirectionalLight(0xffffff, 1)
  light.castShadow = true
  const tileSize = CORE.size / tiles
  const half = tileSize * 0.75 + 30
  Object.assign(light.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 3000 })
  light.shadow.camera.updateProjectionMatrix()
  light.shadow.mapSize.set(res, res)
  light.shadow.bias = -0.0004
  light.shadow.normalBias = 0
  light.shadow.radius = 2
  scene.add(light, light.target)

  // 其他會投影的燈先關掉，避免陰影疊兩次
  const saved = []
  scene.traverse((o) => { if (o.isLight && o !== light && o.castShadow) { saved.push(o); o.castShadow = false } })

  const dirs = []
  const up = new THREE.Vector3(0, 1, 0)
  const sideA = new THREE.Vector3().crossVectors(sunDir, up).normalize(), sideB = new THREE.Vector3().crossVectors(sunDir, sideA)
  for (let i = 0; i < sunN; i++) {
    // 太陽有大小，方向在 1.5° 內抖動，陰影邊緣才會柔
    const a = (i / sunN) * Math.PI * 2, r = 0.026 * Math.sqrt((i + 0.5) / sunN)
    dirs.push({ d: sunDir.clone().addScaledVector(sideA, Math.cos(a) * r).addScaledVector(sideB, Math.sin(a) * r).normalize(), c: new THREE.Color(1 / sunN, 0, 0) })
  }
  for (let i = 0; i < skyN; i++) {
    // 半球上依 cos 分布取方向（Fibonacci 螺旋），太低的角度略過
    const u = (i + 0.5) / skyN, phi = i * 2.399963
    const y = Math.sqrt(1 - u * 0.92)
    const s = Math.sqrt(1 - y * y)
    dirs.push({ d: new THREE.Vector3(Math.cos(phi) * s, y, Math.sin(phi) * s), c: new THREE.Color(0, 1 / skyN, 0) })
  }

  const cam = new THREE.OrthographicCamera(-tileSize / 2, tileSize / 2, tileSize / 2, -tileSize / 2, 1, 500)
  // three.js 只讓「主鏡頭看得到的物體」投影，所以鏡頭也要看得到一般圖層；
  // 那些物體改用不寫顏色的材質，畫面上只留下地面接收到的陰影
  cam.layers.enable(BAKE_LAYER)
  const hide = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  const swapped = []
  // 動物會走動，影子不能烘死在地上（牠們自己帶即時陰影）
  const movers = []
  scene.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || o === recvMesh) return
    swapped.push([o, o.material]); o.material = hide
    if (o.userData.noBake && o.castShadow) { movers.push(o); o.castShadow = false }
  })
  cam.up.set(0, 0, -1)
  const prev = { autoClear: renderer.autoClear, target: renderer.getRenderTarget(), bg: scene.background, fog: scene.fog }
  scene.background = null; scene.fog = null
  renderer.autoClear = false
  renderer.setRenderTarget(rt)
  renderer.setClearColor(0x000000, 1)
  renderer.clear()
  const px = res / tiles
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
    const cx = CORE.x0 + (tx + 0.5) * tileSize, cz = CORE.z0 + (ty + 0.5) * tileSize
    cam.position.set(cx, 200, cz); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld()
    // 貼圖的 v 往上是北（-z），所以第 0 列在最下面
    rt.viewport.set(tx * px, (tiles - 1 - ty) * px, px, px)
    rt.scissor.copy(rt.viewport); rt.scissorTest = true
    renderer.setRenderTarget(rt)
    light.target.position.set(cx, 0, cz)
    for (const { d, c } of dirs) {
      light.position.set(cx, 0, cz).addScaledVector(d, 1400)
      light.target.updateMatrixWorld(); light.updateMatrixWorld()
      light.shadow.needsUpdate = true
      recv.color.copy(c)
      renderer.render(scene, cam)
    }
  }
  rt.scissorTest = false
  rt.viewport.set(0, 0, res, res)
  renderer.setRenderTarget(prev.target)
  renderer.autoClear = prev.autoClear
  scene.background = prev.bg; scene.fog = prev.fog
  for (const o of saved) o.castShadow = true
  for (const [o, m] of swapped) o.material = m
  for (const o of movers) o.castShadow = true
  hide.dispose()
  scene.remove(recvMesh, light, light.target)
  light.shadow.map?.dispose()
  recv.dispose()
  // 累加要用半浮點才準；烘完轉成 8-bit 省一半記憶體（手機很在意）
  const out = new THREE.WebGLRenderTarget(res, res, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter })
  out.texture.anisotropy = 8
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { src: { value: rt.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D src; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(src, vUv).rg, 0.0, 1.0); }',
  }))
  renderer.setRenderTarget(out)
  renderer.render(quad, cam)
  renderer.setRenderTarget(prev.target)
  rt.dispose(); quad.geometry.dispose(); quad.material.dispose()
  ground.setBake(out.texture)
  ground.rt = out
  return { texture: out.texture, ms: Math.round(performance.now() - t0) }
}
