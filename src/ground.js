// 地面：把草地、樹林、球場、道路、池塘畫進一張高解析貼圖，再把陽光陰影與天光遮蔽烘進另一張貼圖。
// 全部畫在同一張圖上，就不會有一層層平面互相搶深度而閃爍。
import * as THREE from 'three'

// 細節貼圖涵蓋的範圍（公尺）；外圍再用一張低解析的蓋到地平線
export const CORE = { x0: -560, z0: -560, size: 1120 }
const FAR = { x0: -2000, z0: -2000, size: 4000 }

const AREA_STYLE = {
  parking: ['#b9bab4', 1], wood: ['#5f9446', 2], grass: ['#8cc067', 3], park: ['#86bb60', 3],
  flower: ['#d7a3b4', 4], pitch: ['#c9805a', 5], tennis: ['#4f8f7c', 6], field: ['#7db65a', 4],
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

function plane(ext, y) {
  const g = new THREE.PlaneGeometry(ext.size, ext.size).rotateX(-Math.PI / 2)
  g.translate(ext.x0 + ext.size / 2, y, ext.z0 + ext.size / 2)
  return g
}

// 地面材質：貼圖上色，烘好的光影乘到直射光（R）與天光（G）上，再加一層世界座標的細雜訊
function groundMaterial(map, bake) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 1 })
  m.userData.bake = { value: bake }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.bakeMap = m.userData.bake
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGp = (modelMatrix * vec4(transformed, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vGp;
        uniform sampler2D bakeMap;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // 近看才有的細節：草地明暗斑塊 + 細碎顆粒；離鏡頭遠就淡掉，避免俯瞰時閃爍
        float gFade = 1.0 - smoothstep(60.0, 220.0, length(vViewPosition));
        float gn = gNoise(vGp * 0.35) * 0.6 + gNoise(vGp * 2.3) * 0.25 + gHash(floor(vGp * 9.0)) * 0.15;
        diffuseColor.rgb *= mix(1.0, 0.86 + gn * 0.26, gFade);`)
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
  const farMesh = new THREE.Mesh(plane(FAR, -0.05), groundMaterial(far, white))
  const nearMat = groundMaterial(near, white)
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
