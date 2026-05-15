import { useEffect, useRef, useCallback } from 'react'
import { recordIdleActivity, getLastIdleActivityMs } from '../lib/idleActivitySync'

const IDLE_TIMEOUT_MS = 10 * 60 * 60 * 1000 // 10 hours
const CHECK_INTERVAL_MS = 60 * 1000 // check every 60 seconds

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel']

/**
 * Logs the user out after IDLE_TIMEOUT_MS of no activity.
 * Uses BroadcastChannel + in-memory timestamp (no localStorage/sessionStorage).
 */
export function useIdleLogout(user, logout) {
  const logoutRef = useRef(logout)
  logoutRef.current = logout

  const recordActivity = useCallback(() => {
    recordIdleActivity()
  }, [])

  useEffect(() => {
    if (!user) return

    recordActivity()

    const opts = { passive: true, capture: true }
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, recordActivity, opts))

    const interval = setInterval(() => {
      const last = getLastIdleActivityMs()
      if (last && Date.now() - last > IDLE_TIMEOUT_MS) {
        logoutRef.current()
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, recordActivity, opts))
      clearInterval(interval)
    }
  }, [user, recordActivity])
}
