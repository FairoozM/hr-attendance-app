/** Short completion tone via Web Audio (no asset file). */
let sharedCtx: AudioContext | null = null

function getAudioContext() {
  const Ctor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!sharedCtx) sharedCtx = new Ctor()
  return sharedCtx
}

/** Call on user gesture (sync button) so the later beep is not blocked. */
export function primeSyncCompleteBeep() {
  try {
    const ctx = getAudioContext()
    if (ctx?.state === 'suspended') {
      void ctx.resume()
    }
  } catch {
    // ignore
  }
}

export async function playSyncCompleteBeep() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    const playTone = (frequency: number, startAt: number, durationSec: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.28, startAt + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(startAt)
      osc.stop(startAt + durationSec + 0.05)
    }

    const t0 = ctx.currentTime
    playTone(880, t0, 0.18)
    playTone(1175, t0 + 0.22, 0.22)
  } catch {
    // Audio blocked or unavailable — ignore
  }
}
