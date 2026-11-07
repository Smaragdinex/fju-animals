// 由 campus.json（OpenStreetMap 轉出來的公尺座標）長出校園：地面、草地、樹林、道路、建築、池塘、樹。
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildGround, bakeGround } from './ground.js'
import { canopyBump, leafify, barkify } from './foliage.js'

export const WATER_Y = 0.12

/* ---------- 水面：細碎的風浪 + 動物激起的水波紋 ---------- */
// 不動頂點，只在片段著色器裡算水面高度的斜率去歪法線，反射的天空和太陽亮點就會跟著晃。
// 水波紋（ripple）是一圈往外擴散、越來越淡的環：烏龜游過、鷺鷥踩水和啄魚時加一個。
const RIPPLES = 12
export const waterFx = { time: { value: 0 }, rip: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)) }, n: 0 }
export function ripple(x, z, amp = 1) { waterFx.rip.value[waterFx.n++ % RIPPLES].set(x, z, waterFx.time.value, amp) }
function waterSurface(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWT = waterFx.time; sh.uniforms.uRip = waterFx.rip
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        uniform float uWT;
        uniform vec4 uRip[${RIPPLES}];
        // 水面高度對 x、z 的斜率
        vec2 waterSlope(vec2 p) {
          vec2 g = vec2(0.0);
          // 風吹的細浪：八組波長 15～100 公分、方向散在風向左右的小波疊起來，
          // 再乘上一層慢慢飄的「陣風」明暗，水面才不會是整齊的條紋
          const vec2 W[8] = vec2[8](vec2(6.3, 0.0), vec2(8.9, 0.55), vec2(11.7, -0.6), vec2(15.1, 0.95), vec2(19.6, -1.1), vec2(24.3, 0.3), vec2(31.0, -0.35), vec2(39.5, 1.3));
          float gust = 0.55 + 0.45 * sin(p.x * 0.31 + uWT * 0.23) * sin(p.y * 0.47 - uWT * 0.17 + 1.3);
          for (int i = 0; i < 8; i++) {
            float k = W[i].x, a = 0.4 + W[i].y;
            vec2 d = vec2(cos(a), sin(a));
            g += d * gust * (0.045 / sqrt(k)) * cos(dot(d, p) * k + uWT * sqrt(9.8 * k) * 0.6 + float(i) * 1.7);
          }
          // 水波紋：從 (x, z) 在時間 t0 開始，以每秒 0.35 公尺往外擴散的一圈圈環
          for (int j = 0; j < ${RIPPLES}; j++) {
            vec4 R = uRip[j];
            float age = uWT - R.z;
            if (age < 0.0 || age > 4.0) continue;
            vec2 d = p - R.xy; float r = length(d) + 1e-4;
            float front = r - 0.35 * age;
            float env = R.w * exp(-age * 1.1) * exp(-front * front * 30.0) / (1.0 + 3.0 * r);
            g += (d / r) * env * 1.6 * cos(front * 45.0);
          }
          return g;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 ws = waterSlope(vWp.xz);
        normal = normalize((viewMatrix * vec4(normalize(vec3(-ws.x, 1.0, -ws.y)), 0.0)).xyz);`)
  }
}

const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()

export function inside([x, z], poly) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[j]
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) c = !c
  }
  return c
}
function bbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const [x, z] of pts) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z) }
  return [a, b, c, d]
}
function area(pts) {
  let s = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  return Math.abs(s / 2)
}

// 多邊形往內縮 d 公尺（女兒牆用）；縮壞了回傳 null
function inset(pts, d) {
  let s = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  const sgn = s > 0 ? 1 : -1
  const n = pts.length, out = []
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n]
    const e1 = norm(b[0] - a[0], b[1] - a[1]), e2 = norm(c[0] - b[0], c[1] - b[1])
    const n1 = [-e1[1] * sgn, e1[0] * sgn], n2 = [-e2[1] * sgn, e2[0] * sgn]
    const m = norm(n1[0] + n2[0], n1[1] + n2[1])
    const cos = m[0] * n1[0] + m[1] * n1[1]
    if (cos < 0.35) return null
    out.push([b[0] + m[0] * d / cos, b[1] + m[1] * d / cos])
  }
  return inside(centroid(out), pts) ? out : null
}
const norm = (x, z) => { const L = Math.hypot(x, z) || 1; return [x / L, z / L] }
const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]

// 天空漸層做成環境貼圖，水面拿來反射
let _env
function skyEnv() {
  if (_env) return _env
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
      vec3 c = mix(vec3(0.80, 0.86, 0.86), vec3(0.42, 0.62, 0.82), smoothstep(0.0, 0.6, h));
      c = mix(vec3(0.35, 0.40, 0.33), c, smoothstep(-0.05, 0.02, h));
      gl_FragColor = vec4(c, 1.0); }`,
  }))
  const s = new THREE.Scene(); s.add(sky)
  const gen = new THREE.PMREMGenerator(_renderer)
  _env = gen.fromScene(s).texture
  gen.dispose()
  return _env
}
let _renderer
export const useRenderer = (r) => { _renderer = r }

