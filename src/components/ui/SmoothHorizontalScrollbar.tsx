import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'
import Lottie from 'lottie-react'
import type { LottieRefCurrentProps } from 'lottie-react'
import catRunAnimation from '../../assets/lottie/cat-run.json'
import { getScrollProgress } from '../../utils/getScrollProgress'
import './SmoothHorizontalScrollbar.css'

/**
 * Running cat Lottie (cat6.json) via ruby840124/catAnimationUseLottie demo assets.
 * Replace with your own licensed file if needed.
 */

const SPRING = {
  stiffness: 680,
  damping: 38,
  mass: 0.25,
} as const

/** Approximate thumb width along the track (Lottie + padding). */
const THUMB_TRACK_W = 78
const DEFAULT_WHEEL_MULT = 3.25

/** px/s — below this, cat stands (frame 0). */
const CAT_IDLE_VEL = 28
/** px/s — reference “fast run” for playback speed cap. */
const CAT_RUN_VEL = 380

type Props = {
  scrollRef: RefObject<HTMLElement | null>
  wheelSpeedMultiplier?: number
  className?: string
}

export function SmoothHorizontalScrollbar({
  scrollRef,
  wheelSpeedMultiplier = DEFAULT_WHEEL_MULT,
  className = '',
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const lottieRef = useRef<LottieRefCurrentProps | null>(null)
  const reduceMotionRef = useRef(false)
  const rafScrollRef = useRef(0)
  const prevScrollLeftRef = useRef(0)
  const velSampleRef = useRef<{ t: number; left: number }>({ t: 0, left: 0 })
  const scrollVelocityRef = useRef(0)
  const decayRafRef = useRef(0)
  const dragPointerIdRef = useRef<number | null>(null)
  const draggingThumbRef = useRef(false)
  const trackDragRef = useRef(false)

  const [hasOverflow, setHasOverflow] = useState(false)

  const progressTarget = useMotionValue(0)
  const progressSpring = useSpring(progressTarget, SPRING)

  const trackWidthMv = useMotionValue(0)

  /**
   * Asset faces left at scaleX 1. +1 → natural; −1 → mirrored (chasing toward scroll-right).
   */
  const facingTarget = useMotionValue(-1)
  const thumbMirrorX = useTransform(facingTarget, (f) => (f >= 0 ? 1 : -1))

  const dragScaleTarget = useMotionValue(1)
  const dragScaleSpring = useSpring(dragScaleTarget, {
    stiffness: 640,
    damping: 36,
    mass: 0.2,
  })

  const fillWidthPx = useTransform([progressSpring, trackWidthMv], ([p, tw]) => {
    const w = typeof tw === 'number' ? tw : 0
    const prog = typeof p === 'number' ? p : 0
    return Math.max(0, prog * w)
  })

  const thumbTranslateX = useTransform([progressSpring, trackWidthMv], ([p, tw]) => {
    const w = typeof tw === 'number' ? tw : 0
    const prog = typeof p === 'number' ? p : 0
    const travel = Math.max(0, w - THUMB_TRACK_W)
    return prog * travel
  })

  const thumbScale = useTransform(dragScaleSpring, (s) =>
    typeof s === 'number' ? s : 1
  )

  /** Mouse dodges slightly toward the end of the track as the cat closes in. */
  const mouseFleeX = useTransform(progressSpring, (p) =>
    typeof p === 'number' ? p * 20 : 0
  )
  const mouseOpacity = useTransform(progressSpring, (p) =>
    typeof p === 'number' && p > 0.93 ? 0.28 : 1
  )

  const syncCatLottie = useCallback(() => {
    const anim = lottieRef.current
    if (!anim?.animationLoaded) return

    if (reduceMotionRef.current) {
      anim.pause()
      anim.goToAndStop(0, true)
      return
    }

    const v = scrollVelocityRef.current
    if (v < CAT_IDLE_VEL) {
      anim.pause()
      anim.goToAndStop(0, true)
      return
    }

    anim.play()
    const u = Math.min(
      1,
      Math.max(0, (v - CAT_IDLE_VEL) / (CAT_RUN_VEL - CAT_IDLE_VEL))
    )
    const speed = 0.42 + u * (2.65 - 0.42)
    anim.setSpeed(speed)
  }, [])

  const applyScrollProgress = useCallback(
    (el: HTMLElement, progress: number) => {
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 0) return
      el.scrollLeft = progress * maxScroll
    },
    []
  )

  const bumpDirectionFromDelta = useCallback(
    (delta: number) => {
      if (delta > 0) facingTarget.set(-1)
      else if (delta < 0) facingTarget.set(1)
    },
    [facingTarget]
  )

  const queueProgressFromElement = useCallback(
    (el: HTMLElement) => {
      if (rafScrollRef.current) return
      rafScrollRef.current = requestAnimationFrame(() => {
        rafScrollRef.current = 0
        const now = performance.now()
        const left = el.scrollLeft
        const d = left - prevScrollLeftRef.current
        prevScrollLeftRef.current = left

        const vs = velSampleRef.current
        const dt = (now - vs.t) / 1000
        if (dt > 0.0008 && dt < 0.45) {
          const inst = Math.abs(left - vs.left) / dt
          scrollVelocityRef.current =
            scrollVelocityRef.current * 0.78 + inst * 0.22
        }
        velSampleRef.current = { t: now, left }

        const p = getScrollProgress(left, el.scrollWidth, el.clientWidth)
        progressTarget.set(p)
        if (d !== 0) bumpDirectionFromDelta(d)
        syncCatLottie()
      })
    },
    [bumpDirectionFromDelta, progressTarget, syncCatLottie]
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduceMotionRef.current = mq.matches
    const onMq = () => {
      reduceMotionRef.current = mq.matches
      syncCatLottie()
    }
    mq.addEventListener('change', onMq)
    return () => mq.removeEventListener('change', onMq)
  }, [syncCatLottie])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return undefined

    const ro = new ResizeObserver(() => {
      trackWidthMv.set(track.clientWidth)
    })
    ro.observe(track)
    trackWidthMv.set(track.clientWidth)
    return () => ro.disconnect()
  }, [trackWidthMv])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined

    const syncOverflow = () => {
      setHasOverflow(el.scrollWidth > el.clientWidth + 1)
    }

    const sl = el.scrollLeft
    prevScrollLeftRef.current = sl
    velSampleRef.current = { t: performance.now(), left: sl }
    scrollVelocityRef.current = 0
    progressTarget.set(getScrollProgress(sl, el.scrollWidth, el.clientWidth))
    syncOverflow()
    requestAnimationFrame(() => syncCatLottie())

    const onScroll = () => queueProgressFromElement(el)

    el.addEventListener('scroll', onScroll, { passive: true })

    const ro = new ResizeObserver(() => {
      syncOverflow()
      queueProgressFromElement(el)
    })
    ro.observe(el)

    const mo = new MutationObserver(syncOverflow)
    mo.observe(el, { childList: true, subtree: true })

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return

      const shiftAxisSwap = e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)
      const horizontalDominant =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 0

      if (!shiftAxisSwap && !horizontalDominant) return

      e.preventDefault()
      const prev = el.scrollLeft
      const dx = shiftAxisSwap
        ? e.deltaY * wheelSpeedMultiplier
        : e.deltaX * wheelSpeedMultiplier
      el.scrollLeft += dx
      bumpDirectionFromDelta(el.scrollLeft - prev)
      queueProgressFromElement(el)
    }

    el.addEventListener('wheel', onWheel, { passive: false })

    const decayLoop = () => {
      scrollVelocityRef.current *= 0.94
      syncCatLottie()
      decayRafRef.current = requestAnimationFrame(decayLoop)
    }
    decayRafRef.current = requestAnimationFrame(decayLoop)

    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      ro.disconnect()
      mo.disconnect()
      if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current)
      if (decayRafRef.current) cancelAnimationFrame(decayRafRef.current)
    }
  }, [
    scrollRef,
    wheelSpeedMultiplier,
    bumpDirectionFromDelta,
    queueProgressFromElement,
    progressTarget,
    syncCatLottie,
  ])

  const setScrollFromClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current
      const track = trackRef.current
      if (!el || !track) return
      const rect = track.getBoundingClientRect()
      const tw = rect.width
      if (tw <= 0) return
      const x = Math.min(tw, Math.max(0, clientX - rect.left))
      const p = x / tw
      applyScrollProgress(el, p)
      progressTarget.set(p)
      prevScrollLeftRef.current = el.scrollLeft
    },
    [scrollRef, applyScrollProgress, progressTarget]
  )

  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = scrollRef.current
      const track = trackRef.current
      if (!el || !track || el.scrollWidth <= el.clientWidth + 1) return
      if ((e.target as HTMLElement).closest('.smooth-hscroll__thumb')) return

      el.style.scrollBehavior = 'auto'
      trackDragRef.current = true
      track.setPointerCapture(e.pointerId)
      const prev = el.scrollLeft
      setScrollFromClientX(e.clientX)
      bumpDirectionFromDelta(el.scrollLeft - prev)
    },
    [scrollRef, setScrollFromClientX, bumpDirectionFromDelta]
  )

  const onTrackPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!trackDragRef.current) return
      const el = scrollRef.current
      if (!el) return
      const prev = el.scrollLeft
      setScrollFromClientX(e.clientX)
      bumpDirectionFromDelta(el.scrollLeft - prev)
    },
    [scrollRef, setScrollFromClientX, bumpDirectionFromDelta]
  )

  const onTrackPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const track = trackRef.current
      const el = scrollRef.current
      if (!trackDragRef.current) return
      if (track?.hasPointerCapture(e.pointerId)) {
        track.releasePointerCapture(e.pointerId)
      }
      trackDragRef.current = false
      if (el) el.style.scrollBehavior = ''
    },
    [scrollRef]
  )

  const onThumbPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = scrollRef.current
      if (!el || el.scrollWidth <= el.clientWidth + 1) return
      e.stopPropagation()
      el.style.scrollBehavior = 'auto'
      draggingThumbRef.current = true
      dragPointerIdRef.current = e.pointerId
      dragScaleTarget.set(1.08)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [scrollRef, dragScaleTarget]
  )

  const onThumbPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingThumbRef.current || dragPointerIdRef.current !== e.pointerId)
        return
      const el = scrollRef.current
      if (!el) return
      const prev = el.scrollLeft
      setScrollFromClientX(e.clientX)
      bumpDirectionFromDelta(el.scrollLeft - prev)
    },
    [scrollRef, setScrollFromClientX, bumpDirectionFromDelta]
  )

  const onThumbPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragPointerIdRef.current !== e.pointerId) return
      const el = scrollRef.current
      draggingThumbRef.current = false
      dragPointerIdRef.current = null
      dragScaleTarget.set(1)
      if (el) el.style.scrollBehavior = ''
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      }
    },
    [scrollRef, dragScaleTarget]
  )

  return (
    <div
      className={`smooth-hscroll ${hasOverflow ? '' : 'smooth-hscroll--hidden'} ${className}`.trim()}
      aria-hidden={!hasOverflow}
    >
      <div className="smooth-hscroll__inner">
        <div
          ref={trackRef}
          className="smooth-hscroll__track"
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerUp}
          role="presentation"
        >
          <div className="smooth-hscroll__track-line" aria-hidden />
          <motion.div
            className="smooth-hscroll__fill"
            style={{ width: fillWidthPx }}
            aria-hidden
          />
          <motion.div
            className="smooth-hscroll__mouse"
            aria-hidden
            style={{
              right: 6,
              top: '50%',
              y: '-50%',
              x: mouseFleeX,
              opacity: mouseOpacity,
            }}
          >
            <svg
              className="smooth-hscroll__mouse-svg"
              viewBox="0 0 36 28"
              width="30"
              height="24"
              role="img"
              aria-hidden
            >
              <ellipse cx="17" cy="17" rx="11" ry="7.5" fill="#64748b" />
              <ellipse cx="17" cy="17.5" rx="8" ry="5" fill="#94a3b8" />
              <circle cx="24" cy="9" r="5" fill="#fda4af" />
              <circle cx="30" cy="11" r="4.5" fill="#fda4af" />
              <circle cx="10.5" cy="16" r="2.2" fill="#0f172a" />
              <ellipse cx="26" cy="18" rx="2" ry="1.2" fill="#cbd5e1" />
            </svg>
          </motion.div>
          <motion.div
            className="smooth-hscroll__thumb"
            style={{
              x: thumbTranslateX,
              y: '-50%',
              scaleX: thumbMirrorX,
            }}
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
          >
            <div className="smooth-hscroll__lottie-wrap" aria-hidden>
              <motion.div
                className="smooth-hscroll__lottie-scale"
                style={{ scale: thumbScale }}
              >
                <Lottie
                  lottieRef={lottieRef}
                  animationData={catRunAnimation}
                  loop
                  autoplay={false}
                  className="smooth-hscroll__lottie"
                  onDOMLoaded={() => syncCatLottie()}
                  rendererSettings={{
                    preserveAspectRatio: 'xMidYMid meet',
                  }}
                />
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
