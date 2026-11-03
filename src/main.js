// 輔大的動物鄰居：往下捲，鏡頭依序飛到每種動物出沒的地點
import * as THREE from 'three'
import { buildCampus, WATER_Y, useRenderer } from './campus.js'
import { placeAnimal, loadAnimalModels } from './models.js'
import { buildDetail, foliageNear } from './foliage.js'
import { ANIMALS } from './animals.js'

const canvas = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0

const scene = new THREE.Scene()
const SKY = new THREE.Color(0xcfe3ea)
scene.background = SKY
scene.fog = new THREE.FogExp2(SKY, 0.00042)
const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 5000)

// 下午三四點的太陽：從西南方斜照。鏡頭多半從南邊看過去，影子才會落在看得到的那一側
scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x6f7a55, 1.05))
const sun = new THREE.DirectionalLight(0xffe6c4, 3.3)
const SUN_DIR = new THREE.Vector3(-0.66, 0.55, 0.36).normalize()
sun.castShadow = true
// 補光：跟著鏡頭從背後打過去，只在近景開；逆光時動物才不會整隻黑掉
const fill = new THREE.DirectionalLight(0xfff4e8, 0)
scene.add(fill, fill.target)
const SMALL = Math.min(innerWidth, innerHeight) <= 700
sun.shadow.mapSize.setScalar(SMALL ? 2048 : 4096)
sun.shadow.bias = -0.0003
sun.shadow.normalBias = 0.04
scene.add(sun, sun.target)

/* ---------- 故事段落 ---------- */
const story = document.getElementById('story')
const dots = document.getElementById('dots')
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
story.innerHTML = [
  `<section class="step"><div class="card">
    <h1>輔大的動物鄰居</h1>
    <p>在輔仁大學的草地、樹林和池塘邊，住著不少動物。往下滑動，跟著鏡頭去認識其中 10 種。</p>
    <p class="hint">↓ 往下滑開始</p>
  </div></section>`,
  ...ANIMALS.map((a, i) => `<section class="step"><div class="card">
    <div class="num">${String(i + 1).padStart(2, '0')} / ${ANIMALS.length}</div>
    <h2>${esc(a.name)}${a.nick ? `<span class="nick">${esc(a.nick)}</span>` : ''}</h2>
    <div class="sci">${esc(a.sci)}</div>
    <div class="where">📍 ${esc(a.place)}・${esc(a.where)}</div>
    <p>${esc(a.intro)}</p>
    <ul>${a.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
  </div></section>`),
  `<section class="step last"><div class="card">
    <h2>全部 10 種</h2>
    <p>點名字可以再回去看一次。</p>
    <div class="grid">${ANIMALS.map((a, i) => `<button data-go="${i + 1}">${esc(a.name)}</button>`).join('')}</div>
    <div class="small">地點為大概的出沒範圍，動物會移動，不一定每次都看得到。<br>
    觀察時請保持距離，不追趕、不餵食。<br>
    地圖資料 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors<br>
    松鼠模型：<a href="https://sketchfab.com/3d-models/111eaa6a9868485bb2ae71a9b409fbb8" target="_blank" rel="noopener">Eastern gray squirrel</a> by faerbogdan99（<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>，已改毛色）<br>
    烏龜模型：<a href="https://sketchfab.com/3d-models/638f29eae79d40ddb0adaf6ebb8375cc" target="_blank" rel="noopener">Reeve's Pond Turtle</a>、<a href="https://sketchfab.com/3d-models/ce4dd87f62564d7bb3804023044b2b62" target="_blank" rel="noopener">Red-eared Slider</a> by ffish.asia / floraZia.com（CC0）</div>
  </div></section>`,
].join('')
const steps = [...story.querySelectorAll('.step')]
steps.forEach((_, i) => {
  const b = document.createElement('button')
  b.title = i === 0 ? '開頭' : i === steps.length - 1 ? '全部' : ANIMALS[i - 1].name
  b.onclick = () => goTo(i)
  dots.appendChild(b)
})
function goTo(i) {
  const s = steps[i]
  scrollTo({ top: s.offsetTop + s.offsetHeight / 2 - innerHeight / 2, behavior: 'smooth' })
}
story.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) goTo(+b.dataset.go) })

/* ---------- 場景 ---------- */
const OVERVIEW = { pos: new THREE.Vector3(250, 470, 620), target: new THREE.Vector3(-10, 0, -10) }
const OUTRO = { pos: new THREE.Vector3(-420, 380, 420), target: new THREE.Vector3(0, 0, 40) }
let shots = [], animals = [], pins = [], ready = false, detail = null