// 平面多邊形（躺在 y 高度）
function flatShape(pts, y) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ShapeGeometry(shape)
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  return g
}
// 折線拉成帶子
function ribbon(pts, w, y) {
  const P = [], I = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
    let dx = b[0] - a[0], dz = b[1] - a[1]
    const L = Math.hypot(dx, dz) || 1
    dx /= L; dz /= L
    const [x, z] = pts[i]
    P.push(x - dz * w / 2, y, z + dx * w / 2, x + dz * w / 2, y, z - dx * w / 2)
    if (i > 0) { const k = i * 2; I.push(k - 2, k, k - 1, k - 1, k, k + 1) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  g.setIndex(I)
  g.computeVertexNormals()
  return g
}


/* ---------- 建築外牆：窗戶、窗台、牆面磁磚和雨痕都在著色器裡畫 ---------- */
// 牆面座標：u 是沿著這面牆的水平距離（用牆的法線算出牆的方向），y 是高度。
// 每 3.6 公尺一層樓、每 2.4 公尺一扇窗；窗框、中間的直框、窗台、窗台下的雨痕、玻璃反射天空、
// 有的窗拉了窗簾。窗格小到一個像素以下時（遠看）改成平均顏色，不會閃。
// 屋頂：水泥地的深淺斑塊和排水的污漬。
function facade(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWn = normalize(mat3(modelMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        varying vec3 vWn;
        float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y);
        }
        // 抗鋸齒的方框：x 在 [a, b] 之間是 1，邊緣用螢幕上的像素寬度柔化
        float box(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }
        float gWin = 0.0, gWall = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        gWall = 1.0 - step(0.5, abs(vWn.y));
        vec2 wn = normalize(vWn.xz + 1e-5);
        float u = dot(vWp.xz, vec2(-wn.y, wn.x));
        vec2 cell = vec2(u / 2.4, vWp.y / 3.6);
        vec2 f = fract(cell), id = floor(cell);
        vec2 aa = fwidth(cell) * 0.75 + 1e-4;
        float far = smoothstep(0.08, 0.3, max(aa.x, aa.y));
        float rnd = fHash(id + floor(vWp.xz * 0.02) * 7.0);
        vec3 wall = diffuseColor.rgb;
        if (gWall > 0.5) {
          float base = step(vWp.y, 0.7);
          float upper = step(1.2, vWp.y);
          // 牆面：小磁磚的縫（近看才畫）+ 大片的深淺
          float tile = box(fract(vWp.y / 0.12), 0.06, 0.94, fwidth(vWp.y / 0.12)) * box(fract(u / 0.24), 0.04, 0.96, fwidth(u / 0.24));
          float tFade = 1.0 - smoothstep(0.05, 0.15, fwidth(vWp.y / 0.12));
          wall *= mix(1.0, 0.93 + 0.07 * tile, tFade);
          wall *= 0.94 + 0.08 * fNoise(vec2(u, vWp.y) * 0.25) + 0.04 * fNoise(vec2(u, vWp.y) * 1.7);
          // 每四扇窗一根柱子：稍微凸出、比較亮
          float col = box(fract(u / 9.6), 0.0, 0.05, fwidth(u / 9.6)) + box(fract(u / 9.6), 0.95, 1.0, fwidth(u / 9.6));
          wall *= 1.0 + 0.06 * col;
          // 窗戶：一樓比較高（玻璃門窗）
          float y0 = id.y < 0.5 ? 0.22 : 0.3, y1 = id.y < 0.5 ? 0.86 : 0.8;
          float win = box(f.x, 0.16, 0.84, aa.x) * box(f.y, y0, y1, aa.y) * upper * (1.0 - col);
          float glass = box(f.x, 0.2, 0.8, aa.x) * box(f.y, y0 + 0.035, y1 - 0.03, aa.y) * (1.0 - box(f.x, 0.49, 0.51, aa.x)) * win;
          float frame = win - glass;
          float sill = box(f.x, 0.13, 0.87, aa.x) * box(f.y, y0 - 0.035, y0, aa.y) * upper * (1.0 - col);
          // 窗台下的雨痕：越往下越淡，每扇窗不一樣
          float streak = box(f.x, 0.2 + 0.1 * rnd, 0.8 - 0.1 * rnd, aa.x) * smoothstep(y0 - 0.45, y0 - 0.04, f.y) * step(f.y, y0 - 0.035) * upper * (1.0 - col);
          wall *= 1.0 - 0.12 * streak * (0.4 + rnd);
          // 窗台下面一條陰影（窗台凸出來擋光）
          wall *= 1.0 - 0.25 * box(f.y, y0 - 0.07, y0 - 0.035, aa.y) * box(f.x, 0.13, 0.87, aa.x) * upper * (1.0 - col);
          vec3 c = wall;
          c = mix(c, vec3(0.78, 0.79, 0.78), frame);
          c = mix(c, wall * 1.08, sill);
          // 玻璃：暗色，反射在後面加；窗簾（米色、從上往下拉一段）
          float curtain = step(0.55, rnd) * step(1.0 - (0.25 + 0.6 * fract(rnd * 7.3)), (f.y - y0) / (y1 - y0));
          vec3 glc = mix(vec3(0.07, 0.09, 0.11), vec3(0.55, 0.5, 0.42), curtain * 0.8);
          glc *= 1.0 - 0.6 * smoothstep(y1 - 0.12, y1 - 0.03, f.y);   // 上緣有窗楣的陰影
          c = mix(c, glc, glass);
          gWin = glass * (1.0 - curtain * 0.7);
          // 遠看：窗格太小，換成平均的顏色
          vec3 avg = mix(wall, vec3(0.2, 0.24, 0.27), 0.3 * upper);
          c = mix(c, avg, far);
          gWin *= 1.0 - far;
          c *= mix(1.0, 0.72, base);
          diffuseColor.rgb = c;
        } else {
          // 屋頂：水泥的深淺斑塊和污漬
          vec2 q = vWp.xz;
          diffuseColor.rgb *= 0.85 + 0.12 * fNoise(q * 0.3) + 0.06 * fNoise(q * 2.1) - 0.1 * smoothstep(0.6, 0.85, fNoise(q * 0.12 + 4.0));
        }
        diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 5.0, vWp.y));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.08, gWin);`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        // 玻璃反射天空：看得越斜反射越多
        {
          vec3 V = normalize(-vViewPosition);
          float fr = 0.05 + 0.45 * pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 5.0);
          vec3 Rw = reflect(normalize(vWp - cameraPosition), normalize(vWn));
          vec3 sky = mix(vec3(0.42, 0.45, 0.42), mix(vec3(0.75, 0.82, 0.86), vec3(0.45, 0.62, 0.8), smoothstep(0.0, 0.6, Rw.y)), smoothstep(-0.08, 0.05, Rw.y));
          // 對面的樹和建築：反射往下看的那段是暗綠灰
          sky = mix(sky, vec3(0.16, 0.2, 0.17), (1.0 - smoothstep(0.05, 0.4, Rw.y + 0.15 * fNoise(vWp.xz * 0.15 + vWp.y * 0.1))) * 0.8);
          gWinRefl = sky * fr * gWin * 0.22;
        }`)
      .replace('#include <common>', '#include <common>\nvec3 gWinRefl = vec3(0.0);')
      .replace('#include <opaque_fragment>', `outgoingLight += gWinRefl;
        #include <opaque_fragment>`)
  }
  mat.customProgramCacheKey = () => 'facade1'
}

