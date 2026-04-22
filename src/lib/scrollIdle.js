/**
 * Toggle `body.is-scrolling` while the user is actively scrolling so a single global CSS rule
 * can drop expensive paint effects (backdrop-filter) for the duration of the scroll only.
 *
 * Why: many panels in the app use `backdrop-filter: blur(...)` and sit above a fixed background
 * gradient. On every scroll frame the browser must re-sample and re-blur the area underneath
 * each blurred element. Fast wheel spins exhaust the paint budget, frames are dropped, and the
 * page appears to teleport from near the top to near the bottom. Removing the blur for the
 * brief window the user is scrolling restores fluid frame delivery; the blur snaps back as soon
 * as scrolling stops.
 *
 * Listeners are registered once at boot, passive (so they never block scroll), and capture-phase
 * so nested scroll containers also flip the flag.
 */
export function installScrollIdleHook(idleMs = 140) {
  if (typeof document === 'undefined') return
  if (document.__scrollIdleInstalled) return
  document.__scrollIdleInstalled = true

  const body = document.body
  let timer = 0
  let active = false

  const onActive = () => {
    if (!active) {
      body.classList.add('is-scrolling')
      active = true
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      body.classList.remove('is-scrolling')
      active = false
      timer = 0
    }, idleMs)
  }

  const opts = { passive: true, capture: true }
  window.addEventListener('scroll', onActive, opts)
  window.addEventListener('wheel', onActive, opts)
  window.addEventListener('touchmove', onActive, opts)
}
