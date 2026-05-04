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
import { getScrollProgress } from '../../utils/getScrollProgress'
import './SmoothHorizontalScrollbar.css'

const SPRING = {
  stiffness: 680,
  damping: 38,
  mass: 0.25,
} as const

const ARROW_W = 14
const DEFAULT_WHEEL_MULT = 3.25

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
  const rafScrollRef = useRef(0)
  const prevScrollLeftRef = useRef(0)
  const dragPointerIdRef = useRef<number | null>(null)
  const draggingThumbRef = useRef(false)
  const trackDragRef = useRef(false)

  const [hasOverflow, setHasOverflow] = useState(false)

  const progressTarget = useMotionValue(0)
  const progressSpring = useSpring(progressTarget, SPRING)

  const trackWidthMv = useMotionValue(0)

  /** Degrees: 0 = arrow →, 180 = arrow ← (avoid springing scalar −1↔1 which crosses zero). */
  const rotationTarget = useMotionValue(0)
  const rotationSpring = useSpring(rotationTarget, {
    stiffness: 720,
    damping: 42,
    mass: 0.22,
  })

  const dragScaleTarget = useMotionValue(1)
  const dragScaleSpring = useSpring(dragScaleTarget, {
    stiffness: 640,
    damping: 36,
    mass: 0.2,
  })

  const tiltTarget = useMotionValue(0)
  const tiltSpring = useSpring(tiltTarget, {
    stiffness: 520,
    damping: 32,
    mass: 0.25,
  })

  const fillWidthPx = useTransform([progressSpring, trackWidthMv], ([p, tw]) => {
    const w = typeof tw === 'number' ? tw : 0
    const prog = typeof p === 'number' ? p : 0
    return Math.max(0, prog * w)
  })

  const thumbTranslateX = useTransform([progressSpring, trackWidthMv], ([p, tw]) => {
    const w = typeof tw === 'number' ? tw : 0
    const prog = typeof p === 'number' ? p : 0
    const travel = Math.max(0, w - ARROW_W)
    return prog * travel
  })

  const thumbRotate = useTransform([rotationSpring, tiltSpring], ([base, tilt]) => {
    const b = typeof base === 'number' ? base : 0
    const t = typeof tilt === 'number' ? tilt : 0
    return b + t
  })

  const thumbScale = useTransform(dragScaleSpring, (s) =>
    typeof s === 'number' ? s : 1
  )

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
      if (delta < 0) rotationTarget.set(180)
      else if (delta > 0) rotationTarget.set(0)
    },
    [rotationTarget]
  )

  const queueProgressFromElement = useCallback(
    (el: HTMLElement) => {
      if (rafScrollRef.current) return
      rafScrollRef.current = requestAnimationFrame(() => {
        rafScrollRef.current = 0
        const p = getScrollProgress(el.scrollLeft, el.scrollWidth, el.clientWidth)
        progressTarget.set(p)
        const d = el.scrollLeft - prevScrollLeftRef.current
        prevScrollLeftRef.current = el.scrollLeft
        if (d !== 0) bumpDirectionFromDelta(d)
      })
    },
    [bumpDirectionFromDelta, progressTarget]
  )

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

    prevScrollLeftRef.current = el.scrollLeft
    progressTarget.set(
      getScrollProgress(el.scrollLeft, el.scrollWidth, el.clientWidth)
    )
    syncOverflow()

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
      const dominantVertical =
        Math.abs(e.deltaY) >= Math.abs(e.deltaX) && Math.abs(e.deltaY) > 0
      if (!dominantVertical) return
      e.preventDefault()
      const prev = el.scrollLeft
      el.scrollLeft += e.deltaY * wheelSpeedMultiplier
      bumpDirectionFromDelta(el.scrollLeft - prev)
      queueProgressFromElement(el)
    }

    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      ro.disconnect()
      mo.disconnect()
      if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current)
    }
  }, [
    scrollRef,
    wheelSpeedMultiplier,
    bumpDirectionFromDelta,
    queueProgressFromElement,
    progressTarget,
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
      dragScaleTarget.set(1.12)
      tiltTarget.set(rotationTarget.get() <= 90 ? 6 : -6)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [scrollRef, dragScaleTarget, tiltTarget, rotationTarget]
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
      tiltTarget.set(0)
      if (el) el.style.scrollBehavior = ''
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      }
    },
    [scrollRef, dragScaleTarget, tiltTarget]
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
            className="smooth-hscroll__thumb"
            style={{
              x: thumbTranslateX,
              y: '-50%',
              rotate: thumbRotate,
              scale: thumbScale,
            }}
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
          >
            <div className="smooth-hscroll__arrow" aria-hidden />
          </motion.div>
        </div>
      </div>
    </div>
  )
}