export async function buildCampus(scene) {
  const data = await (await fetch('campus.json')).json()
  const inCampus = (p) => data.boundary.some((r) => inside(p, r))

  /* 地面：草地、樹林、球場、道路、池塘都畫在同一張貼圖上 */
  const ground = buildGround(scene, data)

  /* 池塘水面 + 一圈石砌池岸 */
  // 水面：反射天空（只給水用的環境貼圖，其他材質不受影響）
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x24515c, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.86, envMap: skyEnv(), envMapIntensity: 1.2 })
  waterSurface(waterMat)
  for (const p of data.areas.filter((a) => a.kind === 'water')) {
    scene.add(new THREE.Mesh(flatShape(p.pts, WATER_Y), waterMat))
    const edge = new THREE.Mesh(ribbon([...p.pts, p.pts[0]], 0.8, 0.2), new THREE.MeshStandardMaterial({ color: 0xa79f8f, roughness: 1 }))
    edge.castShadow = edge.receiveShadow = true
    scene.add(edge)
  }

  /* 建築：擠出成方塊；每層樓一圈窗帶 */
  const bGeos = [], bMeta = [], dGeos = []
  const tint = (g, c) => {
    g = g.index ? g.toNonIndexed() : g
    const a = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < a.length; i += 3) c.toArray(a, i)
    g.setAttribute('color', new THREE.BufferAttribute(a, 3))
    g.deleteAttribute('uv')
    return g
  }
  for (const b of data.buildings) {
    if (b.pts.length < 3 || area(b.pts) < 12) continue
    let h = b.h ?? (b.kind === 'university' || b.kind === 'college' || b.kind === 'dormitory' ? 14.4 : b.kind === 'roof' ? 4 : 7.2)
    if (b.kind === 'roof') h = Math.min(h, 4.5)
    const shape = new THREE.Shape(b.pts.map(([x, z]) => new THREE.Vector2(x, -z)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    // 頂點色：校內白牆、校外灰；屋頂另一色
    const col = new THREE.Color(), roof = new THREE.Color()
    if (b.in) { col.setHSL(0.11, 0.18, 0.86 + rand() * 0.06); roof.setHSL(0.08, 0.12, 0.62 + rand() * 0.08) }
    else { col.setHSL(0.1, 0.05, 0.72 + rand() * 0.08); roof.setHSL(0, 0, 0.6) }
    if (b.kind === 'chapel' || /淨心堂/.test(b.name || '')) { col.setHSL(0.08, 0.25, 0.9); roof.setHSL(0.03, 0.45, 0.45) }
    const n = g.attributes.normal, cArr = new Float32Array(n.count * 3)
    for (let i = 0; i < n.count; i++) (n.getY(i) > 0.5 ? roof : col).toArray(cArr, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(cArr, 3))
    bGeos.push(g)
    bMeta.push({ ...b, h })
    // 屋頂女兒牆：外框往內縮 0.35 公尺挖空，高 1 公尺
    const ar = area(b.pts)
    if (ar > 60 && b.kind !== 'roof') {
      const hole = inset(b.pts, 0.35)
      if (hole) {
        const sh = new THREE.Shape(b.pts.map(([x, z]) => new THREE.Vector2(x, -z)))
        sh.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))))
        const pg = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, h, 0)
        dGeos.push(tint(pg, col))
      }
    }
    // 屋頂上的樓梯間／機房
    if (b.in && ar > 400 && h > 8) {
      const bb = bbox(b.pts), cx = (bb[0] + bb[2]) / 2, cz = (bb[1] + bb[3]) / 2
      const w = 4 + rand() * 3, d = 3.5 + rand() * 2, hh = 2.6 + rand()
      const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sz]) => inside([cx + sx * (w / 2 + 1), cz + sz * (d / 2 + 1)], b.pts))
      if (ok) dGeos.push(tint(new THREE.BoxGeometry(w, hh, d).translate(cx, h + hh / 2, cz), col))
    }
  }
  const bMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
  facade(bMat)
  const buildings = new THREE.Mesh(mergeGeometries(bGeos), bMat)
  buildings.castShadow = buildings.receiveShadow = true
  scene.add(buildings)
  const detMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
  const details = new THREE.Mesh(mergeGeometries(dGeos.map((g) => { g.deleteAttribute('uv'); return g })), detMat)
  details.castShadow = details.receiveShadow = true
  scene.add(details)

  /* 樹：樹林密、公園中等、草地零星、行道樹沿線 */
  const bIndex = bMeta.map((b) => ({ bb: bbox(b.pts), pts: b.pts }))
  const nearBuilding = ([x, z], m = 2) => bIndex.some(({ bb, pts }) =>
    x > bb[0] - m && x < bb[2] + m && z > bb[1] - m && z < bb[3] + m &&
    (inside([x, z], pts) || inside([x + m, z], pts) || inside([x - m, z], pts) || inside([x, z + m], pts) || inside([x, z - m], pts)))
  const roadIndex = data.roads.filter((r) => r.kind !== 'footway' && r.kind !== 'steps')
  const onRoad = ([x, z]) => roadIndex.some((r) => {
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i]
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r.w / 2 + 1.5) return true
    }
    return false
  })
  const trees = []
  const keepClear = []   // 動物地點周圍留空，鏡頭才看得到
  const scatter = (pts, perM2) => {
    const bb = bbox(pts)
    const n = Math.round(area(pts) * perM2)
    for (let i = 0, got = 0; i < n * 4 && got < n && trees.length < 9000; i++) {
      const p = [bb[0] + rand() * (bb[2] - bb[0]), bb[1] + rand() * (bb[3] - bb[1])]
      if (inside(p, pts)) { trees.push(p); got++ }
    }
  }
  for (const a of data.areas) {
    if (a.kind === 'wood') scatter(a.pts, 1 / 45)
    else if (a.kind === 'park') scatter(a.pts, 1 / 110)
    else if (a.kind === 'grass') scatter(a.pts, 1 / 900)
  }
  for (const row of data.treeRows) {
    for (let i = 1; i < row.length; i++) {
      const [ax, az] = row[i - 1], [bx, bz] = row[i]
      const L = Math.hypot(bx - ax, bz - az)
      for (let d = 0; d < L; d += 8) trees.push([ax + (bx - ax) * d / L, az + (bz - az) * d / L])
    }
  }

  return {
    data, buildings: bMeta, inCampus, ground,
    bake: (renderer, sunDir) => bakeGround(renderer, scene, ground, sunDir),
    // 動物地點決定好後再種樹，避開地點周圍
    plantTrees(clearSpots) {
      keepClear.push(...clearSpots)
      const ok = trees.filter((p) => !nearBuilding(p) && !onRoad(p) && !keepClear.some(([x, z, r]) => Math.hypot(p[0] - x, p[1] - z) < r))
      const forest = makeTrees(ok)
      scene.add(forest)
      this.treeBlobs = forest.userData.blobs
      return ok.length
    },
  }
}