async function init() {
  useRenderer(renderer)
  const [campus] = await Promise.all([buildCampus(scene), loadAnimalModels()])
  animals = ANIMALS.map((def) => {
    const a = placeAnimal(def, WATER_Y)
    scene.add(a.group)
    return { def, ...a }
  })
  // 動物地點和鏡頭之間不種樹
  const clear = []
  for (const a of animals) {
    clear.push([a.def.spot[0], a.def.spot[1], 7])
    for (let k = 0.25; k <= 1; k += 0.25) clear.push([a.target.x + (a.cam.x - a.target.x) * k, a.target.z + (a.cam.z - a.target.z) * k, 3.5])
  }
  campus.plantTrees(clear)
  // 地面的陽光陰影與天光遮蔽一次烘好，之後地面不再即時算陰影
  const baked = campus.bake(renderer, SUN_DIR)
  console.log(`[fju] 地面烘焙 ${baked.ms} ms`)
  // 近景的草葉和樹冠葉片（一次只畫鏡頭所在的那一處）
  detail = buildDetail(scene, campus.ground, animals, campus.treeBlobs)
  shots = [OVERVIEW, ...animals.map((a) => ({ pos: a.cam, target: a.target })), OUTRO]
  makePins(campus)
  Object.assign(window.__fju, { campus, animals, shots, shotAt: (p) => (shotAt(p), { pos: camPos.clone(), target: camTarget.clone() }) })
  resize()
  // 預熱：載入畫面還蓋著的時候，把每一站都先畫一次。著色器編譯、貼圖上傳、陰影都在這時做完，
  // 第一次滑到某一站時才不會卡一下、閃一下。要畫在畫面上（不是 render target），色調對應才是同一組著色器。
  const t0 = performance.now()
  for (const s of shots) {
    camera.position.copy(s.pos); camera.lookAt(s.target); camera.updateMatrixWorld()
    detail.update(camera.position, 0)
    sun.target.position.copy(s.target); sun.position.copy(s.target).addScaledVector(SUN_DIR, 100)
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld()
    for (const a of animals) a.update(0, 0.016)
    renderer.render(scene, camera)
  }
  await renderer.compileAsync(scene, camera)
  console.log(`[fju] 預熱 ${Math.round(performance.now() - t0)} ms`)
  ready = true
  document.getElementById('loading').classList.add('done')
}

/* ---------- 標籤 ---------- */
const labels = document.getElementById('labels')
const LANDMARKS = ['中美堂', '淨心堂', '濟時樓', '聖言樓', '野聲樓', '文開樓', '利瑪竇大樓', '德芳外語大樓']
function makePins(campus) {
  animals.forEach((a, i) => {
    const el = document.createElement('div')
    el.className = 'pin'
    el.innerHTML = `<span>${esc(a.def.name)}</span>`
    el.onclick = () => goTo(i + 1)
    labels.appendChild(el)
    pins.push({ el, pos: new THREE.Vector3(a.def.spot[0], a.target.y + 1.6, a.def.spot[1]), animal: i })
  })
  for (const b of campus.buildings) {
    const hit = b.name && LANDMARKS.find((n) => b.name.includes(n))
    if (!hit) continue
    const cx = b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length, cz = b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length
    const el = document.createElement('div')
    el.className = 'pin place'
    el.innerHTML = `<span>${esc(hit)}</span>`
    labels.appendChild(el)
    pins.push({ el, pos: new THREE.Vector3(cx, b.h + 2, cz), place: true })
  }
  for (const a of campus.data.areas) {
    if (!['荷花池', '維也納森林', '小巴黎'].includes(a.name)) continue
    const cx = a.pts.reduce((s, p) => s + p[0], 0) / a.pts.length, cz = a.pts.reduce((s, p) => s + p[1], 0) / a.pts.length
    const el = document.createElement('div')
    el.className = 'pin place'
    el.innerHTML = `<span>${esc(a.name)}</span>`
    labels.appendChild(el)
    pins.push({ el, pos: new THREE.Vector3(cx, 6, cz), place: true })
  }
}
const _v = new THREE.Vector3(), _up = new THREE.Vector3()
function updatePins(active) {
  const w = innerWidth, h = innerHeight
  const high = camera.position.y > 60
  // 標籤互相避開：正在看的動物最優先，其次其他動物，地名最後；
  // 動物標籤撞到就往上疊，地名撞到就藏起來
  const order = [...pins].sort((a, b) => rank(a, active) - rank(b, active))
  const taken = []
  for (const p of order) {
    _v.copy(p.pos).project(camera)
    let show = high && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1
    const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h
    if (show) {
      p.size ||= [p.el.offsetWidth, p.el.firstChild.offsetHeight]
      const [pw, ph] = p.size, base = p.place ? 8 : 16
      // 只算標籤本身（不含下面的細線）佔的範圍
      const box = (stem) => [x - pw / 2 - 3, y - stem - ph - 2, x + pw / 2 + 3, y - stem + 2]
      const hit = (b) => taken.some((t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1])
      let stem = base
      if (p.place) show = !hit(box(stem))
      else while (hit(box(stem)) && stem < base + ph * 4) stem += ph * 0.5
      if (show) taken.push(box(stem))
      p.el.style.setProperty('--stem', `${stem}px`)
    }
    p.el.style.opacity = show ? 1 : 0
    p.el.style.pointerEvents = show ? 'auto' : 'none'
    p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
    if (!p.place) p.el.classList.toggle('on', p.animal === active)
  }
}
const rank = (p, active) => (p.place ? 2 : p.animal === active ? 0 : 1)

