export type SoundName = 'spit' | 'hit' | 'eat' | 'nip' | 'splash' | 'end' | 'click'

export const MIN_GAP_MS: Record<SoundName, number> = {
  spit: 90,
  hit: 60,
  eat: 40,
  nip: 120,
  splash: 70,
  end: 1000,
  click: 40,
}

export class RateLimiter {
  private last = new Map<SoundName, number>()

  allow(name: SoundName, nowMs: number): boolean {
    const prev = this.last.get(name)
    if (prev !== undefined && nowMs - prev < MIN_GAP_MS[name]) return false
    this.last.set(name, nowMs)
    return true
  }

  reset(): void {
    this.last.clear()
  }
}

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Linear attack, exponential-ish decay. t and durations in seconds. Returns 0..1. */
export function envelopeAt(t: number, attack: number, decay: number): number {
  if (t < 0) return 0
  if (attack > 0 && t < attack) return t / attack
  if (decay <= 0) return 0
  const d = (t - attack) / decay
  return d >= 1 ? 0 : (1 - d) * (1 - d)
}