/* 樹：樹幹分兩枝 + 四五團有起伏的樹冠，樹冠下緣壓暗 */
let _canopy
export function canopyGeometry() {
  if (_canopy) return _canopy
  let g = new THREE.IcosahedronGeometry(1, 3)
  g.deleteAttribute('normal'); g.deleteAttribute('uv')
  g = mergeVertices(g)
  const p = g.attributes.position, col = new Float32Array(p.count * 3), v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    // 一團團的葉簇：幾個不同頻率的起伏疊起來
    v.multiplyScalar(canopyBump(v))
    if (v.y < 0) v.y *= 0.75     // 底部比較平
    p.setXYZ(i, v.x, v.y, v.z)
    const k = THREE.MathUtils.lerp(0.55, 1.08, THREE.MathUtils.smoothstep(v.y, -0.8, 0.9))
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return (_canopy = g)
}
export function treeParts() {
  const stem = new THREE.CylinderGeometry(0.16, 0.26, 1, 8).translate(0, 0.5, 0)
  const fork = (a, b) => new THREE.CylinderGeometry(0.06, 0.12, 0.45, 6).translate(0, 0.225, 0).rotateZ(a).rotateY(b).translate(0, 0.72, 0)
  const trunk = mergeGeometries([stem, fork(0.6, 0), fork(0.55, 2.3), fork(0.5, 4.2)])
  return { trunk, blob: canopyGeometry() }
}
function makeTrees(pts) {
  const { trunk, blob } = treeParts()
  const trunkMat = barkify(new THREE.MeshStandardMaterial({ color: 0x6d5544, roughness: 1 }))
  const leafMat = leafify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }))
  const tI = new THREE.InstancedMesh(trunk, trunkMat, pts.length)
  const lI = new THREE.InstancedMesh(blob, leafMat, pts.length * 5)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color()
  let li = 0
  const blobs = []   // 給近景加葉片用
  pts.forEach(([x, z], i) => {
    const H = 5 + rand() * 6, R = 2.2 + rand() * 2
    q.setFromEuler(new THREE.Euler(0, rand() * 6.28, 0))
    m.compose(p.set(x, 0, z), q, s.set(0.7 + H / 22, H * 0.62, 0.7 + H / 22))
    tI.setMatrixAt(i, m)
    const hue = 0.24 + rand() * 0.08, lig = 0.3 + rand() * 0.12
    const k = 3 + (rand() < 0.5 ? 1 : 0) + (R > 3.4 ? 1 : 0)
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2 + rand(), d = j === 0 ? 0 : R * (0.45 + rand() * 0.15)
      q.setFromEuler(new THREE.Euler(rand() * 0.4, rand() * 6.28, rand() * 0.4))
      const r = R * (j === 0 ? 0.95 : 0.6 + rand() * 0.2)
      m.compose(p.set(x + Math.cos(a) * d, H * 0.62 + R * 0.5 + (j ? (rand() - 0.3) * R * 0.5 : R * 0.15), z + Math.sin(a) * d), q, s.set(r, r * 0.8, r))
      lI.setMatrixAt(li, m)
      lI.setColorAt(li, c.setHSL(hue + (rand() - 0.5) * 0.02, 0.45, lig + (rand() - 0.5) * 0.05))
      blobs.push({ x: p.x, z: p.z, m: m.clone(), c: c.clone() })
      li++
    }
  })
  lI.count = li
  tI.castShadow = lI.castShadow = true
  tI.receiveShadow = lI.receiveShadow = true
  const g = new THREE.Group()
  g.add(tI, lI)
  g.userData.blobs = blobs
  return g
}
