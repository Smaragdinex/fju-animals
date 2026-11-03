// 一次滑一站：滾輪、觸控、方向鍵都只會讓頁面移到上一站或下一站，用動畫慢慢飛過去。
// 手感：滑一點點時畫面先跟著被拉一下（鏡頭也開始往那邊偏），滑夠了才真的出發，不夠就彈回來。
// 飛行中、還有觸控板慣性的時候，多滑的都不算，到站先停下；要等手停了再滑一次才去下一站。
// 卡片比螢幕高（手機上展開小知識）時，在那一站裡面照一般方式捲，捲到底再換站。
const COMMIT = 90          // 累積滾動量（px）超過這個才換站
const NUDGE = 0.22         // 還沒換站前，畫面跟著拉動的比例
const NUDGE_MAX = 70       // 最多先拉多少 px
const QUIET = 240          // 滾輪停多久（ms）才算一次新的手勢
const SWIPE = 45           // 觸控滑多少 px 算換站

export function snapScroll(steps, { onChange } = {}) {
  const se = document.scrollingElement
  let idx = 0, anim = null, nudge = 0, acc = 0, lastWheel = 0, locked = false, settle = null
  const maxTop = () => se.scrollHeight - innerHeight
  // 每一站的停點（卡片置中）；比螢幕高的站給一段可以自由捲的範圍
  const range = (i) => {
    const s = steps[i], c = s.offsetTop + s.offsetHeight / 2 - innerHeight / 2
    if (s.offsetHeight <= innerHeight + 2) return [c, c].map((v) => Math.min(Math.max(v, 0), maxTop()))
    return [s.offsetTop, s.offsetTop + s.offsetHeight - innerHeight].map((v) => Math.min(Math.max(v, 0), maxTop()))
  }
  let base = range(0)[0]          // 目前站內的捲動位置（不含 nudge）
  const apply = () => { se.scrollTop = base + nudge }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

  function goTo(i, instant = false) {
    i = Math.max(0, Math.min(steps.length - 1, i))
    const [lo, hi] = range(i), to = i >= idx ? lo : hi
    const from = base + nudge
    idx = i; nudge = 0; acc = 0
    onChange?.(i)
    if (instant || Math.abs(to - from) < 1) { anim = null; base = to; apply(); return }
    const n = Math.max(1, Math.abs(i - nearest(from)))
    anim = { from, to, t0: performance.now(), dur: Math.min(2600, 1150 + 300 * (n - 1)) }
    locked = true
  }
  const nearest = (y) => {
    let b = 0, bd = Infinity
    steps.forEach((_, i) => { const [lo, hi] = range(i), d = y < lo ? lo - y : y > hi ? y - hi : 0; if (d < bd) { bd = d; b = i } })
    return b
  }
  // 往 dir 方向滑 d px：先在站內捲，到邊了才累積成換站
  function push(d) {
    const [lo, hi] = range(idx)
    if (hi > lo) {
      const nb = Math.min(hi, Math.max(lo, base + d))
      const used = nb - base; base = nb; d -= used
      if (Math.abs(d) < 0.5) { apply(); return }
    }
    acc += d
    if ((acc > COMMIT && idx < steps.length - 1) || (acc < -COMMIT && idx > 0)) { goTo(idx + Math.sign(acc)); return }
    // 頭尾那站不能再過去：拉動量打折，像橡皮筋
    const edge = (acc > 0 && idx === steps.length - 1) || (acc < 0 && idx === 0)
    nudge = Math.sign(acc) * Math.min(NUDGE_MAX, Math.abs(acc) * NUDGE * (edge ? 0.35 : 1))
    apply()
    clearTimeout(settle); settle = setTimeout(springBack, 160)
  }
  function springBack() {
    if (anim) return
    acc = 0
    const n0 = nudge, t0 = performance.now()
    const step = () => { if (anim || acc) return; const t = Math.min(1, (performance.now() - t0) / 260); nudge = n0 * (1 - ease(t)); apply(); if (t < 1) requestAnimationFrame(step) }
    requestAnimationFrame(step)
  }

  addEventListener('wheel', (e) => {
    if (e.ctrlKey) return                       // 觸控板縮放
    e.preventDefault()
    const now = performance.now(), gap = now - lastWheel
    lastWheel = now
    if (anim) return
    if (locked) { if (gap < QUIET) return; locked = false }
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1)
    // 滑鼠滾輪一格（大的跳動）直接換站；觸控板的小量慢慢累積
    push(Math.abs(dy) >= 60 && gap > QUIET ? Math.sign(dy) * (COMMIT + 1) : dy)
    if (anim) lastWheel = now
  }, { passive: false })

  let ty = null, tStart = 0, tMoved = 0
  // 手指放下就是新的手勢（觸控沒有慣性），到站後的鎖在這裡解開
  addEventListener('touchstart', (e) => { if (e.touches.length === 1) { ty = e.touches[0].clientY; tStart = performance.now(); tMoved = 0; if (!anim) locked = false } }, { passive: true })
  addEventListener('touchmove', (e) => {
    if (ty == null || e.touches.length !== 1) return
    e.preventDefault()
    const y = e.touches[0].clientY, d = ty - y; ty = y; tMoved += d
    if (anim || locked) return
    const [lo, hi] = range(idx)
    if (hi > lo && base + d >= lo && base + d <= hi && !acc) { base += d; apply(); return }
    acc += d
    const edge = (acc > 0 && idx === steps.length - 1) || (acc < 0 && idx === 0)
    nudge = Math.sign(acc) * Math.min(NUDGE_MAX * 1.4, Math.abs(acc) * 0.45 * (edge ? 0.35 : 1))
    apply()
  }, { passive: false })
  addEventListener('touchend', () => {
    if (ty == null) return
    ty = null
    if (anim) return
    locked = false
    const fast = Math.abs(tMoved) / Math.max(1, performance.now() - tStart) > 0.5
    if ((Math.abs(acc) > SWIPE || (fast && Math.abs(acc) > 12)) && !((acc > 0 && idx === steps.length - 1) || (acc < 0 && idx === 0))) goTo(idx + Math.sign(acc))
    else springBack()
  })

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return
    const k = e.key, d = k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey) ? 1 : k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey) ? -1 : 0
    if (k === 'Home') { e.preventDefault(); goTo(0) } else if (k === 'End') { e.preventDefault(); goTo(steps.length - 1) }
    if (!d) return
    e.preventDefault()
    if (!anim) goTo(idx + d)
  })

  // 拖捲軸之類的原生捲動：停下來後吸到最近的一站
  let userScroll = null
  addEventListener('scroll', () => {
    if (anim || Math.abs(se.scrollTop - (base + nudge)) < 2) return
    clearTimeout(userScroll)
    userScroll = setTimeout(() => {
      if (anim) return
      const i = nearest(se.scrollTop), [lo, hi] = range(i)
      if (se.scrollTop >= lo && se.scrollTop <= hi) { idx = i; base = se.scrollTop; nudge = 0; onChange?.(i); return }
      base = se.scrollTop; nudge = 0; idx = i; goTo(i)
    }, 180)
  }, { passive: true })
  addEventListener('resize', () => { if (!anim) { base = Math.min(Math.max(base, range(idx)[0]), range(idx)[1]); nudge = 0; apply() } })

  // 每格推進動畫（由主迴圈呼叫）
  function tick() {
    if (!anim) return
    const t = Math.min(1, (performance.now() - anim.t0) / anim.dur)
    base = anim.from + (anim.to - anim.from) * ease(t); nudge = 0; apply()
    if (t >= 1) { anim = null; lastWheel = performance.now() }
  }
  history.scrollRestoration = 'manual'
  goTo(0, true)
  return { goTo, tick, get index() { return idx }, get moving() { return !!anim } }
}