/* ---------- 捲動 → 鏡頭 ---------- */
function scrollProgress() {
  // 每一段的中心對應一個鏡頭位置；段與段之間內插
  const y = scrollY
  const keys = steps.map((s) => s.offsetTop + s.offsetHeight / 2 - innerHeight / 2)
  if (y <= keys[0]) return 0
  for (let i = 1; i < keys.length; i++) if (y < keys[i]) return i - 1 + (y - keys[i - 1]) / (keys[i] - keys[i - 1])
  return keys.length - 1
}
const ease = (t) => { t = THREE.MathUtils.smoothstep(t, 0.12, 0.88); return t }
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3()
function shotAt(p) {
  const i = Math.min(shots.length - 2, Math.floor(p)), f = ease(p - i)
  const A = shots[i], B = shots[i + 1]
  // 兩個近景之間：先往上升到樹冠上方、再水平飛過去、最後降下來。
  // 以前是邊飛邊升，鏡頭會低空穿過樹冠，整個畫面一下暗一下亮（閃圖）。
  const H = THREE.MathUtils.clamp(A.pos.distanceTo(B.pos) * 0.45, 30, 160)
  const up = THREE.MathUtils.smoothstep(f, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(f, 0.7, 1))
  const fh = THREE.MathUtils.smoothstep(f, 0.2, 0.8)
  camPos.lerpVectors(A.pos, B.pos, fh)
  camTarget.lerpVectors(A.target, B.target, fh)
  camPos.y += H * up
  camTarget.y += H * up * 0.3
  return Math.round(p)
}

let smooth = null
const clock = new THREE.Clock()
function frame() {
  requestAnimationFrame(frame)
  if (!ready) return
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime
  const p = scrollProgress()
  const nearest = shotAt(p)
  // 除錯：__fju.view = { pos:[x,y,z], target:[x,y,z] } 可以把鏡頭固定在任意位置
  const dv = window.__fju.view
  if (dv) { camPos.fromArray(dv.pos); camTarget.fromArray(dv.target); smooth = null }
  // 平滑追上捲動位置，手機慣性捲動才不會抖
  if (!smooth) smooth = { pos: camPos.clone(), target: camTarget.clone() }
  const k = 1 - Math.exp(-dt * 6)
  smooth.pos.lerp(camPos, k); smooth.target.lerp(camTarget, k)
  camera.position.copy(smooth.pos)
  camera.lookAt(smooth.target)

  // 陰影範圍跟著鏡頭：近景很細、俯瞰時涵蓋全校
  const dist = camera.position.distanceTo(smooth.target)
  const S = THREE.MathUtils.clamp(dist * 0.9, 12, 520)
  sun.target.position.copy(smooth.target)
  sun.position.copy(smooth.target).addScaledVector(SUN_DIR, S * 2 + 50)
  const sc = sun.shadow.camera
  if (Math.abs(sc.right - S) > 0.5) {
    Object.assign(sc, { left: -S, right: S, top: S, bottom: -S, near: 1, far: S * 4 + 100 })
    sc.updateProjectionMatrix()
  }

  fill.position.copy(camera.position).add(_up.set(0, 3, 0))
  fill.target.position.copy(smooth.target)
  fill.intensity = 1.4 * (1 - THREE.MathUtils.smoothstep(dist, 8, 40))

  // 除錯：__fju.pause = true 讓動物停住
  if (!window.__fju.pause) for (const a of animals) if (a.target.distanceTo(camera.position) < 200) a.update(t, dt)
  const active = nearest >= 1 && nearest <= animals.length ? nearest - 1 : -1
  detail?.update(camera.position, t)
  // 飛行途中（不在任何一站上）樹葉溶掉的範圍放大
  foliageNear.value = THREE.MathUtils.lerp(2.8, 9, THREE.MathUtils.smoothstep(Math.abs(p - nearest), 0.02, 0.12))
  updatePins(active)
  ;[...dots.children].forEach((d, i) => d.classList.toggle('on', i === nearest))
  renderer.render(scene, camera)
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  // 直式螢幕視角放寬，近景才不會切掉動物
  camera.fov = camera.aspect < 0.8 ? 58 : 40
  // 寬螢幕左邊有卡片，把畫面中心往右推，動物才不會被擋住
  // 窄螢幕卡片在下面，改成把畫面中心往上推
  const wide = innerWidth > 720
  const sx = wide ? -Math.min(240, innerWidth * 0.2) : 0
  const sy = wide ? 0 : innerHeight * 0.24
  camera.setViewOffset(innerWidth, innerHeight, sx, sy, innerWidth, innerHeight)
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()
frame()
init()
window.__fju = { scene, camera, renderer, animals, goTo }
