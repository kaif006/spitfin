import { RateLimiter, clampVolume, type SoundName } from './audioLogic'

const MAX_VOICES = 12

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
let volume = 0.7
let voices = 0
let unlockInstalled = false
const limiter = new RateLimiter()

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function ensure(): boolean {
  if (ctx) return true
  try {
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return false
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = volume
    master.connect(ctx.destination)
    const len = Math.floor(ctx.sampleRate * 0.5)
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return true
  } catch {
    ctx = null
    return false
  }
}

function tone(
  f0: number,
  f1: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  delay = 0,
): void {
  if (!ctx || !master || voices >= MAX_VOICES) return
  const t = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(f0, t)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(peak, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g)
  g.connect(master)
  voices++
  osc.onended = () => {
    voices--
    osc.disconnect()
    g.disconnect()
  }
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

function noise(dur: number, peak: number, f0: number, f1: number, delay = 0): void {
  if (!ctx || !master || !noiseBuf || voices >= MAX_VOICES) return
  const t = ctx.currentTime + delay
  const src = ctx.createBufferSource()
  const filt = ctx.createBiquadFilter()
  const g = ctx.createGain()
  src.buffer = noiseBuf
  filt.type = 'bandpass'
  filt.Q.value = 1.2
  filt.frequency.setValueAtTime(f0, t)
  filt.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(peak, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filt)
  filt.connect(g)
  g.connect(master)
  voices++
  src.onended = () => {
    voices--
    src.disconnect()
    filt.disconnect()
    g.disconnect()
  }
  src.start(t)
  src.stop(t + dur + 0.02)
}

const recipes: Record<SoundName, () => void> = {
  spit: () => {
    noise(0.12, 0.35, 2400, 900)
    tone(520, 260, 0.1, 'sine', 0.18)
  },
  hit: () => {
    tone(420, 760, 0.09, 'triangle', 0.3)
    tone(760, 1100, 0.08, 'triangle', 0.2, 0.06)
  },
  eat: () => {
    tone(300, 600, 0.07, 'sine', 0.3)
    tone(600, 300, 0.09, 'sine', 0.2, 0.06)
  },
  nip: () => {
    noise(0.05, 0.4, 3500, 1800)
    tone(180, 90, 0.12, 'square', 0.14)
  },
  splash: () => {
    noise(0.22, 0.22, 1400, 400)
  },
  end: () => {
    tone(523, 523, 0.18, 'triangle', 0.25)
    tone(659, 659, 0.18, 'triangle', 0.25, 0.16)
    tone(784, 784, 0.32, 'triangle', 0.25, 0.32)
  },
  click: () => {
    tone(900, 700, 0.04, 'sine', 0.15)
  },
}

export const audio = {
  /** Call once; creates/resumes the context on first pointer/key event. */
  installUnlock(): void {
    if (unlockInstalled || typeof window === 'undefined') return
    unlockInstalled = true
    const unlock = (): void => {
      if (ensure() && ctx && ctx.state === 'suspended') void ctx.resume().catch(() => { })
    }
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
  },

  setVolume(v: number): void {
    volume = clampVolume(v)
    if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02)
  },

  play(name: SoundName): void {
    if (!ctx || ctx.state !== 'running' || volume <= 0) return
    if (!limiter.allow(name, now())) return
    recipes[name]()
  },
}
