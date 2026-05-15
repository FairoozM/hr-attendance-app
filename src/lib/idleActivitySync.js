/**
 * Cross-tab idle activity without localStorage/sessionStorage.
 * Uses BroadcastChannel + in-memory timestamp (resets on full page reload).
 */
const CHANNEL = 'hr-attendance-idle-v1'

let lastActivityMs = Date.now()
let channel = null

function ensureChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (ev) => {
      const t = typeof ev.data === 'number' ? ev.data : 0
      if (t > lastActivityMs) lastActivityMs = t
    }
  }
  return channel
}

export function recordIdleActivity() {
  lastActivityMs = Date.now()
  try {
    ensureChannel()?.postMessage(lastActivityMs)
  } catch (_) {}
}

export function getLastIdleActivityMs() {
  return lastActivityMs
}
