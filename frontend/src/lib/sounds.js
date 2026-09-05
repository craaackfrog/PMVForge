/**
 * Lightweight UI sounds via Web Audio API.
 * Metronome-style clicks — no external assets required.
 * Swap frequencies / durations later if you want different tones.
 */

let ctx = null

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  return ctx
}

function tone({ freq = 880, duration = 0.04, type = 'square', gain = 0.08, when = 0 }) {
  const ac = getCtx()
  if (!ac) return

  const t0 = ac.currentTime + when
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(g)
  g.connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.01)
}

/** Soft tick – toggles, aspect/quality chips */
export function playClick() {
  tone({ freq: 1200, duration: 0.025, type: 'square', gain: 0.05 })
}

/** Slightly fuller tick – primary buttons */
export function playTap() {
  tone({ freq: 900, duration: 0.04, type: 'triangle', gain: 0.07 })
}

/** Double click – generation started */
export function playStart() {
  tone({ freq: 660, duration: 0.05, type: 'square', gain: 0.07 })
  tone({ freq: 990, duration: 0.06, type: 'square', gain: 0.06, when: 0.07 })
}

/** Rising chime – generation finished / video ready */
export function playDone() {
  tone({ freq: 523.25, duration: 0.08, type: 'sine', gain: 0.09 })
  tone({ freq: 659.25, duration: 0.09, type: 'sine', gain: 0.08, when: 0.09 })
  tone({ freq: 783.99, duration: 0.12, type: 'sine', gain: 0.07, when: 0.18 })
}

/** Low thud – error */
export function playError() {
  tone({ freq: 180, duration: 0.15, type: 'sawtooth', gain: 0.06 })
}
