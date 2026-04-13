import { useEffect, useRef, useCallback } from 'react'

const IDLE_TIMEOUT_MS = 10 * 60 * 60 * 1000 // 10 hours
const STORAGE_KEY = 'hr_last_activity'
const CHECK_INTERVAL_MS = 60 * 1000 // check every 60 seconds

// Activity events that reset the idle timer
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel']

/**
 * Logs the user out after IDLE_TIMEOUT_MS of no activity.
 * Activity is tracked via DOM events and persisted in localStorage
 * so the timer survives page refreshes and works across tabs.
 *
 * Only active when a user is logged in.
 */
export function useIdleLogout(user, logout) {
  const logoutRef = useRef(logout)
  logoutRef.current = logout

  const recordActivity = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString())
    } catch (_) {}
  }, [])

  useEffect(() => {
    if (!user) return

    // Stamp activity immediately on mount so a fresh login doesn't
    // get logged out if the storage key is stale or missing
    recordActivity()

    // Attach activity listeners (passive for scroll/touch performance)
    const opts = { passive: true, capture: true }
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, recordActivity, opts))

    // Periodically check if the user has been idle too long
    const interval = setInterval(() => {
      try {
        const last = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10)
        if (last && Date.now() - last > IDLE_TIMEOUT_MS) {
          logoutRef.current()
        }
      } catch (_) {}
    }, CHECK_INTERVAL_MS)

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, recordActivity, opts))
      clearInterval(interval)
    }
  }, [user, recordActivity])
}
