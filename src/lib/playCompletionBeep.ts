/** Generate a short WAV beep as a data URI (works without external assets). */
function beepDataUri(frequencyHz: number, durationMs: number, volume = 0.45): string {
  const sampleRate = 22050
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000))
  const dataSize = sampleCount * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i)
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate
    const fade = Math.min(1, i / 120, (sampleCount - i) / 120)
    const sample = Math.sin(2 * Math.PI * frequencyHz * t) * volume * fade
    view.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.floor(sample * 32767))), true)
  }

  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return `data:audio/wav;base64,${btoa(binary)}`
}

const BEEP_LOW = beepDataUri(880, 180)
const BEEP_HIGH = beepDataUri(1175, 240)

let primedAudio: HTMLAudioElement | null = null

function makeAudio(src: string) {
  const audio = new Audio(src)
  audio.preload = 'auto'
  return audio
}

/** Call on user gesture (sync button) so the later beep is not blocked. */
export function primeSyncCompleteBeep() {
  try {
    if (!primedAudio) primedAudio = makeAudio(BEEP_LOW)
    primedAudio.volume = 0.01
    void primedAudio.play().then(() => {
      primedAudio?.pause()
      if (primedAudio) primedAudio.currentTime = 0
    }).catch(() => {})
  } catch {
    // ignore
  }
}

export function playSyncCompleteBeep() {
  try {
    const first = primedAudio ?? makeAudio(BEEP_LOW)
    first.volume = 1
    first.currentTime = 0
    void first.play().catch(() => {})

    window.setTimeout(() => {
      try {
        const second = makeAudio(BEEP_HIGH)
        second.volume = 1
        void second.play().catch(() => {})
      } catch {
        // ignore
      }
    }, 220)

    if (typeof document !== 'undefined') {
      const original = document.title
      document.title = '✓ Sync done — ' + original.replace(/^✓ Sync done — /, '')
      window.setTimeout(() => {
        document.title = original.replace(/^✓ Sync done — /, '')
      }, 4000)
    }
  } catch {
    // ignore
  }
}
